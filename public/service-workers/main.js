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

// Flag to ensure startup cleanup runs once after DB is ready (triggered by first NEWBLOCK)
var INITIAL_CLEANUP_DONE = false;

// Flag to trigger coin discovery on first NEWBLOCK (when node is synced)
var COIN_DISCOVERY_PENDING = false;
var NEWBLOCK_COUNT = 0;

// Connection state tracking for reconnection sync
var LAST_MAXIMA_EVENT_TIME = 0;
var CONNECTION_TIMEOUT_MS = 120000; // 2 minutes - if no MAXIMA events, consider offline
var WAS_OFFLINE = false;

MDS.init(function (msg) {
    // Initialization
    if (msg.event == "inited") {
        MDS.log("🚀 [SW-VERSION-CHECK] Service Worker v2.7 DEBUG - " + new Date().toISOString());
        initDatabase();
        // Cleanup will happen on first NEWBLOCK to avoid setTimeout (not supported)
    }

    // Periodic tasks via NEWBLOCK
    else if (msg.event == "NEWBLOCK") {
        // Run one-time startup cleanup if not done yet
        if (!INITIAL_CLEANUP_DONE) {
            INITIAL_CLEANUP_DONE = true;
            cleanupOrphanedChatMessages();
        }

        // Run coin discovery at block 5 (gives time for coins to sync)
        if (COIN_DISCOVERY_PENDING) {
            NEWBLOCK_COUNT++;
            if (NEWBLOCK_COUNT >= 5) {
                COIN_DISCOVERY_PENDING = false;
                MDS.log("📦 [COIN-DISCOVERY] Running at block " + NEWBLOCK_COUNT + "...");
                if (typeof discoverOfflineTokens === 'function') {
                    discoverOfflineTokens().then(function (count) {
                        if (count > 0) {
                            MDS.log("📦 [COIN-DISCOVERY] Recovered " + count + " offline token(s)");
                        }
                    }).catch(function (err) {
                        MDS.log("⚠️ [COIN-DISCOVERY] Error: " + err);
                    });
                }
            }
        }

        var now = Date.now();

        // Gossip interval
        if (now - LAST_GOSSIP > GOSSIP_INTERVAL) {
            LAST_GOSSIP = now;
            startGossip();
            startCleanupTimer();
            sendBackgroundBeacon();
            checkPendingTransactions(); // Check for zombie transactions
            checkSentTransactions();    // Check for confirmations (sent -> confirmed)
        }
    }

    // Service commands from frontend
    else if (msg.event == "MDS_SERVICECMD") {
        if (msg.data && msg.data.service === "COINDISC") {
            MDS.log("📦 [SERVICE] Coin discovery requested from frontend");
            if (typeof discoverOfflineTokens === 'function') {
                discoverOfflineTokens().then(function (count) {
                    if (count > 0) {
                        MDS.log("📦 [SERVICE] Recovered " + count + " offline token(s)");
                    } else {
                        MDS.log("📦 [SERVICE] No new offline tokens found");
                    }
                }).catch(function (err) {
                    MDS.log("⚠️ [SERVICE] Coin discovery error: " + err);
                });
            }
        }
    }

    // MAXIMA messages
    else if (msg.event == "MAXIMA") {
        // Track connection state for reconnection detection
        var now = Date.now();
        var wasOffline = (now - LAST_MAXIMA_EVENT_TIME) > CONNECTION_TIMEOUT_MS;

        if (wasOffline && LAST_MAXIMA_EVENT_TIME > 0) {
            MDS.log("🔄 [RECONNECT] Node back online after offline period. Triggering history sync...");
            WAS_OFFLINE = true;
            // Trigger history sync from recent contacts
            if (typeof requestHistoryFromRecentContacts === 'function') {
                requestHistoryFromRecentContacts();
            }
        }

        LAST_MAXIMA_EVENT_TIME = now;
        MDS.log("📨 [MAXIMA] Event received. App: " + msg.data.application);

        if (msg.data.application && (msg.data.application.toLowerCase() == "metachain" || msg.data.application.toLowerCase() == "metachain-group")) {
            var app = msg.data.application.toLowerCase();
            var pubkey = msg.data.from;
            var datastr = msg.data.data.substring(2);
            var jsonstr = hexToUtf8(datastr);

            try {
                var maxjson = JSON.parse(jsonstr);
                MDS.log("🔍 [MAXIMA-DEBUG-ALL] App: " + app + " Type: " + (maxjson.type || maxjson.messageType) + " From: " + pubkey.substring(0, 10));
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

                if (maxjson.type === "chat_history_request") {
                    handleChatHistoryRequest(pubkey, maxjson);
                    return;
                }

                if (maxjson.type === "chat_history_response") {
                    handleChatHistoryResponse(pubkey, maxjson);
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

                // ================== SMART SYNCHRONIZATION ==================
                if (maxjson.type === "sync_status_check") {
                    handleSyncStatusCheck(pubkey, maxjson);
                    return;
                }

                if (maxjson.type === "sync_status_report") {
                    handleSyncStatusReport(pubkey, maxjson);
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
