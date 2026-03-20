/**
 * MetaChain Service Worker - Beacon Handler
 * Handles peer discovery beacons and user registry
 */

function handleBeacon(beacon, source) {
  try {
    // Validation logging
    if (!beacon.pubkey || !beacon.address || !beacon.alias) {
      MDS.log(
        "⚠️ [BEACON-REJECT] Missing required fields from " +
          source +
          " - pubkey:" +
          !!beacon.pubkey +
          " address:" +
          !!beacon.address +
          " alias:" +
          !!beacon.alias,
      );
      return;
    }

    // Debounce (except for important sources)
    var isImportant = source === "GOSSIP" || source === "BOOTSTRAP";
    if (
      !isImportant &&
      BEACON_CACHE[beacon.pubkey] &&
      Date.now() - BEACON_CACHE[beacon.pubkey] < 10000
    ) {
      MDS.log(
        "⏭️ [BEACON-DEBOUNCE] Skipping " +
          beacon.alias +
          " from " +
          source +
          " (recently processed)",
      );
      return;
    }

    // Check if this is our own beacon (allow SELF to persist)
    if (MY_MAXIMA_PK && beacon.pubkey === MY_MAXIMA_PK && source !== "SELF") {
      MDS.log("⏭️ [BEACON-SELF] Ignoring own beacon from " + source);
      return;
    }

    BEACON_CACHE[beacon.pubkey] = Date.now();

    var now = Date.now();
    var escapedAlias = escapeSql(beacon.alias);
    var bioValue = beacon.bio || "";
    // Clean address to prevent NumberFormatException (remove extra spaces)
    var cleanAddress = (beacon.address || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s*:\s*/g, ":");

    var allowNonContactChats =
      beacon.allowNonContactChats !== undefined &&
      beacon.allowNonContactChats !== null
        ? beacon.allowNonContactChats
          ? 1
          : 0
        : 1;

    MDS.log("📡 [BEACON] " + beacon.alias + " from " + source);

    // Save beacon - handle bio caching
    if (bioValue) {
      saveBeaconWithBio(
        beacon,
        source,
        escapedAlias,
        bioValue,
        cleanAddress,
        allowNonContactChats,
        now,
      );
    } else {
      // Check DB for cached bio
      MDS.sql(
        "SELECT bio FROM DISCOVERED_PEERS WHERE publickey='" +
          beacon.pubkey +
          "'",
        function (checkRes) {
          var bioToSave = "";
          if (
            checkRes.status &&
            checkRes.rows &&
            checkRes.rows.length > 0 &&
            checkRes.rows[0].BIO
          ) {
            bioToSave = checkRes.rows[0].BIO;
          }
          saveBeaconWithBio(
            beacon,
            source,
            escapedAlias,
            bioToSave,
            cleanAddress,
            allowNonContactChats,
            now,
          );
        },
      );
    }
  } catch (e) {
    MDS.log("❌ [BEACON] Handler error: " + e.message);
  }
}

function saveBeaconWithBio(
  beacon,
  source,
  escapedAlias,
  bio,
  cleanAddress,
  allowNonContactChats,
  now
) {
  var escapedBio = escapeSql(bio);
  var extraData = escapeSql(JSON.stringify(beacon));
  var incomingTimestamp = beacon.timestamp || 0;

  // Check stored beacon timestamp to avoid overwriting newer profile data with old gossip
  MDS.sql(
    "SELECT extra_data FROM DISCOVERED_PEERS WHERE publickey='" + beacon.pubkey + "'",
    function (existingRes) {
      var storedTimestamp = 0;
      if (
        existingRes.status &&
        existingRes.rows &&
        existingRes.rows.length > 0 &&
        existingRes.rows[0].EXTRA_DATA
      ) {
        try {
          var stored = JSON.parse(existingRes.rows[0].EXTRA_DATA);
          storedTimestamp = stored.timestamp || 0;
        } catch (e) {}
      }

      // If the incoming beacon is older than what we have stored, only touch last_seen
      if (incomingTimestamp > 0 && storedTimestamp > incomingTimestamp) {
        MDS.log(
          "⏭️ [BEACON] Skipping profile overwrite for " +
            beacon.alias +
            " — stored beacon is newer (" +
            storedTimestamp +
            " > " +
            incomingTimestamp +
            "). Touching last_seen only."
        );
        MDS.sql(
          "UPDATE DISCOVERED_PEERS SET last_seen=" +
            now +
            " WHERE publickey='" +
            beacon.pubkey +
            "'",
          function (updateRes) {
            if (updateRes.status) {
              MDS.log("✅ [BEACON] Touched last_seen for: " + beacon.alias);
            }
          }
        );
        return;
      }

      // Proceed with full profile MERGE
      var discoverySql =
        "MERGE INTO DISCOVERED_PEERS (publickey, alias, bio, address, last_seen, source, allow_non_contact_chats, extra_data) " +
        "KEY (publickey) " +
        "VALUES ('" +
        beacon.pubkey +
        "', '" +
        escapedAlias +
        "', '" +
        escapedBio +
        "', '" +
        cleanAddress +
        "', " +
        now +
        ", '" +
        source +
        "', " +
        allowNonContactChats +
        ", '" +
        extraData +
        "')";

      MDS.sql(discoverySql, function (res) {
        if (res.status) {
          MDS.log("✅ [BEACON] Saved: " + beacon.alias);
          promoteToUserRegistry(beacon, now);

          // Reactive gossip
          if (source === "P2P" || source === "MAXIMA") {
            sendWelcomePackage(beacon.pubkey, beacon.alias, cleanAddress);
            askPeers([beacon.pubkey]);
          }
        } else {
          MDS.log("❌ [BEACON] Save failed: " + JSON.stringify(res));
        }
      });
    }
  );
}

