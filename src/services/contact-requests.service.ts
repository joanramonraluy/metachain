/**
 * Contact Requests Service - Chat and Maxima contact request management
 * Handles: sending/receiving/accepting/declining contact requests
 */

import { MDS } from "@minima-global/mds";
import { runSQL, utf8ToHex, escapeSql } from "./database.service";

const VERBOSE_CONTACT_REQUEST_LOGS = false;
const contactReqLog = (...args: any[]) => {
    if (VERBOSE_CONTACT_REQUEST_LOGS) console.log(...args);
};

/* ----------------------------------------------------------------------------
   HELPER FUNCTIONS
---------------------------------------------------------------------------- */

async function getMyPublicKey(): Promise<string> {
    const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
    return (myInfo.response as any).publickey;
}

async function getMyMaximaAddress(): Promise<string> {
    const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
    return (myInfo.response as any).contact;
}

async function resolveHexPublicKey(address: string): Promise<string> {
    if (!address.startsWith("Mx") && !address.startsWith("MX")) {
        return address;
    }

    try {
        const parts = address.split('@');
        if (parts.length > 0) {
            const encoded = parts[0].substring(2);
            const discoverySql = `SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE ADDRESS LIKE '%${escapeSql(encoded)}%' LIMIT 1`;
            const discoveryRes = await runSQL(discoverySql);
            if (discoveryRes.rows && discoveryRes.rows.length > 0) {
                return discoveryRes.rows[0].PUBLICKEY;
            }
        }
    } catch (err) {
        console.log("⚠️ Could not resolve hex publickey:", err);
    }

    return address;
}

