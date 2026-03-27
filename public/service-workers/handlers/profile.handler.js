/**
 * MetaChain Service Worker - Profile Handler
 * Handles profile requests and responses
 * RESTORED FROM WORKING EXAMPLE
 */

function handleProfileRequest(pubkey, maxjson) {
    MDS.log("🕵️ [PROFILE] Request received from: " + pubkey.substring(0, 20) + "...");

    try {
        // Step 1: Check if requester is a contact
        MDS.cmd("maxcontacts", function (contactsRes) {
            var isContact = false;
            if (contactsRes.status && contactsRes.response && contactsRes.response.contacts) {
                var contacts = contactsRes.response.contacts;
                for (var i = 0; i < contacts.length; i++) {
                    if (contacts[i].publickey === pubkey) {
                        isContact = true;
                        break;
                    }
                }
            }
            MDS.log("🔍 [PROFILE] Requester is contact: " + isContact);

            // Step 2: Fetch profile & privacy settings from DB
            MDS.sql("SELECT * FROM MY_PROFILE LIMIT 1", function (res) {
                MDS.log("🔍 [PROFILE-DEBUG] DB Fetch Result: " + JSON.stringify(res));

                var profile = {};
                var level2Visibility = "public";
                var level3Visibility = "personal"; // Default to personal for safety
                var row = {};

                if (res.status && res.rows && res.rows.length > 0) {
                    row = res.rows[0];
                    // Log raw column values for debugging
                    MDS.log("🔍 [PROFILE] RAW DB Values - PRIVACY_L2: " + row.PRIVACY_L2 + ", PRIVACY_L3: " + row.PRIVACY_L3);
                    // Read Privacy Settings from DB if available
                    if (row.PRIVACY_L2 || row.privacy_l2) level2Visibility = row.PRIVACY_L2 || row.privacy_l2;

                    var rawL3 = row.PRIVACY_L3 || row.privacy_l3;
                    if (rawL3 === 'contacts') {
                        level3Visibility = 'personal'; // Enforcement: 'contacts' behaves as 'personal' for safety
                    } else if (rawL3) {
                        level3Visibility = rawL3;
                    }
                }

                MDS.log("🔐 [PROFILE] Privacy Resolved (DB) - L2: " + level2Visibility + ", L3: " + level3Visibility);

                // Check personal contacts via SQL (Migrated from Keypair)
                MDS.sql("SELECT * FROM PERSONAL_CONTACTS", function (personalRes) {
                    var personalContacts = [];
                    if (personalRes.status && personalRes.rows) {
                        // Extract public keys
                        for (var i = 0; i < personalRes.rows.length; i++) {
                            personalContacts.push(personalRes.rows[i].PUBLICKEY);
                        }
                    }
                    MDS.log("🔍 [PROFILE-DEBUG] Personal Contacts (SQL): " + personalContacts.length);

                    var isPersonalContact = false;
                    for (var i = 0; i < personalContacts.length; i++) {
                        if (personalContacts[i].toLowerCase() === pubkey.toLowerCase()) {
                            isPersonalContact = true;
                            break;
                        }
                    }

                    if (isPersonalContact) {
                        MDS.log("✅ [PROFILE] Requester is a PERSONAL contact!");
                    } else {
                        MDS.log("❌ [PROFILE-DEBUG] No match found for " + pubkey.substring(0, 10) + "... in Personal List");
                    }

                    // Step 3: Determine what to include
                    var includeLevel2 = shouldIncludeLevel(level2Visibility, isContact, isPersonalContact);
                    var includeLevel3 = shouldIncludeLevel(level3Visibility, isContact, isPersonalContact);

                    MDS.log("🔒 [PROFILE] Sharing - Level2: " + includeLevel2 + ", Level3: " + includeLevel3);

                    // Populate profile object from row data
                    if (res.status && res.rows && res.rows.length > 0) {
                        // Level 2 fields
                        if (includeLevel2) {
                            try { profile.social = JSON.parse(decodeURIComponent(row.SOCIAL_LINKS || "{}")); } catch (e) { }
                            try { profile.languages = JSON.parse(decodeURIComponent(row.LANGUAGES || "[]")); } catch (e) { }
                            profile.location = decodeURIComponent(row.LOCATION || "");
                            profile.country = decodeURIComponent(row.COUNTRY || "");
                            profile.website = decodeURIComponent(row.WEBSITE || "");
                        }

                        // Level 3 fields
                        if (includeLevel3) {
                            profile.email = decodeURIComponent(row.EMAIL || "");
                            profile.phone = decodeURIComponent(row.PHONE || "");
                            MDS.log("📧 [PROFILE] Level 3 included - Email: " + (profile.email || "EMPTY") + ", Phone: " + (profile.phone || "EMPTY"));
                        } else {
                            MDS.log("🚫 [PROFILE] Level 3 NOT included (visibility: " + level3Visibility + ")");
                        }

                        var rawValue = row.ALLOW_NON_CONTACT_CHATS || row.allow_non_contact_chats;
                        profile.allowNonContactChats = (rawValue === 1 || rawValue === "1" || rawValue === true || rawValue === "true");
                    }

                    // Step 5: Get Basic Info from Maxima (Level 1 - Always public)
                    MDS.cmd("maxima action:info", function (maximaRes) {
                        MDS.log("👤 [PROFILE] Maxima info - Status: " + maximaRes.status);

                        var name = "Unknown";
                        var avatar = "";

                        if (maximaRes.status && maximaRes.response) {
                            name = maximaRes.response.name || "Unknown";
                            avatar = maximaRes.response.icon ? decodeURIComponent(maximaRes.response.icon) : "";
                            MDS.log("👤 [PROFILE] Name from Maxima: " + name);
                        } else {
                            MDS.log("⚠️ [PROFILE] Failed to get Maxima info, using fallback");
                        }

                        MDS.cmd("keypair action:get key:p2p_bio", function (bioRes) {
                            var bio = (bioRes.status && bioRes.response && bioRes.response.value) ? bioRes.response.value : "";

                            // Step 5.5: Get Minima Wallet Address
                            MDS.cmd("getaddress", function (addrRes) {
                                var minimaAddress = "";
                                if (addrRes.status && addrRes.response && addrRes.response.miniaddress) {
                                    minimaAddress = addrRes.response.miniaddress;
                                }

                                // Step 6: Construct filtered response
                                var responsePayload = {
                                    type: "profile_response",
                                    // Level 1 - Always included
                                    name: name,
                                    bio: bio,
                                    avatar: avatar,
                                    allowNonContactChats: profile.allowNonContactChats,
                                    minimaaddress: minimaAddress // ALWAYS INCLUDE WALLET ADDRESS
                                };

                                // Level 2 - Conditionally included
                                if (includeLevel2) {
                                    responsePayload.location = profile.location;
                                    responsePayload.country = profile.country;
                                    responsePayload.website = profile.website;
                                    responsePayload.social = profile.social;
                                    responsePayload.languages = profile.languages;
                                } else {
                                    responsePayload.privacy_l2 = "hidden";
                                }

                                // Level 3 - Conditionally included
                                if (includeLevel3) {
                                    responsePayload.email = profile.email;
                                    responsePayload.phone = profile.phone;
                                    MDS.log("✅ [PROFILE] Level 3 added to response - Email: " + (responsePayload.email || "EMPTY") + ", Phone: " + (responsePayload.phone || "EMPTY"));
                                } else {
                                    responsePayload.privacy_l3 = "hidden";
                                    MDS.log("⚠️ [PROFILE] Level 3 NOT added to response");
                                }

                                MDS.log("📦 [PROFILE] Final response payload: " + JSON.stringify(responsePayload));
                                var jsonStr = JSON.stringify(responsePayload);
                                var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                                // Step 7: Prepare target address
                                var targetAddress = null;
                                if (maxjson.requesterAddress) {
                                    var rawAddr = maxjson.requesterAddress + "";
                                    var parts = rawAddr.split(":");
                                    if (parts.length >= 2) {
                                        var part1 = parts[0].replace(/[^a-zA-Z0-9@.-]/g, "").trim();
                                        var part2 = parts[1].replace(/[^0-9]/g, "").trim();
                                        targetAddress = part1 + ":" + part2;
                                    } else {
                                        targetAddress = rawAddr.replace(/[^a-zA-Z0-9@.:-]/g, "");
                                    }
                                }

                                var sendCommand = "";
                                if (targetAddress && (targetAddress.startsWith("Mx") || targetAddress.startsWith("MX"))) {
                                    MDS.log("📤 [PROFILE] Sending filtered response to address: " + targetAddress);
                                    sendCommand = "maxima action:send to:" + targetAddress + " application:metachain data:" + hexData + " poll:false";
                                } else {
                                    MDS.log("📤 [PROFILE] Sending filtered response to pubkey: " + pubkey.substring(0, 10) + "...");
                                    sendCommand = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false";
                                }

                                // Step 8: Send Response
                                MDS.cmd(sendCommand, function (sendRes) {
                                    MDS.log("✅ [PROFILE] Response Sent. Status: " + sendRes.status);
                                });
                            });
                        });
                    });
                });
            });
        });
    } catch (e) {
        MDS.log("❌ [PROFILE] CRITICAL ERROR in Handler: " + e.message);
    }
}

