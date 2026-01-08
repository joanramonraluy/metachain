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

                // ================== CHAT MESSAGES (Default) ==================
                if (maxjson.message !== undefined) {
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