function promoteToUserRegistry(beacon, now) {
  var user_id = beacon.pubkey;
  var escapedAlias = escapeSql(beacon.alias);

  MDS.sql(
    "SELECT * FROM METACHAIN_USERS WHERE user_id='" + user_id + "'",
    function (res) {
      if (res.status && res.rows && res.rows.length > 0) {
        // Update existing
        var updateSql =
          "UPDATE METACHAIN_USERS SET alias='" +
          escapedAlias +
          "', address='" +
          (beacon.address || "") +
          "', last_updated=" +
          now +
          " WHERE user_id='" +
          user_id +
          "'";
        MDS.sql(updateSql);
      } else {
        // Insert new
        var insertSql =
          "INSERT INTO METACHAIN_USERS (user_id, publickey, alias, address, first_seen, last_updated) " +
          "VALUES ('" +
          user_id +
          "', '" +
          beacon.pubkey +
          "', '" +
          escapedAlias +
          "', '" +
          (beacon.address || "") +
          "', " +
          now +
          ", " +
          now +
          ")";
        MDS.sql(insertSql);
      }
    },
  );
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
    var myAvatar = maxInfo.response.icon
      ? decodeURIComponent(maxInfo.response.icon)
      : "";

    MDS.keypair.get("p2p_bio", function (bioRes) {
      var bio = bioRes.status && bioRes.value ? bioRes.value : "";

      // Get additional profile data
      MDS.keypair.get("profile_country", function (countryRes) {
        var country =
          countryRes.status && countryRes.value ? countryRes.value : "";

        MDS.keypair.get("profile_languages", function (langRes) {
          var languages = langRes.status && langRes.value ? langRes.value : "";

          MDS.keypair.get("profile_minima_address", function (addrRes) {
            var minimaAddress =
              addrRes.status && addrRes.value ? addrRes.value : "";

            // Get all profile data including avatar (like the working example)
            MDS.sql("SELECT * FROM MY_PROFILE WHERE id=1", function (permRes) {
              var allowNonContactChats = true;
              var avatar = "";
              var dbCountry = "";
              var dbLanguages = [];

              if (permRes.status && permRes.rows && permRes.rows.length > 0) {
                var row = permRes.rows[0];
                var val =
                  row.ALLOW_NON_CONTACT_CHATS || row.allow_non_contact_chats;
                allowNonContactChats =
                  val === 1 || val === true || val === "true" || val === "1";
                // Get avatar from DB (same as working example line 1714)
                avatar = row.AVATAR || row.avatar || "";
                // Get country from DB (with decoding like example line 1711)
                dbCountry = decodeURIComponent(
                  row.COUNTRY || row.country || "",
                );
                // Get languages from DB and parse as JSON array (like example line 1712-1713)
                try {
                  dbLanguages = JSON.parse(
                    decodeURIComponent(row.LANGUAGES || row.languages || "[]"),
                  );
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
                // Persist our immutable Wallet Address
                minimaaddress: minimaAddress,
                // Use maxima icon as primary, MY_PROFILE as fallback
                avatar: myAvatar || avatar,
                timestamp: Date.now(),
              };

              var jsonStr = JSON.stringify(beacon);
              var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

              // P2P broadcast
              MDS.cmd("message data:" + hexData, function (res) {
                MDS.log("📡 [BG-BEACON] P2P broadcast sent");
              });

              // MLS unicast (Maxima) to make MLS a discovery hub
              sendBeaconToMLS(maxInfo.response, hexData);

              // Save self to DB
              handleBeacon(beacon, "SELF");
            });
          });
        });
      });
    });
  });
}

