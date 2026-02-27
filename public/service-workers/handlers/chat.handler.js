/**
 * MetaChain Service Worker - Chat Message Handler
 * Handles chat messages, read receipts, pings, pongs
 */

function handleChatMessage(pubkey, maxjson) {
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
        } else {
            MDS.log("✅ [CHAT-DEBUG] Block check passed for " + safeUsername);
        }

        // GAP DETECTION LOGIC
        // Only run if we have a valid sequence number > 1 (1 is start)
        if (senderSeq > 1) {
            // Check the last sequence number we have from this sender
            var seqSql = "SELECT MAX(sender_seq) as last_seq FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "'";
            MDS.sql(seqSql, function (seqRes) {
                var lastSeq = 0;
                if (seqRes.status && seqRes.rows && seqRes.rows.length > 0) {
                    lastSeq = parseInt(seqRes.rows[0].LAST_SEQ || 0);
                }

                // If we have nothing (lastSeq=0) and incoming is > 1 -> Gap (start missed)
                // If we have lastSeq (e.g. 5) and incoming is > lastSeq + 1 (e.g. 7) -> Gap (6 missed)
                // Note: We used to check just > lastSeq+1, but if lastSeq=0, we expect senderSeq=1. Any start >1 is gap.
                if (senderSeq > lastSeq + 1) {
                    var gapSize = senderSeq - lastSeq - 1;
                    MDS.log("⚠️ [GAP-DETECT] Sequence gap detected from " + safeUsername + " (Seq: " + senderSeq + ", Last: " + lastSeq + ", Missing: " + gapSize + ")");

                    // Trigger sync - use existing solo comms or direct function call if available
                    if (typeof requestChatHistory === 'function') {
                        MDS.log("🔄 [GAP-FILL] Triggering sync to fill gap...");
                        requestChatHistory(pubkey);
                    }
                }
            });
        }

        // 2. Insert message to DB if not blocked
        var txpowid = maxjson.txpowid ? escapeSql(maxjson.txpowid) : null;
        var initialState = txpowid ? 'sent' : 'received'; // 'sent' triggers blink on receiver side if txpowid exists
        var txpowidVal = txpowid ? "'" + txpowid + "'" : "NULL";
        var originalTimestamp = maxjson.timestamp ? maxjson.timestamp : 0;
        var customid = maxjson.customid ? escapeSql(maxjson.customid) : "0x00"; // PERSIST CUSTOM ID

        // CRITICAL FIX: Only store if we don't already have it 
        // We check BOTH txpowid (if available) AND time window simultaneously to ensure we catch duplicates
        // even if one identifier is missing or slightly different.
        var checkDup = "SELECT COUNT(*) as count FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "'";
        var conditions = [];

        // 1. Check by TxPoWID (Strongest check)
        if (txpowid) {
            conditions.push("txpowid='" + txpowid + "'");
        }

        // 2. Check by Time Window & Content (Fuzzy check for 60s window)
        // Checks against both original_timestamp (sender time) and date (local time)
        var minTime = originalTimestamp - 60000;
        var maxTime = originalTimestamp + 60000;
        var timeCondition = "message='" + safeMessage + "' AND (" +
            "(original_timestamp >= " + minTime + " AND original_timestamp <= " + maxTime + ") OR " +
            "(date >= " + minTime + " AND date <= " + maxTime + "))";
        conditions.push("(" + timeCondition + ")");

        // Combine with OR
        if (conditions.length > 0) {
            checkDup += " AND (" + conditions.join(" OR ") + ")";
        }

        MDS.log("🔍 [DEDUP-LIVE] Checking for duplicates with SQL: " + checkDup);

        MDS.sql(checkDup, function (dupRes) {
            if (dupRes.status && dupRes.rows && dupRes.rows[0].COUNT > 0) {
                MDS.log("♻️ [CHAT] Ignoring duplicate message from " + safeUsername + " (already exists in DB)");

                // CRITICAL FIX: Even if duplicate, UPDATE sender_seq if it's currently 0 or NULL
                // This fixes ordering if the message was first added via history sync (which might have lacked seq)
                if (maxjson.seq && maxjson.seq > 0) {
                    var updateSeqSql = "UPDATE CHAT_MESSAGES SET sender_seq=" + maxjson.seq +
                        " WHERE publickey='" + safePubkey + "' AND (" + conditions.join(" OR ") + ")" +
                        " AND (sender_seq IS NULL OR sender_seq = 0)";
                    MDS.sql(updateSeqSql, function (res) {
                        if (res.status && res.rowsAffected > 0) {
                            MDS.log("🔄 [CHAT] Updated sequence for duplicate message to: " + maxjson.seq);
                        }
                    });
                }
                return;
            } else {
                MDS.log("✨ [CHAT-DEBUG] No duplicate found. Proceeding to INSERT...");
            }

            var insertSql = "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, sender_seq, customid) "
                + "VALUES ('', '" + safePubkey + "', '" + safeUsername + "', '" + msgType + "', '" + safeMessage + "', '" + safeFiledata + "', '" + initialState + "', " + amount + ", " + (originalTimestamp || now) + ", " + txpowidVal + ", " + originalTimestamp + ", " + senderSeq + ", '" + customid + "')";

            MDS.sql(insertSql, function (res) {
                if (res.status) {
                    MDS.log("✅ [CHAT] Message saved from " + safeUsername);

                    // 3. NOTIFY FRONTEND (Immediate Sync)
                    // This triggers a UI refresh now that the message is safely in the DB
                    MDS.comms.solo("CHAT_LIST_UPDATE", function () {
                        MDS.log("📤 [CHAT-SYNC] Notification sent to frontend for " + safeUsername);
                    });

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
                    sendDeliveryReceipt(pubkey);

                } else {
                    MDS.log("❌ [CHAT] Save failed: " + res.error);
                }
            });
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
    // Exclude 'pending' (not sent yet), 'failed' AND 'confirmed' (final state for transactions).
    // CRITICAL FIX: Do not overwrite 'confirmed' state with 'read'.
    // CRITICAL FIX 2: Only update TEXT messages. Token/Charm transactions should NOT go to 'read' state.
    var sql = "UPDATE CHAT_MESSAGES SET state='read' WHERE publickey='" + pubkey + "' AND username='Me' AND type='text' AND state!='pending' AND state!='failed' AND state!='read' AND state!='confirmed'";
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
                // Remove all whitespace and invalid characters
                var mxAddress = rawMx ? rawMx.replace(/\s+/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "").trim() : null;

                if (mxAddress && (mxAddress.startsWith('Mx') || mxAddress.startsWith('MX'))) {
                    sendCmd = 'maxima action:send to:' + mxAddress + ' application:metachain data:' + hexData + ' poll:false';
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
            sendCmd = 'maxima action:send to:' + pubkey.trim() + ' application:metachain data:' + hexData + ' poll:false';
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
                        sender_seq: row.SENDER_SEQ // Include sequence for ordering
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

    // Smart Address Resolution with Fallback
    resolveAndSend(toPubkey, hexData, "HISTORY-RESP", true);
}

function handleChatHistoryResponse(pubkey, maxjson) {
    var messages = maxjson.messages;
    if (!messages || messages.length === 0) {
        MDS.log("🔄 [HISTORY-RESP] Received empty history from " + pubkey);
        return;
    }

    MDS.log("🔄 [HISTORY-RESP] Processing " + messages.length + " messages from " + pubkey);
    var safePubkey = escapeSql(pubkey);
    processHistoryMessage(safePubkey, messages, 0);
}

function processHistoryMessage(safePubkey, messages, index) {
    if (index >= messages.length) {
        MDS.log("✅ [HISTORY-RESP] Completed processing batch");
        // Notify frontend to reload chat list
        // MDS.comms.solo sends a message to the frontend
        MDS.comms.solo("CHAT_LIST_UPDATE", function () {
            MDS.log("📤 [HISTORY-SYNC] Notification sent to frontend");
        });
        return;
    }

    var msg = messages[index];
    var timestamp = msg.date;
    var type = escapeSql(msg.type || "text");
    var content = escapeSql(msg.message || "");
    var username = escapeSql(msg.username || "Unknown");
    var senderSeq = msg.sender_seq || 0; // Extract sender_seq

    var finalUsername = "Unknown";
    var isIncoming = false;

    if (msg.username === 'Me') {
        isIncoming = true;
        // Check if we can find a better name in DISCOVERED_PEERS
        finalUsername = "Contact";
    } else {
        isIncoming = false;
        finalUsername = "Me";
    }

    // START ENHANCED DEDUPLICATION
    var tryInsert = function () {
        var safeFiledata = escapeSql(msg.filedata || "");
        var amount = msg.amount || 0;
        var txpowidVal = msg.txpowid ? "'" + escapeSql(msg.txpowid) + "'" : "NULL";

        // Use provided state if valid, otherwise fallback to 'read' or 'received' based on type
        var state = msg.state || "read";

        var safeCustomId = msg.customid ? escapeSql(msg.customid) : "0x00";

        // CRITICAL: Resolve Correct Username (Alias) if it's "Contact" (incoming)
        // This ensures compatibility with Live messages which use the resolved Alias
        if (isIncoming && finalUsername === "Contact") {
            MDS.sql("SELECT alias FROM DISCOVERED_PEERS WHERE publickey='" + safePubkey + "'", function (res) {
                var resolvedName = "Contact";
                if (res.status && res.rows && res.rows.length > 0) {
                    resolvedName = escapeSql(res.rows[0].ALIAS || res.rows[0].alias || "Contact");
                }

                var insertSql = "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, customid, sender_seq) "
                    + "VALUES ('', '" + safePubkey + "', '" + resolvedName + "', '" + type + "', '" + content + "', '" + safeFiledata + "', '" + state + "', " + amount + ", " + timestamp + ", " + txpowidVal + ", " + timestamp + ", '" + safeCustomId + "', " + senderSeq + ")";

                MDS.sql(insertSql, function (insRes) {
                    if (insRes.status) {
                        MDS.log("✅ [HISTORY-SYNC] Recovered message from " + resolvedName + ": " + (content.substring(0, 20)));
                    } else {
                        // Fallback log if insert fails
                        MDS.log("❌ [HISTORY-SYNC] Insert failed: " + insRes.error);
                    }
                    processHistoryMessage(safePubkey, messages, index + 1);
                });
            });
            return; // EXIT here, async SQL handles the recursion
        }

        var insertSql = "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, customid, sender_seq) "
            + "VALUES ('', '" + safePubkey + "', '" + finalUsername + "', '" + type + "', '" + content + "', '" + safeFiledata + "', '" + state + "', " + amount + ", " + timestamp + ", " + txpowidVal + ", " + timestamp + ", '" + safeCustomId + "', " + senderSeq + ")";

        MDS.sql(insertSql, function (insRes) {
            if (insRes.status) {
                MDS.log("✅ [HISTORY-SYNC] Recovered message: " + (content.substring(0, 20)));
            }
            processHistoryMessage(safePubkey, messages, index + 1);
        });
    };

    var tryUpdate = function (existingId) {
        if (!msg.txpowid) {
            processHistoryMessage(safePubkey, messages, index + 1);
            return;
        }

        var newState = msg.state || "read";
        var safeTxPow = escapeSql(msg.txpowid);
        var updateSql = "UPDATE CHAT_MESSAGES SET txpowid='" + safeTxPow + "', state='" + newState + "' WHERE id=" + existingId;

        MDS.sql(updateSql, function (updRes) {
            MDS.log("♻️ [HISTORY-SYNC] Updated existing message ID " + existingId + " with txpowid/state");
            processHistoryMessage(safePubkey, messages, index + 1);
        });
    };

    // 0. Primary Check: By CustomID (UUID)
    if (msg.customid && msg.customid !== '0x00') {
        var safeCustomId = escapeSql(msg.customid);
        var customCheck = "SELECT * FROM CHAT_MESSAGES WHERE customid='" + safeCustomId + "'";
        MDS.sql(customCheck, function (res) {
            if (res.status && res.rows && res.rows.length > 0) {
                // Found by UUID!
                if (msg.txpowid) {
                    tryUpdate(res.rows[0].ID);
                } else {
                    processHistoryMessage(safePubkey, messages, index + 1);
                }
            } else {
                // Not found by UUID -> proceed to TxPoWID check
                checkByTxPoWID();
            }
        });
    } else {
        checkByTxPoWID();
    }

    // 1. First Check: By TXPOWID (if available)
    function checkByTxPoWID() {
        if (msg.txpowid) {
            var safeTxPow = escapeSql(msg.txpowid);
            var txCheckSql = "SELECT * FROM CHAT_MESSAGES WHERE txpowid='" + safeTxPow + "'";

            MDS.sql(txCheckSql, function (res) {
                if (res.status && res.rows && res.rows.length > 0) {
                    // Exact match found by ID - skip
                    processHistoryMessage(safePubkey, messages, index + 1);
                } else {
                    // Not found by ID - Fallback to Content/Time check
                    checkByContentAndTime();
                }
            });
        } else {
            // No ID - direct check by Content/Time
            checkByContentAndTime();
        }
    }

    // 2. Second Check: By Content & Time (Fallback)
    function checkByContentAndTime() {
        // Use original_timestamp if available, else date
        // Note: 'timestamp' variable holds msg.date which IS the original timestamp for history messages
        var checkTime = msg.original_timestamp || timestamp;

        var minTime = checkTime - 60000; // 60 second window (increased to handle network/block latency)
        var maxTime = checkTime + 60000;
        var checkSql = "";

        if (isIncoming) {
            checkSql = "SELECT * FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "' AND username!='Me' " +
                "AND (original_timestamp BETWEEN " + minTime + " AND " + maxTime + " OR date BETWEEN " + minTime + " AND " + maxTime + ") " +
                "AND message='" + content + "'";
        } else {
            checkSql = "SELECT * FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "' AND username='Me' " +
                "AND (original_timestamp BETWEEN " + minTime + " AND " + maxTime + " OR date BETWEEN " + minTime + " AND " + maxTime + ") " +
                "AND message='" + content + "'";
        }

        MDS.sql(checkSql, function (res) {
            if (res.status && res.rows && res.rows.length > 0) {
                // Found by content! Update it if we have a txpowid to attach
                if (msg.txpowid) {
                    tryUpdate(res.rows[0].ID);
                } else {
                    processHistoryMessage(safePubkey, messages, index + 1);
                }
            } else {
                // Not found by either method -> Insert
                tryInsert();
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
            res.rows.forEach(function (row) {
                MDS.log("🔄 [HISTORY-SYNC] Requesting history from: " + row.PUBLICKEY.substring(0, 20) + "...");
                // Pass both publickey and address to increase success rate
                requestChatHistory(row.PUBLICKEY, row.ADDRESS);
            });
        } else {
            MDS.log("❌ [HISTORY-SYNC] SQL query failed: " + (res.error || "Unknown error"));
        }
    });
}

function requestChatHistory(toPublicKey, toAddress) {
    var payload = {
        message: "",
        type: "chat_history_request",
        username: "Me",
        filedata: "",
        timestamp: Date.now() - (7 * 24 * 60 * 60 * 1000)
    };

    var jsonStr = JSON.stringify(payload);
    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    // Use specific address if known, otherwise fall back to resolution logic
    if (toAddress && (toAddress.startsWith('Mx') || toAddress.startsWith('MX'))) {
        // Use new robust cleaner
        var cleanAddress = cleanMaximaAddress(toAddress);

        // EXTRA DEBUG: Log address transformation
        MDS.log("🔍 [ADDR-DEBUG] Raw: '" + toAddress + "' -> Clean: '" + cleanAddress + "'");

        var sendCmd = 'maxima action:send to:' + cleanAddress + ' application:metachain data:' + hexData + ' poll:false';

        // DEBUG: Print EXACT command to see what Minima receives
        MDS.log("🔍 [CMD-DEBUG-V3] " + sendCmd);

        MDS.cmd(sendCmd, function (res) {
            if (!res.status) {
                MDS.log("⚠️ [HISTORY-SYNC] Failed to ask via address " + cleanAddress.substring(0, 10) + " Err: " + res.error);
            }
        });
    } else {
        // Fallback to resolving via DB or publickey
        resolveAndSend(toPublicKey, hexData, "HISTORY-SYNC", false);
    }
}

// Helper to clean Maxima Address specifically for the port issue
function cleanMaximaAddress(addr) {
    if (!addr) return "";

    // 1. Basic trim
    var s = String(addr).trim();

    // 2. CRITICAL: Remove ALL whitespace characters first (spaces, tabs, newlines, etc.)
    // This prevents Java NumberFormatException when parsing port numbers
    s = s.replace(/\s+/g, "");

    // 3. Split by Last Colon (Host:Port)
    var idx = s.lastIndexOf(":");

    if (idx !== -1) {
        var base = s.substring(0, idx);
        var port = s.substring(idx + 1);

        // 4. AGGRESSIVE CLEANING
        // Remove all whitespace and invalid chars from base
        // Allow: a-z A-Z 0-9 @ . - _ 
        var cleanBase = base.replace(/[^a-zA-Z0-9@._-]/g, "");

        // Remove everything except numbers from port
        var cleanPort = port.replace(/[^0-9]/g, "");

        // Log deep debug if it looked suspicious
        if (cleanBase !== base || cleanPort !== port) {
            MDS.log("🔍 [ADDR-FIX-V3] Cleaned: '" + addr + "' -> '" + cleanBase + ":" + cleanPort + "'");
        }

        if (cleanBase && cleanPort) {
            return cleanBase + ":" + cleanPort;
        }
    }

    // Fallback: Just remove all whitespace and invalid chars
    return s.replace(/\s/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "");
}

// Helper for Robust Sending (Resolves Address)
function resolveAndSend(pubkey, hexData, logTag, usePoll) {
    var pollStr = usePoll ? " poll:true" : " poll:false";

    // Clean key
    var safeKey = pubkey.replace(/'/g, "''");

    var peerSql = "SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='" + safeKey + "' AND ADDRESS IS NOT NULL LIMIT 1";

    MDS.sql(peerSql, function (peerRes) {
        var sendCmd;
        if (peerRes && peerRes.status && peerRes.count > 0) {
            var rawMx = peerRes.rows[0].ADDRESS;
            // Use new robust cleaner
            var mxAddress = rawMx ? cleanMaximaAddress(rawMx) : null;

            if (mxAddress && (mxAddress.startsWith('Mx') || mxAddress.startsWith('MX'))) {
                sendCmd = 'maxima action:send to:' + mxAddress + ' application:metachain data:' + hexData + pollStr;
                MDS.log("🔍 [CMD-DEBUG-RES] " + sendCmd);
            } else {
                sendCmd = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + pollStr;
                MDS.log("🔍 [CMD-DEBUG-RES] " + sendCmd); // Log for publickey fallback as well
            }
        } else {
            sendCmd = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + pollStr;
            MDS.log("🔍 [CMD-DEBUG-RES] " + sendCmd); // Log for no peer address found
        }

        MDS.cmd(sendCmd, function (res) {
            if (res.status) {
                MDS.log("✅ [" + logTag + "] Sent to " + pubkey.substring(0, 10));
            } else {
                MDS.log("⚠️ [" + logTag + "] Failed send: " + res.error);
            }
        });
    });
}

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

                // Send report back via Maxima
                MDS.cmd("maxima action:send publickey:" + fromKey + " application:metachain data:" + JSON.stringify(reportPayload) + " poll:false", function (sendRes) {
                    if (sendRes.status) MDS.log("✅ [SMART-SYNC] Sent status report to " + fromKey.substring(0, 10));
                });
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

    // Store this 'gap' state potentially?
    // For now, let's trigger the 'gap detected' flow we already have?
    // OR just emit an event so the frontend knows.

    // If we are missing messages, we should probably just ask for them immediately if it's a small number?
    // User plan says: "Phase 1: Chat List updates... without downloading".
    // So we just need to notify the Frontend.

    // We can use 'peer_updated' or a new 'sync_state_update' event.
    // Let's send a specific event the Frontend can listen to relative to this peer.
    // Actually, we can reuse 'chat_history_response' type logic to just push a "meta" message? 
    // No, cleaner to keep it separate.

    // We will just log it for now as per Phase 1 reqs (UI implementation is next).
    // BUT, let's be proactive: If the gap is small (< 50), auto-fetch immediately?
    // The user said "Global Sync Check... Chat List updates... without downloading".
    // So we strictly wait for Phase 2 (Lazy Sync) to fetch.

    // We send this to frontend via NEWBLOCK or just rely on 'notifyNewMessage' in MinimaService which listens to Maxima?
    // 'minima.service.ts' processes all incoming Maxima messages.
    // So if we just let this message pass through to 'minima.service.ts', it will be dispatched to UI.
    // PERFECT. We don't need to do anything here if 'minima.service.ts' handles generic types.
    // Checking 'minima.service.ts'... it filters specific types. 
    // We need to add 'sync_status_report' to 'minima.service.ts'.
}
