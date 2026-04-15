/**
 * MetaChain Service Worker - Group Message Handler
 * Handles group messages, invites, member updates
 */

/**
 * Periodic beacon: announces our current Mx address to all members of all our groups.
 * This keeps DISCOVERED_PEERS fresh even when Maxima addresses rotate.
 */
function sendGroupAddressBeacon() {
  MDS.cmd("maxima action:info", function (maxInfo) {
    if (!maxInfo.status) return;

    var myPubkey = maxInfo.response.publickey;
    var myAddress = maxInfo.response.contact;
    var myName = maxInfo.response.name || "Unknown";

    if (!myAddress) return;

    // Find all distinct group members across all groups — excluding ourselves
    var memberSql =
      "SELECT DISTINCT publickey FROM GROUP_MEMBERS WHERE UPPER(publickey) != UPPER('" +
      myPubkey +
      "')";
    MDS.sql(memberSql, function (res) {
      if (!res.status || !res.rows || res.rows.length === 0) return;

      var beaconPayload = {
        app: "metachain-group",
        messageType: "group_address_beacon",
        senderPublickey: myPubkey,
        senderUsername: myName,
        senderAddress: myAddress,
        timestamp: Date.now(),
      };
      var hexData =
        "0x" + utf8ToHex(JSON.stringify(beaconPayload)).toUpperCase();

      for (var i = 0; i < res.rows.length; i++) {
        var memberPk = res.rows[i].PUBLICKEY;

        // Look up their current address
        var peerSql =
          "SELECT address FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
          escapeSql(memberPk) +
          "') LIMIT 1";
        MDS.sql(
          peerSql,
          (function (pk) {
            return function (peerRes) {
              if (peerRes.status && peerRes.rows && peerRes.rows.length > 0) {
                var addr = peerRes.rows[0].ADDRESS || peerRes.rows[0].address;
                if (addr) {
                  var cleanAddr = cleanMaximaAddress(addr);
                  MDS.cmd(
                    "maxima action:send to:" +
                      cleanAddr +
                      " application:metachain-group data:" +
                      hexData +
                      " poll:false",
                  );
                }
              }
              // If no address known, skip (we'll learn it when they beacon back)
            };
          })(memberPk),
        );
      }
    });
  });
}

/**
 * Handles a group_address_beacon — seeds DISCOVERED_PEERS with the sender's fresh address.
 */
function handleGroupAddressBeacon(pubkey, maxjson) {
  if (!maxjson.senderAddress || !pubkey) return;

  var safePk = escapeSql(pubkey);
  var safeAddr = escapeSql(maxjson.senderAddress);
  var safeName = escapeSql(maxjson.senderUsername || "Unknown");
  var now = Date.now();

  var delSql =
    "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
    safePk +
    "')";
  MDS.sql(delSql, function () {
    var insSql =
      "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" +
      safePk +
      "', '" +
      safeAddr +
      "', 'GROUP_BEACON', '" +
      safeName +
      "', " +
      now +
      ", '')";
    MDS.sql(insSql);
  });
}

// ─── Sync state tracking ───────────────────────────────────────────────────
// _pendingSyncs[groupId] = {
//   syncId:     unique id for this sync session,
//   expected:   number of peers we asked,
//   pending:    { pubkey: true } — peers that haven't responded yet,
//   paginating: { pubkey: true } — peers fetching next pages,
//   retryCount: number,
//   startedAt:  Date.now() — used by checkSyncTimeouts() for elapsed-time checks
// }
// NOTE: Uses plain objects (no ES6 Set) and MDS_TIMER_10SECONDS event for timeouts
// (MDS.cmd("timer") callback fires immediately in Rhino — not usable for delays).
var _pendingSyncs = {};
var _syncIdCounter = 0;
var HISTORY_PAGE_SIZE = 50;
var HISTORY_SYNC_TIMEOUT_MS = 30000; // 30s timeout waiting for all peers
var HISTORY_SYNC_MAX_RETRIES = 2;

function _objSize(obj) {
  var count = 0;
  for (var k in obj) {
    if (obj.hasOwnProperty(k)) count++;
  }
  return count;
}

/**
 * Called when a peer finishes responding (no more pages).
 * Emits GROUP_SYNC_END only when ALL peers are done.
 */
function markSyncPeerDone(groupId, peerPubkey) {
  var sync = _pendingSyncs[groupId];
  if (!sync) return;

  var normPk = peerPubkey ? peerPubkey.toUpperCase() : peerPubkey;
  delete sync.pending[normPk];
  delete sync.paginating[normPk];
  var remaining = _objSize(sync.pending) + _objSize(sync.paginating);
  MDS.log(
    "🔄 [GROUP-SYNC] Peer done: " +
      peerPubkey.substring(0, 10) +
      " (" +
      remaining +
      " remaining)",
  );

  if (remaining === 0) {
    finishSync(groupId);
  }
}

function finishSync(groupId) {
  delete _pendingSyncs[groupId];
  MDS.log("✅ [GROUP-SYNC] Sync complete for " + groupId);
  MDS.comms.solo(
    JSON.stringify({
      type: "GROUP_SYNC_END",
      groupId: groupId,
    }),
  );
}

/**
 * Check all pending syncs for timeouts.
 * Called periodically from MDS_TIMER_10SECONDS event in main.js.
 * Uses Date.now() comparison instead of MDS.cmd("timer") which fires immediately.
 */
function checkSyncTimeouts() {
  var now = Date.now();
  for (var groupId in _pendingSyncs) {
    if (!_pendingSyncs.hasOwnProperty(groupId)) continue;
    var sync = _pendingSyncs[groupId];
    var elapsed = now - sync.startedAt;

    if (elapsed < HISTORY_SYNC_TIMEOUT_MS) continue;

    var pendingCount = _objSize(sync.pending);
    if (
      pendingCount === sync.expected &&
      sync.retryCount < HISTORY_SYNC_MAX_RETRIES
    ) {
      MDS.log(
        "⚠️ [GROUP-SYNC] No responses for " +
          groupId +
          " after " +
          elapsed +
          "ms. Retrying...",
      );
      delete _pendingSyncs[groupId];
      requestGroupHistoryFromSW(groupId, sync.retryCount + 1);
    } else {
      MDS.log(
        "⏱️ [GROUP-SYNC] Timeout for " +
          groupId +
          " (" +
          pendingCount +
          " peers still pending). Finishing.",
      );
      finishSync(groupId);
    }
  }
}

/**
 * SW-side group history request.
 * Sends a history_request to all known members of a group.
 * Guards against concurrent syncs for the same group.
 */
function requestGroupHistoryFromSW(groupId, retryCount) {
  retryCount = retryCount || 0;

  // Guard: if sync is already in progress for this group, skip
  if (_pendingSyncs[groupId] && retryCount === 0) {
    MDS.log(
      "ℹ️ [GROUP-SYNC] Sync already in progress for " + groupId + ". Skipping.",
    );
    return;
  }

  MDS.log(
    "🔄 [GROUP-SYNC] Requesting history for group " +
      groupId +
      " (attempt " +
      (retryCount + 1) +
      ")...",
  );

  // Signal sync start only on first attempt
  if (retryCount === 0) {
    MDS.comms.solo(
      JSON.stringify({
        type: "GROUP_SYNC_START",
        groupId: groupId,
      }),
    );
  }

  MDS.cmd("maxima action:info", function (maxInfo) {
    if (!maxInfo.status) return;
    var myPubkey = maxInfo.response.publickey;

    // Find the last message timestamp we have for this group
    var lastSql =
      "SELECT date FROM GROUP_MESSAGES WHERE group_id='" +
      escapeSql(groupId) +
      "' ORDER BY date DESC LIMIT 1";
    MDS.sql(lastSql, function (lastRes) {
      var lastTimestamp =
        lastRes.status && lastRes.rows && lastRes.rows.length > 0
          ? Number(lastRes.rows[0].DATE || lastRes.rows[0].date || 0)
          : 0;

      var requestPayload = {
        app: "metachain-group",
        messageType: "history_request",
        groupId: groupId,
        groupName: "SYNC",
        senderPublickey: myPubkey,
        senderUsername: "",
        timestamp: Date.now(),
        historySince: lastTimestamp,
      };
      var hexData =
        "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

      // Send to all known members via DISCOVERED_PEERS
      var memberSql =
        "SELECT gm.publickey, dp.address FROM GROUP_MEMBERS gm LEFT JOIN DISCOVERED_PEERS dp ON UPPER(gm.publickey)=UPPER(dp.publickey) WHERE gm.group_id='" +
        escapeSql(groupId) +
        "'";
      MDS.sql(memberSql, function (memberRes) {
        if (!memberRes.status || !memberRes.rows) {
          finishSync(groupId);
          return;
        }

        var pendingPeers = {};
        var peerCount = 0;
        for (var i = 0; i < memberRes.rows.length; i++) {
          var row = memberRes.rows[i];
          var memberPk = (row.PUBLICKEY || "").toUpperCase();
          if (memberPk === myPubkey.toUpperCase()) continue;
          smartSend(
            memberPk,
            "metachain-group",
            hexData,
            "GROUP-HISTORY-SYNC",
            false,
            row.ADDRESS,
          );
          pendingPeers[memberPk] = true;
          peerCount++;
        }

        if (peerCount === 0) {
          MDS.log("ℹ️ [GROUP-SYNC] No remote members to request history from.");
          finishSync(groupId);
          return;
        }

        // Track this sync with a unique syncId and startedAt timestamp
        _syncIdCounter++;
        _pendingSyncs[groupId] = {
          syncId: _syncIdCounter,
          expected: peerCount,
          pending: pendingPeers,
          paginating: {},
          retryCount: retryCount,
          startedAt: Date.now(),
        };
      });
    });
  });
}

/**
 * Request the next history page from a SINGLE peer.
 * Used when a peer's response contained a full page (HISTORY_PAGE_SIZE messages).
 */