async function resolveMaximaAddress(publicKey: string): Promise<string | null> {
    if (!publicKey.startsWith('0x')) return publicKey;

    const safeKey = escapeSql(publicKey);
    const sql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='${safeKey}' AND ADDRESS IS NOT NULL LIMIT 1`;

    try {
        const res = await runSQL(sql);
        if (res.rows && res.rows.length > 0) {
            const addr = res.rows[0].ADDRESS;
            if (addr && (addr.startsWith('Mx') || addr.startsWith('MX'))) {
                console.log(`🔍 [ADDRESS-RESOLVER] Resolved ${publicKey.substring(0, 10)}... to ${addr.substring(0, 10)}...`);
                return addr;
            }
        }
    } catch (err) {
        console.error("❌ [ADDRESS-RESOLVER] Error resolving address:", err);
    }

    return null;
}

/* ----------------------------------------------------------------------------
   CHAT PERMISSION
---------------------------------------------------------------------------- */

export async function getChatPermission(): Promise<boolean> {
    try {
        const sql = "SELECT allow_non_contact_chats FROM MY_PROFILE WHERE id=1 LIMIT 1";
        const res = await runSQL(sql);

        if (res && res.rows && res.rows.length > 0) {
            const rawValue = res.rows[0].ALLOW_NON_CONTACT_CHATS ?? res.rows[0].allow_non_contact_chats;
            return (rawValue === 1 || rawValue === "1" || rawValue === true || rawValue === "true");
        }

        const resKp = await MDS.keypair.get('allow_noncontact_chats');
        if (resKp && resKp.status && resKp.value !== undefined) {
            return resKp.value === 'true';
        }

        return true;
    } catch (err) {
        console.error("❌ [Settings] Error getting chat permission:", err);
        return true;
    }
}

export async function getContactChatPermission(contactPublicKey: string): Promise<boolean> {
    try {
        console.log(`🔍 [CHAT-PERM] Checking permission for contact: ${contactPublicKey.substring(0, 10)}...`);

        const safeKey = escapeSql(contactPublicKey);
        const sql = `SELECT allow_non_contact_chats FROM DISCOVERED_PEERS WHERE publickey='${safeKey}'`;

        const res = await runSQL(sql);
        console.log(`📊 [CHAT-PERM] Query result:`, res);

        if (res && res.rows && res.rows.length > 0) {
            const row = res.rows[0];
            const allowNonContactChats = row.ALLOW_NON_CONTACT_CHATS;

            const permissionGranted = (
                allowNonContactChats === true ||
                allowNonContactChats === 1 ||
                allowNonContactChats === 'true' ||
                allowNonContactChats === '1'
            );

            console.log(`✅ [CHAT-PERM] Contact ${contactPublicKey.substring(0, 10)}... allowNonContactChats: ${permissionGranted}`);
            return permissionGranted;
        } else {
            console.log(`⚠️ [CHAT-PERM] Contact not found in DISCOVERED_PEERS, defaulting to TRUE`);
            return true;
        }
    } catch (err) {
        console.error("❌ [CHAT-PERM] Error getting contact permission:", err);
        return true;
    }
}

/* ----------------------------------------------------------------------------
   CHAT REQUESTS (MetaChain)
---------------------------------------------------------------------------- */

export async function sendChatRequest(toAddress: string, myName: string, myAvatar: string, toPublicKey?: string): Promise<void> {
    try {
        console.log(`📤 [Contact Request] Sending request to ${toAddress} (pk: ${toPublicKey || 'auto-resolve'})`);

        const myAddress = await getMyMaximaAddress();

        const payload = {
            type: "contact_request",
            name: myName,
            avatar: myAvatar,
            from_address: myAddress,
            timestamp: Date.now()
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        const sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: true,
        };

        // Use provided publickey if available, otherwise try to resolve
        let recipientHexPublicKey = toPublicKey || await resolveHexPublicKey(toAddress);

        if (toAddress.startsWith("Mx") || toAddress.startsWith("MX")) {
            sendParams.to = toAddress;
        } else {
            sendParams.publickey = toAddress;
        }

        console.log(`🔍 [Contact Request] Using hex publickey identifier: ${recipientHexPublicKey}`);

        const response = await MDS.cmd.maxima({ params: sendParams });

        if (response && (response as any).status === false) {
            throw new Error((response as any).error || "Failed to send contact request");
        }

        console.log("✅ [Contact Request] Request sent successfully");

        const now = Date.now();
        const safeHexPublicKey = escapeSql(recipientHexPublicKey);

        // Insert system message
        const insertChatSql = `
            INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp)
            VALUES ('', '${safeHexPublicKey}', 'System', 'system', 'Chat request sent', '', 'sent', 0, ${now}, NULL, ${now})
        `;
        await runSQL(insertChatSql);
        console.log("✅ [Contact Request] Chat entry created for outgoing request");

        // Save to CONTACT_REQUESTS table
        const myPublicKey = await getMyPublicKey();
        const safeMyPublicKey = escapeSql(myPublicKey);

        const insertRequestSql = `
            MERGE INTO CONTACT_REQUESTS (from_publickey, to_publickey, from_name, status, created_at, updated_at)
            KEY(from_publickey, to_publickey)
            VALUES ('${safeMyPublicKey}', '${safeHexPublicKey}', '${escapeSql(myName)}', 'pending', ${now}, ${now})
        `;
        await runSQL(insertRequestSql);
        console.log(`✅ [Contact Request] Outgoing request saved`);
    } catch (err) {
        console.error("❌ [Contact Request] Error sending request:", err);
        throw err;
    }
}

export async function saveChatRequest(fromPublicKey: string, fromName: string, fromAvatar: string, _toPublicKey: string, fromAddress?: string): Promise<void> {
    try {
        const now = Date.now();

        const toPublicKey = await getMyPublicKey();

        console.log("💾 [Contact Request] Saving request:");
        console.log("  from:", fromPublicKey);
        console.log("  to:", toPublicKey);
        console.log("  name:", fromName);

        const safeFromPublicKey = escapeSql(fromPublicKey);
        const safeFromName = escapeSql(fromName);
        const safeFromAvatar = escapeSql(fromAvatar);
        const safeToPublicKey = escapeSql(toPublicKey);
        const safeFromAddress = fromAddress ? escapeSql(fromAddress) : '';

        // Delete any existing request for this pair
        const deleteSql = `DELETE FROM CONTACT_REQUESTS WHERE from_publickey='${safeFromPublicKey}' AND to_publickey='${safeToPublicKey}'`;
        await runSQL(deleteSql);

        console.log("✅ [Contact Request] Inserting fresh request");
        await runSQL(`
            INSERT INTO CONTACT_REQUESTS (from_publickey, from_name, from_avatar, to_publickey, from_address, status, created_at, updated_at)
            VALUES ('${safeFromPublicKey}', '${safeFromName}', '${safeFromAvatar}', '${safeToPublicKey}', '${safeFromAddress}', 'pending', ${now}, ${now})
        `);
        console.log("✅ [Contact Request] Saved to database");

        // Send delivery confirmation back to sender
        const confirmPayload = {
            type: "contact_request_received",
            timestamp: Date.now()
        };

        const confirmJsonStr = JSON.stringify(confirmPayload);
        const confirmHexData = "0x" + utf8ToHex(confirmJsonStr).toUpperCase();

        await MDS.cmd.maxima({
            params: {
                action: "send",
                publickey: safeFromPublicKey,
                application: "metachain",
                data: confirmHexData,
                poll: true
            } as any
        });
        console.log("✅ [Contact Request] Delivery confirmation sent");

    } catch (err) {
        console.error("❌ [Contact Request] Error saving request:", err);
        throw err;
    }
}

export async function checkPendingChatRequest(publickey: string): Promise<boolean> {
    try {
        contactReqLog(`🔍 [checkPendingContactRequest] Checking for identifier: ${publickey}`);

        let checkPublicKey = await resolveHexPublicKey(publickey);
        let checkAddress: string | null = null;

        if (publickey.startsWith("Mx") || publickey.startsWith("MX")) {
            checkAddress = publickey;
        } else if (checkPublicKey.startsWith("0x")) {
            checkAddress = await resolveMaximaAddress(checkPublicKey);
        }

        const safePublicKey = escapeSql(checkPublicKey);
        const myPublicKey = await getMyPublicKey();
        const safeMyPublicKey = escapeSql(myPublicKey);

        let sql = `SELECT * FROM CONTACT_REQUESTS 
                   WHERE from_publickey = '${safeMyPublicKey}' 
                   AND (to_publickey = '${safePublicKey}'`;

        if (checkAddress) {
            const safeMaximaAddress = escapeSql(checkAddress);
            sql += ` OR to_publickey = '${safeMaximaAddress}'`;
        }

        sql += `) AND status = 'pending'`;

        contactReqLog(`🔍 [checkPendingContactRequest] SQL:`, sql);
        const res = await runSQL(sql);
        const hasPending = res.rows && res.rows.length > 0;

        console.log(`[Contact Request] Pending check for ${publickey.substring(0, 10)}: ${hasPending}`);
        return hasPending;
    } catch (err) {
        console.error("❌ [Contact Request] Error checking pending request:", err);
        return false;
    }
}

export async function checkIncomingChatRequest(fromPublickey: string): Promise<boolean> {
    try {
        contactReqLog(`🔍 [checkIncomingContactRequest] Checking for incoming request from: ${fromPublickey}`);
        const safeFromPublicKey = escapeSql(fromPublickey);

        const myPublicKey = await getMyPublicKey();
        const safeMyPublicKey = escapeSql(myPublicKey);

        const sql = `SELECT * FROM CONTACT_REQUESTS 
                     WHERE from_publickey = '${safeFromPublicKey}' 
                     AND to_publickey = '${safeMyPublicKey}' 
                     AND status = 'pending'`;

        contactReqLog(`🔍 [checkIncomingContactRequest] SQL:`, sql);
        const res = await runSQL(sql);
        const hasIncoming = res.rows && res.rows.length > 0;

        console.log(`[Contact Request] Incoming check for ${fromPublickey.substring(0, 10)}: ${hasIncoming}`);
        return hasIncoming;

    } catch (err) {
        console.error("❌ [Contact Request] Error checking incoming request:", err);
        return false;
    }
}

export async function getChatRequests(myPublicKey: string): Promise<any[]> {
    try {
        console.log("🔍 [Contact Request] Getting requests for:", myPublicKey);
        const safePublicKey = escapeSql(myPublicKey);
        const sql = `SELECT * FROM CONTACT_REQUESTS WHERE to_publickey='${safePublicKey}' AND status='pending' ORDER BY created_at DESC`;
        console.log("🔍 [Contact Request] SQL:", sql);
        const result = await runSQL(sql);
        console.log("🔍 [Contact Request] Result:", result);
        return result.rows || [];
    } catch (err) {
        console.error("❌ [Contact Request] Error getting requests:", err);
        return [];
    }
}

// Helper to update status immediately (for optimistic UI support)
export async function updateLocalRequestStatus(publickey: string, status: string): Promise<void> {
    const safePk = escapeSql(publickey);
    const now = Date.now();
    // Using simple concatenation because Minima SQL support for stored procedures/prepared statements var is limited/unknown
    // Use UPPER() to be safe against case mismatches
    const sql = `UPDATE CONTACT_REQUESTS SET status='${getStatusDescription(status)}', updated_at=${now} WHERE UPPER(from_publickey)=UPPER('${safePk}') AND status='pending'`;
    console.log(`🛠️ [Contact Request] Forcing status update: ${sql}`);
    const res = await runSQL(sql);
    console.log(`✅ [Contact Request] Forced status update result:`, JSON.stringify(res));
}

function getStatusDescription(status: string) {
    // Basic sanitization
    return status.replace(/[^a-z]/g, '');
}

export async function acceptChatRequest(fromPublicKey: string, fromAddress: string, options?: { skipMessageInsert?: boolean }): Promise<void> {
    try {
        console.log(`✅ [Contact Request] Accepting request from ${fromPublicKey}`);

        const now = Date.now();
        const safeFromPublicKey = escapeSql(fromPublicKey);

        // Get sender's address from DB
        const selectSql = `SELECT from_address FROM CONTACT_REQUESTS WHERE from_publickey='${safeFromPublicKey}' AND status='pending' LIMIT 1`;
        const requestResult = await runSQL(selectSql);

        const senderAddress = requestResult.rows && requestResult.rows.length > 0
            ? requestResult.rows[0].FROM_ADDRESS
            : fromAddress;

        // Update request status
        // We call the helper or just do it here. Doing it here ensures we don't break existing flow if helper changes.
        const updateSql = `UPDATE CONTACT_REQUESTS SET status='accepted', updated_at=${now} WHERE from_publickey='${safeFromPublicKey}' AND status='pending'`;
        await runSQL(updateSql);

        // Send acceptance message
        const myAddress = await getMyMaximaAddress();

        const payload = {
            type: "contact_accepted",
            timestamp: Date.now(),
            from_address: myAddress
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        const sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: true,
        };

        if (senderAddress && (senderAddress.startsWith("Mx") || senderAddress.startsWith("MX"))) {
            sendParams.to = senderAddress.replace(/\s/g, "");
        } else if (senderAddress && senderAddress.startsWith("0x")) {
            sendParams.publickey = senderAddress;
        } else {
            sendParams.publickey = fromPublicKey;
        }

        await MDS.cmd.maxima({ params: sendParams });

        // Save system message locally (unless skipped)
        if (!options?.skipMessageInsert) {
            const checkDupSql = `SELECT * FROM CHAT_MESSAGES WHERE publickey='${safeFromPublicKey}' AND message='Chat request accepted' AND date > ${now - 10000}`;
            const dupRes = await runSQL(checkDupSql);

            if (!dupRes.rows || dupRes.rows.length === 0) {
                const insertMsgSql = `
                    INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp)
                    VALUES ('', '${safeFromPublicKey}', 'System', 'system', 'Chat request accepted', '', 'sent', 0, ${now}, NULL, ${now})
                `;
                await runSQL(insertMsgSql);
            }
        }
        console.log("✅ [Contact Request] Request accepted and confirmation sent");
    } catch (err) {
        console.error("❌ [Contact Request] Error accepting request:", err);
        throw err;
    }
}

export async function declineChatRequest(fromPublicKey: string, options?: { skipMessageInsert?: boolean }): Promise<void> {
    try {
        const now = Date.now();
        const safeFromPublicKey = escapeSql(fromPublicKey);

        const sql = `UPDATE CONTACT_REQUESTS SET status = 'declined', updated_at = ${now} WHERE from_publickey = '${safeFromPublicKey}' AND status = 'pending'`;
        await runSQL(sql);
        console.log("✅ [Contact Request] Request declined");

        // Add system message (unless skipped)
        if (!options?.skipMessageInsert) {
            const chatMessageSql = `
                INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp)
                VALUES('', '${safeFromPublicKey}', 'System', 'system', 'Chat request declined', '', 'sent', 0, ${now}, NULL, ${now})
            `;
            await runSQL(chatMessageSql);
        }

        // Send decline notification
        const payload = {
            type: "contact_declined",
            timestamp: now
        };
        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        const mxAddress = await resolveMaximaAddress(fromPublicKey);

        const sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: true
        };

        if (mxAddress) {
            sendParams.to = mxAddress;
        } else {
            sendParams.publickey = fromPublicKey;
        }

        await MDS.cmd.maxima({ params: sendParams });
        console.log("✅ [Contact Request] Decline notification sent");

    } catch (err) {
        console.error("❌ [Contact Request] Error declining request:", err);
        throw err;
    }
}

export async function cancelChatRequest(toPublicKey: string): Promise<void> {
    try {
        const now = Date.now();

        const myPublicKey = await getMyPublicKey();
        const safeMyPublicKey = escapeSql(myPublicKey);
        const safeToPublicKey = escapeSql(toPublicKey);

        let safeToAddress = '';
        if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
            safeToAddress = safeToPublicKey;
        } else {
            const addr = await resolveMaximaAddress(toPublicKey);
            if (addr) safeToAddress = escapeSql(addr);
        }

        // Find and delete the pending request
        const selectSql = `SELECT * FROM CONTACT_REQUESTS 
                           WHERE from_publickey='${safeMyPublicKey}' 
                           AND (to_publickey='${safeToPublicKey}' ${safeToAddress ? `OR to_publickey='${safeToAddress}'` : ''})
                           AND status='pending'`;

        const pendingRows = await runSQL(selectSql);

        if (pendingRows && pendingRows.rows && pendingRows.rows.length > 0) {
            const foundToPk = pendingRows.rows[0].TO_PUBLICKEY;

            const deleteSql = `DELETE FROM CONTACT_REQUESTS 
                               WHERE from_publickey='${safeMyPublicKey}' 
                               AND to_publickey='${escapeSql(foundToPk)}' 
                               AND status='pending'`;

            await runSQL(deleteSql);
            console.log("✅ [Contact Request] Request cancelled locally");
        }

        // Send cancellation message
        const payload = {
            type: "contact_cancelled",
            timestamp: Date.now()
        };
        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        const sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: true
        };

        if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
            sendParams.to = toPublicKey.trim();
        } else if (safeToAddress && (safeToAddress.startsWith("Mx") || safeToAddress.startsWith("MX"))) {
            sendParams.to = safeToAddress.trim();
        } else {
            sendParams.publickey = toPublicKey.trim();
        }

        try {
            await MDS.cmd.maxima({ params: sendParams });
            console.log("✅ [Contact Request] Cancellation sent to recipient");
        } catch (sendErr) {
            console.warn("⚠️ [Contact Request] Failed to send cancellation:", sendErr);
        }

        // Add system message
        const chatMessageSql = `
            INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp)
            VALUES('', '${safeToPublicKey}', 'System', 'system', 'Chat request cancelled', '', 'sent', 0, ${now}, NULL, ${now})
        `;
        await runSQL(chatMessageSql);
        console.log("✅ [Contact Request] Added cancellation message to chat");

    } catch (err) {
        console.error("❌ [Contact Request] Error cancelling request:", err);
        throw err;
    }
}

/* ----------------------------------------------------------------------------
   MAXIMA CONTACT REQUESTS
---------------------------------------------------------------------------- */

export async function sendMaximaContactRequest(toAddress: string, toPublicKey?: string): Promise<void> {
    try {
        console.log(`📤 [Maxima Contact] Sending request to ${toAddress}`);

        let myName = "Unknown";
        try {
            const nameRes = await MDS.keypair.get("profile_name");
            if (nameRes?.value) myName = nameRes.value;
        } catch (err) {
            console.log("Could not get profile name");
        }

        const myPublicKey = await getMyPublicKey();

        let recipientHexPublicKey = toPublicKey ? toPublicKey.trim() : toAddress;

        if (!toPublicKey && (toAddress.startsWith("Mx") || toAddress.startsWith("MX"))) {
            try {
                const contactsRes = await MDS.cmd.maxcontacts({ action: "list" } as any);
                const contact = ((contactsRes.response as any)?.contacts || []).find((c: any) =>
                    c.currentaddress === toAddress
                );
                if (contact?.publickey) {
                    recipientHexPublicKey = contact.publickey;
                }
            } catch (err) {
                console.log(`⚠️ Could not resolve hex publickey:`, err);
            }
        }

        const payload = {
            type: "maxima_contact_request",
            name: myName,
            timestamp: Date.now()
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        const sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: true,
            to: toAddress.replace(/\s/g, "")
        };

        const sendResult = await MDS.cmd.maxima({ params: sendParams as any });
        console.log("✅ [Maxima Contact] Request sent:", sendResult);

        const now = Date.now();
        const safeMyPk = escapeSql(myPublicKey);
        const safeRecipPk = escapeSql(recipientHexPublicKey);
        const safeMyName = escapeSql(myName);

        // Insert system message
        const chatSql = `INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp) 
                         VALUES('${safeMyName}', '${safeRecipPk}', 'System', 'system', 'Maxima contact request sent', '', 'sent', 0, ${now}, NULL, ${now})`;
        await runSQL(chatSql);

        const deleteSql = `DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE from_publickey='${safeMyPk}' AND to_publickey='${safeRecipPk}'`;
        await runSQL(deleteSql);

        const insertSql = `
            INSERT INTO MAXIMA_CONTACT_REQUESTS (from_publickey, from_name, to_publickey, status, created_at, updated_at)
            VALUES ('${safeMyPk}', '${safeMyName}', '${safeRecipPk}', 'pending', ${now}, ${now})
        `;
        await runSQL(insertSql);

        console.log("✅ [Maxima Contact] Request sent and saved locally");
    } catch (err) {
        console.error("❌ [Maxima Contact] Error sending request:", err);
        throw err;
    }
}

export async function acceptMaximaContactRequest(fromPublicKey: string, fromAddress: string, options?: { skipMessageInsert?: boolean }): Promise<void> {
    try {
        console.log(`✅ [Maxima Contact] Accepting request from ${fromPublicKey}`);

        if (fromAddress) {
            console.log(`📇 Adding ${fromAddress} to maxcontacts`);
            await MDS.cmd.maxcontacts({
                action: "add",
                contact: fromAddress
            } as any);
            console.log(`✅ Added to maxcontacts`);
        }

        const now = Date.now();
        const safeFromPk = escapeSql(fromPublicKey);

        const updateSql = `UPDATE MAXIMA_CONTACT_REQUESTS SET status='accepted', updated_at=${now} WHERE from_publickey='${safeFromPk}' AND status='pending'`;
        await runSQL(updateSql);
        // NOTE: Do NOT update CONTACT_REQUESTS here - keep the two request types separate

        const myAddress = await getMyMaximaAddress();

        // Save system message locally (unless skipped)
        if (!options?.skipMessageInsert) {
            const insertMsgSql = `
                INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp)
                VALUES ('', '${safeFromPk}', 'System', 'system', 'Maxima contact accepted', '', 'sent', 0, ${now}, NULL, ${now})
            `;
            await runSQL(insertMsgSql);
        }

        const payload = {
            type: "maxima_contact_accepted",
            timestamp: Date.now(),
            from_address: myAddress
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        const sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: true
        };

        if (fromAddress.startsWith("Mx") || fromAddress.startsWith("MX")) {
            sendParams.to = fromAddress.replace(/\s/g, "");
        } else {
            sendParams.publickey = fromAddress;
        }

        await MDS.cmd.maxima({ params: sendParams });
        console.log("✅ [Maxima Contact] Acceptance sent");
    } catch (err) {
        console.error("❌ [Maxima Contact] Error accepting request:", err);
        throw err;
    }
}

export async function declineMaximaContactRequest(fromPublicKey: string, _fromAddress: string, options?: { skipMessageInsert?: boolean }): Promise<void> {
    try {
        console.log(`🚫 [Maxima Contact] Declining request from ${fromPublicKey}`);

        const now = Date.now();
        const safeFromPk = escapeSql(fromPublicKey);

        const updateSql = `UPDATE MAXIMA_CONTACT_REQUESTS SET status='declined', updated_at=${now} WHERE from_publickey='${safeFromPk}' AND status='pending'`;
        await runSQL(updateSql);

        // Save system message locally (unless skipped)
        if (!options?.skipMessageInsert) {
            const insertMsgSql = `
                INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp)
                VALUES ('', '${safeFromPk}', 'System', 'system', 'Maxima contact declined', '', 'sent', 0, ${now}, NULL, ${now})
            `;
            await runSQL(insertMsgSql);
        }

        const mxAddress = await resolveMaximaAddress(fromPublicKey);

        const payload = {
            type: "maxima_contact_declined",
            timestamp: now
        };

        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        const sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: true
        };

        if (mxAddress) {
            sendParams.to = mxAddress.trim();
        } else {
            sendParams.publickey = fromPublicKey;
        }

        await MDS.cmd.maxima({ params: sendParams });
        console.log("✅ [Maxima Contact] Decline sent");
    } catch (err) {
        console.error("❌ [Maxima Contact] Error declining:", err);
        throw err;
    }
}

export async function cancelMaximaContactRequest(toPublicKey: string): Promise<void> {
    try {
        console.log(`🔍 [CANCEL MAXIMA] Input PublicKey: ${toPublicKey}`);

        const myPublicKey = await getMyPublicKey();
        const safeMyPk = escapeSql(myPublicKey);
        const safeToPk = escapeSql(toPublicKey);

        let safeToAddress = '';
        if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
            safeToAddress = safeToPk;
        } else {
            const addr = await resolveMaximaAddress(toPublicKey);
            if (addr) safeToAddress = escapeSql(addr);
        }

        // Find and delete
        const selectSql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS 
                           WHERE from_publickey='${safeMyPk}' 
                           AND (to_publickey='${safeToPk}' ${safeToAddress ? `OR to_publickey='${safeToAddress}'` : ''})
                           AND status='pending'`;

        const pendingRows = await runSQL(selectSql);

        if (pendingRows && pendingRows.rows && pendingRows.rows.length > 0) {
            const foundToPk = pendingRows.rows[0].TO_PUBLICKEY;

            const deleteSql = `DELETE FROM MAXIMA_CONTACT_REQUESTS 
                               WHERE from_publickey='${safeMyPk}' 
                               AND to_publickey='${escapeSql(foundToPk)}' 
                               AND status='pending'`;

            await runSQL(deleteSql);
            console.log("✅ [Maxima Contact] Request cancelled locally");
        }

        // Send cancellation message
        const payload = {
            type: "maxima_contact_cancelled",
            timestamp: Date.now()
        };
        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        const sendParams: any = {
            action: "send",
            application: "metachain",
            data: hexData,
            poll: true
        };

        if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
            sendParams.to = toPublicKey.trim();
        } else if (safeToAddress && (safeToAddress.startsWith("Mx") || safeToAddress.startsWith("MX"))) {
            sendParams.to = safeToAddress.trim();
        } else {
            sendParams.publickey = toPublicKey.trim();
        }

        try {
            await MDS.cmd.maxima({ params: sendParams });
            console.log("✅ [Maxima Contact] Cancellation sent");

            // Insert visual system message locally
            const now = Date.now();
            const sqlLocal = `INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp) 
                              VALUES('', '${safeToPk}', 'System', 'system', 'Maxima contact request cancelled', '', 'sent', 0, ${now}, NULL, ${now})`;
            await runSQL(sqlLocal);

        } catch (sendErr) {
            console.warn("⚠️ [Maxima Contact] Failed to send cancellation:", sendErr);
        }

    } catch (err) {
        console.error("❌ [Maxima Contact] Error cancelling request:", err);
        throw err;
    }
}

