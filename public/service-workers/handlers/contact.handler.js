/**
 * MetaChain Service Worker - Contact Request Handler
 * Handles chat contact requests and Maxima contact requests
 */

function notifyChatListUpdateFromContacts(reason) {
    try {
        MDS.log("📣 [CONTACTS] Emitting CHAT_LIST_UPDATE (" + reason + ")");
        MDS.comms.solo("CHAT_LIST_UPDATE");
    } catch (err) {
        MDS.log("⚠️ [CONTACTS] Failed to emit CHAT_LIST_UPDATE: " + err);
    }
}

// ============================================================================
// CHAT CONTACT REQUESTS
// ============================================================================

function handleContactRequest(pubkey, maxjson) {
    MDS.log("📨 [CONTACTS] Request received from " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);
    var safeName = escapeSql(maxjson.name || "Unknown");
    var safeAvatar = escapeSql(maxjson.avatar || "");
    var safeFromAddress = escapeSql(maxjson.from_address || "");

    MDS.cmd("maxima action:info", function (infoRes) {
        if (infoRes.status && infoRes.response) {
            var myPk = escapeSql(infoRes.response.publickey);

            // Delete existing and insert fresh
            var deleteSql = "DELETE FROM CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('" + safeFrom + "') AND UPPER(to_publickey)=UPPER('" + myPk + "')";
            MDS.sql(deleteSql, function () {
                var insertSql = "INSERT INTO CONTACT_REQUESTS(from_publickey, from_name, from_avatar, from_address, to_publickey, status, created_at, updated_at) "
                    + "VALUES(UPPER('" + safeFrom + "'), '" + safeName + "', '" + safeAvatar + "', '" + safeFromAddress + "', UPPER('" + myPk + "'), 'pending', " + now + ", " + now + ")";

                MDS.sql(insertSql, function () {
                    MDS.log("✅ [CONTACTS] Request saved to database");
                    notifyChatListUpdateFromContacts("contact_request_saved");
                });
            });

            // Insert system message
            var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
                + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Chat request received', '', 'received', 0, " + now + ")";
            MDS.sql(sysMsgSql, function () {
                notifyChatListUpdateFromContacts("contact_request_message");
            });
        }
    });

    // Send delivery confirmation
    var confirmPayload = { type: "contact_request_received", timestamp: now };
    var confirmHex = "0x" + utf8ToHex(JSON.stringify(confirmPayload)).toUpperCase();
    smartSend(pubkey, "metachain", confirmHex, "CONTACTS-CONFIRM", false);
}

function handleContactRequestReceived(pubkey) {
    MDS.log("✅ [CONTACTS] Request delivery confirmed by " + pubkey);

    var safeFrom = escapeSql(pubkey);
    var updateSql = "UPDATE CHAT_MESSAGES SET state='delivered' WHERE UPPER(publickey)=UPPER('" + safeFrom + "') AND type='system' AND message='Chat request sent'";
    MDS.sql(updateSql, function(res) {
        if (res.status) {
            MDS.log("✅ [CONTACTS] Message state updated to delivered");
        }
    });
}

