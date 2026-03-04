/**
 * MetaChain Service Worker - Group Message Handler
 * Handles group messages, invites, member updates
 */

/**
 * Periodic beacon: announces our current Mx address to all members of all our groups.
 * This keeps DISCOVERED_PEERS fresh even when Maxima addresses rotate.
 */
function sendGroupAddressBeacon() {
    MDS.cmd("maxima action:info", function (maxInfo) {
        if (!maxInfo.status) return;

        var myPubkey = maxInfo.response.publickey;
        var myAddress = maxInfo.response.contact;
        var myName = maxInfo.response.name || "Unknown";

        if (!myAddress) return;

        // Find all distinct group members across all groups — excluding ourselves
        var memberSql = "SELECT DISTINCT publickey FROM GROUP_MEMBERS WHERE UPPER(publickey) != UPPER('" + myPubkey + "')";
        MDS.sql(memberSql, function (res) {
            if (!res.status || !res.rows || res.rows.length === 0) return;

            var beaconPayload = {
                app: "metachain-group",
                messageType: "group_address_beacon",
                senderPublickey: myPubkey,
                senderUsername: myName,
                senderAddress: myAddress,
                timestamp: Date.now()
            };
            var hexData = "0x" + utf8ToHex(JSON.stringify(beaconPayload)).toUpperCase();

            for (var i = 0; i < res.rows.length; i++) {
                var memberPk = res.rows[i].PUBLICKEY;

                // Look up their current address
                var peerSql = "SELECT address FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + escapeSql(memberPk) + "') LIMIT 1";
                MDS.sql(peerSql, (function (pk) {
                    return function (peerRes) {
                        if (peerRes.status && peerRes.rows && peerRes.rows.length > 0) {
                            var addr = peerRes.rows[0].ADDRESS || peerRes.rows[0].address;
                            if (addr) {
                                var cleanAddr = addr.replace(/\s+/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "");
                                MDS.cmd("maxima action:send to:" + cleanAddr + " application:metachain-group data:" + hexData + " poll:false");
                            }
                        }
                        // If no address known, skip (we'll learn it when they beacon back)
                    };
                })(memberPk));
            }
        });
    });
}

/**
 * Handles a group_address_beacon — seeds DISCOVERED_PEERS with the sender's fresh address.
 */
function handleGroupAddressBeacon(pubkey, maxjson) {
    if (!maxjson.senderAddress || !pubkey) return;

    var safePk = escapeSql(pubkey);
    var safeAddr = escapeSql(maxjson.senderAddress);
    var safeName = escapeSql(maxjson.senderUsername || "Unknown");
    var now = Date.now();

    var delSql = "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + safePk + "')";
    MDS.sql(delSql, function () {
        var insSql = "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" + safePk + "', '" + safeAddr + "', 'GROUP_BEACON', '" + safeName + "', " + now + ", '')";
        MDS.sql(insSql);
    });
}

/**
 * SW-side group history request.
 * Sends a history_request to all known members of a group.
 * Used for gap detection and startup sync.
 */
function requestGroupHistoryFromSW(groupId) {
    MDS.log("🔄 [GROUP-SYNC] Requesting history for group " + groupId + "...");

    MDS.cmd("maxima action:info", function (maxInfo) {
        if (!maxInfo.status) return;
        var myPubkey = maxInfo.response.publickey;

        // Find the last message timestamp we have for this group
        var lastSql = "SELECT date FROM GROUP_MESSAGES WHERE group_id='" + escapeSql(groupId) + "' ORDER BY date DESC LIMIT 1";
        MDS.sql(lastSql, function (lastRes) {
            var lastTimestamp = (lastRes.status && lastRes.rows && lastRes.rows.length > 0)
                ? Number(lastRes.rows[0].DATE || lastRes.rows[0].date || 0)
                : 0;

            var requestPayload = {
                app: "metachain-group",
                messageType: "history_request",
                groupId: groupId,
                groupName: "SYNC",
                senderPublickey: myPubkey,
                senderUsername: "",
                timestamp: Date.now(),
                historySince: lastTimestamp
            };
            var hexData = "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

            // Send to all known members via DISCOVERED_PEERS
            var memberSql = "SELECT gm.publickey, dp.address FROM GROUP_MEMBERS gm LEFT JOIN DISCOVERED_PEERS dp ON UPPER(gm.publickey)=UPPER(dp.publickey) WHERE gm.group_id='" + escapeSql(groupId) + "'";
            MDS.sql(memberSql, function (memberRes) {
                if (!memberRes.status || !memberRes.rows) return;
                for (var i = 0; i < memberRes.rows.length; i++) {
                    var row = memberRes.rows[i];
                    var memberPk = row.PUBLICKEY;
                    if (memberPk === myPubkey) continue;
                    var addr = row.ADDRESS;
                    var cleanAddr = addr ? addr.replace(/\s+/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "") : null;
                    var cmd = (cleanAddr && (cleanAddr.startsWith("Mx") || cleanAddr.startsWith("MX")))
                        ? "maxima action:send to:" + cleanAddr + " application:metachain-group data:" + hexData + " poll:false"
                        : "maxima action:send publickey:" + memberPk + " application:metachain-group data:" + hexData + " poll:false";
                    MDS.cmd(cmd);
                }
            });
        });
    });
}

/**
 * Requests history for ALL groups this node is a member of.
 * Called on startup and reconnect.
 */
