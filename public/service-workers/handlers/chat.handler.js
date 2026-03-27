/**
 * MetaChain Service Worker - Chat Message Handler
 * Handles chat messages, read receipts, pings, pongs
 */

var LAST_PONG_SENT = {};
var PONG_THROTTLE_MS = 30000;

function handleChatMessage(pubkey, maxjson) {
  MDS.log(
    "💬 [CHAT-DEBUG] RAW INCOMING from " +
    pubkey +
    ": " +
    JSON.stringify(maxjson),
  );
  MDS.log(
    "💬 [CHAT] From: " +
    pubkey +
    " - " +
    (maxjson.message || "").substring(0, 30),
  );

  var now = Date.now();
  var safePubkey = escapeSql(pubkey);
  var safeUsername = escapeSql(maxjson.username || "Unknown");
  var safeMessage = escapeSql(maxjson.message || "");
  var safeFiledata = escapeSql(maxjson.filedata || "");
  var msgType = maxjson.type || "text";
  var amount = maxjson.amount || 0;
  var senderSeq = maxjson.seq ? parseInt(maxjson.seq) : 0; // SEQUENCE TRACKING
  var customid = maxjson.customid ? escapeSql(maxjson.customid) : "0x00";
  var transportDelay =
    maxjson.timestamp && parseInt(maxjson.timestamp) > 0
      ? now - parseInt(maxjson.timestamp)
      : -1;
  var forwarded =
    maxjson.forwarded === true ||
    maxjson.forwarded === "true" ||
    maxjson.forwarded === 1;

  MDS.log(
    "⏱️ [CHAT-LATENCY] customid=" +
    customid +
    " seq=" +
    senderSeq +
    " delay_ms=" +
    transportDelay,
  );

  // 1. CHECK IF BLOCKED
  var checkBlockSql =
    "SELECT blocked FROM CHAT_STATUS WHERE UPPER(publickey)=UPPER('" + safePubkey + "')";
  MDS.sql(checkBlockSql, function (blockRes) {
    var isBlocked = false;
    if (blockRes.status && blockRes.rows && blockRes.rows.length > 0) {
      var val = blockRes.rows[0].BLOCKED;
      isBlocked = val === true || val === "TRUE" || val === "true" || val === 1;
    }

    if (isBlocked) {
      MDS.log(
        "🚫 [CHAT] Message BLOCKED from: " +
        safeUsername +
        " (" +
        safePubkey +
        ")",
      );
      return; // Abort insertion
    } else {
      MDS.log("✅ [CHAT-DEBUG] Block check passed for " + safeUsername);
    }

    // GAP DETECTION LOGIC
    // Only run if we have a valid sequence number > 1 (1 is start)
    if (senderSeq > 1) {
      // Check the last sequence number we have from this sender
      var seqSql =
        "SELECT MAX(sender_seq) as last_seq FROM CHAT_MESSAGES WHERE UPPER(publickey)=UPPER('" +
        safePubkey +
        "')";
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
          MDS.log(
            "⚠️ [GAP-DETECT] Sequence gap detected from " +
            safeUsername +
            " (Seq: " +
            senderSeq +
            ", Last: " +
            lastSeq +
            ", Missing: " +
            gapSize +
            ")",
          );

          // Trigger sync - use existing solo comms or direct function call if available
          if (typeof requestChatHistory === "function") {
            MDS.log("🔄 [GAP-FILL] Triggering sync to fill gap...");
            requestChatHistory(pubkey);
          }
        }
      });
    }

    // 2. Insert message to DB if not blocked
    var txpowid = maxjson.txpowid ? escapeSql(maxjson.txpowid) : null;
    var initialState = txpowid ? "sent" : "received"; // 'sent' triggers blink on receiver side if txpowid exists
    var txpowidVal = txpowid ? "'" + txpowid + "'" : "NULL";
    var originalTimestamp = maxjson.timestamp ? maxjson.timestamp : 0;
    // PERSIST CUSTOM ID (already normalized above)

    // CRITICAL FIX: Only store if we don't already have it
    // We check BOTH txpowid (if available) AND time window simultaneously to ensure we catch duplicates
    // even if one identifier is missing or slightly different.
    var checkDup =
      "SELECT COUNT(*) as count FROM CHAT_MESSAGES WHERE UPPER(publickey)=UPPER('" +
      safePubkey +
      "')";
    var conditions = [];

    // 1. Check by TxPoWID (Strongest check)
    if (txpowid) {
      conditions.push("txpowid='" + txpowid + "'");
    }

    // 2. Check by Time Window & Content (Fuzzy check for 60s window)
    // Checks against both original_timestamp (sender time) and date (local time)
    var minTime = originalTimestamp - 60000;
    var maxTime = originalTimestamp + 60000;
    var timeCondition =
      "message='" +
      safeMessage +
      "' AND (" +
      "(original_timestamp >= " +
      minTime +
      " AND original_timestamp <= " +
      maxTime +
      ") OR " +
      "(date >= " +
      minTime +
      " AND date <= " +
      maxTime +
      "))";
    conditions.push("(" + timeCondition + ")");

    // Combine with OR
    if (conditions.length > 0) {
      checkDup += " AND (" + conditions.join(" OR ") + ")";
    }

    MDS.log("🔍 [DEDUP-LIVE] Checking for duplicates with SQL: " + checkDup);

    MDS.sql(checkDup, function (dupRes) {
      if (dupRes.status && dupRes.rows && dupRes.rows[0].COUNT > 0) {
        MDS.log(
          "♻️ [CHAT] Ignoring duplicate message from " +
          safeUsername +
          " (already exists in DB)",
        );

        // CRITICAL FIX: Even if duplicate, UPDATE sender_seq if it's currently 0 or NULL
        // This fixes ordering if the message was first added via history sync (which might have lacked seq)
        if (maxjson.seq && maxjson.seq > 0) {
          var updateSeqSql =
            "UPDATE CHAT_MESSAGES SET sender_seq=" +
            maxjson.seq +
            " WHERE UPPER(publickey)=UPPER('" +
            safePubkey +
            "') AND (" +
            conditions.join(" OR ") +
            ")" +
            " AND (sender_seq IS NULL OR sender_seq = 0)";
          MDS.sql(updateSeqSql, function (res) {
            if (res.status && res.rowsAffected > 0) {
              MDS.log(
                "🔄 [CHAT] Updated sequence for duplicate message to: " +
                maxjson.seq,
              );
            }
          });
        }
        return;
      } else {
        MDS.log("✨ [CHAT-DEBUG] No duplicate found. Proceeding to INSERT...");
      }

      var forwardedVal = forwarded ? 1 : 0;
      var insertSql =
        "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, sender_seq, customid, forwarded) " +
        "VALUES ('', UPPER('" +
        safePubkey +
        "'), '" +
        safeUsername +
        "', '" +
        msgType +
        "', '" +
        safeMessage +
        "', '" +
        safeFiledata +
        "', '" +
        initialState +
        "', " +
        amount +
        ", " +
        (originalTimestamp || now) +
        ", " +
        txpowidVal +
        ", " +
        originalTimestamp +
        ", " +
        senderSeq +
        ", '" +
        customid +
        "', " +
        forwardedVal +
        ")";

      MDS.sql(insertSql, function (res) {
        if (res.status) {
          MDS.log("✅ [CHAT] Message saved successfully: { from: " + safeUsername + ", customid: " + customid + " }");

          // 3. NOTIFY FRONTEND (Immediate Sync)
          // This triggers a UI refresh now that the message is safely in the DB
          // We send the full payload to avoid an immediate DB re-query (Event-driven UI)
          var soloPayload = {
            type: "NEW_CHAT_MESSAGE",
            message: {
              roomname: "",
              publickey: pubkey,
              username: maxjson.username || "Unknown",
              type: msgType,
              message: maxjson.message || "",
              filedata: maxjson.filedata || "",
              state: initialState,
              amount: amount,
              date: originalTimestamp || now,
              txpowid: maxjson.txpowid || null,
              original_timestamp: originalTimestamp,
              sender_seq: senderSeq,
              customid: maxjson.customid || "0x00",
              forwarded: forwarded
            }
          };
          MDS.log("📡 [CHAT] Emitting NEW_CHAT_MESSAGE signal to Frontend...");
          MDS.comms.solo(JSON.stringify(soloPayload));

          // Also send legacy signal for broad compatibility with list views
          MDS.comms.solo("CHAT_LIST_UPDATE");

          // FIX: Auto-discover user on message receipt to fix "Unknown" in chat list
          if (
            safeUsername &&
            safeUsername !== "Unknown" &&
            safeUsername !== "System"
          ) {
            var safeAvatar = escapeSql(maxjson.avatar || "");
            var safeAddress = escapeSql(maxjson.from_address || "");

            // Proactively DELETE the old entry before merging to ensure a clean state with the fresh validated address.
            var delPeer = "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + safePubkey + "')";
            var insPeer =
              "INSERT INTO DISCOVERED_PEERS (publickey, alias, avatar, address, last_seen, source, allow_non_contact_chats) " +
              "VALUES (UPPER('" +
              safePubkey +
              "'), '" +
              safeUsername +
              "', '" +
              safeAvatar +
              "', '" +
              safeAddress +
              "', " +
              now +
              ", 'MSG', 1)";
              
            MDS.sql(delPeer, function() {
              MDS.sql(insPeer, function (pRes) {
                if (pRes.status) {
                  MDS.log("👤 [CHAT] Auto-discovered peer (Fresh IP): " + safeUsername);
                } else {
                  MDS.log("⚠️ [CHAT] Failed to auto-discover peer: " + pRes.error);
                }
              });
            });
          }

          // 3. SEND DELIVERY RECEIPT (New Logic)
          sendDeliveryReceipt(pubkey);
        } else {
          MDS.log("❌ [CHAT] Save failed: " + res.error + " | SQL: " + insertSql);
        }
      });
    });
  });
}

