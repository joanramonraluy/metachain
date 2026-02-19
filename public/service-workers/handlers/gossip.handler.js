/**
 * MetaChain Service Worker - Gossip Handler
 * Handles peer exchange (gossip) protocol
 */

function handleGetPeers(pubkey, maxjson) {
    MDS.log("🗣️ [GOSSIP] Peer request from " + (maxjson.alias || pubkey.substring(0, 10)));

    // Fetch known peers
    var peerSql = "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 10";
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

            // Send response DIRECTLY back to the requester via Maxima
            var replyPayload = {
                app: "metachain",
                type: "peers_response",
                peers: peers
            };

            // Look up the requester's Maxima address from our DB
            var lookupSql = "SELECT ADDRESS FROM DISCOVERED_PEERS WHERE UPPER(PUBLICKEY)=UPPER('" + pubkey + "') LIMIT 1";
            MDS.sql(lookupSql, function (addrRes) {
                var requesterAddress = null;
                if (addrRes.status && addrRes.rows && addrRes.rows.length > 0) {
                    requesterAddress = addrRes.rows[0].ADDRESS;
                }
                // Also fall back to address from the request payload itself
                if (!requesterAddress && maxjson.address) {
                    requesterAddress = maxjson.address;
                }

                if (requesterAddress) {
                    var cleanAddr = cleanMaximaAddress(requesterAddress);
                    var cmd = "maxima action:send to:" + cleanAddr + " application:metachain data:" + JSON.stringify(replyPayload) + " poll:false";
                    MDS.cmd(cmd, function (res) {
                        if (res.status) {
                            MDS.log("✅ [GOSSIP] Sent " + peers.length + " peers directly to " + (maxjson.alias || pubkey.substring(0, 10)));
                        } else {
                            MDS.log("⚠️ [GOSSIP] Direct send failed: " + res.error);
                        }
                    });
                } else {
                    MDS.log("⚠️ [GOSSIP] No address for " + (maxjson.alias || pubkey.substring(0, 10)) + " - cannot respond");
                }
            });
        }
    });
}

function handlePeersResponse(pubkey, maxjson) {
    var peerCount = (maxjson.peers ? maxjson.peers.length : 0);
    var senderAlias = pubkey ? pubkey.substring(0, 10) : "P2P-broadcast";

    MDS.log("📥 [GOSSIP] Received " + peerCount + " peers from " + senderAlias);

    if (maxjson.peers && Array.isArray(maxjson.peers)) {
        var processedCount = 0;
        var skippedCount = 0;

        for (var i = 0; i < maxjson.peers.length; i++) {
            var peer = maxjson.peers[i];

            // Debug each peer
            MDS.log("🔍 [GOSSIP-PEER] " + (i + 1) + "/" + peerCount + ": " +
                (peer.alias || "no-alias") + " (" +
                (peer.pubkey ? peer.pubkey.substring(0, 10) : "no-pubkey") + "...)");

            if (peer.pubkey && peer.address && peer.alias) {
                MDS.log("✅ [GOSSIP-PEER] Processing beacon for: " + peer.alias);
                handleBeacon(peer, 'GOSSIP');
                processedCount++;
            } else {
                MDS.log("⚠️ [GOSSIP-PEER] Skipping incomplete peer - pubkey:" +
                    !!peer.pubkey + " address:" + !!peer.address + " alias:" + !!peer.alias);
                skippedCount++;
            }
        }

        MDS.log("📊 [GOSSIP] Summary: " + processedCount + " processed, " + skippedCount + " skipped");
    } else {
        MDS.log("⚠️ [GOSSIP] No valid peers array in response");
    }
}

