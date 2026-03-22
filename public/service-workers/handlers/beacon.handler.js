/**
 * MetaChain Service Worker - Beacon Handler
 * Handles peer discovery beacons and user registry
 */

function encodeBase64Utf8(str) {
  if (!str) return "";
  try {
    if (typeof btoa === "function") {
      return btoa(unescape(encodeURIComponent(str)));
    }
  } catch (e) {}
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(str, "utf8").toString("base64");
    }
  } catch (e) {}
  return "";
}

function normalizeAllowNonContactChats(value, defaultValue) {
  if (defaultValue === undefined || defaultValue === null) defaultValue = 1;
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value ? 1 : 0;
  if (typeof value === "string") {
    var normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes")
      return 1;
    if (normalized === "false" || normalized === "0" || normalized === "no")
      return 0;
  }
  return defaultValue;
}

function buildJoinLink(listingType, joinPayload) {
  if (!joinPayload) return "";
  var scheme = listingType === "group" ? "mcgrp://" : "mcch://";
  var payload =
    listingType === "group"
      ? {
          g: joinPayload.id,
          n: joinPayload.name,
          p: joinPayload.admin_publickey,
          a: joinPayload.admin_address,
        }
      : {
          c: joinPayload.id,
          n: joinPayload.name,
          p: joinPayload.admin_publickey,
          a: joinPayload.admin_address,
        };
  if (!payload.g && !payload.c) return "";
  var base64 = encodeBase64Utf8(JSON.stringify(payload));
  return base64 ? scheme + base64 : "";
}

function buildPublicListings(myPubkey, myAddress, callback) {
  var listings = [];
  var groupSql =
    "SELECT group_id, name, description, created_date FROM GROUPS WHERE COALESCE(is_public, FALSE) = TRUE AND (archived IS NULL OR archived = FALSE)";
  MDS.sql(groupSql, function (groupRes) {
    if (groupRes.status && groupRes.rows) {
      for (var i = 0; i < groupRes.rows.length; i++) {
        var row = groupRes.rows[i];
        var groupId = row.GROUP_ID || row.group_id;
        var name = row.NAME || row.name;
        var description = row.DESCRIPTION || row.description || "";
        var createdDate = row.CREATED_DATE || row.created_date || 0;
        if (!groupId || !name) continue;
        var joinPayload = {
          id: groupId,
          name: name,
          admin_publickey: myPubkey,
          admin_address: myAddress,
        };
        listings.push({
          type: "group",
          id: groupId,
          name: name,
          description: description,
          created_date: createdDate,
          join: joinPayload,
          link: buildJoinLink("group", joinPayload),
        });
      }
    }

    var channelSql =
      "SELECT channel_id, name, description, created_date FROM CHANNELS WHERE COALESCE(is_public, FALSE) = TRUE AND (archived IS NULL OR archived = FALSE)";
    MDS.sql(channelSql, function (channelRes) {
      if (channelRes.status && channelRes.rows) {
        for (var j = 0; j < channelRes.rows.length; j++) {
          var rowC = channelRes.rows[j];
          var channelId = rowC.CHANNEL_ID || rowC.channel_id;
          var cName = rowC.NAME || rowC.name;
          var cDescription = rowC.DESCRIPTION || rowC.description || "";
          var cCreatedDate = rowC.CREATED_DATE || rowC.created_date || 0;
          if (!channelId || !cName) continue;
          var joinPayloadC = {
            id: channelId,
            name: cName,
            admin_publickey: myPubkey,
            admin_address: myAddress,
          };
          listings.push({
            type: "channel",
            id: channelId,
            name: cName,
            description: cDescription,
            created_date: cCreatedDate,
            join: joinPayloadC,
            link: buildJoinLink("channel", joinPayloadC),
          });
        }
      }

      listings.sort(function (a, b) {
        return (b.created_date || 0) - (a.created_date || 0);
      });
      callback(listings.slice(0, 10));
    });
  });
}

