/**
 * MetaChain Service Worker - Gossip Handler
 * Handles peer exchange (gossip) protocol
 */

function handleGetPeers(pubkey, maxjson) {
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
          allowNonContactChats:
            row.ALLOW_NON_CONTACT_CHATS === 1 ||
            row.ALLOW_NON_CONTACT_CHATS === true,
          avatar: avatar,
          country: country,
          languages: languages,
        });
      }

      // Send response (prefer address when provided to avoid contact requirement)
      var replyPayload = {
        app: "metachain",
        type: "peers_response",
        peers: peers,
      };
      var replyHex =
        "0x" + utf8ToHex(JSON.stringify(replyPayload)).toUpperCase();
      var targetAddress = maxjson && maxjson.address ? maxjson.address : "";
      var sendCmd = targetAddress
        ? "maxima action:send to:" +
          targetAddress +
          " application:metachain data:" +
          replyHex +
          " poll:false"
        : "maxima action:send publickey:" +
          pubkey +
          " application:metachain data:" +
          replyHex +
          " poll:false";

      var fallbackCmd =
        "maxima action:send publickey:" +
        pubkey +
        " application:metachain data:" +
        replyHex +
        " poll:false";

      MDS.cmd(sendCmd, function (sendRes) {
        var targetLabel = targetAddress
          ? "to " + targetAddress
          : "publickey " + pubkey.substring(0, 10);

        if (sendRes && sendRes.status === false) {
          MDS.log(
            "⚠️ [GOSSIP] Failed to send peers " +
              targetLabel +
              ": " +
              (sendRes.error || "unknown error"),
          );
        } else {
          MDS.log("✅ [GOSSIP] Sent " + peers.length + " peers " + targetLabel);
        }

        // Always also send via publickey to avoid stale/ephemeral addresses
        if (targetAddress) {
          MDS.cmd(fallbackCmd, function (fallbackRes) {
            var pkLabel = "publickey " + pubkey.substring(0, 10);
            if (fallbackRes && fallbackRes.status === false) {
              MDS.log(
                "⚠️ [GOSSIP] Failed to send peers to " +
                  pkLabel +
                  ": " +
                  (fallbackRes.error || "unknown error"),
              );
            } else {
              MDS.log("✅ [GOSSIP] Sent " + peers.length + " peers " + pkLabel);
            }
          });
        }
      });
    }
  });
}

function handlePeersResponse(pubkey, maxjson) {
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
    "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 5",
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
              i < Math.min(5, contactRes.response.contacts.length);
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

      MDS.cmd(
        "maxima action:send publickey:" +
          pk +
          " application:metachain data:" +
          hexData +
          " poll:false",
      );
    }
  });
}

function sendWelcomePackage(targetPubkey, targetAlias) {
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
          allowNonContactChats:
            row.ALLOW_NON_CONTACT_CHATS === 1 ||
            row.ALLOW_NON_CONTACT_CHATS === true,
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

      // Send via P2P broadcast instead of MAXIMA to avoid contact requirement
      MDS.cmd("message data:" + hexData, function (msgRes) {
        if (msgRes.status) {
          MDS.log("✅ [GOSSIP] Welcome Package broadcast to network");
        } else {
          MDS.log(
            "⚠️ [GOSSIP] Failed to broadcast Welcome Package: " +
              (msgRes.error || "unknown error"),
          );
        }
      });
    }
  });
}
