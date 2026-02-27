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

                var addMemberSql = "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES "
                    + "('" + safeGroupId + "','" + safeMemberPubkey + "','" + safeMemberUsername + "'," + safeTimestamp + ",'" + role + "')";

                MDS.sql(addMemberSql, function () {
                    addMember(idx + 1);
                });
            };
            addMember(0);
        }
    });
}

function handleGroupMemberUpdate(pubkey, maxjson) {
    MDS.log("🔄 [GROUP-MEMBER] Update: " + maxjson.messageType);
    var safeGroupId = escapeSql(maxjson.groupId || "");
    var safeTimestamp = Number(maxjson.timestamp) || Date.now();
    var safeMemberPublickey = escapeSql(maxjson.memberPublickey || "");
    var safeMemberUsername = escapeSql(maxjson.memberUsername || "Unknown");

    if (maxjson.messageType === "group_member_added") {
        var addMemberSql = "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES "
            + "('" + safeGroupId + "','" + safeMemberPublickey + "','" + safeMemberUsername + "'," + safeTimestamp + ",'member')";
        MDS.sql(addMemberSql);
    } else {
        var removeMemberSql = "DELETE FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "' AND publickey='" + safeMemberPublickey + "'";
        MDS.sql(removeMemberSql);
    }
}
