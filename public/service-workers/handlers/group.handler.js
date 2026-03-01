/**
 * MetaChain Service Worker - Group Message Handler
 * Handles group messages, invites, member updates
 */

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
            var groupMsgSql = "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated) VALUES "
                + "('" + safeGroupId + "','" + originalSender + "','" + safeSenderUsername + "','" + safeType + "','" + encoded + "','" + safeFileData + "'," + messageTimestamp + ", 0, 1)";

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
        MDS.log("🔍 [GROUP-MSG] Found " + members.length + " members.");

        MDS.cmd("maxcontacts", function (contactRes) {
            if (!contactRes.status || !contactRes.response.contacts) {
                MDS.log("❌ [CONTACTS] Failed to fetch contacts.");
                return;
            }

            var contacts = contactRes.response.contacts;

            MDS.cmd("maxima", function (maximaRes) {
                var myPubkey = maximaRes.response.publickey;
                var propagatedCount = 0;

                for (var i = 0; i < members.length; i++) {
                    var memberPubkey = members[i].PUBLICKEY;

                    if (memberPubkey === pubkey || memberPubkey === maxjson.senderPublickey || memberPubkey === myPubkey) continue;

                    var isContact = false;
                    for (var j = 0; j < contacts.length; j++) {
                        if (contacts[j].publickey === memberPubkey) {
                            isContact = true;
                            break;
                        }
                    }

                    if (isContact) {
                        var jsonStr = JSON.stringify(maxjson);
                        var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                        MDS.log("📤 [GROUP-MSG] Propagating to: " + memberPubkey.substring(0, 10));
                        MDS.cmd("maxima action:send publickey:" + memberPubkey + " application:metachain-group data:" + hexData + " poll:false");
                        propagatedCount++;
                    }
                }
                MDS.log("✅ [GROUP-MSG] Propagation complete. Sent to " + propagatedCount + " contacts.");
            });
        });
    });
}

function handleGroupInvite(pubkey, maxjson) {
    MDS.log("📨 [GROUP-INVITE] Processing...");
    var safeGroupId = escapeSql(maxjson.groupId || "");
    var safeGroupName = escapeSql(maxjson.groupName || "");
    var safeCreatorPubkey = escapeSql(pubkey || "");
    var safeDescription = escapeSql(maxjson.description || "");
    var safeTimestamp = Number(maxjson.timestamp) || Date.now();

    // 🚫 Check if WE (this node) are banned from this group
    MDS.cmd("maxima action:info", function (maximaRes) {
        var myPubkey = maximaRes.response.publickey;
        var checkBanSql = "SELECT * FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND publickey='" + myPubkey + "'";
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
                        if (idx >= maxjson.members.length) return;
                        var m = maxjson.members[idx];
                        var role = (m.publickey === pubkey) ? 'creator' : 'member';
                        var safeMemberPubkey = escapeSql(m.publickey || "");
                        var safeMemberUsername = escapeSql(m.username || "Unknown");

                        // Check ban before inserting
                        var checkMemberBanSql = "SELECT * FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND publickey='" + safeMemberPubkey + "'";
                        MDS.sql(checkMemberBanSql, function (memberBanRes) {
                            if (memberBanRes.status && memberBanRes.rows && memberBanRes.rows.length > 0) {
                                MDS.log("🚫 [GROUP-INVITE] Skipping banned member: " + safeMemberPubkey.substring(0, 10));
                                addMember(idx + 1);
                                return;
                            }

                            var addMemberSql = "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES "
                                + "('" + safeGroupId + "','" + safeMemberPubkey + "','" + safeMemberUsername + "'," + safeTimestamp + ",'" + role + "')";

                            MDS.sql(addMemberSql, function () {
                                addMember(idx + 1);
                            });
                        });
                    };
                    addMember(0);
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
                MDS.comms.solo(JSON.stringify({ type: "group_update", groupId: safeGroupId }));
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
                var removeMemberSql = "DELETE FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "' AND publickey='" + safeMemberPublickey + "'";
                MDS.sql(removeMemberSql, function () {
                    if (maxjson.senderPublickey && maxjson.senderPublickey !== maxjson.memberPublickey) {
                        var safeBannedBy = escapeSql(maxjson.senderPublickey);
                        var checkBanSql = "SELECT * FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND publickey='" + safeMemberPublickey + "'";
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

    var sql = "DELETE FROM GROUP_BANS WHERE group_id='" + safeGroupId + "' AND publickey='" + safeMemberPublickey + "'";
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
