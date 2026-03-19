/**
 * Messaging Service - Sending and receiving Maxima messages
 * Handles: sendMessage, receipts, pings, pongs, invitations, chat history
 */

import { MDS } from "@minima-global/mds";
import { runSQL, utf8ToHex, getAndIncrementSequenceNumber } from "./database.service";
import { chatService, ChatMessage } from "./chat.service";
import { offlineQueueService } from "./offline-queue.service";

const networkLog = (..._args: any[]) => {
    // if (VERBOSE_NETWORK_LOGS) console.log(..._args);
};

// PING THROTTLING: Prevent Maxima queue saturation
const pingThrottler = new Map<string, number>(); // pubkey -> lastSentTimestamp
const pongThrottler = new Map<string, number>(); // Debounce responding to pings
const pongTracker = new Map<string, number>();   // pubkey -> lastReceivedTimestamp
const syncThrottler = new Map<string, number>();  // pubkey -> lastRequestTimestamp

const STRICT_SERIAL_PROTOCOL = true; // [TOGGLE] Set to false to re-enable Concurrent Dual-send

/* ----------------------------------------------------------------------------
   HELPER: Address Cleaner (Ported from Service Worker)
---------------------------------------------------------------------------- */
function cleanMaximaAddress(addr: string): string {
    if (!addr) return "";
    let s = String(addr).trim();
    // CRITICAL: Remove ALL whitespace first to prevent Java NumberFormatException
    s = s.replace(/\s+/g, "");
    const idx = s.lastIndexOf(":");
    if (idx !== -1) {
        const base = s.substring(0, idx);
        const port = s.substring(idx + 1);
        const cleanBase = base.replace(/[^a-zA-Z0-9@._-]/g, "");
        const cleanPort = port.replace(/[^0-9]/g, "");
        if (cleanBase && cleanPort) {
            return cleanBase + ":" + cleanPort;
        }
    }
    return s.replace(/\s/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "");
}

/* ----------------------------------------------------------------------------
   HELPER: UUID Generator
---------------------------------------------------------------------------- */
export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/* ----------------------------------------------------------------------------
   HELPER: Resolve Address from Discovery
---------------------------------------------------------------------------- */