function handleContactDeclined(pubkey) {
    MDS.log("🚫 [CONTACTS] Request declined by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var updateSql = "UPDATE CONTACT_REQUESTS SET status='declined', updated_at=" + now + " WHERE UPPER(from_publickey)=UPPER('" + safeFrom + "') AND status='pending'";
    MDS.sql(updateSql, function () {
        MDS.log("✅ [CONTACTS] Updated request status to declined");
        notifyChatListUpdateFromContacts("contact_declined");
    });

    var updateReadSql = "UPDATE CHAT_MESSAGES SET state='read', read=1 WHERE UPPER(publickey)=UPPER('" + safeFrom + "') AND type='system'";
    MDS.sql(updateReadSql, function () {
        var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
            + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Chat request declined', '', 'read', 0, " + now + ")";
        MDS.sql(sysMsgSql, function () {
            var statusSql = "MERGE INTO CHAT_STATUS (publickey, last_opened) KEY(publickey) VALUES(UPPER('" + safeFrom + "'), " + now + ")";
            MDS.sql(statusSql, function() {
                notifyChatListUpdateFromContacts("contact_declined_message");
            });
        });
    });
}

function handleContactCancelled(pubkey) {
    MDS.log("🚫 [CONTACTS] Request cancelled by sender " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var deleteSql = "DELETE FROM CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('" + safeFrom + "') AND status='pending'";
    MDS.sql(deleteSql, function () {
        MDS.log("✅ [CONTACTS] Removed cancelled request");
        notifyChatListUpdateFromContacts("contact_cancelled");
    });

    var updateReadSql = "UPDATE CHAT_MESSAGES SET state='read', read=1 WHERE UPPER(publickey)=UPPER('" + safeFrom + "') AND type='system'";
    MDS.sql(updateReadSql, function () {
        var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
            + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Chat request cancelled', '', 'read', 0, " + now + ")";
        MDS.sql(sysMsgSql, function () {
            // Reset unread status for this chat item so the badge (bubble) disappears immediately
            var statusSql = "MERGE INTO CHAT_STATUS (publickey, last_opened) KEY(publickey) VALUES(UPPER('" + safeFrom + "'), " + now + ")";
            MDS.sql(statusSql, function() {
                MDS.log("✅ [CONTACTS] Reset unread status for cancelled request");
                notifyChatListUpdateFromContacts("contact_cancelled_message");
            });
        });
    });
}

function handleContactAccepted(pubkey, maxjson) {
    MDS.log("✅ [CONTACTS] Request accepted by " + pubkey);
    
    // Invalidate contact status cache
    if (typeof clearContactStatusCache === 'function') {
        clearContactStatusCache(pubkey);
    }

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    MDS.cmd("maxima action:info", function (infoRes) {
        if (infoRes.status && infoRes.response) {
            var myPk = escapeSql(infoRes.response.publickey);

            // Check if record exists (in either direction) -> Robust update
            var checkSql = "SELECT * FROM CONTACT_REQUESTS WHERE " +
                "(UPPER(from_publickey)=UPPER('" + myPk + "') AND UPPER(to_publickey)=UPPER('" + safeFrom + "')) OR " +
                "(UPPER(from_publickey)=UPPER('" + safeFrom + "') AND UPPER(to_publickey)=UPPER('" + myPk + "'))";

            MDS.sql(checkSql, function (checkRes) {
                if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
                    // Exists -> Force update to accepted
                    var updateSql = "UPDATE CONTACT_REQUESTS SET status='accepted', updated_at=" + now + " "
                        + "WHERE (UPPER(from_publickey)=UPPER('" + myPk + "') AND UPPER(to_publickey)=UPPER('" + safeFrom + "')) OR "
                        + "(UPPER(from_publickey)=UPPER('" + safeFrom + "') AND UPPER(to_publickey)=UPPER('" + myPk + "'))";
                    MDS.sql(updateSql, function () {
                        MDS.log("✅ [CONTACTS] Updated request status to accepted");
                        notifyChatListUpdateFromContacts("contact_accepted");
                    });
                } else {
                    // Does not exist -> Insert new accepted record
                    var insertSql = "INSERT INTO CONTACT_REQUESTS (from_publickey, to_publickey, status, created_at, updated_at) "
                        + "VALUES (UPPER('" + myPk + "'), UPPER('" + safeFrom + "'), 'accepted', " + now + ", " + now + ")";
                    MDS.sql(insertSql, function () {
                        MDS.log("✅ [CONTACTS] Created new accepted request record");
                        notifyChatListUpdateFromContacts("contact_accepted_inserted");
                    });
                }
            });
        }
    });

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Chat request accepted', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql, function () {
        notifyChatListUpdateFromContacts("contact_accepted_message");
    });
}

// ============================================================================
// MAXIMA CONTACT REQUESTS
// ============================================================================