function requestNextPageFromPeer(groupId, peerPubkey, sinceTimestamp) {
  MDS.log(
    "🔄 [GROUP-SYNC] Requesting next page from " +
      peerPubkey.substring(0, 10) +
      " for " +
      groupId +
      " since " +
      sinceTimestamp,
  );

  var sync = _pendingSyncs[groupId];
  if (sync) {
    sync.paginating[peerPubkey] = true;
  }

  MDS.cmd("maxima action:info", function (maxInfo) {
    if (!maxInfo.status) return;
    var myPubkey = maxInfo.response.publickey;

    var requestPayload = {
      app: "metachain-group",
      messageType: "history_request",
      groupId: groupId,
      groupName: "SYNC",
      senderPublickey: myPubkey,
      senderUsername: "",
      timestamp: Date.now(),
      historySince: sinceTimestamp,
    };
    var hexData =
      "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

    smartSend(
      peerPubkey,
      "metachain-group",
      hexData,
      "GROUP-HISTORY-PAGE",
      false,
    );
  });
}

/**
 * Requests history for ALL groups this node is a member of.
 * Called on startup and reconnect.
 */
function requestAllGroupsHistory() {
  MDS.log("🔄 [GROUP-SYNC] Startup sync for all groups...");
  MDS.sql("SELECT group_id FROM GROUPS", function (res) {
    if (!res.status || !res.rows || res.rows.length === 0) return;
    MDS.log("🔄 [GROUP-SYNC] Syncing " + res.rows.length + " group(s)...");
    for (var i = 0; i < res.rows.length; i++) {
      requestGroupHistoryFromSW(res.rows[i].GROUP_ID || res.rows[i].group_id);
    }
  });
}

function handleGroupHistoryRequest(pubkey, maxjson) {
  var groupId = maxjson.groupId;
  var since = maxjson.historySince || 0;
  MDS.log(
    "🔄 [GROUP-SYNC] History requested for " + groupId + " since " + since,
  );

  MDS.cmd("maxima action:info", function (info) {
    if (!info.status) return;
    var myPubkey = info.response.publickey;
    var myName = info.response.name || "User";

    var sql =
      "SELECT * FROM GROUP_MESSAGES WHERE group_id='" +
      escapeSql(groupId) +
      "' AND date > " +
      since +
      " ORDER BY date ASC LIMIT " +
      HISTORY_PAGE_SIZE;
    MDS.sql(sql, function (res) {
      var historyMessages = [];
      if (res.status && res.rows && res.rows.length > 0) {
        for (var i = 0; i < res.rows.length; i++) {
          var row = res.rows[i];
          historyMessages.push({
            group_id: row.GROUP_ID || row.group_id,
            sender_publickey: row.SENDER_PUBLICKEY || row.sender_publickey,
            sender_username: row.SENDER_USERNAME || row.sender_username,
            type: row.TYPE || row.type,
            message: row.MESSAGE || row.message,
            filedata: row.FILEDATA || row.filedata,
            date: Number(row.DATE || row.date),
            sender_seq: Number(row.SENDER_SEQ || row.sender_seq || 0),
            customid: row.CUSTOMID || row.customid || "",
            forwarded:
              row.FORWARDED === true ||
              row.FORWARDED === "true" ||
              row.FORWARDED === 1,
            replyTo: (row.REPLY_TO_CUSTOMID || row.reply_to_customid) ? {
              customid: row.REPLY_TO_CUSTOMID || row.reply_to_customid,
              text: row.REPLY_TO_TEXT || row.reply_to_text || "",
              senderName: row.REPLY_TO_SENDER || row.reply_to_sender || "",
              type: row.REPLY_TO_TYPE || row.reply_to_type || "text"
            } : null,
          });
        }
      }

      var responsePayload = {
        app: "metachain-group",
        messageType: "history_response",
        groupId: groupId,
        groupName: maxjson.groupName || "",
        senderPublickey: myPubkey,
        senderUsername: myName,
        timestamp: Date.now(),
        historyMessages: historyMessages,
      };

      var hexData =
        "0x" + utf8ToHex(JSON.stringify(responsePayload)).toUpperCase();

      // Send history response with Address Resolution
      smartSend(
        pubkey,
        "metachain-group",
        hexData,
        "GROUP-HISTORY-RESP",
        false,
      );
    });
  });
}

function handleGroupHistoryResponse(pubkey, maxjson) {
  var groupId = maxjson.groupId;
  var messages = maxjson.historyMessages || [];

  MDS.log(
    "🔄 [GROUP-SYNC] Received " +
      messages.length +
      " history messages for " +
      groupId,
  );

  // Filter and Save them
  var savedCount = 0;
  var latestTimestamp = 0;
  var processNext = function (index) {
    if (index >= messages.length) {
      // Pagination: if we got a full page, request the next one from THIS peer only
      if (messages.length >= HISTORY_PAGE_SIZE && latestTimestamp > 0) {
        MDS.log(
          "🔄 [GROUP-SYNC] Full page from " +
            pubkey.substring(0, 10) +
            ". Requesting next page since " +
            latestTimestamp,
        );
        // Move peer from pending to paginating (first response arrived, more coming)
        var sync = _pendingSyncs[groupId];
        if (sync) delete sync.pending[pubkey.toUpperCase()];
        requestNextPageFromPeer(groupId, pubkey, latestTimestamp);
      } else {
        // No more pages from this peer — mark done
        markSyncPeerDone(groupId, pubkey);
      }
      return;
    }

    var msg = messages[index];
    var timestamp = Number(msg.date);
    var sender = msg.sender_publickey;

    // Track the latest timestamp for pagination
    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }

    // Ensure customid exists for dedup
    var msgCustomId =
      msg.customid ||
      "hist_" + escapeSql(groupId) + "_" + timestamp + "_" + index;

    // Duplicate check: customid first, then fallback to (sender, date)
    var checkSql =
      "SELECT id FROM GROUP_MESSAGES WHERE group_id='" +
      escapeSql(groupId) +
      "' AND (customid='" +
      escapeSql(msgCustomId) +
      "' OR (UPPER(sender_publickey)=UPPER('" +
      escapeSql(sender) +
      "') AND date=" +
      timestamp +
      "))";
    MDS.sql(checkSql, function (checkRes) {
      if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
        processNext(index + 1);
      } else {
        savedCount++;
        var hReplyTo = msg.replyTo || null;
        var hReplyToCustomid = hReplyTo && hReplyTo.customid ? escapeSql(String(hReplyTo.customid)) : null;
        var hReplyToText = hReplyTo && hReplyTo.text ? escapeSql(String(hReplyTo.text).substring(0, 500)) : null;
        var hReplyToSender = hReplyTo && hReplyTo.senderName ? escapeSql(String(hReplyTo.senderName)) : null;
        var hReplyToType = hReplyTo && hReplyTo.type ? escapeSql(String(hReplyTo.type)) : null;
        var insSql =
          "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated, sender_seq, customid, forwarded, reply_to_customid, reply_to_text, reply_to_sender, reply_to_type) VALUES " +
          "('" +
          escapeSql(groupId) +
          "','" +
          escapeSql(sender) +
          "','" +
          escapeSql(msg.sender_username || "") +
          "','" +
          escapeSql(msg.type || "text") +
          "','" +
          escapeSql(msg.message || "") +
          "','" +
          escapeSql(msg.filedata || "") +
          "'," +
          timestamp +
          ", 0, 1, " +
          (msg.sender_seq || 0) +
          ", '" +
          escapeSql(msgCustomId) +
          "', " +
          // Always store forwarded=0 from history: the forwarded flag is a routing hint only.
          0 +
          ", " +
          (hReplyToCustomid ? "'" + hReplyToCustomid + "'" : "NULL") +
          ", " +
          (hReplyToText ? "'" + hReplyToText + "'" : "NULL") +
          ", " +
          (hReplyToSender ? "'" + hReplyToSender + "'" : "NULL") +
          ", " +
          (hReplyToType ? "'" + hReplyToType + "'" : "NULL") +
          ")";
        MDS.sql(insSql, function () {
          processNext(index + 1);
        });
      }
    });
  };

  processNext(0);
}

function handleGroupMessage(pubkey, maxjson) {
  MDS.log("📨 [GROUP-MSG] Processing...");

  // Migration: Ensure all required columns exist before processing
  var _grpMigs = [
    "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS propagated INT DEFAULT 0",
    "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS reply_to_customid VARCHAR(512)",
    "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS reply_to_text VARCHAR(512)",
    "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS reply_to_sender VARCHAR(160)",
    "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS reply_to_type VARCHAR(64)"
  ];
  function runGrpMigs(i, cb) { if (i >= _grpMigs.length) { cb(); return; } MDS.sql(_grpMigs[i], function () { runGrpMigs(i + 1, cb); }); }
  runGrpMigs(0, function () {
    var safeGroupId = escapeSql(maxjson.groupId || "");
    var encoded = escapeSql(maxjson.message || "");
    var messageTimestamp = Number(maxjson.timestamp) || Date.now();
    var originalSender = escapeSql(maxjson.senderPublickey || pubkey);
    var safeSenderUsername = escapeSql(maxjson.senderUsername || "Unknown");
    var safeType = escapeSql(maxjson.type || "text");
    var safeFileData = escapeSql(maxjson.filedata || "");
    var grpReplyTo = maxjson.replyTo || null;
    var grpReplyToCustomid = grpReplyTo && grpReplyTo.customid ? escapeSql(String(grpReplyTo.customid)) : null;
    var grpReplyToText = grpReplyTo && grpReplyTo.text ? escapeSql(String(grpReplyTo.text).substring(0, 500)) : null;
    var grpReplyToSender = grpReplyTo && grpReplyTo.senderName ? escapeSql(String(grpReplyTo.senderName)) : null;
    var grpReplyToType = grpReplyTo && grpReplyTo.type ? escapeSql(String(grpReplyTo.type)) : null;

    // 🚫 Check if the sender is banned from this group
    var banCheckSql =
      "SELECT * FROM GROUP_BANS WHERE group_id='" +
      safeGroupId +
      "' AND UPPER(publickey)=UPPER('" +
      originalSender +
      "')";
    MDS.sql(banCheckSql, function (banRes) {
      if (banRes.status && banRes.rows && banRes.rows.length > 0) {
        MDS.log(
          "🚫 [GROUP-MSG] Discarding message from banned sender: " +
            originalSender.substring(0, 10),
        );
        return;
      }
      processGroupMessage(
        safeGroupId,
        encoded,
        messageTimestamp,
        originalSender,
        safeSenderUsername,
        safeType,
        safeFileData,
        pubkey,
        maxjson,
        grpReplyToCustomid,
        grpReplyToText,
        grpReplyToSender,
        grpReplyToType,
      );
    });
  });
}

