/**
 * MetaChain Service Worker
 * Processes incoming Maxima messages even when app is closed
 */

// Convert HEX to UTF8 - FIXED VERSION
function hexToUtf8(hexStr) {
    // Remove any whitespace
    hexStr = hexStr.replace(/\s+/g, '');

    // Convert hex pairs to bytes
    var bytes = [];
    for (var i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }

    // Convert bytes to UTF-8 string
    var str = '';
    for (var i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i]);
    }

    return str;
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
        MDS.log("🚀 [ServiceWorker] STARTING UP - PATCHED VERSION 0.0.1-Fix7");

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
                + "  id INT PRIMARY KEY, "
                + "  avatar TEXT, "
                + "  tags TEXT, "
                + "  bio_extended TEXT, "
                + "  social_links TEXT, "
                + "  location TEXT, "
                + "  last_updated BIGINT "
                + " )";

            MDS.sql(myProfileSql, function (profileRes) {
                // Initialize the single profile row if it doesn't exist
                MDS.sql("INSERT IGNORE INTO MY_PROFILE (id) VALUES (1)", function () {
                    MDS.log("[ServiceWorker] MY_PROFILE table initialized: " + JSON.stringify(profileRes));
                });
            });

            // Layer 1: Discovery Layer (Ephemeral) - TTL 1 hour
            var discoveryLayerSql = "CREATE TABLE IF NOT EXISTS DISCOVERED_PEERS ( "
                + "  publickey VARCHAR(512) PRIMARY KEY, "
                + "  alias VARCHAR(160) NOT NULL, "
                + "  bio VARCHAR(512), "
                + "  address VARCHAR(512) NOT NULL, "
                + "  last_seen BIGINT NOT NULL, "
                + "  source VARCHAR(20) NOT NULL"
                + " )";

            MDS.sql(discoveryLayerSql, function (discoveryRes) {
                MDS.log("[ServiceWorker] DISCOVERED_PEERS table initialized: " + JSON.stringify(discoveryRes));

                // Add bio column to existing tables if it doesn't exist
                var alterBioSql = "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS bio VARCHAR(512)";
                MDS.sql(alterBioSql, function (alterRes) {
                    MDS.log("[ServiceWorker] Bio column added/verified: " + JSON.stringify(alterRes));
                });
            });

            // Layer 2: User Registry (Stable) - Persistent, no TTL
            var userRegistrySql = "CREATE TABLE IF NOT EXISTS METACHAIN_USERS ( "
                + "  user_id VARCHAR(512) PRIMARY KEY, "
                + "  publickey VARCHAR(512) UNIQUE NOT NULL, "
                + "  alias VARCHAR(160) NOT NULL, "
                + "  address VARCHAR(512) NOT NULL, "
                + "  first_seen BIGINT NOT NULL, "
                + "  last_updated BIGINT NOT NULL"
                + " )";

            MDS.sql(userRegistrySql, function (userRes) {
                MDS.log("[ServiceWorker] METACHAIN_USERS table initialized: " + JSON.stringify(userRes));
            });

            // Enable networking logs to receive MINIMALOG events for P2P beacons
            MDS.cmd("logs on", function (logRes) {
                if (logRes.status) {
                    MDS.log("✅ [Discovery] Logs enabled for MINIMALOG");
                } else {
                    MDS.log("⚠️ [Discovery] Could not enable logs: " + logRes.error);
                }
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
                    MDS.log("[ServiceWorker] Ignoring Delivery Receipt");
                    return;
                }

                // Handle Peer Discovery Beacons (type: register)
                if (maxjson.type === "register") {
                    MDS.log("[ServiceWorker] Peer Discovery Beacon received: " + maxjson.alias);
                    handleBeacon(maxjson, 'MAXIMA');
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

    // P2P Beacon Reception via MINIMALOG (NO debug logs to avoid infinite loop)
    else if (msg.event === "MINIMALOG") {
        var logMessage = msg.data.message;

        // Strategy 1: Check for HEX encoded JSON (Pattern: ...:0x7b...)
        var hexIndex = logMessage.indexOf(":0x7b");
        if (hexIndex !== -1) {
            try {
                // Extract hex portion starting from "0x"
                var hexStart = hexIndex + 1; // Start at "0x"
                var rawHex = logMessage.substring(hexStart);

                MDS.log("DEBUG_DISCOVERY: Raw hex substring (first 50): " + rawHex.substring(0, 50) + "...");

                // Extract only valid hex characters (0x followed by hex digits)
                // Stop at first non-hex character
                var hexMatch = rawHex.match(/^(0x[0-9A-Fa-f]+)/);
                if (!hexMatch) {
                    MDS.log("DEBUG_DISCOVERY: No valid hex found after :0x7b");
                    return;
                }

                var hexStr = hexMatch[1];
                MDS.log("DEBUG_DISCOVERY: Extracted hex length: " + hexStr.length);

                // Remove the "0x" prefix for decoding
                var cleanHex = hexStr.substring(2);
                MDS.log("DEBUG_DISCOVERY: Clean hex (first 50): " + cleanHex.substring(0, 50));

                // Decode
                var jsonStr = hexToUtf8(cleanHex);
                MDS.log("DEBUG_DISCOVERY: Decoded length: " + jsonStr.length + ", first 100 chars: " + jsonStr.substring(0, 100));

                // Sanitize: Trim null bytes and other control characters (stricter regex)
                jsonStr = jsonStr.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
                MDS.log("DEBUG_DISCOVERY: Sanitized, attempting JSON.parse...");

                // Parse
                var beacon = JSON.parse(jsonStr);

                // Log success (Safe log: avoid re-triggering patterns)
                MDS.log("DEBUG_DISCOVERY: ✅ Hex decoded successfully. App: " + beacon.app + ", Type: " + beacon.type + ", Alias: " + beacon.alias);

                if (beacon.app === "metachain" && beacon.type === "BEACON") {
                    handleBeacon(beacon, 'P2P');
                }
                return;
            } catch (e) {
                MDS.log("DEBUG_DISCOVERY: ❌ Hex Strategy Failed: " + e.message);
            }
        }

        // Strategy 2: Check for plain text GENMESSAGE
        if (logMessage.indexOf("GENMESSAGE :") !== -1) {
            try {
                var jsonStart = logMessage.indexOf("{");
                if (jsonStart !== -1) {
                    var jsonStr = logMessage.substring(jsonStart);
                    var beacon = JSON.parse(jsonStr);

                    if (beacon.app === "metachain" && beacon.type === "BEACON") {
                        handleBeacon(beacon, 'P2P');
                    }
                }
            } catch (e) {
                // Silently ignore errors
            }
        }
    }
});