function handleMaximaContactRequest(pubkey, maxjson) {
    MDS.log("📨 [MAXIMA CONTACT] Request received from " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);
    var safeName = escapeSql(maxjson.name || "Unknown");

    MDS.cmd("maxima action:info", function (infoRes) {
        if (infoRes.status && infoRes.response) {
            var myPk = escapeSql(infoRes.response.publickey);

            var deleteSql = "DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('" + safeFrom + "') AND UPPER(to_publickey)=UPPER('" + myPk + "')";
            MDS.sql(deleteSql, function () {
                var insertSql = "INSERT INTO MAXIMA_CONTACT_REQUESTS(from_publickey, from_name, to_publickey, status, created_at, updated_at) "
                    + "VALUES(UPPER('" + safeFrom + "'), '" + safeName + "', UPPER('" + myPk + "'), 'pending', " + now + ", " + now + ")";

                MDS.sql(insertSql, function () {
                    MDS.log("✅ [MAXIMA CONTACT] Request saved");
                    notifyChatListUpdateFromContacts("maxima_contact_request_saved");
                });
            });

            var sysMsg = "Maxima contact request received";
            var chatSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
                + "VALUES('" + safeName + "', UPPER('" + safeFrom + "'), '" + safeName + "', 'system', '" + sysMsg + "', '', 'received', 0, " + now + ")";
            MDS.sql(chatSql, function () {
                notifyChatListUpdateFromContacts("maxima_contact_request_message");
            });
        }
    });
}

function handleMaximaContactAccepted(pubkey, maxjson) {
    MDS.log("✅ [MAXIMA CONTACT] Request accepted by " + pubkey);

    // Invalidate contact status cache
    if (typeof clearContactStatusCache === 'function') {
        clearContactStatusCache(pubkey);
    }

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var updateSql = "UPDATE MAXIMA_CONTACT_REQUESTS SET status='accepted', updated_at=" + now + " WHERE UPPER(to_publickey)=UPPER('" + safeFrom + "')";
    MDS.sql(updateSql, function () {
        MDS.log("✅ [MAXIMA CONTACT] Status updated");
        notifyChatListUpdateFromContacts("maxima_contact_accepted");
    });

    // Try to add to contacts if available
    MDS.cmd("maxcontacts action:list", function (res) {
        if (res.status && res.response && res.response.contacts) {
            var contacts = res.response.contacts;
            for (var i = 0; i < contacts.length; i++) {
                if (contacts[i].publickey === pubkey && contacts[i].currentaddress) {
                    MDS.cmd("maxcontacts action:add contact:" + contacts[i].currentaddress, function () {
                        MDS.log("✅ [MAXIMA CONTACT] Added to maxcontacts");
                    });
                    break;
                }
            }
        }
    });

    // Add from_address if provided
    // Guarded by type check to prevent accidental maxcontacts additions if routing fails
    if (maxjson.type === 'maxima_contact_accepted' && maxjson.from_address) {
        MDS.cmd("maxcontacts action:add contact:" + maxjson.from_address, function () {
            MDS.log("✅ [MAXIMA CONTACT] Added via from_address");
        });
    }

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Maxima contact accepted', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql, function () {
        notifyChatListUpdateFromContacts("maxima_contact_accepted_message");
    });
}