function requestAllGroupsHistory() {
    MDS.log("🔄 [GROUP-SYNC] Startup sync for all groups...");
    MDS.sql("SELECT group_id FROM GROUPS", function (res) {
        if (!res.status || !res.rows || res.rows.length === 0) return;
        MDS.log("🔄 [GROUP-SYNC] Syncing " + res.rows.length + " group(s)...");
        for (var i = 0; i < res.rows.length; i++) {
            requestGroupHistoryFromSW(res.rows[i].GROUP_ID || res.rows[i].group_id);
        }
    });
}

function handleGroupMessage(pubkey, maxjson) {
    MDS.log("📨 [GROUP-MSG] Processing...");

    // Migration: Ensure propagated column exists
    var migrationSql = "ALTER TABLE GROUP_MESSAGES ADD COLUMN propagated INT DEFAULT 0";
    MDS.sql(migrationSql, function (migRes) {
        var safeGroupId = escapeSql(maxjson.groupId || "");
        var encoded = escapeSql(maxjson.message || "");
        var messageTimestamp = Number(maxjson.timestamp) || Date.now();
        var originalSender = escapeSql(maxjson.senderPublickey || pubkey);
        var safeSenderUsername = escapeSql(maxjson.senderUsername || "Unknown");
        var safeType = escapeSql(maxjson.type || "text");
        var safeFileData = escapeSql(maxjson.filedata || "");

        // 🚫 Check if the sender is banned from this group
        var banCheckSql = "SELECT * FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + originalSender + "')";
        MDS.sql(banCheckSql, function (banRes) {
            if (banRes.status && banRes.rows && banRes.rows.length > 0) {
                MDS.log("🚫 [GROUP-MSG] Discarding message from banned sender: " + originalSender.substring(0, 10));
                return;
            }
            processGroupMessage(safeGroupId, encoded, messageTimestamp, originalSender, safeSenderUsername, safeType, safeFileData, pubkey, maxjson);
        });
    });
}

function processGroupMessage(safeGroupId, encoded, messageTimestamp, originalSender, safeSenderUsername, safeType, safeFileData, pubkey, maxjson) {

    var incomingSeq = maxjson.seq ? parseInt(maxjson.seq) : 0;

    // Check for duplicates
    var checkSql = "SELECT id, propagated FROM GROUP_MESSAGES WHERE group_id='" + safeGroupId + "' AND sender_publickey='" + originalSender + "' AND date=" + messageTimestamp;

    MDS.sql(checkSql, function (checkRes) {
        var shouldPropagate = false;

        if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
            var row = checkRes.rows[0];
            var isPropagated = (row.PROPAGATED === 1 || row.propagated === 1);

            if (isPropagated) {
                MDS.log("ℹ️ [GROUP-MSG] Already propagated. Ignoring.");
                return;
            } else {
                MDS.log("⚠️ [GROUP-MSG] Exists but NOT propagated. Propagating now.");
                shouldPropagate = true;
                MDS.sql("UPDATE GROUP_MESSAGES SET propagated=1 WHERE id=" + row.ID);
            }
        } else {
            shouldPropagate = true;
            var groupMsgSql = "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated, sender_seq) VALUES "
                + "('" + safeGroupId + "','" + originalSender + "','" + safeSenderUsername + "','" + safeType + "','" + encoded + "','" + safeFileData + "'," + messageTimestamp + ", 0, 1, " + incomingSeq + ")";

            MDS.sql(groupMsgSql, function (res) {
                if (res.status) {
                    MDS.log("✅ [DB] Group message saved (propagated=1).");
                } else {
                    MDS.log("❌ [DB] Failed to save group message: " + res.error);
                    if (res.error && res.error.indexOf('propagated') !== -1) {
                        var retrySql = "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read) VALUES "
                            + "('" + safeGroupId + "','" + originalSender + "','" + safeSenderUsername + "','" + safeType + "','" + encoded + "','" + safeFileData + "'," + messageTimestamp + ", 0)";
                        MDS.sql(retrySql);
                    }
                }
            });
        }

        // GAP DETECTION: Check sequence numbers (only if sender includes seq)
        if (incomingSeq > 0) {
            var seqCheckSql = "SELECT last_seen_seq FROM GROUP_MSG_COUNTERS WHERE group_id='" + safeGroupId + "' AND sender_publickey='" + originalSender + "'";
            MDS.sql(seqCheckSql, function (seqRes) {
                var lastSeq = 0;
                var hasRow = seqRes.status && seqRes.rows && seqRes.rows.length > 0;
                if (hasRow) {
                    lastSeq = parseInt(seqRes.rows[0].LAST_SEEN_SEQ || 0);
                }

                if (lastSeq > 0 && incomingSeq > lastSeq + 1) {
                    var gapSize = incomingSeq - lastSeq - 1;
                    MDS.log("⚠️ [GAP-DETECT] Missing " + gapSize + " message(s) from " + originalSender.substring(0, 10) + " in group " + safeGroupId);
                    // Trigger history sync to fill the gap
                    requestGroupHistoryFromSW(safeGroupId);
                }

                // Update or insert last_seen_seq
                if (incomingSeq > lastSeq) {
                    if (hasRow) {
                        MDS.sql("UPDATE GROUP_MSG_COUNTERS SET last_seen_seq=" + incomingSeq + " WHERE group_id='" + safeGroupId + "' AND sender_publickey='" + originalSender + "'");
                    } else {
                        MDS.sql("INSERT INTO GROUP_MSG_COUNTERS (group_id, sender_publickey, last_seen_seq, my_next_seq) VALUES ('" + safeGroupId + "','" + originalSender + "'," + incomingSeq + ",1)");
                    }
                }
            });
        }

        if (shouldPropagate) {
            propagateGroupMessage(pubkey, maxjson);
        }
    });
}