function processGroupMessage(
  safeGroupId,
  encoded,
  messageTimestamp,
  originalSender,
  safeSenderUsername,
  safeType,
  safeFileData,
  pubkey,
  maxjson,
  grpReplyToCustomid,
  grpReplyToText,
  grpReplyToSender,
  grpReplyToType
) {
  var incomingSeq = maxjson.seq ? parseInt(maxjson.seq) : 0;

  // Ensure every message has a customid (generate one if sender didn't provide it)
  if (!maxjson.customid) {
    maxjson.customid =
      "sw_" +
      safeGroupId +
      "_" +
      messageTimestamp +
      "_" +
      Math.random().toString(36).substr(2, 9);
  }

  // Check for duplicates: customid is the primary dedup key, timestamp is fallback
  var safeCustomId = escapeSql(maxjson.customid);
  var checkSql =
    "SELECT id, propagated FROM GROUP_MESSAGES WHERE group_id='" +
    safeGroupId +
    "' AND (customid='" +
    safeCustomId +
    "' OR (UPPER(sender_publickey)=UPPER('" +
    originalSender +
    "') AND date=" +
    messageTimestamp +
    "))";

  MDS.sql(checkSql, function (checkRes) {
    var shouldPropagate = false;

    if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
      var row = checkRes.rows[0];
      var isPropagated = row.PROPAGATED === 1 || row.propagated === 1;

      if (isPropagated) {
        MDS.log("ℹ️ [GROUP-MSG] Already propagated. Ignoring.");
        return;
      } else {
        MDS.log("⚠️ [GROUP-MSG] Exists but NOT propagated. Propagating now.");
        shouldPropagate = true;
        MDS.sql("UPDATE GROUP_MESSAGES SET propagated=1 WHERE id=" + row.ID);
      }
    } else {
      shouldPropagate = true;
      // Always store forwarded=0: the `forwarded` flag in the payload is a routing-only
      // hint to prevent re-propagation storms. It must NOT be persisted to the DB because
      // it would incorrectly render a "Forwarded" badge on messages the user received
      // via the hub/relay path (e.g. after a member reconnects). See AGENTS.md fragility #42.
      var forwardedVal = 0;
      var groupMsgSql =
        "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated, sender_seq, customid, forwarded, reply_to_customid, reply_to_text, reply_to_sender, reply_to_type) VALUES " +
        "('" +
        safeGroupId +
        "','" +
        originalSender +
        "','" +
        safeSenderUsername +
        "','" +
        safeType +
        "','" +
        encoded +
        "','" +
        safeFileData +
        "'," +
        messageTimestamp +
        ", 0, 1, " +
        incomingSeq +
        ", '" +
        escapeSql(maxjson.customid || "") +
        "', " +
        forwardedVal +
        ", " +
        (grpReplyToCustomid ? "'" + grpReplyToCustomid + "'" : "NULL") +
        ", " +
        (grpReplyToText ? "'" + grpReplyToText + "'" : "NULL") +
        ", " +
        (grpReplyToSender ? "'" + grpReplyToSender + "'" : "NULL") +
        ", " +
        (grpReplyToType ? "'" + grpReplyToType + "'" : "NULL") +
        ")";

      MDS.sql(groupMsgSql, function (res) {
        if (res.status) {
          MDS.log("✅ [DB] Group message saved (propagated=1).");
        } else {
          MDS.log("❌ [DB] Failed to save group message: " + res.error);
          if (res.error && res.error.indexOf("propagated") !== -1) {
            var retrySql =
              "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read) VALUES " +
              "('" +
              safeGroupId +
              "','" +
              originalSender +
              "','" +
              safeSenderUsername +
              "','" +
              safeType +
              "','" +
              encoded +
              "','" +
              safeFileData +
              "'," +
              messageTimestamp +
              ", 0)";
            MDS.sql(retrySql);
          }
        }
      });
    }

    // GAP DETECTION: Check sequence numbers (only if sender includes seq)
    if (incomingSeq > 0) {
      var seqCheckSql =
        "SELECT last_seen_seq FROM GROUP_MSG_COUNTERS WHERE group_id='" +
        safeGroupId +
        "' AND sender_publickey='" +
        originalSender +
        "'";
      MDS.sql(seqCheckSql, function (seqRes) {
        var lastSeq = 0;
        var hasRow = seqRes.status && seqRes.rows && seqRes.rows.length > 0;
        if (hasRow) {
          lastSeq = parseInt(seqRes.rows[0].LAST_SEEN_SEQ || 0);
        }

        if (lastSeq > 0 && incomingSeq > lastSeq + 1) {
          var gapSize = incomingSeq - lastSeq - 1;
          MDS.log(
            "⚠️ [GAP-DETECT] Missing " +
              gapSize +
              " message(s) from " +
              originalSender.substring(0, 10) +
              " in group " +
              safeGroupId,
          );
          // Trigger history sync to fill the gap
          requestGroupHistoryFromSW(safeGroupId);
        }

        // Update or insert last_seen_seq
        if (incomingSeq > lastSeq) {
          if (hasRow) {
            MDS.sql(
              "UPDATE GROUP_MSG_COUNTERS SET last_seen_seq=" +
                incomingSeq +
                " WHERE group_id='" +
                safeGroupId +
                "' AND sender_publickey='" +
                originalSender +
                "'",
            );
          } else {
            MDS.sql(
              "INSERT INTO GROUP_MSG_COUNTERS (group_id, sender_publickey, last_seen_seq, my_next_seq) VALUES ('" +
                safeGroupId +
                "','" +
                originalSender +
                "'," +
                incomingSeq +
                ",1)",
            );
          }
        }
      });
    }

    // Do NOT propagate if already forwarded — prevents exponential storm
    if (shouldPropagate && !maxjson.forwarded) {
      propagateGroupMessage(pubkey, maxjson);
    } else if (shouldPropagate && maxjson.forwarded) {
      MDS.log("ℹ️ [GROUP-MSG] Forwarded copy — skipping re-propagation.");
    }
  });
}

function propagateGroupMessage(pubkey, maxjson) {
  MDS.log("🔄 [GROUP-MSG] Starting propagation...");

  var safeGroupId = escapeSql(maxjson.groupId || "");
  var membersSql =
    "SELECT * FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "'";
  MDS.sql(membersSql, function (memberRes) {
    if (!memberRes.status || !memberRes.rows) {
      MDS.log("❌ [GROUP-MSG] Failed to fetch members.");
      return;
    }

    var members = memberRes.rows;
    MDS.cmd("maxima", function (maximaRes) {
      var myPubkey = maximaRes.response.publickey;
      // Mark as forwarded so recipients do NOT re-propagate (prevents storm)
      var forwardedMsg = JSON.parse(JSON.stringify(maxjson));
      forwardedMsg.forwarded = true;
      var jsonStr = JSON.stringify(forwardedMsg);
      var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();
      var propagatedCount = 0;

      // Send to each member via DISCOVERED_PEERS address (no maxcontacts needed)
      var sendToMember = function (index) {
        if (index >= members.length) {
          MDS.log(
            "✅ [GROUP-MSG] Propagation complete. Sent to " +
              propagatedCount +
              " members.",
          );
          return;
        }

        var memberPubkey = members[index].PUBLICKEY;

        // Skip sender, original message sender, and ourselves.
        // Use toUpperCase() on all sides: GROUP_MEMBERS stores keys as 0X... (uppercase)
        // while Maxima delivers pubkey/senderPublickey as 0x... (lowercase). Strict equality
        // would miss the match, causing the original sender to receive their own message back
        // with forwarded=true and creating unnecessary Maxima traffic. See AGENTS.md #22.
        if (
          memberPubkey.toUpperCase() === pubkey.toUpperCase() ||
          memberPubkey.toUpperCase() === (maxjson.senderPublickey || "").toUpperCase() ||
          memberPubkey.toUpperCase() === myPubkey.toUpperCase()
        ) {
          sendToMember(index + 1);
          return;
        }

        // Look up Mx address in DISCOVERED_PEERS
        smartSend(
          memberPubkey,
          "metachain-group",
          hexData,
          "GROUP-PROPAGATE",
          false,
        );
        sendToMember(index + 1);
      };

      sendToMember(0);
    });
  });
}

function handleGroupMessageDeleted(pubkey, maxjson) {
  var groupId = maxjson.groupId;
  var customid = maxjson.customid;
  if (!groupId || !customid) return;

  var safeGroupId = escapeSql(groupId);
  var safeCustomId = escapeSql(customid);
  var safePubkey = escapeSql(pubkey);

  // Load message to check sender + load role of requester
  var msgSql =
    "SELECT sender_publickey FROM GROUP_MESSAGES WHERE UPPER(group_id)=UPPER('" +
    safeGroupId +
    "') AND customid='" +
    safeCustomId +
    "'";

  MDS.sql(msgSql, function (msgRes) {
    if (!msgRes.status || !msgRes.rows || msgRes.rows.length === 0) {
      MDS.log("⚠️ [GROUP-DELETE] Message not found: " + safeCustomId);
      return;
    }

    var senderPk = (msgRes.rows[0].SENDER_PUBLICKEY || "").toUpperCase();

    var roleSql =
      "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
      safeGroupId +
      "' AND UPPER(publickey)=UPPER('" +
      safePubkey +
      "')";

    MDS.sql(roleSql, function (roleRes) {
      var role = "";
      if (roleRes.status && roleRes.rows && roleRes.rows.length > 0) {
        role = (roleRes.rows[0].ROLE || "").toLowerCase();
      }

      var isSender = senderPk === safePubkey.toUpperCase();
      var isAdmin = role === "admin" || role === "creator";

      if (!isSender && !isAdmin) {
        MDS.log("⚠️ [GROUP-DELETE] Not authorized to delete: " + safePubkey.substring(0, 10));
        return;
      }

      var updateSql =
        "UPDATE GROUP_MESSAGES SET deleted=1, deleted_at=" +
        Date.now() +
        " WHERE UPPER(group_id)=UPPER('" +
        safeGroupId +
        "') AND customid='" +
        safeCustomId +
        "'";

      MDS.sql(updateSql, function (upRes) {
        if (!upRes.status) {
          MDS.log("❌ [GROUP-DELETE] Failed: " + upRes.error);
          return;
        }
        MDS.log("🗑️ [GROUP-DELETE] Message deleted: " + safeCustomId);

        // Fanout delete notification to other members
        var membersSql =
          "SELECT publickey FROM GROUP_MEMBERS WHERE group_id='" +
          safeGroupId +
          "' AND UPPER(publickey) != UPPER('" +
          safePubkey +
          "')";

        MDS.sql(membersSql, function (membersRes) {
          if (!membersRes.status || !membersRes.rows || membersRes.rows.length === 0) {
            MDS.comms.solo(JSON.stringify({ type: "GROUP_MESSAGE_DELETED", groupId: groupId, customid: customid }));
            return;
          }

          var deletePayload = {
            app: "metachain-group",
            messageType: "message_deleted",
            groupId: groupId,
            customid: customid,
            timestamp: Date.now()
          };
          var hexData = "0x" + utf8ToHex(JSON.stringify(deletePayload)).toUpperCase();

          for (var mi = 0; mi < membersRes.rows.length; mi++) {
            var memberPk = membersRes.rows[mi].PUBLICKEY;
            if (memberPk && memberPk.toUpperCase() !== safePubkey.toUpperCase()) {
              smartSend(memberPk, "metachain-group", hexData, "GROUP-DELETE", false);
            }
          }

          MDS.comms.solo(JSON.stringify({ type: "GROUP_MESSAGE_DELETED", groupId: groupId, customid: customid }));
        });
      });
    });
  });
}

