/**
 * MetaChain Service Worker - Beacon Handler
 * Handles peer discovery beacons and user registry
 */

function handleBeacon(beacon, source) {
    try {
        // Validation logging
        if (!beacon.pubkey || !beacon.address || !beacon.alias) {
            MDS.log("⚠️ [BEACON-REJECT] Missing required fields from " + source +
                " - pubkey:" + !!beacon.pubkey + " address:" + !!beacon.address + " alias:" + !!beacon.alias);
            return;
        }

        // Debounce (except for important sources)
        var isImportant = (source === 'GOSSIP' || source === 'BOOTSTRAP');
        if (!isImportant && BEACON_CACHE[beacon.pubkey] && (Date.now() - BEACON_CACHE[beacon.pubkey] < 10000)) {
            MDS.log("⏭️ [BEACON-DEBOUNCE] Skipping " + beacon.alias + " from " + source + " (recently processed)");
            return;
        }

        // Check if this is our own beacon
        if (MY_MAXIMA_PK && beacon.pubkey === MY_MAXIMA_PK) {
            MDS.log("⏭️ [BEACON-SELF] Ignoring own beacon from " + source);
            return;
        }

        BEACON_CACHE[beacon.pubkey] = Date.now();

        var now = Date.now();
        var escapedAlias = escapeSql(beacon.alias);
        var bioValue = beacon.bio || "";
        // Clean address to prevent NumberFormatException (remove extra spaces)
        var cleanAddress = (beacon.address || "").trim().replace(/\s+/g, " ").replace(/\s*:\s*/g, ":");

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

                    MDS.keypair.get("profile_minima_address", function (addrRes) {
                        var minimaAddress = (addrRes.status && addrRes.value) ? addrRes.value : "";

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
                                // Persist our immutable Wallet Address
                                minimaaddress: minimaAddress,
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
    });
}

function startCleanupTimer() {
    var now = Date.now();
    var TTL = 600000; // 10 minutes

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