// Helper to send delivery receipt from Service Worker
function sendDeliveryReceipt(toPublicKey) {
  // Prevent sending receipts to self or system
  if (toPublicKey === "Me" || toPublicKey === "System") return;

  var payload = {
    message: "",
    type: "delivery_receipt",
    username: "Me",
    filedata: "",
  };

  var jsonStr = JSON.stringify(payload);
  var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

  // Use smart Address Resolution for non-contacts
  smartSend(toPublicKey, "metachain", hexData, "DELIVERY", false);
}

function handleReadReceipt(pubkey) {
  MDS.log("📖 [READ-RECEIPT] Received from " + pubkey);
  var safePubkey = escapeSql(pubkey);
  // Update 'sent' OR 'delivered' messages to 'read'.
  // Exclude 'pending' (not sent yet), 'failed' AND 'confirmed' (final state for transactions).
  // CRITICAL FIX: Do not overwrite 'confirmed' state with 'read'.
  // CRITICAL FIX 2: Only update TEXT messages. Token/Charm transactions should NOT go to 'read' state.
  var sql =
    "UPDATE CHAT_MESSAGES SET state='read' WHERE UPPER(publickey)=UPPER('" +
    safePubkey +
    "') AND username='Me' AND type='text' AND state!='pending' AND state!='failed' AND state!='read' AND state!='confirmed'";
  MDS.sql(sql);
}