function propagateGroupMessage(pubkey, maxjson) {
    MDS.log("🔄 [GROUP-MSG] Starting propagation...");

    var safeGroupId = escapeSql(maxjson.groupId || "");
    var membersSql = "SELECT * FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "'";
    MDS.sql(membersSql, function (memberRes) {
        if (!memberRes.status || !memberRes.rows) {
            MDS.log("❌ [GROUP-MSG] Failed to fetch members.");
            return;
        }

        var members = memberRes.rows;
        MDS.cmd("maxima", function (maximaRes) {
            var myPubkey = maximaRes.response.publickey;
            var jsonStr = JSON.stringify(maxjson);
            var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();
            var propagatedCount = 0;

            // Send to each member via DISCOVERED_PEERS address (no maxcontacts needed)
            var sendToMember = function (index) {
                if (index >= members.length) {
                    MDS.log("✅ [GROUP-MSG] Propagation complete. Sent to " + propagatedCount + " members.");
                    return;
                }

                var memberPubkey = members[index].PUBLICKEY;

                // Skip sender, original message sender, and ourselves
                if (memberPubkey === pubkey || memberPubkey === maxjson.senderPublickey || memberPubkey.toUpperCase() === myPubkey.toUpperCase()) {
                    sendToMember(index + 1);
                    return;
                }

                // Look up Mx address in DISCOVERED_PEERS
                var peerSql = "SELECT address FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + escapeSql(memberPubkey) + "') LIMIT 1";
                MDS.sql(peerSql, function (peerRes) {
                    if (peerRes.status && peerRes.rows && peerRes.rows.length > 0) {
                        var mxAddress = peerRes.rows[0].ADDRESS || peerRes.rows[0].address;
                        if (mxAddress) {
                            var cleanAddress = mxAddress.replace(/\s+/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "");
                            MDS.log("📤 [GROUP-MSG] Propagating to: " + memberPubkey.substring(0, 10));
                            MDS.cmd("maxima action:send to:" + cleanAddress + " application:metachain-group data:" + hexData + " poll:false");
                            propagatedCount++;
                        }
                    } else {
                        // Fallback: try by publickey directly (works if they are already a contact)
                        MDS.log("⚠️ [GROUP-MSG] No address for " + memberPubkey.substring(0, 10) + ", trying publickey fallback.");
                        MDS.cmd("maxima action:send publickey:" + memberPubkey + " application:metachain-group data:" + hexData + " poll:false");
                        propagatedCount++;
                    }
                    sendToMember(index + 1);
                });
            };

            sendToMember(0);
        });
    });
}

