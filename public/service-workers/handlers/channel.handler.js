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
                MDS.comms.solo(
                  JSON.stringify({
                    type: "CHANNEL_UPDATE",
                    channelId: channelId,
                  }),
                );

                // 4. Request history immediately after joining
                requestChannelHistoryFromSW(channelId);
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

      // 2. Duplicate Check
      var checkSql =
        "SELECT id FROM CHANNEL_MESSAGES WHERE channel_id='" +
        channelId +
        "' AND sender_publickey='" +
        senderPublickey +
        "' AND date=" +
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
          "' AND sender_publickey='" +
          senderPublickey +
          "'";

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
            "INSERT INTO CHANNEL_MESSAGES (channel_id, sender_publickey, sender_username, type, message, filedata, date, read, sender_seq) " +
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
            ")";

          channelRunSQL(cmd, function (insRes) {
            if (insRes.status) {
              // 5. Update Counter
              if (senderSeq > lastSeen) {
                var upCounterSql =
                  "INSERT INTO CHANNEL_MSG_COUNTERS (channel_id, sender_publickey, last_seen_seq) VALUES ('" +
                  channelId +
                  "', '" +
                  senderPublickey +
                  "', " +
                  senderSeq +
                  ") " +
                  "ON CONFLICT(channel_id, sender_publickey) DO UPDATE SET last_seen_seq = " +
                  senderSeq;
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

      var hexData =
        "0x" + utf8ToHex(JSON.stringify(responsePayload)).toUpperCase();
      MDS.cmd(
        "maxima action:send publickey:" +
        pubkey +
        " application:metachain-channel data:" +
        hexData +
        " poll:false",
      );
    });
  });
}

function handleChannelHistoryResponse(pubkey, maxjson) {
  var channelId = maxjson.channelId;
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
          if (subPk === myPubkey) continue;
          var addr = row.ADDRESS || row.address;
          var cleanAddr = addr
            ? addr.replace(/\s+/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "")
            : null;
          var cmd =
            cleanAddr &&
              (cleanAddr.startsWith("Mx") || cleanAddr.startsWith("MX"))
              ? "maxima action:send to:" +
              cleanAddr +
              " application:metachain-channel data:" +
              hexData +
              " poll:false"
              : "maxima action:send publickey:" +
              subPk +
              " application:metachain-channel data:" +
              hexData +
              " poll:false";
          MDS.cmd(cmd);
          sentCount++;
        }

        // No eligible remote peers (or only self): finish immediately.
        if (sentCount === 0) {
          MDS.log(
            "ℹ️ [CHANNEL-SYNC] No remote subscribers to request history from.",
          );
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

            var hexData =
              "0x" + utf8ToHex(JSON.stringify(invitePayload)).toUpperCase();
            MDS.cmd(
              "maxima action:send to:" +
              requesterAddress +
              " application:metachain-channel data:" +
              hexData +
              " poll:false",
            );

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