// Beacon Handler - ALWAYS insert to Layer 1 (DISCOVERED_PEERS)
function handleBeacon(beacon, source) {
    MDS.log("🕵️ [Debug] handleBeacon called for " + beacon.alias + " (" + source + ")");

    if (!beacon.pubkey || !beacon.address || !beacon.alias) {
        MDS.log("❌ [Debug] Invalid beacon data: " + JSON.stringify(beacon));
        return;
    }

    var now = Date.now();
    var escapedAlias = beacon.alias.replace(/'/g, "''");
    var escapedBio = (beacon.bio || "").replace(/'/g, "''");

    // FIX: Use MERGE INTO instead of INSERT OR REPLACE (H2 Syntax)
    var discoverySql = "MERGE INTO DISCOVERED_PEERS (publickey, alias, bio, address, last_seen, source) "
        + "KEY (publickey) "
        + "VALUES ('" + beacon.pubkey + "', '" + escapedAlias + "', '" + escapedBio + "', '"
        + beacon.address + "', " + now + ", '" + source + "')";

    MDS.sql(discoverySql, function (res) {
        if (res.status) {
            MDS.log("✅ [Discovery] Peer: " + beacon.alias + " (" + source + ") - Saved to DB");
            promoteToUserRegistry(beacon, now);
        } else {
            MDS.log("❌ [Debug] INSERT FAILED: " + JSON.stringify(res));

            // Fallback: Check if table exists
            MDS.sql("SELECT * FROM DISCOVERED_PEERS LIMIT 1", function (checkRes) {
                if (!checkRes.status) {
                    MDS.log("❌ [Debug] DISCOVERED_PEERS table appears missing! Attempting recreation...");
                    // Re-run creation logic? It should have run in init.
                    var discoveryLayerSql = "CREATE TABLE IF NOT EXISTS DISCOVERED_PEERS ( "
                        + "  publickey VARCHAR(512) PRIMARY KEY, "
                        + "  alias VARCHAR(160) NOT NULL, "
                        + "  address VARCHAR(512) NOT NULL, "
                        + "  last_seen BIGINT NOT NULL, "
                        + "  source VARCHAR(20) NOT NULL"
                        + " )";
                    MDS.sql(discoveryLayerSql, function (createRes) {
                        MDS.log("🛠️ [Debug] Table Recreation Result: " + JSON.stringify(createRes));
                        // Retry insert? No, wait for next beacon.
                    });
                }
            });
        }
    });
}

// Controlled Promotion to Layer 2
function promoteToUserRegistry(beacon, now) {
    var user_id = beacon.pubkey;
    var escapedAlias = beacon.alias.replace(/'/g, "''");

    MDS.sql("SELECT * FROM METACHAIN_USERS WHERE user_id='" + user_id + "'", function (res) {
        if (res.status && res.rows && res.rows.length > 0) {
            // User exists → UPDATE
            var updateSql = "UPDATE METACHAIN_USERS "
                + "SET alias='" + escapedAlias + "', address='" + beacon.address + "', "
                + "last_updated=" + now + " WHERE user_id='" + user_id + "'";
            MDS.sql(updateSql);
        } else {
            // Check promotion criteria
            checkPromotionCriteria(beacon, user_id, escapedAlias, now);
        }
    });
}

// Check Promotion Criteria
function checkPromotionCriteria(beacon, user_id, escapedAlias, now) {
    MDS.sql("SELECT source FROM DISCOVERED_PEERS WHERE publickey='" + beacon.pubkey + "'", function (res) {
        if (res.status && res.rows && res.rows.length > 0) {
            var source = res.rows[0].SOURCE;

            if (source === 'BOOTSTRAP') {
                // ✅ Promote: Bootstrap users are validated
                var insertSql = "INSERT INTO METACHAIN_USERS "
                    + "(user_id, publickey, alias, address, first_seen, last_updated) "
                    + "VALUES ('" + user_id + "', '" + beacon.pubkey + "', '" + escapedAlias + "', '"
                    + beacon.address + "', " + now + ", " + now + ")";
                MDS.sql(insertSql);
                MDS.log("⭐ [Discovery] Promoted: " + beacon.alias);
            }
        }
    });
}

// Periodic Cleanup Timer - TTL for Layer 1 only
function startCleanupTimer() {
    setInterval(function () {
        var oneHourAgo = Date.now() - (60 * 60 * 1000);
        var sql = "DELETE FROM DISCOVERED_PEERS WHERE last_seen < " + oneHourAgo;
        MDS.sql(sql, function (res) {
            if (res.status && res.count > 0) {
                MDS.log("[Discovery] Cleaned " + res.count + " stale peers");
            }
        });
    }, 15 * 60 * 1000);
}

// Bootstrap Sync Timer
function startBootstrapSync() {
    setInterval(function () {
        MDS.cmd("maxima", function (res) {
            if (res.status && res.response.staticmls && res.response.mls) {
                var msgData = { app: "metachain", type: "get_peers" };
                var cmd = "maxima action:send to:" + res.response.mls +
                    " application:metachain data:" + JSON.stringify(msgData);
                MDS.cmd(cmd);
            }
        });
    }, 10 * 60 * 1000);
}