function handleGroupInvite(pubkey, maxjson) {
    MDS.log("📨 [GROUP-INVITE] Processing...");
    var safeGroupId = escapeSql(maxjson.groupId || "");
    var safeGroupName = escapeSql(maxjson.groupName || "");
    var safeCreatorPubkey = escapeSql(maxjson.creatorPublickey || pubkey || "");
    var safeDescription = escapeSql(maxjson.description || "");
    var safeTimestamp = Number(maxjson.timestamp) || Date.now();

    // 🚫 Check if WE (this node) are banned from this group
    MDS.cmd("maxima action:info", function (maximaRes) {
        var myPubkey = maximaRes.response.publickey;
        var checkBanSql = "SELECT * FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + myPubkey + "')";
        MDS.sql(checkBanSql, function (banRes) {
            if (banRes.status && banRes.rows && banRes.rows.length > 0) {
                MDS.log("🚫 [GROUP-INVITE] Ignoring invite: we are banned from group " + safeGroupId);
                return;
            }

            var createGroupSql = "INSERT INTO GROUPS (group_id, name, creator_publickey, created_date, description) VALUES "
                + "('" + safeGroupId + "','" + safeGroupName + "','" + safeCreatorPubkey + "'," + safeTimestamp + ",'" + safeDescription + "')";

            MDS.sql(createGroupSql, function (res) {
                MDS.log("✅ [GROUP-MGMT] Group created/exists");

                if (maxjson.members) {
                    var addMember = function (idx) {
                        if (idx >= maxjson.members.length) {
                            var creatorName = escapeSql(maxjson.creatorUsername || maxjson.senderUsername || "Someone");
                            var systemMsg = creatorName + " created the group";
                            var checkMsgSql = "SELECT id FROM GROUP_MESSAGES WHERE group_id='" + safeGroupId + "' AND type='system' AND message='" + systemMsg + "'";
                            MDS.sql(checkMsgSql, function (checkRes) {
                                if (checkRes.status && (!checkRes.rows || checkRes.rows.length === 0)) {
                                    var initialMsgSql = "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated) VALUES "
                                        + "('" + safeGroupId + "', '" + safeCreatorPubkey + "', '" + creatorName + "', 'system', '" + systemMsg + "', '', " + safeTimestamp + ", 0, 1)";
                                    MDS.sql(initialMsgSql);
                                }
                            });
                            return;
                        }
                        var m = maxjson.members[idx];
                        var role = m.role ? escapeSql(m.role) : ((m.publickey === safeCreatorPubkey) ? 'creator' : 'member');
                        var safeMemberPubkey = escapeSql(m.publickey || "");
                        var safeMemberUsername = escapeSql(m.username || "Unknown");

                        // Check ban before inserting
                        var checkMemberBanSql = "SELECT * FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + safeMemberPubkey + "')";
                        MDS.sql(checkMemberBanSql, function (memberBanRes) {
                            if (memberBanRes.status && memberBanRes.rows && memberBanRes.rows.length > 0) {
                                MDS.log("🚫 [GROUP-INVITE] Skipping banned member: " + safeMemberPubkey.substring(0, 10));
                                addMember(idx + 1);
                                return;
                            }

                            var addMemberSql = "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES "
                                + "('" + safeGroupId + "','" + safeMemberPubkey + "','" + safeMemberUsername + "'," + safeTimestamp + ",'" + role + "')";

                            MDS.sql(addMemberSql, function () {
                                // Seed DISCOVERED_PEERS with this member's Mx address if provided
                                if (m.address) {
                                    var safeMemberAddress = escapeSql(m.address);
                                    var delPeer = "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + safeMemberPubkey + "')";
                                    MDS.sql(delPeer, function () {
                                        var insPeer = "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" + safeMemberPubkey + "', '" + safeMemberAddress + "', 'GROUP_INVITE', '" + safeMemberUsername + "', " + safeTimestamp + ", '')";
                                        MDS.sql(insPeer, function () {
                                            addMember(idx + 1);
                                        });
                                    });
                                } else {
                                    addMember(idx + 1);
                                }
                            });
                        });
                    };

                    var processBans = function () {
                        if (maxjson.bannedMembers && maxjson.bannedMembers.length > 0) {
                            var addBan = function (bIdx) {
                                if (bIdx >= maxjson.bannedMembers.length) {
                                    addMember(0);
                                    return;
                                }
                                var b = maxjson.bannedMembers[bIdx];
                                var safeBanPubkey = escapeSql(b.publickey || "");
                                var safeBanUsername = escapeSql(b.username || "Unknown");
                                var safeBannedBy = escapeSql(b.banned_by || pubkey);
                                var safeBannedAt = Number(b.banned_at) || safeTimestamp;

                                var checkBanSql = "SELECT * FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + safeBanPubkey + "')";
                                MDS.sql(checkBanSql, function (checkBanRes) {
                                    if (checkBanRes.status && (!checkBanRes.rows || checkBanRes.rows.length === 0)) {
                                        var insertBanSql = "INSERT INTO GROUP_BANS (group_id, publickey, username, banned_by, banned_at) VALUES "
                                            + "('" + safeGroupId + "','" + safeBanPubkey + "','" + safeBanUsername + "','" + safeBannedBy + "'," + safeBannedAt + ")";
                                        MDS.sql(insertBanSql, function () {
                                            addBan(bIdx + 1);
                                        });
                                    } else {
                                        addBan(bIdx + 1);
                                    }
                                });
                            };
                            addBan(0);
                        } else {
                            addMember(0);
                        }
                    };
                    processBans();
                }
            });
        });
    });
}

function handleGroupMemberUpdate(pubkey, maxjson) {
    MDS.log("🔄 [GROUP-MEMBER] Update: " + maxjson.messageType);
    var safeGroupId = escapeSql(maxjson.groupId || "");
    var safeTimestamp = Number(maxjson.timestamp) || Date.now();
    var safeMemberPublickey = escapeSql(maxjson.memberPublickey || "");
    var safeMemberUsername = escapeSql(maxjson.memberUsername || "Unknown");

    if (maxjson.messageType === "group_member_added") {
        // 🚫 Block re-add if the member is banned
        var checkAddBanSql = "SELECT * FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + safeMemberPublickey + "')";
        MDS.sql(checkAddBanSql, function (addBanRes) {
            if (addBanRes.status && addBanRes.rows && addBanRes.rows.length > 0) {
                MDS.log("🚫 [GROUP-MEMBER] Blocked re-add of banned member: " + safeMemberPublickey.substring(0, 10));
                return;
            }
            var addMemberSql = "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES "
                + "('" + safeGroupId + "','" + safeMemberPublickey + "','" + safeMemberUsername + "'," + safeTimestamp + ",'member')";
            MDS.sql(addMemberSql, function () {
                // Seed DISCOVERED_PEERS with new member's Mx address so we can send messages to them
                if (maxjson.memberAddress) {
                    var safeMemberAddress = escapeSql(maxjson.memberAddress);
                    var now = Date.now();
                    var delPeer = "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + safeMemberPublickey + "')";
                    MDS.sql(delPeer, function () {
                        var insPeer = "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" + safeMemberPublickey + "', '" + safeMemberAddress + "', 'GROUP_MEMBER_ADDED', '" + safeMemberUsername + "', " + now + ", '')";
                        MDS.sql(insPeer, function () {
                            MDS.comms.solo(JSON.stringify({ type: "group_update", groupId: safeGroupId }));
                        });
                    });
                } else {
                    MDS.comms.solo(JSON.stringify({ type: "group_update", groupId: safeGroupId }));
                }
            });
        });
    } else {
        MDS.cmd("maxima", function (maximaRes) {
            var myPubkey = maximaRes.response.publickey;

            if (myPubkey === safeMemberPublickey) {
                // I have been kicked/banned! Delete the group completely so I don't see it anymore.
                MDS.sql("DELETE FROM GROUPS WHERE group_id='" + safeGroupId + "'", function () {
                    MDS.sql("DELETE FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "'", function () {
                        MDS.sql("DELETE FROM GROUP_MESSAGES WHERE group_id='" + safeGroupId + "'", function () {
                            MDS.sql("DELETE FROM GROUP_BANS WHERE group_id='" + safeGroupId + "'", function () {
                                MDS.comms.solo(JSON.stringify({ type: "group_update", groupId: safeGroupId }));
                            });
                        });
                    });
                });
            } else {
                var removeMemberSql = "DELETE FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + safeMemberPublickey + "')";
                MDS.sql(removeMemberSql, function () {
                    if (maxjson.senderPublickey && maxjson.senderPublickey !== maxjson.memberPublickey) {
                        var safeBannedBy = escapeSql(maxjson.senderPublickey);
                        var checkBanSql = "SELECT * FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + safeMemberPublickey + "')";
                        MDS.sql(checkBanSql, function (banRes) {
                            if (!banRes.status || !banRes.rows || banRes.rows.length === 0) {
                                var banSql = "INSERT INTO GROUP_BANS (group_id, publickey, username, banned_by, banned_at) VALUES ('" + safeGroupId + "', '" + safeMemberPublickey + "', '" + safeMemberUsername + "', '" + safeBannedBy + "', " + safeTimestamp + ")";
                                MDS.sql(banSql, function () {
                                    MDS.comms.solo(JSON.stringify({ type: "group_update", groupId: safeGroupId }));
                                });
                            } else {
                                MDS.comms.solo(JSON.stringify({ type: "group_update", groupId: safeGroupId }));
                            }
                        });
                    } else {
                        MDS.comms.solo(JSON.stringify({ type: "group_update", groupId: safeGroupId }));
                    }
                });
            }
        });
    }
}