function handleMaximaContactDeclined(pubkey) {
    MDS.log("🚫 [MAXIMA CONTACT] Request declined by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var updateSql = "UPDATE MAXIMA_CONTACT_REQUESTS SET status='declined', updated_at=" + now + " WHERE UPPER(to_publickey)=UPPER('" + safeFrom + "')";
    MDS.sql(updateSql, function () {
        notifyChatListUpdateFromContacts("maxima_contact_declined");
    });

    var updateReadSql = "UPDATE CHAT_MESSAGES SET state='read', read=1 WHERE UPPER(publickey)=UPPER('" + safeFrom + "') AND type='system'";
    MDS.sql(updateReadSql, function () {
        var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
            + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Maxima contact declined', '', 'read', 0, " + now + ")";
        MDS.sql(sysMsgSql, function () {
            var statusSql = "MERGE INTO CHAT_STATUS (publickey, last_opened) KEY(publickey) VALUES(UPPER('" + safeFrom + "'), " + now + ")";
            MDS.sql(statusSql, function() {
                notifyChatListUpdateFromContacts("maxima_contact_declined_message");
            });
        });
    });
}

function handleMaximaContactCancelled(pubkey) {
    MDS.log("🚫 [MAXIMA CONTACT] Request cancelled by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var deleteSql = "DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('" + safeFrom + "') AND status='pending'";
    MDS.sql(deleteSql, function () {
        notifyChatListUpdateFromContacts("maxima_contact_cancelled");
    });

    var updateReadSql = "UPDATE CHAT_MESSAGES SET state='read', read=1 WHERE UPPER(publickey)=UPPER('" + safeFrom + "') AND type='system'";
    MDS.sql(updateReadSql, function () {
        var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
            + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Maxima contact cancelled', '', 'read', 0, " + now + ")";
        MDS.sql(sysMsgSql, function () {
            // Reset unread status for this chat item so the badge (bubble) disappears immediately
            var statusSql = "MERGE INTO CHAT_STATUS (publickey, last_opened) KEY(publickey) VALUES(UPPER('" + safeFrom + "'), " + now + ")";
            MDS.sql(statusSql, function() {
                MDS.log("✅ [MAXIMA CONTACT] Reset unread status for cancelled request");
                notifyChatListUpdateFromContacts("maxima_contact_cancelled_message");
            });
        });
    });
}

function handleMaximaContactRemoved(pubkey, maxjson) {
    MDS.log("🗑️ [MAXIMA CONTACT] Removed by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var deleteMaximaSql = "DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('" + safeFrom + "') OR UPPER(to_publickey)=UPPER('" + safeFrom + "')";
    MDS.sql(deleteMaximaSql, function () {
        var deleteContactSql = "DELETE FROM CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('" + safeFrom + "') OR UPPER(to_publickey)=UPPER('" + safeFrom + "')";
        MDS.sql(deleteContactSql, function() {
            MDS.log("✅ [MAXIMA CONTACT] Local request tables cleared on removal");
            notifyChatListUpdateFromContacts("maxima_contact_removed");
        });
    });

    // Remove from maxcontacts just in case
    MDS.cmd("maxcontacts action:remove publickey:" + pubkey, function(res) {
        MDS.log("✅ [MAXIMA CONTACT] Attempted maxcontacts removal: " + res.status);
    });

    var updateReadSql = "UPDATE CHAT_MESSAGES SET state='read', read=1 WHERE UPPER(publickey)=UPPER('" + safeFrom + "') AND type='system'";
    MDS.sql(updateReadSql, function () {
        // Insert system message
        var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
            + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Contact removed', '', 'read', 0, " + now + ")";
        MDS.sql(sysMsgSql, function () {
            var statusSql = "MERGE INTO CHAT_STATUS (publickey, last_opened) KEY(publickey) VALUES(UPPER('" + safeFrom + "'), " + now + ")";
            MDS.sql(statusSql, function() {
                notifyChatListUpdateFromContacts("maxima_contact_removed_message");
            });
        });
    });
}

// ============================================================================
// HANDLER FOR BLOCKING
// ============================================================================

function handleContactBlocked(pubkey) {
    MDS.log("🚫 [CONTACTS] Handling block from " + pubkey);
    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    // Set blocked_by_them flag
    var updateSql = "MERGE INTO CHAT_STATUS (publickey, blocked_by_them) KEY(publickey) VALUES(UPPER('" + safeFrom + "'), TRUE)";
    MDS.sql(updateSql);

    // Insert system message
    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'This user has blocked you', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleContactUnblocked(pubkey) {
    MDS.log("🔓 [CONTACTS] Handling unblock from " + pubkey);
    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    // Clear blocked_by_them flag
    var updateSql = "UPDATE CHAT_STATUS SET blocked_by_them=FALSE WHERE UPPER(publickey)=UPPER('" + safeFrom + "')";
    MDS.sql(updateSql);

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'This user has unblocked you', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}
