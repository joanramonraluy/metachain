/**
 * MetaChain Service Worker - Channel Handler
 * Handles all Maxima messages for the metachain-channel application.
 */

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function channelRunSQL(query, callback) {
  MDS.sql(query, function (res) {
    if (callback) callback(res);
  });
}

// (Using shared helpers from utils.js)

// ─── Channel sync guard ─────────────────────────────────────────────────────
// Prevents multiple concurrent history requests for the same channel.
// Cleared on first response received or after timeout.
var _pendingChannelSyncs = {}; // channelId -> startedAt (Date.now())
var CHANNEL_SYNC_TIMEOUT_MS = 30000;

/**
 * Called from MDS_TIMER_10SECONDS in main.js.
 * Clears stale guards so a new sync can be triggered after timeout.
 */
function checkChannelSyncTimeouts() {
  var now = Date.now();
  for (var channelId in _pendingChannelSyncs) {
    if (!_pendingChannelSyncs.hasOwnProperty(channelId)) continue;
    if (now - _pendingChannelSyncs[channelId] > CHANNEL_SYNC_TIMEOUT_MS) {
      MDS.log("⏱️ [CHANNEL-SYNC] Timeout for " + channelId + ". Clearing guard.");
      delete _pendingChannelSyncs[channelId];
      MDS.comms.solo(JSON.stringify({ type: "CHANNEL_SYNC_END", channelId: channelId }));
    }
  }
}

// ---------------------------------------------------------------------------
// channel_invite
// ---------------------------------------------------------------------------

