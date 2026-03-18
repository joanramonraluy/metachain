/**
 * Messaging Service - Sending and receiving Maxima messages
 * Handles: sendMessage, receipts, pings, pongs, invitations, chat history
 */

import { MDS } from "@minima-global/mds";
import { runSQL, utf8ToHex, getAndIncrementSequenceNumber } from "./database.service";
import { chatService, ChatMessage } from "./chat.service";
import { offlineQueueService } from "./offline-queue.service";

const VERBOSE_NETWORK_LOGS = false;
const networkLog = (...args: any[]) => {
    if (VERBOSE_NETWORK_LOGS) console.log(...args);
};

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
function generateUUID() {
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
    toPublicKey: string,
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
    replyTo?: string
): Promise<any> {
    try {
        const cleanMessage = message.trim();
        const customid = generateUUID();

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
                // Dual-send: fire both in parallel and consider success if at least one lands
                const [mxResult, pkResult] = await Promise.allSettled([
                    MDS.cmd.maxima({
                        params: {
                            action: "send",
                            to: mxAddress,
                            application: targetApplication,
                            data: hexData,
                            poll: true,
                        } as any,
                    }),
                    MDS.cmd.maxima({
                        params: {
                            action: "send",
                            publickey: toPublicKey.startsWith("Mx") ? undefined : toPublicKey,
                            application: targetApplication,
                            data: hexData,
                            poll: true,
                        } as any,
                    }).catch(() => ({ status: false })), // publickey send may fail for Mx-addressed peers
                ]);

                const mxOk = mxResult.status === "fulfilled" && (mxResult.value as any).status !== false;
                const pkOk = pkResult.status === "fulfilled" && (pkResult.value as any).status !== false;

                if (!mxOk && !pkOk) {
                    const err = mxResult.status === "rejected" ? mxResult.reason?.message :
                        (mxResult.value as any)?.error || "Both send paths failed";
                    throw new Error(err);
                }

                console.log(`✅ [MAXIMA] Dual-send complete. Mx: ${mxOk}, PK: ${pkOk}`);
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
                    overrideSeq: seq
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
    overrideSeq?: number
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

    const payload: any = {
        message: data.message,
        type: data.type,
        username: data.senderName,
        filedata: data.filedata,
        timestamp: data.timestamp,
        avatar: myAvatar,
        from_address: myAddress,
        txpowid: data.txpowid,
        customid: generateUUID(),
        seq: data.overrideSeq
    };

    if (data.type === "charm" && data.amount > 0) payload.amount = data.amount;

    const jsonStr = JSON.stringify(payload);
    const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    const sendParams: any = {
        action: "send",
        application: data.targetApplication,
        data: hexData,
        poll: true,
    };

    if (target.startsWith("Mx") || target.startsWith("MX")) {
        sendParams.to = target;
    } else {
        sendParams.publickey = target;
    }

    try {
        const response = await MDS.cmd.maxima({ params: sendParams });

        console.log("🔍 [RETRY] Response:", JSON.stringify(response).substring(0, 200));

        if (!(response as any).status) {
            const errMsg = (response as any).error || "MDS command failed";
            console.warn(`⚠️ [RETRY] MDS status false: ${errMsg}`);
            throw new Error(errMsg);
        }
        // Reference implementation only checks status, not delivered

        // Success - update DB
        let dbKey = data.publickey;
        if (dbKey.startsWith("Mx")) {
            const safeMx = dbKey.replace(/'/g, "''");
            const r = await runSQL(`SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE ADDRESS LIKE '%${safeMx}%' LIMIT 1`);
            if (r.rows?.[0]?.PUBLICKEY) dbKey = r.rows[0].PUBLICKEY;
        }

        await chatService.updateMessageState(dbKey, data.timestamp, "sent", data.txpowid);
        console.log("✅ [RETRY] Success.");

    } catch (retryErr: any) {
        const errorMessage = retryErr.message || "";

        // FALLBACK: If "No Contact found", try resolving address from Discovery and retry
        if (errorMessage.includes("No Contact found") && data.publickey.startsWith('0x')) {
            console.log("⚠️ [RETRY] Target not in contacts. Attempting to resolve address from Discovery...");

            const safeKey = data.publickey.replace(/'/g, "''");
            const peerSql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='${safeKey}' LIMIT 1`;

            const peerRes = await runSQL(peerSql);

            if (peerRes.rows && peerRes.rows.length > 0) {
                const mxAddress = peerRes.rows[0].ADDRESS;
                console.log(`🔍 [RETRY] Found Mx address for non-contact: ${mxAddress}`);

                // Retry using the specific Mx address
                const fallbackResponse = await MDS.cmd.maxima({
                    params: {
                        action: "send",
                        to: cleanMaximaAddress(mxAddress),
                        application: data.targetApplication,
                        data: hexData,
                        poll: true,
                    } as any,
                });

                if (!(fallbackResponse as any).status || !(fallbackResponse as any).response.delivered) {
                    throw new Error((fallbackResponse as any).error || (fallbackResponse as any).response?.error || "Fallback retry failed");
                }

                console.log("✅ [RETRY] Message sent successfully via Mx address (fallback)");

                // Update DB
                await chatService.updateMessageState(data.publickey, data.timestamp, "sent", data.txpowid);
                return;
            }
        }

        // If fallback didn't work or wasn't applicable, re-throw
        throw retryErr;
    }
}

/* ----------------------------------------------------------------------------
   RECEIPTS
---------------------------------------------------------------------------- */

export async function sendReadReceipt(toPublicKey: string) {
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
            poll: true,
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

export async function sendDeliveryReceipt(toPublicKey: string) {
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
            poll: true,
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
        console.log("✅ [DELIVERY-RECEIPT] Sent successfully");
    } catch (err) {
        console.error("❌ [DELIVERY-RECEIPT] Error sending:", err);
    }
}

/* ----------------------------------------------------------------------------
   PING / PONG
---------------------------------------------------------------------------- */

export async function sendPing(toPublicKey: string) {
    networkLog("📡 [PING] Sending to", toPublicKey);
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
            poll: true,
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
        networkLog("✅ [PING] Sent successfully");
    } catch (err) {
        console.error("❌ [PING] Error sending:", err);
        throw err;
    }
}

export async function sendPong(toPublicKey: string) {
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

export async function sendInvitation(toPublicKey: string, fromUsername: string) {
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

export async function requestChatHistory(toPublicKey: string) {
    console.log("🔄 [HISTORY-SYNC] Requesting from", toPublicKey);
    try {
        // Get the timestamp of the last message we have for this contact
        const lastMessageTime = await chatService.getLastMessageTimestamp(toPublicKey);

        // If we have no messages, request last 7 days. Otherwise, request from last message.
        const sinceTimestamp = lastMessageTime || (Date.now() - (7 * 24 * 60 * 60 * 1000));

        console.log(`🔍 [HISTORY-SYNC] Last local message: ${lastMessageTime}, requesting since: ${sinceTimestamp}`);

        const payload = {
            message: "",
            type: "chat_history_request",
            username: "Me",
            filedata: "",
            timestamp: sinceTimestamp
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        // Try to resolve MxAddress for better delivery reliability
        const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);

        if (mxAddress) {
            // FIX: Clean address to prevent NumberFormatException
            const cleanAddr = cleanMaximaAddress(mxAddress);
            console.log("🔍 [HISTORY-SYNC] Using resolved address:", cleanAddr.substring(0, 20) + "...");
            await MDS.cmd.maxima({
                params: {
                    action: "send",
                    to: cleanAddr,
                    application: "metachain",
                    data: hexData,
                    poll: true,
                } as any,
            });
        } else {
            console.log("⚠️ [HISTORY-SYNC] No address found, using publickey");
            await MDS.cmd.maxima({
                params: {
                    action: "send",
                    publickey: toPublicKey,
                    application: "metachain",
                    data: hexData,
                    poll: true,
                } as any,
            });
        }

        console.log("✅ [HISTORY-SYNC] Request sent successfully");
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
    retryMessage // Added for OfflineQueueService
};

// Also export sendChatHistoryResponse for use by handlers if needed (though it's usually triggered by incoming request)
export async function sendChatHistoryResponse(toPublicKey: string, messages: any[]) {
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
        let sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: true,
        };

        if (mxAddress) {
            sendParams.to = cleanMaximaAddress(mxAddress);
        } else {
            sendParams.publickey = toPublicKey;
        }

        await MDS.cmd.maxima({ params: sendParams });
        console.log("✅ [HISTORY-RESP] Response sent successfully");
    } catch (err) {
        console.error("❌ [HISTORY-RESP] Error sending response:", err);
    }
}
