/**
 * MetaChain Service Worker - Utilities
 * Shared functions and global variables for all handlers
 */

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

var LAST_GOSSIP = 0;
var BEACON_INTERVAL = 60000; // 1 minute
var MY_MAXIMA_PK = "";
var BEACON_CACHE = {};
var GOSSIP_INTERVAL = 30000; // 30 seconds
var LAST_BEACON_TIME = 0;

// ============================================================================
// HEX/UTF8 CONVERSION UTILITIES
// ============================================================================

/**
 * Convert HEX to UTF8 - Full UTF-8 Variant for MAXIMA Messages
 * Properly decodes multi-byte characters (català, emojis, etc.)
 */
function hexToUtf8(hexStr) {
    hexStr = hexStr.replace(/\s+/g, '').replace(/^0x/i, '');
    var bytes = [];
    for (var i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }

    var str = '';
    var i = 0;
    while (i < bytes.length) {
        var byte1 = bytes[i++];
        if (byte1 < 0x80) {
            str += String.fromCharCode(byte1);
        } else if (byte1 >= 0xC0 && byte1 < 0xE0) {
            var byte2 = bytes[i++];
            var codePoint = ((byte1 & 0x1F) << 6) | (byte2 & 0x3F);
            str += String.fromCharCode(codePoint);
        } else if (byte1 >= 0xE0 && byte1 < 0xF0) {
            var byte2 = bytes[i++];
            var byte3 = bytes[i++];
            var codePoint = ((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F);
            str += String.fromCharCode(codePoint);
        } else if (byte1 >= 0xF0 && byte1 < 0xF8) {
            var byte2 = bytes[i++];
            var byte3 = bytes[i++];
            var byte4 = bytes[i++];
            var codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
            codePoint -= 0x10000;
            str += String.fromCharCode(0xD800 + (codePoint >> 10));
            str += String.fromCharCode(0xDC00 + (codePoint & 0x3FF));
        }
    }
    return str;
}

/**
 * Convert HEX to UTF8 - Simple Variant for P2P Beacons
 */
function hexToUtf8Simple(hexStr) {
    hexStr = hexStr.replace(/\s+/g, '');
    var bytes = [];
    for (var i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }
    var str = '';
    for (var i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return str;
}

/**
 * Convert UTF8 to HEX
 */
function utf8ToHex(s) {
    var r = "";
    var utf8 = unescape(encodeURIComponent(s));
    for (var i = 0; i < utf8.length; i++) {
        var b = utf8.charCodeAt(i);
        r += ("0" + b.toString(16)).slice(-2);
    }
    return r;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper to determine if a privacy level should be included
 */
function shouldIncludeLevel(visibility, isContact, isPersonalContact) {
    if (visibility === 'public') return true;
    if (visibility === 'contacts' && isContact) return true;
    if (visibility === 'personal' && isPersonalContact) return true;
    return false;
}

/**
 * Safe Decode Helper - Handles Mojibake and URI encoding
 */
function safeDecode(str) {
    if (!str) return str;

    // 1. Try resolving Mojibake
    try {
        if (/[ÃÂÅÄ]/.test(str)) {
            var bytes = new Uint8Array(str.length);
            for (var i = 0; i < str.length; i++) {
                var code = str.charCodeAt(i);
                if (code > 255) { }
                bytes[i] = code;
            }
            var decoder = new TextDecoder('utf-8');
            var decoded = decoder.decode(bytes);
            if (decoded !== str && decoded.indexOf('\uFFFD') === -1) {
                str = decoded;
            }
        }
    } catch (e) { }

    // 2. Try URI decoding
    try {
        if (str.indexOf('%') !== -1) {
            str = decodeURIComponent(str);
        }
    } catch (e) { }

    // 3. Known Manual Fixes
    if (str && typeof str === 'string') {
        if (str.indexOf('Catalan') !== -1 && (str.indexOf('Catal') !== -1 || str.indexOf('CatalÃ') !== -1)) return 'Catalan (Català)';
        if (str.indexOf('Spanish') !== -1 && (str.indexOf('Espa') !== -1 || str.indexOf('EspaÃ±') !== -1)) return 'Spanish (Español)';
        if (str.indexOf('Basque') !== -1 && str.indexOf('Euskera') !== -1) return 'Basque (Euskera)';
    }

    return str;
}

/**
 * SQL Escape helper
 */
function escapeSql(str) {
    return (str || '').replace(/'/g, "''");
}
/**
 * MetaChain Service Worker - Database Initialization
 * Creates all required tables on startup
 */

function initDatabase() {
    MDS.log("🚀 [SW] STARTING UP - v1.4 (MODULAR)");

    // Register for NEWBLOCK events
    MDS.cmd("event on newblock", function (res) { });

    // Get our own Maxima info
    MDS.cmd("maxima action:info", function (maxInfo) {
        if (maxInfo.status) {
            MY_MAXIMA_PK = maxInfo.response.publickey;
            MDS.log("🔑 [SW] My Public Key: " + MY_MAXIMA_PK);
        }
    });

    // CHAT_MESSAGES table
    var chatMessagesSql = "CREATE TABLE IF NOT EXISTS CHAT_MESSAGES ( "
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

    MDS.sql(chatMessagesSql, function (res) {
        MDS.log("💾 [DB] CHAT_MESSAGES initialized");

        // Add columns if missing
        MDS.sql("ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS amount INT NOT NULL DEFAULT 0");

        // CHAT_STATUS table
        var chatStatusSql = "CREATE TABLE IF NOT EXISTS CHAT_STATUS ( "
            + "  publickey VARCHAR(512) PRIMARY KEY, "
            + "  archived BOOLEAN NOT NULL DEFAULT FALSE, "
            + "  archived_date BIGINT, "
            + "  last_opened BIGINT, "
            + "  favorite BOOLEAN NOT NULL DEFAULT FALSE, "
            + "  blocked BOOLEAN NOT NULL DEFAULT FALSE, "
            + "  blocked_by_them BOOLEAN NOT NULL DEFAULT FALSE "
            + " )";

        MDS.sql(chatStatusSql, function () {
            MDS.sql("ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE");
            MDS.sql("ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE");
            MDS.sql("ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked_by_them BOOLEAN NOT NULL DEFAULT FALSE");
        });

        // MY_PROFILE table
        var myProfileSql = "CREATE TABLE IF NOT EXISTS MY_PROFILE ( "
            + "  id INT PRIMARY KEY, "
            + "  avatar TEXT, "
            + "  tags TEXT, "
            + "  bio_extended TEXT, "
            + "  social_links TEXT, "
            + "  location TEXT, "
            + "  last_updated BIGINT "
            + " )";

        MDS.sql(myProfileSql, function () {
            MDS.sql("INSERT IGNORE INTO MY_PROFILE (id) VALUES (1)", function () {
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS phone TEXT");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS email TEXT");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS website TEXT");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS country TEXT");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS languages TEXT");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l2 VARCHAR(20) DEFAULT 'public'");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l3 VARCHAR(20) DEFAULT 'contacts'");
            });
        });

        // DISCOVERED_PEERS table
        var discoveryLayerSql = "CREATE TABLE IF NOT EXISTS DISCOVERED_PEERS ( "
            + "  publickey VARCHAR(512) PRIMARY KEY, "
            + "  alias VARCHAR(160) NOT NULL, "
            + "  bio VARCHAR(512), "
            + "  address VARCHAR(512) NOT NULL, "
            + "  last_seen BIGINT NOT NULL, "
            + "  source VARCHAR(20) NOT NULL"
            + " )";

        MDS.sql(discoveryLayerSql, function () {
            MDS.sql("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS bio VARCHAR(512)");
            MDS.sql("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE");
            MDS.sql("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS extra_data CLOB");
        });

        // CONTACT_REQUESTS table
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

        MDS.sql(contactRequestsSql, function () {
            MDS.sql("ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_address VARCHAR(1024)");
        });

        // PERSONAL_CONTACTS table (Replaces keypair storage)
        var personalContactsSql = "CREATE TABLE IF NOT EXISTS PERSONAL_CONTACTS ( "
            + "  publickey VARCHAR(512) PRIMARY KEY, "
            + "  created_at BIGINT "
            + " )";

        MDS.sql(personalContactsSql, function () {
            MDS.log("💾 [DB] PERSONAL_CONTACTS initialized");
        });

        // MAXIMA_CONTACT_REQUESTS table
        var maximaContactRequestsSql = "CREATE TABLE IF NOT EXISTS MAXIMA_CONTACT_REQUESTS ( "
            + "  id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            + "  from_publickey VARCHAR(512) NOT NULL, "
            + "  from_name VARCHAR(255), "
            + "  to_publickey VARCHAR(512) NOT NULL, "
            + "  status VARCHAR(32) DEFAULT 'pending', "
            + "  created_at BIGINT NOT NULL, "
            + "  updated_at BIGINT "
            + " )";

        MDS.sql(maximaContactRequestsSql);

        // METACHAIN_USERS table
        var userRegistrySql = "CREATE TABLE IF NOT EXISTS METACHAIN_USERS ( "
            + "  user_id VARCHAR(512) PRIMARY KEY, "
            + "  publickey VARCHAR(512) UNIQUE NOT NULL, "
            + "  alias VARCHAR(160) NOT NULL, "
            + "  address VARCHAR(512) NOT NULL, "
            + "  first_seen BIGINT NOT NULL, "
            + "  last_updated BIGINT NOT NULL"
            + " )";

        MDS.sql(userRegistrySql);

        // Enable logs for P2P beacons
        MDS.cmd("logs on", function (logRes) {
            if (logRes.status) {
                MDS.log("✅ [INIT] MINIMALOG listener registered");
            }
        });

        // Send initial beacon
        MDS.log("🚀 [SW] Sending initial beacon...");
        sendBackgroundBeacon();
        startGossip();

        // Register for periodic tasks
        MDS.cmd("event on newblock", function () {
            MDS.log("✅ [INIT] NEWBLOCK listener registered for periodic tasks.");
        });
    });
}
/**
 * MetaChain Service Worker - Group Message Handler
 * Handles group messages, invites, member updates
 */

function handleGroupMessage(pubkey, maxjson) {
    MDS.log("📨 [GROUP-MSG] Processing...");

    // Migration: Ensure propagated column exists
    var migrationSql = "ALTER TABLE GROUP_MESSAGES ADD COLUMN propagated INT DEFAULT 0";
    MDS.sql(migrationSql, function (migRes) {
        var encoded = (maxjson.message || "").replace(/'/g, "''");
        var messageTimestamp = maxjson.timestamp || Date.now();
        var originalSender = maxjson.senderPublickey || pubkey;

        // Check for duplicates
        var checkSql = "SELECT id, propagated FROM GROUP_MESSAGES WHERE group_id='" + maxjson.groupId + "' AND sender_publickey='" + originalSender + "' AND date=" + messageTimestamp;

        MDS.sql(checkSql, function (checkRes) {
            var shouldPropagate = false;

            if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
                var row = checkRes.rows[0];
                var isPropagated = (row.PROPAGATED === 1 || row.propagated === 1);

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
                var groupMsgSql = "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated) VALUES "
                    + "('" + maxjson.groupId + "','" + originalSender + "','" + maxjson.senderUsername + "','" + (maxjson.type || "text") + "','" + encoded + "','" + (maxjson.filedata || "") + "'," + messageTimestamp + ", 0, 1)";

                MDS.sql(groupMsgSql, function (res) {
                    if (res.status) {
                        MDS.log("✅ [DB] Group message saved (propagated=1).");
                    } else {
                        MDS.log("❌ [DB] Failed to save group message: " + res.error);
                        if (res.error && res.error.indexOf('propagated') !== -1) {
                            var retrySql = "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read) VALUES "
                                + "('" + maxjson.groupId + "','" + originalSender + "','" + maxjson.senderUsername + "','" + (maxjson.type || "text") + "','" + encoded + "','" + (maxjson.filedata || "") + "'," + messageTimestamp + ", 0)";
                            MDS.sql(retrySql);
                        }
                    }
                });
            }

            if (shouldPropagate) {
                propagateGroupMessage(pubkey, maxjson);
            }
        });
    });
}

function propagateGroupMessage(pubkey, maxjson) {
    MDS.log("🔄 [GROUP-MSG] Starting propagation...");

    var membersSql = "SELECT * FROM GROUP_MEMBERS WHERE group_id='" + maxjson.groupId + "'";
    MDS.sql(membersSql, function (memberRes) {
        if (!memberRes.status || !memberRes.rows) {
            MDS.log("❌ [GROUP-MSG] Failed to fetch members.");
            return;
        }

        var members = memberRes.rows;
        MDS.log("🔍 [GROUP-MSG] Found " + members.length + " members.");

        MDS.cmd("maxcontacts", function (contactRes) {
            if (!contactRes.status || !contactRes.response.contacts) {
                MDS.log("❌ [CONTACTS] Failed to fetch contacts.");
                return;
            }

            var contacts = contactRes.response.contacts;

            MDS.cmd("maxima", function (maximaRes) {
                var myPubkey = maximaRes.response.publickey;
                var propagatedCount = 0;

                for (var i = 0; i < members.length; i++) {
                    var memberPubkey = members[i].PUBLICKEY;

                    if (memberPubkey === pubkey || memberPubkey === maxjson.senderPublickey || memberPubkey === myPubkey) continue;

                    var isContact = false;
                    for (var j = 0; j < contacts.length; j++) {
                        if (contacts[j].publickey === memberPubkey) {
                            isContact = true;
                            break;
                        }
                    }

                    if (isContact) {
                        var jsonStr = JSON.stringify(maxjson);
                        var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                        MDS.log("📤 [GROUP-MSG] Propagating to: " + memberPubkey.substring(0, 10));
                        MDS.cmd("maxima action:send publickey:" + memberPubkey + " application:metachain-group data:" + hexData + " poll:false");
                        propagatedCount++;
                    }
                }
                MDS.log("✅ [GROUP-MSG] Propagation complete. Sent to " + propagatedCount + " contacts.");
            });
        });
    });
}

function handleGroupInvite(pubkey, maxjson) {
    MDS.log("📨 [GROUP-INVITE] Processing...");

    var createGroupSql = "INSERT INTO GROUPS (group_id, name, creator_publickey, created_date, description) VALUES "
        + "('" + maxjson.groupId + "','" + (maxjson.groupName || '').replace(/'/g, "''") + "','" + pubkey + "'," + maxjson.timestamp + ",'" + (maxjson.description || "").replace(/'/g, "''") + "')";

    MDS.sql(createGroupSql, function (res) {
        MDS.log("✅ [GROUP-MGMT] Group created/exists");

        if (maxjson.members) {
            var addMember = function (idx) {
                if (idx >= maxjson.members.length) return;
                var m = maxjson.members[idx];
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
}

function handleGroupMemberUpdate(pubkey, maxjson) {
    MDS.log("🔄 [GROUP-MEMBER] Update: " + maxjson.messageType);

    if (maxjson.messageType === "group_member_added") {
        var addMemberSql = "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES "
            + "('" + maxjson.groupId + "','" + maxjson.memberPublickey + "','" + (maxjson.memberUsername || 'Unknown').replace(/'/g, "''") + "'," + maxjson.timestamp + ",'member')";
        MDS.sql(addMemberSql);
    } else {
        var removeMemberSql = "DELETE FROM GROUP_MEMBERS WHERE group_id='" + maxjson.groupId + "' AND publickey='" + maxjson.memberPublickey + "'";
        MDS.sql(removeMemberSql);
    }
}
/**
 * MetaChain Service Worker - Chat Message Handler
 * Handles chat messages, read receipts, pings, pongs
 */

function handleChatMessage(pubkey, maxjson) {
    MDS.log("💬 [CHAT] From: " + pubkey + " - " + (maxjson.message || "").substring(0, 30));

    var now = Date.now();
    var safePubkey = escapeSql(pubkey);
    var safeUsername = escapeSql(maxjson.username || "Unknown");
    var safeMessage = escapeSql(maxjson.message || "");
    var safeFiledata = escapeSql(maxjson.filedata || "");
    var msgType = maxjson.type || "text";
    var amount = maxjson.amount || 0;

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
        }

        // 2. Insert message to DB if not blocked
        var insertSql = "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date) "
            + "VALUES ('', '" + safePubkey + "', '" + safeUsername + "', '" + msgType + "', '" + safeMessage + "', '" + safeFiledata + "', 'received', " + amount + ", " + now + ")";

        MDS.sql(insertSql, function (res) {
            if (res.status) {
                MDS.log("✅ [CHAT] Message saved from " + safeUsername);

                // FIX: Auto-discover user on message receipt to fix "Unknown" in chat list
                if (safeUsername && safeUsername !== "Unknown" && safeUsername !== "System") {
                    var upsertPeer = "MERGE INTO DISCOVERED_PEERS (publickey, alias, last_seen) KEY(publickey) " +
                        "VALUES ('" + safePubkey + "', '" + safeUsername + "', " + now + ")";
                    MDS.sql(upsertPeer, function (pRes) {
                        MDS.log("👤 [CHAT] Auto-discovered peer: " + safeUsername);
                    });
                }
            } else {
                MDS.log("❌ [CHAT] Save failed: " + res.error);
            }
        });
    });
}

function handleReadReceipt(pubkey) {
    MDS.log("📖 [READ-RECEIPT] Received from " + pubkey);
    var sql = "UPDATE CHAT_MESSAGES SET state='read' WHERE publickey='" + pubkey + "' AND username='Me' AND state!='pending' AND state!='failed'";
    MDS.sql(sql);
}

function handleDeliveryReceipt(pubkey) {
    MDS.log("📬 [DELIVERY-RECEIPT] Ignoring (handled by UI)");
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
                var mxAddress = rawMx ? rawMx.replace(/[^a-zA-Z0-9@:._-]/g, "").trim() : null;

                if (mxAddress && (mxAddress.startsWith('Mx') || mxAddress.startsWith('MX'))) {
                    sendCmd = 'maxima action:send to:"' + mxAddress + '" application:metachain data:' + hexData + ' poll:false';
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
            sendCmd = 'maxima action:send to:"' + pubkey.trim() + '" application:metachain data:' + hexData + ' poll:false';
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
/**
 * MetaChain Service Worker - Contact Request Handler
 * Handles chat contact requests and Maxima contact requests
 */

// ============================================================================
// CHAT CONTACT REQUESTS
// ============================================================================

function handleContactRequest(pubkey, maxjson) {
    MDS.log("📨 [CONTACTS] Request received from " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);
    var safeName = escapeSql(maxjson.name || "Unknown");
    var safeAvatar = escapeSql(maxjson.avatar || "");
    var safeFromAddress = escapeSql(maxjson.from_address || "");

    MDS.cmd("maxima action:info", function (infoRes) {
        if (infoRes.status && infoRes.response) {
            var myPk = escapeSql(infoRes.response.publickey);

            // Delete existing and insert fresh
            var deleteSql = "DELETE FROM CONTACT_REQUESTS WHERE from_publickey='" + safeFrom + "' AND to_publickey='" + myPk + "'";
            MDS.sql(deleteSql, function () {
                var insertSql = "INSERT INTO CONTACT_REQUESTS(from_publickey, from_name, from_avatar, from_address, to_publickey, status, created_at, updated_at) "
                    + "VALUES('" + safeFrom + "', '" + safeName + "', '" + safeAvatar + "', '" + safeFromAddress + "', '" + myPk + "', 'pending', " + now + ", " + now + ")";

                MDS.sql(insertSql, function () {
                    MDS.log("✅ [CONTACTS] Request saved to database");
                });
            });

            // Insert system message
            var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
                + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Chat request received', '', 'received', 0, " + now + ")";
            MDS.sql(sysMsgSql);
        }
    });

    // Send delivery confirmation
    var confirmPayload = { type: "contact_request_received", timestamp: now };
    var confirmHex = "0x" + utf8ToHex(JSON.stringify(confirmPayload)).toUpperCase();
    MDS.cmd("maxima action:send publickey:" + pubkey + " application:metachain data:" + confirmHex + " poll:false");
}

function handleContactDeclined(pubkey) {
    MDS.log("🚫 [CONTACTS] Request declined by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var updateSql = "UPDATE CONTACT_REQUESTS SET status='declined', updated_at=" + now + " WHERE from_publickey='" + safeFrom + "' AND status='pending'";
    MDS.sql(updateSql, function () {
        MDS.log("✅ [CONTACTS] Updated request status to declined");
    });

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Chat request declined', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleContactCancelled(pubkey) {
    MDS.log("🚫 [CONTACTS] Request cancelled by sender " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var deleteSql = "DELETE FROM CONTACT_REQUESTS WHERE from_publickey='" + safeFrom + "' AND status='pending'";
    MDS.sql(deleteSql, function () {
        MDS.log("✅ [CONTACTS] Removed cancelled request");
    });

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Chat request cancelled', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleContactAccepted(pubkey, maxjson) {
    MDS.log("✅ [CONTACTS] Request accepted by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    MDS.cmd("maxima action:info", function (infoRes) {
        if (infoRes.status && infoRes.response) {
            var myPk = escapeSql(infoRes.response.publickey);

            // Check if record exists (in either direction) -> Robust update
            var checkSql = "SELECT * FROM CONTACT_REQUESTS WHERE " +
                "(from_publickey='" + myPk + "' AND to_publickey='" + safeFrom + "') OR " +
                "(from_publickey='" + safeFrom + "' AND to_publickey='" + myPk + "')";

            MDS.sql(checkSql, function (checkRes) {
                if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
                    // Exists -> Force update to accepted
                    var updateSql = "UPDATE CONTACT_REQUESTS SET status='accepted', updated_at=" + now + " "
                        + "WHERE (from_publickey='" + myPk + "' AND to_publickey='" + safeFrom + "') OR "
                        + "(from_publickey='" + safeFrom + "' AND to_publickey='" + myPk + "')";
                    MDS.sql(updateSql, function () {
                        MDS.log("✅ [CONTACTS] Updated request status to accepted");
                    });
                } else {
                    // Does not exist -> Insert new accepted record
                    var insertSql = "INSERT INTO CONTACT_REQUESTS (from_publickey, to_publickey, status, created_at, updated_at) "
                        + "VALUES ('" + myPk + "', '" + safeFrom + "', 'accepted', " + now + ", " + now + ")";
                    MDS.sql(insertSql, function () {
                        MDS.log("✅ [CONTACTS] Created new accepted request record");
                    });
                }
            });
        }
    });

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Chat request accepted', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

// ============================================================================
// MAXIMA CONTACT REQUESTS
// ============================================================================

function handleMaximaContactRequest(pubkey, maxjson) {
    MDS.log("📨 [MAXIMA CONTACT] Request received from " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);
    var safeName = escapeSql(maxjson.name || "Unknown");

    MDS.cmd("maxima action:info", function (infoRes) {
        if (infoRes.status && infoRes.response) {
            var myPk = escapeSql(infoRes.response.publickey);

            var deleteSql = "DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE from_publickey='" + safeFrom + "' AND to_publickey='" + myPk + "'";
            MDS.sql(deleteSql, function () {
                var insertSql = "INSERT INTO MAXIMA_CONTACT_REQUESTS(from_publickey, from_name, to_publickey, status, created_at, updated_at) "
                    + "VALUES('" + safeFrom + "', '" + safeName + "', '" + myPk + "', 'pending', " + now + ", " + now + ")";

                MDS.sql(insertSql, function () {
                    MDS.log("✅ [MAXIMA CONTACT] Request saved");
                });
            });

            var sysMsg = "Maxima contact request received";
            var chatSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
                + "VALUES('" + safeName + "', '" + safeFrom + "', '" + safeName + "', 'system', '" + sysMsg + "', '', 'received', 0, " + now + ")";
            MDS.sql(chatSql);
        }
    });
}

function handleMaximaContactAccepted(pubkey, maxjson) {
    MDS.log("✅ [MAXIMA CONTACT] Request accepted by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var updateSql = "UPDATE MAXIMA_CONTACT_REQUESTS SET status='accepted', updated_at=" + now + " WHERE to_publickey='" + safeFrom + "'";
    MDS.sql(updateSql, function () {
        MDS.log("✅ [MAXIMA CONTACT] Status updated");
    });

    // Try to add to contacts if available
    MDS.cmd("maxcontacts action:list", function (res) {
        if (res.status && res.response && res.response.contacts) {
            var contacts = res.response.contacts;
            for (var i = 0; i < contacts.length; i++) {
                if (contacts[i].publickey === pubkey && contacts[i].currentaddress) {
                    MDS.cmd("maxcontacts action:add contact:" + contacts[i].currentaddress, function () {
                        MDS.log("✅ [MAXIMA CONTACT] Added to maxcontacts");
                    });
                    break;
                }
            }
        }
    });

    // Add from_address if provided
    if (maxjson.from_address) {
        MDS.cmd("maxcontacts action:add contact:" + maxjson.from_address, function () {
            MDS.log("✅ [MAXIMA CONTACT] Added via from_address");
        });
    }

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Maxima contact accepted', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleMaximaContactDeclined(pubkey) {
    MDS.log("🚫 [MAXIMA CONTACT] Request declined by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var updateSql = "UPDATE MAXIMA_CONTACT_REQUESTS SET status='declined', updated_at=" + now + " WHERE to_publickey='" + safeFrom + "'";
    MDS.sql(updateSql);

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Maxima contact declined', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleMaximaContactCancelled(pubkey) {
    MDS.log("🚫 [MAXIMA CONTACT] Request cancelled by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var deleteSql = "DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE from_publickey='" + safeFrom + "' AND status='pending'";
    MDS.sql(deleteSql);

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Maxima contact cancelled', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleMaximaContactRemoved(pubkey, maxjson) {
    MDS.log("🗑️ [MAXIMA CONTACT] Removed by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    // Insert system message
    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Contact removed', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

// ============================================================================
// HANDLER FOR BLOCKING
// ============================================================================

function handleContactBlocked(pubkey) {
    MDS.log("🚫 [CONTACTS] Handling block from " + pubkey);
    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    // Set blocked_by_them flag
    var updateSql = "MERGE INTO CHAT_STATUS (publickey, blocked_by_them) KEY(publickey) VALUES('" + safeFrom + "', TRUE)";
    MDS.sql(updateSql);

    // Insert system message
    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'This user has blocked you', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleContactUnblocked(pubkey) {
    MDS.log("🔓 [CONTACTS] Handling unblock from " + pubkey);
    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    // Clear blocked_by_them flag
    var updateSql = "UPDATE CHAT_STATUS SET blocked_by_them=FALSE WHERE publickey='" + safeFrom + "'";
    MDS.sql(updateSql);

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'This user has unblocked you', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}
/**
 * MetaChain Service Worker - Profile Handler
 * Handles profile requests and responses
 * RESTORED FROM WORKING EXAMPLE
 */

function handleProfileRequest(pubkey, maxjson) {
    MDS.log("🕵️ [PROFILE] Request received from: " + pubkey.substring(0, 20) + "...");

    try {
        // Step 1: Check if requester is a contact
        MDS.cmd("maxcontacts", function (contactsRes) {
            var isContact = false;
            if (contactsRes.status && contactsRes.response && contactsRes.response.contacts) {
                var contacts = contactsRes.response.contacts;
                for (var i = 0; i < contacts.length; i++) {
                    if (contacts[i].publickey === pubkey) {
                        isContact = true;
                        break;
                    }
                }
            }
            MDS.log("🔍 [PROFILE] Requester is contact: " + isContact);

            // Step 2: Fetch profile & privacy settings from DB
            MDS.sql("SELECT * FROM MY_PROFILE LIMIT 1", function (res) {
                MDS.log("🔍 [PROFILE-DEBUG] DB Fetch Result: " + JSON.stringify(res));

                var profile = {};
                var level2Visibility = "public";
                var level3Visibility = "personal"; // Default to personal for safety
                var row = {};

                if (res.status && res.rows && res.rows.length > 0) {
                    row = res.rows[0];
                    // Log raw column values for debugging
                    MDS.log("🔍 [PROFILE] RAW DB Values - PRIVACY_L2: " + row.PRIVACY_L2 + ", PRIVACY_L3: " + row.PRIVACY_L3);
                    // Read Privacy Settings from DB if available
                    if (row.PRIVACY_L2 || row.privacy_l2) level2Visibility = row.PRIVACY_L2 || row.privacy_l2;

                    var rawL3 = row.PRIVACY_L3 || row.privacy_l3;
                    if (rawL3 === 'contacts') {
                        level3Visibility = 'personal'; // Enforcement: 'contacts' behaves as 'personal' for safety
                    } else if (rawL3) {
                        level3Visibility = rawL3;
                    }
                }

                MDS.log("🔐 [PROFILE] Privacy Resolved (DB) - L2: " + level2Visibility + ", L3: " + level3Visibility);

                // Check personal contacts via SQL (Migrated from Keypair)
                MDS.sql("SELECT * FROM PERSONAL_CONTACTS", function (personalRes) {
                    var personalContacts = [];
                    if (personalRes.status && personalRes.rows) {
                        // Extract public keys
                        for (var i = 0; i < personalRes.rows.length; i++) {
                            personalContacts.push(personalRes.rows[i].PUBLICKEY);
                        }
                    }
                    MDS.log("🔍 [PROFILE-DEBUG] Personal Contacts (SQL): " + personalContacts.length);

                    var isPersonalContact = false;
                    for (var i = 0; i < personalContacts.length; i++) {
                        if (personalContacts[i].toLowerCase() === pubkey.toLowerCase()) {
                            isPersonalContact = true;
                            break;
                        }
                    }

                    if (isPersonalContact) {
                        MDS.log("✅ [PROFILE] Requester is a PERSONAL contact!");
                    } else {
                        MDS.log("❌ [PROFILE-DEBUG] No match found for " + pubkey.substring(0, 10) + "... in Personal List");
                    }

                    // Step 3: Determine what to include
                    var includeLevel2 = shouldIncludeLevel(level2Visibility, isContact, isPersonalContact);
                    var includeLevel3 = shouldIncludeLevel(level3Visibility, isContact, isPersonalContact);

                    MDS.log("🔒 [PROFILE] Sharing - Level2: " + includeLevel2 + ", Level3: " + includeLevel3);

                    // Populate profile object from row data
                    if (res.status && res.rows && res.rows.length > 0) {
                        // Level 2 fields
                        if (includeLevel2) {
                            try { profile.social = JSON.parse(decodeURIComponent(row.SOCIAL_LINKS || "{}")); } catch (e) { }
                            try { profile.languages = JSON.parse(decodeURIComponent(row.LANGUAGES || "[]")); } catch (e) { }
                            profile.location = decodeURIComponent(row.LOCATION || "");
                            profile.country = decodeURIComponent(row.COUNTRY || "");
                            profile.website = decodeURIComponent(row.WEBSITE || "");
                        }

                        // Level 3 fields
                        if (includeLevel3) {
                            profile.email = decodeURIComponent(row.EMAIL || "");
                            profile.phone = decodeURIComponent(row.PHONE || "");
                            MDS.log("📧 [PROFILE] Level 3 included - Email: " + (profile.email || "EMPTY") + ", Phone: " + (profile.phone || "EMPTY"));
                        } else {
                            MDS.log("🚫 [PROFILE] Level 3 NOT included (visibility: " + level3Visibility + ")");
                        }

                        var rawValue = row.ALLOW_NON_CONTACT_CHATS || row.allow_non_contact_chats;
                        profile.allowNonContactChats = (rawValue === 1 || rawValue === "1" || rawValue === true || rawValue === "true");
                    }

                    // Step 5: Get Basic Info from Maxima (Level 1 - Always public)
                    MDS.cmd("maxima action:info", function (maximaRes) {
                        MDS.log("👤 [PROFILE] Maxima info - Status: " + maximaRes.status);

                        var name = "Unknown";
                        var avatar = "";

                        if (maximaRes.status && maximaRes.response) {
                            name = maximaRes.response.name || "Unknown";
                            avatar = maximaRes.response.icon ? decodeURIComponent(maximaRes.response.icon) : "";
                            MDS.log("👤 [PROFILE] Name from Maxima: " + name);
                        } else {
                            MDS.log("⚠️ [PROFILE] Failed to get Maxima info, using fallback");
                        }

                        MDS.cmd("keypair action:get key:p2p_bio", function (bioRes) {
                            var bio = (bioRes.status && bioRes.response && bioRes.response.value) ? bioRes.response.value : "";

                            // Step 6: Construct filtered response
                            var responsePayload = {
                                type: "profile_response",
                                // Level 1 - Always included
                                name: name,
                                bio: bio,
                                avatar: avatar,
                                allowNonContactChats: profile.allowNonContactChats
                            };

                            // Level 2 - Conditionally included
                            if (includeLevel2) {
                                responsePayload.location = profile.location;
                                responsePayload.country = profile.country;
                                responsePayload.website = profile.website;
                                responsePayload.social = profile.social;
                                responsePayload.languages = profile.languages;
                            } else {
                                responsePayload.privacy_l2 = "hidden";
                            }

                            // Level 3 - Conditionally included
                            if (includeLevel3) {
                                responsePayload.email = profile.email;
                                responsePayload.phone = profile.phone;
                                MDS.log("✅ [PROFILE] Level 3 added to response - Email: " + (responsePayload.email || "EMPTY") + ", Phone: " + (responsePayload.phone || "EMPTY"));
                            } else {
                                responsePayload.privacy_l3 = "hidden";
                                MDS.log("⚠️ [PROFILE] Level 3 NOT added to response");
                            }

                            MDS.log("📦 [PROFILE] Final response payload: " + JSON.stringify(responsePayload));
                            var jsonStr = JSON.stringify(responsePayload);
                            var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                            // Step 7: Prepare target address
                            var targetAddress = null;
                            if (maxjson.requesterAddress) {
                                var rawAddr = maxjson.requesterAddress + "";
                                var parts = rawAddr.split(":");
                                if (parts.length >= 2) {
                                    var part1 = parts[0].replace(/[^a-zA-Z0-9@.-]/g, "").trim();
                                    var part2 = parts[1].replace(/[^0-9]/g, "").trim();
                                    targetAddress = part1 + ":" + part2;
                                } else {
                                    targetAddress = rawAddr.replace(/[^a-zA-Z0-9@.:-]/g, "");
                                }
                            }

                            var sendCommand = "";
                            if (targetAddress && (targetAddress.startsWith("Mx") || targetAddress.startsWith("MX"))) {
                                MDS.log("📤 [PROFILE] Sending filtered response to address: " + targetAddress);
                                sendCommand = "maxima action:send to:" + targetAddress + " application:metachain data:" + hexData + " poll:false";
                            } else {
                                MDS.log("📤 [PROFILE] Sending filtered response to pubkey: " + pubkey.substring(0, 10) + "...");
                                sendCommand = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false";
                            }

                            // Step 8: Send Response
                            MDS.cmd(sendCommand, function (sendRes) {
                                MDS.log("✅ [PROFILE] Response Sent. Status: " + sendRes.status);
                            });
                        });
                    });
                });
            });
        });
    } catch (e) {
        MDS.log("❌ [PROFILE] CRITICAL ERROR in Handler: " + e.message);
    }
}

function handleProfileResponse(pubkey, maxjson) {
    MDS.log("📝 [PROFILE] Response received from: " + pubkey.substring(0, 20) + "...");

    // Update DISCOVERED_PEERS with extended profile data
    var now = Date.now();
    var safePubkey = escapeSql(pubkey);

    // Serialize the full profile as extra_data
    var extraData = escapeSql(JSON.stringify(maxjson));

    // CRITICAL: Extract allowNonContactChats from profile response
    var allowNonContactChats = 1; // Default to true
    if (maxjson.allowNonContactChats !== undefined && maxjson.allowNonContactChats !== null) {
        allowNonContactChats = maxjson.allowNonContactChats ? 1 : 0;
    }

    // Update bio, extra_data, AND allow_non_contact_chats
    var updateSql = "UPDATE DISCOVERED_PEERS SET bio='" + escapeSql(maxjson.bio || "") + "', extra_data='" + extraData + "', allow_non_contact_chats=" + allowNonContactChats + ", last_seen=" + now + " WHERE publickey='" + safePubkey + "'";

    MDS.sql(updateSql, function (res) {
        if (res.status) {
            MDS.log("✅ [PROFILE] Extended profile saved for " + pubkey.substring(0, 15) + "... (allowNonContactChats: " + allowNonContactChats + ")");
        }
    });
}
/**
 * MetaChain Service Worker - Beacon Handler
 * Handles peer discovery beacons and user registry
 */

function handleBeacon(beacon, source) {
    try {
        if (!beacon.pubkey || !beacon.address || !beacon.alias) {
            return;
        }

        // Debounce (except for important sources)
        var isImportant = (source === 'GOSSIP' || source === 'BOOTSTRAP');
        if (!isImportant && BEACON_CACHE[beacon.pubkey] && (Date.now() - BEACON_CACHE[beacon.pubkey] < 10000)) {
            return;
        }
        BEACON_CACHE[beacon.pubkey] = Date.now();

        var now = Date.now();
        var escapedAlias = escapeSql(beacon.alias);
        var bioValue = beacon.bio || "";
        var cleanAddress = (beacon.address || "").replace(/\s/g, "");

        var allowNonContactChats = (beacon.allowNonContactChats !== undefined && beacon.allowNonContactChats !== null)
            ? (beacon.allowNonContactChats ? 1 : 0)
            : 1;

        MDS.log("📡 [BEACON] " + beacon.alias + " from " + source);

        // Save beacon - handle bio caching
        if (bioValue) {
            saveBeaconWithBio(beacon, source, escapedAlias, bioValue, cleanAddress, allowNonContactChats, now);
        } else {
            // Check DB for cached bio
            MDS.sql("SELECT bio FROM DISCOVERED_PEERS WHERE publickey='" + beacon.pubkey + "'", function (checkRes) {
                var bioToSave = "";
                if (checkRes.status && checkRes.rows && checkRes.rows.length > 0 && checkRes.rows[0].BIO) {
                    bioToSave = checkRes.rows[0].BIO;
                }
                saveBeaconWithBio(beacon, source, escapedAlias, bioToSave, cleanAddress, allowNonContactChats, now);
            });
        }
    } catch (e) {
        MDS.log("❌ [BEACON] Handler error: " + e.message);
    }
}

function saveBeaconWithBio(beacon, source, escapedAlias, bio, cleanAddress, allowNonContactChats, now) {
    var escapedBio = escapeSql(bio);
    var extraData = escapeSql(JSON.stringify(beacon));

    var discoverySql = "MERGE INTO DISCOVERED_PEERS (publickey, alias, bio, address, last_seen, source, allow_non_contact_chats, extra_data) "
        + "KEY (publickey) "
        + "VALUES ('" + beacon.pubkey + "', '" + escapedAlias + "', '" + escapedBio + "', '"
        + cleanAddress + "', " + now + ", '" + source + "', " + allowNonContactChats + ", '" + extraData + "')";

    MDS.sql(discoverySql, function (res) {
        if (res.status) {
            MDS.log("✅ [BEACON] Saved: " + beacon.alias);
            promoteToUserRegistry(beacon, now);

            // Reactive gossip
            if (source === 'P2P' || source === 'MAXIMA') {
                sendWelcomePackage(beacon.pubkey, beacon.alias);
                askPeers([beacon.pubkey]);
            }
        } else {
            MDS.log("❌ [BEACON] Save failed: " + JSON.stringify(res));
        }
    });
}

function promoteToUserRegistry(beacon, now) {
    var user_id = beacon.pubkey;
    var escapedAlias = escapeSql(beacon.alias);

    MDS.sql("SELECT * FROM METACHAIN_USERS WHERE user_id='" + user_id + "'", function (res) {
        if (res.status && res.rows && res.rows.length > 0) {
            // Update existing
            var updateSql = "UPDATE METACHAIN_USERS SET alias='" + escapedAlias + "', address='" + (beacon.address || "") + "', last_updated=" + now + " WHERE user_id='" + user_id + "'";
            MDS.sql(updateSql);
        } else {
            // Insert new
            var insertSql = "INSERT INTO METACHAIN_USERS (user_id, publickey, alias, address, first_seen, last_updated) "
                + "VALUES ('" + user_id + "', '" + beacon.pubkey + "', '" + escapedAlias + "', '" + (beacon.address || "") + "', " + now + ", " + now + ")";
            MDS.sql(insertSql);
        }
    });
}

function sendBackgroundBeacon() {
    MDS.log("📡 [BG-BEACON] Preparing beacon...");

    MDS.cmd("maxima action:info", function (maxInfo) {
        if (!maxInfo.status) {
            MDS.log("❌ [BG-BEACON] Maxima info failed");
            return;
        }

        var myPubkey = maxInfo.response.publickey;
        var myAddress = maxInfo.response.contact;
        var myName = maxInfo.response.name || "Anonymous";
        var myAvatar = maxInfo.response.icon ? decodeURIComponent(maxInfo.response.icon) : "";

        MDS.keypair.get("p2p_bio", function (bioRes) {
            var bio = (bioRes.status && bioRes.value) ? bioRes.value : "";

            // Get additional profile data
            MDS.keypair.get("profile_country", function (countryRes) {
                var country = (countryRes.status && countryRes.value) ? countryRes.value : "";

                MDS.keypair.get("profile_languages", function (langRes) {
                    var languages = (langRes.status && langRes.value) ? langRes.value : "";

                    // Get all profile data including avatar (like the working example)
                    MDS.sql("SELECT * FROM MY_PROFILE WHERE id=1", function (permRes) {
                        var allowNonContactChats = true;
                        var avatar = "";
                        var dbCountry = "";
                        var dbLanguages = [];

                        if (permRes.status && permRes.rows && permRes.rows.length > 0) {
                            var row = permRes.rows[0];
                            var val = row.ALLOW_NON_CONTACT_CHATS || row.allow_non_contact_chats;
                            allowNonContactChats = (val === 1 || val === true || val === 'true' || val === '1');
                            // Get avatar from DB (same as working example line 1714)
                            avatar = row.AVATAR || row.avatar || "";
                            // Get country from DB (with decoding like example line 1711)
                            dbCountry = decodeURIComponent(row.COUNTRY || row.country || "");
                            // Get languages from DB and parse as JSON array (like example line 1712-1713)
                            try {
                                dbLanguages = JSON.parse(decodeURIComponent(row.LANGUAGES || row.languages || "[]"));
                            } catch (e) {
                                dbLanguages = [];
                            }
                        }

                        // Use DB values as primary, keypair as fallback
                        var finalCountry = dbCountry || country;
                        var finalLanguages = dbLanguages.length > 0 ? dbLanguages : [];
                        // Try to parse keypair languages if DB is empty
                        if (finalLanguages.length === 0 && languages) {
                            try {
                                finalLanguages = JSON.parse(languages);
                            } catch (e) {
                                finalLanguages = [];
                            }
                        }

                        var beacon = {
                            app: "metachain",
                            type: "BEACON",
                            v: 1,
                            pubkey: myPubkey,
                            alias: myName,
                            bio: bio,
                            address: myAddress,
                            allowNonContactChats: allowNonContactChats,
                            country: finalCountry,
                            languages: finalLanguages,
                            // Use maxima icon as primary, MY_PROFILE as fallback
                            avatar: myAvatar || avatar,
                            timestamp: Date.now()
                        };

                        var jsonStr = JSON.stringify(beacon);
                        var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                        // P2P broadcast
                        MDS.cmd("message data:" + hexData, function (res) {
                            MDS.log("📡 [BG-BEACON] P2P broadcast sent");
                        });

                        // Save self to DB
                        handleBeacon(beacon, 'SELF');
                    });
                });
            });
        });
    });
}

function startCleanupTimer() {
    var now = Date.now();
    var TTL = 3600000; // 1 hour

    var cleanupSql = "DELETE FROM DISCOVERED_PEERS WHERE last_seen < " + (now - TTL) + " AND source != 'SELF'";
    MDS.sql(cleanupSql, function (res) {
        if (res.status && res.count > 0) {
            MDS.log("🧹 [CLEANUP] Removed " + res.count + " stale peers");
        }
    });
}

function createDiscoveredPeersTable() {
    MDS.log("💾 [DB] DISCOVERED_PEERS table check (already created in init).");
}
/**
 * MetaChain Service Worker - Gossip Handler
 * Handles peer exchange (gossip) protocol
 */

function handleGetPeers(pubkey, maxjson) {
    MDS.log("🗣️ [GOSSIP] Peer request from " + (maxjson.alias || pubkey.substring(0, 10)));

    // Fetch known peers
    var peerSql = "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 50";
    MDS.sql(peerSql, function (res) {
        if (res.status && res.rows && res.rows.length > 0) {
            var peers = [];
            for (var i = 0; i < res.rows.length; i++) {
                var row = res.rows[i];

                // Parse extra_data
                var avatar = "";
                var country = "";
                var languages = [];
                var bio = row.BIO || "";

                if (row.EXTRA_DATA) {
                    try {
                        var extraObj = JSON.parse(row.EXTRA_DATA);
                        avatar = extraObj.avatar || "";
                        country = extraObj.country || "";
                        languages = extraObj.languages || [];
                        if (!bio && extraObj.bio) bio = extraObj.bio;
                    } catch (e) { }
                }

                peers.push({
                    pubkey: row.PUBLICKEY,
                    alias: row.ALIAS,
                    bio: bio,
                    address: row.ADDRESS,
                    allowNonContactChats: (row.ALLOW_NON_CONTACT_CHATS === 1 || row.ALLOW_NON_CONTACT_CHATS === true),
                    avatar: avatar,
                    country: country,
                    languages: languages
                });
            }

            // Send response
            var replyPayload = {
                app: "metachain",
                type: "peers_response",
                peers: peers
            };
            var replyHex = "0x" + utf8ToHex(JSON.stringify(replyPayload)).toUpperCase();

            MDS.cmd("maxima action:send publickey:" + pubkey + " application:metachain data:" + replyHex + " poll:false", function () {
                MDS.log("✅ [GOSSIP] Sent " + peers.length + " peers");
            });
        }
    });
}

function handlePeersResponse(pubkey, maxjson) {
    MDS.log("📥 [GOSSIP] Received " + (maxjson.peers ? maxjson.peers.length : 0) + " peers");

    if (maxjson.peers && Array.isArray(maxjson.peers)) {
        for (var i = 0; i < maxjson.peers.length; i++) {
            var peer = maxjson.peers[i];
            if (peer.pubkey && peer.address && peer.alias) {
                handleBeacon(peer, 'GOSSIP');
            }
        }
    }
}

function startGossip() {
    MDS.log("🗣️ [GOSSIP] Starting discovery...");

    // Try discovered peers first
    MDS.sql("SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 5", function (res) {
        if (res.status && res.rows && res.rows.length > 0) {
            MDS.log("🗣️ [GOSSIP] Asking " + res.rows.length + " discovered peers...");
            var pubkeys = [];
            for (var i = 0; i < res.rows.length; i++) {
                pubkeys.push(res.rows[i].PUBLICKEY);
            }
            askPeers(pubkeys);
        } else {
            // Fallback to contacts
            MDS.cmd("maxcontacts", function (contactRes) {
                if (contactRes.status && contactRes.response.contacts && contactRes.response.contacts.length > 0) {
                    var targets = [];
                    for (var i = 0; i < Math.min(5, contactRes.response.contacts.length); i++) {
                        targets.push(contactRes.response.contacts[i].publickey);
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
    MDS.cmd("maxima action:info", function (maxInfo) {
        var myAlias = (maxInfo.status) ? maxInfo.response.name : "Anonymous";

        var requestPayload = {
            app: "metachain",
            type: "get_peers",
            alias: myAlias
        };

        var hexData = "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

        for (var i = 0; i < pubkeys.length; i++) {
            var pk = pubkeys[i];
            if (MY_MAXIMA_PK && pk === MY_MAXIMA_PK) continue;

            MDS.cmd("maxima action:send publickey:" + pk + " application:metachain data:" + hexData + " poll:false");
        }
    });
}

function sendWelcomePackage(targetPubkey, targetAlias) {
    if (MY_MAXIMA_PK && targetPubkey === MY_MAXIMA_PK) return;

    MDS.log("🎁 [GOSSIP] Sending Welcome Package to " + targetAlias);

    var peerSql = "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 50";
    MDS.sql(peerSql, function (res) {
        if (res.status && res.rows && res.rows.length > 0) {
            var peers = [];
            for (var i = 0; i < res.rows.length; i++) {
                var row = res.rows[i];

                var avatar = "";
                var country = "";
                var languages = [];
                var bio = row.BIO || "";

                if (row.EXTRA_DATA) {
                    try {
                        var extraObj = JSON.parse(row.EXTRA_DATA);
                        avatar = extraObj.avatar || "";
                        country = extraObj.country || "";
                        languages = extraObj.languages || [];
                        if (!bio && extraObj.bio) bio = extraObj.bio;
                    } catch (e) { }
                }

                peers.push({
                    pubkey: row.PUBLICKEY,
                    alias: row.ALIAS,
                    bio: bio,
                    address: row.ADDRESS,
                    allowNonContactChats: (row.ALLOW_NON_CONTACT_CHATS === 1 || row.ALLOW_NON_CONTACT_CHATS === true),
                    avatar: avatar,
                    country: country,
                    languages: languages
                });
            }

            var responsePayload = {
                app: "metachain",
                type: "peers_response",
                peers: peers
            };

            var hexData = "0x" + utf8ToHex(JSON.stringify(responsePayload)).toUpperCase();

            MDS.cmd("maxima action:send publickey:" + targetPubkey + " application:metachain data:" + hexData + " poll:false", function () {
                MDS.log("✅ [GOSSIP] Welcome Package sent to " + targetAlias);
            });
        }
    });
}
/**
 * MetaChain Service Worker - Main Dispatcher
 * Minimal entry point that routes events to handlers
 * 
 * NOTE: This file is concatenated with handlers during build.
 * Build command: npm run build:service-worker
 */

// ============================================================================
// MAIN EVENT DISPATCHER
// ============================================================================

MDS.init(function (msg) {
    // Initialization
    if (msg.event == "inited") {
        MDS.log("🚀 [SW-VERSION-CHECK] Service Worker v2.1 FIX DEPLOYED - " + new Date().toISOString());
        initDatabase();
    }

    // Periodic tasks via NEWBLOCK
    else if (msg.event == "NEWBLOCK") {
        var now = Date.now();

        // Gossip interval
        if (now - LAST_GOSSIP > GOSSIP_INTERVAL) {
            LAST_GOSSIP = now;
            startGossip();
            startCleanupTimer();
            sendBackgroundBeacon();
        }
    }

    // MAXIMA messages
    else if (msg.event == "MAXIMA") {
        MDS.log("📨 [MAXIMA] Event received. App: " + msg.data.application);

        if (msg.data.application && (msg.data.application.toLowerCase() == "metachain" || msg.data.application.toLowerCase() == "metachain-group")) {
            var app = msg.data.application.toLowerCase();
            var pubkey = msg.data.from;
            var datastr = msg.data.data.substring(2);
            var jsonstr = hexToUtf8(datastr);

            try {
                var maxjson = JSON.parse(jsonstr);
                MDS.log("🔍 [MAXIMA] Type: " + (maxjson.type || maxjson.messageType));

                // ================== GROUP MESSAGES ==================
                if (app === "metachain-group" && (maxjson.messageType === "history_request" || maxjson.messageType === "history_response")) {
                    MDS.log("ℹ️ [GROUP-SYNC] Ignoring: " + maxjson.messageType);
                    return;
                }

                if ((app === "metachain-group" && maxjson.messageType === "group_message") || (maxjson.groupId && maxjson.messageType === "group_message")) {
                    handleGroupMessage(pubkey, maxjson);
                    return;
                }

                if (app === "metachain-group" && maxjson.messageType === "group_invite") {
                    handleGroupInvite(pubkey, maxjson);
                    return;
                }

                if (app === "metachain-group" && (maxjson.messageType === "group_member_added" || maxjson.messageType === "group_member_removed")) {
                    handleGroupMemberUpdate(pubkey, maxjson);
                    return;
                }

                // ================== CHAT MESSAGES ==================
                if (maxjson.type === "read") {
                    handleReadReceipt(pubkey);
                    return;
                }

                if (maxjson.type === "delivery_receipt") {
                    handleDeliveryReceipt(pubkey);
                    return;
                }

                if (maxjson.type === "ping") {
                    handlePing(pubkey);
                    return;
                }

                if (maxjson.type === "pong") {
                    handlePong(pubkey);
                    return;
                }

                // ================== BEACONS & DISCOVERY ==================
                if (maxjson.type === "register" || maxjson.type === "BEACON") {
                    MDS.log("📡 [P2P] Beacon: " + maxjson.alias);
                    handleBeacon(maxjson, 'MAXIMA');
                    return;
                }

                // ================== GOSSIP ==================
                if (maxjson.type === "get_peers") {
                    handleGetPeers(pubkey, maxjson);
                    return;
                }

                if (maxjson.type === "peers_response") {
                    handlePeersResponse(pubkey, maxjson);
                    return;
                }

                // ================== PROFILE ==================
                if (maxjson.type === "profile_request") {
                    handleProfileRequest(pubkey, maxjson);
                    return;
                }

                if (maxjson.type === "profile_response") {
                    handleProfileResponse(pubkey, maxjson);
                    return;
                }

                // ================== CONTACT REQUESTS ==================
                if (maxjson.type === "contact_request") {
                    handleContactRequest(pubkey, maxjson);
                    return;
                }

                if (maxjson.type === "contact_declined") {
                    handleContactDeclined(pubkey);
                    return;
                }

                if (maxjson.type === "contact_cancelled") {
                    handleContactCancelled(pubkey);
                    return;
                }

                if (maxjson.type === "contact_accepted") {
                    handleContactAccepted(pubkey, maxjson);
                    return;
                }

                // ================== MAXIMA CONTACT REQUESTS ==================
                if (maxjson.type === "maxima_contact_request") {
                    handleMaximaContactRequest(pubkey, maxjson);
                    return;
                }

                if (maxjson.type === "maxima_contact_accepted") {
                    handleMaximaContactAccepted(pubkey, maxjson);
                    return;
                }

                if (maxjson.type === "maxima_contact_declined") {
                    handleMaximaContactDeclined(pubkey);
                    return;
                }

                if (maxjson.type === "maxima_contact_cancelled") {
                    handleMaximaContactCancelled(pubkey);
                    return;
                }

                if (maxjson.type === "maxima_contact_removed") {
                    handleMaximaContactRemoved(pubkey, maxjson);
                    return;
                }

                if (maxjson.type === "contact_blocked") {
                    handleContactBlocked(pubkey);
                    return;
                }

                if (maxjson.type === "contact_unblocked") {
                    handleContactUnblocked(pubkey);
                    return;
                }

                // ================== CHAT MESSAGES (Default) ==================
                // FILTER: Only process actual chat message types
                var validChatTypes = ["text", "image", "video", "audio", "file", "charm", "token", "gif", "sticker", "voice"];
                if (validChatTypes.indexOf(maxjson.type) !== -1 && maxjson.message !== undefined) {
                    handleChatMessage(pubkey, maxjson);
                    return;
                }

                MDS.log("⚠️ [MAXIMA] Unhandled type: " + (maxjson.type || maxjson.messageType || "unknown"));

            } catch (e) {
                MDS.log("❌ [MAXIMA] Parse error: " + e.message);
            }
        }
    }

    // MINIMALOG for P2P beacons
    else if (msg.event == "MINIMALOG") {
        if (msg.data && msg.data.message) {
            var logMsg = msg.data.message;

            // Ignore our own debug logs (prevent infinite loop)
            if (logMsg.indexOf("[BEACON]") !== -1 ||
                logMsg.indexOf("[P2P]") !== -1 ||
                logMsg.indexOf("[SW]") !== -1 ||
                logMsg.indexOf("[MAXIMA]") !== -1 ||
                logMsg.indexOf("[GOSSIP]") !== -1 ||
                logMsg.indexOf("[DB]") !== -1) {
                return;
            }

            // P2P beacon detection - use flexible pattern like example
            var hexIndex = logMsg.toLowerCase().indexOf("0x7b");
            if (hexIndex !== -1) {
                try {
                    var rawHex = logMsg.substring(hexIndex);
                    var hexMatch = rawHex.match(/^(0x[0-9A-Fa-f]+)/);
                    if (!hexMatch) return;

                    var hexData = hexMatch[1].substring(2);
                    var jsonStr = hexToUtf8Simple(hexData);
                    jsonStr = jsonStr.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
                    var beacon = JSON.parse(jsonStr);

                    if (beacon.app === "metachain" && (beacon.type === "BEACON" || beacon.type === "register")) {
                        if (MY_MAXIMA_PK && beacon.pubkey === MY_MAXIMA_PK) {
                            return; // Ignore self
                        }
                        MDS.log("📡 [P2P] Beacon: " + beacon.alias);
                        handleBeacon(beacon, 'P2P');
                    }
                } catch (e) {
                    // Silent fail
                }
            }
        }
    }
});