function handleGroupMemberUnbanned(pubkey, maxjson) {
    MDS.log("🔄 [GROUP-UNBAN] Processing unban for " + (maxjson.memberPublickey ? maxjson.memberPublickey.substring(0, 10) : "unknown"));
    var safeGroupId = escapeSql(maxjson.groupId || "");
    var safeMemberPublickey = escapeSql(maxjson.memberPublickey || "");

    var sql = "DELETE FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + safeMemberPublickey + "')";
    MDS.sql(sql, function () {
        MDS.comms.solo(JSON.stringify({ type: "group_update", groupId: safeGroupId }));
    });
}

function handleGroupUpdateDetails(pubkey, maxjson) {
    MDS.log("🔄 [GROUP-UPDATE] Processing details request from " + pubkey.substring(0, 10));
    var safeGroupId = escapeSql(maxjson.groupId || "");
    var safeNewName = maxjson.newName ? escapeSql(maxjson.newName) : null;
    var safeNewDescription = maxjson.newDescription !== undefined && maxjson.newDescription !== null ? escapeSql(maxjson.newDescription) : null;

    // Security Check: Sender must be creator OR admin
    var checkSql = "SELECT role FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "' AND publickey='" + pubkey + "'";

    MDS.sql(checkSql, function (res) {
        if (!res.status || !res.rows || res.rows.length === 0) {
            MDS.log("⚠️ [GROUP-UPDATE] Group " + safeGroupId + " not found locally or sender is not a member.");
            return;
        }

        var senderRole = res.rows[0].ROLE || res.rows[0].role;

        if (senderRole !== 'creator' && senderRole !== 'admin') {
            MDS.log("❌ [GROUP-UPDATE] Unauthorized attempt. Sender (" + pubkey.substring(0, 10) + ") has role: " + senderRole);
            return;
        }

        var updates = [];
        if (safeNewName !== null) updates.push("name='" + safeNewName + "'");
        if (safeNewDescription !== null) updates.push("description='" + safeNewDescription + "'");

        if (updates.length === 0) return;

        // Sender authorized: Update the details
        var updateSql = "UPDATE GROUPS SET " + updates.join(", ") + " WHERE group_id='" + safeGroupId + "'";
        MDS.sql(updateSql, function (updateRes) {
            if (updateRes.status) {
                MDS.log("✅ [DB] Group details updated via broadcast");

                // Notify the frontend via MDS.comms.solo
                var soloMsg = {
                    type: "group_update",
                    groupId: maxjson.groupId
                };
                if (maxjson.newName !== undefined) soloMsg.name = maxjson.newName;
                if (maxjson.newDescription !== undefined) soloMsg.description = maxjson.newDescription;

                var msgStr = typeof soloMsg === "string" ? soloMsg : JSON.stringify(soloMsg);
                MDS.comms.solo(msgStr);
            } else {
                MDS.log("❌ [DB] Failed to update group details: " + updateRes.error);
            }
        });
    });
}

