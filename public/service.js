/**
 * MetaChain Service Worker
 * Processes incoming Maxima messages even when app is closed
 */

// Convert HEX to UTF8
function hexToUtf8(s) {
    return decodeURIComponent(
        s.replace(/\s+/g, '') // remove spaces
            .replace(/[0-9A-F]{2}/g, '%$&') // add '%' before each 2 characters
    );
}

// Convert UTF8 to HEX
function utf8ToHex(s) {
    var r = "";
    var utf8 = unescape(encodeURIComponent(s));
    for (var i = 0; i < utf8.length; i++) {
        var b = utf8.charCodeAt(i);
        r += ("0" + b.toString(16)).slice(-2);
    }
    return r;
}

// Main message handler
MDS.init(function (msg) {

    // Do initialisation
    if (msg.event == "inited") {
        MDS.log("[ServiceWorker] STARTING UP - Version 0.0.1");

        // Create the DB if not exists (using same schema as main app)
        var initsql = "CREATE TABLE IF NOT EXISTS CHAT_MESSAGES ( "
            + "  id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            + "  roomname varchar(160) NOT NULL, "
            + "  publickey varchar(512) NOT NULL, "
            + "  username varchar(160) NOT NULL, "
            + "  type varchar(64) NOT NULL, "
            + "  message varchar(512) NOT NULL, "
            + "  filedata clob(256K) NOT NULL, "
            + "  customid varchar(128) NOT NULL DEFAULT '0x00', "
            + "  state varchar(128) NOT NULL DEFAULT '', "
            + "  read int NOT NULL DEFAULT 0, "
            + "  amount int NOT NULL DEFAULT 0, "
            + "  date bigint NOT NULL "
            + " )";

        // Run this
        MDS.sql(initsql, function (res) {
            MDS.log("[ServiceWorker] MetaChain DB initialized: " + JSON.stringify(res));
            // Add amount column to existing tables if it doesn't exist
            var alterSql = "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS amount INT NOT NULL DEFAULT 0";
            MDS.sql(alterSql, function (alterRes) {
                MDS.log("[ServiceWorker] Amount column added/verified: " + JSON.stringify(alterRes));
            });

            // Create CHAT_STATUS table for managing archived chats, last opened time, and favorites
            var chatStatusSql = "CREATE TABLE IF NOT EXISTS CHAT_STATUS ( "
                + "  publickey VARCHAR(512) PRIMARY KEY, "
                + "  archived BOOLEAN NOT NULL DEFAULT FALSE, "
                + "  archived_date BIGINT, "
                + "  last_opened BIGINT, "
                + "  favorite BOOLEAN NOT NULL DEFAULT FALSE "
                + " )";

            MDS.sql(chatStatusSql, function (statusRes) {
                MDS.log("[ServiceWorker] CHAT_STATUS table initialized: " + JSON.stringify(statusRes));

                // Add favorite column to existing tables if it doesn't exist
                var alterFavoriteSql = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE";
                MDS.sql(alterFavoriteSql, function (alterRes) {
                    MDS.log("[ServiceWorker] Favorite column added/verified: " + JSON.stringify(alterRes));
                });
            });

            // Create MY_PROFILE table for extended community profile
            var myProfileSql = "CREATE TABLE IF NOT EXISTS MY_PROFILE ( "
                + "  id INT PRIMARY KEY DEFAULT 1, "
                + "  avatar TEXT, "
                + "  tags TEXT, "
                + "  bio_extended TEXT, "
                + "  social_links TEXT, "
                + "  location TEXT, "
                + "  last_updated BIGINT "
                + " )";

            MDS.sql(myProfileSql, function (profileRes) {
                MDS.log("[ServiceWorker] MY_PROFILE table initialized: " + JSON.stringify(profileRes));
            });

            // Create PROFILE_CACHE table for caching other users' profiles
            var profileCacheSql = "CREATE TABLE IF NOT EXISTS PROFILE_CACHE ( "
                + "  publickey VARCHAR(512) PRIMARY KEY, "
                + "  online_status VARCHAR(20), "
                + "  last_ping BIGINT, "
                + "  last_pong BIGINT, "
                + "  avatar TEXT, "
                + "  tags TEXT, "
                + "  bio_extended TEXT, "
                + "  social_links TEXT, "
                + "  location TEXT, "
                + "  fetched_at BIGINT "
                + " )";

            MDS.sql(profileCacheSql, function (cacheRes) {
                MDS.log("[ServiceWorker] PROFILE_CACHE table initialized: " + JSON.stringify(cacheRes));
            });
        });

        // Only interested in Maxima
    } else if (msg.event == "MAXIMA") {

        MDS.log("[ServiceWorker] MAXIMA event received. App: " + msg.data.application);

        // Is it for metachain?
        if (msg.data.application && (msg.data.application.toLowerCase() == "metachain" || msg.data.application.toLowerCase() == "metachain-group")) {
            var app = msg.data.application.toLowerCase();

            // Relevant data
            var pubkey = msg.data.from;

            // Remove the leading 0x
            var datastr = msg.data.data.substring(2);

            // Convert the data
            var jsonstr = hexToUtf8(datastr);

            // And create the actual JSON
            try {
                var maxjson = JSON.parse(jsonstr);

                MDS.log("[ServiceWorker] Parsed message from " + app + ": " + JSON.stringify(maxjson));

                // Handle History Sync Messages (ignore in SW, handled by App)
                if (app === "metachain-group" && (maxjson.messageType === "history_request" || maxjson.messageType === "history_response")) {
                    MDS.log("[ServiceWorker] Ignoring Group Sync Message: " + maxjson.messageType);
                    return;
                }

                // Handle Group Messages (metachain-group or legacy with groupId)
                if ((app === "metachain-group" && maxjson.messageType === "group_message") || (maxjson.groupId && maxjson.messageType === "group_message")) {
                    MDS.log("[ServiceWorker] Processing Group Message");

                    // Ensure GROUP_MESSAGES table exists (in case service.js runs before app)
                    // We assume it exists if app ran. If not, inserting will fail, but that's acceptable for now.

                    // MIGRATION: Ensure propagated column exists
                    // We try to add it. If it fails (exists), we ignore.
                    var migrationSql = "ALTER TABLE GROUP_MESSAGES ADD COLUMN propagated INT DEFAULT 0";
                    MDS.sql(migrationSql, function (migRes) {
                        MDS.log("[ServiceWorker] Migration attempt result: " + JSON.stringify(migRes));

                        // URL encode the message
                        var encoded = encodeURIComponent(maxjson.message || "").replace(/'/g, "%27");
                        var messageTimestamp = maxjson.timestamp || Date.now();

                        // FIX: Use ORIGINAL sender's public key (from payload), not the relayer's (msg.data.from)
                        var originalSender = maxjson.senderPublickey || pubkey;

                        // Check for duplicates before inserting
                        // We select ID and PROPAGATED. If propagated column is missing (migration failed significantly), this might fail.
                        var checkSql = "SELECT id, propagated FROM GROUP_MESSAGES WHERE group_id='" + maxjson.groupId + "' AND sender_publickey='" + originalSender + "' AND date=" + messageTimestamp;

                        MDS.sql(checkSql, function (checkRes) {
                            MDS.log("[ServiceWorker] Duplicate check result: " + JSON.stringify(checkRes));

                            var shouldPropagate = false;

                            if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
                                // Message exists. Check if it has been propagated.
                                var row = checkRes.rows[0];
                                var isPropagated = (row.PROPAGATED === 1 || row.propagated === 1);

                                if (isPropagated) {
                                    MDS.log("[ServiceWorker] Duplicate group message already propagated. Ignoring.");
                                    return;
                                } else {
                                    MDS.log("[ServiceWorker] Message exists but NOT propagated. Propagating now.");
                                    shouldPropagate = true;
                                    // Update propagated flag (if column exists)
                                    MDS.sql("UPDATE GROUP_MESSAGES SET propagated=1 WHERE id=" + row.ID);
                                }
                            } else {
                                // Not a duplicate (or DB query failed), insert it with propagated=1
                                if (!checkRes.status) {
                                    MDS.log("[ServiceWorker] Duplicate check failed (table missing column?), trying to insert/propagate anyway.");
                                }

                                shouldPropagate = true;
                                var groupMsgSql = "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated) VALUES "
                                    + "('" + maxjson.groupId + "','" + originalSender + "','" + maxjson.senderUsername + "','" + (maxjson.type || "text") + "','" + encoded + "','" + (maxjson.filedata || "") + "'," + messageTimestamp + ", 0, 1)";

                                MDS.sql(groupMsgSql, function (res) {
                                    if (res.status) {
                                        MDS.log("[ServiceWorker] Group message saved to DB (propagated=1).");
                                    } else {
                                        MDS.log("[ServiceWorker] Failed to save group message (maybe column missing?): " + res.error);
                                        // If insert failed because propagated column is missing, try inserting without it
                                        // But we still want to propagate!
                                        if (res.error && res.error.indexOf('propagated') !== -1) {
                                            var retrySql = "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read) VALUES "
                                                + "('" + maxjson.groupId + "','" + originalSender + "','" + maxjson.senderUsername + "','" + (maxjson.type || "text") + "','" + encoded + "','" + (maxjson.filedata || "") + "'," + messageTimestamp + ", 0)";
                                            MDS.sql(retrySql);
                                        }
                                    }
                                });
                            }

                            if (shouldPropagate) {
                                MDS.log("[ServiceWorker] Starting propagation process...");
                                // PROPAGATION: Re-broadcast to my contacts who are in this group
                                // 1. Get group members
                                var membersSql = "SELECT * FROM GROUP_MEMBERS WHERE group_id='" + maxjson.groupId + "'";
                                MDS.sql(membersSql, function (memberRes) {
                                    if (!memberRes.status || !memberRes.rows) {
                                        MDS.log("[ServiceWorker] Failed to fetch group members for propagation.");
                                        return;
                                    }

                                    var members = memberRes.rows;
                                    MDS.log("[ServiceWorker] Found " + members.length + " members in group. Fetching contacts...");

                                    // 2. Get my contacts
                                    MDS.cmd("maxcontacts", function (contactRes) {
                                        if (!contactRes.status || !contactRes.response.contacts) {
                                            MDS.log("[ServiceWorker] Failed to fetch contacts.");
                                            return;
                                        }

                                        var contacts = contactRes.response.contacts;
                                        // Fetch my public key securely
                                        MDS.cmd("maxima", function (maximaRes) {
                                            var myPubkey = maximaRes.response.publickey;

                                            // 3. Filter and send
                                            var propagatedCount = 0;
                                            for (var i = 0; i < members.length; i++) {
                                                var m = members[i];
                                                var memberPubkey = m.PUBLICKEY;

                                                // Skip sender (pubkey is the sender of THIS Maxima packet, maxjson.senderPublickey is the original sender)
                                                // We should skip both to be safe, plus myself
                                                if (memberPubkey === pubkey || memberPubkey === maxjson.senderPublickey || memberPubkey === myPubkey) continue;

                                                // Check if valid contact
                                                var isContact = false;
                                                for (var j = 0; j < contacts.length; j++) {
                                                    if (contacts[j].publickey === memberPubkey) {
                                                        isContact = true;
                                                        break;
                                                    }
                                                }

                                                if (isContact) {
                                                    // Forward the ORIGINAL message object
                                                    var jsonStr = JSON.stringify(maxjson);
                                                    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                                                    MDS.log("[ServiceWorker] Propagating to contact: " + memberPubkey.substring(0, 10));
                                                    MDS.cmd("maxima action:send publickey:" + memberPubkey + " application:metachain-group data:" + hexData + " poll:false", function (sendRes) {
                                                        // Log result
                                                    });
                                                    propagatedCount++;
                                                } else {
                                                    // MDS.log("Skip non-contact: " + memberPubkey.substring(0,10));
                                                }
                                            }
                                            MDS.log("[ServiceWorker] Propagation complete. Sent to " + propagatedCount + " contacts.");
                                        });
                                    });
                                });
                            }
                        });
                    });

                    // Do NOT continue for group messages (avoids polluting CHAT_MESSAGES)
                    return;
                }

                // Handle Group Invites (metachain-group)
                if (app === "metachain-group" && maxjson.messageType === "group_invite") {
                    MDS.log("[ServiceWorker] Processing Group Invite");

                    // 1. Create group in DB
                    // Check if group exists first? SQL `INSERT OR IGNORE` or just try INSERT and ignore error
                    // Using INSERT directly, if it fails due to PK constraint, that's fine (group already exists)
                    var createGroupSql = "INSERT INTO GROUPS (group_id, name, creator_publickey, created_date, description) VALUES "
                        + "('" + maxjson.groupId + "','" + maxjson.groupName.replace(/'/g, "''") + "','" + pubkey + "'," + maxjson.timestamp + ",'" + (maxjson.description || "").replace(/'/g, "''") + "')";

                    MDS.sql(createGroupSql, function (res) {
                        MDS.log("[ServiceWorker] Group created (or exists): " + JSON.stringify(res));

                        // 2. Add members
                        if (maxjson.members) {
                            var members = maxjson.members;
                            // Recursive function to add members
                            var addMember = function (idx) {
                                if (idx >= members.length) return;
                                var m = members[idx];
                                var role = (m.publickey === pubkey) ? 'creator' : 'member';

                                var addMemberSql = "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES "
                                    + "('" + maxjson.groupId + "','" + m.publickey + "','" + (m.username || 'Unknown').replace(/'/g, "''") + "'," + maxjson.timestamp + ",'" + role + "')";

                                MDS.sql(addMemberSql, function () {
                                    addMember(idx + 1);
                                });
                            };
                            addMember(0);
                        }
                    });

                    return;
                }

                // Handle Group Member Added/Removed (metachain-group)
                if (app === "metachain-group" && (maxjson.messageType === "group_member_added" || maxjson.messageType === "group_member_removed")) {
                    MDS.log("[ServiceWorker] Processing Group Member Update: " + maxjson.messageType);

                    if (maxjson.messageType === "group_member_added") {
                        var addMemberSql = "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES "
                            + "('" + maxjson.groupId + "','" + maxjson.memberPublickey + "','" + (maxjson.memberUsername || 'Unknown').replace(/'/g, "''") + "'," + maxjson.timestamp + ",'member')";
                        MDS.sql(addMemberSql);
                    } else {
                        var removeMemberSql = "DELETE FROM GROUP_MEMBERS WHERE group_id='" + maxjson.groupId + "' AND publickey='" + maxjson.memberPublickey + "'";
                        MDS.sql(removeMemberSql);
                    }
                    return;
                }

                // Handle read receipts
                if (maxjson.type === "read") {
                    MDS.log("[ServiceWorker] Read receipt received from " + pubkey);
                    // IMPORTANT: Don't update pending OR failed messages!
                    var sql = "UPDATE CHAT_MESSAGES SET state='read' WHERE publickey='" + pubkey + "' AND username='Me' AND state!='pending' AND state!='failed'";
                    MDS.sql(sql);
                    return;
                }

                // Handle delivery receipts
                if (maxjson.type === "delivery_receipt") {
                    MDS.log("[ServiceWorker] Delivery receipt received from " + pubkey);
                    // IMPORTANT: Don't update pending OR failed messages!
                    var sql = "UPDATE CHAT_MESSAGES SET state='delivered' WHERE publickey='" + pubkey + "' AND username='Me' AND state!='read' AND state!='pending' AND state!='failed'";
                    MDS.sql(sql);
                    return;
                }

                // Handle Ping (App Detection)
                if (maxjson.type === "ping") {
                    MDS.log("[ServiceWorker] Ping received from " + pubkey);

                    // Send Pong response
                    var payload = {
                        message: "",
                        type: "pong",
                        username: "Me",
                        filedata: ""
                    };

                    var jsonStr = JSON.stringify(payload);
                    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                    MDS.cmd("maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false", function (res) {
                        MDS.log("[ServiceWorker] Pong sent to " + pubkey);
                    });
                    return;
                }

                // Handle Pong (App Detection Response)
                if (maxjson.type === "pong") {
                    MDS.log("[ServiceWorker] Pong received from " + pubkey);
                    // We can store this in the DB or just let the UI handle it via events
                    // For persistence, we could update the contact status in a new table, but for now let's just log it
                    // The UI will receive this event via minimaService.processEvent
                    return;
                }

                // Handle Static MLS Registration (Ignore in Service Worker, handled by App)
                if (maxjson.type === "mls_register_permanent") {
                    MDS.log("[ServiceWorker] Ignoring Static MLS Registration request (handled by main app)");
                    return;
                }

                // URL encode the message and deal with apostrophe
                var encoded = encodeURIComponent(maxjson.message).replace(/'/g, "%27");

                // Get amount for charm messages (default to 0 for other types)
                var amount = (maxjson.type === "charm" && maxjson.amount) ? maxjson.amount : 0;

                // Use timestamp from sender if provided, otherwise use current time
                var messageTimestamp = maxjson.timestamp || Date.now();

                // Insert into the DB
                var msgsql = "INSERT INTO CHAT_MESSAGES (roomname,publickey,username,type,message,filedata,amount,date) VALUES "
                    + "('" + maxjson.username + "','" + pubkey + "','" + maxjson.username + "','" + maxjson.type + "','" + encoded + "','" + (maxjson.filedata || "") + "'," + amount + "," + messageTimestamp + ")";

                // Insert into DB
                MDS.sql(msgsql, function (res) {
                    MDS.log("[ServiceWorker] Message saved to DB");
                });

                // Send delivery receipt automatically
                var payload = {
                    message: "",
                    type: "delivery_receipt",
                    username: "Me",
                    filedata: ""
                };

                var jsonStr = JSON.stringify(payload);
                var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                MDS.cmd("maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false", function (res) {
                    MDS.log("[ServiceWorker] Delivery receipt sent to " + pubkey);
                });

            } catch (err) {
                MDS.log("[ServiceWorker] Error processing message: " + err);
            }
        }
    }
});
