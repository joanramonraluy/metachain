/**
 * MetaChain Service Worker - Gossip Handler
 * Handles peer exchange (gossip) protocol
 */

var GOSSIP_COOLDOWN = {}; // Per-peer cooldown map (pubkey -> timestamp)
var STRICT_SERIAL_PROTOCOL = true; // [TOGGLE] Set to false to re-enable Concurrent Dual-send

function handleGetPeers(pubkey, maxjson) {
  pubkey = (pubkey || "").toLowerCase();
  MDS.log(
    "🗣️ [GOSSIP] Peer request from " +
      (maxjson.alias || pubkey.substring(0, 10)),
  );

  // Fetch known peers
  var peerSql =
    "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 50";
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
          } catch (e) {}
        }

        peers.push({
          pubkey: row.PUBLICKEY,
          alias: row.ALIAS,
          bio: bio,
          address: row.ADDRESS,
          allowNonContactChats: (function(r) {
            var val = r.ALLOW_NON_CONTACT_CHATS || r.allow_non_contact_chats;
            return val === 1 || val === true || val === "true" || val === "1";
          })(row),
          avatar: avatar,
          country: country,
          languages: languages,
        });
      }

      var replyPayload = {
        app: "metachain",
        type: "peers_response",
        peers: peers,
      };

      var replyHex = "0x" + utf8ToHex(JSON.stringify(replyPayload)).toUpperCase();

      // Use resolveAndSend in exclusive mode to avoid double-sending large peer lists
      // but ensuring the best path (Address or PK) is used.
      if (STRICT_SERIAL_PROTOCOL) {
        MDS.cmd("maxima action:send publickey:" + pubkey + " application:metachain data:" + replyHex + " poll:false");
      } else {
        resolveAndSend(pubkey, replyHex, "GOSSIP-RESP", false, true);
      }
    }
  });
}

function handlePeersResponse(pubkey, maxjson) {
  pubkey = (pubkey || "").toLowerCase();
  var peerCount = maxjson.peers ? maxjson.peers.length : 0;
  var senderAlias = pubkey ? pubkey.substring(0, 10) : "P2P-broadcast";

  MDS.log("📥 [GOSSIP] Received " + peerCount + " peers from " + senderAlias);

  if (maxjson.peers && Array.isArray(maxjson.peers)) {
    var processedCount = 0;
    var skippedCount = 0;

    for (var i = 0; i < maxjson.peers.length; i++) {
      var peer = maxjson.peers[i];

      // Debug each peer
      MDS.log(
        "🔍 [GOSSIP-PEER] " +
          (i + 1) +
          "/" +
          peerCount +
          ": " +
          (peer.alias || "no-alias") +
          " (" +
          (peer.pubkey ? peer.pubkey.substring(0, 10) : "no-pubkey") +
          "...)",
      );

      if (peer.pubkey && peer.address && peer.alias) {
        MDS.log("✅ [GOSSIP-PEER] Processing beacon for: " + peer.alias);
        handleBeacon(peer, "GOSSIP");
        processedCount++;
      } else {
        MDS.log(
          "⚠️ [GOSSIP-PEER] Skipping incomplete peer - pubkey:" +
            !!peer.pubkey +
            " address:" +
            !!peer.address +
            " alias:" +
            !!peer.alias,
        );
        skippedCount++;
      }
    }

    MDS.log(
      "📊 [GOSSIP] Summary: " +
        processedCount +
        " processed, " +
        skippedCount +
        " skipped",
    );
  } else {
    MDS.log("⚠️ [GOSSIP] No valid peers array in response");
  }
}