function handleGroupRoleUpdate(pubkey, maxjson) {
    MDS.log("🔄 [GROUP-ROLE] Processing role update request from " + pubkey.substring(0, 10));
    var safeGroupId = escapeSql(maxjson.groupId || "");
    var safeTargetPubkey = escapeSql(maxjson.targetPubkey || "");
    var safeNewRole = escapeSql(maxjson.newRole || "member"); // 'admin' or 'member'

    // 1. Check if the sender is an admin or creator
    var checkSenderSql = "SELECT role FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "' AND publickey='" + pubkey + "'";

    MDS.sql(checkSenderSql, function (resSender) {
        if (!resSender.status || !resSender.rows || resSender.rows.length === 0) {
            MDS.log("❌ [GROUP-ROLE] Unauthorized role update. Sender not in group.");
            return;
        }

        var senderRole = resSender.rows[0].ROLE || resSender.rows[0].role;
        if (senderRole !== 'creator' && senderRole !== 'admin') {
            MDS.log("❌ [GROUP-ROLE] Unauthorized role update. Sender role is: " + senderRole);
            return;
        }

        // 2. We can't change the creator's role explicitly (or demote them)
        var checkTargetSql = "SELECT role FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "' AND publickey='" + safeTargetPubkey + "'";
        MDS.sql(checkTargetSql, function (resTarget) {
            if (!resTarget.status || !resTarget.rows || resTarget.rows.length === 0) {
                MDS.log("⚠️ [GROUP-ROLE] Target user not found in group.");
                return;
            }

            var targetRole = resTarget.rows[0].ROLE || resTarget.rows[0].role;
            if (targetRole === 'creator') {
                MDS.log("❌ [GROUP-ROLE] Cannot change the role of the creator.");
                return;
            }

            // 3. Update the role
            var updateSql = "UPDATE GROUP_MEMBERS SET role='" + safeNewRole + "' WHERE group_id='" + safeGroupId + "' AND publickey='" + safeTargetPubkey + "'";
            MDS.sql(updateSql, function (updateRes) {
                if (updateRes.status) {
                    MDS.log("✅ [DB] Role for " + safeTargetPubkey.substring(0, 10) + " updated to " + safeNewRole);

                    // Notify the frontend via MDS.comms.solo
                    var soloMsg = {
                        type: "group_update",
                        groupId: safeGroupId
                    };

                    var msgStr = typeof soloMsg === "string" ? soloMsg : JSON.stringify(soloMsg);
                    MDS.comms.solo(msgStr);
                } else {
                    MDS.log("❌ [DB] Failed to update role: " + updateRes.error);
                }
            });
        });
    });
}

function handleGroupJoinRequestEvent(pubkey, maxjson) {
    try {
        MDS.log("🔄 [GROUP-JOIN] Processing event: " + maxjson.messageType + " from " + pubkey.substring(0, 10));
        var safeGroupId = escapeSql(maxjson.groupId || "");
        var safeTimestamp = Number(maxjson.timestamp) || Date.now();

        // 1. Resolve our public key in case the global didn't load yet
        if (typeof MY_MAXIMA_PK === 'undefined' || !MY_MAXIMA_PK || MY_MAXIMA_PK === "") {
            MDS.cmd("maxima", function (maxRes) {
                if (maxRes.status) {
                    if (typeof self !== 'undefined') {
                        self.MY_MAXIMA_PK = maxRes.response.publickey;
                    } else if (typeof globalThis !== 'undefined') {
                        globalThis.MY_MAXIMA_PK = maxRes.response.publickey;
                    }
                    var resolvedPk = maxRes.response.publickey;
                    MDS.log("🔑 [GROUP-JOIN] Recovered local Maxima PK.");
                    executeJoinRequestAuth(pubkey, maxjson, safeGroupId, safeTimestamp, resolvedPk);
                } else {
                    MDS.log("❌ [GROUP-JOIN] Failed to get local Maxima info");
                }
            });
        } else {
            executeJoinRequestAuth(pubkey, maxjson, safeGroupId, safeTimestamp, MY_MAXIMA_PK);
        }
    } catch (err) {
        MDS.log("🔥 [GROUP-JOIN] CRASH in handleGroupJoinRequestEvent: " + err.message);
    }
}

