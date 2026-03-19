/**
 * Maxima Message Sender - Service Worker Utility
 * Handles sending Maxima messages independently of frontend
 * Ported from messaging.service.ts
 * 
 * NOTE: Uses callbacks instead of async/await (MDS doesn't support async/await)
 */

var STRICT_SERIAL_PROTOCOL = true; // [TOGGLE] Set to false to re-enable Concurrent Dual-send

/**
 * Standardized Sending Helper (Available to all handlers)
 * Default: Dual-send (PublicKey AND Maxima Address) for maximum reliability.
 * Optional: exclusive=true sends to Address (if found) OR PK, but not both.
 */
function resolveAndSend(pubkey, hexData, logTag, usePoll, exclusive, callback) {
    var pollStr = usePoll ? " poll:true" : " poll:false";
    var startTime = Date.now();

    // Clean key (lowercase for casing drift)
    var safeKey = (pubkey || "").toLowerCase();
    var sqlKey = safeKey.replace(/'/g, "''");

    var peerSql = "SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='" + sqlKey + "' AND ADDRESS IS NOT NULL LIMIT 1";

    try {
        MDS.sql(peerSql, function (peerRes) {
            var sqlTime = Date.now();
            var mxAddress = null;

            if (peerRes && peerRes.status && peerRes.rows && peerRes.rows.length > 0) {
                var rawMx = peerRes.rows[0].ADDRESS || peerRes.rows[0].address;
                mxAddress = rawMx ? cleanMaximaAddress(rawMx) : null;
            }

            var hasMx = !!(mxAddress && (mxAddress.startsWith('Mx') || mxAddress.startsWith('MX')));

            // SAFETY CHECK: If payload is large, force exclusive mode (no dual-send)
            // 100,000 chars is ~50KB. Large enough for profile/chat, small enough for history/files.
            var isPayloadLarge = hexData.length > 100000;
            var forceExclusive = exclusive || isPayloadLarge;

            if (isPayloadLarge) {
                MDS.log("⚠️ [" + logTag + "] Payload large (" + hexData.length + " chars). Forcing exclusive transport.");
            }

            // --- STRICT SERIAL PROTOCOL PATH ---
            if (STRICT_SERIAL_PROTOCOL) {
                var bestCmd = null;
                var fallbackCmd = null;

                if (hasMx) {
                    bestCmd = 'maxima action:send to:' + mxAddress + ' application:metachain data:' + hexData + pollStr;
                    fallbackCmd = "maxima action:send publickey:" + safeKey + " application:metachain data:" + hexData + pollStr;
                } else {
                    bestCmd = "maxima action:send publickey:" + safeKey + " application:metachain data:" + hexData + pollStr;
                }

                MDS.log("📡 [" + logTag + "-SERIAL] Attempting best transport...");
                MDS.cmd(bestCmd, function (res) {
                    if (res.status) {
                        MDS.log("✅ [" + logTag + "-SERIAL] Success.");
                        if (callback) callback(null, res);
                    } else if (res.error && res.error.indexOf("No Contact found") !== -1 && fallbackCmd) {
                        MDS.log("⚠️ [" + logTag + "-SERIAL] No Contact found. Attempting fallback...");
                        MDS.cmd(fallbackCmd, function (fallbackRes) {
                            if (fallbackRes.status) {
                                MDS.log("✅ [" + logTag + "-SERIAL] Fallback success.");
                                if (callback) callback(null, fallbackRes);
                            } else {
                                MDS.log("❌ [" + logTag + "-SERIAL] Fallback failed: " + (fallbackRes.error || "unknown"));
                                if (callback) callback(fallbackRes.error || "fallback failed");
                            }
                        });
                    } else {
                        MDS.log("❌ [" + logTag + "-SERIAL] Failed: " + (res.error || "unknown"));
                        if (callback) callback(res.error || "serial send failed");
                    }
                });
                return;
            }

            // --- LEGACY CONCURRENT DUAL-SEND PATH ---
            // If exclusive and we have Mx, only send to Mx
            if (forceExclusive && hasMx) {
                var mxCmd = 'maxima action:send to:' + mxAddress + ' application:metachain data:' + hexData + pollStr;
                MDS.cmd(mxCmd, function (mxRes) {
                   if (mxRes.status) {
                       MDS.log("✅ [" + logTag + "-EXCL] Sent to Mx " + mxAddress.substring(0, 15) + "...");
                       if (callback) callback(null, mxRes);
                   } else {
                       MDS.log("⚠️ [" + logTag + "-EXCL] Failed Mx send to " + mxAddress.substring(0, 15) + "... : " + (mxRes.error || "unknown"));
                       if (callback) callback(mxRes.error || "exclusive mx failed");
                   }
                });
                return;
            }

            // Normal Dual-send (Standard path)
            var pkCmd = "maxima action:send publickey:" + safeKey + " application:metachain data:" + hexData + pollStr;
            var mxCmd = hasMx ? ('maxima action:send to:' + mxAddress + ' application:metachain data:' + hexData + pollStr) : null;

            var pkFinished = false;
            var mxFinished = !hasMx;
            var finalRes = null;
            var finalErr = null;

            var checkDone = function(err, res, type) {
                if (!err && res && res.status) {
                    if (!finalRes) {
                        finalRes = res;
                        if (callback) {
                            var cb = callback;
                            callback = null; // Prevent double callback
                            cb(null, res);
                        }
                    }
                } else {
                    finalErr = err || (res ? res.error : "unknown error");
                }

                if (type === 'PK') pkFinished = true;
                if (type === 'MX') mxFinished = true;

                if (pkFinished && mxFinished && !finalRes) {
                    if (callback) {
                        var cb = callback;
                        callback = null;
                        cb(finalErr, null);
                    }
                }
            };

            MDS.cmd(pkCmd, function (pkRes) {
                var endTime = Date.now();
                if (pkRes.status) {
                    MDS.log("✅ [" + logTag + "] Sent to PK " + safeKey.substring(0, 10) + " (SQL: " + (sqlTime - startTime) + "ms, total: " + (endTime - startTime) + "ms)");
                    checkDone(null, pkRes, 'PK');
                } else {
                    MDS.log("⚠️ [" + logTag + "] Failed PK send to " + safeKey.substring(0, 10) + ": " + (pkRes.error || "no contact") + " (Total: " + (endTime - startTime) + "ms)");
                    checkDone(pkRes.error, pkRes, 'PK');
                }
            });

            if (hasMx) {
                MDS.cmd(mxCmd, function (mxRes) {
                   if (mxRes.status) {
                       MDS.log("✅ [" + logTag + "] Sent to Mx " + mxAddress.substring(0, 15) + "...");
                       checkDone(null, mxRes, 'MX');
                   } else {
                       MDS.log("⚠️ [" + logTag + "] Failed Mx send to " + mxAddress.substring(0, 15) + "... : " + (mxRes.error || "unknown"));
                       checkDone(mxRes.error, mxRes, 'MX');
                   }
                });
            }
        });
    } catch (err) {
        MDS.log("❌ [" + logTag + "] Critical error in resolveAndSend: " + err);
        if (callback) callback(err);
    }
}


/**
 * Send a Maxima message
 * @param {string} toPublicKey - Recipient's public key (0x...) or Maxima address (Mx...)
 * @param {string} type - Message type ('text', 'charm', 'token', etc.)
 * @param {object} messageData - Message content and metadata
 * @param {object} context - Additional context (senderName, timestamp, etc.)
 * @param {function} callback - Callback function(error, result)
 */
function sendMaximaMessage(toPublicKey, type, messageData, context, callback) {
    if (!callback && typeof context === 'function') {
        callback = context;
        context = {};
    }
    context = context || {};

    try {
        MDS.log("📤 [SW-MAXIMA] Preparing to send " + type + " to " + toPublicKey.substring(0, 10) + "...");

        // Get sender info
        MDS.cmd("maxima action:info", function (myInfo) {
            if (!myInfo.status) {
                callback("Failed to get Maxima info");
                return;
            }

            var myAddress = myInfo.response.contact;

            // Try to get avatar from keypair
            MDS.cmd("keypair action:get key:profile_avatar", function (avatarRes) {
                var myAvatar = "";
                if (avatarRes.status && avatarRes.value) {
                    myAvatar = avatarRes.value;
                }

                // Construct payload
                var payload = {
                    message: messageData.message || "",
                    type: type,
                    username: context.senderName || "Me",
                    filedata: messageData.filedata || "",
                    timestamp: context.timestamp || Date.now(),
                    avatar: myAvatar,
                    from_address: myAddress,
                    customid: generateUUID()
                };

                // Add type-specific fields
                if (type === "charm" && messageData.amount) {
                    payload.amount = messageData.amount;
                }

                if (context.txpowid) {
                    payload.txpowid = context.txpowid;
                }

                // Convert to hex
                var jsonStr = JSON.stringify(payload);
                var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                MDS.log("📦 [SW-MAXIMA] Payload: " + jsonStr.substring(0, 100) + "...");

                // Unified Send Path: resolveAndSend handles concurrent dual-send (PK + Mx)
                // This eliminates the "wait for PK failure" delay for non-contacts.
                resolveAndSend(toPublicKey, hexData, "SW-MAXIMA", false, false, function(err, res) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null, res);
                    }
                });
            });
        });

    } catch (err) {
        MDS.log("❌ [SW-MAXIMA] Error sending message: " + err);
        callback(err);
    }
}

