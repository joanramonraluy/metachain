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