function sendBeaconToMLS(maxInfoResponse, hexData) {
  if (!maxInfoResponse) return;

  var mls = maxInfoResponse.mls;
  if (!mls) {
    return;
  }

  // MLS format: MxG18HGG...@45.128.3.158:9001
  var atIndex = mls.indexOf("@");
  if (atIndex === -1) {
    MDS.log("⚠️ [BEACON-MLS] Invalid MLS format: " + mls);
    return;
  }

  var mlsMxPrefix = mls.substring(0, atIndex);
  var myMxPrefix = maxInfoResponse.p2pidentity || "";
  if (myMxPrefix.indexOf("@") !== -1) {
    myMxPrefix = myMxPrefix.substring(0, myMxPrefix.indexOf("@"));
  }
  if (!myMxPrefix) {
    var myContact = maxInfoResponse.contact || "";
    myMxPrefix =
      myContact.indexOf("@") !== -1
        ? myContact.substring(0, myContact.indexOf("@"))
        : myContact;
  }

  // Avoid self-send if we are the MLS server (self-messages are dropped)
  if (mlsMxPrefix && myMxPrefix && mlsMxPrefix === myMxPrefix) {
    return;
  }

  MDS.cmd(
    "maxima action:send to:" +
      mls +
      " application:metachain data:" +
      hexData +
      " poll:true",
    function (res) {
      if (res.status) {
        MDS.log("✅ [BEACON-MLS] Beacon sent to MLS");
      } else {
        MDS.log(
          "⚠️ [BEACON-MLS] Failed to send beacon to MLS: " +
            (res.error || "unknown error"),
        );
      }
    },
  );
}

function startCleanupTimer() {
  var now = Date.now();
  var TTL = 600000; // 10 minutes

  var cleanupSql =
    "DELETE FROM DISCOVERED_PEERS WHERE last_seen < " +
    (now - TTL) +
    " AND source != 'SELF'";
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
 * Bootstrap discovery by sending get_peers to the configured MLS server.
 * Called on startup when DISCOVERED_PEERS may be empty (e.g. after -clean).
 * The MLS server has MetaChain and knows all registered peers — asking it
 * breaks the chicken-and-egg problem without requiring prior contacts.
 */
function bootstrapFromMLS() {
  MDS.log("🔗 [BOOTSTRAP] Checking DISCOVERED_PEERS count...");

  MDS.sql(
    "SELECT COUNT(*) AS cnt FROM DISCOVERED_PEERS WHERE source != 'SELF'",
    function (countRes) {
      var count =
        countRes.status && countRes.rows && countRes.rows.length > 0
          ? countRes.rows[0].CNT || countRes.rows[0].cnt || 0
          : 0;

      if (count > 0) {
        MDS.log(
          "🔗 [BOOTSTRAP] Already have " +
            count +
            " peers — skipping MLS bootstrap.",
        );
        return;
      }

      MDS.log("🔗 [BOOTSTRAP] No peers found. Attempting MLS bootstrap...");

      MDS.cmd("maxima action:info", function (maxInfo) {
        if (!maxInfo.status) {
          MDS.log("⚠️ [BOOTSTRAP] Could not get Maxima info.");
          return;
        }

        var mls = maxInfo.response.mls;
        if (!mls) {
          MDS.log(
            "⚠️ [BOOTSTRAP] No MLS server configured — skipping bootstrap.",
          );
          return;
        }

        // MLS format: MxG18HGG...@45.128.3.158:9001
        var atIndex = mls.indexOf("@");
        if (atIndex === -1) {
          MDS.log("⚠️ [BOOTSTRAP] Invalid MLS format: " + mls);
          return;
        }

        var mlsMxPrefix = mls.substring(0, atIndex);
        var mlsHost = mls.substring(atIndex + 1);

        // Detect self-bootstrap: if we ARE the MLS server, skip (self-messages are dropped by Minima)
        var myMxPrefix = maxInfo.response.p2pidentity || "";
        if (myMxPrefix.indexOf("@") !== -1) {
          myMxPrefix = myMxPrefix.substring(0, myMxPrefix.indexOf("@"));
        }
        if (!myMxPrefix) {
          var myContact = maxInfo.response.contact || "";
          myMxPrefix =
            myContact.indexOf("@") !== -1
              ? myContact.substring(0, myContact.indexOf("@"))
              : myContact;
        }
        if (mlsMxPrefix && myMxPrefix && mlsMxPrefix === myMxPrefix) {
          MDS.log(
            "⏭️ [BOOTSTRAP] We ARE the MLS server — skipping self-bootstrap.",
          );
          return;
        }

        var mlsFullAddress = mls; // Full address: MxG18HGG...@45.128.3.158:9001
        MDS.log("🔗 [BOOTSTRAP] Sending get_peers to MLS @ " + mlsHost + "...");

        var myAlias = maxInfo.response.name || "Anonymous";
        var myAddress = maxInfo.response.contact || "";

        var requestPayload = {
          app: "metachain",
          type: "get_peers",
          alias: myAlias,
          address: myAddress,
        };

        var hexData =
          "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

        MDS.cmd(
          "maxima action:send to:" +
            mlsFullAddress +
            " application:metachain data:" +
            hexData +
            " poll:true",
          function (res) {
            if (res.status) {
              MDS.log(
                "✅ [BOOTSTRAP] get_peers sent to MLS server @ " + mlsHost,
              );
            } else {
              MDS.log(
                "⚠️ [BOOTSTRAP] Failed to send to MLS @ " +
                  mlsHost +
                  ": " +
                  (res.error || "unknown error"),
              );
            }
          },
        );
      });
    },
  );
}