function handleProfileResponse(pubkey, maxjson) {
    MDS.log("📝 [PROFILE] Response received from: " + pubkey.substring(0, 20) + "...");

    // Update DISCOVERED_PEERS with extended profile data
    var now = Date.now();
    var safePubkey = escapeSql(pubkey);

    // Serialize the full profile as extra_data
    var extraData = escapeSql(JSON.stringify(maxjson));

    // CRITICAL: Extract allowNonContactChats from profile response
    var allowNonContactChats = 1; // Default to true
    if (maxjson.allowNonContactChats !== undefined && maxjson.allowNonContactChats !== null) {
        allowNonContactChats = maxjson.allowNonContactChats ? 1 : 0;
    }

    // Extract minimaaddress from profile response
    var minimaAddress = escapeSql(maxjson.minimaaddress || "");

    // Update bio, extra_data, minimaaddress, AND allow_non_contact_chats
    var updateSql = "UPDATE DISCOVERED_PEERS SET bio='" + escapeSql(maxjson.bio || "") + "', extra_data='" + extraData + "', minimaaddress='" + minimaAddress + "', allow_non_contact_chats=" + allowNonContactChats + ", last_seen=" + now + " WHERE publickey='" + safePubkey + "'";

    MDS.sql(updateSql, function (res) {
        if (res.status) {
            MDS.log("✅ [PROFILE] Extended profile saved for " + pubkey.substring(0, 15) + "... (allowNonContactChats: " + allowNonContactChats + ")");
        }

        // Forward profile_response to frontend so ProfileService can resolve pending promises
        var forwardPayload = JSON.stringify({
            type: "profile_response",
            publickey: pubkey,
            data: maxjson
        });
        MDS.log("📤 [PROFILE] Forwarding response to frontend for " + pubkey.substring(0, 15) + "...");
        MDS.comms.solo(forwardPayload);
    });
}