function startGossip() {
  MDS.log("🗣️ [GOSSIP] Starting discovery...");

  // Try discovered peers first
  MDS.sql(
    "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT " + GOSSIP_LIMIT,
    function (res) {
      if (res.status && res.rows && res.rows.length > 0) {
        MDS.log(
          "🗣️ [GOSSIP] Asking " + res.rows.length + " discovered peers...",
        );
        var pubkeys = [];
        for (var i = 0; i < res.rows.length; i++) {
          pubkeys.push(res.rows[i].PUBLICKEY);
        }
        var validPubkeys = pubkeys.filter(function (pk) {
          return pk !== MY_MAXIMA_PK;
        });

        if (validPubkeys.length > 0) {
          askPeers(validPubkeys);
        } else {
          MDS.log("⚠️ [GOSSIP] Only self found in discovery — triggering MLS bootstrap fallback.");
          if (typeof bootstrapFromMLS === "function") {
            bootstrapFromMLS();
          }
        }
      } else {
        // Fallback to contacts
        MDS.cmd("maxcontacts", function (contactRes) {
          if (
            contactRes.status &&
            contactRes.response.contacts &&
            contactRes.response.contacts.length > 0
          ) {
            var targets = [];
            for (
              var i = 0;
              i < Math.min(GOSSIP_LIMIT, contactRes.response.contacts.length);
              i++
            ) {
              targets.push(contactRes.response.contacts[i].publickey);
            }
            MDS.log("🗣️ [GOSSIP] Asking " + targets.length + " contacts...");
            askPeers(targets);
          } else {
            MDS.log(
              "⚠️ [GOSSIP] No peers or contacts — triggering MLS bootstrap fallback.",
            );
            if (typeof bootstrapFromMLS === "function") {
              bootstrapFromMLS();
            }
          }
        });
      }
    },
  );
}

function askPeers(pubkeys) {
  MDS.cmd("maxima action:info", function (maxInfo) {
    var myAlias = maxInfo.status ? maxInfo.response.name : "Anonymous";
    var myAddress = maxInfo.status
      ? maxInfo.response.mls || maxInfo.response.contact || ""
      : "";

    var requestPayload = {
      app: "metachain",
      type: "get_peers",
      alias: myAlias,
      address: myAddress,
    };

    var hexData =
      "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

    for (var i = 0; i < pubkeys.length; i++) {
      var pk = pubkeys[i];
      if (MY_MAXIMA_PK && pk === MY_MAXIMA_PK) continue;

      // THROTTLING: Skip if we've asked this peer recently
      var now = Date.now();
      var lastAsked = GOSSIP_COOLDOWN[pk] || 0;
      var interval = GOSSIP_INTERVAL || 60000;
      var cooldownMs = interval * 2; // Default cooldown is 2x the gossip interval

      if (now - lastAsked < cooldownMs) {
        // MDS.log("⏳ [GOSSIP] Skipping " + pk.substring(0, 10) + " (cooldown active)");
        continue;
      }

      GOSSIP_COOLDOWN[pk] = now;
      MDS.log("🗣️ [GOSSIP-ASK] Requesting peers from " + pk.substring(0, 10));

      // Concurrent Dual-send for peer request (exclusive mode to save bandwidth if address is known)
      if (STRICT_SERIAL_PROTOCOL) {
        MDS.cmd("maxima action:send publickey:" + pk + " application:metachain data:" + hexData + " poll:false");
      } else {
        resolveAndSend(pk, hexData, "GOSSIP-ASK", false, true);
      }
    }
  });
}

function sendWelcomePackage(targetPubkey, targetAlias, targetAddress) {
  targetPubkey = (targetPubkey || "").toLowerCase();
  if (MY_MAXIMA_PK && targetPubkey === MY_MAXIMA_PK) return;

  MDS.log("🎁 [GOSSIP] Sending Welcome Package to " + targetAlias);

  var peerSql =
    "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 50";
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
          } catch (e) {}
        }

        peers.push({
          pubkey: row.PUBLICKEY,
          alias: row.ALIAS,
          bio: bio,
          address: row.ADDRESS,
          allowNonContactChats: (function(r) {
            var val = r.ALLOW_NON_CONTACT_CHATS || r.allow_non_contact_chats;
            return val === 1 || val === true || val === "true" || val === "1";
          })(row),
          avatar: avatar,
          country: country,
          languages: languages,
        });
      }

      var responsePayload = {
        app: "metachain",
        type: "peers_response",
        peers: peers,
      };

      var hexData =
        "0x" + utf8ToHex(JSON.stringify(responsePayload)).toUpperCase();

      // Step 1: P2P broadcast — ensures direct neighbors (local/no-MLS) receive the package.
      // This mirrors sendBackgroundBeacon's dual-layer approach.
      MDS.cmd("message data:" + hexData, function () {
        MDS.log("📡 [GOSSIP] Welcome Package P2P broadcast sent");
      });

      // Step 2: Maxima unicast (using Dual-send helper in exclusive mode)
      // Prevents 3x amplification by preferring Address OR PK, but not both.
      if (!STRICT_SERIAL_PROTOCOL) {
        resolveAndSend(targetPubkey, hexData, "GOSSIP-WELCOME", false, true);
      } else {
        MDS.log("📡 [GOSSIP] Skipping Welcome Package Maxima unicast (using P2P only)");
      }
    }
  });
}