function handleGroupInvite(pubkey, maxjson) {
  var safeGroupId = escapeSql(maxjson.groupId || "");
  var safeGroupName = escapeSql(maxjson.groupName || "");
  var safeAvatar = escapeSql(maxjson.avatar || "");
  MDS.log(
    "📨 [GROUP-INVITE] Processing invite for group " +
      safeGroupId +
      " (" +
      safeGroupName +
      ") from " +
      pubkey.substring(0, 10),
  );
  var safeCreatorPubkey = escapeSql(maxjson.creatorPublickey || pubkey || "");
  var safeDescription = escapeSql(maxjson.description || "");
  var safeTimestamp = Number(maxjson.timestamp) || Date.now();

  // 🚫 Check if WE (this node) are banned from this group
  MDS.cmd("maxima action:info", function (maximaRes) {
    var myPubkey = maximaRes.response.publickey;
    MDS.log("📝 [GROUP-INVITE] My Pubkey: " + myPubkey.substring(0, 10));
    var checkBanSql =
      "SELECT * FROM GROUP_BANS WHERE group_id='" +
      safeGroupId +
      "' AND UPPER(publickey)=UPPER('" +
      myPubkey +
      "')";
    MDS.sql(checkBanSql, function (banRes) {
      MDS.log("🔍 [GROUP-INVITE-UNBAN] Ban check result: rows=" + (banRes.rows ? banRes.rows.length : 0) + " status=" + banRes.status + " groupId=" + safeGroupId);
      if (banRes.status && banRes.rows && banRes.rows.length > 0) {
        MDS.log(
          "🚫 [GROUP-INVITE] Ignoring invite: we are banned from group " +
            safeGroupId,
        );
        return;
      }
      MDS.log("✅ [GROUP-INVITE-UNBAN] Ban check passed, proceeding to create group " + safeGroupId);

      var createGroupSql =
        "INSERT INTO GROUPS (group_id, name, creator_publickey, created_date, description, avatar) VALUES " +
        "('" +
        safeGroupId +
        "','" +
        safeGroupName +
        "','" +
        safeCreatorPubkey +
        "'," +
        safeTimestamp +
        ",'" +
        safeDescription +
        "','" +
        safeAvatar +
        "')";

      MDS.sql(createGroupSql, function (res) {
        MDS.log(
          "✅ [GROUP-INVITE-UNBAN] Group INSERT status=" + res.status + " rowsAffected=" + (res.rowsAffected || 0) + " error=" + (res.error || "none") + " groupId=" + safeGroupId,
        );

        if (maxjson.members) {
          var addMember = function (idx) {
            if (idx >= maxjson.members.length) {
              var creatorName = escapeSql(
                maxjson.creatorUsername || maxjson.senderUsername || "Someone",
              );
              var systemMsg = creatorName + " created the group";
              var checkMsgSql =
                "SELECT id FROM GROUP_MESSAGES WHERE group_id='" +
                safeGroupId +
                "' AND type='system' AND message='" +
                systemMsg +
                "'";
              MDS.sql(checkMsgSql, function (checkRes) {
                if (
                  checkRes.status &&
                  (!checkRes.rows || checkRes.rows.length === 0)
                ) {
                  var initialMsgSql =
                    "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated, customid) VALUES " +
                    "('" +
                    safeGroupId +
                    "', '" +
                    safeCreatorPubkey +
                    "', '" +
                    creatorName +
                    "', 'system', '" +
                    systemMsg +
                    "', '', " +
                    safeTimestamp +
                    ", 0, 1, '" +
                    escapeSql(maxjson.customid || "") +
                    "')";
                  MDS.sql(initialMsgSql, function () {
                    // Notify UI that a new group was added
                    MDS.comms.solo(
                      JSON.stringify({ type: "group_list_updated" }),
                    );
                    MDS.comms.solo(
                      JSON.stringify({
                        type: "group_sync_start",
                        groupId: safeGroupId,
                      }),
                    );
                    // Trigger history sync
                    if (typeof requestGroupHistoryFromSW === "function") {
                      requestGroupHistoryFromSW(safeGroupId);
                    }
                  });
                } else {
                  // Even if msg exists, notify UI in case it's a new join
                  MDS.comms.solo(
                    JSON.stringify({ type: "group_list_updated" }),
                  );
                }
              });
              return;
            }
            var m = maxjson.members[idx];
            var memberPublickey = m.publickey || m.PUBLICKEY || "";
            var memberUsername = m.username || m.USERNAME || "Unknown";
            var memberRole = m.role || m.ROLE || "";

            var role = memberRole
              ? escapeSql(memberRole)
              : memberPublickey === safeCreatorPubkey
                ? "creator"
                : "member";
            var safeMemberPubkey = escapeSql(memberPublickey);
            var safeMemberUsername = escapeSql(memberUsername);

            // Check ban before inserting
            var checkMemberBanSql =
              "SELECT * FROM GROUP_BANS WHERE group_id='" +
              safeGroupId +
              "' AND UPPER(publickey)=UPPER('" +
              safeMemberPubkey +
              "')";
            MDS.sql(checkMemberBanSql, function (memberBanRes) {
              if (
                memberBanRes.status &&
                memberBanRes.rows &&
                memberBanRes.rows.length > 0
              ) {
                MDS.log(
                  "🚫 [GROUP-INVITE] Skipping banned member: " +
                    safeMemberPubkey.substring(0, 10),
                );
                addMember(idx + 1);
                return;
              }

              var addMemberSql =
                "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) SELECT '" +
                safeGroupId +
                "','" +
                safeMemberPubkey +
                "','" +
                safeMemberUsername +
                "'," +
                safeTimestamp +
                ",'" +
                role +
                "' WHERE NOT EXISTS (SELECT 1 FROM GROUP_MEMBERS WHERE group_id='" +
                safeGroupId +
                "' AND UPPER(publickey)=UPPER('" +
                safeMemberPubkey +
                "'))";

              MDS.sql(addMemberSql, function () {
                // Seed DISCOVERED_PEERS with this member's Mx address if provided
                if (m.address) {
                  var safeMemberAddress = escapeSql(m.address);
                  var delPeer =
                    "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
                    safeMemberPubkey +
                    "')";
                  MDS.sql(delPeer, function () {
                    var insPeer =
                      "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" +
                      safeMemberPubkey +
                      "', '" +
                      safeMemberAddress +
                      "', 'GROUP_INVITE', '" +
                      safeMemberUsername +
                      "', " +
                      safeTimestamp +
                      ", '')";
                    MDS.sql(insPeer, function () {
                      addMember(idx + 1);
                    });
                  });
                } else {
                  addMember(idx + 1);
                }
              });
            });
          };

          var processBans = function () {
            if (maxjson.bannedMembers && maxjson.bannedMembers.length > 0) {
              var addBan = function (bIdx) {
                if (bIdx >= maxjson.bannedMembers.length) {
                  addMember(0);
                  return;
                }
                var b = maxjson.bannedMembers[bIdx];
                var safeBanPubkey = escapeSql(b.publickey || "");
                var safeBanUsername = escapeSql(b.username || "Unknown");
                var safeBannedBy = escapeSql(b.banned_by || pubkey);
                var safeBannedAt = Number(b.banned_at) || safeTimestamp;

                var checkBanSql =
                  "SELECT * FROM GROUP_BANS WHERE group_id='" +
                  safeGroupId +
                  "' AND UPPER(publickey)=UPPER('" +
                  safeBanPubkey +
                  "')";
                MDS.sql(checkBanSql, function (checkBanRes) {
                  if (
                    checkBanRes.status &&
                    (!checkBanRes.rows || checkBanRes.rows.length === 0)
                  ) {
                    var insertBanSql =
                      "INSERT INTO GROUP_BANS (group_id, publickey, username, banned_by, banned_at) VALUES " +
                      "('" +
                      safeGroupId +
                      "','" +
                      safeBanPubkey +
                      "','" +
                      safeBanUsername +
                      "','" +
                      safeBannedBy +
                      "'," +
                      safeBannedAt +
                      ")";
                    MDS.sql(insertBanSql, function () {
                      addBan(bIdx + 1);
                    });
                  } else {
                    addBan(bIdx + 1);
                  }
                });
              };
              addBan(0);
            } else {
              addMember(0);
            }
          };
          processBans();
        }
      });
    });
  });
}

