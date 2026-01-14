/**
 * MetaChain Service Worker - Chat Message Handler
 * Handles chat messages, read receipts, pings, pongs
 */

function handleChatMessage(pubkey, maxjson) {
    MDS.log("💬 [CHAT] From: " + pubkey + " - " + (maxjson.message || "").substring(0, 30));

    var now = Date.now();
    var safePubkey = escapeSql(pubkey);
    var safeUsername = escapeSql(maxjson.username || "Unknown");
    var safeMessage = escapeSql(maxjson.message || "");
    var safeFiledata = escapeSql(maxjson.filedata || "");
    var msgType = maxjson.type || "text";
    var amount = maxjson.amount || 0;

    // 1. CHECK IF BLOCKED
    var checkBlockSql = "SELECT blocked FROM CHAT_STATUS WHERE publickey='" + safePubkey + "'";
    MDS.sql(checkBlockSql, function (blockRes) {
        var isBlocked = false;
        if (blockRes.status && blockRes.rows && blockRes.rows.length > 0) {
            var val = blockRes.rows[0].BLOCKED;
            isBlocked = val === true || val === 'TRUE' || val === 'true' || val === 1;
        }

        if (isBlocked) {
            MDS.log("🚫 [CHAT] Message BLOCKED from: " + safeUsername + " (" + safePubkey + ")");
            return; // Abort insertion
        }

        // 2. Insert message to DB if not blocked
        var txpowid = maxjson.txpowid ? escapeSql(maxjson.txpowid) : null;
        var initialState = txpowid ? 'sent' : 'received'; // 'sent' triggers blink on receiver side if txpowid exists
        var txpowidVal = txpowid ? "'" + txpowid + "'" : "NULL";
        var originalTimestamp = maxjson.timestamp ? maxjson.timestamp : 0;

        var insertSql = "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp) "
            + "VALUES ('', '" + safePubkey + "', '" + safeUsername + "', '" + msgType + "', '" + safeMessage + "', '" + safeFiledata + "', '" + initialState + "', " + amount + ", " + now + ", " + txpowidVal + ", " + originalTimestamp + ")";

        MDS.sql(insertSql, function (res) {
            if (res.status) {
                MDS.log("✅ [CHAT] Message saved from " + safeUsername);

                // FIX: Auto-discover user on message receipt to fix "Unknown" in chat list
                if (safeUsername && safeUsername !== "Unknown" && safeUsername !== "System") {
                    var safeAvatar = escapeSql(maxjson.avatar || "");
                    var safeAddress = escapeSql(maxjson.from_address || "");

                    var upsertPeer = "MERGE INTO DISCOVERED_PEERS (publickey, alias, avatar, address, last_seen, source, allow_non_contact_chats) KEY(publickey) " +
                        "VALUES ('" + safePubkey + "', '" + safeUsername + "', '" + safeAvatar + "', '" + safeAddress + "', " + now + ", 'MSG', 1)";
                    MDS.sql(upsertPeer, function (pRes) {
                        MDS.log("👤 [CHAT] Auto-discovered peer: " + safeUsername);
                    });
                }

                // 3. SEND DELIVERY RECEIPT (New Logic)
                // We must send a receipt back to the sender so they get the double-check
                sendDeliveryReceipt(pubkey);

            } else {
                MDS.log("❌ [CHAT] Save failed: " + res.error);
            }
        });
    });
}

// Helper to send delivery receipt from Service Worker
function sendDeliveryReceipt(toPublicKey) {
    // Prevent sending receipts to self or system
    if (toPublicKey === 'Me' || toPublicKey === 'System') return;

    var payload = {
        message: "",
        type: "delivery_receipt",
        username: "Me",
        filedata: ""
    };

    var jsonStr = JSON.stringify(payload);
    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    // We reuse the smart sending logic from handlePing or simple send
    // Simple send is enough for receipt, or we can look up address if needed commonly
    // For now, let's use the simplest robust method: send to publickey

    // NOTE: If we want to support Mx addresses for non-contacts, we'd query DB
    // But for simplicity in this handler, we trust the publickey source

    var sendCmd = "maxima action:send publickey:" + toPublicKey + " application:metachain data:" + hexData + " poll:false";
    MDS.cmd(sendCmd, function (res) {
        if (res.status) MDS.log("✅ [DELIVERY] Sent receipt to " + toPublicKey.substring(0, 10));
    });
}

function handleReadReceipt(pubkey) {
    MDS.log("📖 [READ-RECEIPT] Received from " + pubkey);
    // Update 'sent' OR 'delivered' messages to 'read'. 
    // Exclude 'pending' (not sent yet) and 'failed'.
    var sql = "UPDATE CHAT_MESSAGES SET state='read' WHERE publickey='" + pubkey + "' AND username='Me' AND state!='pending' AND state!='failed' AND state!='read'";
    MDS.sql(sql);
}

function handleDeliveryReceipt(pubkey) {
    MDS.log("📬 [DELIVERY-RECEIPT] Received from " + pubkey);
    // Update 'sent' messages to 'delivered'. 
    // Do NOT overwrite 'read' status (as read > delivered).
    var sql = "UPDATE CHAT_MESSAGES SET state='delivered' WHERE publickey='" + pubkey + "' AND username='Me' AND state='sent'";
    MDS.sql(sql);
}

function handlePing(pubkey) {
    MDS.log("📡 [PING] Received from " + pubkey);

    var payload = {
        message: "",
        type: "pong",
        username: "Me",
        filedata: ""
    };

    var jsonStr = JSON.stringify(payload);
    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    // Smart Address Resolution for Non-Contacts
    if (pubkey.startsWith('0x')) {
        var safeKey = pubkey.replace(/'/g, "''");
        var peerSql = "SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='" + safeKey + "' AND ADDRESS IS NOT NULL LIMIT 1";

        MDS.sql(peerSql, function (peerRes) {
            var sendCmd;
            if (peerRes && peerRes.status && peerRes.count > 0) {
                var rawMx = peerRes.rows[0].ADDRESS;
                var mxAddress = rawMx ? rawMx.replace(/[^a-zA-Z0-9@:._-]/g, "").trim() : null;

                if (mxAddress && (mxAddress.startsWith('Mx') || mxAddress.startsWith('MX'))) {
                    sendCmd = 'maxima action:send to:"' + mxAddress + '" application:metachain data:' + hexData + ' poll:false';
                } else {
                    sendCmd = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false";
                }
            } else {
                sendCmd = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false";
            }

            MDS.cmd(sendCmd, function () {
                MDS.log("✅ [PONG] Sent to " + pubkey.substring(0, 15) + "...");
            });
        });
    } else {
        var sendCmd;
        if (pubkey.startsWith('Mx') || pubkey.startsWith('MX')) {
            sendCmd = 'maxima action:send to:"' + pubkey.trim() + '" application:metachain data:' + hexData + ' poll:false';
        } else {
            sendCmd = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false";
        }
        MDS.cmd(sendCmd, function () {
            MDS.log("✅ [PONG] Sent to " + pubkey.substring(0, 15) + "...");
        });
    }
}

function handlePong(pubkey) {
    MDS.log("📡 [PONG] Received from " + pubkey);
    // Let the UI handle pong events
}
