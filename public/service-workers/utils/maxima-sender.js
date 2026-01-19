/**
 * Maxima Message Sender - Service Worker Utility
 * Handles sending Maxima messages independently of frontend
 * Ported from messaging.service.ts
 * 
 * NOTE: Uses callbacks instead of async/await (MDS doesn't support async/await)
 */

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
                    from_address: myAddress
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

                // Determine send method (publickey vs address)
                var sendMessage = function (sendCmd) {
                    MDS.log("📡 [SW-MAXIMA] Sending via: " + sendCmd.substring(0, 80) + "...");
                    MDS.cmd(sendCmd, function (response) {
                        if (!response.status) {
                            // Check if it's a "No Contact found" error - try address resolution
                            if (response.error && response.error.indexOf("No Contact found") !== -1) {
                                MDS.log("⚠️ [SW-MAXIMA] Not in contacts, trying address resolution...");
                                resolveMaximaAddress(toPublicKey, function (err, mxAddress) {
                                    if (!err && mxAddress) {
                                        var retrySendCmd = "maxima action:send to:" + cleanMaximaAddress(mxAddress) + " application:metachain data:" + hexData + " poll:true";
                                        MDS.cmd(retrySendCmd, function (retryResponse) {
                                            if (!retryResponse.status) {
                                                callback("Retry failed: " + retryResponse.error);
                                            } else {
                                                MDS.log("✅ [SW-MAXIMA] Message sent via Mx address (non-contact)");
                                                callback(null, retryResponse);
                                            }
                                        });
                                    } else {
                                        callback("Could not resolve address for non-contact");
                                    }
                                });
                            } else {
                                callback(response.error || "Maxima send failed");
                            }
                        } else {
                            MDS.log("✅ [SW-MAXIMA] Message sent successfully");
                            callback(null, response);
                        }
                    });
                };

                if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
                    sendMessage("maxima action:send to:" + cleanMaximaAddress(toPublicKey) + " application:metachain data:" + hexData + " poll:true");
                } else if (toPublicKey.startsWith("0x")) {
                    // Try to resolve to Maxima address first
                    resolveMaximaAddress(toPublicKey, function (err, mxAddress) {
                        if (!err && mxAddress) {
                            MDS.log("🔍 [SW-MAXIMA] Resolved 0x to Mx address: " + mxAddress);
                            sendMessage("maxima action:send to:" + cleanMaximaAddress(mxAddress) + " application:metachain data:" + hexData + " poll:true");
                        } else {
                            sendMessage("maxima action:send publickey:" + toPublicKey + " application:metachain data:" + hexData + " poll:true");
                        }
                    });
                } else {
                    callback("Invalid recipient identifier: " + toPublicKey);
                }
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
        var sql = "SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='" + escapeSql(publicKey) + "' AND ADDRESS IS NOT NULL LIMIT 1";
        MDS.sql(sql, function (result) {
            if (result.status && result.rows && result.rows.length > 0) {
                var address = result.rows[0].ADDRESS;
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
 * Duplicated from chat.handler.js for robustness
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