function handleGroupMemberUpdate(pubkey, maxjson) {
  MDS.log("🔄 [GROUP-MEMBER] Update: " + maxjson.messageType);
  var safeGroupId = escapeSql(maxjson.groupId || "");
  var safeTimestamp = Number(maxjson.timestamp) || Date.now();
  var safeMemberPublickey = escapeSql(maxjson.memberPublickey || "");
  var safeMemberUsername = escapeSql(maxjson.memberUsername || "Unknown");

  if (maxjson.messageType === "group_member_added") {
    // 🚫 Block re-add if the member is banned
    var checkAddBanSql =
      "SELECT * FROM GROUP_BANS WHERE group_id='" +
      safeGroupId +
      "' AND UPPER(publickey)=UPPER('" +
      safeMemberPublickey +
      "')";
    MDS.sql(checkAddBanSql, function (addBanRes) {
      if (addBanRes.status && addBanRes.rows && addBanRes.rows.length > 0) {
        MDS.log(
          "🚫 [GROUP-MEMBER] Blocked re-add of banned member: " +
            safeMemberPublickey.substring(0, 10),
        );
        return;
      }
      // 🚫 Block duplicate insert if already a member (case-insensitive)
      var checkAlreadyMemberSql =
        "SELECT * FROM GROUP_MEMBERS WHERE group_id='" +
        safeGroupId +
        "' AND UPPER(publickey)=UPPER('" +
        safeMemberPublickey +
        "')";
      MDS.sql(checkAlreadyMemberSql, function (alreadyRes) {
        if (
          alreadyRes.status &&
          alreadyRes.rows &&
          alreadyRes.rows.length > 0
        ) {
          MDS.log(
            "ℹ️ [GROUP-MEMBER] Already a member, skipping duplicate insert: " +
              safeMemberPublickey.substring(0, 10),
          );
          MDS.comms.solo(
            JSON.stringify({ type: "group_update", groupId: safeGroupId }),
          );
          return;
        }
        var addMemberSql =
          "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES " +
          "('" +
          safeGroupId +
          "','" +
          safeMemberPublickey +
          "','" +
          safeMemberUsername +
          "'," +
          safeTimestamp +
          ",'member')";
        MDS.sql(addMemberSql, function () {
          // Seed DISCOVERED_PEERS with new member's Mx address so we can send messages to them
          if (maxjson.memberAddress) {
            var safeMemberAddress = escapeSql(maxjson.memberAddress);
            var now = Date.now();
            var delPeer =
              "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
              safeMemberPublickey +
              "')";
            MDS.sql(delPeer, function () {
              var insPeer =
                "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" +
                safeMemberPublickey +
                "', '" +
                safeMemberAddress +
                "', 'GROUP_MEMBER_ADDED', '" +
                safeMemberUsername +
                "', " +
                now +
                ", '')";
              MDS.sql(insPeer, function () {
                MDS.comms.solo(
                  JSON.stringify({
                    type: "group_update",
                    groupId: safeGroupId,
                  }),
                );
              });
            });
          } else {
            MDS.comms.solo(
              JSON.stringify({ type: "group_update", groupId: safeGroupId }),
            );
          }
        });
      }); // end checkAlreadyMemberSql
    });
  } else {
    MDS.cmd("maxima", function (maximaRes) {
      var myPubkey = maximaRes.response.publickey;

      if (myPubkey.toUpperCase() === safeMemberPublickey.toUpperCase()) {
        // I have been kicked/banned! Delete the group completely so I don't see it anymore.
        MDS.sql(
          "DELETE FROM GROUPS WHERE group_id='" + safeGroupId + "'",
          function () {
            MDS.sql(
              "DELETE FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "'",
              function () {
                MDS.sql(
                  "DELETE FROM GROUP_MESSAGES WHERE group_id='" +
                    safeGroupId +
                    "'",
                  function () {
                    MDS.sql(
                      "DELETE FROM GROUP_BANS WHERE group_id='" +
                        safeGroupId +
                        "'",
                      function () {
                        MDS.comms.solo(
                          JSON.stringify({
                            type: "group_update",
                            groupId: safeGroupId,
                          }),
                        );
                      },
                    );
                  },
                );
              },
            );
          },
        );
      } else {
        var removeMemberSql =
          "DELETE FROM GROUP_MEMBERS WHERE group_id='" +
          safeGroupId +
          "' AND UPPER(publickey)=UPPER('" +
          safeMemberPublickey +
          "')";
        MDS.sql(removeMemberSql, function () {
          if (
            maxjson.senderPublickey &&
            maxjson.senderPublickey !== maxjson.memberPublickey
          ) {
            var safeBannedBy = escapeSql(maxjson.senderPublickey);
            var checkBanSql =
              "SELECT * FROM GROUP_BANS WHERE group_id='" +
              safeGroupId +
              "' AND UPPER(publickey)=UPPER('" +
              safeMemberPublickey +
              "')";
            MDS.sql(checkBanSql, function (banRes) {
              if (!banRes.status || !banRes.rows || banRes.rows.length === 0) {
                var banSql =
                  "INSERT INTO GROUP_BANS (group_id, publickey, username, banned_by, banned_at) VALUES ('" +
                  safeGroupId +
                  "', '" +
                  safeMemberPublickey +
                  "', '" +
                  safeMemberUsername +
                  "', '" +
                  safeBannedBy +
                  "', " +
                  safeTimestamp +
                  ")";
                MDS.sql(banSql, function () {
                  MDS.comms.solo(
                    JSON.stringify({
                      type: "group_update",
                      groupId: safeGroupId,
                    }),
                  );
                });
              } else {
                MDS.comms.solo(
                  JSON.stringify({
                    type: "group_update",
                    groupId: safeGroupId,
                  }),
                );
              }
            });
          } else {
            MDS.comms.solo(
              JSON.stringify({ type: "group_update", groupId: safeGroupId }),
            );
          }
        });
      }
    });
  }
}

function handleGroupMemberUnbanned(pubkey, maxjson) {
  MDS.log(
    "🔄 [GROUP-UNBAN] Processing unban for " +
      (maxjson.memberPublickey
        ? maxjson.memberPublickey.substring(0, 10)
        : "unknown"),
  );
  var safeGroupId = escapeSql(maxjson.groupId || "");
  var safeMemberPublickey = escapeSql(maxjson.memberPublickey || "");

  var sql =
    "DELETE FROM GROUP_BANS WHERE group_id='" +
    safeGroupId +
    "' AND UPPER(publickey)=UPPER('" +
    safeMemberPublickey +
    "')";
  MDS.sql(sql, function () {
    MDS.comms.solo(
      JSON.stringify({ type: "group_update", groupId: safeGroupId }),
    );
  });
}

function handleGroupUpdateDetails(pubkey, maxjson) {
  MDS.log(
    "🔄 [GROUP-UPDATE] Processing details request from " +
      pubkey.substring(0, 10),
  );
  var safeGroupId = escapeSql(maxjson.groupId || "");
  var safeNewName = maxjson.newName ? escapeSql(maxjson.newName) : null;
  var safeNewDescription =
    maxjson.newDescription !== undefined && maxjson.newDescription !== null
      ? escapeSql(maxjson.newDescription)
      : null;
  var safeAvatar = maxjson.avatar ? escapeSql(maxjson.avatar) : null;
  var hasAutoApprove = maxjson.auto_approve !== undefined;
  var autoApproveEnabled =
    maxjson.auto_approve === true ||
    maxjson.auto_approve === 1 ||
    String(maxjson.auto_approve).toUpperCase() === "TRUE" ||
    String(maxjson.auto_approve) === "1";
  var hasIsPublic = maxjson.is_public !== undefined;
  var isPublicEnabled =
    maxjson.is_public === true ||
    maxjson.is_public === 1 ||
    String(maxjson.is_public).toUpperCase() === "TRUE" ||
    String(maxjson.is_public) === "1";

  // Security Check: Sender must be creator OR admin
  var checkSql =
    "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
    safeGroupId +
    "' AND UPPER(publickey)=UPPER('" +
    pubkey +
    "')";

  MDS.sql(checkSql, function (res) {
    if (!res.status || !res.rows || res.rows.length === 0) {
      MDS.log(
        "⚠️ [GROUP-UPDATE] Group " +
          safeGroupId +
          " not found locally or sender is not a member.",
      );
      return;
    }

    var senderRole = res.rows[0].ROLE || res.rows[0].role;

    if (senderRole !== "creator" && senderRole !== "admin") {
      MDS.log(
        "❌ [GROUP-UPDATE] Unauthorized attempt. Sender (" +
          pubkey.substring(0, 10) +
          ") has role: " +
          senderRole,
      );
      return;
    }

    var updates = [];
    if (safeNewName !== null) updates.push("name='" + safeNewName + "'");
    if (safeNewDescription !== null)
      updates.push("description='" + safeNewDescription + "'");
    if (safeAvatar !== null) updates.push("avatar='" + safeAvatar + "'");
    if (hasAutoApprove)
      updates.push("auto_approve=" + (autoApproveEnabled ? "TRUE" : "FALSE"));
    if (hasIsPublic)
      updates.push("is_public=" + (isPublicEnabled ? "TRUE" : "FALSE"));

    if (updates.length === 0) return;

    // Sender authorized: Update the details
    var updateSql =
      "UPDATE GROUPS SET " +
      updates.join(", ") +
      " WHERE group_id='" +
      safeGroupId +
      "'";
    MDS.sql(updateSql, function (updateRes) {
      if (updateRes.status) {
        MDS.log("✅ [DB] Group details updated via broadcast");

        // Notify the frontend via MDS.comms.solo
        var soloMsg = {
          type: "group_update",
          groupId: maxjson.groupId,
        };
        if (maxjson.newName !== undefined) soloMsg.name = maxjson.newName;
        if (maxjson.newDescription !== undefined)
          soloMsg.description = maxjson.newDescription;
        if (maxjson.avatar !== undefined) soloMsg.avatar = maxjson.avatar;
        if (hasAutoApprove) soloMsg.auto_approve = autoApproveEnabled;
        if (hasIsPublic) soloMsg.is_public = isPublicEnabled;

        var msgStr =
          typeof soloMsg === "string" ? soloMsg : JSON.stringify(soloMsg);
        MDS.comms.solo(msgStr);
      } else {
        MDS.log("❌ [DB] Failed to update group details: " + updateRes.error);
      }
    });
  });
}

