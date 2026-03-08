/**
 * MetaChain Service Worker - Main Dispatcher
 * Minimal entry point that routes events to handlers
 *
 * NOTE: This file is concatenated with handlers during build.
 * Build command: npm run build:service-worker
 */

// ============================================================================

// ============================================================================
// MAIN EVENT DISPATCHER
// ============================================================================

// Flag to ensure startup cleanup runs once after DB is ready (triggered by first NEWBLOCK)
var DB_INIT_DONE = false;
var DB_READY = false;
var INITIAL_CLEANUP_DONE = false;
var GROUP_STARTUP_SYNC_DONE = false;

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
    MDS.log("🚀 [SW] Inited event received. Version v3.0");
    MDS.log("⏰ [SW] Starting Database Initialization...");
    initDatabase();
  }

  // Periodic tasks via NEWBLOCK
  else if (msg.event == "NEWBLOCK") {
    // 1. WAIT FOR DB TO BE READY (Async Init)
    if (!DB_READY) {
      return;
    }

    // Run one-time startup cleanup if not done yet
    if (!INITIAL_CLEANUP_DONE) {
      INITIAL_CLEANUP_DONE = true;
      cleanupOrphanedChatMessages();
      // Delay group sync slightly to let DB settle
      MDS.cmd("timer 3000", function () {
        if (typeof requestAllGroupsHistory === "function") {
          requestAllGroupsHistory();
          requestAllChannelsHistory();
          GROUP_STARTUP_SYNC_DONE = true;
        }
      });
    }

    // Run coin discovery at block 5 (gives time for coins to sync)
    if (COIN_DISCOVERY_PENDING) {
      NEWBLOCK_COUNT++;
      if (NEWBLOCK_COUNT >= 5) {
        COIN_DISCOVERY_PENDING = false;
        MDS.log(
          "📦 [COIN-DISCOVERY] Running at block " + NEWBLOCK_COUNT + "...",
        );
        if (typeof discoverOfflineTokens === "function") {
          discoverOfflineTokens()
            .then(function (count) {
              if (count > 0) {
                MDS.log(
                  "📦 [COIN-DISCOVERY] Recovered " +
                  count +
                  " offline token(s)",
                );
              }
            })
            .catch(function (err) {
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
      sendGroupAddressBeacon(); // Keep group member addresses fresh in DISCOVERED_PEERS
      checkPendingTransactions(); // Check for zombie transactions
      checkSentTransactions(); // Check for confirmations (sent -> confirmed)
    }
  }

  // Service commands from frontend
  else if (msg.event == "MDS_SERVICECMD") {
    if (msg.data && msg.data.service === "COINDISC") {
      MDS.log("📦 [SERVICE] Coin discovery requested from frontend");
      if (typeof discoverOfflineTokens === "function") {
        discoverOfflineTokens()
          .then(function (count) {
            if (count > 0) {
              MDS.log("📦 [SERVICE] Recovered " + count + " offline token(s)");
            } else {
              MDS.log("📦 [SERVICE] No new offline tokens found");
            }
          })
          .catch(function (err) {
            MDS.log("⚠️ [SERVICE] Coin discovery error: " + err);
          });
      }
    }
  }

  // MAXIMA messages
  else if (msg.event == "MAXIMA") {
    // Track connection state for reconnection detection
    var now = Date.now();
    var wasOffline = now - LAST_MAXIMA_EVENT_TIME > CONNECTION_TIMEOUT_MS;

    if (wasOffline && LAST_MAXIMA_EVENT_TIME > 0) {
      MDS.log(
        "🔄 [RECONNECT] Node back online after offline period. Triggering history sync...",
      );
      WAS_OFFLINE = true;

      // Notify frontend to retry queued messages immediately
      MDS.comms.solo(
        JSON.stringify({
          type: "RECONNECTED",
          timestamp: now,
        }),
      );

      // Trigger history sync from recent contacts
      if (typeof requestHistoryFromRecentContacts === "function") {
        requestHistoryFromRecentContacts();
      }
      // Also sync all group histories
      if (typeof requestAllGroupsHistory === "function") {
        requestAllGroupsHistory();
      }
      if (typeof requestAllChannelsHistory === "function") {
        requestAllChannelsHistory();
      }
    }

    LAST_MAXIMA_EVENT_TIME = now;
    MDS.log("📨 [MAXIMA] Event received. App: " + msg.data.application);

    if (
      msg.data.application &&
      (msg.data.application.toLowerCase() == "metachain" ||
        msg.data.application.toLowerCase() == "metachain-group" ||
        msg.data.application.toLowerCase() == "metachain-channel")
    ) {
      var app = msg.data.application.toLowerCase();
      var pubkey = msg.data.from;
      var jsonstr = "";
      if (msg.data.data.startsWith("0x")) {
        datastr = msg.data.data.substring(2);
        jsonstr = hexToUtf8(datastr);
      } else {
        jsonstr = msg.data.data;
      }

      try {
        var maxjson = JSON.parse(jsonstr);
        MDS.log(
          "🔍 [MAXIMA-DEBUG-ALL] App: " +
          app +
          " Type: " +
          (maxjson.type || maxjson.messageType) +
          " From: " +
          pubkey.substring(0, 10),
        );
        MDS.log("🔍 [MAXIMA] Type: " + (maxjson.type || maxjson.messageType));

        // ================== GROUP MESSAGES ==================
        if (
          app === "metachain-group" &&
          maxjson.messageType === "history_request"
        ) {
          handleGroupHistoryRequest(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          maxjson.messageType === "history_response"
        ) {
          handleGroupHistoryResponse(pubkey, maxjson);
          return;
        }

        if (
          (app === "metachain-group" &&
            maxjson.messageType === "group_message") ||
          (maxjson.groupId && maxjson.messageType === "group_message")
        ) {
          handleGroupMessage(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          maxjson.messageType === "group_invite"
        ) {
          handleGroupInvite(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          (maxjson.messageType === "group_member_added" ||
            maxjson.messageType === "group_member_removed")
        ) {
          handleGroupMemberUpdate(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          maxjson.messageType === "group_member_unbanned"
        ) {
          handleGroupMemberUnbanned(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          (maxjson.messageType === "group_rename" || maxjson.messageType === "group_update_details")
        ) {
          handleGroupUpdateDetails(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          maxjson.messageType === "group_role_update"
        ) {
          handleGroupRoleUpdate(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          (maxjson.messageType === "group_join_request" ||
            maxjson.messageType === "group_join_request_propagated" ||
            maxjson.messageType === "group_join_request_resolved")
        ) {
          handleGroupJoinRequestEvent(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          maxjson.messageType === "group_address_beacon"
        ) {
          handleGroupAddressBeacon(pubkey, maxjson);
          return;
        }

        // ================== CHANNEL MESSAGES ==================
        if (app === "metachain-channel" && maxjson.messageType === "channel_invite") {
          handleChannelInvite(pubkey, maxjson);
          return;
        }

        if (app === "metachain-channel" && maxjson.messageType === "channel_message") {
          handleChannelMessage(pubkey, maxjson);
          return;
        }

        if (app === "metachain-channel" && maxjson.messageType === "channel_subscriber_added") {
          handleChannelSubscriberAdded(pubkey, maxjson);
          return;
        }

        if (app === "metachain-channel" && maxjson.messageType === "channel_subscriber_removed") {
          handleChannelSubscriberRemoved(pubkey, maxjson);
          return;
        }

        if (app === "metachain-channel" && maxjson.messageType === "channel_role_update") {
          handleChannelRoleUpdate(pubkey, maxjson);
          return;
        }

        if (app === "metachain-channel" && maxjson.messageType === "channel_join_request") {
          handleChannelJoinRequest(pubkey, maxjson);
          return;
        }

        if (app === "metachain-channel" && maxjson.messageType === "channel_info_updated") {
          handleChannelInfoUpdate(pubkey, maxjson);
          return;
        }

        if (app === "metachain-channel" && maxjson.messageType === "channel_history_request") {
          handleChannelHistoryRequest(pubkey, maxjson);
          return;
        }

        if (app === "metachain-channel" && maxjson.messageType === "channel_history_response") {
          handleChannelHistoryResponse(pubkey, maxjson);
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
          handleBeacon(maxjson, "MAXIMA");
          return;
        }

        // ================== GOSSIP ==================
        if (maxjson.type === "get_peers") {
          MDS.log(
            "📨 [MAXIMA-GOSSIP] get_peers request from " +
            pubkey.substring(0, 10),
          );
          handleGetPeers(pubkey, maxjson);
          return;
        }

        if (maxjson.type === "peers_response") {
          MDS.log(
            "📨 [MAXIMA-GOSSIP] peers_response from " + pubkey.substring(0, 10),
          );
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
          handleSyncStatusCheck(maxjson, pubkey);
          return;
        }

        if (maxjson.type === "sync_status_report") {
          handleSyncStatusReport(maxjson, pubkey);
          return;
        }

        // ================== CHAT MESSAGES (Default) ==================
        // FILTER: Only process actual chat message types
        var validChatTypes = [
          "text",
          "image",
          "video",
          "audio",
          "file",
          "charm",
          "token",
          "gif",
          "sticker",
          "voice",
        ];
        if (
          validChatTypes.indexOf(maxjson.type) !== -1 &&
          maxjson.message !== undefined
        ) {
          handleChatMessage(pubkey, maxjson);
          return;
        }

        MDS.log(
          "⚠️ [MAXIMA] Unhandled type: " +
          (maxjson.type || maxjson.messageType || "unknown"),
        );
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
      if (
        logMsg.indexOf("[BEACON]") !== -1 ||
        logMsg.indexOf("[P2P]") !== -1 ||
        logMsg.indexOf("[SW]") !== -1 ||
        logMsg.indexOf("[MAXIMA]") !== -1 ||
        logMsg.indexOf("[GOSSIP]") !== -1 ||
        logMsg.indexOf("[DB]") !== -1
      ) {
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

          if (
            beacon.app === "metachain" &&
            (beacon.type === "BEACON" || beacon.type === "register")
          ) {
            if (MY_MAXIMA_PK && beacon.pubkey === MY_MAXIMA_PK) {
              return; // Ignore self
            }
            MDS.log("📡 [P2P] Beacon: " + beacon.alias);
            handleBeacon(beacon, "P2P");
          } else if (
            beacon.app === "metachain" &&
            beacon.type === "peers_response"
          ) {
            MDS.log("📨 [P2P-GOSSIP] peers_response broadcast received");
            handlePeersResponse(null, beacon);
          }
        } catch (e) {
          // Silent fail
        }
      }
    }
  }
});
