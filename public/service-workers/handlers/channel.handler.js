/**
 * MetaChain Service Worker - Channel Handler
 * Handles all Maxima messages for the metachain-channel application.
 *
 * Message types:
 *  - channel_invite          — Admin invites a subscriber. Saves channel + subscriber locally.
 *  - channel_message         — Admin publishes a message. Saves to CHANNEL_MESSAGES.
 *  - channel_subscriber_added   — Notifies other admins/subscribers of a new subscriber.
 *  - channel_subscriber_removed — Removes a subscriber from the local DB.
 */

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function channelRunSQL(query, callback) {
    MDS.sql(query, function (res) {
        if (callback) callback(res);
    });
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
        if (typeof maxjson.avatar === 'string') {
            avatar = maxjson.avatar.replace(/'/g, "''");
        }
        var myPublickey = maxjson.inviteePublickey || "";
        var myUsername = (maxjson.inviteeUsername || "Unknown").replace(/'/g, "''");
        var adminUsername = (maxjson.adminUsername || "Unknown").replace(/'/g, "''");

        if (!channelId) {
            MDS.log("❌ [CHANNEL] channel_invite missing channelId");
            return;
        }

        // 1. Upsert channel (We use DELETE + INSERT to simulate UPSERT/MERGE safely for H2)
        MDS.sql("DELETE FROM CHANNELS WHERE channel_id='" + channelId + "'", function (delRes) {
            if (delRes && !delRes.status) MDS.log("⚠️ DELETE CHANNELS error: " + delRes.error);
            var q1 = "INSERT INTO CHANNELS (channel_id, name, description, admin_publickey, created_date, avatar) " +
                "VALUES ('" + channelId + "', '" + channelName + "', '" + description + "', '" + adminPublickey + "', " + createdDate + ", '" + avatar + "')";
            channelRunSQL(q1, function (res1) {
                if (!res1.status) MDS.log("❌ INSERT CHANNELS error: " + res1.error);

                // 2. Upsert admin
                MDS.sql("DELETE FROM CHANNEL_SUBSCRIBERS WHERE channel_id='" + channelId + "' AND publickey='" + adminPublickey + "'", function () {
                    var q2 = "INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role) " +
                        "VALUES ('" + channelId + "', '" + adminPublickey + "', '" + adminUsername + "', " + createdDate + ", 'admin')";
                    channelRunSQL(q2, function (res2) {
                        if (!res2.status) MDS.log("❌ INSERT CHANNEL_SUBSCRIBERS (admin) error: " + res2.error);

                        // 3. Upsert myself
                        var finishInvite = function () {
                            MDS.comms.solo(JSON.stringify({
                                type: "CHANNEL_INVITE_RECEIVED",
                                channelId: channelId,
                                channelName: maxjson.channelName
                            }));
                            MDS.log("✅ [CHANNEL] Saved channel invite: " + channelId);
                        };

                        if (myPublickey) {
                            var cleanMyPk = myPublickey.replace(/'/g, "''");
                            MDS.sql("DELETE FROM CHANNEL_SUBSCRIBERS WHERE channel_id='" + channelId + "' AND publickey='" + cleanMyPk + "'", function () {
                                var q3 = "INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role) " +
                                    "VALUES ('" + channelId + "', '" + cleanMyPk + "', '" + myUsername + "', " + Date.now() + ", 'subscriber')";
                                channelRunSQL(q3, function (res3) {
                                    if (!res3.status) MDS.log("❌ INSERT CHANNEL_SUBSCRIBERS (self) error: " + res3.error);
                                    finishInvite();
                                });
                            });
                        } else {
                            finishInvite();
                        }
                    });
                });
            });
        });
    } catch (err) {
        MDS.log("🔥 [CHANNEL] CRASH in handleChannelInvite: " + err.message + " " + err.stack);
    }
}

// ---------------------------------------------------------------------------
// channel_message
// ---------------------------------------------------------------------------

function handleChannelMessage(pubkey, maxjson) {
    MDS.log("📢 [CHANNEL] handleChannelMessage from " + pubkey.substring(0, 10));

    var channelId = maxjson.channelId;
    var senderPublickey = (pubkey || "").replace(/'/g, "''");
    var senderUsername = (maxjson.senderUsername || "Unknown").replace(/'/g, "''");
    var type = (maxjson.messageContentType || "text").replace(/'/g, "''");
    var message = (maxjson.message || "").replace(/'/g, "''");
    var filedata = (maxjson.filedata || "").replace(/'/g, "''");
    var date = maxjson.timestamp || Date.now();

    if (!channelId) {
        MDS.log("❌ [CHANNEL] channel_message missing channelId");
        return;
    }

    // Check we actually have this channel (subscriber check)
    channelRunSQL("SELECT channel_id FROM CHANNELS WHERE channel_id = '" + channelId + "'", function (res) {
        if (!res.rows || res.rows.length === 0) {
            MDS.log("⚠️ [CHANNEL] Received message for unknown channel " + channelId + ". Ignoring.");
            return;
        }

        var cmd = "INSERT INTO CHANNEL_MESSAGES (channel_id, sender_publickey, sender_username, type, message, filedata, date, read) " +
            "VALUES ('" + channelId + "', '" + senderPublickey + "', '" + senderUsername + "', '" + type + "', '" + message + "', '" + filedata + "', " + date + ", 0)";

        channelRunSQL(cmd, function (insRes) {
            if (insRes.status) {
                MDS.comms.solo(JSON.stringify({
                    type: "CHANNEL_NEW_MESSAGE",
                    channelId: channelId
                }));
                MDS.log("✅ [CHANNEL] Saved channel message for: " + channelId);
            } else {
                MDS.log("❌ [CHANNEL] handleChannelMessage save error: " + insRes.error);
            }
        });
    });
}

// ---------------------------------------------------------------------------
// channel_subscriber_added
// ---------------------------------------------------------------------------

function handleChannelSubscriberAdded(pubkey, maxjson) {
    MDS.log("📢 [CHANNEL] handleChannelSubscriberAdded");

    var channelId = maxjson.channelId;
    var subscriberPubkey = (maxjson.subscriberPublickey || "").replace(/'/g, "''");
    var subscriberUsername = (maxjson.subscriberUsername || "Unknown").replace(/'/g, "''");
    var joinedDate = maxjson.timestamp || Date.now();

    if (!channelId || !subscriberPubkey) return;

    MDS.sql("DELETE FROM CHANNEL_SUBSCRIBERS WHERE channel_id='" + channelId + "' AND publickey='" + subscriberPubkey + "'", function () {
        var cmd = "INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role) " +
            "VALUES ('" + channelId + "', '" + subscriberPubkey + "', '" + subscriberUsername + "', " + joinedDate + ", 'subscriber')";

        channelRunSQL(cmd, function (res) {
            if (res.status) {
                MDS.comms.solo(JSON.stringify({
                    type: "CHANNEL_SUBSCRIBER_ADDED",
                    channelId: channelId
                }));
                MDS.log("✅ [CHANNEL] Subscriber added: " + subscriberPubkey.substring(0, 10));
            } else {
                MDS.log("❌ [CHANNEL] handleChannelSubscriberAdded error: " + res.error);
            }
        });
    });
}

// ---------------------------------------------------------------------------
// channel_subscriber_removed
// ---------------------------------------------------------------------------

function handleChannelSubscriberRemoved(pubkey, maxjson) {
    MDS.log("📢 [CHANNEL] handleChannelSubscriberRemoved");

    var channelId = maxjson.channelId;
    var subscriberPubkey = (maxjson.subscriberPublickey || "").replace(/'/g, "''");

    if (!channelId || !subscriberPubkey) return;

    var cmd = "DELETE FROM CHANNEL_SUBSCRIBERS WHERE channel_id='" + channelId + "' AND UPPER(publickey)=UPPER('" + subscriberPubkey + "')";
    channelRunSQL(cmd, function (res) {
        if (res.status) {
            MDS.comms.solo(JSON.stringify({
                type: "CHANNEL_SUBSCRIBER_REMOVED",
                channelId: channelId
            }));
            MDS.log("✅ [CHANNEL] Subscriber removed: " + subscriberPubkey.substring(0, 10));
        } else {
            MDS.log("❌ [CHANNEL] handleChannelSubscriberRemoved error: " + res.error);
        }
    });
}

// ---------------------------------------------------------------------------
// channel_role_update
// ---------------------------------------------------------------------------

function handleChannelRoleUpdate(pubkey, maxjson) {
    MDS.log("📢 [CHANNEL] handleChannelRoleUpdate from " + pubkey.substring(0, 10));

    var channelId = maxjson.channelId;
    var targetPubkey = (maxjson.targetPubkey || "").replace(/'/g, "''");
    var newRole = (maxjson.newRole || "subscriber").replace(/'/g, "''");

    if (!channelId || !targetPubkey) {
        MDS.log("❌ [CHANNEL-ROLE] Missing required fields (channelId or targetPubkey)");
        return;
    }

    // 1. Check if sender is admin of this channel
    var checkSenderSql = "SELECT role FROM CHANNEL_SUBSCRIBERS WHERE channel_id='" + channelId + "' AND publickey='" + pubkey + "'";
    MDS.sql(checkSenderSql, function (resSender) {
        if (!resSender.status || !resSender.rows || resSender.rows.length === 0) {
            MDS.log("❌ [CHANNEL-ROLE] Unauthorized. Sender not in channel.");
            return;
        }

        var senderRole = (resSender.rows[0].ROLE || resSender.rows[0].role || "").toLowerCase();
        if (senderRole !== 'admin') {
            MDS.log("❌ [CHANNEL-ROLE] Unauthorized. Sender role is: " + senderRole);
            return;
        }

        // 2. Perform the update
        var updateSql = "UPDATE CHANNEL_SUBSCRIBERS SET role='" + newRole + "' WHERE channel_id='" + channelId + "' AND publickey='" + targetPubkey + "'";
        channelRunSQL(updateSql, function (updateRes) {
            if (updateRes.status) {
                MDS.log("✅ [DB] Channel Role for " + targetPubkey.substring(0, 10) + " updated to " + newRole);

                // Notify frontend
                MDS.comms.solo(JSON.stringify({
                    type: "CHANNEL_UPDATE",
                    channelId: channelId
                }));
            } else {
                MDS.log("❌ [DB] Role update error: " + updateRes.error);
            }
        });
    });
}