function handleDeliveryReceipt(pubkey) {
  MDS.log("📬 [DELIVERY-RECEIPT] Received from " + pubkey);
  var safePubkey = escapeSql(pubkey);
  // Update 'sent' messages to 'delivered'.
  // Do NOT overwrite 'read' status (as read > delivered).
  var sql =
    "UPDATE CHAT_MESSAGES SET state='delivered' WHERE UPPER(publickey)=UPPER('" +
    safePubkey +
    "') AND username='Me' AND state='sent'";
  MDS.sql(sql);
}

function handlePing(pubkey) {
  var safeKey = (pubkey || "").trim();
  if (!safeKey) return;

  var now = Date.now();
  var lastSent = LAST_PONG_SENT[safeKey] || 0;
  if (now - lastSent < PONG_THROTTLE_MS) {
    return;
  }
  LAST_PONG_SENT[safeKey] = now;

  MDS.log("📡 [PING] Received from " + safeKey);

  var payload = {
    message: "",
    type: "pong",
    username: "Me",
    filedata: "",
  };

  var jsonStr = JSON.stringify(payload);
  var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

  // Smart Address Resolution for Non-Contacts
  smartSend(safeKey, "metachain", hexData, "PONG", false);
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
      since = Date.now() - 7 * 24 * 60 * 60 * 1000;
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

    var sql =
      "SELECT * FROM CHAT_MESSAGES WHERE publickey='" +
      safePubkey +
      "' " +
      "AND (type='text' OR type='token' OR type='charm') " +
      "AND date > " +
      since +
      " " +
      "ORDER BY date ASC LIMIT 100"; // Lower limit to 100 to ensure payload is manageable

    MDS.sql(sql, function (res) {
      if (res.status && res.rows) {
        MDS.log(
          "🔄 [HISTORY-REQ] Found " +
          res.count +
          " messages for " +
          pubkey.substring(0, 10),
        );

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
            forwarded: row.FORWARDED === 1 || row.forwarded === 1,
          };
        });

        // Send response back even if empty, so client knows sync happened
        sendChatHistoryResponse(pubkey, messages);
      } else {
        MDS.log(
          "🔄 [HISTORY-REQ] No messages found (SQL success but no rows?)",
        );
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
    timestamp: Date.now(),
  };

  var jsonStr = JSON.stringify(payload);
  var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

  // Log the size
  MDS.log(
    "🔄 [HISTORY-RESP] Sending response size: " +
    hexData.length +
    " chars to " +
    toPubkey.substring(0, 10),
  );

  // Smart Address Resolution with Fallback
  smartSend(toPubkey, "metachain", hexData, "HISTORY-RESP", false);
}