function handleGroupRoleUpdate(pubkey, maxjson) {
  MDS.log(
    "🔄 [GROUP-ROLE] Processing role update request from " +
      pubkey.substring(0, 10),
  );
  var safeGroupId = escapeSql(maxjson.groupId || "");
  var safeSenderPubkey = escapeSql(pubkey || "");
  var safeTargetPubkey = escapeSql(maxjson.targetPubkey || "");
  var safeNewRole = escapeSql(maxjson.newRole || "member"); // 'admin' or 'member'

  // 1. Check if the sender is an admin or creator
  var checkSenderSql =
    "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
    safeGroupId +
    "' AND UPPER(publickey)=UPPER('" +
    safeSenderPubkey +
    "')";

  MDS.sql(checkSenderSql, function (resSender) {
    var senderRole =
      resSender &&
      resSender.status &&
      resSender.rows &&
      resSender.rows.length > 0
        ? resSender.rows[0].ROLE || resSender.rows[0].role
        : null;
    var senderIsMemberAdmin =
      senderRole === "creator" || senderRole === "admin";

    var checkCreatorSql =
      "SELECT creator_publickey FROM GROUPS WHERE group_id='" +
      safeGroupId +
      "' LIMIT 1";
    MDS.sql(checkCreatorSql, function (creatorRes) {
      var creatorPk =
        creatorRes &&
        creatorRes.status &&
        creatorRes.rows &&
        creatorRes.rows.length > 0
          ? creatorRes.rows[0].CREATOR_PUBLICKEY ||
            creatorRes.rows[0].creator_publickey
          : "";
      var senderIsGroupCreator =
        !!creatorPk &&
        creatorPk.toUpperCase() === safeSenderPubkey.toUpperCase();

      if (!senderIsMemberAdmin && !senderIsGroupCreator) {
        if (!senderRole) {
          MDS.log(
            "❌ [GROUP-ROLE] Unauthorized role update. Sender not in group and not creator."
          );
        } else {
          MDS.log(
            "❌ [GROUP-ROLE] Unauthorized role update. Sender role is: " +
              senderRole
          );
        }
        return;
      }

      // 2. We can't change the creator's role explicitly (or demote them)
      var checkTargetSql =
        "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
        safeGroupId +
        "' AND UPPER(publickey)=UPPER('" +
        safeTargetPubkey +
        "')";
      MDS.sql(checkTargetSql, function (resTarget) {
      if (!resTarget.status || !resTarget.rows || resTarget.rows.length === 0) {
        MDS.log("⚠️ [GROUP-ROLE] Target user not found in group.");
        return;
      }

      var targetRole = resTarget.rows[0].ROLE || resTarget.rows[0].role;
      if (targetRole === "creator") {
        MDS.log("❌ [GROUP-ROLE] Cannot change the role of the creator.");
        return;
      }

      // 3. Update the role
      var updateSql =
        "UPDATE GROUP_MEMBERS SET role='" +
        safeNewRole +
        "' WHERE group_id='" +
        safeGroupId +
        "' AND UPPER(publickey)=UPPER('" +
        safeTargetPubkey +
        "')";
      MDS.sql(updateSql, function (updateRes) {
        if (updateRes.status) {
          MDS.log(
            "✅ [DB] Role for " +
              safeTargetPubkey.substring(0, 10) +
              " updated to " +
              safeNewRole
          );

          // Notify the frontend via MDS.comms.solo
          var soloMsg = {
            type: "group_update",
            groupId: safeGroupId,
          };

          var msgStr =
            typeof soloMsg === "string" ? soloMsg : JSON.stringify(soloMsg);
          MDS.comms.solo(msgStr);

          // If a member has just been promoted to admin, send current group settings snapshot.
          // Only send if WE are NOT the target — our own local settings may be stale.
          // The promoter's FE sends the authoritative snapshot directly.
          var weAreTheTarget = MY_MAXIMA_PK &&
            safeTargetPubkey.toUpperCase() === MY_MAXIMA_PK.toUpperCase();
          if (safeNewRole === "admin" && !weAreTheTarget) {
            var settingsSql =
              "SELECT name, description, avatar, auto_approve, is_public FROM GROUPS WHERE group_id='" +
              safeGroupId +
              "' LIMIT 1";
            MDS.sql(settingsSql, function (settingsRes) {
              if (
                !settingsRes.status ||
                !settingsRes.rows ||
                settingsRes.rows.length === 0
              ) {
                return;
              }
              var row = settingsRes.rows[0];
              var snapshot = {
                application: "metachain-group",
                messageType: "group_update_details",
                groupId: safeGroupId,
                newName: row.NAME || row.name || "",
                newDescription: row.DESCRIPTION || row.description || "",
                avatar: row.AVATAR || row.avatar || "",
                auto_approve:
                  row.AUTO_APPROVE === true ||
                  row.auto_approve === true ||
                  row.AUTO_APPROVE === 1 ||
                  row.auto_approve === 1 ||
                  String(row.AUTO_APPROVE).toUpperCase() === "TRUE" ||
                  String(row.auto_approve).toUpperCase() === "TRUE",
                is_public:
                  row.IS_PUBLIC === true ||
                  row.is_public === true ||
                  row.IS_PUBLIC === 1 ||
                  row.is_public === 1 ||
                  String(row.IS_PUBLIC).toUpperCase() === "TRUE" ||
                  String(row.is_public).toUpperCase() === "TRUE",
                timestamp: Date.now(),
              };
              MDS.log(
                "📤 [GROUP-ROLE] Sending settings snapshot to promoted admin " +
                  safeTargetPubkey.substring(0, 10)
              );
              sendMaximaGroupMsg(safeTargetPubkey, snapshot);
            });
          }
        } else {
          MDS.log("❌ [DB] Failed to update role: " + updateRes.error);
        }
      });
      });
    });
  });
}

function handleGroupJoinRequestEvent(pubkey, maxjson) {
  MDS.log(
    "📨 [GROUP-JOIN] Received Join Request Event (Type: " +
      (maxjson.messageType || maxjson.type) +
      ") from " +
      pubkey.substring(0, 10),
  );
  try {
    MDS.log(
      "🔄 [GROUP-JOIN] Processing event: " +
        (maxjson.messageType || maxjson.type) +
        " from " +
        pubkey.substring(0, 10),
    );
    var safeGroupId = escapeSql(maxjson.groupId || "");
    var safeTimestamp = Number(maxjson.timestamp) || Date.now();

    // 1. Resolve our public key in case the global didn't load yet
    if (
      typeof MY_MAXIMA_PK === "undefined" ||
      !MY_MAXIMA_PK ||
      MY_MAXIMA_PK === ""
    ) {
      MDS.cmd("maxima", function (maxRes) {
        if (maxRes.status) {
          if (typeof self !== "undefined") {
            self.MY_MAXIMA_PK = maxRes.response.publickey;
          } else if (typeof globalThis !== "undefined") {
            globalThis.MY_MAXIMA_PK = maxRes.response.publickey;
          }
          var resolvedPk = maxRes.response.publickey;
          MDS.log("🔑 [GROUP-JOIN] Recovered local Maxima PK.");
          executeJoinRequestAuth(
            pubkey,
            maxjson,
            safeGroupId,
            safeTimestamp,
            resolvedPk,
          );
        } else {
          MDS.log("❌ [GROUP-JOIN] Failed to get local Maxima info");
        }
      });
    } else {
      executeJoinRequestAuth(
        pubkey,
        maxjson,
        safeGroupId,
        safeTimestamp,
        MY_MAXIMA_PK,
      );
    }
  } catch (err) {
    MDS.log(
      "🔥 [GROUP-JOIN] CRASH in handleGroupJoinRequestEvent: " + err.message,
    );
  }
}