function normalizeListings(listings) {
  if (!Array.isArray(listings)) return [];
  var normalized = [];
  for (var i = 0; i < listings.length; i++) {
    var item = listings[i];
    if (!item || typeof item !== "object") continue;
    var type = item.type;
    if (type !== "group" && type !== "channel") continue;
    var id = item.id || item.group_id || item.channel_id;
    var name = item.name;
    if (!id || !name) continue;
    normalized.push({
      type: type,
      id: id,
      name: name,
      description: item.description || "",
      join: item.join || null,
      link: item.link || "",
    });
  }
  return normalized.slice(0, 10);
}

function saveBeaconListings(beacon, now) {
  if (!beacon || !beacon.pubkey) return;
  if (!Array.isArray(beacon.listings)) return;

  var incomingTimestamp = beacon.timestamp || 0;
  if (incomingTimestamp <= 0) return;

  var pk = beacon.pubkey;
  var safePk = escapeSql(pk);
  var cleanedListings = normalizeListings(beacon.listings);
  var listingsJson = escapeSql(JSON.stringify(cleanedListings));

  MDS.sql(
    "SELECT timestamp FROM DISCOVERED_LISTINGS WHERE UPPER(owner_publickey)=UPPER('" +
      safePk +
      "')",
    function (res) {
      var storedTimestamp = 0;
      if (res.status && res.rows && res.rows.length > 0) {
        storedTimestamp = res.rows[0].TIMESTAMP || res.rows[0].timestamp || 0;
      }

      if (storedTimestamp >= incomingTimestamp) {
        MDS.sql(
          "UPDATE DISCOVERED_LISTINGS SET last_seen=" +
            now +
            " WHERE UPPER(owner_publickey)=UPPER('" +
            safePk +
            "')",
        );
        return;
      }

      var upsertSql =
        "MERGE INTO DISCOVERED_LISTINGS (owner_publickey, listings, timestamp, last_seen) " +
        "KEY (owner_publickey) " +
        "VALUES ('" +
        safePk +
        "', '" +
        listingsJson +
        "', " +
        incomingTimestamp +
        ", " +
        now +
        ")";
      MDS.sql(upsertSql, function (saveRes) {
        if (saveRes.status) {
          MDS.log("✅ [LISTINGS] Updated listings for " + pk.substring(0, 10));
        } else {
          MDS.log(
            "❌ [LISTINGS] Failed to save listings: " + JSON.stringify(saveRes),
          );
        }
      });
    },
  );
}

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

    var allowNonContactChats = normalizeAllowNonContactChats(
      beacon.allowNonContactChats,
      1,
    );

    MDS.log("📡 [BEACON] " + beacon.alias + " from " + source);

    saveBeaconListings(beacon, now);

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
        "SELECT bio FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
          beacon.pubkey +
          "')",
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
    "SELECT extra_data FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
      beacon.pubkey +
      "')",
    function (existingRes) {
      var storedTimestamp = 0;
      var hasExisting = false;
      if (
        existingRes.status &&
        existingRes.rows &&
        existingRes.rows.length > 0 &&
        existingRes.rows[0].EXTRA_DATA
      ) {
        hasExisting = true;
        try {
          var stored = JSON.parse(existingRes.rows[0].EXTRA_DATA);
          storedTimestamp = stored.timestamp || 0;
        } catch (e) {}
      } else if (
        existingRes.status &&
        existingRes.rows &&
        existingRes.rows.length > 0
      ) {
        hasExisting = true;
      }

      // If incoming beacon has no timestamp and we already have a profile, only touch last_seen
      if (incomingTimestamp <= 0 && hasExisting) {
        MDS.log(
          "⏭️ [BEACON] Missing timestamp for " +
            beacon.alias +
            " — preserving existing profile. Touching last_seen only.",
        );
        MDS.sql(
          "UPDATE DISCOVERED_PEERS SET last_seen=" +
            now +
            " WHERE UPPER(publickey)=UPPER('" +
            beacon.pubkey +
            "')",
          function (updateRes) {
            if (updateRes.status) {
              MDS.log("✅ [BEACON] Touched last_seen for: " + beacon.alias);
            }
          },
        );
        return;
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
            "). Touching last_seen only.",
        );
        MDS.sql(
          "UPDATE DISCOVERED_PEERS SET last_seen=" +
            now +
            " WHERE UPPER(publickey)=UPPER('" +
            beacon.pubkey +
            "')",
          function (updateRes) {
            if (updateRes.status) {
              MDS.log("✅ [BEACON] Touched last_seen for: " + beacon.alias);
            }
          },
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
          if ((source === "P2P" || source === "MAXIMA") && !hasExisting) {
            sendWelcomePackage(beacon.pubkey, beacon.alias, cleanAddress);
            askPeers([beacon.pubkey]);
          } else if (source === "P2P" || source === "MAXIMA") {
            MDS.log(
              "⏭️ [GOSSIP] Welcome Package skipped for existing peer: " +
                beacon.alias,
            );
          }
        } else {
          MDS.log("❌ [BEACON] Save failed: " + JSON.stringify(res));
        }
      });
    },
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

            var finalizeBeacon = function (resolvedMinimaAddress) {
              // Get all profile data including avatar (like the working example)
              MDS.sql(
                "SELECT * FROM MY_PROFILE WHERE id=1",
                function (permRes) {
                  var allowNonContactChats = true;
                  var avatar = "";
                  var dbCountry = "";
                  var dbLanguages = [];

                  if (
                    permRes.status &&
                    permRes.rows &&
                    permRes.rows.length > 0
                  ) {
                    var row = permRes.rows[0];
                    var val =
                      row.ALLOW_NON_CONTACT_CHATS ||
                      row.allow_non_contact_chats;
                    allowNonContactChats =
                      val === 1 ||
                      val === true ||
                      val === "true" ||
                      val === "1";
                    // Get avatar from DB (same as working example line 1714)
                    avatar = row.AVATAR || row.avatar || "";
                    // Get country from DB (with decoding like example line 1711)
                    dbCountry = decodeURIComponent(
                      row.COUNTRY || row.country || "",
                    );
                    // Get languages from DB and parse as JSON array (like example line 1712-1713)
                    try {
                      dbLanguages = JSON.parse(
                        decodeURIComponent(
                          row.LANGUAGES || row.languages || "[]",
                        ),
                      );
                    } catch (e) {
                      dbLanguages = [];
                    }
                  }

                  // Use DB values as primary, keypair as fallback
                  var finalCountry = dbCountry || country;
                  var finalLanguages =
                    dbLanguages.length > 0 ? dbLanguages : [];
                  // Try to parse keypair languages if DB is empty
                  if (finalLanguages.length === 0 && languages) {
                    try {
                      finalLanguages = JSON.parse(languages);
                    } catch (e) {
                      finalLanguages = [];
                    }
                  }

                  buildPublicListings(myPubkey, myAddress, function (listings) {
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
                      minimaaddress: resolvedMinimaAddress,
                      // Use maxima icon as primary, MY_PROFILE as fallback
                      avatar: myAvatar || avatar,
                      listings: listings || [],
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
                },
              );
            };

            if (!minimaAddress) {
              MDS.cmd("getaddress", function (addrRes) {
                if (
                  addrRes &&
                  addrRes.status &&
                  addrRes.response &&
                  addrRes.response.miniaddress
                ) {
                  minimaAddress = addrRes.response.miniaddress;
                }
                finalizeBeacon(minimaAddress);
              });
            } else {
              finalizeBeacon(minimaAddress);
            }
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
      " poll:false",
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

var LAST_MLS_BOOTSTRAP_AT = 0;
var MLS_BOOTSTRAP_THROTTLE_MS = 30000;

/**
 * Bootstrap discovery by sending get_peers to the configured MLS server.
 * Called on startup when DISCOVERED_PEERS may be empty (e.g. after -clean).
 * The MLS server has MetaChain and knows all registered peers — asking it
 * breaks the chicken-and-egg problem without requiring prior contacts.
 */
function bootstrapFromMLS() {
  var now = Date.now();
  if (now - LAST_MLS_BOOTSTRAP_AT < MLS_BOOTSTRAP_THROTTLE_MS) {
    MDS.log("⏭️ [BOOTSTRAP] Throttled repeated MLS bootstrap attempt.");
    return;
  }
  LAST_MLS_BOOTSTRAP_AT = now;

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
            " poll:false",
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
