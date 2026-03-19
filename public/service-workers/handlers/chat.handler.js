var SYNC_COOLDOWN = {}; // pubkey -> timestamp
var PROCESSING_MESSAGES = new Set(); // lockKey -> timestamp

function handleChatMessage(pubkey, maxjson) {
    MDS.log("💬 [CHAT-IN] Received " + (maxjson.type || "text") + " from " + pubkey.substring(0, 10));
    MDS.log("💬 [CHAT-DEBUG] RAW INCOMING from " + pubkey + ": " + JSON.stringify(maxjson));
    MDS.log("💬 [CHAT] From: " + pubkey + " - " + (maxjson.message || "").substring(0, 30));

    var now = Date.now();
    var safePubkey = escapeSql(pubkey);
    var safeUsername = escapeSql(maxjson.username || "Unknown");
    var safeMessage = escapeSql(maxjson.message || "");
    var safeFiledata = escapeSql(maxjson.filedata || "");
    var msgType = maxjson.type || "text";
    var amount = maxjson.amount || 0;
    var senderSeq = maxjson.seq ? parseInt(maxjson.seq) : 0; // SEQUENCE TRACKING
    var forwarded = maxjson.forwarded === true || maxjson.forwarded === 'true' || maxjson.forwarded === 1;
    var replyTo = maxjson.reply_to ? escapeSql(maxjson.reply_to) : null;
    var replyToVal = replyTo ? "'" + replyTo + "'" : "NULL";

    var customid = maxjson.customid ? escapeSql(maxjson.customid) : "0x00";
    var txpowid = maxjson.txpowid ? escapeSql(maxjson.txpowid) : null;
    var originalTimestamp = maxjson.timestamp ? maxjson.timestamp : 0;

    // 0. PROCESSING GUARD (Race Condition Fix)
    // Create a stable lockKey based on customid or content hash
    var lockKey = (customid !== "0x00") ? customid : (pubkey + "_" + originalTimestamp + "_" + safeMessage.substring(0, 50));
    
    if (PROCESSING_MESSAGES.has(lockKey)) {
        MDS.log("♻️ [CHAT] Ignoring message " + lockKey.substring(0, 10) + "... (already being processed)");
        return;
    }
    PROCESSING_MESSAGES.add(lockKey);

    // Helper to release lock on exit
    var releaseLock = function() {
        PROCESSING_MESSAGES.delete(lockKey);
    };

    // 1. COMBINED PRE-CHECK (Block, Seq, Dup)
    // We combine three serial queries into one to reduce latency from 3 round-trips to 1.
    var dedupConditions = [];
    
    // 1. DEDUPLICATION LOGIC
    // We prioritize explicit IDs (customid, txpowid) for exact matching.
    // Fuzzy content-based deduplication is only used as a fallback if no IDs are present.
    if (customid && customid !== "0x00") {
        dedupConditions.push("customid='" + customid + "'");
    } else if (txpowid) {
        dedupConditions.push("txpowid='" + txpowid + "'");
    } else {
        var minTime = originalTimestamp - 60000;
        var maxTime = originalTimestamp + 60000;
        var timeCondition = "message='" + safeMessage + "' AND (" +
            "(original_timestamp >= " + minTime + " AND original_timestamp <= " + maxTime + ") OR " +
            "(date >= " + minTime + " AND date <= " + maxTime + "))";
        dedupConditions.push("(" + timeCondition + ")");
    }

    var combinedSql = "SELECT " + 
        "(SELECT COUNT(*) FROM CHAT_STATUS WHERE publickey='" + safePubkey + "' AND blocked=1) as is_blocked, " +
        "(SELECT MAX(sender_seq) FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "') as last_seq, " +
        "(SELECT COUNT(*) FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "' AND (" + dedupConditions.join(" OR ") + ")) as dup_count";

    MDS.log("🔍 [SQL-OPT] Running combined pre-check for " + safeUsername);
    var startTime = Date.now();

    MDS.sql(combinedSql, function (res) {
        var endTime = Date.now();
        MDS.log("⏱️ [SQL-OPT] Combined check took " + (endTime - startTime) + "ms");

        if (!res.status) {
            MDS.log("❌ [SQL-OPT] Query failed: " + res.error);
            releaseLock();
            return;
        }

        var results = res.rows[0];
        var isBlocked = parseInt(results.IS_BLOCKED || 0) > 0;
        var lastSeq = parseInt(results.LAST_SEQ || 0);
        var dupCount = parseInt(results.DUP_COUNT || 0);

        // A. BLOCK CHECK
        if (isBlocked) {
            MDS.log("🚫 [CHAT] Message BLOCKED from: " + safeUsername + " (" + safePubkey + ")");
            releaseLock();
            return;
        }

        // B. GAP DETECTION
        if (senderSeq > 1 && senderSeq > lastSeq + 1) {
            var gapSize = senderSeq - lastSeq - 1;
            MDS.log("⚠️ [GAP-DETECT] Sequence gap detected from " + safeUsername + " (Seq: " + senderSeq + ", Last: " + lastSeq + ", Missing: " + gapSize + ")");
            if (typeof requestChatHistory === 'function') {
                MDS.log("🔄 [GAP-FILL] Triggering sync to fill gap...");
                requestChatHistory(pubkey);
            }
        }

        // C. DEDUPLICATION
        if (dupCount > 0) {
            MDS.log("♻️ [CHAT] Ignoring duplicate message from " + safeUsername + " (already exists in DB)");
            if (maxjson.seq && maxjson.seq > 0) {
                var updateSeqSql = "UPDATE CHAT_MESSAGES SET sender_seq=" + maxjson.seq +
                    " WHERE publickey='" + safePubkey + "' AND (" + dedupConditions.join(" OR ") + ")" +
                    " AND (sender_seq IS NULL OR sender_seq = 0)";
                MDS.sql(updateSeqSql);
            }
            releaseLock();
            return;
        }

        MDS.log("✨ [CHAT-DEBUG] Checks passed. Proceeding to INSERT...");

        var initialState = txpowid ? 'sent' : 'received';
        var forwardedVal = forwarded ? 1 : 0;

        var insertSql = "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, sender_seq, customid, forwarded, reply_to) "
            + "VALUES ('', '" + safePubkey + "', '" + safeUsername + "', '" + msgType + "', '" + safeMessage + "', '" + safeFiledata + "', '" + initialState + "', " + amount + ", " + (originalTimestamp || now) + ", " + txpowidVal + ", " + originalTimestamp + ", " + senderSeq + ", '" + customid + "', " + forwardedVal + ", " + replyToVal + ")";

        MDS.sql(insertSql, function (res) {
            releaseLock();
            if (res.status) {
                MDS.log("✅ [CHAT] Message saved from " + safeUsername);

                // 3. NOTIFY FRONTEND (Immediate Sync)
                MDS.comms.solo("CHAT_LIST_UPDATE", function () {
                    MDS.log("📤 [CHAT-SYNC] Notification sent to frontend for " + safeUsername);
                });

                // FIX: Auto-discover user on message receipt
                if (safeUsername && safeUsername !== "Unknown" && safeUsername !== "System") {
                    var safeAvatar = escapeSql(maxjson.avatar || "");
                    var safeAddress = escapeSql(maxjson.from_address || "");

                    var upsertPeer = "MERGE INTO DISCOVERED_PEERS (publickey, alias, avatar, address, last_seen, source, allow_non_contact_chats, allow_non_contact_chats_source) KEY(publickey) " +
                        "VALUES ('" + safePubkey + "', '" + safeUsername + "', '" + safeAvatar + "', '" + safeAddress + "', " + now + ", 'MSG', 1, 'MESSAGE')";
                    MDS.sql(upsertPeer, function (pRes) {
                        MDS.log("👤 [CHAT] Auto-discovered peer: " + safeUsername);
                    });
                }

                // 3. SEND DELIVERY RECEIPT
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

    // Use smart Address Resolution for non-contacts
    resolveAndSend(toPublicKey, hexData, "DELIVERY", false);
}

function handleReadReceipt(pubkey) {
    MDS.log("📖 [READ-RECEIPT] Received from " + pubkey);
    // Update 'sent' OR 'delivered' messages to 'read'. 
    // Exclude 'pending' (not sent yet), 'failed' AND 'confirmed' (final state for transactions).
    // CRITICAL FIX: Do not overwrite 'confirmed' state with 'read'.
    // CRITICAL FIX 2: Only update TEXT messages. Token/Charm transactions should NOT go to 'read' state.
    var sql = "UPDATE CHAT_MESSAGES SET state='read' WHERE publickey='" + pubkey + "' AND username='Me' AND type='text' AND state!='pending' AND state!='failed' AND state!='read' AND state!='confirmed'";
    MDS.sql(sql, function(res) {
        if (res.status && res.rowsAffected > 0) {
            // Notify frontend
            MDS.comms.solo(JSON.stringify({
                type: 'read_receipt',
                from: pubkey
            }));
        }
    });
}

function handleDeliveryReceipt(pubkey) {
    MDS.log("📬 [DELIVERY-RECEIPT] Received from " + pubkey);
    // Update 'sent' messages to 'delivered'. 
    // Do NOT overwrite 'read' status (as read > delivered).
    var sql = "UPDATE CHAT_MESSAGES SET state='delivered' WHERE publickey='" + pubkey + "' AND username='Me' AND state='sent'";
    MDS.sql(sql, function(res) {
        if (res.status && res.rowsAffected > 0) {
            // Notify frontend
            MDS.comms.solo(JSON.stringify({
                type: 'delivery_receipt',
                from: pubkey
            }));
        }
    });
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

    // Smart Address Resolution for Non-Contacts via unified helper
    resolveAndSend(pubkey, hexData, "PONG", false);
}

function handlePong(pubkey) {
    MDS.log("📡 [PONG] Received from " + pubkey);
    // Let the UI handle pong events
}

// ============================================================================
// HISTORY SYNC HANDLERS
// ============================================================================

function handleChatHistoryRequest(pubkey, maxjson) {
    MDS.log("🔄 [HISTORY-REQ] Request from " + pubkey.substring(0, 10) + "...");

    try {
        var since = maxjson.timestamp ? maxjson.timestamp : 0;
        // Limit history request to last 7 days by default if 0 provided
        if (since === 0) {
            since = Date.now() - (7 * 24 * 60 * 60 * 1000);
        }

        var safePubkey = escapeSql(pubkey);

        // Filter: Only send messages where 'publickey' is the requester's key (direct chat)
        // OR where I am the sender TO the requester.
        // Wait, CHAT_MESSAGES table stores messages in a unified way?
        // 'publickey' column store the 'other party' key.
        // For incoming message: 'publickey' = sender.
        // For outgoing message: 'publickey' = recipient.

        // So we just select WHERE publickey = requester_pubkey
        // This gives both sent and received messages in that conversation.

        var sql = "SELECT * FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "' " +
            "AND (type='text' OR type='token' OR type='charm') " +
            "AND date > " + since + " " +
            "ORDER BY date ASC LIMIT 100"; // Lower limit to 100 to ensure payload is manageable

        MDS.sql(sql, function (res) {
            if (res.status && res.rows) {
                MDS.log("🔄 [HISTORY-REQ] Found " + res.count + " messages for " + pubkey.substring(0, 10));

                var messages = res.rows.map(function (row) {
                    return {
                        id: row.ID,
                        message: row.MESSAGE,
                        type: row.TYPE,
                        username: row.USERNAME,
                        date: row.DATE,
                        filedata: row.FILEDATA,
                        amount: row.AMOUNT,
                        tokenid: row.TOKENID,
                        state: row.STATE,
                        txpowid: row.TXPOWID,
                        sender_seq: row.SENDER_SEQ, // Include sequence for ordering
                        forwarded: (row.FORWARDED === 1 || row.forwarded === 1),
                        reply_to: row.REPLY_TO || row.reply_to
                    };
                });

                // Send response back even if empty, so client knows sync happened
                sendChatHistoryResponse(pubkey, messages);
            } else {
                MDS.log("🔄 [HISTORY-REQ] No messages found (SQL success but no rows?)");
                sendChatHistoryResponse(pubkey, []);
            }
        });
    } catch (e) {
        MDS.log("❌ [HISTORY-REQ] Error processing request: " + e);
    }
}

function sendChatHistoryResponse(toPubkey, messages) {
    var payload = {
        type: "chat_history_response",
        messages: messages,
        timestamp: Date.now()
    };

    var jsonStr = JSON.stringify(payload);
    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    // Log the size
    MDS.log("🔄 [HISTORY-RESP] Sending response size: " + hexData.length + " chars to " + toPubkey.substring(0, 10));

    // Smart Address Resolution with Fallback (Background Polling + Exclusive Send)
    // Background polling prevents blocking the main Minima command loop (no synchronous PoW wait).
    // Exclusive send prevents packet duplication (Address AND PK) for large history payloads.
    resolveAndSend(toPubkey, hexData, "HISTORY-RESP", false, true);
}

function handleChatHistoryResponse(pubkey, maxjson) {
    var messages = maxjson.messages;
    if (!messages || messages.length === 0) {
        MDS.log("🔄 [HISTORY-RESP] Received empty history from " + pubkey);
        return;
    }

    var safePubkey = escapeSql(pubkey);
    MDS.log("🔄 [HISTORY-RESP] Processing " + messages.length + " messages from " + pubkey);

    // 1. Collect IDs for bulk lookup
    var customIds = [];
    var txpowIds = [];
    for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        if (m.customid && m.customid !== '0x00') customIds.push("'" + escapeSql(m.customid) + "'");
        if (m.txpowid) txpowIds.push("'" + escapeSql(m.txpowid) + "'");
    }

    // 2. Resolve Alias ONCE and find existing messages in bulk
    var aliasSql = "SELECT alias FROM DISCOVERED_PEERS WHERE publickey='" + safePubkey + "'";
    MDS.sql(aliasSql, function (aliasRes) {
        var resolvedAlias = "Contact";
        if (aliasRes.status && aliasRes.rows && aliasRes.rows.length > 0) {
            resolvedAlias = escapeSql(aliasRes.rows[0].ALIAS || aliasRes.rows[0].alias || "Contact");
        }

        if (customIds.length > 0 || txpowIds.length > 0) {
            var parts = [];
            if (customIds.length > 0) parts.push("customid IN (" + customIds.join(",") + ")");
            if (txpowIds.length > 0) parts.push("txpowid IN (" + txpowIds.join(",") + ")");
            var idCheckSql = "SELECT id, customid, txpowid FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "' AND (" + parts.join(" OR ") + ")";

            MDS.sql(idCheckSql, function (idRes) {
                var existingMap = { custom: {}, txpow: {} };
                if (idRes.status && idRes.rows) {
                    for (var j = 0; j < idRes.rows.length; j++) {
                        var row = idRes.rows[j];
                        var cid = row.CUSTOMID || row.customid;
                        var tid = row.TXPOWID || row.txpowid;
                        var rid = row.ID || row.id;
                        if (cid) existingMap.custom[cid] = rid;
                        if (tid) existingMap.txpow[tid] = rid;
                    }
                }
                processHistoryMessage(safePubkey, messages, 0, resolvedAlias, existingMap);
            });
        } else {
            processHistoryMessage(safePubkey, messages, 0, resolvedAlias, { custom: {}, txpow: {} });
        }
    });
}

function processHistoryMessage(safePubkey, messages, index, resolvedAlias, existingMap) {
    var total = messages.length;
    
    // Use the index directly for recursion instead of ignoredIndex/forEach
    if (index >= total) {
        MDS.log("✅ [HISTORY-RESP] Completed sequential processing of " + total + " messages");
        MDS.comms.solo("CHAT_LIST_UPDATE", function () {
            MDS.log("📤 [HISTORY-SYNC] Notification sent to frontend");
        });
        return;
    }

    var msg = messages[index];
    var timestamp = msg.date;
    var type = escapeSql(msg.type || "text");
    var content = escapeSql(msg.message || "");
    var senderSeq = msg.sender_seq || 0;
    var replyTo = msg.reply_to ? escapeSql(msg.reply_to) : null;
    var replyToVal = replyTo ? "'" + replyTo + "'" : "NULL";
    var isIncoming = (msg.username === 'Me');
    var finalUsername = isIncoming ? resolvedAlias : "Me";

    // 0. PROCESSING GUARD (Shared with live handler)
    var customid = msg.customid ? escapeSql(msg.customid) : "0x00";
    var lockKey = (customid !== "0x00") ? customid : (safePubkey + "_" + (msg.original_timestamp || timestamp) + "_" + content.substring(0, 50));
    
    if (PROCESSING_MESSAGES.has(lockKey)) {
        MDS.log("♻️ [HISTORY] Skipping message " + lockKey.substring(0, 10) + "... (already being processed)");
        // Stagger next message processing removed to allow bridge to breathe normally
        processHistoryMessage(safePubkey, messages, index + 1, resolvedAlias, existingMap);
        return;
    }
    PROCESSING_MESSAGES.add(lockKey);

    var releaseLockAndNext = function() {
        PROCESSING_MESSAGES.delete(lockKey);
        // Stagger next message processing (50ms) removed to prioritize real-time traffic
        processHistoryMessage(safePubkey, messages, index + 1, resolvedAlias, existingMap);
    };

    var doInsert = function() {
        var safeFiledata = escapeSql(msg.filedata || "");
        var amount = msg.amount || 0;
        var txpowidVal = msg.txpowid ? "'" + escapeSql(msg.txpowid) + "'" : "NULL";
        var state = msg.state || (isIncoming ? "received" : "sent");
        var safeCustomId = msg.customid ? escapeSql(msg.customid) : "0x00";
        var forwardedVal = msg.forwarded ? 1 : 0;

        var insertSql = "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, customid, sender_seq, forwarded, reply_to) "
            + "VALUES ('', '" + safePubkey + "', '" + finalUsername + "', '" + type + "', '" + content + "', '" + safeFiledata + "', '" + state + "', " + amount + ", " + timestamp + ", " + txpowidVal + ", " + (msg.original_timestamp || timestamp) + ", '" + safeCustomId + "', " + senderSeq + ", " + forwardedVal + ", " + replyToVal + ")";

        MDS.sql(insertSql, function() {
            releaseLockAndNext();
        });
    };

    var doUpdate = function(existingId) {
        if (!msg.txpowid && !msg.state) {
            releaseLockAndNext();
            return;
        }
        var newState = msg.state || "read";
        var updateSql = "UPDATE CHAT_MESSAGES SET state='" + newState + "'";
        if (msg.txpowid) updateSql += ", txpowid='" + escapeSql(msg.txpowid) + "'";
        updateSql += " WHERE id=" + existingId;

        MDS.sql(updateSql, function() {
            releaseLockAndNext();
        });
    };

    // 1. Deduplication check via Map (Bulk resolved in handleChatHistoryResponse)
    var existingId = null;
    if (msg.customid && existingMap.custom[msg.customid]) existingId = existingMap.custom[msg.customid];
    else if (msg.txpowid && existingMap.txpow[msg.txpowid]) existingId = existingMap.txpow[msg.txpowid];

    if (existingId) {
        doUpdate(existingId);
    } else {
        // 2. Fallback check via content/time (Slowest path, only used for non-ID messages)
        var checkTime = msg.original_timestamp || timestamp;
        var minTime = checkTime - 60000;
        var maxTime = checkTime + 60000;
        var checkSql = "SELECT id FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "' AND username='" + finalUsername + "' " +
            "AND (original_timestamp BETWEEN " + minTime + " AND " + maxTime + " OR date BETWEEN " + minTime + " AND " + maxTime + ") " +
            "AND message='" + content + "' LIMIT 1";

        MDS.sql(checkSql, function(res) {
            if (res.status && res.rows && res.rows.length > 0) {
                doUpdate(res.rows[0].ID || res.rows[0].id);
            } else {
                doInsert();
            }
        });
    }
}

function requestHistoryFromRecentContacts() {
    MDS.log("🔄 [HISTORY-SYNC] Starting startup sync (Enhanced)...");

    var sql = "SELECT publickey, address FROM DISCOVERED_PEERS WHERE source != 'SELF' ORDER BY last_seen DESC LIMIT 20";

    MDS.sql(sql, function (res) {
        MDS.log("🔍 [HISTORY-SYNC-DEBUG] SQL result status: " + res.status);
        if (res.status && res.rows) {
            MDS.log("🔄 [HISTORY-SYNC] Found " + res.rows.length + " contacts in DISCOVERED_PEERS");
            if (res.rows.length === 0) {
                MDS.log("⚠️ [HISTORY-SYNC] No contacts found to sync with");
                return;
            }
            MDS.log("🔄 [HISTORY-SYNC] Syncing with " + res.rows.length + " recent contacts");
            MDS.log("🔄 [HISTORY-SYNC] Syncing with " + res.rows.length + " recent contacts (STAGGERED)");
            
            var index = 0;
            function nextSync() {
                if (index < res.rows.length) {
                    var row = res.rows[index];
                    MDS.log("🔄 [HISTORY-SYNC] Staggered request (" + (index + 1) + "/" + res.rows.length + ") to: " + row.PUBLICKEY.substring(0, 10));
                    requestChatHistory(row.PUBLICKEY, row.ADDRESS);
                    index++;
                    // Stagger by 200ms to avoid saturating Maxima queue
                    MDS.cmd("timer 200", nextSync);
                } else {
                    MDS.log("✅ [HISTORY-SYNC] All staggered requests sent");
                }
            }
            nextSync();
        } else {
            MDS.log("❌ [HISTORY-SYNC] SQL query failed: " + (res.error || "Unknown error"));
        }
    });
}

function requestChatHistory(toPublicKey, toAddress) {
    var now = Date.now();
    var safeKey = (toPublicKey || "").toLowerCase();
    
    // 30-second cooldown per peer to prevent "sync storms" during reconnect/startup
    if (SYNC_COOLDOWN[safeKey] && (now - SYNC_COOLDOWN[safeKey] < 30000)) {
        MDS.log("⏭️ [HISTORY-SYNC] Throttling redundant request to " + safeKey.substring(0, 10));
        return;
    }
    SYNC_COOLDOWN[safeKey] = now;

    var payload = {
        message: "",
        type: "chat_history_request",
        username: "Me",
        filedata: "",
        timestamp: Date.now() - (7 * 24 * 60 * 60 * 1000)
    };

    var jsonStr = JSON.stringify(payload);
    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    // Use resolveAndSend in exclusive mode: prioritizes address if available,
    // falls back to publickey lookup. Avoids double-send (was: direct send + resolveAndSend).
    resolveAndSend(toPublicKey, hexData, "HISTORY-SYNC", false, true);
}

// resolveAndSend moved to utils/maxima-sender.js

// --------------------------------------------------------------------------
// SMART SYNC PROTOCOL (BIDIRECTIONAL)
// --------------------------------------------------------------------------

/**
 * Handle incoming sync status check (PHASE 1)
 * Peer says: "I have received messages from you up to sequence X"
 * We check: "Have I sent more than X?"
 * If yes -> Send sync_status_report ("You are missing Y messages")
 */
function handleSyncStatusCheck(msg, fromKey) {
    var peerLastSeq = msg.last_received_seq || 0;

    // Check what is the maximum sequence number we have sent to this user
    // We can infer this from CHAT_MESSAGES where publickey=fromKey AND fromMe=true? 
    // Wait, CHAT_MESSAGES stores messages *received* from them or *sent* to them?
    // It stores both. 
    // Messages WE sent to THEM have: publickey=THEM, username=ME (or similar).
    // AND they should have a 'seq' number we assigned them.
    // BUT 'sender_seq' col tracks what THEY sent US.
    // We need to know what WE sent THEM.
    // The MESSAGE_COUNTERS table tracks the 'next_seq' we will give to the NEXT message.
    // So 'next_seq - 1' is the last one we sent.

    var sql = "SELECT next_seq FROM MESSAGE_COUNTERS WHERE publickey='" + escapeSql(fromKey) + "'";
    MDS.sql(sql, function (res) {
        var myNextSeq = (res.rows && res.rows.length > 0) ? res.rows[0].NEXT_SEQ : 1;
        var myLastSentSeq = myNextSeq - 1;

        MDS.log("🔄 [SMART-SYNC] Check from " + fromKey.substring(0, 10) + ". Their last: " + peerLastSeq + ", My last sent: " + myLastSentSeq);

        if (myLastSentSeq > peerLastSeq) {
            var missingCount = myLastSentSeq - peerLastSeq;
            MDS.log("⚠️ [SMART-SYNC] Peer is missing " + missingCount + " messages.");

            // Optimization: Get preview of the very last message to show in their UI
            // We find the message with highest ID sent to them? 
            // We don't strictly index our sent 'seq' in CHAT_MESSAGES yet (we just send it).
            // We might need to query by date DESC.
            var previewSql = "SELECT message, date, type FROM CHAT_MESSAGES WHERE publickey='" + escapeSql(fromKey) + "' AND state IN ('sent','delivered','read') ORDER BY date DESC LIMIT 1";

            MDS.sql(previewSql, function (pRes) {
                var lastMsg = (pRes.rows && pRes.rows.length > 0) ? pRes.rows[0] : null;

                var reportPayload = {
                    type: "sync_status_report",
                    missing_count: missingCount,
                    my_highest_seq: myLastSentSeq,
                    last_message_preview: lastMsg ? {
                        text: (lastMsg.TYPE === 'text') ? lastMsg.MESSAGE : ("[" + lastMsg.TYPE + "]"),
                        timestamp: lastMsg.DATE
                    } : null
                };

                // Send report back via Maxima (using Dual-send helper)
                var jsonStr = JSON.stringify(reportPayload);
                var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();
                resolveAndSend(fromKey, hexData, "SMART-SYNC", false, true);
            });

        } else {
            MDS.log("✅ [SMART-SYNC] Peer is up to date.");
        }
    });
}


/**
 * Handle incoming sync status report (PHASE 1 Response)
 * Peer says: "You are missing X messages. Last one was 'Hello'"
 * We action: Update UI to show "Unread/Syncing" state? or Trigger fetch?
 * For Phase 1: Just Log and maybe emit event for UI.
 * For Phase 2: This will auto-trigger 'sync_data_request'
 */
function handleSyncStatusReport(msg, fromKey) {
    MDS.log("📊 [SMART-SYNC] Report from " + fromKey.substring(0, 10) + ": Missing " + msg.missing_count + " messages.");

    // Emit the report to the frontend so minima.service.ts can present it to the UI
    var payload = {
        type: "sync_status_report",
        missing_count: msg.missing_count,
        fromKey: fromKey,
        last_message_preview: msg.last_message_preview
    };
    MDS.comms.solo(JSON.stringify(payload));
}