function startGossip() {
    MDS.log("🗣️ [GOSSIP] Starting discovery...");

    // 0. Check for Test Mode
    MDS.cmd("status", function (statusRes) {
        if (statusRes.status && statusRes.response && statusRes.response.mode && statusRes.response.mode === "-test") {
            MDS.log("🛑 [GOSSIP] Test mode detected. Skipping peer discovery.");
            return;
        }

        // 1. Ask MLS (if configured) - "Super Peer"
        MDS.cmd("maxima action:info", function (maxInfo) {
            if (!maxInfo.status) {
                MDS.log("⚠️ [GOSSIP] Could not get Maxima info for discovery");
                return;
            }

            var mls = maxInfo.response.mls;
            var staticmls = maxInfo.response.staticmls;

            if (mls) {
                MDS.log("🗣️ [GOSSIP] MLS Found: " + mls + " (Static: " + staticmls + ")");
                askPeers([mls], maxInfo);
            } else {
                MDS.log("ℹ️ [GOSSIP] No MLS configured in Maxima info");
            }

            // 2. Ask Discovered Peers (P2P Mesh)
            MDS.sql("SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT " + DISCOVERY_LIMIT, function (res) {
                if (res.status && res.rows && res.rows.length > 0) {
                    MDS.log("🗣️ [GOSSIP] Asking " + res.rows.length + " discovered peers...");
                    var pubkeys = [];
                    for (var i = 0; i < res.rows.length; i++) {
                        pubkeys.push(res.rows[i].PUBLICKEY);
                    }
                    askPeers(pubkeys, maxInfo);
                } else {
                    // Only log bootstrap if no local peers
                    MDS.log("🗣️ [GOSSIP] No local peers found. Checking bootstrap options...");
                    // 3. Fallback to Contacts (bootstrap if no peers)
                    MDS.cmd("maxcontacts", function (contactRes) {
                        var hasContacts = (contactRes.status && contactRes.response.contacts && contactRes.response.contacts.length > 0);
                        if (hasContacts) {
                            var targets = [];
                            for (var i = 0; i < Math.min(DISCOVERY_LIMIT, contactRes.response.contacts.length); i++) {
                                targets.push(contactRes.response.contacts[i].publickey);
                            }
                            MDS.log("🗣️ [GOSSIP] Asking " + targets.length + " contacts...");
                            askPeers(targets, maxInfo);
                        } else if (!mls) {
                            MDS.log("⚠️ [GOSSIP] Complete isolation: No MLS, no peers, no contacts.");
                        } else {
                            MDS.log("ℹ️ [GOSSIP] No secondary peers/contacts. Waiting for MLS response...");
                        }
                    });
                }
            });
        });
    });
}

function askPeers(pubkeys, maxInfo) {
    var myAlias = (maxInfo && maxInfo.status) ? maxInfo.response.name : "Anonymous";

    var requestPayload = {
        app: "metachain",
        type: "get_peers",
        alias: myAlias,
        address: MY_MAXIMA_ADDRESS || ""  // Include own address so MLS can reply directly
    };

    var hexData = "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

    for (var i = 0; i < pubkeys.length; i++) {
        // Use cleanMaximaAddress to safely handle port numbers and odd spacing
        var target = cleanMaximaAddress(pubkeys[i]);
        if (MY_MAXIMA_PK && target === MY_MAXIMA_PK) continue;
        if (MY_MAXIMA_ADDRESS && target === MY_MAXIMA_ADDRESS) continue;

        var isMx = target.startsWith("Mx");
        // Quote the address/publickey to handle potential special chars or length issues safely
        // FIXED: Use plain JSON data like beacon.handler.js for consistency
        var cmd = "maxima action:send " + (isMx ? "to:" + target : "publickey:\"" + target + "\"") + " application:metachain data:" + JSON.stringify(requestPayload) + " poll:false";

        MDS.log("📤 [GOSSIP-OUT] Sending to " + (isMx ? "Address" : "PK") + ": " + target.substring(0, 20) + "...");
        MDS.cmd(cmd, function (res) {
            if (!res.status) {
                MDS.log("⚠️ [GOSSIP-OUT] Failed to send: " + res.error);
            }
        });
    }
}

function sendWelcomePackage(targetPubkey, targetAlias) {
    if (MY_MAXIMA_PK && targetPubkey === MY_MAXIMA_PK) return;

    MDS.log("🎁 [GOSSIP] Sending Welcome Package to " + targetAlias);

    var peerSql = "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 10";
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

            // Send via P2P broadcast instead of MAXIMA to avoid contact requirement
            MDS.cmd("message data:" + hexData, function (msgRes) {
                if (msgRes.status) {
                    MDS.log("✅ [GOSSIP] Welcome Package broadcast to network");
                } else {
                    MDS.log("⚠️ [GOSSIP] Failed to broadcast Welcome Package: " + (msgRes.error || "unknown error"));
                }
            });
        }
    });
}

/**
 * Helper to clean Maxima Addresses
 * - Removes spaces (causes NumberFormatException)
 * - UPDATED: Keeps IP:Port because Minima needs it for routing to non-contacts (like MLS)
 * - NOW: Uses a STRICT WHITELIST to remove invisible unicode chars
 */
function cleanMaximaAddress(input) {
    if (!input) return "";

    // Regular trim first
    var clean = input.trim();

    // STRICT: Only allow alphanumeric, @, ., and :
    // This removes ALL potential invisible characters, tabs, non-breaking spaces, etc.
    return clean.replace(/[^a-zA-Z0-9@.:]/g, "");
}
