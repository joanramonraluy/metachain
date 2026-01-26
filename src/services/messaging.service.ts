/**
 * Messaging Service - Sending and receiving Maxima messages
 * Handles: sendMessage, receipts, pings, pongs, invitations, chat history
 */

import { MDS } from "@minima-global/mds";
import { runSQL, utf8ToHex, getNextSequenceNumber, incrementSequenceNumber } from "./database.service";
import { chatService } from "./chat.service";

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
    overrideSeq?: number
): Promise<any> {
    try {
        // RESOLVE IDENTIFIER: If sending to a Maxima address (Mx...), try to find the Hex Public Key (0x...)
        let databasePublicKey = toPublicKey;

        if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
            try {
                const safeMxAddress = toPublicKey.replace(/'/g, "''");
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
                    console.log(`🔄 [MIGRATION] Lazy migration triggered for ${toPublicKey} -> ${databasePublicKey}`);
                    const migrateChatSql = `UPDATE CHAT_MESSAGES SET publickey='${databasePublicKey}' WHERE publickey='${safeMxAddress}'`;
                    await runSQL(migrateChatSql);
                    const migrateReqSql = `UPDATE CONTACT_REQUESTS SET to_publickey='${databasePublicKey}' WHERE to_publickey='${safeMxAddress}'`;
                    await runSQL(migrateReqSql);
                }
            } catch (err) {
                console.warn("⚠️ [MAXIMA] Failed to resolve Hex PublicKey, using address as-is:", err);
            }
        }

        // Get extra info for "first contact" resolution (auto-discovery)
        let myAvatar = "";
        let myAddress = "";
        try {
            const avatarRes = await MDS.keypair.get("profile_avatar");
            if (avatarRes && avatarRes.status && avatarRes.value) {
                myAvatar = avatarRes.value;
            }
            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            myAddress = (myInfo.response as any).contact;
        } catch (e) {
            console.warn("⚠️ [MAXIMA] Failed to fetch profile info for payload:", e);
        }

        // Get sequence number for this recipient
        let seq = 0;
        if (overrideSeq !== undefined) {
            seq = overrideSeq;
        } else {
            seq = await getNextSequenceNumber(databasePublicKey);
        }

        const payload: any = {
            message,
            type,
            username: senderName,
            filedata,
            timestamp: messageTimestamp,
            avatar: myAvatar,
            from_address: myAddress,
            txpowid: txpowid || undefined, // Include txpowid if provided
            customid: generateUUID(), // Add UUID for deduplication

            // Use seq if valid (persisted or overridden)
            seq: (saveToDb || overrideSeq !== undefined) ? seq : undefined
        };

        // Define persistable types just in case saveToDb is misused for important messages (like invites)
        const PERSISTABLE_TYPES = ['text', 'image', 'file', 'video', 'audio', 'charm', 'token', 'invitation'];
        const isPersistable = saveToDb && PERSISTABLE_TYPES.includes(type);

        if (type === "charm" && amount > 0) {
            payload.amount = amount;
        }

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        console.log("📤 [MAXIMA] Sending message to:", toPublicKey, payload);

        const sendParams: any = {
            action: "send",
            application: targetApplication,
            data: hexData,
            poll: true, // FIXED: poll:true ensures message delivery for offline/non-contact recipients
        };

        if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
            sendParams.to = cleanMaximaAddress(toPublicKey);
        } else {
            sendParams.publickey = toPublicKey;
        }

        const response = await MDS.cmd.maxima({
            params: sendParams
        });

        console.log("📡 [MAXIMA] Full send response:", response);

        // Increment sequence number ONLY if message is persistable (saved to DB) and NO override was provided
        // (If override provided, caller is responsible for counter management)
        if ((response && (response as any).status) || (response && (response as any).pending)) {
            if (isPersistable && overrideSeq === undefined) {
                await incrementSequenceNumber(databasePublicKey);
            }
        }


        const isPending = response && ((response as any).status === false) && (
            (response as any).pending ||
            ((response as any).error && (response as any).error.toString().toLowerCase().includes("pending"))
        );

        if (response && (response as any).status === false && !isPending) {
            const errorMessage = (response as any).error || "";

            if (errorMessage.includes("No Contact found")) {
                console.log("⚠️ [MAXIMA] Target not in contacts. Attempting to resolve address from Discovery...");

                const safeKey = toPublicKey.replace(/'/g, "''");
                const peerSql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='${safeKey}' LIMIT 1`;
                const peerRes = await runSQL(peerSql);

                if (peerRes.rows && peerRes.rows.length > 0) {
                    const mxAddress = peerRes.rows[0].ADDRESS;
                    console.log(`🔍 [MAXIMA] Found Mx address for non-contact: ${mxAddress}`);

                    const retryResponse = await MDS.cmd.maxima({
                        params: {
                            action: "send",
                            to: cleanMaximaAddress(mxAddress),
                            application: targetApplication,
                            data: hexData,
                            poll: true,
                        } as any,
                    });

                    if (retryResponse && (retryResponse as any).status === false) {
                        console.error("❌ [MAXIMA] Retry with Mx address failed:", (retryResponse as any).error);
                        throw new Error(errorMessage);
                    }

                    // Increment sequence if fallback succeeded and persistable
                    if (isPersistable) {
                        await incrementSequenceNumber(databasePublicKey);
                    }

                    console.log("✅ [MAXIMA] Message sent successfully via Mx address (non-contact)");

                    // IMPORTANT: Insert message locally BEFORE returning!
                    // Always insert even if timestamp is provided (flicker fix passes timestamp)
                    if (saveToDb) {
                        chatService.insertMessage({
                            roomname: recipientName || senderName,
                            publickey: databasePublicKey,
                            username: "Me",
                            type,
                            message,
                            filedata,
                            state: "sent",
                            amount,
                            sender_seq: seq, // Save sequence number locally
                        });
                        console.log("💾 [DB] Message saved locally for non-contact");
                    }

                    return retryResponse;
                } else {
                    throw new Error(errorMessage);
                }
            } else {
                console.error("❌ [MAXIMA] Send failed:", errorMessage);
                throw new Error(errorMessage || "Maxima send failed");
            }
        }

        if (isPending) {
            console.warn("⚠️ [MAXIMA] Command is pending approval (Read Mode). Saving with 'pending' state.");
        } else {
            console.log("✅ [MAXIMA] Message sent successfully");
        }

        // Only insert a new message if we're not updating an existing one
        // UPDATE: Allow insertion even if timestamp is provided (for UI sync), unless explicitly skipping? 
        // For now, assume sendMessage implies we want to save it. 
        // Logic: If we are sending, we should have a record. 'insertMessage' handles new rows.
        if (saveToDb) {
            chatService.insertMessage({
                roomname: recipientName || senderName,
                publickey: databasePublicKey,
                username: "Me",
                type,
                message,
                filedata,
                state: isPending ? "pending" : "sent",
                amount,
                customid: payload.customid // Save local customid
            });
        }

        return response;
    } catch (err) {
        console.error("❌ [MAXIMA] Error sending message:", err);
        throw err;
    }
}

/* ----------------------------------------------------------------------------
   RECEIPTS
---------------------------------------------------------------------------- */

export async function sendReadReceipt(toPublicKey: string) {
    console.log("📤 [READ-RECEIPT] Sending to", toPublicKey);
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
                console.log(`🔍 [READ-RECEIPT] ✅ Found Maxima Address for ${toPublicKey.substring(0, 10)}...`);
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
        console.log("✅ [READ-RECEIPT] Sent successfully");

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
    console.log("📡 [PING] Sending to", toPublicKey);
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
                console.log(`📡 [PING] ✅ Found Maxima Address`);
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
        console.log("✅ [PING] Sent successfully");
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
    sendSyncResponse: sendChatHistoryResponse
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