async function resolveMaximaAddressFromPubkey(publicKey: string): Promise<string | null> {
    if (!publicKey.startsWith('0x')) return null;

    const safeKey = publicKey.replace(/'/g, "''");
    const peerSql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='${safeKey}' AND ADDRESS IS NOT NULL LIMIT 1`;

    try {
        const peerRes = await runSQL(peerSql);
        if (peerRes && peerRes.rows && peerRes.rows.length > 0) {
            const mxAddress = peerRes.rows[0].ADDRESS;
            if (mxAddress && mxAddress.startsWith('Mx')) {
                return mxAddress;
            }
        }
    } catch (e) {
        console.error("Error resolving address:", e);
    }
    return null;
}



/* ----------------------------------------------------------------------------
   SEND MESSAGE
---------------------------------------------------------------------------- */

export async function sendMessage(
    toPubKey: string,
    senderName: string,
    message: string,
    type: string = "text",
    filedata: string = "",
    amount: number = 0,
    messageTimestamp: number = Date.now(),
    recipientName?: string,
    targetApplication: string = "metachain",
    saveToDb: boolean = true,
    txpowid?: string,
    overrideSeq?: number,
    forwarded: boolean = false,
    replyTo?: string,
    providedCustomid?: string
): Promise<any> {
    const toPublicKey = (toPubKey || "").toLowerCase();
    try {
        const cleanMessage = message.trim();
        const customid = providedCustomid || generateUUID();

        // 1. RESOLVE IDENTIFIER
        let databasePublicKey = toPublicKey;
        const safeMxAddress = toPublicKey.replace(/'/g, "''");

        if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
            try {
                const discoverySql = `SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE ADDRESS LIKE '%${safeMxAddress}%' LIMIT 1`;
                const discoveryRes = await runSQL(discoverySql);

                if (discoveryRes.rows && discoveryRes.rows.length > 0) {
                    databasePublicKey = discoveryRes.rows[0].PUBLICKEY;
                    console.log(`🔍 [MAXIMA] Resolved Mx address to Hex PublicKey: ${databasePublicKey}`);
                } else {
                    const contacts = await MDS.cmd.maxcontacts({ params: { action: "list" } });
                    const contactList = (contacts.response as unknown as any[]) || [];
                    const contact = contactList.find((c: any) => c.currentaddress === toPublicKey);
                    if (contact && contact.publickey) {
                        databasePublicKey = contact.publickey;
                        console.log(`🔍 [MAXIMA] Resolved Mx address from Contacts to Hex PublicKey: ${databasePublicKey}`);
                    }
                }

                // LAZY MIGRATION
                if (databasePublicKey !== toPublicKey) {
                    const migrateChatSql = `UPDATE CHAT_MESSAGES SET publickey='${databasePublicKey}' WHERE publickey='${safeMxAddress}'`;
                    await runSQL(migrateChatSql);
                    const migrateReqSql = `UPDATE CONTACT_REQUESTS SET to_publickey='${databasePublicKey}' WHERE to_publickey='${safeMxAddress}'`;
                    await runSQL(migrateReqSql);
                }
            } catch (err) {
                console.warn("⚠️ [MAXIMA] Failed to resolve Hex PublicKey, using address as-is:", err);
            }
        }

        // 2. PREPARE PAYLOAD
        let myAvatar = "";
        let myAddress = "";
        try {
            const avatarRes = await MDS.keypair.get("profile_avatar");
            if (avatarRes && avatarRes.status && avatarRes.value) myAvatar = avatarRes.value;
            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            myAddress = (myInfo.response as any).contact;
        } catch (e) {
            console.warn("⚠️ [MAXIMA] Failed to fetch profile info:", e);
        }

        let seq = 0;
        if (overrideSeq !== undefined) {
            seq = overrideSeq;
        } else {
            // ATOMIC: Get and increment in one operation to prevent race conditions
            seq = await getAndIncrementSequenceNumber(databasePublicKey);
        }

        // 3. OPTIMISTIC SAVE (PENDING)
        if (saveToDb) {
            const msgData: ChatMessage = {
                roomname: recipientName || senderName,
                publickey: databasePublicKey,
                username: "Me",
                type,
                message: cleanMessage,
                filedata,
                state: "pending",
                amount,
                date: messageTimestamp,
                customid: customid,
                sender_seq: seq,
                originalTimestamp: messageTimestamp,
                forwarded: forwarded,
                reply_to: replyTo
            };

            await chatService.insertMessage(msgData);

            // NOTE: No need to increment here - getAndIncrementSequenceNumber already did it atomically
            // This prevents race conditions when sending multiple messages quickly
        }

        // 4. NETWORK SEND
        const payload: any = {
            message,
            type,
            username: senderName,
            filedata,
            timestamp: messageTimestamp,
            avatar: myAvatar,
            from_address: myAddress,
            txpowid: txpowid || undefined,
            customid: customid,
            seq: (saveToDb || overrideSeq !== undefined) ? seq : undefined,
            forwarded: forwarded,
            reply_to: replyTo
        };

        if (type === "charm" && amount > 0) payload.amount = amount;

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        console.log("📤 [MAXIMA] Sending to:", toPublicKey);

        try {
            // DUAL-SEND STRATEGY (mirrors group.service.ts sendMaximaMessage):
            // Resolve Mx address upfront and, if found, send via BOTH to:MxAddr AND publickey:
            // concurrently. One of the two will reach the recipient without waiting for an error
            // round-trip first. This eliminates the delivery delay for non-contact recipients.

            let mxAddress: string | null = null;

            if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
                // Already an address — use directly
                mxAddress = cleanMaximaAddress(toPublicKey);
            } else {
                // Proactively resolve Mx address from DISCOVERED_PEERS (no error round-trip needed)
                mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);
                if (mxAddress) {
                    console.log(`🔍 [MAXIMA] Proactively resolved Mx address: ${mxAddress.substring(0, 25)}...`);
                }
            }

            if (mxAddress) {
                // SAFETY: Concurrent Dual-send is ONLY for lightweight payloads (text, tokens, receipts, etc.)
                // Large files/images must use a single transport to save bandwidth and prevent node crashes.
                const isLightweight = ["text", "token", "charm", "read_receipt", "delivery_receipt", "sync_status_check", "sync_status_report", "chat_history_request"].includes(type);
                const isSmallData = !filedata || filedata.length < 50000; // Under 50KB is safe
                
                if (isLightweight && isSmallData) {
                    if (STRICT_SERIAL_PROTOCOL) {
                        // --- STRICT SERIAL PROTOCOL PATH ---
                        console.log("📡 [MAXIMA] Using Serial Fallback for lightweight payload");
                        const bestParams: any = {
                            action: "send",
                            to: mxAddress,
                            application: targetApplication,
                            data: hexData,
                            poll: true,
                        };
                        const fallbackParams: any = {
                            action: "send",
                            publickey: toPublicKey.startsWith("Mx") ? undefined : toPublicKey,
                            application: targetApplication,
                            data: hexData,
                            poll: true,
                        };

                        const response = await MDS.cmd.maxima({ params: bestParams }) as any;
                        if (response.status) {
                            console.log("✅ [MAXIMA] Serial send succeeded.");
                        } else if (response.error && response.error.includes("No Contact found") && fallbackParams.publickey) {
                            console.log("⚠️ [MAXIMA] No Contact found. Attempting fallback...");
                            const fallbackResponse = await MDS.cmd.maxima({ params: fallbackParams }) as any;
                            if (!fallbackResponse.status) {
                                throw new Error(fallbackResponse.error || "Fallback send failed");
                            }
                            console.log("✅ [MAXIMA] Fallback send succeeded.");
                        } else {
                            throw new Error(response.error || "Serial send failed");
                        }
                    } else {
                        console.log("🚀 [MAXIMA] Using Concurrent Dual-send for lightweight payload (Race to Success)");
                        // Dual-send: fire both in parallel and return on the FIRST successful response
                        const mxPromise = MDS.cmd.maxima({
                            params: {
                                action: "send",
                                to: mxAddress,
                                application: targetApplication,
                                data: hexData,
                                poll: true,
                            } as any,
                        }).then(res => {
                            if ((res as any).status) return res;
                            throw res;
                        });

                        const pkPromise = MDS.cmd.maxima({
                            params: {
                                action: "send",
                                publickey: toPublicKey.startsWith("Mx") ? undefined : toPublicKey,
                                application: targetApplication,
                                data: hexData,
                                poll: true,
                            } as any,
                        }).then(res => {
                            if ((res as any).status) return res;
                            throw res;
                        }).catch(e => {
                            // Suppress background errors if PK send fails (common for non-contacts)
                            throw e;
                        });

                        // We use a manual race that ignores rejections as long as one succeeds
                        await new Promise((resolve, reject) => {
                            let settled = 0;
                            let lastErr: any = null;
                            const promises = [mxPromise, pkPromise];
                            promises.forEach(p => {
                                p.then(resolve).catch(err => {
                                    settled++;
                                    lastErr = err;
                                    if (settled === promises.length) reject(lastErr);
                                });
                            });
                        });
                        console.log(`✅ [MAXIMA] Dual-send succeeded via one transport layer.`);
                    }
                } else {
                    console.log(`📡 [MAXIMA] Using single transport for large/file payload (${type})`);
                    // Single transport for large files: Prefer Address (Mx) if resolved, else Public Key
                    const resp = await MDS.cmd.maxima({
                        params: {
                            action: "send",
                            to: mxAddress,
                            application: targetApplication,
                            data: hexData,
                            poll: true,
                        } as any,
                    });

                    if (!(resp as any).status) {
                        throw new Error((resp as any).error || "Single transport send failed");
                    }
                    console.log("✅ [MAXIMA] Sent successfully via single transport.");
                }
            } else {
                // No Mx address known — fall back to publickey-only send
                console.log("⚠️ [MAXIMA] No Mx address found, using publickey-only send");
                const response = await MDS.cmd.maxima({
                    params: {
                        action: "send",
                        publickey: toPublicKey,
                        application: targetApplication,
                        data: hexData,
                        poll: true,
                    } as any,
                });

                if (!(response as any).status) {
                    throw new Error((response as any).error || "MDS command failed");
                }
                console.log("✅ [MAXIMA] Sent successfully via publickey.");
            }

            // 5. UPDATE TO SENT
            if (saveToDb) {
                chatService.updateMessageState(databasePublicKey, messageTimestamp, "sent", txpowid);
            }

            return { status: true };

        } catch (networkErr: any) {
            const errorMessage = networkErr.message || "";
            console.warn(`⚠️ [MAXIMA] Send failed: ${errorMessage}. Queueing.`);

            // 6. QUEUE ON FAILURE
            if (saveToDb) {
                await offlineQueueService.queueChatMessage({
                    publickey: toPublicKey,
                    senderName,
                    message: cleanMessage,
                    type,
                    filedata,
                    amount,
                    timestamp: messageTimestamp,
                    recipientName: recipientName || "",
                    targetApplication,
                    txpowid,
                    overrideSeq: seq,
                    customid: customid
                });

                return { status: true, pending: true, message: "Queued for offline delivery" };
            } else {
                throw networkErr;
            }
        }

    } catch (err) {
        console.error("❌ [SEND] Critical failure:", err);
        return { status: false, error: err };
    }
}

/**
 * Retry sending a message (called by OfflineQueueService)
 */
export async function retryMessage(data: {
    publickey: string,
    senderName: string,
    message: string,
    type: string,
    filedata: string,
    amount: number,
    timestamp: number,
    recipientName: string,
    targetApplication: string,
    txpowid?: string,
    overrideSeq?: number,
    customid?: string
}): Promise<void> {
    console.log(`🔄 [RETRY] Resending to ${data.publickey}...`);

    let target = data.publickey;
    if (data.publickey.startsWith('0x')) {
        const resolved = await resolveMaximaAddressFromPubkey(data.publickey);
        if (resolved) {
            target = resolved;
            console.log(`🔍 [RETRY] Resolved address: ${resolved}`);
        } else {
            console.log(`⚠️ [RETRY] No address found in DISCOVERED_PEERS for ${data.publickey.substring(0, 20)}...`);
        }
    } else if (data.publickey.startsWith("Mx")) {
        target = cleanMaximaAddress(data.publickey);
    }

    console.log(`📤 [RETRY] Target for send: ${target.substring(0, 30)}... (type: ${target.startsWith('Mx') ? 'address' : 'publickey'})`);


    const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
    const myAddress = (myInfo.response as any).contact;
    const avatarRes = await MDS.keypair.get("profile_avatar");
    const myAvatar = (avatarRes && avatarRes.status) ? avatarRes.value : "";

    try {
        const payload: any = {
            message: data.message,
            type: data.type,
            username: data.senderName,
            filedata: data.filedata,
            timestamp: data.timestamp,
            avatar: myAvatar,
            from_address: myAddress,
            txpowid: data.txpowid,
            customid: data.customid || generateUUID(),
            seq: data.overrideSeq
        };

        if (data.type === "charm" && data.amount > 0) payload.amount = data.amount;

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        const pkParams: any = {
            action: "send",
            publickey: data.publickey.startsWith('0x') ? data.publickey : undefined,
            application: data.targetApplication,
            data: hexData,
            poll: true,
        };

        const mxParams: any = {
            action: "send",
            to: target.startsWith('Mx') ? target : undefined,
            application: data.targetApplication,
            data: hexData,
            poll: true,
        };

        const hasMx = !!mxParams.to;
        const hasPk = !!pkParams.publickey;

        if (STRICT_SERIAL_PROTOCOL) {
            // --- STRICT SERIAL PROTOCOL PATH ---
            console.log("📡 [RETRY] Using Serial Fallback for retry");
            const response = await MDS.cmd.maxima({ params: hasMx ? mxParams : pkParams }) as any;
            if (!response.status) {
                if (response.error && response.error.includes("No Contact found") && hasPk && hasMx) {
                     console.log("⚠️ [RETRY] No Contact found. Attempting fallback...");
                     const fallbackResponse = await MDS.cmd.maxima({ params: pkParams }) as any;
                     if (!fallbackResponse.status) throw new Error(fallbackResponse.error || "Fallback failed");
                } else {
                    throw new Error(response.error || "Retry failed");
                }
            }
            console.log(`✅ [RETRY] Resent successfully.`);
        } else {
            // CONCURRENT DUAL-SEND: Race to success
            const sendPromises: Promise<any>[] = [];
            if (hasPk) sendPromises.push(MDS.cmd.maxima({ params: pkParams }).then(r => { if (r.status) return r; throw r; }));
            if (hasMx) sendPromises.push(MDS.cmd.maxima({ params: mxParams }).then(r => { if (r.status) return r; throw r; }));

            await new Promise((resolve, reject) => {
                let settled = 0;
                let lastErr: any = null;
                sendPromises.forEach(p => {
                    p.then(resolve).catch(err => {
                        settled++;
                        lastErr = err;
                        if (settled === sendPromises.length) reject(lastErr);
                    });
                });
            });
            console.log(`✅ [RETRY] Resent successfully via one transport layer.`);
        }

        // Success - update DB

        // Success - update DB
        let dbKey = data.publickey;
        if (dbKey.startsWith("Mx")) {
            const safeMx = dbKey.replace(/'/g, "''");
            const r = await runSQL(`SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE ADDRESS LIKE '%${safeMx}%' LIMIT 1`);
            if (r.rows?.[0]?.PUBLICKEY) dbKey = r.rows[0].PUBLICKEY;
        }

        await chatService.updateMessageState(dbKey, data.timestamp, "sent", data.txpowid);
        console.log("✅ [RETRY] Success via Dual-send.");

    } catch (retryErr: any) {
        console.error("❌ [RETRY] Critical failure:", retryErr);
        throw retryErr;
    }
}

/* ----------------------------------------------------------------------------
   RECEIPTS
---------------------------------------------------------------------------- */

export async function sendReadReceipt(toPubKey: string) {
    const toPublicKey = (toPubKey || "").toLowerCase();
    networkLog("📤 [READ-RECEIPT] Sending to", toPublicKey);
    try {
        const payload = {
            message: "",
            type: "read",
            username: "Me",
            filedata: ""
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        let sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: false, // Changed to false to avoid blocking the command queue
        };

        if (toPublicKey.startsWith('0x')) {
            const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);
            if (mxAddress) {
                networkLog(`🔍 [READ-RECEIPT] ✅ Found Maxima Address for ${toPublicKey.substring(0, 10)}...`);
                sendParams.to = mxAddress;
            } else {
                sendParams.publickey = toPublicKey;
            }
        } else if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
            sendParams.to = toPublicKey;
        } else {
            sendParams.publickey = toPublicKey;
        }

        await MDS.cmd.maxima({ params: sendParams });
        recordActivity(toPublicKey); // Record outbound activity
        networkLog("✅ [READ-RECEIPT] Sent successfully");

        // Mark received messages as read locally
        // CRITICAL: Don't mark as 'read' if the message has an active transaction (pending/sent)
        const sql = `UPDATE CHAT_MESSAGES SET state = 'read' WHERE publickey = '${toPublicKey}' AND username != 'Me' AND state != 'read' AND state != 'pending' AND state != 'sent' AND state != 'confirmed'`;
        MDS.sql(sql, (res: any) => {
            console.log("✅ [DB] Marked received messages as read locally:", res);
        });

    } catch (err) {
        console.error("❌ [READ-RECEIPT] Error sending:", err);
    }
}

export async function sendDeliveryReceipt(toPubKey: string) {
    const toPublicKey = (toPubKey || "").toLowerCase();
    console.log("📤 [DELIVERY-RECEIPT] Sending to", toPublicKey);
    try {
        const payload = {
            message: "",
            type: "delivery_receipt",
            username: "Me",
            filedata: ""
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        let sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: false, // Background task
        };

        if (toPublicKey.startsWith('0x')) {
            const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);
            if (mxAddress) {
                sendParams.to = mxAddress;
            } else {
                sendParams.publickey = toPublicKey;
            }
        } else if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
            sendParams.to = toPublicKey;
        } else {
            sendParams.publickey = toPublicKey;
        }

        await MDS.cmd.maxima({ params: sendParams });
        recordActivity(toPublicKey); // Record outbound activity
        console.log("✅ [DELIVERY-RECEIPT] Sent successfully");
    } catch (err) {
        console.error("❌ [DELIVERY-RECEIPT] Error sending:", err);
    }
}

/* ----------------------------------------------------------------------------
   PING / PONG
---------------------------------------------------------------------------- */

export async function sendPing(toPubKey: string) {
    const toPublicKey = (toPubKey || "").toLowerCase();
    
    // 1. Debounce Check (10 seconds)
    const now = Date.now();
    const lastPing = pingThrottler.get(toPublicKey) || 0;
    if (now - lastPing < 10000) {
        networkLog("📡 [PING] Skipping redundant ping (throttled):", toPublicKey);
        return;
    }

    // 2. Online Awareness: If we received a pong recently, skip the ping
    // 2. Online Awareness: If we received activity recently, skip the ping
    const lastSeen = pongTracker.get(toPublicKey) || 0;
    if (now - lastSeen < 60000) {
        networkLog("📡 [PING] Skipping ping - contact is already 'online' (recent activity):", toPublicKey);
        return;
    }

    networkLog("📡 [PING] Sending to", toPublicKey);
    pingThrottler.set(toPublicKey, now);
    
    try {
        const payload = {
            message: "",
            type: "ping",
            username: "Me",
            filedata: ""
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        let sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: false, // Background task
        };

        if (toPublicKey.startsWith('0x')) {
            const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);
            if (mxAddress) {
                networkLog(`📡 [PING] ✅ Found Maxima Address`);
                sendParams.to = mxAddress;
            } else {
                sendParams.publickey = toPublicKey;
            }
        } else if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
            sendParams.to = toPublicKey;
        } else {
            sendParams.publickey = toPublicKey;
        }

        await MDS.cmd.maxima({ params: sendParams });
        recordActivity(toPublicKey); // Record outbound activity
        networkLog("✅ [PING] Sent successfully");
    } catch (err) {
        console.error("❌ [PING] Error sending:", err);
        throw err;
    }
}

/**
 * Update the last received pong timestamp for a contact.
 * Called by minima.service when a 'pong' message is received.
 */
export function updatePongStatus(toPubKey: string) {
    recordActivity(toPubKey);
}

/**
 * Record any activity (incoming/outgoing) to suppress redundant pings.
 */
export function recordActivity(toPubKey: string) {
    const pubkey = (toPubKey || "").toLowerCase();
    pongTracker.set(pubkey, Date.now());
}

export async function sendPong(toPubKey: string) {
    const toPublicKey = (toPubKey || "").toLowerCase();

    // Throttle responding with a Pong (5s debounce)
    // This prevents duplicate pongs caused by Dual-send pings
    const lastSent = pongThrottler.get(toPublicKey) || 0;
    if (Date.now() - lastSent < 5000) {
        return;
    }
    pongThrottler.set(toPublicKey, Date.now());

    console.log("📡 [PONG] Sending to", toPublicKey);
    try {
        const payload = {
            message: "",
            type: "pong",
            username: "Me",
            filedata: ""
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        let sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: true,
        };

        if (toPublicKey.startsWith('0x')) {
            const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);
            if (mxAddress) {
                console.log(`📡 [PONG] ✅ Found Maxima Address`);
                sendParams.to = mxAddress;
            } else {
                sendParams.publickey = toPublicKey;
            }
        } else if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
            sendParams.to = toPublicKey;
        } else {
            sendParams.publickey = toPublicKey;
        }

        await MDS.cmd.maxima({ params: sendParams });
        console.log("✅ [PONG] Sent successfully");
    } catch (err) {
        console.error("❌ [PONG] Error sending:", err);
        throw err;
    }
}

/* ----------------------------------------------------------------------------
   INVITATION & HISTORY
---------------------------------------------------------------------------- */

export async function sendInvitation(toPubKey: string, fromUsername: string) {
    const toPublicKey = (toPubKey || "").toLowerCase();
    console.log("📨 [INVITE] Sending to", toPublicKey);
    try {
        const payload = {
            message: `${fromUsername} has invited you to join MetaChain! Install the app to start chatting.`,
            type: "invitation",
            username: fromUsername,
            filedata: ""
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        await MDS.cmd.maxima({
            params: {
                action: "send",
                publickey: toPublicKey,
                application: "metachain",
                data: hexData,
                poll: true,
            } as any,
        });

        console.log("✅ [INVITE] Sent successfully");
    } catch (err) {
        console.error("❌ [INVITE] Error sending:", err);
        throw err;
    }
}

export async function requestChatHistory(toPubKey: string) {
    const toPublicKey = (toPubKey || "").toLowerCase();
    console.log("🔄 [HISTORY-SYNC] Requesting from", toPublicKey);
    try {
        // Get the timestamp of the last message we have for this contact
        const lastMessageTime = await chatService.getLastMessageTimestamp(toPublicKey);

        // If we have no messages, request last 7 days. Otherwise, request from last message.
        const sinceTimestamp = lastMessageTime || (Date.now() - (7 * 24 * 60 * 60 * 1000));

        console.log(`🔍 [HISTORY-SYNC] Last local message: ${lastMessageTime}, requesting since: ${sinceTimestamp}`);

        // 30-second cooldown per peer to prevent "sync storms"
        const now = Date.now();
        const lastSync = syncThrottler.get(toPublicKey) || 0;
        if (now - lastSync < 30000) {
            console.log("⏭️ [HISTORY-SYNC] Throttling redundant request to", toPublicKey.substring(0, 10));
            return;
        }
        syncThrottler.set(toPublicKey, now);

        const payload = {
            message: "",
            type: "chat_history_request",
            username: "Me",
            filedata: "",
            timestamp: sinceTimestamp
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        // Use resolution logic
        const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);

        if (mxAddress) {
            const cleanAddr = cleanMaximaAddress(mxAddress);
            console.log("🔍 [HISTORY-SYNC] Sending to Address (Exclusive):", cleanAddr.substring(0, 15) + "...");
            
            // For history requests, we prefer a single reliable transport (Mx address)
            // if known, to avoid saturating the network and causing duplicate responses.
            await MDS.cmd.maxima({
                params: {
                    action: "send",
                    to: cleanAddr,
                    application: "metachain",
                    data: hexData,
                    poll: false,
                } as any,
            });
        } else {
            console.log("⚠️ [HISTORY-SYNC] No address found, using publickey only");
            await MDS.cmd.maxima({
                params: {
                    action: "send",
                    publickey: toPublicKey,
                    application: "metachain",
                    data: hexData,
                    poll: false,
                } as any,
            });
        }

        console.log("✅ [HISTORY-SYNC] Request sent");
    } catch (err) {
        console.error("❌ [HISTORY-SYNC] Error requesting:", err);
        throw err;
    }
}

/* ----------------------------------------------------------------------------
   EXPORT SERVICE SINGLETON
---------------------------------------------------------------------------- */

export const messagingService = {
    sendMessage,
    sendReadReceipt,
    sendDeliveryReceipt,
    sendPing,
    sendPong,
    sendInvitation,
    requestChatHistory,
    sendSyncResponse: sendChatHistoryResponse,
    retryMessage, // Added for OfflineQueueService
    updatePongStatus,
    recordActivity
};

// Also export sendChatHistoryResponse for use by handlers if needed (though it's usually triggered by incoming request)
export async function sendChatHistoryResponse(toPubKey: string, messages: any[]) {
    const toPublicKey = (toPubKey || "").toLowerCase();
    console.log("🔄 [HISTORY-RESP] Sending " + messages.length + " messages to " + toPublicKey);
    try {
        const payload = {
            type: "chat_history_response",
            messages: messages,
            timestamp: Date.now()
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        // Use resolution logic
        const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);

        if (mxAddress) {
            const cleanAddr = cleanMaximaAddress(mxAddress);
            
            // SAFETY: Only use Concurrent Dual-send for smaller history batches
            // Large history responses must use a single transport to avoid network saturation.
            const isSmallData = hexData.length < 100000; // ~50KB threshold
            
            if (isSmallData) {
                console.log("🚀 [HISTORY-RESP] Dual-sending lightweight history to", cleanAddr.substring(0, 15) + "...");
                // CONCURRENT DUAL-SEND
                await Promise.allSettled([
                    MDS.cmd.maxima({
                        params: {
                            action: "send",
                            to: cleanAddr,
                            application: "metachain",
                            data: hexData,
                            poll: false,
                        } as any,
                    }),
                    MDS.cmd.maxima({
                        params: {
                            action: "send",
                            publickey: toPublicKey,
                            application: "metachain",
                            data: hexData,
                            poll: false,
                        } as any,
                    }).catch(() => (null)),
                ]);
            } else {
                console.log(`📡 [HISTORY-RESP] Sending large history (${Math.round(hexData.length / 2)} bytes) via single Mx transport`);
                await MDS.cmd.maxima({
                    params: {
                        action: "send",
                        to: cleanAddr,
                        application: "metachain",
                        data: hexData,
                        poll: false,
                    } as any,
                });
            }
        } else {
            console.log("⚠️ [HISTORY-RESP] No address found, using publickey only");
            await MDS.cmd.maxima({
                params: {
                    action: "send",
                    publickey: toPublicKey,
                    application: "metachain",
                    data: hexData,
                    poll: false,
                } as any,
            });
        }

        console.log("✅ [HISTORY-RESP] Response sent");
    } catch (err) {
        console.error("❌ [HISTORY-RESP] Error sending response:", err);
    }
}