export async function getMaximaContactRequests(myPublicKey: string): Promise<any[]> {
    try {
        const safePk = escapeSql(myPublicKey);

        const sql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS WHERE to_publickey='${safePk}' AND status='pending' ORDER BY created_at DESC`;
        const result = await runSQL(sql);
        return result.rows || [];
    } catch (err) {
        console.error("❌ [Maxima Contact] Error getting requests:", err);
        return [];
    }
}

export async function saveMaximaContactRequest(fromPublicKey: string, fromName: string): Promise<void> {
    try {
        console.log("💾 [Maxima Contact] Saving request from:", fromPublicKey);

        const myPublicKey = await getMyPublicKey();

        const now = Date.now();
        const safeFromPk = escapeSql(fromPublicKey);
        const safeFromName = escapeSql(fromName);
        const safeMyPk = escapeSql(myPublicKey);

        const deleteSql = `DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE from_publickey='${safeFromPk}' AND to_publickey='${safeMyPk}'`;
        await runSQL(deleteSql);

        const insertSql = `
            INSERT INTO MAXIMA_CONTACT_REQUESTS (from_publickey, from_name, to_publickey, status, created_at, updated_at)
            VALUES ('${safeFromPk}', '${safeFromName}', '${safeMyPk}', 'pending', ${now}, ${now})
        `;
        await runSQL(insertSql);

        console.log("✅ [Maxima Contact] Request saved");
    } catch (err) {
        console.error("❌ [Maxima Contact] Error saving request:", err);
        throw err;
    }
}

/* ----------------------------------------------------------------------------
   EXPORT SERVICE SINGLETON
---------------------------------------------------------------------------- */

export const contactRequestsService = {
    // Chat permission
    getChatPermission,
    getContactChatPermission,

    // Chat requests (MetaChain)
    sendChatRequest,
    saveChatRequest,
    checkPendingChatRequest,
    checkIncomingChatRequest,
    getChatRequests,
    acceptChatRequest,
    declineChatRequest,
    cancelChatRequest,

    // Maxima contact requests
    sendMaximaContactRequest,
    acceptMaximaContactRequest,
    declineMaximaContactRequest,
    cancelMaximaContactRequest,
    getMaximaContactRequests,
    saveMaximaContactRequest
};
