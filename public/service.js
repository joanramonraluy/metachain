/**
 * MetaChain Service Worker
 * Processes incoming Maxima messages even when app is closed
 */

// Beacon timing variables
// Gossip timing variables
var LAST_GOSSIP = 0; // Initialize to 0 so it runs on first block if needed
var BEACON_INTERVAL = 60000; // 1 minute (TESTING)
var MY_MAXIMA_PK = "";
// Cache to debounce repeat beacons (memory only)
var BEACON_CACHE = {};

// GOSSIP TIMING (Testing: 30s = Run on every block; Production: 300000 = 5 mins)
var GOSSIP_INTERVAL = 30000;




// Convert HEX to UTF8 - UTF-8 Variant for MAXIMA Messages (Chat, Profile, etc.)
// This version properly decodes UTF-8 byte sequences from TextEncoder
function hexToUtf8(hexStr) {
    // Remove any whitespace and 0x prefix if present
    hexStr = hexStr.replace(/\s+/g, '').replace(/^0x/i, '');

    // Convert hex pairs to bytes
    var bytes = [];
    for (var i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }

    // Decode UTF-8 byte sequence properly
    // This handles multi-byte characters (català, emojis, etc.)
    var str = '';
    var i = 0;
    while (i < bytes.length) {
        var byte1 = bytes[i++];

        if (byte1 < 0x80) {
            // Single-byte character (ASCII)
            str += String.fromCharCode(byte1);
        } else if (byte1 >= 0xC0 && byte1 < 0xE0) {
            // Two-byte character
            var byte2 = bytes[i++];
            var codePoint = ((byte1 & 0x1F) << 6) | (byte2 & 0x3F);
            str += String.fromCharCode(codePoint);
        } else if (byte1 >= 0xE0 && byte1 < 0xF0) {
            // Three-byte character
            var byte2 = bytes[i++];
            var byte3 = bytes[i++];
            var codePoint = ((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F);
            str += String.fromCharCode(codePoint);
        } else if (byte1 >= 0xF0 && byte1 < 0xF8) {
            // Four-byte character (emojis, etc.)
            var byte2 = bytes[i++];
            var byte3 = bytes[i++];
            var byte4 = bytes[i++];
            var codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
            // Convert to surrogate pair for JavaScript
            codePoint -= 0x10000;
            str += String.fromCharCode(0xD800 + (codePoint >> 10));
            str += String.fromCharCode(0xDC00 + (codePoint & 0x3FF));
        }
    }

    return str;
}

// Convert HEX to UTF8 - Simple Variant for P2P Beacons
function hexToUtf8Simple(hexStr) {
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
        MDS.log("🚀 [SW] STARTING UP - v1.3 (NEWBLOCK GOSSIP)");
        MDS.log("👉 [SW] If you do not see this message on startup, the minidapp is NOT updated.");

        // Register for NEWBLOCK events immediately
        MDS.cmd("event on newblock", function (res) {
            // MDS.log("✅ [INIT] Registered for block events");
        });

        // Get our own Maxima info immediately to filter self-beacons
        MDS.cmd("maxima action:info", function (maxInfo) {
            if (maxInfo.status) {
                MY_MAXIMA_PK = maxInfo.response.publickey;
                MDS.log("🔑 [SW] My Public Key: " + MY_MAXIMA_PK);
            }
        });

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
            MDS.log("💾 [DB] DB Initialized: " + JSON.stringify(res));
            // Add amount column to existing tables if it doesn't exist
            var alterSql = "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS amount INT NOT NULL DEFAULT 0";
            MDS.sql(alterSql, function (alterRes) {
                MDS.log("💾 [DB] Column 'amount' added/verified: " + JSON.stringify(alterRes));
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
                MDS.log("💾 [DB] CHAT_STATUS initialized: " + JSON.stringify(statusRes));

                // Add favorite column to existing tables if it doesn't exist
                var alterFavoriteSql = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE";
                MDS.sql(alterFavoriteSql, function (alterRes) {
                    MDS.log("💾 [DB] Column 'favorite' added/verified: " + JSON.stringify(alterRes));
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
                    MDS.log("💾 [DB] MY_PROFILE initialized: " + JSON.stringify(profileRes));

                    // Add missing columns for extended profile
                    MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS phone TEXT");
                    MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS email TEXT");
                    MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS website TEXT");
                    MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS country TEXT");
                    MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS languages TEXT");
                    MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE");
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
                MDS.log("💾 [DB] DISCOVERED_PEERS initialized: " + JSON.stringify(discoveryRes));

                // Add bio column to existing tables if it doesn't exist
                var alterBioSql = "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS bio VARCHAR(512)";
                MDS.sql(alterBioSql, function (alterRes) {
                    MDS.log("💾 [DB] Column 'bio' added/verified: " + JSON.stringify(alterRes));
                });

                // Add allow_non_contact_chats column
                var alterPermissionSql = "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE";
                MDS.sql(alterPermissionSql, function (alterPermRes) {
                    MDS.log("💾 [DB] Column 'allow_non_contact_chats' added/verified: " + JSON.stringify(alterPermRes));
                });
            });

            // Create CONTACT_REQUESTS table for bidirectional contact requests
            var contactRequestsSql = "CREATE TABLE IF NOT EXISTS CONTACT_REQUESTS ( "
                + "  id BIGINT AUTO_INCREMENT PRIMARY KEY, "
                + "  from_publickey VARCHAR(512) NOT NULL, "
                + "  from_name VARCHAR(255), "
                + "  from_avatar TEXT, "
                + "  to_publickey VARCHAR(512) NOT NULL, "
                + "  status VARCHAR(32) DEFAULT 'pending', "
                + "  created_at BIGINT NOT NULL, "
                + "  updated_at BIGINT "
                + " )";

            MDS.sql(contactRequestsSql, function (contactReqRes) {
                MDS.log("💾 [DB] CONTACT_REQUESTS initialized: " + JSON.stringify(contactReqRes));
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
                MDS.log("💾 [DB] METACHAIN_USERS initialized: " + JSON.stringify(userRes));
            });

            // Enable networking logs to receive MINIMALOG events for P2P beacons
            function enableLogs() {
                MDS.cmd("logs on", function (logRes) {
                    if (logRes.status) {
                        MDS.log("✅ [INIT] MINIMALOG listener registered");
                    } else {
                        MDS.log("⚠️ [P2P] Logs enable failed (no retry available)");
                    }
                });
            }
            enableLogs();

            // Initialize Discovered Peers Table  
            createDiscoveredPeersTable();

            // Send Initial Beacon (On Install / Restart)
            MDS.log("🚀 [SW] Sending initial beacon on install/restart...");
            sendBackgroundBeacon();

            // Start Gossip Protocol (Ask neighbors for their peers)
            startGossip();

            // NOTE: setInterval is NOT available in Minima Service Workers
            // Periodic timers disabled until we implement NEWBLOCK-based alternative
            // Enable Periodic Timers
            // 1. Cleanup old peers (TTL)
            // startCleanupTimer(); // DISABLED - setInterval not available

            // 2. Sync with Bootstrap Server (if configured)
            // startBootstrapSync(); // DISABLED - setInterval not available

            // 3. Periodic Gossip & Cleanup via NEWBLOCK (Resilience)
            // Minima guarantees the 'newblock' event roughly every 50 seconds.
            // We use this as our heartbeat since setInterval is unreliable/unsupported.
            MDS.cmd("event on newblock", function (res) {
                MDS.log("✅ [INIT] NEWBLOCK listener registered for periodic tasks.");
            });
        });

        // Handle NEWBLOCK events for periodic tasks
    } else if (msg.event == "NEWBLOCK") {
        var now = Date.now();

        // 1. Periodic Gossip (Interval defined by GOSSIP_INTERVAL)
        if (now - LAST_GOSSIP > GOSSIP_INTERVAL) {
            LAST_GOSSIP = now;
            // MDS.log("⏰ [HEARTBEAT] Interval passed. Triggering Gossip & Cleanup...");
            startGossip();
            startCleanupTimer(); // Manually run cleanup check
            sendBackgroundBeacon(); // Re-announce self for late joiners
            // Update timestamp handled in startGossip or updating here:
            // LAST_GOSSIP is updated in startGossip, but generic timer logic is safer here?
            // Let's rely on startGossip to update it, or force it if it fails:
            // Actually, startGossip is async. Let's just trust it runs.
        }

        // Only interested in Maxima
    } else if (msg.event == "MAXIMA") {

        MDS.log("📨 [MAXIMA] Event received. App: " + msg.data.application);

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

                MDS.log("🔍 [MAXIMA] Parsed Payload: " + JSON.stringify(maxjson));

                // Handle History Sync Messages (ignore in SW, handled by App)
                if (app === "metachain-group" && (maxjson.messageType === "history_request" || maxjson.messageType === "history_response")) {
                    MDS.log("ℹ️ [GROUP-SYNC] Ignoring message: " + maxjson.messageType);
                    return;
                }

                // Handle Group Messages (metachain-group or legacy with groupId)
                if ((app === "metachain-group" && maxjson.messageType === "group_message") || (maxjson.groupId && maxjson.messageType === "group_message")) {
                    MDS.log("📨 [GROUP-MSG] Processing...");

                    // Ensure GROUP_MESSAGES table exists (in case service.js runs before app)
                    // We assume it exists if app ran. If not, inserting will fail, but that's acceptable for now.

                    // MIGRATION: Ensure propagated column exists
                    // We try to add it. If it fails (exists), we ignore.
                    var migrationSql = "ALTER TABLE GROUP_MESSAGES ADD COLUMN propagated INT DEFAULT 0";
                    MDS.sql(migrationSql, function (migRes) {
                        MDS.log("💾 [DB] Migration result: " + JSON.stringify(migRes));

                        // Only escape single quotes for SQL safety (no encodeURIComponent needed anymore)
                        var encoded = (maxjson.message || "").replace(/'/g, "''");
                        var messageTimestamp = maxjson.timestamp || Date.now();

                        // FIX: Use ORIGINAL sender's public key (from payload), not the relayer's (msg.data.from)
                        var originalSender = maxjson.senderPublickey || pubkey;

                        // Check for duplicates before inserting
                        // We select ID and PROPAGATED. If propagated column is missing (migration failed significantly), this might fail.
                        var checkSql = "SELECT id, propagated FROM GROUP_MESSAGES WHERE group_id='" + maxjson.groupId + "' AND sender_publickey='" + originalSender + "' AND date=" + messageTimestamp;

                        MDS.sql(checkSql, function (checkRes) {
                            MDS.log("🔍 [DB] Duplicate check: " + JSON.stringify(checkRes));

                            var shouldPropagate = false;

                            if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
                                // Message exists. Check if it has been propagated.
                                var row = checkRes.rows[0];
                                var isPropagated = (row.PROPAGATED === 1 || row.propagated === 1);

                                if (isPropagated) {
                                    MDS.log("ℹ️ [GROUP-MSG] Already propagated. Ignoring.");
                                    return;
                                } else {
                                    MDS.log("⚠️ [GROUP-MSG] Exists but NOT propagated. Propagating now.");
                                    shouldPropagate = true;
                                    // Update propagated flag (if column exists)
                                    MDS.sql("UPDATE GROUP_MESSAGES SET propagated=1 WHERE id=" + row.ID);
                                }
                            } else {
                                // Not a duplicate (or DB query failed), insert it with propagated=1
                                if (!checkRes.status) {
                                    MDS.log("⚠️ [DB] Duplicate check failed, trying insert/propagate anyway.");
                                }

                                shouldPropagate = true;
                                var groupMsgSql = "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated) VALUES "
                                    + "('" + maxjson.groupId + "','" + originalSender + "','" + maxjson.senderUsername + "','" + (maxjson.type || "text") + "','" + encoded + "','" + (maxjson.filedata || "") + "'," + messageTimestamp + ", 0, 1)";

                                MDS.sql(groupMsgSql, function (res) {
                                    if (res.status) {
                                        MDS.log("✅ [DB] Group message saved (propagated=1).");
                                    } else {
                                        MDS.log("❌ [DB] Failed to save group message: " + res.error);
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
                                MDS.log("🔄 [GROUP-MSG] Starting propagation...");
                                // PROPAGATION: Re-broadcast to my contacts who are in this group
                                // 1. Get group members
                                var membersSql = "SELECT * FROM GROUP_MEMBERS WHERE group_id='" + maxjson.groupId + "'";
                                MDS.sql(membersSql, function (memberRes) {
                                    if (!memberRes.status || !memberRes.rows) {
                                        MDS.log("❌ [GROUP-MSG] Failed to fetch members.");
                                        return;
                                    }

                                    var members = memberRes.rows;
                                    MDS.log("🔍 [GROUP-MSG] Found " + members.length + " members. Fetching contacts...");

                                    // 2. Get my contacts
                                    MDS.cmd("maxcontacts", function (contactRes) {
                                        if (!contactRes.status || !contactRes.response.contacts) {
                                            MDS.log("❌ [CONTACTS] Failed to fetch contacts.");
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

                                                    MDS.log("📤 [GROUP-MSG] Propagating to: " + memberPubkey.substring(0, 10));
                                                    MDS.cmd("maxima action:send publickey:" + memberPubkey + " application:metachain-group data:" + hexData + " poll:false", function (sendRes) {
                                                        // Log result
                                                    });
                                                    propagatedCount++;
                                                } else {
                                                    // MDS.log("Skip non-contact: " + memberPubkey.substring(0,10));
                                                }
                                            }
                                            MDS.log("✅ [GROUP-MSG] Propagation complete. Sent to " + propagatedCount + " contacts.");
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
                    MDS.log("📨 [GROUP-INVITE] Processing...");

                    // 1. Create group in DB
                    // Check if group exists first? SQL `INSERT OR IGNORE` or just try INSERT and ignore error
                    // Using INSERT directly, if it fails due to PK constraint, that's fine (group already exists)
                    var createGroupSql = "INSERT INTO GROUPS (group_id, name, creator_publickey, created_date, description) VALUES "
                        + "('" + maxjson.groupId + "','" + maxjson.groupName.replace(/'/g, "''") + "','" + pubkey + "'," + maxjson.timestamp + ",'" + (maxjson.description || "").replace(/'/g, "''") + "')";

                    MDS.sql(createGroupSql, function (res) {
                        MDS.log("✅ [GROUP-MGMT] Group created/exists: " + JSON.stringify(res));

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
                    MDS.log("🔄 [GROUP-MEMBER] Update: " + maxjson.messageType);

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
                    MDS.log("📖 [READ-RECEIPT] Received from " + pubkey);
                    // IMPORTANT: Don't update pending OR failed messages!
                    var sql = "UPDATE CHAT_MESSAGES SET state='read' WHERE publickey='" + pubkey + "' AND username='Me' AND state!='pending' AND state!='failed'";
                    MDS.sql(sql);
                    return;
                }

                // Handle delivery receipts
                if (maxjson.type === "delivery_receipt") {
                    MDS.log("📬 [DELIVERY-RECEIPT] Ignoring (handled by UI/not needed)");
                    return;
                }

                // Handle Peer Discovery Beacons (type: register)
                if (maxjson.type === "register") {
                    MDS.log("📡 [P2P] Beacon received: " + maxjson.alias);
                    handleBeacon(maxjson, 'MAXIMA');
                    return;
                }

                // Handle Ping (App Detection)
                if (maxjson.type === "ping") {
                    MDS.log("📡 [PING] Received from " + pubkey);

                    // Send Pong response
                    var payload = {
                        message: "",
                        type: "pong",
                        username: "Me",
                        filedata: ""
                    };

                    var jsonStr = JSON.stringify(payload);
                    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                    // Smart Address Resolution for Non-Contacts
                    // If sender is NOT a contact, we need to use their Maxima Address (Mx) from Discovery
                    var sendPongCommand = function (senderPubkey) {
                        if (senderPubkey.startsWith('0x')) {
                            // Try to find Mx address from DISCOVERED_PEERS
                            var safeKey = senderPubkey.replace(/'/g, "''");
                            var peerSql = "SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='" + safeKey + "' AND ADDRESS IS NOT NULL LIMIT 1";

                            MDS.sql(peerSql, function (peerRes) {
                                var sendCmd;
                                if (peerRes && peerRes.status && peerRes.count > 0) {
                                    MDS.log("✅ [PONG] Found Mx address from DB: " + peerRes.rows[0].ADDRESS);

                                    var rawMx = peerRes.rows[0].ADDRESS;
                                    var mxAddress = null;
                                    if (rawMx) {
                                        var mParts = rawMx.split(":");
                                        if (mParts.length >= 2) {
                                            var m1 = mParts[0].replace(/[^a-zA-Z0-9@.-]/g, "").trim();
                                            var m2 = mParts[1].replace(/[^0-9]/g, "").trim();
                                            mxAddress = m1 + ":" + m2;
                                        } else {
                                            mxAddress = rawMx.replace(/[^a-zA-Z0-9@.:-]/g, "");
                                        }
                                    }

                                    if (mxAddress && mxAddress.startsWith('Mx')) {
                                        MDS.log("✅ [PONG] Found Mx address: " + mxAddress.substring(0, 15) + "...");
                                        // Use 'to' parameter for non-contact routing
                                        sendCmd = "maxima action:send to:\"" + mxAddress + "\" application:metachain data:" + hexData + " poll:false";
                                    } else {
                                        MDS.log("⚠️ [PONG] Using publickey (no Mx found)");
                                        sendCmd = "maxima action:send publickey:" + senderPubkey + " application:metachain data:" + hexData + " poll:false";
                                    }
                                } else {
                                    MDS.log("⚠️ [PONG] Using publickey (not in Discovery)");
                                    sendCmd = "maxima action:send publickey:" + senderPubkey + " application:metachain data:" + hexData + " poll:false";
                                }

                                MDS.cmd(sendCmd, function (res) {
                                    MDS.log("✅ [PONG] Sent to " + senderPubkey.substring(0, 15) + "...");
                                });
                            });
                        } else {
                            // Already an Mx address or other format
                            var sendCmd;
                            if (senderPubkey.startsWith('Mx') || senderPubkey.startsWith('MX')) {
                                sendCmd = "maxima action:send to:\"" + senderPubkey + "\" application:metachain data:" + hexData + " poll:false";
                            } else {
                                sendCmd = "maxima action:send publickey:" + senderPubkey + " application:metachain data:" + hexData + " poll:false";
                            }
                            MDS.cmd(sendCmd, function (res) {
                                MDS.log("✅ [PONG] Sent to " + senderPubkey.substring(0, 15) + "...");
                            });
                        }
                    };

                    sendPongCommand(pubkey);
                    return;
                }

                // Handle Pong (App Detection Response)
                if (maxjson.type === "pong") {
                    MDS.log("📡 [PONG] Received from " + pubkey);
                    // We can store this in the DB or just let the UI handle it via events
                    // For persistence, we could update the contact status in a new table, but for now let's just log it
                    // The UI will receive this event via minimaService.processEvent
                    return;
                }

                // Handle Static MLS Registration (Ignore in Service Worker, handled by App)
                if (maxjson.type === "mls_register_permanent") {
                    MDS.log("ℹ️ [MLS] Ignoring registration (handled by app)");
                    return;
                }

                // Handle Peer Exchange Request (Gossip)
                if (maxjson.type === "get_peers") {
                    MDS.log("🗣️ [GOSSIP] Peer request received from " + maxjson.alias);

                    // Fetch our known peers (Limit 50, sort by last seen desc)
                    var peerSql = "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 50";
                    MDS.sql(peerSql, function (res) {
                        if (res.status && res.rows && res.rows.length > 0) {
                            // MDS.log("🗣️ [GOSSIP] Found " + res.rows.length + " peers in DB to share.");
                            var peers = [];


                            for (var i = 0; i < res.rows.length; i++) {
                                var row = res.rows[i];
                                // Map DB columns to Beacon format
                                peers.push({
                                    pubkey: row.PUBLICKEY,
                                    alias: row.ALIAS,
                                    bio: row.BIO,
                                    address: row.ADDRESS,
                                    allowNonContactChats: (row.ALLOW_NON_CONTACT_CHATS === 1 || row.ALLOW_NON_CONTACT_CHATS === true)
                                });
                            }

                            // MDS.log("🗣️ [GOSSIP] Sending list: " + peers.map(p => p.alias).join(", ")); // Too verbose

                            // Send response


                            var responsePayload = {
                                app: "metachain",
                                type: "peers_response",
                                peers: peers
                            };

                            var jsonStr = JSON.stringify(responsePayload);
                            var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                            MDS.cmd("maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false", function (sendRes) {
                                MDS.log("✅ [GOSSIP] Sent " + peers.length + " peers to " + maxjson.alias);
                            });
                        }
                    });
                    return;
                }

                // Handle Peer Exchange Response
                if (maxjson.type === "peers_response") {
                    MDS.log("📥 [GOSSIP] Received " + (maxjson.peers ? maxjson.peers.length : 0) + " peers.");

                    if (maxjson.peers && Array.isArray(maxjson.peers)) {
                        var count = 0;
                        for (var i = 0; i < maxjson.peers.length; i++) {
                            var peer = maxjson.peers[i];
                            // Basic validation
                            if (peer.pubkey && peer.address && peer.alias) {
                                // Reuse beacon handler logic to ensure data is saved AND frontend is notified
                                handleBeacon(peer, 'GOSSIP');
                                count++;
                            }
                        }
                        // MDS.log("✅ [GOSSIP] Processed " + count + " peers.");
                    }
                    return;
                }

                // Handle Profile Request
                if (maxjson.type === "profile_request") {
                    MDS.log("🕵️ [PROFILE] Request received. Executing handler...");

                    try {
                        // Fetch complete profile from DB + Keypair
                        MDS.sql("SELECT * FROM MY_PROFILE LIMIT 1", function (res) {
                            MDS.log("🔍 [PROFILE] DB check complete. Success: " + res.status);

                            var profile = {};
                            if (res.status && res.rows && res.rows.length > 0) {
                                var row = res.rows[0];
                                // Parse JSON fields
                                try { profile.social = JSON.parse(decodeURIComponent(row.SOCIAL_LINKS || "{}")); } catch (e) { }
                                try { profile.languages = JSON.parse(decodeURIComponent(row.LANGUAGES || "[]")); } catch (e) { }

                                profile.extended_bio = decodeURIComponent(row.BIO_EXTENDED || "");
                                profile.location = decodeURIComponent(row.LOCATION || "");
                                profile.country = decodeURIComponent(row.COUNTRY || "");
                                profile.website = decodeURIComponent(row.WEBSITE || "");
                                profile.email = decodeURIComponent(row.EMAIL || "");
                                profile.phone = decodeURIComponent(row.PHONE || "");
                                // Permissions - Handle different possible values: 1, "1", true, "true"
                                var rawValue = row.ALLOW_NON_CONTACT_CHATS || row.allow_non_contact_chats;
                                profile.allowNonContactChats = (rawValue === 1 || rawValue === "1" || rawValue === true || rawValue === "true");
                            }

                            // Get Basic Info from Keypair (Name, Bio, Avatar) using MDS.cmd (raw) to avoid missing helper
                            MDS.cmd("keypair action:get key:username", function (nameRes) {
                                var name = (nameRes.status && nameRes.response && nameRes.response.value) ? nameRes.response.value : "Unknown";

                                MDS.cmd("keypair action:get key:p2p_bio", function (bioRes) {
                                    var bio = (bioRes.status && bioRes.response && bioRes.response.value) ? bioRes.response.value : "";

                                    MDS.cmd("keypair action:get key:avatar_url", function (avatarRes) {
                                        var avatar = (avatarRes.status && avatarRes.response && avatarRes.response.value) ? avatarRes.response.value : "";

                                        // Construct Response
                                        var responsePayload = {
                                            type: "profile_response",
                                            name: name,
                                            bio: bio,
                                            avatar: avatar,
                                            // Extended fields
                                            extended_bio: profile.extended_bio,
                                            location: profile.location,
                                            country: profile.country,
                                            website: profile.website,
                                            social: profile.social,
                                            languages: profile.languages,
                                            email: profile.email,
                                            phone: profile.phone,
                                            allowNonContactChats: profile.allowNonContactChats
                                        };

                                        var jsonStr = JSON.stringify(responsePayload);
                                        var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                                        // Deconstruct and Reconstruct Strategy
                                        var targetAddress = null;
                                        if (maxjson.requesterAddress) {
                                            var rawAddr = maxjson.requesterAddress + ""; // Force string
                                            var parts = rawAddr.split(":");
                                            if (parts.length >= 2) {
                                                // Clean each part individually
                                                var part1 = parts[0].replace(/[^a-zA-Z0-9@.-]/g, "").trim();
                                                var part2 = parts[1].replace(/[^0-9]/g, "").trim(); // Port should only be numbers
                                                targetAddress = part1 + ":" + part2;
                                                MDS.log("🔧 [SAINTIZE] Raw: '" + rawAddr + "' -> Clean: '" + targetAddress + "'");
                                            } else {
                                                // Fallback for non-port addresses? (Unlikely for Maxima)
                                                targetAddress = rawAddr.replace(/[^a-zA-Z0-9@.:-]/g, "");
                                            }
                                        }

                                        var sendCommand = "";

                                        if (targetAddress && (targetAddress.startsWith("Mx") || targetAddress.startsWith("MX"))) {
                                            MDS.log("📤 [PROFILE] Sending response to address: " + targetAddress);
                                            // Fixing NumberFormatException: Removing quotes around address to prevent parsing errors
                                            sendCommand = "maxima action:send to:" + targetAddress + " application:metachain data:" + hexData + " poll:false";
                                        } else {
                                            MDS.log("📤 [PROFILE] Sending response to pubkey: " + pubkey);
                                            sendCommand = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false";
                                        }

                                        // Send Response back to requester
                                        MDS.cmd(sendCommand, function (sendRes) {
                                            MDS.log("✅ [PROFILE] Response Sent. Status: " + sendRes.status);
                                        });
                                    });
                                });
                            });
                        });
                    } catch (e) {
                        MDS.log("❌ [PROFILE] CRITICAL ERROR in Handler: " + e.message);
                    }

                    return;
                }

                // Handle Profile Response (Should be handled by UI via MDS event, but good to log)
                if (maxjson.type === "profile_response") {
                    MDS.log("ℹ️ [PROFILE] Response received from " + pubkey + " - UI handles this.");
                    return;
                }

                // Handle Read Receipt
                if (maxjson.type === "read") {
                    MDS.log("📖 [READ-RECEIPT] Received from " + pubkey);
                    // Mark all my messages to this user as READ
                    var readSql = "UPDATE CHAT_MESSAGES SET state = 'read' WHERE publickey = '" + pubkey + "' AND username = 'Me' AND state != 'read'";
                    MDS.sql(readSql, function (res) {
                        MDS.log("✅ [DB] Updated messages to READ for " + pubkey);
                    });
                    return;
                }

                // Handle Delivery Receipt
                if (maxjson.type === "delivery_receipt") {
                    MDS.log("📬 [DELIVERY-RECEIPT] Received from " + pubkey);
                    // Mark all my sent messages to this user as DELIVERED (if not already read)
                    var delSql = "UPDATE CHAT_MESSAGES SET state = 'delivered' WHERE publickey = '" + pubkey + "' AND username = 'Me' AND state = 'sent'";
                    MDS.sql(delSql, function (res) {
                        MDS.log("✅ [DB] Updated messages to DELIVERED for " + pubkey);
                    });
                    return;
                }

                // Handle Peer Discovered (Internal Sync or Loopback) - Silence Warning
                if (maxjson.type === "peer_discovered") {
                    // This is an internal notification sent by us to the frontend.
                    // If we receive it back via Maxima loopback, just ignore it silently.
                    return;
                }

                // Handle Ping (Auto-Reply with Pong) - CRITICAL for "Online" status
                if (maxjson.type === "ping") {
                    MDS.log("📡 [PING] Received from " + pubkey + " - sending Pong");

                    var payload = {
                        message: "",
                        type: "pong",
                        username: "Me",
                        filedata: ""
                    };

                    var jsonStr = JSON.stringify(payload);
                    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                    MDS.cmd("maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false", function (res) {
                        MDS.log("✅ [PONG] Sent to " + pubkey);
                    });

                    return; // Stop processing (don't save to DB)
                }

                // Handle Contact Messages & System Messages (Whitelist valid chat types only)
                // This prevents 'contact_request', 'profile_response', etc. from falling through to the generic handler
                // and causing "undefined" messages in the chat history.
                var validTypes = ["text", "image", "video", "audio", "file", "charm", "token", "gif", "sticker", "voice"];
                if (validTypes.indexOf(maxjson.type) === -1) {
                    MDS.log("ℹ️ [MAXIMA] Ignoring non-chat type: " + maxjson.type);
                    return;
                }

                // Ensure message content exists (prevent 'undefined')
                var msgContent = maxjson.message || "";

                // Only escape single quotes for SQL safety
                var encoded = msgContent.replace(/'/g, "''");

                // Get amount for charm messages (default to 0 for other types)
                var amount = (maxjson.type === "charm" && maxjson.amount) ? maxjson.amount : 0;

                // Use timestamp from sender if provided, otherwise use current time
                var messageTimestamp = maxjson.timestamp || Date.now();

                // Insert into the DB
                var msgsql = "INSERT INTO CHAT_MESSAGES (roomname,publickey,username,type,message,filedata,amount,date) VALUES "
                    + "('" + maxjson.username + "','" + pubkey + "','" + maxjson.username + "','" + maxjson.type + "','" + encoded + "','" + (maxjson.filedata || "") + "'," + amount + "," + messageTimestamp + ")";

                // Insert into DB
                MDS.sql(msgsql, function (res) {
                    MDS.log("✅ [DB] Message saved");
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
                    MDS.log("✅ [DELIVERY-RECEIPT] Sent to " + pubkey);
                });

            } catch (err) {
                MDS.log("❌ [MAXIMA] Error processing message: " + err);
            }
        }
    }

    // P2P Beacon Reception via MINIMALOG (NO debug logs to avoid infinite loop)
    else if (msg.event === "MINIMALOG") {
        var logMessage = msg.data.message;

        // CRITICAL FIX: Ignore our own debug logs to prevent infinite recursion loop
        // We must ignore ANY log that we generated ourselves with MDS.log
        // BUT we must NOT ignore P2P beacons that arrive from other nodes!
        // Only filter if the log contains our specific log prefixes (with emojis)
        if (logMessage.indexOf("🔍 [P2P-DEBUG]") !== -1 ||
            logMessage.indexOf("✅ [P2P]") !== -1 ||
            logMessage.indexOf("📡 [P2P]") !== -1 ||
            logMessage.indexOf("🚀 [SW]") !== -1 ||
            logMessage.indexOf("👉 [SW]") !== -1 ||
            logMessage.indexOf("📨 [MAXIMA]") !== -1 ||
            logMessage.indexOf("💾 [DB]") !== -1 ||
            logMessage.indexOf("[PROFILE]") !== -1 ||
            logMessage.indexOf("[CONTACT]") !== -1) {
            return;
        }

        // Strategy 1: Check for HEX encoded JSON (Pattern: 0x7b... or 0x7B...)
        var hexIndex = logMessage.toLowerCase().indexOf("0x7b");
        if (hexIndex !== -1) {
            try {
                // Extract hex portion starting from "0x"
                var hexStart = hexIndex;
                var rawHex = logMessage.substring(hexStart);

                // Extract only valid hex characters (0x followed by hex digits)
                var hexMatch = rawHex.match(/^(0x[0-9A-Fa-f]+)/);
                if (!hexMatch) {
                    return; // No valid hex found
                }

                var hexStr = hexMatch[1];
                var cleanHex = hexStr.substring(2); // Remove "0x" prefix

                // Decode using SIMPLE variant
                var jsonStr = hexToUtf8Simple(cleanHex);

                // Sanitize: Trim null bytes and other control characters
                jsonStr = jsonStr.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();

                // Parse
                var beacon = JSON.parse(jsonStr);

                if (beacon.app === "metachain" && beacon.type === "BEACON") {
                    MDS.log("✅ [BEACON] Found: " + beacon.alias);
                    handleBeacon(beacon, 'P2P');
                }
                return;
            } catch (e) {
                MDS.log("❌ [BEACON] Parse error: " + e.message);
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

    // Heartbeat via NEWBLOCK event (Approx every 30-60s)
    else if (msg.event === "NEWBLOCK") {
        var now = Date.now();
        if (now - LAST_BEACON_TIME > BEACON_INTERVAL) {
            MDS.log("⏰ [BG-BEACON] Periodic beacon time...");
            LAST_BEACON_TIME = now;
            sendBackgroundBeacon();
        }
    }
});

// Beacon Handler - ALWAYS insert to Layer 1 (DISCOVERED_PEERS)
function handleBeacon(beacon, source) {
    try {
        if (!beacon.pubkey || !beacon.address || !beacon.alias) {
            // MDS.log("⚠️ [BEACON] Invalid data: " + JSON.stringify(beacon));
            return;
        }

        // DEBOUNCE: Check if we just processed this peer recently (30 seconds)
        // This prevents log flooding from P2P network echoes.
        // BYPASS debounce if source is GOSSIP or BOOTSTRAP (we explicitly asked for this)
        var isImportant = (source === 'GOSSIP' || source === 'BOOTSTRAP');
        // Reduce debounce to 10s to ensure we never block the 30s periodic beacon
        if (!isImportant && BEACON_CACHE[beacon.pubkey] && (Date.now() - BEACON_CACHE[beacon.pubkey] < 10000)) {
            return;
        }
        BEACON_CACHE[beacon.pubkey] = Date.now();

        BEACON_CACHE[beacon.pubkey] = Date.now();

        // MDS.log("📥 [BEACON] Processing: " + beacon.alias + " from " + source); // Silence processing log



        var now = Date.now();
        var escapedAlias = beacon.alias.replace(/'/g, "''");
        var bioValue = beacon.bio || "";

        // Extract permission setting (default to TRUE if not present for backward compatibility)
        var allowNonContactChats = (beacon.allowNonContactChats !== undefined && beacon.allowNonContactChats !== null)
            ? (beacon.allowNonContactChats ? 1 : 0)
            : 1;

        MDS.log("📡 [BEACON] AllowNonContactChats: " + allowNonContactChats + " for " + beacon.alias);

        // CRITICAL: If bio is empty, check DB first to preserve cached value
        if (bioValue) {
            // Bio is present - save directly
            var escapedBio = bioValue.replace(/'/g, "''");
            var discoverySql = "MERGE INTO DISCOVERED_PEERS (publickey, alias, bio, address, last_seen, source, allow_non_contact_chats) "
                + "KEY (publickey) "
                + "VALUES ('" + beacon.pubkey + "', '" + escapedAlias + "', '" + escapedBio + "', '"
                + beacon.address + "', " + now + ", '" + source + "', " + allowNonContactChats + ")";

            MDS.sql(discoverySql, function (res) {
                if (res.status) {
                    MDS.log("✅ [BEACON] Saved: " + beacon.alias + " (allowNonContactChats: " + allowNonContactChats + ")");
                    promoteToUserRegistry(beacon, now);

                    // INTERNAL SYNC: Notify Frontend about new peer
                    if (MY_MAXIMA_PK) {
                        var syncPayload = {
                            app: "metachain",
                            type: "peer_discovered",
                            peer: {
                                pubkey: beacon.pubkey,
                                alias: beacon.alias,
                                bio: beacon.bio || "",
                                address: beacon.address,
                                allowNonContactChats: allowNonContactChats
                            }
                        };
                        var syncJson = JSON.stringify(syncPayload);
                        var syncHex = "0x" + utf8ToHex(syncJson).toUpperCase();

                        MDS.cmd("maxima action:send publickey:" + MY_MAXIMA_PK + " application:metachain data:" + syncHex + " poll:false", function (syncRes) {
                            // MDS.log("📡 [SYNC] Peer discovery synced to Frontend");
                        });
                    }

                    /*
                    // DEBUG: List all peers in DB to verify persistence (Silenced for production)
                    MDS.sql("SELECT alias FROM DISCOVERED_PEERS", function (rowRes) {
                        if (rowRes.status && rowRes.rows) {
                            var aliases = rowRes.rows.map(function (r) { return r.ALIAS; }).join(", ");
                            // MDS.log("📂 [DB-CHECK] All Peers: " + aliases);
                        }
                    });
                    */

                    // REACTIVE GOSSIP: Bidirectional Discovery
                    // 1. Send our peer list to them (Welcome Package)
                    // 2. Request their peer list from them (Reactive Request)
                    if (source === 'P2P' || source === 'MAXIMA') {
                        sendWelcomePackage(beacon.pubkey, beacon.alias);

                        // REACTIVE REQUEST: Immediately ask this peer for their network
                        MDS.log("🔄 [REACTIVE] Asking " + beacon.alias + " for their peers...");
                        askPeers([beacon.pubkey]);
                    }
                } else {
                    MDS.log("❌ [BEACON] Save failed: " + JSON.stringify(res));

                    // Fallback: Check if table exists
                    MDS.sql("SELECT * FROM DISCOVERED_PEERS LIMIT 1", function (checkRes) {
                        if (!checkRes.status) {
                            MDS.log("⚠️ [BEACON] Table missing! Recreating...");
                            // Re-run creation logic? It should have run in init.
                            var discoveryLayerSql = "CREATE TABLE IF NOT EXISTS DISCOVERED_PEERS ( "
                                + "  publickey VARCHAR(512) PRIMARY KEY, "
                                + "  alias VARCHAR(160) NOT NULL, "
                                + "  address VARCHAR(512) NOT NULL, "
                                + "  last_seen BIGINT NOT NULL, "
                                + "  source VARCHAR(20) NOT NULL"
                                + " )";
                            MDS.sql(discoveryLayerSql, function (createRes) {
                                MDS.log("🛠️ [BEACON] Recreation result: " + JSON.stringify(createRes));
                                // Retry insert? No, wait for next beacon.
                            });
                        }
                    });
                }
            });
        } else {
            // Bio is empty - check DB first to preserve cached value
            MDS.sql("SELECT bio FROM DISCOVERED_PEERS WHERE publickey='" + beacon.pubkey + "'", function (checkRes) {
                var bioToSave = "";
                if (checkRes.status && checkRes.rows && checkRes.rows.length > 0 && checkRes.rows[0].BIO) {
                    bioToSave = checkRes.rows[0].BIO;
                }

                var escapedBio = bioToSave.replace(/'/g, "''");
                var discoverySql = "MERGE INTO DISCOVERED_PEERS (publickey, alias, bio, address, last_seen, source, allow_non_contact_chats) "
                    + "KEY (publickey) "
                    + "VALUES ('" + beacon.pubkey + "', '" + escapedAlias + "', '" + escapedBio + "', '"
                    + beacon.address + "', " + now + ", '" + source + "', " + allowNonContactChats + ")";

                MDS.sql(discoverySql, function (res) {
                    if (res.status) {
                        MDS.log("✅ [BEACON] Saved: " + beacon.alias + " (Bio: " + (bioToSave ? "preserved" : "empty") + ")");
                        promoteToUserRegistry(beacon, now);

                        // INTERNAL SYNC: Notify Frontend about new peer
                        if (MY_MAXIMA_PK) {
                            var syncPayload = {
                                app: "metachain",
                                type: "peer_discovered",
                                peer: {
                                    pubkey: beacon.pubkey,
                                    alias: beacon.alias,
                                    bio: bioToSave,
                                    address: beacon.address,
                                    allowNonContactChats: allowNonContactChats
                                }
                            };
                            var syncJson = JSON.stringify(syncPayload);
                            var syncHex = "0x" + utf8ToHex(syncJson).toUpperCase();

                            MDS.cmd("maxima action:send publickey:" + MY_MAXIMA_PK + " application:metachain data:" + syncHex + " poll:false", function (syncRes) {
                                // MDS.log("📡 [SYNC] Peer discovery synced to Frontend");
                            });
                        }

                        // REACTIVE GOSSIP
                        if (source === 'P2P' || source === 'MAXIMA') {
                            sendWelcomePackage(beacon.pubkey, beacon.alias);
                            MDS.log("🔄 [REACTIVE] Asking " + beacon.alias + " for their peers...");
                            askPeers([beacon.pubkey]);
                        }
                    }
                });
            });
        }
    } catch (e) {
        MDS.log("❌ [BEACON] Handler error: " + e.message + " for " + (beacon ? beacon.alias : "unknown"));
    }
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
                MDS.log("⭐ [P2P] Promoted to user registry: " + beacon.alias);
            }
        }
    });
}

// Periodic Cleanup Task (Called by NEWBLOCK)
function startCleanupTimer() {
    var oneHourAgo = Date.now() - (60 * 60 * 1000);
    var sql = "DELETE FROM DISCOVERED_PEERS WHERE last_seen < " + oneHourAgo;
    MDS.sql(sql, function (res) {
        if (res.status && res.count > 0) {
            MDS.log("🧹 [P2P] Cleaned result: " + res.count + " stale peers.");
        }
    });
}

// Bootstrap Sync Task (Called by NEWBLOCK)
function startBootstrapSync() {
    MDS.cmd("maxima", function (res) {
        if (res.status && res.response.staticmls && res.response.mls) {
            var msgData = { app: "metachain", type: "get_peers" };
            var cmd = "maxima action:send to:" + res.response.mls +
                " application:metachain data:" + JSON.stringify(msgData);
            MDS.cmd(cmd);
        }
    });
}

// BACKGROUND BEACON SENDER
function sendBackgroundBeacon() {
    MDS.log("🚀 [BG-BEACON] Preparing payload...");

    // 1. Get Maxima Info
    MDS.cmd("maxima action:info", function (maxInfo) {
        if (!maxInfo.status) {
            MDS.log("❌ [BG-BEACON] Maxima info failed.");
            return;
        }

        var info = maxInfo.response;
        var pubkey = info.publickey;
        var address = info.contact;
        var staticMLS = info.mls;
        var alias = info.name || 'Anonymous';  // Use Maxima name directly

        MDS.log("📋 [BG-BEACON] Using Maxima name: " + alias);

        // 2. Get Bio from keypair with DB fallback
        MDS.cmd("keypair action:get key:p2p_bio", function (bioRes) {

            function continueWithBio(finalBio) {
                // 3. Get Chat Permission from keypair
                MDS.cmd("keypair action:get key:allow_noncontact_chats", function (permRes) {
                    var allowNonContactChats = (permRes.status && permRes.response && permRes.response.value !== undefined)
                        ? (permRes.response.value === 'true' || permRes.response.value === true)
                        : true;

                    // Construct Beacon
                    var beacon = {
                        app: "metachain",
                        type: "BEACON",
                        v: 1,
                        pubkey: pubkey,
                        address: address,
                        alias: alias,
                        bio: finalBio,
                        allowNonContactChats: allowNonContactChats
                    };

                    var jsonStr = JSON.stringify(beacon);
                    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                    MDS.log("📤 [BG-BEACON] Sending P2P: " + alias);

                    // 4. Send P2P
                    MDS.cmd("message data:" + hexData, function (res) {
                        MDS.log("✅ [BG-BEACON] P2P sent.");

                        // Save own profile to DISCOVERED_PEERS (for cold start UX)
                        // CRITICAL: If bio is empty, check DB first to preserve cached value
                        var now = Date.now();
                        var escapedAlias = alias.replace(/'/g, "''");
                        var allowChats = allowNonContactChats ? 1 : 0;

                        if (finalBio) {
                            // Bio is present - save directly
                            var escapedBio = finalBio.replace(/'/g, "''");
                            var selfSql = "MERGE INTO DISCOVERED_PEERS (publickey, alias, bio, address, last_seen, source, allow_non_contact_chats) "
                                + "KEY (publickey) "
                                + "VALUES ('" + pubkey + "', '" + escapedAlias + "', '" + escapedBio + "', '"
                                + address + "', " + now + ", 'SELF', " + allowChats + ")";

                            MDS.sql(selfSql, function (selfRes) {
                                if (selfRes.status) {
                                    MDS.log("✅ [BG-BEACON] Own profile saved (with Bio)");
                                }
                            });
                        } else {
                            // Bio is empty - check DB first to preserve cached value
                            MDS.sql("SELECT bio FROM DISCOVERED_PEERS WHERE publickey='" + pubkey + "'", function (checkRes) {
                                var bioToSave = "";
                                if (checkRes.status && checkRes.rows && checkRes.rows.length > 0 && checkRes.rows[0].BIO) {
                                    bioToSave = checkRes.rows[0].BIO;
                                    MDS.log("✅ [BG-BEACON] Preserving cached Bio: " + bioToSave.substring(0, 20) + "...");
                                }

                                var escapedBio = bioToSave.replace(/'/g, "''");
                                var selfSql = "MERGE INTO DISCOVERED_PEERS (publickey, alias, bio, address, last_seen, source, allow_non_contact_chats) "
                                    + "KEY (publickey) "
                                    + "VALUES ('" + pubkey + "', '" + escapedAlias + "', '" + escapedBio + "', '"
                                    + address + "', " + now + ", 'SELF', " + allowChats + ")";

                                MDS.sql(selfSql, function (selfRes) {
                                    if (selfRes.status) {
                                        MDS.log("✅ [BG-BEACON] Own profile saved (Bio: " + (bioToSave ? "preserved" : "empty") + ")");
                                    }
                                });
                            });
                        }

                        // 5. Send to Bootstrap (if exists)
                        if (staticMLS && info.staticmls) {
                            var bootstrapBeacon = {
                                app: "metachain",
                                type: "register",
                                pubkey: pubkey,
                                address: address,
                                alias: alias,
                                bio: finalBio,
                                allowNonContactChats: allowNonContactChats
                            };
                            var bootCmd = "maxima action:send to:" + staticMLS + " application:metachain data:" + JSON.stringify(bootstrapBeacon);
                            MDS.cmd(bootCmd, function (bootRes) {
                                MDS.log("✅ [BG-BEACON] Sent to Bootstrap.");
                            });
                        }
                    });
                });
            }


            // Decide which bio to use - ALWAYS check DB if keypair is empty
            var keypairBio = (bioRes.status && bioRes.response && bioRes.response.value) ? bioRes.response.value : "";

            if (keypairBio) {
                // Keypair has a value, use it
                continueWithBio(keypairBio);
            } else {
                // Keypair is empty or failed - check DB for cached value
                MDS.log("⚠️ [BG-BEACON] Keypair Bio empty/failed, checking DB cache...");
                MDS.sql("SELECT bio FROM DISCOVERED_PEERS WHERE source='SELF'", function (sqlRes) {
                    if (sqlRes.status && sqlRes.rows && sqlRes.rows.length > 0 && sqlRes.rows[0].BIO) {
                        MDS.log("✅ [BG-BEACON] Using cached Bio from DB: " + sqlRes.rows[0].BIO.substring(0, 20) + "...");
                        continueWithBio(sqlRes.rows[0].BIO);
                    } else {
                        MDS.log("ℹ️ [BG-BEACON] No cached Bio found, using empty");
                        continueWithBio("");
                    }
                });
            }
        });
    });
}

// Helper function to create DISCOVERED_PEERS table
function createDiscoveredPeersTable() {
    // Table is already created in inited block, this is just a placeholder
    // to avoid errors if it gets called
    MDS.log("💾 [DB] DISCOVERED_PEERS table check (already created in init).");
}

// Gossip Protocol - Ask peers for their network view
function startGossip() {
    MDS.log("🗣️ [GOSSIP] Starting discovery...");

    // 1. Try Discovered Peers first
    MDS.sql("SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 5", function (res) {
        if (res.status && res.rows && res.rows.length > 0) {
            MDS.log("🗣️ [GOSSIP] Asking " + res.rows.length + " discovered peers...");
            askPeers(res.rows.map(r => r.PUBLICKEY));
        } else {
            // 2. Fallback to Contacts if no discovered peers
            MDS.cmd("maxcontacts", function (contactRes) {
                if (contactRes.status && contactRes.response.contacts && contactRes.response.contacts.length > 0) {
                    var contacts = contactRes.response.contacts;
                    // Pick top 5 random
                    var targets = [];
                    for (var i = 0; i < Math.min(5, contacts.length); i++) {
                        targets.push(contacts[i].publickey);
                    }
                    MDS.log("🗣️ [GOSSIP] Asking " + targets.length + " contacts...");
                    askPeers(targets);
                } else {
                    MDS.log("⚠️ [GOSSIP] No peers to ask.");
                }
            });
        }
    });
}

function askPeers(pubkeys) {
    // Get my info for the request
    MDS.cmd("maxima action:info", function (maxInfo) {
        var myAlias = (maxInfo.status) ? maxInfo.response.name : "Anonymous";

        var requestPayload = {
            app: "metachain",
            type: "get_peers",
            alias: myAlias
        };

        var jsonStr = JSON.stringify(requestPayload);
        var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        for (var i = 0; i < pubkeys.length; i++) {
            var pk = pubkeys[i];
            // Don't ask myself
            if (MY_MAXIMA_PK && pk === MY_MAXIMA_PK) continue;

            MDS.cmd("maxima action:send publickey:" + pk + " application:metachain data:" + hexData + " poll:false", function (res) {
                // Logs are noisy, maybe skip
            });
        }
    });
}

// Reactive Gossip - Send Welcome Package
function sendWelcomePackage(targetPubkey, targetAlias) {
    // Prevent replying to myself
    if (MY_MAXIMA_PK && targetPubkey === MY_MAXIMA_PK) return;

    MDS.log("🎁 [GOSSIP] Sending Welcome Package to " + targetAlias);

    // Fetch our known peers (Limit 50, sort by last seen desc)
    var peerSql = "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 50";
    MDS.sql(peerSql, function (res) {
        if (res.status && res.rows && res.rows.length > 0) {
            var peers = [];
            for (var i = 0; i < res.rows.length; i++) {
                var row = res.rows[i];
                peers.push({
                    pubkey: row.PUBLICKEY,
                    alias: row.ALIAS,
                    bio: row.BIO,
                    address: row.ADDRESS,
                    allowNonContactChats: (row.ALLOW_NON_CONTACT_CHATS === 1 || row.ALLOW_NON_CONTACT_CHATS === true)
                });
            }

            // Also include Myself in the list! (Important so they know me fully)
            // Ideally we should merge ourselves, but the Beacon already gave them my basic info.
            // Let's stick to sending other peers.

            // Send response
            var responsePayload = {
                app: "metachain",
                type: "peers_response",
                peers: peers
            };

            var jsonStr = JSON.stringify(responsePayload);
            var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

            MDS.cmd("maxima action:send publickey:" + targetPubkey + " application:metachain data:" + hexData + " poll:false", function (sendRes) {
                MDS.log("✅ [GOSSIP] Welcome Package sent to " + targetAlias);
            });
        } else {
            MDS.log("ℹ️ [GOSSIP] No peers to send in Welcome Package.");
        }
    });
}
