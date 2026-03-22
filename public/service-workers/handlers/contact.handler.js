/**
 * MetaChain Service Worker - Contact Request Handler
 * Handles chat contact requests and Maxima contact requests
 */

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
            var deleteSql = "DELETE FROM CONTACT_REQUESTS WHERE from_publickey='" + safeFrom + "' AND to_publickey='" + myPk + "'";
            MDS.sql(deleteSql, function () {
                var insertSql = "INSERT INTO CONTACT_REQUESTS(from_publickey, from_name, from_avatar, from_address, to_publickey, status, created_at, updated_at) "
                    + "VALUES('" + safeFrom + "', '" + safeName + "', '" + safeAvatar + "', '" + safeFromAddress + "', '" + myPk + "', 'pending', " + now + ", " + now + ")";

                MDS.sql(insertSql, function () {
                    MDS.log("✅ [CONTACTS] Request saved to database");
                });
            });

            // Insert system message
            var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
                + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Chat request received', '', 'received', 0, " + now + ")";
            MDS.sql(sysMsgSql);
        }
    });

    // Send delivery confirmation
    var confirmPayload = { type: "contact_request_received", timestamp: now };
    var confirmHex = "0x" + utf8ToHex(JSON.stringify(confirmPayload)).toUpperCase();
    MDS.cmd("maxima action:send publickey:" + pubkey + " application:metachain data:" + confirmHex + " poll:false");
}

function handleContactDeclined(pubkey) {
    MDS.log("🚫 [CONTACTS] Request declined by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var updateSql = "UPDATE CONTACT_REQUESTS SET status='declined', updated_at=" + now + " WHERE from_publickey='" + safeFrom + "' AND status='pending'";
    MDS.sql(updateSql, function () {
        MDS.log("✅ [CONTACTS] Updated request status to declined");
    });

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Chat request declined', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleContactCancelled(pubkey) {
    MDS.log("🚫 [CONTACTS] Request cancelled by sender " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var deleteSql = "DELETE FROM CONTACT_REQUESTS WHERE from_publickey='" + safeFrom + "' AND status='pending'";
    MDS.sql(deleteSql, function () {
        MDS.log("✅ [CONTACTS] Removed cancelled request");
    });

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Chat request cancelled', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
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
                "(from_publickey='" + myPk + "' AND to_publickey='" + safeFrom + "') OR " +
                "(from_publickey='" + safeFrom + "' AND to_publickey='" + myPk + "')";

            MDS.sql(checkSql, function (checkRes) {
                if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
                    // Exists -> Force update to accepted
                    var updateSql = "UPDATE CONTACT_REQUESTS SET status='accepted', updated_at=" + now + " "
                        + "WHERE (from_publickey='" + myPk + "' AND to_publickey='" + safeFrom + "') OR "
                        + "(from_publickey='" + safeFrom + "' AND to_publickey='" + myPk + "')";
                    MDS.sql(updateSql, function () {
                        MDS.log("✅ [CONTACTS] Updated request status to accepted");
                    });
                } else {
                    // Does not exist -> Insert new accepted record
                    var insertSql = "INSERT INTO CONTACT_REQUESTS (from_publickey, to_publickey, status, created_at, updated_at) "
                        + "VALUES ('" + myPk + "', '" + safeFrom + "', 'accepted', " + now + ", " + now + ")";
                    MDS.sql(insertSql, function () {
                        MDS.log("✅ [CONTACTS] Created new accepted request record");
                    });
                }
            });
        }
    });

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Chat request accepted', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
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

            var deleteSql = "DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE from_publickey='" + safeFrom + "' AND to_publickey='" + myPk + "'";
            MDS.sql(deleteSql, function () {
                var insertSql = "INSERT INTO MAXIMA_CONTACT_REQUESTS(from_publickey, from_name, to_publickey, status, created_at, updated_at) "
                    + "VALUES('" + safeFrom + "', '" + safeName + "', '" + myPk + "', 'pending', " + now + ", " + now + ")";

                MDS.sql(insertSql, function () {
                    MDS.log("✅ [MAXIMA CONTACT] Request saved");
                });
            });

            var sysMsg = "Maxima contact request received";
            var chatSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
                + "VALUES('" + safeName + "', '" + safeFrom + "', '" + safeName + "', 'system', '" + sysMsg + "', '', 'received', 0, " + now + ")";
            MDS.sql(chatSql);
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

    var updateSql = "UPDATE MAXIMA_CONTACT_REQUESTS SET status='accepted', updated_at=" + now + " WHERE to_publickey='" + safeFrom + "'";
    MDS.sql(updateSql, function () {
        MDS.log("✅ [MAXIMA CONTACT] Status updated");
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
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Maxima contact accepted', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleMaximaContactDeclined(pubkey) {
    MDS.log("🚫 [MAXIMA CONTACT] Request declined by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var updateSql = "UPDATE MAXIMA_CONTACT_REQUESTS SET status='declined', updated_at=" + now + " WHERE to_publickey='" + safeFrom + "'";
    MDS.sql(updateSql);

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Maxima contact declined', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleMaximaContactCancelled(pubkey) {
    MDS.log("🚫 [MAXIMA CONTACT] Request cancelled by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var deleteSql = "DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE from_publickey='" + safeFrom + "' AND status='pending'";
    MDS.sql(deleteSql);

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Maxima contact cancelled', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleMaximaContactRemoved(pubkey, maxjson) {
    MDS.log("🗑️ [MAXIMA CONTACT] Removed by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    // Insert system message
    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'Contact removed', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

// ============================================================================
// HANDLER FOR BLOCKING
// ============================================================================

function handleContactBlocked(pubkey) {
    MDS.log("🚫 [CONTACTS] Handling block from " + pubkey);
    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    // Set blocked_by_them flag
    var updateSql = "MERGE INTO CHAT_STATUS (publickey, blocked_by_them) KEY(publickey) VALUES('" + safeFrom + "', TRUE)";
    MDS.sql(updateSql);

    // Insert system message
    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'This user has blocked you', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleContactUnblocked(pubkey) {
    MDS.log("🔓 [CONTACTS] Handling unblock from " + pubkey);
    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    // Clear blocked_by_them flag
    var updateSql = "UPDATE CHAT_STATUS SET blocked_by_them=FALSE WHERE publickey='" + safeFrom + "'";
    MDS.sql(updateSql);

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', '" + safeFrom + "', 'System', 'system', 'This user has unblocked you', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}