function executeJoinRequestAuth(pubkey, maxjson, safeGroupId, safeTimestamp, localPk) {
    try {
        // 2. Verify we are an admin/creator of this group. If not, ignore.
        var checkSenderSql = "SELECT role FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + localPk + "')";
        MDS.sql(checkSenderSql, function (resSender) {
            try {
                if (!resSender.status) {
                    MDS.log("❌ [GROUP-JOIN] SQL Error validating group membership: " + resSender.error);
                    return;
                }
                if (!resSender.rows || resSender.rows.length === 0) {
                    MDS.log("⚠️ [GROUP-JOIN] Ignored. We are not in group " + safeGroupId);
                    return;
                }
                var myRole = resSender.rows[0].ROLE || resSender.rows[0].role;
                if (myRole !== 'creator' && myRole !== 'admin') {
                    MDS.log("⚠️ [GROUP-JOIN] Ignored. We are not an admin/creator of group " + safeGroupId);
                    return;
                }

                // =========================================================
                // A) NEW REQUEST: from a regular user wanting to join
                // =========================================================
                if (maxjson.messageType === "group_join_request") {
                    var requesterPubkey = escapeSql(pubkey);
                    var requesterName = escapeSql(maxjson.requesterName || "Unknown");
                    var requesterAddress = escapeSql(maxjson.requesterAddress || ""); // Critical for routing back

                    // Check if already a member
                    var checkMemberSql = "SELECT * FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "' AND publickey='" + requesterPubkey + "'";
                    MDS.sql(checkMemberSql, function (memberRes) {
                        try {
                            if (memberRes.status && memberRes.rows && memberRes.rows.length > 0) {
                                MDS.log("ℹ️ [GROUP-JOIN] User already a member.");
                                return; // Already a member
                            }

                            // Check if banned
                            var checkBanSql = "SELECT * FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + requesterPubkey + "')";
                            MDS.sql(checkBanSql, function (banRes) {
                                try {
                                    if (banRes.status && banRes.rows && banRes.rows.length > 0) {
                                        MDS.log("🚫 [GROUP-JOIN] Discarding request from banned user.");
                                        return; // Banned
                                    }

                                    // Insert/Replace in GROUP_JOIN_REQUESTS
                                    var insertReqSql = "MERGE INTO GROUP_JOIN_REQUESTS (group_id, publickey, username, address, status, timestamp) KEY (group_id, publickey) VALUES " +
                                        "('" + safeGroupId + "', '" + requesterPubkey + "', '" + requesterName + "', '" + requesterAddress + "', 'pending', " + safeTimestamp + ")";

                                    // Helper: seed DISCOVERED_PEERS with requester address so propagation works without maxcontacts
                                    var seedRequesterPeer = function (onDone) {
                                        if (!requesterAddress) { onDone(); return; }
                                        var now = Date.now();
                                        var delPeer = "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + requesterPubkey + "')";
                                        MDS.sql(delPeer, function () {
                                            var insPeer = "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" + requesterPubkey + "', '" + requesterAddress + "', 'GROUP_JOIN', '" + requesterName + "', " + now + ", '')";
                                            MDS.sql(insPeer, function () { onDone(); });
                                        });
                                    };

                                    MDS.sql(insertReqSql, function (insertRes) {
                                        try {
                                            if (insertRes.status) {
                                                MDS.log("✅ [GROUP-JOIN] Request saved locally. Broadcasting to other admins.");
                                                seedRequesterPeer(function () {
                                                    // Tell the UI to update the requests badge/list
                                                    var soloMsg = { type: "group_join_requests_update", groupId: safeGroupId };
                                                    MDS.comms.solo(JSON.stringify(soloMsg));
                                                    // Broadcast to OTHER admins
                                                    broadcastJoinRequestToAdmins("group_join_request_propagated", safeGroupId, requesterPubkey, requesterName, requesterAddress, safeTimestamp);
                                                });
                                            } else {
                                                // If MERGE fails (older H2 db), try UPDATE then INSERT
                                                var updateSql = "UPDATE GROUP_JOIN_REQUESTS SET username='" + requesterName + "', address='" + requesterAddress + "', status='pending', timestamp=" + safeTimestamp + " WHERE group_id='" + safeGroupId + "' AND publickey='" + requesterPubkey + "'";
                                                MDS.sql(updateSql, function (upRes) {
                                                    try {
                                                        var afterSave = function () {
                                                            seedRequesterPeer(function () {
                                                                var soloMsg = { type: "group_join_requests_update", groupId: safeGroupId };
                                                                MDS.comms.solo(JSON.stringify(soloMsg));
                                                                broadcastJoinRequestToAdmins("group_join_request_propagated", safeGroupId, requesterPubkey, requesterName, requesterAddress, safeTimestamp);
                                                            });
                                                        };
                                                        if (upRes.status && !upRes.count) {
                                                            var backupInsert = "INSERT INTO GROUP_JOIN_REQUESTS (group_id, publickey, username, address, status, timestamp) VALUES ('" + safeGroupId + "', '" + requesterPubkey + "', '" + requesterName + "', '" + requesterAddress + "', 'pending', " + safeTimestamp + ")";
                                                            MDS.sql(backupInsert, function () { afterSave(); });
                                                        } else {
                                                            afterSave();
                                                        }
                                                    } catch (e) {
                                                        MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
                                                    }
                                                });
                                            }
                                        } catch (e) {
                                            MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
                                        }
                                    });
                                } catch (e) {
                                    MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
                                }
                            });
                        } catch (e) {
                            MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
                        }
                    });
                }

                // =========================================================
                // B) PROPAGATED REQUEST: Another admin received a request, syncing it to us
                // =========================================================
                else if (maxjson.messageType === "group_join_request_propagated") {
                    // Validate sender is an admin
                    var senderCheck = "SELECT role FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + escapeSql(pubkey) + "')";
                    MDS.sql(senderCheck, function (sRes) {
                        try {
                            if (!sRes.status || !sRes.rows || sRes.rows.length === 0) {
                                MDS.log("❌ [GROUP-JOIN] Propagated request ignored: sender " + pubkey.substring(0, 10) + " not found in group members.");
                                return;
                            }
                            var senderRole = sRes.rows[0].ROLE || sRes.rows[0].role;
                            if (senderRole !== 'admin' && senderRole !== 'creator') {
                                MDS.log("❌ [GROUP-JOIN] Propagated request ignored: sender role is " + senderRole + " (not admin/creator).");
                                return;
                            }

                            var requesterPubkey = escapeSql(maxjson.requesterPubkey);
                            var requesterName = escapeSql(maxjson.requesterName);
                            var requesterAddress = escapeSql(maxjson.requesterAddress);
                            var originalTimestamp = Number(maxjson.originalTimestamp) || safeTimestamp;

                            // Save locally
                            var updateSql = "UPDATE GROUP_JOIN_REQUESTS SET username='" + requesterName + "', address='" + requesterAddress + "', status='pending', timestamp=" + originalTimestamp + " WHERE group_id='" + safeGroupId + "' AND publickey='" + requesterPubkey + "'";
                            MDS.sql(updateSql, function (upRes) {
                                try {
                                    if (upRes.status && !upRes.count) {
                                        var backupInsert = "INSERT INTO GROUP_JOIN_REQUESTS (group_id, publickey, username, address, status, timestamp) VALUES ('" + safeGroupId + "', '" + requesterPubkey + "', '" + requesterName + "', '" + requesterAddress + "', 'pending', " + originalTimestamp + ")";
                                        MDS.sql(backupInsert, function () {
                                            MDS.log("✅ [GROUP-JOIN] Propagated request saved. Notifying UI.");
                                            MDS.comms.solo(JSON.stringify({ type: "group_join_requests_update", groupId: safeGroupId }));
                                        });
                                    } else {
                                        MDS.log("✅ [GROUP-JOIN] Propagated request updated. Notifying UI.");
                                        MDS.comms.solo(JSON.stringify({ type: "group_join_requests_update", groupId: safeGroupId }));
                                    }
                                } catch (e) {
                                    MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
                                }
                            });
                        } catch (e) {
                            MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
                        }
                    });
                }

                // =========================================================
                // C) RESOLVED REQUEST: Another admin Accepted/Denied it
                // =========================================================
                else if (maxjson.messageType === "group_join_request_resolved") {
                    // Validate sender is an admin
                    var senderCheck = "SELECT role FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "' AND UPPER(publickey)=UPPER('" + escapeSql(pubkey) + "')";
                    MDS.sql(senderCheck, function (sRes) {
                        try {
                            if (!sRes.status || !sRes.rows || sRes.rows.length === 0) {
                                MDS.log("❌ [GROUP-JOIN] Resolved request ignored: sender " + pubkey.substring(0, 10) + " not found in group members.");
                                return;
                            }
                            var senderRole = sRes.rows[0].ROLE || sRes.rows[0].role;
                            if (senderRole !== 'admin' && senderRole !== 'creator') {
                                MDS.log("❌ [GROUP-JOIN] Resolved request ignored: sender role is " + senderRole);
                                return;
                            }

                            var requesterPubkey = escapeSql(maxjson.requesterPubkey);
                            var resolutionStatus = escapeSql(maxjson.resolutionStatus); // 'approved' or 'denied'

                            // Delete or update the request locally so it disappears from UI
                            var resolveSql = "DELETE FROM GROUP_JOIN_REQUESTS WHERE group_id='" + safeGroupId + "' AND publickey='" + requesterPubkey + "'";
                            MDS.sql(resolveSql, function () {
                                MDS.comms.solo(JSON.stringify({ type: "group_join_requests_update", groupId: safeGroupId }));
                            });
                        } catch (e) {
                            MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
                        }
                    });
                }
            } catch (e) {
                MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
            }
        });
    } catch (e) {
        MDS.log("🔥 [GROUP-JOIN] Sync crash outside SQL: " + e.message);
    }
}