function handleChannelInvite(pubkey, maxjson) {
  try {
    MDS.log("📢 [CHANNEL] handleChannelInvite from " + pubkey.substring(0, 10));

    var channelId = maxjson.channelId;
    var channelName = (maxjson.channelName || "").replace(/'/g, "''");
    var description = (maxjson.description || "").replace(/'/g, "''");
    var adminPublickey = (maxjson.adminPublickey || pubkey).replace(/'/g, "''");
    var createdDate = maxjson.createdDate || maxjson.timestamp || Date.now();
    var avatar = "";
    if (typeof maxjson.avatar === "string") {
      avatar = maxjson.avatar.replace(/'/g, "''");
    }
    var myPublickey = maxjson.inviteePublickey || "";
    var myUsername = (maxjson.inviteeUsername || "Unknown").replace(/'/g, "''");

    // 1. Check if channel exists
    channelRunSQL(
      "SELECT channel_id FROM CHANNELS WHERE channel_id = '" + channelId + "'",
      function (res) {
        if (res.rows && res.rows.length > 0) {
          MDS.log(
            "ℹ️ [CHANNEL] Channel " + channelId + " already exists. Skipping.",
          );
          return;
        }

        // 2. Insert Channel
        var insChannel =
          "INSERT INTO CHANNELS (channel_id, name, description, admin_publickey, created_date, avatar) " +
          "VALUES ('" +
          channelId +
          "', '" +
          channelName +
          "', '" +
          description +
          "', '" +
          adminPublickey +
          "', " +
          createdDate +
          ", '" +
          avatar +
          "')";

        channelRunSQL(insChannel, function (insRes) {
          if (insRes.status) {
            // 3. Insert Me as subscriber
            var insMe =
              "INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role) " +
              "VALUES ('" +
              channelId +
              "', '" +
              myPublickey +
              "', '" +
              myUsername +
              "', " +
              Date.now() +
              ", 'subscriber')";

            channelRunSQL(insMe, function (subRes) {
              if (subRes.status) {
                MDS.log(
                  "✅ [CHANNEL] Successfully joined channel " + channelId,
                );

                // 4. Insert admin as subscriber so history sync can reach them
                var adminUsername = (maxjson.adminUsername || "Admin").replace(/'/g, "''");
                var insAdmin =
                  "MERGE INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role) " +
                  "KEY (channel_id, publickey) " +
                  "VALUES ('" + channelId + "', UPPER('" + adminPublickey + "'), '" + adminUsername + "', " + Date.now() + ", 'admin')";
                channelRunSQL(insAdmin, function () {
                  MDS.comms.solo(
                    JSON.stringify({
                      type: "CHANNEL_UPDATE",
                      channelId: channelId,
                    }),
                  );

                  // 5. Request history immediately after joining
                  requestChannelHistoryFromSW(channelId);
                });
              }
            });
          }
        });
      },
    );
  } catch (err) {
    MDS.log("🔥 [CHANNEL] CRASH in handleChannelInvite: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// channel_message
// ---------------------------------------------------------------------------

function handleChannelMessage(senderPublickey, maxjson, skipNotify) {
  if (!maxjson) return;
  var channelId = maxjson.channelId;
  var type = (maxjson.messageContentType || "text").replace(/'/g, "''");
  var message = (maxjson.message || "").replace(/'/g, "''");
  var filedata = (maxjson.filedata || "").replace(/'/g, "''");
  var date = maxjson.timestamp || Date.now();
  var senderUsername = (maxjson.senderUsername || "Unknown").replace(
    /'/g,
    "''",
  );

  MDS.log(
    "📢 [CHANNEL] handleChannelMessage from " +
    senderPublickey.substring(0, 10),
  );

  if (!channelId) {
    MDS.log("❌ [CHANNEL] channel_message missing channelId");
    return;
  }

  // 1. Check we actually have this channel (subscriber check)
  channelRunSQL(
    "SELECT channel_id FROM CHANNELS WHERE channel_id = '" + channelId + "'",
    function (res) {
      if (!res.rows || res.rows.length === 0) {
        MDS.log(
          "⚠️ [CHANNEL] Received message for unknown channel " +
          channelId +
          ". Ignoring.",
        );
        return;
      }

      var senderSeq = maxjson.sender_seq || 0;
      var forwarded = maxjson.forwarded ? 1 : 0;

      // 2. Duplicate Check
      var checkSql =
        "SELECT id FROM CHANNEL_MESSAGES WHERE channel_id='" +
        channelId +
        "' AND UPPER(sender_publickey)=UPPER('" +
        senderPublickey +
        "') AND date=" +
        date;
      MDS.sql(checkSql, function (checkRes) {
        if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
          MDS.log("ℹ️ [CHANNEL-MSG] Duplicate message detected. Ignoring.");
          return;
        }

        // 3. Gap Detection / Sequence Tracking
        var counterSql =
          "SELECT last_seen_seq FROM CHANNEL_MSG_COUNTERS WHERE channel_id='" +
          channelId +
          "' AND UPPER(sender_publickey)=UPPER('" +
          senderPublickey +
          "')";

        MDS.sql(counterSql, function (counterRes) {
          var lastSeen =
            counterRes.status && counterRes.rows && counterRes.rows.length > 0
              ? parseInt(counterRes.rows[0].LAST_SEEN_SEQ)
              : 0;

          if (senderSeq > 1 && senderSeq > lastSeen + 1) {
            MDS.log(
              "⚠️ [CHANNEL-GAP] Detected gap for " +
              channelId +
              ": last=" +
              lastSeen +
              ", new=" +
              senderSeq +
              ". Requesting history...",
            );
            requestChannelHistoryFromSW(channelId);
          }

          // 4. Save Message
          var cmd =
            "INSERT INTO CHANNEL_MESSAGES (channel_id, sender_publickey, sender_username, type, message, filedata, date, read, sender_seq, forwarded) " +
            "VALUES ('" +
            channelId +
            "', '" +
            senderPublickey +
            "', '" +
            senderUsername +
            "', '" +
            type +
            "', '" +
            message +
            "', '" +
            filedata +
            "', " +
            date +
            ", 0, " +
            senderSeq +
            ", " + (forwarded ? 1 : 0) + ")";

          channelRunSQL(cmd, function (insRes) {
            if (insRes.status) {
              // 5. Update Counter
              if (senderSeq > lastSeen) {
                var upCounterSql =
                  "MERGE INTO CHANNEL_MSG_COUNTERS (channel_id, sender_publickey, last_seen_seq) " +
                  "KEY (channel_id, sender_publickey) " +
                  "VALUES ('" +
                  channelId +
                  "', UPPER('" +
                  senderPublickey +
                  "'), " +
                  senderSeq +
                  ")";
                MDS.sql(upCounterSql);
              }

              // 6. Notify UI
              if (!skipNotify) {
                MDS.comms.solo(
                  JSON.stringify({
                    type: "CHANNEL_NEW_MESSAGE",
                    channelId: channelId,
                  }),
                );
              }
              MDS.log(
                "✅ [CHANNEL] Saved channel message for: " +
                channelId +
                " (seq: " +
                senderSeq +
                ")",
              );
            } else {
              MDS.log("❌ [CHANNEL] Save failed: " + insRes.error);
            }
          });
        });
      });
    },
  );
}

// ---------------------------------------------------------------------------
// History Sync
// ---------------------------------------------------------------------------

function handleChannelHistoryRequest(pubkey, maxjson) {
  var channelId = maxjson.channelId;
  var since = maxjson.historySince || 0;
  MDS.log(
    "🔄 [CHANNEL-SYNC] History requested for " + channelId + " since " + since,
  );

  MDS.cmd("maxima action:info", function (info) {
    var myPubkey = info.response.publickey;
    var sql =
      "SELECT * FROM CHANNEL_MESSAGES WHERE channel_id='" +
      escapeSql(channelId) +
      "' AND date > " +
      since +
      " ORDER BY date ASC LIMIT 50";
    MDS.sql(sql, function (res) {
      var historyMessages = [];
      if (res.status && res.rows && res.rows.length > 0) {
        for (var i = 0; i < res.rows.length; i++) {
          var row = res.rows[i];
          historyMessages.push({
            messageType: "channel_message",
            channelId: channelId,
            channelName: "",
            senderPublickey: row.SENDER_PUBLICKEY || row.sender_publickey,
            senderUsername: row.SENDER_USERNAME || row.sender_username,
            message: row.MESSAGE || row.message,
            messageContentType: row.TYPE || row.type,
            filedata: row.FILEDATA || row.filedata,
            timestamp: Number(row.DATE || row.date),
            sender_seq: Number(row.SENDER_SEQ || row.sender_seq || 0),
            forwarded: row.FORWARDED === true || row.FORWARDED === 'true' || row.FORWARDED === 1,
          });
        }
      }

      var responsePayload = {
        app: "metachain-channel",
        messageType: "channel_history_response",
        channelId: channelId,
        channelName: "",
        timestamp: Date.now(),
        historyMessages: historyMessages,
      };

      // Send history response with Address Resolution
      smartSend(pubkey, "metachain-channel", hexData, "CHANNEL-HISTORY-RESP", false);
    });
  });
}

function handleChannelHistoryResponse(pubkey, maxjson) {
  var channelId = maxjson.channelId;
  // Clear sync guard — response received
  delete _pendingChannelSyncs[channelId];

  var messages = maxjson.historyMessages || [];

  MDS.log(
    "🔄 [CHANNEL-SYNC] Received " +
    messages.length +
    " history messages for " +
    channelId,
  );

  // Save them using the regular handler logic (skip notify per message)
  for (var i = 0; i < messages.length; i++) {
    handleChannelMessage(messages[i].senderPublickey, messages[i], true);
  }

  // Single notification at the end
  MDS.comms.solo(
    JSON.stringify({
      type: "CHANNEL_NEW_MESSAGE",
      channelId: channelId,
    }),
  );
  // Signal sync end immediately
  MDS.comms.solo(
    JSON.stringify({
      type: "CHANNEL_SYNC_END",
      channelId: channelId,
    }),
  );
}

function requestChannelHistoryFromSW(channelId) {
  // Guard: skip if sync already in flight for this channel
  if (_pendingChannelSyncs[channelId]) {
    MDS.log("ℹ️ [CHANNEL-SYNC] Already in flight for " + channelId + ". Skipping.");
    return;
  }
  _pendingChannelSyncs[channelId] = Date.now();

  MDS.log(
    "🔄 [CHANNEL-SYNC] Requesting history for channel " + channelId + "...",
  );

  // Signal sync start
  MDS.comms.solo(
    JSON.stringify({
      type: "CHANNEL_SYNC_START",
      channelId: channelId,
    }),
  );

  MDS.cmd("maxima action:info", function (maxInfo) {
    if (!maxInfo.status) return;
    var myPubkey = maxInfo.response.publickey;

    var lastSql =
      "SELECT date FROM CHANNEL_MESSAGES WHERE channel_id='" +
      escapeSql(channelId) +
      "' ORDER BY date DESC LIMIT 1";
    MDS.sql(lastSql, function (lastRes) {
      var lastTimestamp =
        lastRes.status && lastRes.rows && lastRes.rows.length > 0
          ? Number(lastRes.rows[0].DATE || lastRes.rows[0].date || 0)
          : 0;

      var requestPayload = {
        app: "metachain-channel",
        messageType: "channel_history_request",
        channelId: channelId,
        channelName: "SYNC",
        timestamp: Date.now(),
        historySince: lastTimestamp,
      };
      var hexData =
        "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

      var subSql =
        "SELECT cs.publickey, dp.address FROM CHANNEL_SUBSCRIBERS cs LEFT JOIN DISCOVERED_PEERS dp ON UPPER(cs.publickey)=UPPER(dp.publickey) WHERE cs.channel_id='" +
        escapeSql(channelId) +
        "'";
      MDS.sql(subSql, function (subRes) {
        if (!subRes.status || !subRes.rows) {
          delete _pendingChannelSyncs[channelId];
          MDS.comms.solo(
            JSON.stringify({
              type: "CHANNEL_SYNC_END",
              channelId: channelId,
            }),
          );
          return;
        }
        var sentCount = 0;
        for (var i = 0; i < subRes.rows.length; i++) {
          var row = subRes.rows[i];
          var subPk = row.PUBLICKEY || row.publickey;
          if (subPk && myPubkey && subPk.toUpperCase() === myPubkey.toUpperCase()) continue;
          var addr = row.ADDRESS || row.address;
          // Use smartSend for address resolution fallback
          smartSend(subPk, "metachain-channel", hexData, "CHANNEL-HISTORY-SYNC", false, addr);
          sentCount++;
        }

        // No eligible remote peers (or only self): finish immediately.
        if (sentCount === 0) {
          MDS.log(
            "ℹ️ [CHANNEL-SYNC] No remote subscribers to request history from.",
          );
          delete _pendingChannelSyncs[channelId];
          MDS.comms.solo(
            JSON.stringify({
              type: "CHANNEL_SYNC_END",
              channelId: channelId,
            }),
          );
        }
      });
    });
  });
}

function requestAllChannelsHistory() {
  MDS.log("🔄 [CHANNEL-SYNC] Startup sync for all channels...");
  MDS.sql("SELECT channel_id FROM CHANNELS", function (res) {
    if (!res.status || !res.rows || res.rows.length === 0) return;
    for (var i = 0; i < res.rows.length; i++) {
      requestChannelHistoryFromSW(
        res.rows[i].CHANNEL_ID || res.rows[i].channel_id,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// channel_info_updated
// ---------------------------------------------------------------------------

function handleChannelInfoUpdate(pubkey, maxjson) {
  MDS.log(
    "📢 [CHANNEL] handleChannelInfoUpdate from " + pubkey.substring(0, 10),
  );

  var channelId = maxjson.channelId;
  if (!channelId) return;

  var updates = [];
  if (maxjson.newName)
    updates.push("name='" + maxjson.newName.replace(/'/g, "''") + "'");
  if (maxjson.newDescription !== undefined)
    updates.push(
      "description='" +
      (maxjson.newDescription || "").replace(/'/g, "''") +
      "'",
    );
  if (maxjson.avatar !== undefined)
    updates.push("avatar='" + (maxjson.avatar || "").replace(/'/g, "''") + "'");

  if (updates.length === 0) return;

  var cmd =
    "UPDATE CHANNELS SET " +
    updates.join(", ") +
    " WHERE channel_id='" +
    channelId +
    "'";
  channelRunSQL(cmd, function (res) {
    if (res.status) {
      MDS.log("✅ [CHANNEL-UPDATE] Real-time info update for " + channelId);
      MDS.comms.solo(
        JSON.stringify({
          type: "CHANNEL_UPDATE",
          channelId: channelId,
        }),
      );
    } else {
      MDS.log("❌ [CHANNEL] handleChannelInfoUpdate error: " + res.error);
    }
  });
}

// ---------------------------------------------------------------------------
// channel_role_update
// ---------------------------------------------------------------------------

function handleChannelRoleUpdate(pubkey, maxjson) {
  MDS.log(
    "📢 [CHANNEL] handleChannelRoleUpdate from " + pubkey.substring(0, 10),
  );

  var channelId = maxjson.channelId;
  var targetPubkey = (maxjson.targetPubkey || "").replace(/'/g, "''");
  var newRole = (maxjson.newRole || "subscriber").replace(/'/g, "''");

  if (!channelId || !targetPubkey) {
    MDS.log(
      "❌ [CHANNEL-ROLE] Missing required fields (channelId or targetPubkey)",
    );
    return;
  }

  var checkSenderSql =
    "SELECT role FROM CHANNEL_SUBSCRIBERS WHERE channel_id='" +
    channelId +
    "' AND publickey='" +
    pubkey +
    "'";
  MDS.sql(checkSenderSql, function (resSender) {
    if (!resSender.status || !resSender.rows || resSender.rows.length === 0)
      return;

    var senderRole = (
      resSender.rows[0].ROLE ||
      resSender.rows[0].role ||
      ""
    ).toLowerCase();
    if (senderRole !== "admin") return;

    var updateSql =
      "UPDATE CHANNEL_SUBSCRIBERS SET role='" +
      newRole +
      "' WHERE channel_id='" +
      channelId +
      "' AND publickey='" +
      targetPubkey +
      "'";
    channelRunSQL(updateSql, function (updateRes) {
      if (updateRes.status) {
        MDS.comms.solo(
          JSON.stringify({ type: "CHANNEL_UPDATE", channelId: channelId }),
        );
      }
    });
  });
}

// ---------------------------------------------------------------------------
// channel_join_request
// ---------------------------------------------------------------------------

function handleChannelJoinRequest(pubkey, maxjson) {
  try {
    var channelId = maxjson.channelId;
    var requesterName = (maxjson.requesterName || "Anonymous").replace(
      /'/g,
      "''",
    );
    var requesterAddress = (maxjson.requesterAddress || pubkey).replace(
      /'/g,
      "''",
    );

    MDS.log(
      "🎟️ [CHANNEL] Join request for " + channelId + " from " + requesterName,
    );

    MDS.cmd("maxima action:info", function (info) {
      var myPubkey = info.response.publickey;
      var myName = (info.response.name || "Admin").replace(/'/g, "''");

      // 1. Get channel info
      MDS.sql(
        "SELECT * FROM CHANNELS WHERE channel_id='" + channelId + "'",
        function (chanRes) {
          if (!chanRes.rows || chanRes.rows.length === 0) return;
          var chan = chanRes.rows[0];

          // 2. Add subscriber
          var insSub =
            "INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role) " +
            "VALUES ('" +
            channelId +
            "', '" +
            pubkey +
            "', '" +
            requesterName +
            "', " +
            Date.now() +
            ", 'subscriber')";

          MDS.sql(insSub, function (insRes) {
            if (!insRes.status) return;

            // 3. Send INVITE back (as "acceptance")
            var invitePayload = {
              app: "metachain-channel",
              messageType: "channel_invite",
              channelId: channelId,
              channelName: chan.NAME || chan.name,
              description: chan.DESCRIPTION || chan.description || "",
              adminPublickey: myPubkey,
              adminUsername: myName,
              createdDate: chan.CREATED_DATE || chan.created_date,
              avatar: chan.AVATAR || chan.avatar || "",
              inviteePublickey: pubkey,
              inviteeUsername: requesterName,
              timestamp: Date.now(),
            };

            // 3. Send INVITE back (as "acceptance") via smartSend
            smartSend(pubkey, "metachain-channel", hexData, "CHANNEL-JOIN-ACCEPT", false, requesterAddress);

            // 4. Send SYSTEM MESSAGE locally
            var systemMsg = requesterName + " joined the channel";
            var insSys =
              "INSERT INTO CHANNEL_MESSAGES (channel_id, sender_publickey, sender_username, type, message, date, read) " +
              "VALUES ('" +
              channelId +
              "', 'system', 'system', 'system', '" +
              systemMsg +
              "', " +
              Date.now() +
              ", 0)";
            MDS.sql(insSys);

            MDS.comms.solo(
              JSON.stringify({
                type: "CHANNEL_NEW_MESSAGE",
                channelId: channelId,
              }),
            );
          });
        },
      );
    });
  } catch (err) { }
}

// ---------------------------------------------------------------------------
// channel_subscriber_added / channel_subscriber_removed
// Called from main.js when the channel admin broadcasts a membership change.
// ---------------------------------------------------------------------------

function handleChannelSubscriberAdded(pubkey, maxjson) {
  var channelId = maxjson.channelId;
  var newPubkey = maxjson.subscriberPublickey || maxjson.publickey;
  var newUsername = maxjson.subscriberUsername || maxjson.username || "Unknown";
  if (!channelId || !newPubkey) return;

  MDS.log("📢 [CHANNEL] Subscriber added to " + channelId + ": " + newPubkey.substring(0, 10));

  var upsertSql =
    "MERGE INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, role) " +
    "KEY (channel_id, publickey) " +
    "VALUES ('" + escapeSql(channelId) + "', '" + escapeSql(newPubkey) + "', '" +
    escapeSql(newUsername) + "', 'subscriber')";
  MDS.sql(upsertSql, function () {
    MDS.comms.solo(JSON.stringify({ type: "CHANNEL_UPDATE", channelId: channelId }));
  });
}

function handleChannelSubscriberRemoved(pubkey, maxjson) {
  var channelId = maxjson.channelId;
  var removedPubkey = maxjson.subscriberPublickey || maxjson.publickey;
  if (!channelId || !removedPubkey) return;

  MDS.log("📢 [CHANNEL] Subscriber removed from " + channelId + ": " + removedPubkey.substring(0, 10));

  var delSql =
    "DELETE FROM CHANNEL_SUBSCRIBERS WHERE channel_id='" + escapeSql(channelId) +
    "' AND UPPER(publickey)=UPPER('" + escapeSql(removedPubkey) + "')";
  MDS.sql(delSql, function () {
    MDS.comms.solo(JSON.stringify({ type: "CHANNEL_UPDATE", channelId: channelId }));
  });
}