function executeJoinRequestAuth(
  pubkey,
  maxjson,
  safeGroupId,
  safeTimestamp,
  localPk
) {
  try {
    // 2. Verify we are an admin/creator of this group. If not, ignore.
    var checkSenderSql =
      "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
      safeGroupId +
      "' AND UPPER(publickey)=UPPER('" +
      localPk +
      "')";
    MDS.sql(checkSenderSql, function (resSender) {
      MDS.log(
        "📝 [GROUP-JOIN] Membership check result: " +
          (resSender.status ? "OK" : "ERROR: " + resSender.error),
      );
      try {
        if (!resSender.status) {
          MDS.log(
            "❌ [GROUP-JOIN] SQL Error validating group membership: " +
              resSender.error,
          );
          return;
        }
        if (!resSender.rows || resSender.rows.length === 0) {
          MDS.log(
            "⚠️ [GROUP-JOIN] Ignored. We are not in group " + safeGroupId,
          );
          return;
        }
        MDS.log(
          "📝 [GROUP-JOIN] Validating admin role for " +
            localPk.substring(0, 10) +
            " in " +
            safeGroupId
        );
        var myRole = resSender.rows[0].ROLE || resSender.rows[0].role;
        MDS.log("📝 [GROUP-JOIN] My role in " + safeGroupId + " is " + myRole);
        if (myRole !== "creator" && myRole !== "admin") {
          // Fast reconciliation path:
          // If this is a propagated join request sent by the creator, local role can be stale.
          // Promote local membership to admin and re-run this handler once.
          if (maxjson.messageType === "group_join_request_propagated") {
            var creatorSql =
              "SELECT creator_publickey FROM GROUPS WHERE group_id='" +
              safeGroupId +
              "' LIMIT 1";
            MDS.sql(creatorSql, function (creatorRes) {
              var creatorPk =
                creatorRes &&
                creatorRes.status &&
                creatorRes.rows &&
                creatorRes.rows.length > 0
                  ? creatorRes.rows[0].CREATOR_PUBLICKEY ||
                    creatorRes.rows[0].creator_publickey
                  : "";
              if (
                creatorPk &&
                creatorPk.toUpperCase() === escapeSql(pubkey).toUpperCase()
              ) {
                MDS.log(
                  "♻️ [GROUP-JOIN] Detected stale local role. Reconciling local role to admin from creator propagation."
                );
                var safeLocalPk = escapeSql(localPk);
                var promoteSql =
                  "UPDATE GROUP_MEMBERS SET role='admin' WHERE group_id='" +
                  safeGroupId +
                  "' AND UPPER(publickey)=UPPER('" +
                  safeLocalPk +
                  "')";
                MDS.sql(promoteSql, function (promRes) {
                  if (promRes.status && promRes.count === 0) {
                    var insertSql =
                      "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES ('" +
                      safeGroupId +
                      "', UPPER('" +
                      safeLocalPk +
                      "'), 'Unknown', " +
                      Date.now() +
                      ", 'admin')";
                    MDS.sql(insertSql, function () {
                      executeJoinRequestAuth(
                        pubkey,
                        maxjson,
                        safeGroupId,
                        safeTimestamp,
                        localPk
                      );
                    });
                    return;
                  }
                  executeJoinRequestAuth(
                    pubkey,
                    maxjson,
                    safeGroupId,
                    safeTimestamp,
                    localPk
                  );
                });
                return;
              }
              MDS.log(
                "⚠️ [GROUP-JOIN] Ignored. We are not an admin/creator of group " +
                  safeGroupId +
                  " (Role: " +
                  myRole +
                  ")"
              );
            });
            return;
          }
          MDS.log(
            "⚠️ [GROUP-JOIN] Ignored. We are not an admin/creator of group " +
              safeGroupId +
              " (Role: " +
              myRole +
              ")"
          );
          return;
        }

        // Check if auto-approve is enabled for this group
        var checkAutoApproveSql =
          "SELECT auto_approve, name, description, created_date, avatar FROM GROUPS WHERE group_id='" +
          safeGroupId +
          "'";
        MDS.sql(checkAutoApproveSql, function (groupRes) {
          var autoApproveEnabled = false;
          var groupName = "";
          var groupDesc = "";
          var groupAvatar = "";
          var groupCreatedDate = Date.now();
          if (groupRes.status && groupRes.rows && groupRes.rows.length > 0) {
            var row = groupRes.rows[0];
            autoApproveEnabled =
              row.AUTO_APPROVE === 1 ||
              row.auto_approve === 1 ||
              row.AUTO_APPROVE === true ||
              row.auto_approve === true ||
              String(row.AUTO_APPROVE).toUpperCase() === "TRUE" ||
              String(row.auto_approve).toUpperCase() === "TRUE";
            groupName = row.NAME || row.name || "";
            groupDesc = row.DESCRIPTION || row.description || "";
            groupAvatar = row.AVATAR || row.avatar || "";
            groupCreatedDate =
              row.CREATED_DATE || row.created_date || Date.now();
            MDS.log(
              "📝 [GROUP-JOIN] Found group info: " +
                groupName +
                " | auto_approve value: " +
                (row.AUTO_APPROVE !== undefined
                  ? row.AUTO_APPROVE
                  : row.auto_approve) +
                " | Type: " +
                typeof (row.AUTO_APPROVE !== undefined
                  ? row.AUTO_APPROVE
                  : row.auto_approve)
            );
          }
          MDS.log(
            "📝 [GROUP-JOIN] final autoApproveEnabled evaluated to: " +
              autoApproveEnabled
          );

          // =========================================================
          // A) NEW REQUEST: from a regular user wanting to join
          // =========================================================
          if (maxjson.messageType === "group_join_request") {
            var requesterPubkey = escapeSql(pubkey);
            var requesterName = escapeSql(maxjson.requesterName || "Unknown");
            var requesterAddress = escapeSql(maxjson.requesterAddress || "");
            MDS.log(
              "📝 [GROUP-JOIN] Processing new join request from " +
                requesterName +
                " (" +
                requesterPubkey.substring(0, 10) +
                ")",
            );

            // Helper: seed DISCOVERED_PEERS
            var seedRequesterPeer = function (onDone) {
              if (!requesterAddress) {
                onDone();
                return;
              }
              var now = Date.now();
              var delPeer =
                "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
                requesterPubkey +
                "')";
              MDS.sql(delPeer, function () {
                var insPeer =
                  "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" +
                  requesterPubkey +
                  "', '" +
                  requesterAddress +
                  "', 'GROUP_JOIN', '" +
                  requesterName +
                  "', " +
                  now +
                  ", '')";
                MDS.sql(insPeer, function () {
                  onDone();
                });
              });
            };

            // Helper: Auto-approve or Propagate
            var handleAutoApproveOrPropagate = function () {
              MDS.log(
                "📝 [GROUP-JOIN] handleAutoApproveOrPropagate: autoApproveEnabled=" +
                  autoApproveEnabled,
              );
              if (autoApproveEnabled) {
                MDS.log(
                  "🚀 [GROUP-JOIN] Auto-approving request for " + requesterName,
                );
                var now = Date.now();
                var addMemberSql =
                  "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) SELECT '" +
                  safeGroupId +
                  "', '" +
                  requesterPubkey +
                  "', '" +
                  requesterName +
                  "', " +
                  now +
                  ", 'member' WHERE NOT EXISTS (SELECT 1 FROM GROUP_MEMBERS WHERE group_id='" +
                  safeGroupId +
                  "' AND UPPER(publickey)=UPPER('" +
                  requesterPubkey +
                  "'))";

                MDS.sql(addMemberSql, function (addRes) {
                  if (addRes.status) {
                    sendMemberAddedNotificationSW(
                      safeGroupId,
                      groupName,
                      requesterPubkey,
                      requesterName,
                      requesterAddress,
                      localPk,
                    );
                    MDS.sql(
                      "SELECT publickey, username FROM GROUP_MEMBERS WHERE group_id='" +
                        safeGroupId +
                        "' AND (role='creator') LIMIT 1",
                      function (creatorRes) {
                        var creatorPk = localPk;
                        var creatorName = "Admin";
                        if (
                          creatorRes.status &&
                          creatorRes.rows &&
                          creatorRes.rows.length > 0
                        ) {
                          creatorPk =
                            creatorRes.rows[0].PUBLICKEY ||
                            creatorRes.rows[0].publickey;
                          creatorName =
                            creatorRes.rows[0].USERNAME ||
                            creatorRes.rows[0].username;
                        }
                        MDS.sql(
                          "SELECT * FROM GROUP_MEMBERS WHERE group_id='" +
                            safeGroupId +
                            "'",
                          function (membersRes) {
                            var members = membersRes.rows || [];
                            sendGroupInviteSW(
                              safeGroupId,
                              groupName,
                              groupDesc,
                              groupAvatar,
                              requesterPubkey,
                              localPk,
                              "Admin",
                              members,
                              groupCreatedDate,
                              creatorPk,
                              creatorName,
                            );
                          },
                        );
                      },
                    );
                    broadcastJoinRequestToAdmins(
                      "group_join_request_resolved",
                      safeGroupId,
                      requesterPubkey,
                      requesterName,
                      requesterAddress,
                      safeTimestamp,
                      "approved",
                    );
                    MDS.sql(
                      "DELETE FROM GROUP_JOIN_REQUESTS WHERE group_id='" +
                        safeGroupId +
                        "' AND publickey='" +
                        requesterPubkey +
                        "'",
                      function () {
                        MDS.comms.solo(
                          JSON.stringify({
                            type: "group_join_requests_update",
                            groupId: safeGroupId,
                          }),
                        );
                      },
                    );
                  }
                });
              } else {
                MDS.comms.solo(
                  JSON.stringify({
                    type: "group_join_requests_update",
                    groupId: safeGroupId,
                  }),
                );
                broadcastJoinRequestToAdmins(
                  "group_join_request_propagated",
                  safeGroupId,
                  requesterPubkey,
                  requesterName,
                  requesterAddress,
                  safeTimestamp,
                );
              }
            };

            // Helper: Re-send invite
            var reSendInviteToMember = function () {
              MDS.sql(
                "SELECT publickey, username FROM GROUP_MEMBERS WHERE group_id='" +
                  safeGroupId +
                  "' AND (role='creator') LIMIT 1",
                function (creatorRes) {
                  var creatorPk = localPk;
                  var creatorName = "Admin";
                  if (
                    creatorRes.status &&
                    creatorRes.rows &&
                    creatorRes.rows.length > 0
                  ) {
                    creatorPk =
                      creatorRes.rows[0].PUBLICKEY ||
                      creatorRes.rows[0].publickey;
                    creatorName =
                      creatorRes.rows[0].USERNAME ||
                      creatorRes.rows[0].username;
                  }
                  MDS.sql(
                    "SELECT * FROM GROUP_MEMBERS WHERE group_id='" +
                      safeGroupId +
                      "'",
                    function (membersRes) {
                      var members = membersRes.rows || [];
                      MDS.log(
                        "📤 [GROUP-JOIN] Re-sending group invite to " +
                          requesterPubkey.substring(0, 10),
                      );
                      sendGroupInviteSW(
                        safeGroupId,
                        groupName,
                        groupDesc,
                        groupAvatar,
                        requesterPubkey,
                        localPk,
                        "Admin",
                        members,
                        groupCreatedDate,
                        creatorPk,
                        creatorName,
                      );
                    },
                  );
                },
              );
            };

            // Check if already a member (case-insensitive to handle 0X vs 0x casing)
            var checkMemberSql =
              "SELECT * FROM GROUP_MEMBERS WHERE group_id='" +
              safeGroupId +
              "' AND UPPER(publickey)=UPPER('" +
              requesterPubkey +
              "')";
            MDS.sql(checkMemberSql, function (memberRes) {
              try {
                if (
                  memberRes.status &&
                  memberRes.rows &&
                  memberRes.rows.length > 0
                ) {
                  MDS.log(
                    "ℹ️ [GROUP-JOIN] User already a member. Re-sending invite just in case.",
                  );
                  reSendInviteToMember();
                  return;
                }
                // Check if banned
                var checkBanSql =
                  "SELECT * FROM GROUP_BANS WHERE group_id='" +
                  safeGroupId +
                  "' AND UPPER(publickey)=UPPER('" +
                  requesterPubkey +
                  "')";
                MDS.sql(checkBanSql, function (banRes) {
                  try {
                    MDS.log("🔍 [GROUP-JOIN-UNBAN] Ban check for requester " + requesterPubkey.substring(0, 10) + ": rows=" + (banRes.rows ? banRes.rows.length : 0) + " status=" + banRes.status);
                    if (
                      banRes.status &&
                      banRes.rows &&
                      banRes.rows.length > 0
                    ) {
                      MDS.log(
                        "🚫 [GROUP-JOIN] Discarding request from banned user.",
                      );
                      return;
                    }
                    MDS.log("✅ [GROUP-JOIN-UNBAN] Requester not banned, saving join request.");

                    // Insert/Replace in GROUP_JOIN_REQUESTS
                    var insertReqSql =
                      "MERGE INTO GROUP_JOIN_REQUESTS (group_id, publickey, username, address, status, timestamp) KEY (group_id, publickey) VALUES " +
                      "('" +
                      safeGroupId +
                      "', '" +
                      requesterPubkey +
                      "', '" +
                      requesterName +
                      "', '" +
                      requesterAddress +
                      "', 'pending', " +
                      safeTimestamp +
                      ")";

                    MDS.sql(insertReqSql, function (insertRes) {
                      try {
                        if (insertRes.status) {
                          MDS.log(
                            "✅ [GROUP-JOIN] Request saved locally (MERGE).",
                          );
                          seedRequesterPeer(handleAutoApproveOrPropagate);
                        } else {
                          // Fallback for older H2
                          var updateSql =
                            "UPDATE GROUP_JOIN_REQUESTS SET username='" +
                            requesterName +
                            "', address='" +
                            requesterAddress +
                            "', status='pending', timestamp=" +
                            safeTimestamp +
                            " WHERE group_id='" +
                            safeGroupId +
                            "' AND publickey='" +
                            requesterPubkey +
                            "'";
                          MDS.sql(updateSql, function (upRes) {
                            var afterSave = function () {
                              MDS.log(
                                "✅ [GROUP-JOIN] Request saved locally (Fallback).",
                              );
                              seedRequesterPeer(handleAutoApproveOrPropagate);
                            };
                            if (upRes.status && !upRes.count) {
                              var backupInsert =
                                "INSERT INTO GROUP_JOIN_REQUESTS (group_id, publickey, username, address, status, timestamp) VALUES ('" +
                                safeGroupId +
                                "', '" +
                                requesterPubkey +
                                "', '" +
                                requesterName +
                                "', '" +
                                requesterAddress +
                                "', 'pending', " +
                                safeTimestamp +
                                ")";
                              MDS.sql(backupInsert, function () {
                                afterSave();
                              });
                            } else {
                              afterSave();
                            }
                          });
                        }
                      } catch (e) {
                        MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
                      }
                    });
                  } catch (e) {
                    MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
                  }
                });
              } catch (e) {
                MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
              }
            });
          }

          // =========================================================
          // B) PROPAGATED REQUEST: Another admin received a request, syncing it to us
          // =========================================================
          else if (maxjson.messageType === "group_join_request_propagated") {
            var senderCheck =
              "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
              safeGroupId +
              "' AND UPPER(publickey)=UPPER('" +
              escapeSql(pubkey) +
              "')";
            MDS.sql(senderCheck, function (sRes) {
              try {
                if (!sRes.status || !sRes.rows || sRes.rows.length === 0) {
                  MDS.log(
                    "❌ [GROUP-JOIN] Propagated request ignored: sender not found.",
                  );
                  return;
                }
                var senderRole = sRes.rows[0].ROLE || sRes.rows[0].role;
                if (senderRole !== "admin" && senderRole !== "creator") {
                  MDS.log(
                    "❌ [GROUP-JOIN] Propagated request ignored: sender role is " +
                      senderRole,
                  );
                  return;
                }

                var reqPk = escapeSql(maxjson.requesterPubkey);
                var reqName = escapeSql(maxjson.requesterName);
                var reqAddr = escapeSql(maxjson.requesterAddress);
                var origTs = Number(maxjson.originalTimestamp) || safeTimestamp;

                var updateSql =
                  "UPDATE GROUP_JOIN_REQUESTS SET username='" +
                  reqName +
                  "', address='" +
                  reqAddr +
                  "', status='pending', timestamp=" +
                  origTs +
                  " WHERE group_id='" +
                  safeGroupId +
                  "' AND publickey='" +
                  reqPk +
                  "'";
                MDS.sql(updateSql, function (upRes) {
                  if (upRes.status && !upRes.count) {
                    var backupInsert =
                      "INSERT INTO GROUP_JOIN_REQUESTS (group_id, publickey, username, address, status, timestamp) VALUES ('" +
                      safeGroupId +
                      "', '" +
                      reqPk +
                      "', '" +
                      reqName +
                      "', '" +
                      reqAddr +
                      "', 'pending', " +
                      origTs +
                      ")";
                    MDS.sql(backupInsert, function () {
                      MDS.log("✅ [GROUP-JOIN] Propagated request saved.");
                      MDS.comms.solo(
                        JSON.stringify({
                          type: "group_join_requests_update",
                          groupId: safeGroupId,
                        }),
                      );
                    });
                  } else {
                    MDS.log("✅ [GROUP-JOIN] Propagated request updated.");
                    MDS.comms.solo(
                      JSON.stringify({
                        type: "group_join_requests_update",
                        groupId: safeGroupId,
                      }),
                    );
                  }
                });
              } catch (e) {
                MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
              }
            });
          }

          // =========================================================
          // C) RESOLVED REQUEST: Another admin Accepted/Denied it
          // =========================================================
          else if (maxjson.messageType === "group_join_request_resolved") {
            var senderCheck =
              "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
              safeGroupId +
              "' AND UPPER(publickey)=UPPER('" +
              escapeSql(pubkey) +
              "')";
            MDS.sql(senderCheck, function (sRes) {
              try {
                if (!sRes.status || !sRes.rows || sRes.rows.length === 0)
                  return;
                var senderRole = sRes.rows[0].ROLE || sRes.rows[0].role;
                if (senderRole !== "admin" && senderRole !== "creator") return;

                var reqPk = escapeSql(maxjson.requesterPubkey);
                var resolveSql =
                  "DELETE FROM GROUP_JOIN_REQUESTS WHERE group_id='" +
                  safeGroupId +
                  "' AND publickey='" +
                  reqPk +
                  "'";
                MDS.sql(resolveSql, function () {
                  MDS.comms.solo(
                    JSON.stringify({
                      type: "group_join_requests_update",
                      groupId: safeGroupId,
                    }),
                  );
                });
              } catch (e) {
                MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
              }
            });
          }
        });
      } catch (e) {
        MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
      }
    });
  } catch (err) {
    MDS.log("🔥 [GROUP-JOIN] Crash: " + err.message);
  }
}