/**
 * Resolve a public key (0x...) to a Maxima address (Mx...)
 * @param {string} publicKey - Public key to resolve
 * @param {function} callback - Callback function(error, address)
 */
function resolveMaximaAddress(publicKey, callback) {
    if (!publicKey.startsWith('0x')) {
        callback(null, null);
        return;
    }

    try {
        // Check DISCOVERED_PEERS table
        var sql = "SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='" + (publicKey || "").toLowerCase().replace(/'/g, "''") + "' AND ADDRESS IS NOT NULL LIMIT 1";
        MDS.sql(sql, function (result) {
            if (result.status && result.rows && result.rows.length > 0) {
                var address = result.rows[0].ADDRESS || result.rows[0].address;
                if (address) address = cleanMaximaAddress(address);
                if (address && (address.startsWith('Mx') || address.startsWith('MX'))) {
                    callback(null, address);
                    return;
                }
            }
            callback(null, null);
        });
    } catch (e) {
        MDS.log("⚠️ [SW-MAXIMA] Error resolving address: " + e);
        callback(e, null);
    }
}

/**
 * Send a charm message (token transfer + charm notification)
 * @param {string} toPublicKey - Recipient's public key
 * @param {string} charmId - Charm identifier
 * @param {number} amount - Amount of tokens
 * @param {object} context - Additional context (senderName, timestamp, txpowid)
 * @param {function} callback - Callback function(error, result)
 */
function sendCharmMessage(toPublicKey, charmId, amount, context, callback) {
    if (!callback && typeof context === 'function') {
        callback = context;
        context = {};
    }

    sendMaximaMessage(toPublicKey, "charm", {
        message: charmId,
        amount: amount
    }, context, callback);
}

/**
 * Send a token transfer message
 * @param {string} toPublicKey - Recipient's public key
 * @param {object} tokenData - Token transfer data {amount, tokenName}
 * @param {object} context - Additional context (senderName, timestamp, txpowid)
 * @param {function} callback - Callback function(error, result)
 */
function sendTokenMessage(toPublicKey, tokenData, context, callback) {
    if (!callback && typeof context === 'function') {
        callback = context;
        context = {};
    }

    sendMaximaMessage(toPublicKey, "token", {
        message: JSON.stringify(tokenData)
    }, context, callback);
}

/**
 * Helper to clean Maxima Address specifically for the port issue
 */
function cleanMaximaAddress(addr) {
    if (!addr) return "";

    // 1. Basic trim
    var s = String(addr).trim();

    // 2. CRITICAL: Remove ALL whitespace first to prevent Java NumberFormatException
    s = s.replace(/\s+/g, "");

    // 3. Split by Last Colon (Host:Port)
    var idx = s.lastIndexOf(":");

    if (idx !== -1) {
        var base = s.substring(0, idx);
        var port = s.substring(idx + 1);

        // 4. AGGRESSIVE CLEANING
        // Remove all whitespace and invalid chars from base
        // Allow: a-z A-Z 0-9 @ . - _ 
        var cleanBase = base.replace(/[^a-zA-Z0-9@._-]/g, "");

        // Remove everything except numbers from port
        var cleanPort = port.replace(/[^0-9]/g, "");

        if (cleanBase && cleanPort) {
            return cleanBase + ":" + cleanPort;
        }
    }

    // Fallback: Just remove all whitespace and invalid chars
    return s.replace(/\s/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "");
}

/**
 * UUID Generator
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