function broadcastJoinRequestToAdmins(msgType, groupId, reqPubkey, reqName, reqAddress, timestamp, resolutionStatus) {
    // Find all other admins/creators
    var sql = "SELECT * FROM GROUP_MEMBERS WHERE group_id='" + escapeSql(groupId) + "' AND (role='creator' OR role='admin')";
    MDS.sql(sql, function (res) {
        if (!res.status || !res.rows) return;

        var msg = {
            application: "metachain-group",
            messageType: msgType,
            groupId: groupId,
            requesterPubkey: reqPubkey,
            requesterName: reqName,
            requesterAddress: reqAddress,
            originalTimestamp: timestamp
        };

        if (resolutionStatus) {
            msg.resolutionStatus = resolutionStatus;
        }

        // Get maxcontacts to find routing info
        MDS.cmd("maxcontacts", function (contactRes) {
            var contacts = contactRes.response.contacts || [];
            var payloadStr = JSON.stringify(msg);
            var hexData = "0x" + utf8ToHex(payloadStr).toUpperCase();

            var sendToAdmin = function (index) {
                if (index >= res.rows.length) return;
                var adminPk = res.rows[index].PUBLICKEY || res.rows[index].publickey;

                if (adminPk.toUpperCase() === MY_MAXIMA_PK.toUpperCase()) {
                    sendToAdmin(index + 1);
                    return;
                }

                // Check if they are a contact
                var isContact = false;
                for (var j = 0; j < contacts.length; j++) {
                    if (contacts[j].publickey.toUpperCase() === adminPk.toUpperCase()) {
                        isContact = true;
                        break;
                    }
                }

                if (isContact) {
                    MDS.cmd("maxima action:send publickey:" + adminPk + " application:metachain-group data:" + hexData + " poll:false");
                    sendToAdmin(index + 1);
                } else {
                    // Look up in DISCOVERED_PEERS
                    var searchSql = "SELECT address FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + escapeSql(adminPk) + "') LIMIT 1";
                    MDS.sql(searchSql, function (peerRes) {
                        if (peerRes.status && peerRes.rows && peerRes.rows.length > 0) {
                            var mxAddress = peerRes.rows[0].ADDRESS || peerRes.rows[0].address;
                            if (mxAddress) {
                                // Clean the address
                                var cleanAddress = mxAddress.replace(/\s+/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "");
                                MDS.cmd("maxima action:send to:" + cleanAddress + " application:metachain-group data:" + hexData + " poll:false");
                            }
                        }
                        sendToAdmin(index + 1);
                    });
                }
            };
            sendToAdmin(0);
        });
    });
}