function broadcastJoinRequestToAdmins(
  msgType,
  groupId,
  reqPubkey,
  reqName,
  reqAddress,
  timestamp,
  resolutionStatus
) {
  var sql =
    "SELECT * FROM GROUP_MEMBERS WHERE group_id='" +
    escapeSql(groupId) +
    "' AND (role='creator' OR role='admin')";
  MDS.sql(sql, function (res) {
    if (!res.status || !res.rows) return;
    var msg = {
      application: "metachain-group",
      messageType: msgType,
      groupId: groupId,
      requesterPubkey: reqPubkey,
      requesterName: reqName,
      requesterAddress: reqAddress,
      originalTimestamp: timestamp,
    };
    if (resolutionStatus) msg.resolutionStatus = resolutionStatus;
    var hexData = "0x" + utf8ToHex(JSON.stringify(msg)).toUpperCase();
    var sendToAdmin = function (index) {
      if (index >= res.rows.length) return;
      var adminPk = res.rows[index].PUBLICKEY || res.rows[index].publickey;
      if (adminPk.toUpperCase() === MY_MAXIMA_PK.toUpperCase()) {
        sendToAdmin(index + 1);
        return;
      }

      smartSend(
        adminPk,
        "metachain-group",
        hexData,
        "GROUP-ADMIN-NOTIFY",
        false,
      );
      sendToAdmin(index + 1);
    };
    sendToAdmin(0);
  });
}

function sendMaximaGroupMsg(toPk, payloadObj) {
  var hexData = "0x" + utf8ToHex(JSON.stringify(payloadObj)).toUpperCase();
  MDS.log(
    "🚀 [GROUP-MSG] Sending to " +
      toPk.substring(0, 10) +
      " type: " +
      payloadObj.messageType,
  );
  smartSend(toPk, "metachain-group", hexData, "GROUP-MSG", false);
}

function sendMemberAddedNotificationSW(
  groupId,
  groupName,
  newMemberPk,
  newMemberName,
  newMemberAddress,
  myPk
) {
  var sql =
    "SELECT publickey FROM GROUP_MEMBERS WHERE group_id='" +
    escapeSql(groupId) +
    "'";
  MDS.sql(sql, function (res) {
    if (!res.status || !res.rows) return;
    var notification = {
      application: "metachain-group",
      messageType: "group_member_added",
      groupId: groupId,
      groupName: groupName,
      memberPublicKey: newMemberPk,
      memberUsername: newMemberName,
      memberAddress: newMemberAddress,
    };
    for (var i = 0; i < res.rows.length; i++) {
      var mPk = res.rows[i].PUBLICKEY || res.rows[i].publickey;
      if (
        mPk.toUpperCase() !== myPk.toUpperCase() &&
        mPk.toUpperCase() !== newMemberPk.toUpperCase()
      ) {
        sendMaximaGroupMsg(mPk, notification);
      }
    }
  });
}

function sendGroupInviteSW(
  groupId,
  groupName,
  groupDesc,
  groupAvatar,
  toPk,
  myPk,
  myName,
  members,
  createdDate,
  creatorPk,
  creatorName
) {
  var normalizedMembers = [];
  for (var i = 0; i < (members || []).length; i++) {
    var member = members[i] || {};
    normalizedMembers.push({
      publickey: member.publickey || member.PUBLICKEY || "",
      username: member.username || member.USERNAME || "Unknown",
      role: member.role || member.ROLE || "member",
      address: member.address || member.ADDRESS || "",
    });
  }
  var invite = {
    application: "metachain-group",
    messageType: "group_invite",
    groupId: groupId,
    groupName: groupName,
    groupDescription: groupDesc,
    avatar: groupAvatar || "",
    members: normalizedMembers,
    createdDate: createdDate,
    creatorPublicKey: creatorPk,
    creatorUsername: creatorName,
  };
  sendMaximaGroupMsg(toPk, invite);
}