var _historyProcessingLock = {};

function handleChatHistoryResponse(pubkey, maxjson) {
  // Prevent parallel processing for the same peer (race condition causes duplicates)
  if (_historyProcessingLock[pubkey]) {
    MDS.log("⏭️ [HISTORY-RESP] Already processing history from " + pubkey.substring(0, 10) + ", skipping duplicate response");
    return;
  }
  _historyProcessingLock[pubkey] = true;

  var messages = maxjson.messages;
  if (!messages || messages.length === 0) {
    MDS.log("🔄 [HISTORY-RESP] Received empty history from " + pubkey);
    delete _historyProcessingLock[pubkey];
    return;
  }

  MDS.log(
    "🔄 [HISTORY-RESP] Processing " +
    messages.length +
    " messages from " +
    pubkey,
  );
  var safePubkey = escapeSql(pubkey);
  processHistoryMessage(safePubkey, pubkey, messages, 0);
}

function processHistoryMessage(safePubkey, originalPubkey, messages, index) {
  if (index >= messages.length) {
    MDS.log("✅ [HISTORY-RESP] Completed processing batch");
    // Release lock so future history responses from this peer can be processed
    if (originalPubkey) delete _historyProcessingLock[originalPubkey];
    MDS.comms.solo("CHAT_LIST_UPDATE");
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

  if (msg.username === "Me") {
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
      MDS.sql(
        "SELECT alias FROM DISCOVERED_PEERS WHERE publickey='" +
        safePubkey +
        "'",
        function (res) {
          var resolvedName = "Contact";
          if (res.status && res.rows && res.rows.length > 0) {
            resolvedName = escapeSql(
              res.rows[0].ALIAS || res.rows[0].alias || "Contact",
            );
          }

          var forwardedVal = msg.forwarded ? 1 : 0;
          var insertSql =
            "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, customid, sender_seq, forwarded) " +
            "VALUES ('', '" +
            safePubkey +
            "', '" +
            resolvedName +
            "', '" +
            type +
            "', '" +
            content +
            "', '" +
            safeFiledata +
            "', '" +
            state +
            "', " +
            amount +
            ", " +
            timestamp +
            ", " +
            txpowidVal +
            ", " +
            timestamp +
            ", '" +
            safeCustomId +
            "', " +
            senderSeq +
            ", " +
            forwardedVal +
            ")";

          MDS.sql(insertSql, function (insRes) {
            if (insRes.status) {
              MDS.log(
                "✅ [HISTORY-SYNC] Recovered message from " +
                resolvedName +
                ": " +
                content.substring(0, 20),
              );
            } else {
              // Fallback log if insert fails
              MDS.log("❌ [HISTORY-SYNC] Insert failed: " + insRes.error);
            }
            processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
          });
        },
      );
      return; // EXIT here, async SQL handles the recursion
    }

    var forwardedVal = msg.forwarded ? 1 : 0;
    var insertSql =
      "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, customid, sender_seq, forwarded) " +
      "VALUES ('', '" +
      safePubkey +
      "', '" +
      finalUsername +
      "', '" +
      type +
      "', '" +
      content +
      "', '" +
      safeFiledata +
      "', '" +
      state +
      "', " +
      amount +
      ", " +
      timestamp +
      ", " +
      txpowidVal +
      ", " +
      timestamp +
      ", '" +
      safeCustomId +
      "', " +
      senderSeq +
      ", " +
      forwardedVal +
      ")";

    MDS.sql(insertSql, function (insRes) {
      if (insRes.status) {
        MDS.log(
          "✅ [HISTORY-SYNC] Recovered message: " + content.substring(0, 20),
        );
      }
      processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
    });
  };

  var tryUpdate = function (existingId) {
    if (!msg.txpowid) {
      processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
      return;
    }

    var newState = msg.state || "read";
    var safeTxPow = escapeSql(msg.txpowid);
    var updateSql =
      "UPDATE CHAT_MESSAGES SET txpowid='" +
      safeTxPow +
      "', state='" +
      newState +
      "' WHERE id=" +
      existingId;

    MDS.sql(updateSql, function (updRes) {
      MDS.log(
        "♻️ [HISTORY-SYNC] Updated existing message ID " +
        existingId +
        " with txpowid/state",
      );
      processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
    });
  };

  // 0. Primary Check: By CustomID (UUID)
  if (msg.customid && msg.customid !== "0x00") {
    var safeCustomId = escapeSql(msg.customid);
    var customCheck =
      "SELECT * FROM CHAT_MESSAGES WHERE customid='" + safeCustomId + "'";
    MDS.sql(customCheck, function (res) {
      if (res.status && res.rows && res.rows.length > 0) {
        // Found by UUID!
        if (msg.txpowid) {
          tryUpdate(res.rows[0].ID);
        } else {
          processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
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
      var txCheckSql =
        "SELECT * FROM CHAT_MESSAGES WHERE txpowid='" + safeTxPow + "'";

      MDS.sql(txCheckSql, function (res) {
        if (res.status && res.rows && res.rows.length > 0) {
          // Exact match found by ID - skip
          processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
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
      // Incoming messages: match by timestamp + type only (message content may include/exclude tokenid)
      checkSql =
        "SELECT * FROM CHAT_MESSAGES WHERE publickey='" +
        safePubkey +
        "' AND username!='Me' " +
        "AND type='" + type + "' " +
        "AND (original_timestamp BETWEEN " +
        minTime +
        " AND " +
        maxTime +
        " OR date BETWEEN " +
        minTime +
        " AND " +
        maxTime +
        ")";
    } else {
      // Outgoing messages: match by timestamp + type only (message content may differ, e.g. tokenid present in one but not the other)
      checkSql =
        "SELECT * FROM CHAT_MESSAGES WHERE publickey='" +
        safePubkey +
        "' AND username='Me' " +
        "AND type='" + type + "' " +
        "AND (original_timestamp BETWEEN " +
        minTime +
        " AND " +
        maxTime +
        " OR date BETWEEN " +
        minTime +
        " AND " +
        maxTime +
        ")";
    }

    MDS.sql(checkSql, function (res) {
      if (res.status && res.rows && res.rows.length > 0) {
        // Found by content! Update it if we have a txpowid to attach
        if (msg.txpowid) {
          tryUpdate(res.rows[0].ID);
        } else {
          processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
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

  var sql =
    "SELECT publickey, address FROM DISCOVERED_PEERS WHERE source != 'SELF' ORDER BY last_seen DESC LIMIT 20";

  MDS.sql(sql, function (res) {
    MDS.log("🔍 [HISTORY-SYNC-DEBUG] SQL result status: " + res.status);
    if (res.status && res.rows && res.rows.length > 0) {
      MDS.log("🔄 [HISTORY-SYNC] Syncing with " + res.rows.length + " contacts from DISCOVERED_PEERS");
      res.rows.forEach(function (row) {
        MDS.log("🔄 [HISTORY-SYNC] Requesting history from: " + row.PUBLICKEY.substring(0, 20) + "...");
        requestChatHistory(row.PUBLICKEY, row.ADDRESS);
      });
    } else {
      // DISCOVERED_PEERS is empty at startup — fall back to CHAT_MESSAGES for known contacts
      MDS.log("⚠️ [HISTORY-SYNC] DISCOVERED_PEERS empty, falling back to CHAT_MESSAGES contacts...");
      var fallbackSql =
        "SELECT DISTINCT publickey FROM CHAT_MESSAGES WHERE publickey IS NOT NULL AND publickey != '' ORDER BY date DESC LIMIT 20";
      MDS.sql(fallbackSql, function (fbRes) {
        if (!fbRes.status || !fbRes.rows || fbRes.rows.length === 0) {
          MDS.log("⚠️ [HISTORY-SYNC] No contacts in CHAT_MESSAGES either, skipping startup sync");
          return;
        }
        MDS.log("🔄 [HISTORY-SYNC] Syncing with " + fbRes.rows.length + " contacts from CHAT_MESSAGES");
        fbRes.rows.forEach(function (row) {
          MDS.log("🔄 [HISTORY-SYNC] Requesting history from: " + row.PUBLICKEY.substring(0, 20) + "...");
          // No address available — smartSend will resolve via DB/publickey
          requestChatHistory(row.PUBLICKEY, null);
        });
      });
    }
  });
}

function requestChatHistory(toPublicKey, toAddress) {
  var payload = {
    message: "",
    type: "chat_history_request",
    username: "Me",
    filedata: "",
    timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000,
  };

  var jsonStr = JSON.stringify(payload);
  var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

  // Use specific address if known, otherwise fall back to resolution logic
  if (toAddress && (toAddress.startsWith("Mx") || toAddress.startsWith("MX"))) {
    // Use new robust cleaner
    var cleanAddress = cleanMaximaAddress(toAddress);

    // EXTRA DEBUG: Log address transformation
    MDS.log(
      "🔍 [ADDR-DEBUG] Raw: '" +
      toAddress +
      "' -> Clean: '" +
      cleanAddress +
      "'",
    );

    var sendCmd =
      "maxima action:send to:" +
      cleanAddress +
      " application:metachain data:" +
      hexData +
      " poll:false";

    // DEBUG: Print EXACT command to see what Minima receives
    MDS.log("🔍 [CMD-DEBUG-V3] " + sendCmd);

    MDS.cmd(sendCmd, function (res) {
      if (!res.status) {
        MDS.log(
          "⚠️ [HISTORY-SYNC] Failed to ask via address " +
          cleanAddress.substring(0, 10) +
          " Err: " +
          res.error,
        );
      }
    });
  } else {
    // Fallback to resolving via DB or publickey
    smartSend(toPublicKey, "metachain", hexData, "HISTORY-SYNC", false);
  }
}

// (cleanMaximaAddress and smartSend are provided by utils.js)

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

  var safeFromKey = escapeSql(fromKey);
  var sql =
    "SELECT next_seq FROM MESSAGE_COUNTERS WHERE UPPER(publickey)=UPPER('" +
    safeFromKey +
    "')";
  MDS.sql(sql, function (res) {
    var counterNextSeq = res.rows && res.rows.length > 0 ? res.rows[0].NEXT_SEQ : null;

    // If MESSAGE_COUNTERS has no row (or next_seq=1 which means no messages sent),
    // fall back to MAX(sender_seq) from CHAT_MESSAGES for outgoing messages to this contact.
    if (counterNextSeq !== null && counterNextSeq > 1) {
      // Counter row found and non-trivial — use it directly
      finishSyncCheck(counterNextSeq - 1);
    } else {
      var fallbackSql =
        "SELECT MAX(sender_seq) as max_seq FROM CHAT_MESSAGES WHERE UPPER(publickey)=UPPER('" +
        safeFromKey +
        "') AND state IN ('sent','delivered','read')";
      MDS.sql(fallbackSql, function (fbRes) {
        var maxSenderSeq = fbRes.rows && fbRes.rows.length > 0 ? (parseInt(fbRes.rows[0].MAX_SEQ) || 0) : 0;
        if (maxSenderSeq > 0) {
          MDS.log("🔄 [SMART-SYNC] No counter row, using CHAT_MESSAGES fallback: max_seq=" + maxSenderSeq);
        }
        finishSyncCheck(maxSenderSeq);
      });
    }

    function finishSyncCheck(myLastSentSeq) {
    var peerLastSeqNum = parseInt(peerLastSeq) || 0;

    MDS.log(
      "🔄 [SMART-SYNC] Check from " +
      fromKey.substring(0, 10) +
      ". Their last: " +
      peerLastSeqNum +
      ", My last sent: " +
      myLastSentSeq,
    );

    if (myLastSentSeq > peerLastSeqNum) {
      var missingCount = myLastSentSeq - peerLastSeqNum;
      MDS.log("⚠️ [SMART-SYNC] Peer is missing " + missingCount + " messages.");

      // Optimization: Get preview of the very last message to show in their UI
      // We find the message with highest ID sent to them?
      // We don't strictly index our sent 'seq' in CHAT_MESSAGES yet (we just send it).
      // We might need to query by date DESC.
      var previewSql =
        "SELECT message, date, type FROM CHAT_MESSAGES WHERE publickey='" +
        escapeSql(fromKey) +
        "' AND state IN ('sent','delivered','read') ORDER BY date DESC LIMIT 1";

      MDS.sql(previewSql, function (pRes) {
        var lastMsg = pRes.rows && pRes.rows.length > 0 ? pRes.rows[0] : null;

        var reportPayload = {
          type: "sync_status_report",
          missing_count: missingCount,
          my_highest_seq: myLastSentSeq,
          last_message_preview: lastMsg
            ? {
              text:
                lastMsg.TYPE === "text"
                  ? lastMsg.MESSAGE
                  : "[" + lastMsg.TYPE + "]",
              timestamp: lastMsg.DATE,
            }
            : null,
        };

        // Send report back via Maxima with Address Resolution
        var hexData = "0x" + utf8ToHex(JSON.stringify(reportPayload)).toUpperCase();
        smartSend(fromKey, "metachain", hexData, "SMART-SYNC", false);
      });
    } else {
      MDS.log("✅ [SMART-SYNC] Peer is up to date.");
    }
    } // end finishSyncCheck
  }); // end outer MESSAGE_COUNTERS MDS.sql
}

/**
 * Handle incoming sync status report (PHASE 1 Response)
 * Peer says: "You are missing X messages. Last one was 'Hello'"
 * We action: Update UI to show "Unread/Syncing" state? or Trigger fetch?
 * For Phase 1: Just Log and maybe emit event for UI.
 * For Phase 2: This will auto-trigger 'sync_data_request'
 */
function handleSyncStatusReport(msg, fromKey) {
  MDS.log(
    "📊 [SMART-SYNC] Report from " +
    fromKey.substring(0, 10) +
    ": Missing " +
    msg.missing_count +
    " messages.",
  );

  // Emit the report to the frontend so minima.service.ts can present it to the UI
  var payload = {
    type: "sync_status_report",
    missing_count: msg.missing_count,
    fromKey: fromKey,
    last_message_preview: msg.last_message_preview,
  };
  MDS.comms.solo(JSON.stringify(payload));
}
