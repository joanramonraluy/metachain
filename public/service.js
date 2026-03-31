/**
 * MetaChain Service Worker - Utilities
 * Shared functions and global variables for all handlers
 */

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

var LAST_GOSSIP = 0;
var BEACON_INTERVAL = 60000; // 1 minute
var MY_MAXIMA_PK = "";
var BEACON_CACHE = {};
var GOSSIP_INTERVAL = 30000; // 30 seconds (overridable via keypair discovery_interval, in seconds)
var DISCOVERY_LIMIT = 5;    // peers per gossip cycle (overridable via keypair discovery_limit)
var LAST_BEACON_TIME = 0;

// ============================================================================
// HEX/UTF8 CONVERSION UTILITIES
// ============================================================================

/**
 * Convert HEX to UTF8 - Full UTF-8 Variant for MAXIMA Messages
 * Properly decodes multi-byte characters (català, emojis, etc.)
 */
function hexToUtf8(hexStr) {
    hexStr = hexStr.replace(/\s+/g, '').replace(/^0x/i, '');
    var bytes = [];
    for (var i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }

    var str = '';
    var i = 0;
    while (i < bytes.length) {
        var byte1 = bytes[i++];
        if (byte1 < 0x80) {
            str += String.fromCharCode(byte1);
        } else if (byte1 >= 0xC0 && byte1 < 0xE0) {
            var byte2 = bytes[i++];
            var codePoint = ((byte1 & 0x1F) << 6) | (byte2 & 0x3F);
            str += String.fromCharCode(codePoint);
        } else if (byte1 >= 0xE0 && byte1 < 0xF0) {
            var byte2 = bytes[i++];
            var byte3 = bytes[i++];
            var codePoint = ((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F);
            str += String.fromCharCode(codePoint);
        } else if (byte1 >= 0xF0 && byte1 < 0xF8) {
            var byte2 = bytes[i++];
            var byte3 = bytes[i++];
            var byte4 = bytes[i++];
            var codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
            codePoint -= 0x10000;
            str += String.fromCharCode(0xD800 + (codePoint >> 10));
            str += String.fromCharCode(0xDC00 + (codePoint & 0x3FF));
        }
    }
    return str;
}

/**
 * Convert HEX to UTF8 - Simple Variant for P2P Beacons
 */
function hexToUtf8Simple(hexStr) {
    hexStr = hexStr.replace(/\s+/g, '');
    var bytes = [];
    for (var i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }
    var str = '';
    for (var i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return str;
}

/**
 * Convert UTF8 to HEX
 */
function utf8ToHex(s) {
    var r = "";
    var utf8 = unescape(encodeURIComponent(s));
    for (var i = 0; i < utf8.length; i++) {
        var b = utf8.charCodeAt(i);
        r += ("0" + b.toString(16)).slice(-2);
    }
    return r;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper to determine if a privacy level should be included
 */
function shouldIncludeLevel(visibility, isContact, isPersonalContact) {
    if (visibility === 'public') return true;
    if (visibility === 'contacts' && isContact) return true;
    if (visibility === 'personal' && isPersonalContact) return true;
    return false;
}

/**
 * Safe Decode Helper - Handles Mojibake and URI encoding
 */
function safeDecode(str) {
    if (!str) return str;

    // 1. Try resolving Mojibake
    try {
        if (/[ÃÂÅÄ]/.test(str)) {
            var bytes = new Uint8Array(str.length);
            for (var i = 0; i < str.length; i++) {
                var code = str.charCodeAt(i);
                if (code > 255) { }
                bytes[i] = code;
            }
            var decoder = new TextDecoder('utf-8');
            var decoded = decoder.decode(bytes);
            if (decoded !== str && decoded.indexOf('\uFFFD') === -1) {
                str = decoded;
            }
        }
    } catch (e) { }

    // 2. Try URI decoding
    try {
        if (str.indexOf('%') !== -1) {
            str = decodeURIComponent(str);
        }
    } catch (e) { }

    // 3. Known Manual Fixes
    if (str && typeof str === 'string') {
        if (str.indexOf('Catalan') !== -1 && (str.indexOf('Catal') !== -1 || str.indexOf('CatalÃ') !== -1)) return 'Catalan (Català)';
        if (str.indexOf('Spanish') !== -1 && (str.indexOf('Espa') !== -1 || str.indexOf('EspaÃ±') !== -1)) return 'Spanish (Español)';
        if (str.indexOf('Basque') !== -1 && str.indexOf('Euskera') !== -1) return 'Basque (Euskera)';
    }

    return str;
}

/**
 * SQL Escape helper
 */
function escapeSql(str) {
    return (str || '').replace(/'/g, "''");
}

/**
 * Log to both SW and Frontend (via solo comms)
 */
function logToUI(msg) {
    MDS.log(msg);
    try {
        if (typeof MDS !== 'undefined' && MDS.comms && MDS.comms.solo) {
            MDS.comms.solo(JSON.stringify({
                type: "SW_LOG",
                message: msg,
                timestamp: Date.now()
            }));
        }
    } catch (e) { }
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
 * Smart Send Helper - Resolves Address from DISCOVERED_PEERS for non-contacts
 * 
 * @param {string} pubkey - Target public key
 * @param {string} application - Maxima application name
 * @param {string} hexData - Hex-encoded data
 * @param {string} logTag - Tag for logging
 * @param {boolean} usePoll - Whether to use polling (default false)
 * @param {string} forcedAddress - Optional Mx address to use directly (bypasses DB lookup)
 */
function smartSend(pubkey, application, hexData, logTag, usePoll, forcedAddress) {
    var pollStr = usePoll === true ? " poll:true" : " poll:false";
    
    // 1. If we have a forced address, use it immediately
    if (forcedAddress) {
        var cleanAddr = cleanMaximaAddress(forcedAddress);
        if (cleanAddr && (cleanAddr.startsWith("Mx") || cleanAddr.startsWith("MX"))) {
            var sendCmd = "maxima action:send to:" + cleanAddr + " application:" + application + " data:" + hexData + pollStr;
            MDS.log("🔍 [" + logTag + "] Sending via FORCED address: " + cleanAddr.substring(0, 15) + "...");
            MDS.cmd(sendCmd, function(res) {
                if (res.status) {
                    MDS.log("✅ [" + logTag + "] Sent to " + pubkey.substring(0, 10));
                } else {
                    // If forced address fails, we could fallback to publickey, but usually if forced it fails for good reasons
                    MDS.log("⚠️ [" + logTag + "] Forced send failed, trying publickey: " + res.error);
                    MDS.cmd("maxima action:send publickey:" + pubkey + " application:" + application + " data:" + hexData + pollStr);
                }
            });
            return;
        }
    }

    var safeKey = escapeSql(pubkey);
    var peerSql = "SELECT ADDRESS FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + safeKey + "') AND ADDRESS IS NOT NULL LIMIT 1";

    MDS.sql(peerSql, function (peerRes) {
        var sendCmd;
        if (peerRes && peerRes.status && peerRes.rows && peerRes.rows.length > 0) {
            var rawMx = peerRes.rows[0].ADDRESS || peerRes.rows[0].address;
            var mxAddress = rawMx ? cleanMaximaAddress(rawMx) : null;

            if (mxAddress && (mxAddress.startsWith("Mx") || mxAddress.startsWith("MX"))) {
                sendCmd = "maxima action:send to:" + mxAddress + " application:" + application + " data:" + hexData + pollStr;
                MDS.log("🔍 [" + logTag + "] Optimized send via address resolution: " + mxAddress.substring(0, 15) + "...");
            } else {
                sendCmd = "maxima action:send publickey:" + pubkey + " application:" + application + " data:" + hexData + pollStr;
            }
        } else {
            sendCmd = "maxima action:send publickey:" + pubkey + " application:" + application + " data:" + hexData + pollStr;
        }

        MDS.cmd(sendCmd, function (res) {
            if (res.status) {
                MDS.log("✅ [" + logTag + "] Sent to " + pubkey.substring(0, 10));
            } else {
                MDS.log("⚠️ [" + logTag + "] Failed send to " + pubkey.substring(0, 10) + ": " + res.error);
            }
        });
    });
}

/**
 * Maxima Message Sender - Service Worker Utility
 * Handles sending Maxima messages independently of frontend
 * Ported from messaging.service.ts
 * 
 * NOTE: Uses callbacks instead of async/await (MDS doesn't support async/await)
 */

var ContactStatusCache = {};

function clearContactStatusCache(publicKey) {
    if (publicKey) {
        delete ContactStatusCache[publicKey];
    }
}

/**
 * Check if a public key is a known contact (local cache + DB)
 * @param {string} publicKey - Public key to check
 * @param {function} callback - Callback function(isInContacts)
 */
function isTargetInContacts(publicKey, callback) {
    if (ContactStatusCache[publicKey] !== undefined) {
        callback(ContactStatusCache[publicKey]);
        return;
    }

    var safePk = escapeSql(publicKey);
    var sql = "SELECT status FROM MAXIMA_CONTACT_REQUESTS WHERE (UPPER(from_publickey)=UPPER('" + safePk + "') OR UPPER(to_publickey)=UPPER('" + safePk + "')) AND status='accepted' " +
              "UNION ALL " +
              "SELECT status FROM CONTACT_REQUESTS WHERE (UPPER(from_publickey)=UPPER('" + safePk + "') OR UPPER(to_publickey)=UPPER('" + safePk + "')) AND status='accepted' LIMIT 1";

    MDS.sql(sql, function(res) {
        var isInContacts = (res.status && res.rows && res.rows.length > 0);
        ContactStatusCache[publicKey] = isInContacts;
        callback(isInContacts);
    });
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
                                        var retrySendCmd = "maxima action:send to:" + cleanMaximaAddress(mxAddress) + " application:metachain data:" + hexData + " poll:false";
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
                    sendMessage("maxima action:send to:" + cleanMaximaAddress(toPublicKey) + " application:metachain data:" + hexData + " poll:false");
                } else if (toPublicKey.startsWith("0x")) {
                    // Optimized strategy: check if contact first
                    isTargetInContacts(toPublicKey, function(isInContacts) {
                        if (isInContacts) {
                            // Known contact: prioritize publickey (standard Maxima behavior)
                            sendMessage("maxima action:send publickey:" + toPublicKey + " application:metachain data:" + hexData + " poll:false");
                        } else {
                            // Not a contact: try address-based send directly to avoid unnecessary "No Contact found" errors
                            resolveMaximaAddress(toPublicKey, function (err, mxAddress) {
                                if (!err && mxAddress) {
                                    MDS.log("🔍 [SW-MAXIMA] Non-contact, sending via address: " + mxAddress);
                                    sendMessage("maxima action:send to:" + cleanMaximaAddress(mxAddress) + " application:metachain data:" + hexData + " poll:false");
                                } else {
                                    // Fallback to publickey if no address found (might fail with "No Contact found")
                                    sendMessage("maxima action:send publickey:" + toPublicKey + " application:metachain data:" + hexData + " poll:false");
                                }
                            });
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

/**
 * UUID Generator
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Transaction Checker - Service Worker Utility
 * Handles transaction state verification independently of frontend
 * Ported from transaction.service.ts
 * 
 * NOTE: Uses callbacks instead of async/await (MDS doesn't support async/await)
 */

/**
 * Check if a pending UID still exists in Minima's pending list
 * @param {string} uid - Pending UID to check
 * @param {function} callback - Callback function(error, exists)
 */
function checkPendingUID(uid, callback) {
    try {
        MDS.cmd("checkpending uid:" + uid, function (response) {
            if (!response.status) {
                MDS.log("📋 [SW-TX-CHECK] Could not check pending status for " + uid);
                callback(null, false);
                return;
            }

            var exists = response.response && response.response.exists;
            MDS.log("📋 [SW-TX-CHECK] UID " + uid + " pending status: " + exists);
            callback(null, exists || false);
        });
    } catch (err) {
        MDS.log("❌ [SW-TX-CHECK] Error checking pending UID: " + err);
        callback(err, false);
    }
}

/**
 * Check transaction status by txpowid
 * @param {string} txpowid - Transaction ID to check
 * @param {function} callback - Callback function(error, status) where status is 'confirmed' | 'pending' | 'not_found'
 */
function checkTransactionByTxpowid(txpowid, callback) {
    try {
        MDS.cmd("txpow txpowid:" + txpowid, function (response) {
            if (!response.status || !response.response) {
                callback(null, 'not_found');
                return;
            }

            var txpow = response.response;
            var isInBlock = txpow.isblock || txpow.inblock;

            callback(null, isInBlock ? 'confirmed' : 'pending');
        });
    } catch (err) {
        MDS.log("❌ [SW-TX-CHECK] Error checking txpowid " + txpowid + ": " + err);
        callback(err, 'not_found');
    }
}

/**
 * Find a transaction in blockchain or mempool by message timestamp
 * Searches for MetaChain transactions (state[1].data === '204')
 * @param {number|string} messageTimestamp - Message timestamp to search for
 * @param {function} callback - Callback function(error, txpowid) where txpowid is string or null
 */
function findInBlockchainOrMempool(messageTimestamp, callback) {
    try {
        var tsStr = String(messageTimestamp);

        // Get our address
        MDS.cmd("getaddress", function (addressRes) {
            if (!addressRes.status || !addressRes.response) {
                MDS.log("❌ [SW-TX-FIND] Failed to get address");
                callback(null, null);
                return;
            }

            var myAddress = addressRes.response.miniaddress;
            MDS.log("🔍 [SW-TX-FIND] Searching for timestamp " + tsStr + " at address " + myAddress);

            // Search recent txpows for this address
            MDS.cmd("txpow address:" + myAddress + " max:50", function (txpowRes) {
                if (!txpowRes.status || !txpowRes.response) {
                    MDS.log("⚠️ [SW-TX-FIND] No txpows found");
                    callback(null, null);
                    return;
                }

                var txpows = Array.isArray(txpowRes.response) ? txpowRes.response : [txpowRes.response];

                // Search for our transaction
                for (var i = 0; i < txpows.length; i++) {
                    var txpow = txpows[i];
                    var state = txpow.body && txpow.body.txn && txpow.body.txn.state;

                    if (state && Array.isArray(state) && state.length >= 2) {
                        var stateId = state[0] && state[0].data;
                        var charmChainId = state[1] && state[1].data;

                        // Check if it's our MetaChain transaction (204 = 0xCC)
                        if (charmChainId === '204' && stateId === tsStr) {
                            MDS.log("✅ [SW-TX-FIND] Found transaction: " + txpow.txpowid);
                            callback(null, txpow.txpowid);
                            return;
                        }
                    }
                }

                MDS.log("⚠️ [SW-TX-FIND] Transaction not found for timestamp " + tsStr);
                callback(null, null);
            });
        });
    } catch (err) {
        MDS.log("❌ [SW-TX-FIND] Error searching: " + err);
        callback(err, null);
    }
}

/**
 * Get all pending actions from Minima
 * @param {function} callback - Callback function(error, pendingActions) where pendingActions is an array
 */
function getAllPendingActions(callback) {
    try {
        MDS.cmd("mds action:pending", function (response) {
            if (!response.status || !response.response) {
                MDS.log("⚠️ [SW-TX-CHECK] Failed to get pending actions");
                callback(null, []);
                return;
            }

            var pending = response.response.pending || [];
            MDS.log("📋 [SW-TX-CHECK] Found " + pending.length + " pending actions in Minima");
            callback(null, pending);
        });
    } catch (err) {
        MDS.log("❌ [SW-TX-CHECK] Error getting pending actions: " + err);
        callback(err, []);
    }
}

/**
 * Check if a transaction has 3+ block confirmations
 * @param {string} txpowid - Transaction ID to check
 * @param {function} callback - Callback function(error, status) where status is 'confirmed' | 'pending' | 'not_found'
 */
function check3BlockConfirmation(txpowid, callback) {
    if (!txpowid || txpowid.startsWith('PENDING_')) {
        callback(null, 'pending');
        return;
    }

    try {
        // Get transaction details
        MDS.cmd("txpow txpowid:" + txpowid, function (txResponse) {
            if (!txResponse.status || !txResponse.response) {
                callback(null, 'not_found');
                return;
            }

            var txpow = txResponse.response;
            var txBlock = txpow.header && txpow.header.block;

            if (txBlock === undefined || txBlock === null) {
                callback(null, 'pending');
                return;
            }

            // Get current blockchain tip
            MDS.cmd("status", function (statusResponse) {
                if (!statusResponse.status || !statusResponse.response) {
                    MDS.log("⚠️ [SW-TX-CONFIRM] Could not get blockchain status");
                    callback(null, 'pending');
                    return;
                }

                var currentBlock = statusResponse.response.chain && statusResponse.response.chain.block;

                if (currentBlock === undefined || currentBlock === null) {
                    MDS.log("⚠️ [SW-TX-CONFIRM] Could not get current block number");
                    callback(null, 'pending');
                    return;
                }

                // Calculate confirmations
                var blockDifference = parseInt(currentBlock) - parseInt(txBlock);
                MDS.log("🔍 [SW-TX-CONFIRM] Transaction " + txpowid + ": block " + txBlock + ", current " + currentBlock + ", confirmations: " + blockDifference);

                callback(null, blockDifference >= 3 ? 'confirmed' : 'pending');
            });
        });
    } catch (err) {
        MDS.log("❌ [SW-TX-CONFIRM] Error checking confirmation: " + err);
        callback(err, 'pending');
    }
}

/**
 * Coin Discovery Utility
 * Scans blockchain for coins with state variables to recover offline token messages
 */

/**
 * Discover and recover token messages that were sent while node was offline
 * @returns {Promise<number>} Number of recovered messages
 */
function discoverOfflineTokens() {
    MDS.log("📦 [COIN-DISCOVERY] Starting scan for offline tokens...");

    // Get all unspent coins
    return new Promise(function (resolveMain) {
        MDS.cmd("coins", function (coinsRes) {
            // Debug: Log full response
            MDS.log("📦 [COIN-DISCOVERY-DEBUG] Full response: " + JSON.stringify(coinsRes));

            if (!coinsRes.status) {
                MDS.log("⚠️ [COIN-DISCOVERY-DEBUG] Status false. Error: " + (coinsRes.error || "No error message"));
                MDS.log("⚠️ [COIN-DISCOVERY] Failed to get coins");
                resolveMain(0);
                return;
            }

            if (!coinsRes.response) {
                MDS.log("⚠️ [COIN-DISCOVERY-DEBUG] No response object");
                MDS.log("⚠️ [COIN-DISCOVERY] Failed to get coins");
                resolveMain(0);
                return;
            }

            // Coins are returned directly in response array, not response.coins
            if (!Array.isArray(coinsRes.response)) {
                MDS.log("⚠️ [COIN-DISCOVERY-DEBUG] Response is not an array. Type: " + typeof coinsRes.response);
                MDS.log("⚠️ [COIN-DISCOVERY] Failed to get coins");
                resolveMain(0);
                return;
            }

            var allCoins = coinsRes.response;
            MDS.log("📦 [COIN-DISCOVERY] Scanning " + allCoins.length + " coins...");

            // Filter coins with state variables (MetaChain tokens)
            var stateCoins = allCoins.filter(function (coin) {
                return coin.storestate === true &&
                    coin.state &&
                    coin.state['0'] &&
                    coin.spent === false;
            });

            if (stateCoins.length === 0) {
                MDS.log("📦 [COIN-DISCOVERY] No coins with state variables found");
                resolveMain(0);
                return;
            }

            MDS.log("📦 [COIN-DISCOVERY] Found " + stateCoins.length + " coin(s) with state variables");

            var recoveredCount = 0;
            var currentIndex = 0;

            // Process coins sequentially
            function processNextCoin() {
                if (currentIndex >= stateCoins.length) {
                    // All coins processed
                    if (recoveredCount > 0) {
                        MDS.log("📦 [COIN-DISCOVERY] Successfully recovered " + recoveredCount + " offline token message(s)");
                        // Notify frontend to reload messages
                        MDS.notify("OFFLINE_TOKENS_RECOVERED", { count: recoveredCount });
                    } else {
                        MDS.log("📦 [COIN-DISCOVERY] No new offline tokens to recover");
                    }
                    resolveMain(recoveredCount);
                    return;
                }

                var coin = stateCoins[currentIndex];
                // State variables are objects with .data property
                var timestamp = coin.state['0'].data;
                var senderInfo = coin.state['1'] ? coin.state['1'].data : '';
                var chatId = coin.state['2'] ? coin.state['2'].data : null;
                var senderKey = coin.state['3'] ? coin.state['3'].data : null;

                // Determine roomname: use chatId if available (truncated to 160 chars), otherwise "Offline Tokens"
                var roomname = chatId ? chatId.substring(0, 160) : "Offline Tokens";

                MDS.log("📦 [COIN-DISCOVERY] Processing coin with chatId: " + (chatId || "NONE") + ", roomname: " + roomname);

                // Check if message already exists - use time window AND coinid/txpowid
                var minTime = parseInt(timestamp) - 60000;
                var maxTime = parseInt(timestamp) + 60000;
                var checkSql = "SELECT * FROM CHAT_MESSAGES WHERE type='token' AND publickey='" + (senderKey || senderInfo || '') + "' AND (" +
                    "(date >= " + minTime + " AND date <= " + maxTime + ") OR " +
                    "(original_timestamp >= " + minTime + " AND original_timestamp <= " + maxTime + ") OR " +
                    "txpowid='" + coin.coinid + "'" +
                    ")";
                MDS.log("🔍 [COIN-DISCOVERY] Dedup check: " + checkSql);
                MDS.sql(checkSql, function (existing) {
                    if (existing.status && existing.rows && existing.rows.length > 0) {
                        MDS.log("♻️ [COIN-DISCOVERY] Skipping duplicate coin (already exists): " + coin.coinid);
                        // Message already exists, skip to next
                        currentIndex++;
                        processNextCoin();
                        return;
                    }

                    // Extract sender publickey: prioritize state[3], fallback to state[1]
                    var senderPubkey = 'UNKNOWN';
                    if (senderKey && senderKey.trim().length > 0) {
                        // state[3] contains the full sender public key
                        senderPubkey = senderKey.trim();
                        MDS.log("📤 [COIN-DISCOVERY] Using sender key from state[3]: " + senderPubkey.substring(0, 20) + "...");
                    } else if (senderInfo && senderInfo.trim().length > 0) {
                        // Fallback to state[1] for backward compatibility
                        senderPubkey = senderInfo.trim();
                        MDS.log("⚠️ [COIN-DISCOVERY] Fallback to state[1]: " + senderPubkey.substring(0, 20) + "...");
                    } else {
                        MDS.log("❌ [COIN-DISCOVERY] No valid sender key found in state[3] or state[1]!");
                    }

                    // Get token info
                    var tokenid = coin.tokenid || '0x00';
                    var amount = coin.amount || '0';
                    var tokenName = 'Minima';

                    if (tokenid !== '0x00' && coin.token) {
                        tokenName = coin.token.name || coin.token.tokenid || 'Unknown Token';
                    }

                    // Create message payload
                    var messagePayload = JSON.stringify({
                        amount: amount,
                        tokenName: tokenName,
                        tokenid: tokenid
                    });

                    // Escape single quotes for SQL
                    var escapedPayload = messagePayload.replace(/'/g, "''");

                    // Insert retroactive message
                    var insertSql = "INSERT INTO CHAT_MESSAGES " +
                        "(publickey, username, message, type, date, state, amount, txpowid, roomname, filedata, customid, read, original_timestamp) " +
                        "VALUES (" +
                        "'" + senderPubkey + "', " +
                        "'Unknown', " +
                        "'" + escapedPayload + "', " +
                        "'token', " +
                        "'" + timestamp + "', " +
                        "'confirmed', " +
                        amount + ", " +
                        "'" + coin.coinid + "', " +
                        "'" + roomname + "', " +
                        "'', " +
                        "'0x00', " +
                        "0, " +
                        timestamp +
                        ")";

                    MDS.sql(insertSql, function (insertRes) {
                        if (insertRes.status) {
                            MDS.log("✅ [COIN-DISCOVERY] Recovered offline token: " + amount + " " + tokenName + " from " + senderPubkey.substring(0, 10) + "... (timestamp: " + timestamp + ")");
                            recoveredCount++;
                        } else {
                            MDS.log("⚠️ [COIN-DISCOVERY] Failed to insert message for coin " + coin.coinid + ": " + insertRes.error);
                        }

                        // Move to next coin
                        currentIndex++;
                        processNextCoin();
                    });
                });
            }

            // Start processing
            processNextCoin();
        });
    }).catch(function (err) {
        MDS.log("❌ [COIN-DISCOVERY] Error during discovery: " + err);
        return 0;
    });
}

/**
 * MetaChain Service Worker - Database Initialization
 * Creates all required tables on startup using Sequential Promise Pattern
 */

function initDatabase() {
  MDS.log("🚀 [SW] STARTING UP - v2.6 REPAIR");

  // Helper to run SQL as Promise
  function runSQL(query) {
    return new Promise(function (resolve, reject) {
      MDS.sql(query, function (res) {
        if (res.status) resolve(res);
        else resolve({ status: false, error: res.error }); // Resolve even on error to keep chain moving
      });
    });
  }

  // Register for NEWBLOCK events
  MDS.cmd("event on newblock", function (res) {});

  // Get our own Maxima info
  MDS.cmd("maxima action:info", function (maxInfo) {
    if (maxInfo.status) {
      MY_MAXIMA_PK = maxInfo.response.publickey;
      MDS.log("🔑 [SW] My Public Key: " + MY_MAXIMA_PK);
    }
  });

  // Register Maxima applications
  MDS.cmd("maxima action:register application:metachain", function () {});
  MDS.cmd("maxima action:register application:metachain-group", function () {});
  MDS.cmd(
    "maxima action:register application:metachain-channel",
    function () {},
  );

  // START SEQUENTIAL INIT
  var chain = Promise.resolve();

  // 1. TRANSACTIONS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS TRANSACTIONS ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  txpowid VARCHAR(512) NOT NULL, " +
      "  date BIGINT NOT NULL, " +
      "  amount VARCHAR(64) NOT NULL, " +
      "  tokenid VARCHAR(512) NOT NULL, " +
      "  message VARCHAR(255), " +
      "  status VARCHAR(32) DEFAULT 'pending' " +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] TRANSACTIONS table checked/init"
          : "❌ [DB] TRANSACTIONS init failed: " + res.error,
      );
      // REPAIR: Always run these ALTERs
      return Promise.all([
        runSQL(
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS type VARCHAR(32)",
        ),
        runSQL(
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS publickey VARCHAR(512)",
        ),
        runSQL(
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS message_timestamp BIGINT",
        ),
        runSQL(
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS metadata CLOB",
        ),
        runSQL(
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS pendinguid VARCHAR(512)",
        ),
        // FORCE ADD DATE COLUMN IF MISSING (Fix for 'Column DATE not found')
        runSQL("ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS date BIGINT"),
        runSQL("ALTER TABLE TRANSACTIONS ALTER COLUMN date SET NOT NULL"), // Enforce not null if possible, or ignore
        runSQL(
          "ALTER TABLE TRANSACTIONS ALTER COLUMN pendinguid SET DATA TYPE VARCHAR(512)",
        ),
      ]);
    });
  });

  // 2. CHAT_MESSAGES
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS CHAT_MESSAGES ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  roomname varchar(160) NOT NULL, " +
      "  publickey varchar(512) NOT NULL, " +
      "  username varchar(160) NOT NULL, " +
      "  type varchar(64) NOT NULL, " +
      "  message varchar(512) NOT NULL, " +
      "  filedata clob(256K) NOT NULL, " +
      "  customid VARCHAR(512) NOT NULL DEFAULT '0x00', " +
      "  state VARCHAR(512) NOT NULL DEFAULT '', " +
      "  read int NOT NULL DEFAULT 0, " +
      "  amount int NOT NULL DEFAULT 0, " +
      "  date bigint NOT NULL " +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "💾 [DB] CHAT_MESSAGES checked/init"
          : "❌ [DB] CHAT_MESSAGES init failed",
      );
      return Promise.all([
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS amount INT NOT NULL DEFAULT 0",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS original_timestamp BIGINT",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS txpowid VARCHAR(512)",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS sender_seq INT DEFAULT 0",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS customid VARCHAR(512)",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS forwarded INT DEFAULT 0",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS publickey_upper VARCHAR(512) AS UPPER(publickey)",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ALTER COLUMN customid SET DATA TYPE VARCHAR(512)",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ALTER COLUMN txpowid SET DATA TYPE VARCHAR(512)",
        ),
      ]);
    });
  });

  // 3. CHAT_STATUS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS CHAT_STATUS ( " +
      "  publickey VARCHAR(512) PRIMARY KEY, " +
      "  archived BOOLEAN NOT NULL DEFAULT FALSE, " +
      "  archived_date BIGINT, " +
      "  last_opened BIGINT, " +
      "  favorite BOOLEAN NOT NULL DEFAULT FALSE, " +
      "  blocked BOOLEAN NOT NULL DEFAULT FALSE, " +
      "  blocked_by_them BOOLEAN NOT NULL DEFAULT FALSE " +
      " )";
    return runSQL(sql).then(function () {
      return Promise.all([
        runSQL(
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE",
        ),
        runSQL(
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE",
        ),
        runSQL(
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked_by_them BOOLEAN NOT NULL DEFAULT FALSE",
        ),
        runSQL(
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS publickey_upper VARCHAR(512) AS UPPER(publickey)",
        ),
      ]);
    });
  });

  // 3.5 GROUPS (schema parity with frontend)
  chain = chain.then(function () {
    var groupsSql =
      "CREATE TABLE IF NOT EXISTS GROUPS ( " +
      "  group_id VARCHAR(256) PRIMARY KEY, " +
      "  name VARCHAR(255) NOT NULL, " +
      "  creator_publickey VARCHAR(512) NOT NULL, " +
      "  created_date BIGINT NOT NULL, " +
      "  avatar TEXT, " +
      "  description TEXT, " +
      "  archived BOOLEAN DEFAULT FALSE, " +
      "  archived_date BIGINT, " +
      "  favorite BOOLEAN DEFAULT FALSE, " +
      "  is_public BOOLEAN DEFAULT FALSE " +
      " )";

    return runSQL(groupsSql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] GROUPS checked/init"
          : "❌ [DB] GROUPS init failed: " + res.error,
      );
      return Promise.all([
        runSQL(
          "ALTER TABLE GROUPS ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE",
        ),
        runSQL(
          "ALTER TABLE GROUPS ADD COLUMN IF NOT EXISTS archived_date BIGINT",
        ),
        runSQL(
          "ALTER TABLE GROUPS ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE",
        ),
        runSQL(
          "ALTER TABLE GROUPS ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE",
        ),
        runSQL(
          "ALTER TABLE GROUPS ADD COLUMN IF NOT EXISTS auto_approve BOOLEAN DEFAULT FALSE",
        ),
      ]);
    });
  });

  // 3.6 GROUP_MEMBERS
  chain = chain.then(function () {
    var membersSql =
      "CREATE TABLE IF NOT EXISTS GROUP_MEMBERS ( " +
      "  group_id VARCHAR(256) NOT NULL, " +
      "  publickey VARCHAR(512) NOT NULL, " +
      "  username VARCHAR(255) NOT NULL, " +
      "  joined_date BIGINT NOT NULL, " +
      "  role VARCHAR(32) DEFAULT 'member', " +
      "  PRIMARY KEY (group_id, publickey) " +
      " )";

    return runSQL(membersSql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] GROUP_MEMBERS checked/init"
          : "❌ [DB] GROUP_MEMBERS init failed: " + res.error,
      );
    });
  });

  // 3.7 GROUP_MESSAGES
  chain = chain.then(function () {
    var messagesSql =
      "CREATE TABLE IF NOT EXISTS GROUP_MESSAGES ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  group_id VARCHAR(256) NOT NULL, " +
      "  sender_publickey VARCHAR(512) NOT NULL, " +
      "  sender_username VARCHAR(255) NOT NULL, " +
      "  type VARCHAR(32) NOT NULL, " +
      "  message TEXT, " +
      "  filedata TEXT, " +
      "  date BIGINT NOT NULL, " +
      "  read INTEGER DEFAULT 0, " +
      "  propagated INTEGER DEFAULT 0 " +
      " )";

    return runSQL(messagesSql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] GROUP_MESSAGES checked/init"
          : "❌ [DB] GROUP_MESSAGES init failed: " + res.error,
      );

      return Promise.all([
        runSQL(
          "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS propagated INTEGER DEFAULT 0",
        ),
        runSQL(
          "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS forwarded INT DEFAULT 0",
        ),
      ]);
    });
  });

  // 3.8 GROUP_BANS
  chain = chain.then(function () {
    var bansSql =
      "CREATE TABLE IF NOT EXISTS GROUP_BANS ( " +
      "  group_id VARCHAR(256) NOT NULL, " +
      "  publickey VARCHAR(512) NOT NULL, " +
      "  username VARCHAR(255) DEFAULT 'Unknown', " +
      "  banned_by VARCHAR(512) NOT NULL, " +
      "  banned_at BIGINT NOT NULL, " +
      "  PRIMARY KEY (group_id, publickey) " +
      " )";

    return runSQL(bansSql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] GROUP_BANS checked/init"
          : "❌ [DB] GROUP_BANS init failed: " + res.error,
      );

      return runSQL(
        "ALTER TABLE GROUP_BANS ADD COLUMN IF NOT EXISTS username VARCHAR(255) DEFAULT 'Unknown'",
      );
    });
  });

  // 3.9 GROUP_JOIN_REQUESTS
  chain = chain.then(function () {
    var requestsSql =
      "CREATE TABLE IF NOT EXISTS GROUP_JOIN_REQUESTS ( " +
      "  id BIGINT AUTO_INCREMENT, " +
      "  group_id VARCHAR(256) NOT NULL, " +
      "  publickey VARCHAR(512) NOT NULL, " +
      "  username VARCHAR(255) DEFAULT 'Unknown', " +
      "  address VARCHAR(512) NOT NULL, " +
      "  status VARCHAR(32) DEFAULT 'pending', " +
      "  timestamp BIGINT NOT NULL, " +
      "  PRIMARY KEY (group_id, publickey) " +
      " )";

    return runSQL(requestsSql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] GROUP_JOIN_REQUESTS checked/init"
          : "❌ [DB] GROUP_JOIN_REQUESTS init failed: " + res.error,
      );
      return Promise.all([
        runSQL(
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS publickey_upper VARCHAR(512) AS UPPER(publickey)",
        ),
      ]);
    });
  });

  // 4. MESSAGE_COUNTERS (for sequence tracking)
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS MESSAGE_COUNTERS ( " +
      "  publickey VARCHAR(512) PRIMARY KEY, " +
      "  next_seq INT NOT NULL DEFAULT 1 " +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📊 [DB] MESSAGE_COUNTERS checked/init"
          : "❌ [DB] MESSAGE_COUNTERS init failed",
      );
    });
  });

  // 5. MY_PROFILE
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS MY_PROFILE ( " +
      "  id INT PRIMARY KEY, " +
      "  avatar TEXT, " +
      "  tags TEXT, " +
      "  bio_extended TEXT, " +
      "  social_links TEXT, " +
      "  location TEXT, " +
      "  last_updated BIGINT " +
      " )";
    return runSQL(sql).then(function () {
      runSQL("INSERT IGNORE INTO MY_PROFILE (id) VALUES (1)");
      return Promise.all([
        runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS phone TEXT"),
        runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS email TEXT"),
        runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS website TEXT"),
        runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS country TEXT"),
        runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS languages TEXT"),
        runSQL(
          "ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE",
        ),
        runSQL(
          "ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l2 VARCHAR(20) DEFAULT 'public'",
        ),
        runSQL(
          "ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l3 VARCHAR(20) DEFAULT 'contacts'",
        ),
        runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS minimaaddress TEXT"),
      ]);
    });
  });

  // 5. CONTACT_REQUESTS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS CONTACT_REQUESTS ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  from_publickey VARCHAR(512) NOT NULL, " +
      "  from_name VARCHAR(255), " +
      "  from_avatar TEXT, " +
      "  to_publickey VARCHAR(512) NOT NULL, " +
      "  status VARCHAR(32) DEFAULT 'pending', " +
      "  created_at BIGINT NOT NULL, " +
      "  updated_at BIGINT " +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] CONTACT_REQUESTS checked/init"
          : "❌ [DB] CONTACT_REQUESTS init failed",
      );
      return Promise.all([
        runSQL(
          "ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_address VARCHAR(1024)",
        ),
        runSQL(
          "ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_publickey_upper VARCHAR(512) AS UPPER(from_publickey)",
        ),
        runSQL(
          "ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS to_publickey_upper VARCHAR(512) AS UPPER(to_publickey)",
        ),
      ]);
    });
  });

  // 6. DISCOVERED_PEERS (Explicit sequence)
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS DISCOVERED_PEERS ( " +
      "  publickey VARCHAR(512) PRIMARY KEY, " +
      "  alias VARCHAR(160) NOT NULL, " +
      "  bio VARCHAR(512), " +
      "  address VARCHAR(512) NOT NULL, " +
      "  last_seen BIGINT NOT NULL, " +
      "  source VARCHAR(20) NOT NULL" +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] DISCOVERED_PEERS checked/init"
          : "❌ [DB] DISCOVERED_PEERS init failed: " + res.error,
      );
      return Promise.all([
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS bio VARCHAR(512)",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS extra_data CLOB",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS avatar TEXT",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS minimaaddress VARCHAR(512)",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'P2P'",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS publickey_upper VARCHAR(512) AS UPPER(publickey)",
        ),
      ]);
    });
  });

  // 6.1 DISCOVERED_LISTINGS (per-peer public listings cache)
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS DISCOVERED_LISTINGS ( " +
      "  owner_publickey VARCHAR(512) PRIMARY KEY, " +
      "  listings CLOB, " +
      "  timestamp BIGINT, " +
      "  last_seen BIGINT " +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] DISCOVERED_LISTINGS checked/init"
          : "❌ [DB] DISCOVERED_LISTINGS init failed: " + res.error,
      );
      return Promise.all([
        runSQL(
          "ALTER TABLE DISCOVERED_LISTINGS ADD COLUMN IF NOT EXISTS listings CLOB",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_LISTINGS ADD COLUMN IF NOT EXISTS timestamp BIGINT",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_LISTINGS ADD COLUMN IF NOT EXISTS last_seen BIGINT",
        ),
      ]);
    });
  });

  // 7. PERSONAL_CONTACTS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS PERSONAL_CONTACTS ( publickey VARCHAR(512) PRIMARY KEY, created_at BIGINT )";
    return runSQL(sql);
  });

  // 8. MAXIMA_CONTACT_REQUESTS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS MAXIMA_CONTACT_REQUESTS ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  from_publickey VARCHAR(512) NOT NULL, " +
      "  from_name VARCHAR(255), " +
      "  to_publickey VARCHAR(512) NOT NULL, " +
      "  status VARCHAR(32) DEFAULT 'pending', " +
      "  created_at BIGINT NOT NULL, " +
      "  updated_at BIGINT " +
      " )";
    return runSQL(sql).then(function (res) {
      return Promise.all([
        runSQL(
          "ALTER TABLE MAXIMA_CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_publickey_upper VARCHAR(512) AS UPPER(from_publickey)",
        ),
        runSQL(
          "ALTER TABLE MAXIMA_CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS to_publickey_upper VARCHAR(512) AS UPPER(to_publickey)",
        ),
      ]);
    });
  });

  // 9. METACHAIN_USERS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS METACHAIN_USERS ( " +
      "  user_id VARCHAR(512) PRIMARY KEY, " +
      "  publickey VARCHAR(512) UNIQUE NOT NULL, " +
      "  alias VARCHAR(160) NOT NULL, " +
      "  address VARCHAR(512) NOT NULL, " +
      "  first_seen BIGINT NOT NULL, " +
      "  last_updated BIGINT NOT NULL" +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] METACHAIN_USERS checked/init"
          : "❌ [DB] METACHAIN_USERS init failed",
      );
      return Promise.all([
        // Schema parity with Frontend variant
        runSQL(
          "ALTER TABLE METACHAIN_USERS ADD COLUMN IF NOT EXISTS avatar TEXT",
        ),
        runSQL(
          "ALTER TABLE METACHAIN_USERS ADD COLUMN IF NOT EXISTS last_seen BIGINT",
        ),
        runSQL(
          "ALTER TABLE METACHAIN_USERS ADD COLUMN IF NOT EXISTS publickey_upper VARCHAR(512) AS UPPER(publickey)",
        ),
      ]);
    });
  });

  // 10. CHANNELS
  chain = chain.then(function () {
    var channelsSql =
      "CREATE TABLE IF NOT EXISTS CHANNELS ( " +
      "  channel_id VARCHAR(256) PRIMARY KEY, " +
      "  name VARCHAR(255) NOT NULL, " +
      "  description TEXT, " +
      "  admin_publickey VARCHAR(512) NOT NULL, " +
      "  created_date BIGINT NOT NULL, " +
      "  avatar TEXT, " +
      "  archived BOOLEAN DEFAULT FALSE, " +
      "  archived_date BIGINT, " +
      "  favorite BOOLEAN DEFAULT FALSE, " +
      "  is_public BOOLEAN DEFAULT FALSE " +
      " )";
    return runSQL(channelsSql).then(function (res) {
      MDS.log(
        res.status
          ? "📢 [DB] CHANNELS checked/init"
          : "❌ [DB] CHANNELS init failed: " + res.error,
      );
      return Promise.all([
        runSQL(
          "ALTER TABLE CHANNELS ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE",
        ),
        runSQL(
          "ALTER TABLE CHANNELS ADD COLUMN IF NOT EXISTS archived_date BIGINT",
        ),
        runSQL(
          "ALTER TABLE CHANNELS ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE",
        ),
        runSQL(
          "ALTER TABLE CHANNELS ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE",
        ),
      ]);
    });
  });

  // 10.1 CHANNEL_SUBSCRIBERS
  chain = chain.then(function () {
    var subsSql =
      "CREATE TABLE IF NOT EXISTS CHANNEL_SUBSCRIBERS ( " +
      "  channel_id VARCHAR(256) NOT NULL, " +
      "  publickey VARCHAR(512) NOT NULL, " +
      "  username VARCHAR(255) NOT NULL, " +
      "  joined_date BIGINT NOT NULL, " +
      "  role VARCHAR(32) DEFAULT 'subscriber', " +
      "  PRIMARY KEY (channel_id, publickey) " +
      " )";
    return runSQL(subsSql).then(function (res) {
      MDS.log(
        res.status
          ? "📢 [DB] CHANNEL_SUBSCRIBERS checked/init"
          : "❌ [DB] CHANNEL_SUBSCRIBERS init failed: " + res.error,
      );
    });
  });

  // 10.2 CHANNEL_MESSAGES
  chain = chain.then(function () {
    var cMsgSql =
      "CREATE TABLE IF NOT EXISTS CHANNEL_MESSAGES ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  channel_id VARCHAR(256) NOT NULL, " +
      "  sender_publickey VARCHAR(512) NOT NULL, " +
      "  sender_username VARCHAR(255) NOT NULL, " +
      "  type VARCHAR(32) NOT NULL, " +
      "  message TEXT, " +
      "  filedata TEXT, " +
      "  date BIGINT NOT NULL, " +
      "  read INTEGER DEFAULT 0 " +
      " )";
    return runSQL(cMsgSql).then(function (res) {
      MDS.log(
        res.status
          ? "📢 [DB] CHANNEL_MESSAGES checked/init"
          : "❌ [DB] CHANNEL_MESSAGES init failed: " + res.error,
      );
      return Promise.all([
        runSQL(
          "ALTER TABLE CHANNEL_MESSAGES ADD COLUMN IF NOT EXISTS sender_seq INT DEFAULT 0",
        ),
        runSQL(
          "ALTER TABLE CHANNEL_MESSAGES ADD COLUMN IF NOT EXISTS forwarded INT DEFAULT 0",
        ),
      ]);
    });
  });

  // 10.3 CHANNEL_MSG_COUNTERS (sequence tracking per channel)
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS CHANNEL_MSG_COUNTERS ( " +
      "  channel_id VARCHAR(256) NOT NULL, " +
      "  sender_publickey VARCHAR(512) NOT NULL, " +
      "  last_seen_seq INT NOT NULL DEFAULT 0, " +
      "  my_next_seq INT NOT NULL DEFAULT 1, " +
      "  PRIMARY KEY (channel_id, sender_publickey) " +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📊 [DB] CHANNEL_MSG_COUNTERS checked/init"
          : "❌ [DB] CHANNEL_MSG_COUNTERS init failed",
      );
    });
  });

  // 11. IDENTITY MIGRATION (Mx -> Hex)
  chain = chain.then(function () {
    MDS.log("🔄 [DB] Starting Identity Migration (Mx -> Hex)...");
    return runSQL("SELECT publickey, address FROM DISCOVERED_PEERS").then(function (
      res
    ) {
      if (res.status && res.rows && res.rows.length > 0) {
        var migrationPromises = res.rows.map(function (peer) {
          var hex = peer.PUBLICKEY;
          var mx = peer.ADDRESS.replace(/'/g, "''");

          return Promise.all([
            runSQL(
              "UPDATE CHAT_MESSAGES SET publickey='" +
                hex +
                "' WHERE publickey='" +
                mx +
                "'",
            ),
            runSQL(
              "UPDATE CONTACT_REQUESTS SET to_publickey='" +
                hex +
                "' WHERE to_publickey='" +
                mx +
                "'",
            ),
            runSQL(
              "UPDATE CONTACT_REQUESTS SET from_publickey='" +
                hex +
                "' WHERE from_publickey='" +
                mx +
                "'",
            ),
            runSQL(
              "UPDATE MAXIMA_CONTACT_REQUESTS SET to_publickey='" +
                hex +
                "' WHERE to_publickey='" +
                mx +
                "'",
            ),
            runSQL(
              "UPDATE MAXIMA_CONTACT_REQUESTS SET from_publickey='" +
                hex +
                "' WHERE from_publickey='" +
                mx +
                "'",
            ),
            runSQL(
              "UPDATE CHAT_STATUS SET publickey='" +
                hex +
                "' WHERE publickey='" +
                mx +
                "'",
            ),
            runSQL(
              "UPDATE MESSAGE_COUNTERS SET publickey='" +
                hex +
                "' WHERE publickey='" +
                mx +
                "'",
            ),
          ]);
        });
        return Promise.all(migrationPromises).then(function () {
          MDS.log("✅ [DB] Identity Migration complete.");
        });
      }
    });
  });

  // FINAL: Start Services
  chain.then(function () {
    MDS.log("✅ [INIT] Database sequence complete. Starting Services...");
    DB_READY = true;

    // Enable logs for P2P beacons
    MDS.cmd("logs on", function (logRes) {
      if (logRes.status) MDS.log("✅ [INIT] MINIMALOG listener registered");
    });

    // Send initial beacon
    sendBackgroundBeacon();
    startGossip();

    // Bootstrap discovery from MLS if DISCOVERED_PEERS is empty (e.g. after -clean)
    // Wait 2s for Maxima connections to stabilize before contacting MLS
    MDS.cmd("timer 2000", function () {
      if (typeof bootstrapFromMLS === "function") {
        bootstrapFromMLS();
      }
    });

    // Register for periodic tasks
    MDS.cmd("event on newblock", function () {
      MDS.log("✅ [INIT] NEWBLOCK listener registered for periodic tasks.");
    });

    // Trigger history sync to update message counters and chat list
    // Uses timestamp optimization to only fetch new messages
    if (typeof requestHistoryFromRecentContacts === "function") {
      requestHistoryFromRecentContacts();
    } else {
      MDS.log(
        "⚠️ [INIT] requestHistoryFromRecentContacts not loaded yet. Handlers might be missing.",
      );
    }

    // Set flag to run coin discovery on first NEWBLOCK (when node is fully synced)
    COIN_DISCOVERY_PENDING = true;
    MDS.log("📦 [INIT] Coin discovery scheduled for first NEWBLOCK event");
  });
}

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
    var memberSql =
      "SELECT DISTINCT publickey FROM GROUP_MEMBERS WHERE UPPER(publickey) != UPPER('" +
      myPubkey +
      "')";
    MDS.sql(memberSql, function (res) {
      if (!res.status || !res.rows || res.rows.length === 0) return;

      var beaconPayload = {
        app: "metachain-group",
        messageType: "group_address_beacon",
        senderPublickey: myPubkey,
        senderUsername: myName,
        senderAddress: myAddress,
        timestamp: Date.now(),
      };
      var hexData =
        "0x" + utf8ToHex(JSON.stringify(beaconPayload)).toUpperCase();

      for (var i = 0; i < res.rows.length; i++) {
        var memberPk = res.rows[i].PUBLICKEY;

        // Look up their current address
        var peerSql =
          "SELECT address FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
          escapeSql(memberPk) +
          "') LIMIT 1";
        MDS.sql(
          peerSql,
          (function (pk) {
            return function (peerRes) {
              if (peerRes.status && peerRes.rows && peerRes.rows.length > 0) {
                var addr = peerRes.rows[0].ADDRESS || peerRes.rows[0].address;
                if (addr) {
                  var cleanAddr = cleanMaximaAddress(addr);
                  MDS.cmd(
                    "maxima action:send to:" +
                    cleanAddr +
                    " application:metachain-group data:" +
                    hexData +
                    " poll:false",
                  );
                }
              }
              // If no address known, skip (we'll learn it when they beacon back)
            };
          })(memberPk),
        );
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

  var delSql =
    "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
    safePk +
    "')";
  MDS.sql(delSql, function () {
    var insSql =
      "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" +
      safePk +
      "', '" +
      safeAddr +
      "', 'GROUP_BEACON', '" +
      safeName +
      "', " +
      now +
      ", '')";
    MDS.sql(insSql);
  });
}

// ─── Sync state tracking ───────────────────────────────────────────────────
// _pendingSyncs[groupId] = {
//   syncId:     unique id for this sync session,
//   expected:   number of peers we asked,
//   pending:    { pubkey: true } — peers that haven't responded yet,
//   paginating: { pubkey: true } — peers fetching next pages,
//   retryCount: number,
//   startedAt:  Date.now() — used by checkSyncTimeouts() for elapsed-time checks
// }
// NOTE: Uses plain objects (no ES6 Set) and MDS_TIMER_10SECONDS event for timeouts
// (MDS.cmd("timer") callback fires immediately in Rhino — not usable for delays).
var _pendingSyncs = {};
var _syncIdCounter = 0;
var HISTORY_PAGE_SIZE = 50;
var HISTORY_SYNC_TIMEOUT_MS = 30000; // 30s timeout waiting for all peers
var HISTORY_SYNC_MAX_RETRIES = 2;

function _objSize(obj) {
  var count = 0;
  for (var k in obj) { if (obj.hasOwnProperty(k)) count++; }
  return count;
}

/**
 * Called when a peer finishes responding (no more pages).
 * Emits GROUP_SYNC_END only when ALL peers are done.
 */
function markSyncPeerDone(groupId, peerPubkey) {
  var sync = _pendingSyncs[groupId];
  if (!sync) return;

  var normPk = peerPubkey ? peerPubkey.toUpperCase() : peerPubkey;
  delete sync.pending[normPk];
  delete sync.paginating[normPk];
  var remaining = _objSize(sync.pending) + _objSize(sync.paginating);
  MDS.log("🔄 [GROUP-SYNC] Peer done: " + peerPubkey.substring(0, 10) + " (" + remaining + " remaining)");

  if (remaining === 0) {
    finishSync(groupId);
  }
}

function finishSync(groupId) {
  delete _pendingSyncs[groupId];
  MDS.log("✅ [GROUP-SYNC] Sync complete for " + groupId);
  MDS.comms.solo(
    JSON.stringify({
      type: "GROUP_SYNC_END",
      groupId: groupId,
    })
  );
}

/**
 * Check all pending syncs for timeouts.
 * Called periodically from MDS_TIMER_10SECONDS event in main.js.
 * Uses Date.now() comparison instead of MDS.cmd("timer") which fires immediately.
 */
function checkSyncTimeouts() {
  var now = Date.now();
  for (var groupId in _pendingSyncs) {
    if (!_pendingSyncs.hasOwnProperty(groupId)) continue;
    var sync = _pendingSyncs[groupId];
    var elapsed = now - sync.startedAt;

    if (elapsed < HISTORY_SYNC_TIMEOUT_MS) continue;

    var pendingCount = _objSize(sync.pending);
    if (pendingCount === sync.expected && sync.retryCount < HISTORY_SYNC_MAX_RETRIES) {
      MDS.log("⚠️ [GROUP-SYNC] No responses for " + groupId + " after " + elapsed + "ms. Retrying...");
      delete _pendingSyncs[groupId];
      requestGroupHistoryFromSW(groupId, sync.retryCount + 1);
    } else {
      MDS.log("⏱️ [GROUP-SYNC] Timeout for " + groupId + " (" + pendingCount + " peers still pending). Finishing.");
      finishSync(groupId);
    }
  }
}

/**
 * SW-side group history request.
 * Sends a history_request to all known members of a group.
 * Guards against concurrent syncs for the same group.
 */
function requestGroupHistoryFromSW(groupId, retryCount) {
  retryCount = retryCount || 0;

  // Guard: if sync is already in progress for this group, skip
  if (_pendingSyncs[groupId] && retryCount === 0) {
    MDS.log("ℹ️ [GROUP-SYNC] Sync already in progress for " + groupId + ". Skipping.");
    return;
  }

  MDS.log("🔄 [GROUP-SYNC] Requesting history for group " + groupId + " (attempt " + (retryCount + 1) + ")...");

  // Signal sync start only on first attempt
  if (retryCount === 0) {
    MDS.comms.solo(
      JSON.stringify({
        type: "GROUP_SYNC_START",
        groupId: groupId,
      })
    );
  }

  MDS.cmd("maxima action:info", function (maxInfo) {
    if (!maxInfo.status) return;
    var myPubkey = maxInfo.response.publickey;

    // Find the last message timestamp we have for this group
    var lastSql =
      "SELECT date FROM GROUP_MESSAGES WHERE group_id='" +
      escapeSql(groupId) +
      "' ORDER BY date DESC LIMIT 1";
    MDS.sql(lastSql, function (lastRes) {
      var lastTimestamp =
        lastRes.status && lastRes.rows && lastRes.rows.length > 0
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
        historySince: lastTimestamp,
      };
      var hexData =
        "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

      // Send to all known members via DISCOVERED_PEERS
      var memberSql =
        "SELECT gm.publickey, dp.address FROM GROUP_MEMBERS gm LEFT JOIN DISCOVERED_PEERS dp ON UPPER(gm.publickey)=UPPER(dp.publickey) WHERE gm.group_id='" +
        escapeSql(groupId) +
        "'";
      MDS.sql(memberSql, function (memberRes) {
        if (!memberRes.status || !memberRes.rows) {
          finishSync(groupId);
          return;
        }

        var pendingPeers = {};
        var peerCount = 0;
        for (var i = 0; i < memberRes.rows.length; i++) {
          var row = memberRes.rows[i];
          var memberPk = (row.PUBLICKEY || "").toUpperCase();
          if (memberPk === myPubkey.toUpperCase()) continue;
          smartSend(memberPk, "metachain-group", hexData, "GROUP-HISTORY-SYNC", false, row.ADDRESS);
          pendingPeers[memberPk] = true;
          peerCount++;
        }

        if (peerCount === 0) {
          MDS.log("ℹ️ [GROUP-SYNC] No remote members to request history from.");
          finishSync(groupId);
          return;
        }

        // Track this sync with a unique syncId and startedAt timestamp
        _syncIdCounter++;
        _pendingSyncs[groupId] = {
          syncId: _syncIdCounter,
          expected: peerCount,
          pending: pendingPeers,
          paginating: {},
          retryCount: retryCount,
          startedAt: Date.now(),
        };
      });
    });
  });
}

/**
 * Request the next history page from a SINGLE peer.
 * Used when a peer's response contained a full page (HISTORY_PAGE_SIZE messages).
 */
function requestNextPageFromPeer(groupId, peerPubkey, sinceTimestamp) {
  MDS.log("🔄 [GROUP-SYNC] Requesting next page from " + peerPubkey.substring(0, 10) + " for " + groupId + " since " + sinceTimestamp);

  var sync = _pendingSyncs[groupId];
  if (sync) {
    sync.paginating[peerPubkey] = true;
  }

  MDS.cmd("maxima action:info", function (maxInfo) {
    if (!maxInfo.status) return;
    var myPubkey = maxInfo.response.publickey;

    var requestPayload = {
      app: "metachain-group",
      messageType: "history_request",
      groupId: groupId,
      groupName: "SYNC",
      senderPublickey: myPubkey,
      senderUsername: "",
      timestamp: Date.now(),
      historySince: sinceTimestamp,
    };
    var hexData =
      "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

    smartSend(peerPubkey, "metachain-group", hexData, "GROUP-HISTORY-PAGE", false);
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

function handleGroupHistoryRequest(pubkey, maxjson) {
  var groupId = maxjson.groupId;
  var since = maxjson.historySince || 0;
  MDS.log(
    "🔄 [GROUP-SYNC] History requested for " + groupId + " since " + since,
  );

  MDS.cmd("maxima action:info", function (info) {
    if (!info.status) return;
    var myPubkey = info.response.publickey;
    var myName = info.response.name || "User";

    var sql =
      "SELECT * FROM GROUP_MESSAGES WHERE group_id='" +
      escapeSql(groupId) +
      "' AND date > " +
      since +
      " ORDER BY date ASC LIMIT " + HISTORY_PAGE_SIZE;
    MDS.sql(sql, function (res) {
      var historyMessages = [];
      if (res.status && res.rows && res.rows.length > 0) {
        for (var i = 0; i < res.rows.length; i++) {
          var row = res.rows[i];
          historyMessages.push({
            group_id: row.GROUP_ID || row.group_id,
            sender_publickey: row.SENDER_PUBLICKEY || row.sender_publickey,
            sender_username: row.SENDER_USERNAME || row.sender_username,
            type: row.TYPE || row.type,
            message: row.MESSAGE || row.message,
            filedata: row.FILEDATA || row.filedata,
            date: Number(row.DATE || row.date),
            sender_seq: Number(row.SENDER_SEQ || row.sender_seq || 0),
            customid: row.CUSTOMID || row.customid || "",
            forwarded: row.FORWARDED === true || row.FORWARDED === 'true' || row.FORWARDED === 1,
          });
        }
      }

      var responsePayload = {
        app: "metachain-group",
        messageType: "history_response",
        groupId: groupId,
        groupName: maxjson.groupName || "",
        senderPublickey: myPubkey,
        senderUsername: myName,
        timestamp: Date.now(),
        historyMessages: historyMessages,
      };

      var hexData =
        "0x" + utf8ToHex(JSON.stringify(responsePayload)).toUpperCase();

      // Send history response with Address Resolution
      smartSend(pubkey, "metachain-group", hexData, "GROUP-HISTORY-RESP", false);
    });
  });
}

function handleGroupHistoryResponse(pubkey, maxjson) {
  var groupId = maxjson.groupId;
  var messages = maxjson.historyMessages || [];

  MDS.log(
    "🔄 [GROUP-SYNC] Received " +
    messages.length +
    " history messages for " +
    groupId,
  );

  // Filter and Save them
  var savedCount = 0;
  var latestTimestamp = 0;
  var processNext = function (index) {
    if (index >= messages.length) {
      // Pagination: if we got a full page, request the next one from THIS peer only
      if (messages.length >= HISTORY_PAGE_SIZE && latestTimestamp > 0) {
        MDS.log(
          "🔄 [GROUP-SYNC] Full page from " + pubkey.substring(0, 10) +
          ". Requesting next page since " + latestTimestamp,
        );
        // Move peer from pending to paginating (first response arrived, more coming)
        var sync = _pendingSyncs[groupId];
        if (sync) delete sync.pending[pubkey.toUpperCase()];
        requestNextPageFromPeer(groupId, pubkey, latestTimestamp);
      } else {
        // No more pages from this peer — mark done
        markSyncPeerDone(groupId, pubkey);
      }
      return;
    }

    var msg = messages[index];
    var timestamp = Number(msg.date);
    var sender = msg.sender_publickey;

    // Track the latest timestamp for pagination
    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }

    // Ensure customid exists for dedup
    var msgCustomId = msg.customid || ("hist_" + escapeSql(groupId) + "_" + timestamp + "_" + index);

    // Duplicate check: customid first, then fallback to (sender, date)
    var checkSql =
      "SELECT id FROM GROUP_MESSAGES WHERE group_id='" +
      escapeSql(groupId) +
      "' AND (customid='" +
      escapeSql(msgCustomId) +
      "' OR (UPPER(sender_publickey)=UPPER('" +
      escapeSql(sender) +
      "') AND date=" +
      timestamp +
      "))";
    MDS.sql(checkSql, function (checkRes) {
      if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
        processNext(index + 1);
      } else {
        savedCount++;
        var insSql =
          "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated, sender_seq, customid, forwarded) VALUES " +
          "('" +
          escapeSql(groupId) +
          "','" +
          escapeSql(sender) +
          "','" +
          escapeSql(msg.sender_username || "") +
          "','" +
          escapeSql(msg.type || "text") +
          "','" +
          escapeSql(msg.message || "") +
          "','" +
          escapeSql(msg.filedata || "") +
          "'," +
          timestamp +
          ", 0, 1, " +
          (msg.sender_seq || 0) +
          ", '" +
          escapeSql(msgCustomId) +
          "', " + (msg.forwarded ? 1 : 0) + ")";
        MDS.sql(insSql, function () {
          processNext(index + 1);
        });
      }
    });
  };

  processNext(0);
}

function handleGroupMessage(pubkey, maxjson) {
  MDS.log("📨 [GROUP-MSG] Processing...");

  // Migration: Ensure propagated column exists
  var migrationSql =
    "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS propagated INT DEFAULT 0";
  MDS.sql(migrationSql, function (migRes) {
    var safeGroupId = escapeSql(maxjson.groupId || "");
    var encoded = escapeSql(maxjson.message || "");
    var messageTimestamp = Number(maxjson.timestamp) || Date.now();
    var originalSender = escapeSql(maxjson.senderPublickey || pubkey);
    var safeSenderUsername = escapeSql(maxjson.senderUsername || "Unknown");
    var safeType = escapeSql(maxjson.type || "text");
    var safeFileData = escapeSql(maxjson.filedata || "");

    // 🚫 Check if the sender is banned from this group
    var banCheckSql =
      "SELECT * FROM GROUP_BANS WHERE group_id='" +
      safeGroupId +
      "' AND UPPER(publickey)=UPPER('" +
      originalSender +
      "')";
    MDS.sql(banCheckSql, function (banRes) {
      if (banRes.status && banRes.rows && banRes.rows.length > 0) {
        MDS.log(
          "🚫 [GROUP-MSG] Discarding message from banned sender: " +
          originalSender.substring(0, 10),
        );
        return;
      }
      processGroupMessage(
        safeGroupId,
        encoded,
        messageTimestamp,
        originalSender,
        safeSenderUsername,
        safeType,
        safeFileData,
        pubkey,
        maxjson
      );
    });
  });
}

function processGroupMessage(
  safeGroupId,
  encoded,
  messageTimestamp,
  originalSender,
  safeSenderUsername,
  safeType,
  safeFileData,
  pubkey,
  maxjson
) {
  var incomingSeq = maxjson.seq ? parseInt(maxjson.seq) : 0;

  // Ensure every message has a customid (generate one if sender didn't provide it)
  if (!maxjson.customid) {
    maxjson.customid = "sw_" + safeGroupId + "_" + messageTimestamp + "_" + Math.random().toString(36).substr(2, 9);
  }

  // Check for duplicates: customid is the primary dedup key, timestamp is fallback
  var safeCustomId = escapeSql(maxjson.customid);
  var checkSql =
    "SELECT id, propagated FROM GROUP_MESSAGES WHERE group_id='" +
    safeGroupId +
    "' AND (customid='" +
    safeCustomId +
    "' OR (UPPER(sender_publickey)=UPPER('" +
    originalSender +
    "') AND date=" +
    messageTimestamp +
    "))";

  MDS.sql(checkSql, function (checkRes) {
    var shouldPropagate = false;

    if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
      var row = checkRes.rows[0];
      var isPropagated = row.PROPAGATED === 1 || row.propagated === 1;

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
      var forwardedVal = maxjson.forwarded ? 1 : 0;
      var groupMsgSql =
        "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated, sender_seq, customid, forwarded) VALUES " +
        "('" +
        safeGroupId +
        "','" +
        originalSender +
        "','" +
        safeSenderUsername +
        "','" +
        safeType +
        "','" +
        encoded +
        "','" +
        safeFileData +
        "'," +
        messageTimestamp +
        ", 0, 1, " +
        incomingSeq +
        ", '" +
        escapeSql(maxjson.customid || "") +
        "', " + forwardedVal + ")";

      MDS.sql(groupMsgSql, function (res) {
        if (res.status) {
          MDS.log("✅ [DB] Group message saved (propagated=1).");
        } else {
          MDS.log("❌ [DB] Failed to save group message: " + res.error);
          if (res.error && res.error.indexOf("propagated") !== -1) {
            var retrySql =
              "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read) VALUES " +
              "('" +
              safeGroupId +
              "','" +
              originalSender +
              "','" +
              safeSenderUsername +
              "','" +
              safeType +
              "','" +
              encoded +
              "','" +
              safeFileData +
              "'," +
              messageTimestamp +
              ", 0)";
            MDS.sql(retrySql);
          }
        }
      });
    }

    // GAP DETECTION: Check sequence numbers (only if sender includes seq)
    if (incomingSeq > 0) {
      var seqCheckSql =
        "SELECT last_seen_seq FROM GROUP_MSG_COUNTERS WHERE group_id='" +
        safeGroupId +
        "' AND sender_publickey='" +
        originalSender +
        "'";
      MDS.sql(seqCheckSql, function (seqRes) {
        var lastSeq = 0;
        var hasRow = seqRes.status && seqRes.rows && seqRes.rows.length > 0;
        if (hasRow) {
          lastSeq = parseInt(seqRes.rows[0].LAST_SEEN_SEQ || 0);
        }

        if (lastSeq > 0 && incomingSeq > lastSeq + 1) {
          var gapSize = incomingSeq - lastSeq - 1;
          MDS.log(
            "⚠️ [GAP-DETECT] Missing " +
            gapSize +
            " message(s) from " +
            originalSender.substring(0, 10) +
            " in group " +
            safeGroupId,
          );
          // Trigger history sync to fill the gap
          requestGroupHistoryFromSW(safeGroupId);
        }

        // Update or insert last_seen_seq
        if (incomingSeq > lastSeq) {
          if (hasRow) {
            MDS.sql(
              "UPDATE GROUP_MSG_COUNTERS SET last_seen_seq=" +
              incomingSeq +
              " WHERE group_id='" +
              safeGroupId +
              "' AND sender_publickey='" +
              originalSender +
              "'",
            );
          } else {
            MDS.sql(
              "INSERT INTO GROUP_MSG_COUNTERS (group_id, sender_publickey, last_seen_seq, my_next_seq) VALUES ('" +
              safeGroupId +
              "','" +
              originalSender +
              "'," +
              incomingSeq +
              ",1)",
            );
          }
        }
      });
    }

    // Do NOT propagate if already forwarded — prevents exponential storm
    if (shouldPropagate && !maxjson.forwarded) {
      propagateGroupMessage(pubkey, maxjson);
    } else if (shouldPropagate && maxjson.forwarded) {
      MDS.log("ℹ️ [GROUP-MSG] Forwarded copy — skipping re-propagation.");
    }
  });
}

function propagateGroupMessage(pubkey, maxjson) {
  MDS.log("🔄 [GROUP-MSG] Starting propagation...");

  var safeGroupId = escapeSql(maxjson.groupId || "");
  var membersSql =
    "SELECT * FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "'";
  MDS.sql(membersSql, function (memberRes) {
    if (!memberRes.status || !memberRes.rows) {
      MDS.log("❌ [GROUP-MSG] Failed to fetch members.");
      return;
    }

    var members = memberRes.rows;
    MDS.cmd("maxima", function (maximaRes) {
      var myPubkey = maximaRes.response.publickey;
      // Mark as forwarded so recipients do NOT re-propagate (prevents storm)
      var forwardedMsg = JSON.parse(JSON.stringify(maxjson));
      forwardedMsg.forwarded = true;
      var jsonStr = JSON.stringify(forwardedMsg);
      var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();
      var propagatedCount = 0;

      // Send to each member via DISCOVERED_PEERS address (no maxcontacts needed)
      var sendToMember = function (index) {
        if (index >= members.length) {
          MDS.log(
            "✅ [GROUP-MSG] Propagation complete. Sent to " +
            propagatedCount +
            " members.",
          );
          return;
        }

        var memberPubkey = members[index].PUBLICKEY;

        // Skip sender, original message sender, and ourselves
        if (
          memberPubkey === pubkey ||
          memberPubkey === maxjson.senderPublickey ||
          memberPubkey.toUpperCase() === myPubkey.toUpperCase()
        ) {
          sendToMember(index + 1);
          return;
        }

        // Look up Mx address in DISCOVERED_PEERS
        smartSend(memberPubkey, "metachain-group", hexData, "GROUP-PROPAGATE", false);
        sendToMember(index + 1);
      };

      sendToMember(0);
    });
  });
}

function handleGroupInvite(pubkey, maxjson) {
  var safeGroupId = escapeSql(maxjson.groupId || "");
  var safeGroupName = escapeSql(maxjson.groupName || "");
  MDS.log(
    "📨 [GROUP-INVITE] Processing invite for group " +
    safeGroupId +
    " (" +
    safeGroupName +
    ") from " +
    pubkey.substring(0, 10),
  );
  var safeCreatorPubkey = escapeSql(maxjson.creatorPublickey || pubkey || "");
  var safeDescription = escapeSql(maxjson.description || "");
  var safeTimestamp = Number(maxjson.timestamp) || Date.now();

  // 🚫 Check if WE (this node) are banned from this group
  MDS.cmd("maxima action:info", function (maximaRes) {
    var myPubkey = maximaRes.response.publickey;
    MDS.log("📝 [GROUP-INVITE] My Pubkey: " + myPubkey.substring(0, 10));
    var checkBanSql =
      "SELECT * FROM GROUP_BANS WHERE group_id='" +
      safeGroupId +
      "' AND UPPER(publickey)=UPPER('" +
      myPubkey +
      "')";
    MDS.sql(checkBanSql, function (banRes) {
      if (banRes.status && banRes.rows && banRes.rows.length > 0) {
        MDS.log(
          "🚫 [GROUP-INVITE] Ignoring invite: we are banned from group " +
          safeGroupId,
        );
        return;
      }

      var createGroupSql =
        "INSERT INTO GROUPS (group_id, name, creator_publickey, created_date, description) VALUES " +
        "('" +
        safeGroupId +
        "','" +
        safeGroupName +
        "','" +
        safeCreatorPubkey +
        "'," +
        safeTimestamp +
        ",'" +
        safeDescription +
        "')";

      MDS.sql(createGroupSql, function (res) {
        MDS.log(
          "✅ [GROUP-MGMT] Group created/exists for invite: " + safeGroupId,
        );

        if (maxjson.members) {
          var addMember = function (idx) {
            if (idx >= maxjson.members.length) {
              var creatorName = escapeSql(
                maxjson.creatorUsername || maxjson.senderUsername || "Someone",
              );
              var systemMsg = creatorName + " created the group";
              var checkMsgSql =
                "SELECT id FROM GROUP_MESSAGES WHERE group_id='" +
                safeGroupId +
                "' AND type='system' AND message='" +
                systemMsg +
                "'";
              MDS.sql(checkMsgSql, function (checkRes) {
                if (
                  checkRes.status &&
                  (!checkRes.rows || checkRes.rows.length === 0)
                ) {
                  var initialMsgSql =
                    "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated, customid) VALUES " +
                    "('" +
                    safeGroupId +
                    "', '" +
                    safeCreatorPubkey +
                    "', '" +
                    creatorName +
                    "', 'system', '" +
                    systemMsg +
                    "', '', " +
                    safeTimestamp +
                    ", 0, 1, '" +
                    escapeSql(maxjson.customid || "") +
                    "')";
                  MDS.sql(initialMsgSql, function () {
                    // Notify UI that a new group was added
                    MDS.comms.solo(
                      JSON.stringify({ type: "group_list_updated" })
                    );
                    MDS.comms.solo(
                      JSON.stringify({
                        type: "group_sync_start",
                        groupId: safeGroupId,
                      })
                    );
                    // Trigger history sync
                    if (typeof requestGroupHistoryFromSW === "function") {
                      requestGroupHistoryFromSW(safeGroupId);
                    }
                  });
                } else {
                  // Even if msg exists, notify UI in case it's a new join
                  MDS.comms.solo(
                    JSON.stringify({ type: "group_list_updated" })
                  );
                }
              });
              return;
            }
            var m = maxjson.members[idx];
            var memberPublickey = m.publickey || m.PUBLICKEY || "";
            var memberUsername = m.username || m.USERNAME || "Unknown";
            var memberRole = m.role || m.ROLE || "";

            var role = memberRole
              ? escapeSql(memberRole)
              : memberPublickey === safeCreatorPubkey
                ? "creator"
                : "member";
            var safeMemberPubkey = escapeSql(memberPublickey);
            var safeMemberUsername = escapeSql(memberUsername);

            // Check ban before inserting
            var checkMemberBanSql =
              "SELECT * FROM GROUP_BANS WHERE group_id='" +
              safeGroupId +
              "' AND UPPER(publickey)=UPPER('" +
              safeMemberPubkey +
              "')";
            MDS.sql(checkMemberBanSql, function (memberBanRes) {
              if (
                memberBanRes.status &&
                memberBanRes.rows &&
                memberBanRes.rows.length > 0
              ) {
                MDS.log(
                  "🚫 [GROUP-INVITE] Skipping banned member: " +
                  safeMemberPubkey.substring(0, 10),
                );
                addMember(idx + 1);
                return;
              }

              var addMemberSql =
                "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) SELECT '" +
                safeGroupId +
                "','" +
                safeMemberPubkey +
                "','" +
                safeMemberUsername +
                "'," +
                safeTimestamp +
                ",'" +
                role +
                "' WHERE NOT EXISTS (SELECT 1 FROM GROUP_MEMBERS WHERE group_id='" +
                safeGroupId +
                "' AND UPPER(publickey)=UPPER('" +
                safeMemberPubkey +
                "'))";

              MDS.sql(addMemberSql, function () {
                // Seed DISCOVERED_PEERS with this member's Mx address if provided
                if (m.address) {
                  var safeMemberAddress = escapeSql(m.address);
                  var delPeer =
                    "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
                    safeMemberPubkey +
                    "')";
                  MDS.sql(delPeer, function () {
                    var insPeer =
                      "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" +
                      safeMemberPubkey +
                      "', '" +
                      safeMemberAddress +
                      "', 'GROUP_INVITE', '" +
                      safeMemberUsername +
                      "', " +
                      safeTimestamp +
                      ", '')";
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

                var checkBanSql =
                  "SELECT * FROM GROUP_BANS WHERE group_id='" +
                  safeGroupId +
                  "' AND UPPER(publickey)=UPPER('" +
                  safeBanPubkey +
                  "')";
                MDS.sql(checkBanSql, function (checkBanRes) {
                  if (
                    checkBanRes.status &&
                    (!checkBanRes.rows || checkBanRes.rows.length === 0)
                  ) {
                    var insertBanSql =
                      "INSERT INTO GROUP_BANS (group_id, publickey, username, banned_by, banned_at) VALUES " +
                      "('" +
                      safeGroupId +
                      "','" +
                      safeBanPubkey +
                      "','" +
                      safeBanUsername +
                      "','" +
                      safeBannedBy +
                      "'," +
                      safeBannedAt +
                      ")";
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
    var checkAddBanSql =
      "SELECT * FROM GROUP_BANS WHERE group_id='" +
      safeGroupId +
      "' AND UPPER(publickey)=UPPER('" +
      safeMemberPublickey +
      "')";
    MDS.sql(checkAddBanSql, function (addBanRes) {
      if (addBanRes.status && addBanRes.rows && addBanRes.rows.length > 0) {
        MDS.log(
          "🚫 [GROUP-MEMBER] Blocked re-add of banned member: " +
          safeMemberPublickey.substring(0, 10),
        );
        return;
      }
      // 🚫 Block duplicate insert if already a member (case-insensitive)
      var checkAlreadyMemberSql =
        "SELECT * FROM GROUP_MEMBERS WHERE group_id='" +
        safeGroupId +
        "' AND UPPER(publickey)=UPPER('" +
        safeMemberPublickey +
        "')";
      MDS.sql(checkAlreadyMemberSql, function (alreadyRes) {
        if (alreadyRes.status && alreadyRes.rows && alreadyRes.rows.length > 0) {
          MDS.log(
            "ℹ️ [GROUP-MEMBER] Already a member, skipping duplicate insert: " +
            safeMemberPublickey.substring(0, 10),
          );
          MDS.comms.solo(
            JSON.stringify({ type: "group_update", groupId: safeGroupId }),
          );
          return;
        }
      var addMemberSql =
        "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES " +
        "('" +
        safeGroupId +
        "','" +
        safeMemberPublickey +
        "','" +
        safeMemberUsername +
        "'," +
        safeTimestamp +
        ",'member')";
      MDS.sql(addMemberSql, function () {
        // Seed DISCOVERED_PEERS with new member's Mx address so we can send messages to them
        if (maxjson.memberAddress) {
          var safeMemberAddress = escapeSql(maxjson.memberAddress);
          var now = Date.now();
          var delPeer =
            "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
            safeMemberPublickey +
            "')";
          MDS.sql(delPeer, function () {
            var insPeer =
              "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" +
              safeMemberPublickey +
              "', '" +
              safeMemberAddress +
              "', 'GROUP_MEMBER_ADDED', '" +
              safeMemberUsername +
              "', " +
              now +
              ", '')";
            MDS.sql(insPeer, function () {
              MDS.comms.solo(
                JSON.stringify({ type: "group_update", groupId: safeGroupId }),
              );
            });
          });
        } else {
          MDS.comms.solo(
            JSON.stringify({ type: "group_update", groupId: safeGroupId }),
          );
        }
      });
      }); // end checkAlreadyMemberSql
    });
  } else {
    MDS.cmd("maxima", function (maximaRes) {
      var myPubkey = maximaRes.response.publickey;

      if (myPubkey === safeMemberPublickey) {
        // I have been kicked/banned! Delete the group completely so I don't see it anymore.
        MDS.sql(
          "DELETE FROM GROUPS WHERE group_id='" + safeGroupId + "'",
          function () {
            MDS.sql(
              "DELETE FROM GROUP_MEMBERS WHERE group_id='" + safeGroupId + "'",
              function () {
                MDS.sql(
                  "DELETE FROM GROUP_MESSAGES WHERE group_id='" +
                  safeGroupId +
                  "'",
                  function () {
                    MDS.sql(
                      "DELETE FROM GROUP_BANS WHERE group_id='" +
                      safeGroupId +
                      "'",
                      function () {
                        MDS.comms.solo(
                          JSON.stringify({
                            type: "group_update",
                            groupId: safeGroupId,
                          }),
                        );
                      },
                    );
                  },
                );
              },
            );
          },
        );
      } else {
        var removeMemberSql =
          "DELETE FROM GROUP_MEMBERS WHERE group_id='" +
          safeGroupId +
          "' AND UPPER(publickey)=UPPER('" +
          safeMemberPublickey +
          "')";
        MDS.sql(removeMemberSql, function () {
          if (
            maxjson.senderPublickey &&
            maxjson.senderPublickey !== maxjson.memberPublickey
          ) {
            var safeBannedBy = escapeSql(maxjson.senderPublickey);
            var checkBanSql =
              "SELECT * FROM GROUP_BANS WHERE group_id='" +
              safeGroupId +
              "' AND UPPER(publickey)=UPPER('" +
              safeMemberPublickey +
              "')";
            MDS.sql(checkBanSql, function (banRes) {
              if (!banRes.status || !banRes.rows || banRes.rows.length === 0) {
                var banSql =
                  "INSERT INTO GROUP_BANS (group_id, publickey, username, banned_by, banned_at) VALUES ('" +
                  safeGroupId +
                  "', '" +
                  safeMemberPublickey +
                  "', '" +
                  safeMemberUsername +
                  "', '" +
                  safeBannedBy +
                  "', " +
                  safeTimestamp +
                  ")";
                MDS.sql(banSql, function () {
                  MDS.comms.solo(
                    JSON.stringify({
                      type: "group_update",
                      groupId: safeGroupId,
                    }),
                  );
                });
              } else {
                MDS.comms.solo(
                  JSON.stringify({
                    type: "group_update",
                    groupId: safeGroupId,
                  }),
                );
              }
            });
          } else {
            MDS.comms.solo(
              JSON.stringify({ type: "group_update", groupId: safeGroupId }),
            );
          }
        });
      }
    });
  }
}

function handleGroupMemberUnbanned(pubkey, maxjson) {
  MDS.log(
    "🔄 [GROUP-UNBAN] Processing unban for " +
    (maxjson.memberPublickey
      ? maxjson.memberPublickey.substring(0, 10)
      : "unknown"),
  );
  var safeGroupId = escapeSql(maxjson.groupId || "");
  var safeMemberPublickey = escapeSql(maxjson.memberPublickey || "");

  var sql =
    "DELETE FROM GROUP_BANS WHERE group_id='" +
    safeGroupId +
    "' AND UPPER(publickey)=UPPER('" +
    safeMemberPublickey +
    "')";
  MDS.sql(sql, function () {
    MDS.comms.solo(
      JSON.stringify({ type: "group_update", groupId: safeGroupId }),
    );
  });
}

function handleGroupUpdateDetails(pubkey, maxjson) {
  MDS.log(
    "🔄 [GROUP-UPDATE] Processing details request from " +
    pubkey.substring(0, 10),
  );
  var safeGroupId = escapeSql(maxjson.groupId || "");
  var safeNewName = maxjson.newName ? escapeSql(maxjson.newName) : null;
  var safeNewDescription =
    maxjson.newDescription !== undefined && maxjson.newDescription !== null
      ? escapeSql(maxjson.newDescription)
      : null;
  var safeAvatar = maxjson.avatar ? escapeSql(maxjson.avatar) : null;
  var hasAutoApprove = maxjson.auto_approve !== undefined;
  var autoApproveEnabled =
    maxjson.auto_approve === true ||
    maxjson.auto_approve === 1 ||
    String(maxjson.auto_approve).toUpperCase() === "TRUE" ||
    String(maxjson.auto_approve) === "1";

  // Security Check: Sender must be creator OR admin
  var checkSql =
    "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
    safeGroupId +
    "' AND publickey='" +
    pubkey +
    "'";

  MDS.sql(checkSql, function (res) {
    if (!res.status || !res.rows || res.rows.length === 0) {
      MDS.log(
        "⚠️ [GROUP-UPDATE] Group " +
        safeGroupId +
        " not found locally or sender is not a member.",
      );
      return;
    }

    var senderRole = res.rows[0].ROLE || res.rows[0].role;

    if (senderRole !== "creator" && senderRole !== "admin") {
      MDS.log(
        "❌ [GROUP-UPDATE] Unauthorized attempt. Sender (" +
        pubkey.substring(0, 10) +
        ") has role: " +
        senderRole,
      );
      return;
    }

    var updates = [];
    if (safeNewName !== null) updates.push("name='" + safeNewName + "'");
    if (safeNewDescription !== null)
      updates.push("description='" + safeNewDescription + "'");
    if (safeAvatar !== null) updates.push("avatar='" + safeAvatar + "'");
    if (hasAutoApprove)
      updates.push("auto_approve=" + (autoApproveEnabled ? "TRUE" : "FALSE"));

    if (updates.length === 0) return;

    // Sender authorized: Update the details
    var updateSql =
      "UPDATE GROUPS SET " +
      updates.join(", ") +
      " WHERE group_id='" +
      safeGroupId +
      "'";
    MDS.sql(updateSql, function (updateRes) {
      if (updateRes.status) {
        MDS.log("✅ [DB] Group details updated via broadcast");

        // Notify the frontend via MDS.comms.solo
        var soloMsg = {
          type: "group_update",
          groupId: maxjson.groupId,
        };
        if (maxjson.newName !== undefined) soloMsg.name = maxjson.newName;
        if (maxjson.newDescription !== undefined)
          soloMsg.description = maxjson.newDescription;
        if (maxjson.avatar !== undefined) soloMsg.avatar = maxjson.avatar;
        if (hasAutoApprove) soloMsg.auto_approve = autoApproveEnabled;

        var msgStr =
          typeof soloMsg === "string" ? soloMsg : JSON.stringify(soloMsg);
        MDS.comms.solo(msgStr);
      } else {
        MDS.log("❌ [DB] Failed to update group details: " + updateRes.error);
      }
    });
  });
}

function handleGroupRoleUpdate(pubkey, maxjson) {
  MDS.log(
    "🔄 [GROUP-ROLE] Processing role update request from " +
    pubkey.substring(0, 10),
  );
  var safeGroupId = escapeSql(maxjson.groupId || "");
  var safeTargetPubkey = escapeSql(maxjson.targetPubkey || "");
  var safeNewRole = escapeSql(maxjson.newRole || "member"); // 'admin' or 'member'

  // 1. Check if the sender is an admin or creator
  var checkSenderSql =
    "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
    safeGroupId +
    "' AND publickey='" +
    pubkey +
    "'";

  MDS.sql(checkSenderSql, function (resSender) {
    if (!resSender.status || !resSender.rows || resSender.rows.length === 0) {
      MDS.log("❌ [GROUP-ROLE] Unauthorized role update. Sender not in group.");
      return;
    }

    var senderRole = resSender.rows[0].ROLE || resSender.rows[0].role;
    if (senderRole !== "creator" && senderRole !== "admin") {
      MDS.log(
        "❌ [GROUP-ROLE] Unauthorized role update. Sender role is: " +
        senderRole,
      );
      return;
    }

    // 2. We can't change the creator's role explicitly (or demote them)
    var checkTargetSql =
      "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
      safeGroupId +
      "' AND publickey='" +
      safeTargetPubkey +
      "'";
    MDS.sql(checkTargetSql, function (resTarget) {
      if (!resTarget.status || !resTarget.rows || resTarget.rows.length === 0) {
        MDS.log("⚠️ [GROUP-ROLE] Target user not found in group.");
        return;
      }

      var targetRole = resTarget.rows[0].ROLE || resTarget.rows[0].role;
      if (targetRole === "creator") {
        MDS.log("❌ [GROUP-ROLE] Cannot change the role of the creator.");
        return;
      }

      // 3. Update the role
      var updateSql =
        "UPDATE GROUP_MEMBERS SET role='" +
        safeNewRole +
        "' WHERE group_id='" +
        safeGroupId +
        "' AND publickey='" +
        safeTargetPubkey +
        "'";
      MDS.sql(updateSql, function (updateRes) {
        if (updateRes.status) {
          MDS.log(
            "✅ [DB] Role for " +
            safeTargetPubkey.substring(0, 10) +
            " updated to " +
            safeNewRole,
          );

          // Notify the frontend via MDS.comms.solo
          var soloMsg = {
            type: "group_update",
            groupId: safeGroupId,
          };

          var msgStr =
            typeof soloMsg === "string" ? soloMsg : JSON.stringify(soloMsg);
          MDS.comms.solo(msgStr);

          // If a member has just been promoted to admin, send current group settings snapshot.
          if (safeNewRole === "admin") {
            var settingsSql =
              "SELECT name, description, avatar, auto_approve FROM GROUPS WHERE group_id='" +
              safeGroupId +
              "' LIMIT 1";
            MDS.sql(settingsSql, function (settingsRes) {
              if (
                !settingsRes.status ||
                !settingsRes.rows ||
                settingsRes.rows.length === 0
              ) {
                return;
              }
              var row = settingsRes.rows[0];
              var snapshot = {
                application: "metachain-group",
                messageType: "group_update_details",
                groupId: safeGroupId,
                newName: row.NAME || row.name || "",
                newDescription: row.DESCRIPTION || row.description || "",
                avatar: row.AVATAR || row.avatar || "",
                auto_approve:
                  row.AUTO_APPROVE === true ||
                  row.auto_approve === true ||
                  row.AUTO_APPROVE === 1 ||
                  row.auto_approve === 1 ||
                  String(row.AUTO_APPROVE).toUpperCase() === "TRUE" ||
                  String(row.auto_approve).toUpperCase() === "TRUE",
                timestamp: Date.now(),
              };
              MDS.log(
                "📤 [GROUP-ROLE] Sending settings snapshot to promoted admin " +
                safeTargetPubkey.substring(0, 10),
              );
              sendMaximaGroupMsg(safeTargetPubkey, snapshot);
            });
          }
        } else {
          MDS.log("❌ [DB] Failed to update role: " + updateRes.error);
        }
      });
    });
  });
}

function handleGroupJoinRequestEvent(pubkey, maxjson) {
  logToUI(
    "📨 [GROUP-JOIN] Received Join Request Event (Type: " +
    (maxjson.messageType || maxjson.type) +
    ") from " +
    pubkey.substring(0, 10),
  );
  try {
    logToUI(
      "🔄 [GROUP-JOIN] Processing event: " +
      (maxjson.messageType || maxjson.type) +
      " from " +
      pubkey.substring(0, 10),
    );
    var safeGroupId = escapeSql(maxjson.groupId || "");
    var safeTimestamp = Number(maxjson.timestamp) || Date.now();

    // 1. Resolve our public key in case the global didn't load yet
    if (
      typeof MY_MAXIMA_PK === "undefined" ||
      !MY_MAXIMA_PK ||
      MY_MAXIMA_PK === ""
    ) {
      MDS.cmd("maxima", function (maxRes) {
        if (maxRes.status) {
          if (typeof self !== "undefined") {
            self.MY_MAXIMA_PK = maxRes.response.publickey;
          } else if (typeof globalThis !== "undefined") {
            globalThis.MY_MAXIMA_PK = maxRes.response.publickey;
          }
          var resolvedPk = maxRes.response.publickey;
          MDS.log("🔑 [GROUP-JOIN] Recovered local Maxima PK.");
          executeJoinRequestAuth(
            pubkey,
            maxjson,
            safeGroupId,
            safeTimestamp,
            resolvedPk,
          );
        } else {
          MDS.log("❌ [GROUP-JOIN] Failed to get local Maxima info");
        }
      });
    } else {
      executeJoinRequestAuth(
        pubkey,
        maxjson,
        safeGroupId,
        safeTimestamp,
        MY_MAXIMA_PK,
      );
    }
  } catch (err) {
    MDS.log(
      "🔥 [GROUP-JOIN] CRASH in handleGroupJoinRequestEvent: " + err.message,
    );
  }
}

function executeJoinRequestAuth(
  pubkey,
  maxjson,
  safeGroupId,
  safeTimestamp,
  localPk
) {
  try {
    // 2. Verify we are an admin/creator of this group. If not, ignore.
    var checkSenderSql =
      "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
      safeGroupId +
      "' AND UPPER(publickey)=UPPER('" +
      localPk +
      "')";
    MDS.sql(checkSenderSql, function (resSender) {
      logToUI(
        "📝 [GROUP-JOIN] Membership check result: " +
        (resSender.status ? "OK" : "ERROR: " + resSender.error),
      );
      try {
        if (!resSender.status) {
          logToUI(
            "❌ [GROUP-JOIN] SQL Error validating group membership: " +
            resSender.error,
          );
          return;
        }
        if (!resSender.rows || resSender.rows.length === 0) {
          logToUI(
            "⚠️ [GROUP-JOIN] Ignored. We are not in group " + safeGroupId,
          );
          return;
        }
        logToUI(
          "📝 [GROUP-JOIN] Validating admin role for " +
          localPk.substring(0, 10) +
          " in " +
          safeGroupId,
        );
        var myRole = resSender.rows[0].ROLE || resSender.rows[0].role;
        logToUI("📝 [GROUP-JOIN] My role in " + safeGroupId + " is " + myRole);
        if (myRole !== "creator" && myRole !== "admin") {
          logToUI(
            "⚠️ [GROUP-JOIN] Ignored. We are not an admin/creator of group " +
            safeGroupId +
            " (Role: " +
            myRole +
            ")",
          );
          return;
        }

        // Check if auto-approve is enabled for this group
        var checkAutoApproveSql =
          "SELECT auto_approve, name, description, created_date FROM GROUPS WHERE group_id='" +
          safeGroupId +
          "'";
        MDS.sql(checkAutoApproveSql, function (groupRes) {
          var autoApproveEnabled = false;
          var groupName = "";
          var groupDesc = "";
          var groupCreatedDate = Date.now();
          if (groupRes.status && groupRes.rows && groupRes.rows.length > 0) {
            var row = groupRes.rows[0];
            autoApproveEnabled =
              row.AUTO_APPROVE === 1 ||
              row.auto_approve === 1 ||
              row.AUTO_APPROVE === true ||
              row.auto_approve === true ||
              String(row.AUTO_APPROVE).toUpperCase() === "TRUE" ||
              String(row.auto_approve).toUpperCase() === "TRUE";
            groupName = row.NAME || row.name || "";
            groupDesc = row.DESCRIPTION || row.description || "";
            groupCreatedDate =
              row.CREATED_DATE || row.created_date || Date.now();
            logToUI(
              "📝 [GROUP-JOIN] Found group info: " +
              groupName +
              " | auto_approve value: " +
              (row.AUTO_APPROVE !== undefined
                ? row.AUTO_APPROVE
                : row.auto_approve) +
              " | Type: " +
              typeof (row.AUTO_APPROVE !== undefined
                ? row.AUTO_APPROVE
                : row.auto_approve),
            );
          }
          logToUI(
            "📝 [GROUP-JOIN] final autoApproveEnabled evaluated to: " +
            autoApproveEnabled,
          );

          // =========================================================
          // A) NEW REQUEST: from a regular user wanting to join
          // =========================================================
          if (maxjson.messageType === "group_join_request") {
            var requesterPubkey = escapeSql(pubkey);
            var requesterName = escapeSql(maxjson.requesterName || "Unknown");
            var requesterAddress = escapeSql(maxjson.requesterAddress || "");
            MDS.log(
              "📝 [GROUP-JOIN] Processing new join request from " +
              requesterName +
              " (" +
              requesterPubkey.substring(0, 10) +
              ")",
            );

            // Helper: seed DISCOVERED_PEERS
            var seedRequesterPeer = function (onDone) {
              if (!requesterAddress) {
                onDone();
                return;
              }
              var now = Date.now();
              var delPeer =
                "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
                requesterPubkey +
                "')";
              MDS.sql(delPeer, function () {
                var insPeer =
                  "INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar) VALUES ('" +
                  requesterPubkey +
                  "', '" +
                  requesterAddress +
                  "', 'GROUP_JOIN', '" +
                  requesterName +
                  "', " +
                  now +
                  ", '')";
                MDS.sql(insPeer, function () {
                  onDone();
                });
              });
            };

            // Helper: Auto-approve or Propagate
            var handleAutoApproveOrPropagate = function () {
              MDS.log(
                "📝 [GROUP-JOIN] handleAutoApproveOrPropagate: autoApproveEnabled=" +
                autoApproveEnabled,
              );
              if (autoApproveEnabled) {
                MDS.log(
                  "🚀 [GROUP-JOIN] Auto-approving request for " + requesterName,
                );
                var now = Date.now();
                var addMemberSql =
                  "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) SELECT '" +
                  safeGroupId +
                  "', '" +
                  requesterPubkey +
                  "', '" +
                  requesterName +
                  "', " +
                  now +
                  ", 'member' WHERE NOT EXISTS (SELECT 1 FROM GROUP_MEMBERS WHERE group_id='" +
                  safeGroupId +
                  "' AND UPPER(publickey)=UPPER('" +
                  requesterPubkey +
                  "'))";

                MDS.sql(addMemberSql, function (addRes) {
                  if (addRes.status) {
                    sendMemberAddedNotificationSW(
                      safeGroupId,
                      groupName,
                      requesterPubkey,
                      requesterName,
                      requesterAddress,
                      localPk,
                    );
                    MDS.sql(
                      "SELECT publickey, username FROM GROUP_MEMBERS WHERE group_id='" +
                      safeGroupId +
                      "' AND (role='creator') LIMIT 1",
                      function (creatorRes) {
                        var creatorPk = localPk;
                        var creatorName = "Admin";
                        if (
                          creatorRes.status &&
                          creatorRes.rows &&
                          creatorRes.rows.length > 0
                        ) {
                          creatorPk =
                            creatorRes.rows[0].PUBLICKEY ||
                            creatorRes.rows[0].publickey;
                          creatorName =
                            creatorRes.rows[0].USERNAME ||
                            creatorRes.rows[0].username;
                        }
                        MDS.sql(
                          "SELECT * FROM GROUP_MEMBERS WHERE group_id='" +
                          safeGroupId +
                          "'",
                          function (membersRes) {
                            var members = membersRes.rows || [];
                            sendGroupInviteSW(
                              safeGroupId,
                              groupName,
                              groupDesc,
                              requesterPubkey,
                              localPk,
                              "Admin",
                              members,
                              groupCreatedDate,
                              creatorPk,
                              creatorName
                            );
                          },
                        );
                      },
                    );
                    broadcastJoinRequestToAdmins(
                      "group_join_request_resolved",
                      safeGroupId,
                      requesterPubkey,
                      requesterName,
                      requesterAddress,
                      safeTimestamp,
                      "approved",
                    );
                    MDS.sql(
                      "DELETE FROM GROUP_JOIN_REQUESTS WHERE group_id='" +
                      safeGroupId +
                      "' AND publickey='" +
                      requesterPubkey +
                      "'",
                      function () {
                        MDS.comms.solo(
                          JSON.stringify({
                            type: "group_join_requests_update",
                            groupId: safeGroupId,
                          }),
                        );
                      },
                    );
                  }
                });
              } else {
                MDS.comms.solo(
                  JSON.stringify({
                    type: "group_join_requests_update",
                    groupId: safeGroupId,
                  }),
                );
                broadcastJoinRequestToAdmins(
                  "group_join_request_propagated",
                  safeGroupId,
                  requesterPubkey,
                  requesterName,
                  requesterAddress,
                  safeTimestamp,
                );
              }
            };

            // Helper: Re-send invite
            var reSendInviteToMember = function () {
              MDS.sql(
                "SELECT publickey, username FROM GROUP_MEMBERS WHERE group_id='" +
                safeGroupId +
                "' AND (role='creator') LIMIT 1",
                function (creatorRes) {
                  var creatorPk = localPk;
                  var creatorName = "Admin";
                  if (
                    creatorRes.status &&
                    creatorRes.rows &&
                    creatorRes.rows.length > 0
                  ) {
                    creatorPk =
                      creatorRes.rows[0].PUBLICKEY ||
                      creatorRes.rows[0].publickey;
                    creatorName =
                      creatorRes.rows[0].USERNAME ||
                      creatorRes.rows[0].username;
                  }
                  MDS.sql(
                    "SELECT * FROM GROUP_MEMBERS WHERE group_id='" +
                    safeGroupId +
                    "'",
                    function (membersRes) {
                      var members = membersRes.rows || [];
                      logToUI(
                        "📤 [GROUP-JOIN] Re-sending group invite to " +
                        requesterPubkey.substring(0, 10),
                      );
                      sendGroupInviteSW(
                        safeGroupId,
                        groupName,
                        groupDesc,
                        requesterPubkey,
                        localPk,
                        "Admin",
                        members,
                        groupCreatedDate,
                        creatorPk,
                        creatorName
                      );
                    },
                  );
                },
              );
            };

            // Check if already a member (case-insensitive to handle 0X vs 0x casing)
            var checkMemberSql =
              "SELECT * FROM GROUP_MEMBERS WHERE group_id='" +
              safeGroupId +
              "' AND UPPER(publickey)=UPPER('" +
              requesterPubkey +
              "')";
            MDS.sql(checkMemberSql, function (memberRes) {
              try {
                if (
                  memberRes.status &&
                  memberRes.rows &&
                  memberRes.rows.length > 0
                ) {
                  logToUI(
                    "ℹ️ [GROUP-JOIN] User already a member. Re-sending invite just in case.",
                  );
                  reSendInviteToMember();
                  return;
                }
                // Check if banned
                var checkBanSql =
                  "SELECT * FROM GROUP_BANS WHERE group_id='" +
                  safeGroupId +
                  "' AND UPPER(publickey)=UPPER('" +
                  requesterPubkey +
                  "')";
                MDS.sql(checkBanSql, function (banRes) {
                  try {
                    if (
                      banRes.status &&
                      banRes.rows &&
                      banRes.rows.length > 0
                    ) {
                      MDS.log(
                        "🚫 [GROUP-JOIN] Discarding request from banned user.",
                      );
                      return;
                    }

                    // Insert/Replace in GROUP_JOIN_REQUESTS
                    var insertReqSql =
                      "MERGE INTO GROUP_JOIN_REQUESTS (group_id, publickey, username, address, status, timestamp) KEY (group_id, publickey) VALUES " +
                      "('" +
                      safeGroupId +
                      "', '" +
                      requesterPubkey +
                      "', '" +
                      requesterName +
                      "', '" +
                      requesterAddress +
                      "', 'pending', " +
                      safeTimestamp +
                      ")";

                    MDS.sql(insertReqSql, function (insertRes) {
                      try {
                        if (insertRes.status) {
                          MDS.log(
                            "✅ [GROUP-JOIN] Request saved locally (MERGE).",
                          );
                          seedRequesterPeer(handleAutoApproveOrPropagate);
                        } else {
                          // Fallback for older H2
                          var updateSql =
                            "UPDATE GROUP_JOIN_REQUESTS SET username='" +
                            requesterName +
                            "', address='" +
                            requesterAddress +
                            "', status='pending', timestamp=" +
                            safeTimestamp +
                            " WHERE group_id='" +
                            safeGroupId +
                            "' AND publickey='" +
                            requesterPubkey +
                            "'";
                          MDS.sql(updateSql, function (upRes) {
                            var afterSave = function () {
                              MDS.log(
                                "✅ [GROUP-JOIN] Request saved locally (Fallback).",
                              );
                              seedRequesterPeer(handleAutoApproveOrPropagate);
                            };
                            if (upRes.status && !upRes.count) {
                              var backupInsert =
                                "INSERT INTO GROUP_JOIN_REQUESTS (group_id, publickey, username, address, status, timestamp) VALUES ('" +
                                safeGroupId +
                                "', '" +
                                requesterPubkey +
                                "', '" +
                                requesterName +
                                "', '" +
                                requesterAddress +
                                "', 'pending', " +
                                safeTimestamp +
                                ")";
                              MDS.sql(backupInsert, function () {
                                afterSave();
                              });
                            } else {
                              afterSave();
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
            var senderCheck =
              "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
              safeGroupId +
              "' AND UPPER(publickey)=UPPER('" +
              escapeSql(pubkey) +
              "')";
            MDS.sql(senderCheck, function (sRes) {
              try {
                if (!sRes.status || !sRes.rows || sRes.rows.length === 0) {
                  MDS.log(
                    "❌ [GROUP-JOIN] Propagated request ignored: sender not found.",
                  );
                  return;
                }
                var senderRole = sRes.rows[0].ROLE || sRes.rows[0].role;
                if (senderRole !== "admin" && senderRole !== "creator") {
                  MDS.log(
                    "❌ [GROUP-JOIN] Propagated request ignored: sender role is " +
                    senderRole,
                  );
                  return;
                }

                var reqPk = escapeSql(maxjson.requesterPubkey);
                var reqName = escapeSql(maxjson.requesterName);
                var reqAddr = escapeSql(maxjson.requesterAddress);
                var origTs = Number(maxjson.originalTimestamp) || safeTimestamp;

                var updateSql =
                  "UPDATE GROUP_JOIN_REQUESTS SET username='" +
                  reqName +
                  "', address='" +
                  reqAddr +
                  "', status='pending', timestamp=" +
                  origTs +
                  " WHERE group_id='" +
                  safeGroupId +
                  "' AND publickey='" +
                  reqPk +
                  "'";
                MDS.sql(updateSql, function (upRes) {
                  if (upRes.status && !upRes.count) {
                    var backupInsert =
                      "INSERT INTO GROUP_JOIN_REQUESTS (group_id, publickey, username, address, status, timestamp) VALUES ('" +
                      safeGroupId +
                      "', '" +
                      reqPk +
                      "', '" +
                      reqName +
                      "', '" +
                      reqAddr +
                      "', 'pending', " +
                      origTs +
                      ")";
                    MDS.sql(backupInsert, function () {
                      MDS.log("✅ [GROUP-JOIN] Propagated request saved.");
                      MDS.comms.solo(
                        JSON.stringify({
                          type: "group_join_requests_update",
                          groupId: safeGroupId,
                        }),
                      );
                    });
                  } else {
                    MDS.log("✅ [GROUP-JOIN] Propagated request updated.");
                    MDS.comms.solo(
                      JSON.stringify({
                        type: "group_join_requests_update",
                        groupId: safeGroupId,
                      }),
                    );
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
            var senderCheck =
              "SELECT role FROM GROUP_MEMBERS WHERE group_id='" +
              safeGroupId +
              "' AND UPPER(publickey)=UPPER('" +
              escapeSql(pubkey) +
              "')";
            MDS.sql(senderCheck, function (sRes) {
              try {
                if (!sRes.status || !sRes.rows || sRes.rows.length === 0)
                  return;
                var senderRole = sRes.rows[0].ROLE || sRes.rows[0].role;
                if (senderRole !== "admin" && senderRole !== "creator") return;

                var reqPk = escapeSql(maxjson.requesterPubkey);
                var resolveSql =
                  "DELETE FROM GROUP_JOIN_REQUESTS WHERE group_id='" +
                  safeGroupId +
                  "' AND publickey='" +
                  reqPk +
                  "'";
                MDS.sql(resolveSql, function () {
                  MDS.comms.solo(
                    JSON.stringify({
                      type: "group_join_requests_update",
                      groupId: safeGroupId,
                    }),
                  );
                });
              } catch (e) {
                MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
              }
            });
          }
        });
      } catch (e) {
        MDS.log("🔥 [GROUP-JOIN] Sync crash: " + e.message);
      }
    });
  } catch (err) {
    MDS.log("🔥 [GROUP-JOIN] Crash: " + err.message);
  }
}

function broadcastJoinRequestToAdmins(
  msgType,
  groupId,
  reqPubkey,
  reqName,
  reqAddress,
  timestamp,
  resolutionStatus
) {
  var sql =
    "SELECT * FROM GROUP_MEMBERS WHERE group_id='" +
    escapeSql(groupId) +
    "' AND (role='creator' OR role='admin')";
  MDS.sql(sql, function (res) {
    if (!res.status || !res.rows) return;
    var msg = {
      application: "metachain-group",
      messageType: msgType,
      groupId: groupId,
      requesterPubkey: reqPubkey,
      requesterName: reqName,
      requesterAddress: reqAddress,
      originalTimestamp: timestamp,
    };
    if (resolutionStatus) msg.resolutionStatus = resolutionStatus;
    var hexData = "0x" + utf8ToHex(JSON.stringify(msg)).toUpperCase();
    var sendToAdmin = function (index) {
        if (index >= res.rows.length) return;
        var adminPk = res.rows[index].PUBLICKEY || res.rows[index].publickey;
        if (adminPk.toUpperCase() === MY_MAXIMA_PK.toUpperCase()) {
            sendToAdmin(index + 1);
            return;
        }

        smartSend(adminPk, "metachain-group", hexData, "GROUP-ADMIN-NOTIFY", false);
        sendToAdmin(index + 1);
    };
    sendToAdmin(0);
  });
}

function sendMaximaGroupMsg(toPk, payloadObj) {
  var hexData = "0x" + utf8ToHex(JSON.stringify(payloadObj)).toUpperCase();
  logToUI("🚀 [GROUP-MSG] Sending to " + toPk.substring(0, 10) + " type: " + payloadObj.messageType);
  smartSend(toPk, "metachain-group", hexData, "GROUP-MSG", false);
}

function sendMemberAddedNotificationSW(
  groupId,
  groupName,
  newMemberPk,
  newMemberName,
  newMemberAddress,
  myPk
) {
  var sql =
    "SELECT publickey FROM GROUP_MEMBERS WHERE group_id='" +
    escapeSql(groupId) +
    "'";
  MDS.sql(sql, function (res) {
    if (!res.status || !res.rows) return;
    var notification = {
      application: "metachain-group",
      messageType: "group_member_added",
      groupId: groupId,
      groupName: groupName,
      memberPublicKey: newMemberPk,
      memberUsername: newMemberName,
      memberAddress: newMemberAddress,
    };
    for (var i = 0; i < res.rows.length; i++) {
      var mPk = res.rows[i].PUBLICKEY || res.rows[i].publickey;
      if (
        mPk.toUpperCase() !== myPk.toUpperCase() &&
        mPk.toUpperCase() !== newMemberPk.toUpperCase()
      ) {
        sendMaximaGroupMsg(mPk, notification);
      }
    }
  });
}

function sendGroupInviteSW(
  groupId,
  groupName,
  groupDesc,
  toPk,
  myPk,
  myName,
  members,
  createdDate,
  creatorPk,
  creatorName
) {
  var normalizedMembers = [];
  for (var i = 0; i < (members || []).length; i++) {
    var member = members[i] || {};
    normalizedMembers.push({
      publickey: member.publickey || member.PUBLICKEY || "",
      username: member.username || member.USERNAME || "Unknown",
      role: member.role || member.ROLE || "member",
      address: member.address || member.ADDRESS || "",
    });
  }
  var invite = {
    application: "metachain-group",
    messageType: "group_invite",
    groupId: groupId,
    groupName: groupName,
    groupDescription: groupDesc,
    members: normalizedMembers,
    createdDate: createdDate,
    creatorPublicKey: creatorPk,
    creatorUsername: creatorName,
  };
  sendMaximaGroupMsg(toPk, invite);
}

/**
 * MetaChain Service Worker - Channel Handler
 * Handles all Maxima messages for the metachain-channel application.
 */

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function channelRunSQL(query, callback) {
  MDS.sql(query, function (res) {
    if (callback) callback(res);
  });
}

// (Using shared helpers from utils.js)

// ─── Channel sync guard ─────────────────────────────────────────────────────
// Prevents multiple concurrent history requests for the same channel.
// Cleared on first response received or after timeout.
var _pendingChannelSyncs = {}; // channelId -> startedAt (Date.now())
var CHANNEL_SYNC_TIMEOUT_MS = 30000;

/**
 * Called from MDS_TIMER_10SECONDS in main.js.
 * Clears stale guards so a new sync can be triggered after timeout.
 */
function checkChannelSyncTimeouts() {
  var now = Date.now();
  for (var channelId in _pendingChannelSyncs) {
    if (!_pendingChannelSyncs.hasOwnProperty(channelId)) continue;
    if (now - _pendingChannelSyncs[channelId] > CHANNEL_SYNC_TIMEOUT_MS) {
      MDS.log("⏱️ [CHANNEL-SYNC] Timeout for " + channelId + ". Clearing guard.");
      delete _pendingChannelSyncs[channelId];
      MDS.comms.solo(JSON.stringify({ type: "CHANNEL_SYNC_END", channelId: channelId }));
    }
  }
}

// ---------------------------------------------------------------------------
// channel_invite
// ---------------------------------------------------------------------------

function handleChannelInvite(pubkey, maxjson) {
  try {
    MDS.log("📢 [CHANNEL] handleChannelInvite from " + pubkey.substring(0, 10));

    var channelId = maxjson.channelId;
    var channelName = (maxjson.channelName || "").replace(/'/g, "''");
    var description = (maxjson.description || "").replace(/'/g, "''");
    var adminPublickey = (maxjson.adminPublickey || pubkey).replace(/'/g, "''");
    var createdDate = maxjson.createdDate || maxjson.timestamp || Date.now();
    var avatar = "";
    if (typeof maxjson.avatar === "string") {
      avatar = maxjson.avatar.replace(/'/g, "''");
    }
    var myPublickey = maxjson.inviteePublickey || "";
    var myUsername = (maxjson.inviteeUsername || "Unknown").replace(/'/g, "''");

    // 1. Check if channel exists
    channelRunSQL(
      "SELECT channel_id FROM CHANNELS WHERE channel_id = '" + channelId + "'",
      function (res) {
        if (res.rows && res.rows.length > 0) {
          MDS.log(
            "ℹ️ [CHANNEL] Channel " + channelId + " already exists. Skipping.",
          );
          return;
        }

        // 2. Insert Channel
        var insChannel =
          "INSERT INTO CHANNELS (channel_id, name, description, admin_publickey, created_date, avatar) " +
          "VALUES ('" +
          channelId +
          "', '" +
          channelName +
          "', '" +
          description +
          "', '" +
          adminPublickey +
          "', " +
          createdDate +
          ", '" +
          avatar +
          "')";

        channelRunSQL(insChannel, function (insRes) {
          if (insRes.status) {
            // 3. Insert Me as subscriber
            var insMe =
              "INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role) " +
              "VALUES ('" +
              channelId +
              "', '" +
              myPublickey +
              "', '" +
              myUsername +
              "', " +
              Date.now() +
              ", 'subscriber')";

            channelRunSQL(insMe, function (subRes) {
              if (subRes.status) {
                MDS.log(
                  "✅ [CHANNEL] Successfully joined channel " + channelId,
                );

                // 4. Insert admin as subscriber so history sync can reach them
                var adminUsername = (maxjson.adminUsername || "Admin").replace(/'/g, "''");
                var insAdmin =
                  "MERGE INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role) " +
                  "KEY (channel_id, publickey) " +
                  "VALUES ('" + channelId + "', UPPER('" + adminPublickey + "'), '" + adminUsername + "', " + Date.now() + ", 'admin')";
                channelRunSQL(insAdmin, function () {
                  MDS.comms.solo(
                    JSON.stringify({
                      type: "CHANNEL_UPDATE",
                      channelId: channelId,
                    }),
                  );

                  // 5. Request history immediately after joining
                  requestChannelHistoryFromSW(channelId);
                });
              }
            });
          }
        });
      },
    );
  } catch (err) {
    MDS.log("🔥 [CHANNEL] CRASH in handleChannelInvite: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// channel_message
// ---------------------------------------------------------------------------

function handleChannelMessage(senderPublickey, maxjson, skipNotify) {
  if (!maxjson) return;
  var channelId = maxjson.channelId;
  var type = (maxjson.messageContentType || "text").replace(/'/g, "''");
  var message = (maxjson.message || "").replace(/'/g, "''");
  var filedata = (maxjson.filedata || "").replace(/'/g, "''");
  var date = maxjson.timestamp || Date.now();
  var senderUsername = (maxjson.senderUsername || "Unknown").replace(
    /'/g,
    "''",
  );

  MDS.log(
    "📢 [CHANNEL] handleChannelMessage from " +
    senderPublickey.substring(0, 10),
  );

  if (!channelId) {
    MDS.log("❌ [CHANNEL] channel_message missing channelId");
    return;
  }

  // 1. Check we actually have this channel (subscriber check)
  channelRunSQL(
    "SELECT channel_id FROM CHANNELS WHERE channel_id = '" + channelId + "'",
    function (res) {
      if (!res.rows || res.rows.length === 0) {
        MDS.log(
          "⚠️ [CHANNEL] Received message for unknown channel " +
          channelId +
          ". Ignoring.",
        );
        return;
      }

      var senderSeq = maxjson.sender_seq || 0;
      var forwarded = maxjson.forwarded ? 1 : 0;

      // 2. Duplicate Check
      var checkSql =
        "SELECT id FROM CHANNEL_MESSAGES WHERE channel_id='" +
        channelId +
        "' AND UPPER(sender_publickey)=UPPER('" +
        senderPublickey +
        "') AND date=" +
        date;
      MDS.sql(checkSql, function (checkRes) {
        if (checkRes.status && checkRes.rows && checkRes.rows.length > 0) {
          MDS.log("ℹ️ [CHANNEL-MSG] Duplicate message detected. Ignoring.");
          return;
        }

        // 3. Gap Detection / Sequence Tracking
        var counterSql =
          "SELECT last_seen_seq FROM CHANNEL_MSG_COUNTERS WHERE channel_id='" +
          channelId +
          "' AND UPPER(sender_publickey)=UPPER('" +
          senderPublickey +
          "')";

        MDS.sql(counterSql, function (counterRes) {
          var lastSeen =
            counterRes.status && counterRes.rows && counterRes.rows.length > 0
              ? parseInt(counterRes.rows[0].LAST_SEEN_SEQ)
              : 0;

          if (senderSeq > 1 && senderSeq > lastSeen + 1) {
            MDS.log(
              "⚠️ [CHANNEL-GAP] Detected gap for " +
              channelId +
              ": last=" +
              lastSeen +
              ", new=" +
              senderSeq +
              ". Requesting history...",
            );
            requestChannelHistoryFromSW(channelId);
          }

          // 4. Save Message
          var cmd =
            "INSERT INTO CHANNEL_MESSAGES (channel_id, sender_publickey, sender_username, type, message, filedata, date, read, sender_seq, forwarded) " +
            "VALUES ('" +
            channelId +
            "', '" +
            senderPublickey +
            "', '" +
            senderUsername +
            "', '" +
            type +
            "', '" +
            message +
            "', '" +
            filedata +
            "', " +
            date +
            ", 0, " +
            senderSeq +
            ", " + (forwarded ? 1 : 0) + ")";

          channelRunSQL(cmd, function (insRes) {
            if (insRes.status) {
              // 5. Update Counter
              if (senderSeq > lastSeen) {
                var upCounterSql =
                  "MERGE INTO CHANNEL_MSG_COUNTERS (channel_id, sender_publickey, last_seen_seq) " +
                  "KEY (channel_id, sender_publickey) " +
                  "VALUES ('" +
                  channelId +
                  "', UPPER('" +
                  senderPublickey +
                  "'), " +
                  senderSeq +
                  ")";
                MDS.sql(upCounterSql);
              }

              // 6. Notify UI
              if (!skipNotify) {
                MDS.comms.solo(
                  JSON.stringify({
                    type: "CHANNEL_NEW_MESSAGE",
                    channelId: channelId,
                  }),
                );
              }
              MDS.log(
                "✅ [CHANNEL] Saved channel message for: " +
                channelId +
                " (seq: " +
                senderSeq +
                ")",
              );
            } else {
              MDS.log("❌ [CHANNEL] Save failed: " + insRes.error);
            }
          });
        });
      });
    },
  );
}

// ---------------------------------------------------------------------------
// History Sync
// ---------------------------------------------------------------------------

function handleChannelHistoryRequest(pubkey, maxjson) {
  var channelId = maxjson.channelId;
  var since = maxjson.historySince || 0;
  MDS.log(
    "🔄 [CHANNEL-SYNC] History requested for " + channelId + " since " + since,
  );

  var sql =
    "SELECT * FROM CHANNEL_MESSAGES WHERE channel_id='" +
    escapeSql(channelId) +
    "' AND date > " +
    since +
    " ORDER BY date ASC LIMIT 50";
  MDS.sql(sql, function (res) {
    var historyMessages = [];
    if (res.status && res.rows && res.rows.length > 0) {
      for (var i = 0; i < res.rows.length; i++) {
        var row = res.rows[i];
        historyMessages.push({
          messageType: "channel_message",
          channelId: channelId,
          channelName: "",
          senderPublickey: row.SENDER_PUBLICKEY || row.sender_publickey,
          senderUsername: row.SENDER_USERNAME || row.sender_username,
          message: row.MESSAGE || row.message,
          messageContentType: row.TYPE || row.type,
          filedata: row.FILEDATA || row.filedata,
          timestamp: Number(row.DATE || row.date),
          sender_seq: Number(row.SENDER_SEQ || row.sender_seq || 0),
          forwarded: row.FORWARDED === true || row.FORWARDED === 'true' || row.FORWARDED === 1,
        });
      }
    }

    var responsePayload = {
      app: "metachain-channel",
      messageType: "channel_history_response",
      channelId: channelId,
      channelName: "",
      timestamp: Date.now(),
      historyMessages: historyMessages,
    };

    var hexData = "0x" + utf8ToHex(JSON.stringify(responsePayload)).toUpperCase();
    smartSend(pubkey, "metachain-channel", hexData, "CHANNEL-HISTORY-RESP", false);
  });
}

function handleChannelHistoryResponse(pubkey, maxjson) {
  var channelId = maxjson.channelId;
  // Clear sync guard — response received
  delete _pendingChannelSyncs[channelId];

  var messages = maxjson.historyMessages || [];

  MDS.log(
    "🔄 [CHANNEL-SYNC] Received " +
    messages.length +
    " history messages for " +
    channelId,
  );

  // Save them using the regular handler logic (skip notify per message)
  for (var i = 0; i < messages.length; i++) {
    handleChannelMessage(messages[i].senderPublickey, messages[i], true);
  }

  // Single notification at the end
  MDS.comms.solo(
    JSON.stringify({
      type: "CHANNEL_NEW_MESSAGE",
      channelId: channelId,
    }),
  );
  // Signal sync end immediately
  MDS.comms.solo(
    JSON.stringify({
      type: "CHANNEL_SYNC_END",
      channelId: channelId,
    }),
  );
}

function requestChannelHistoryFromSW(channelId) {
  // Guard: skip if sync already in flight for this channel
  if (_pendingChannelSyncs[channelId]) {
    MDS.log("ℹ️ [CHANNEL-SYNC] Already in flight for " + channelId + ". Skipping.");
    return;
  }
  _pendingChannelSyncs[channelId] = Date.now();

  MDS.log(
    "🔄 [CHANNEL-SYNC] Requesting history for channel " + channelId + "...",
  );

  // Signal sync start
  MDS.comms.solo(
    JSON.stringify({
      type: "CHANNEL_SYNC_START",
      channelId: channelId,
    }),
  );

  MDS.cmd("maxima action:info", function (maxInfo) {
    if (!maxInfo.status) return;
    var myPubkey = maxInfo.response.publickey;

    var lastSql =
      "SELECT date FROM CHANNEL_MESSAGES WHERE channel_id='" +
      escapeSql(channelId) +
      "' ORDER BY date DESC LIMIT 1";
    MDS.sql(lastSql, function (lastRes) {
      var lastTimestamp =
        lastRes.status && lastRes.rows && lastRes.rows.length > 0
          ? Number(lastRes.rows[0].DATE || lastRes.rows[0].date || 0)
          : 0;

      var requestPayload = {
        app: "metachain-channel",
        messageType: "channel_history_request",
        channelId: channelId,
        channelName: "SYNC",
        timestamp: Date.now(),
        historySince: lastTimestamp,
      };
      var hexData =
        "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

      var subSql =
        "SELECT cs.publickey, dp.address FROM CHANNEL_SUBSCRIBERS cs LEFT JOIN DISCOVERED_PEERS dp ON UPPER(cs.publickey)=UPPER(dp.publickey) WHERE cs.channel_id='" +
        escapeSql(channelId) +
        "'";
      MDS.sql(subSql, function (subRes) {
        if (!subRes.status || !subRes.rows) {
          delete _pendingChannelSyncs[channelId];
          MDS.comms.solo(
            JSON.stringify({
              type: "CHANNEL_SYNC_END",
              channelId: channelId,
            }),
          );
          return;
        }
        var sentCount = 0;
        for (var i = 0; i < subRes.rows.length; i++) {
          var row = subRes.rows[i];
          var subPk = row.PUBLICKEY || row.publickey;
          if (subPk && myPubkey && subPk.toUpperCase() === myPubkey.toUpperCase()) continue;
          var addr = row.ADDRESS || row.address;
          // Use smartSend for address resolution fallback
          smartSend(subPk, "metachain-channel", hexData, "CHANNEL-HISTORY-SYNC", false, addr);
          sentCount++;
        }

        // No eligible remote peers (or only self): finish immediately.
        if (sentCount === 0) {
          MDS.log(
            "ℹ️ [CHANNEL-SYNC] No remote subscribers to request history from.",
          );
          delete _pendingChannelSyncs[channelId];
          MDS.comms.solo(
            JSON.stringify({
              type: "CHANNEL_SYNC_END",
              channelId: channelId,
            }),
          );
        }
      });
    });
  });
}

function requestAllChannelsHistory() {
  MDS.log("🔄 [CHANNEL-SYNC] Startup sync for all channels...");
  MDS.sql("SELECT channel_id FROM CHANNELS", function (res) {
    if (!res.status || !res.rows || res.rows.length === 0) return;
    for (var i = 0; i < res.rows.length; i++) {
      requestChannelHistoryFromSW(
        res.rows[i].CHANNEL_ID || res.rows[i].channel_id,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// channel_info_updated
// ---------------------------------------------------------------------------

function handleChannelInfoUpdate(pubkey, maxjson) {
  MDS.log(
    "📢 [CHANNEL] handleChannelInfoUpdate from " + pubkey.substring(0, 10),
  );

  var channelId = maxjson.channelId;
  if (!channelId) return;

  var updates = [];
  if (maxjson.newName)
    updates.push("name='" + maxjson.newName.replace(/'/g, "''") + "'");
  if (maxjson.newDescription !== undefined)
    updates.push(
      "description='" +
      (maxjson.newDescription || "").replace(/'/g, "''") +
      "'",
    );
  if (maxjson.avatar !== undefined)
    updates.push("avatar='" + (maxjson.avatar || "").replace(/'/g, "''") + "'");

  if (updates.length === 0) return;

  var cmd =
    "UPDATE CHANNELS SET " +
    updates.join(", ") +
    " WHERE channel_id='" +
    channelId +
    "'";
  channelRunSQL(cmd, function (res) {
    if (res.status) {
      MDS.log("✅ [CHANNEL-UPDATE] Real-time info update for " + channelId);
      MDS.comms.solo(
        JSON.stringify({
          type: "CHANNEL_UPDATE",
          channelId: channelId,
        }),
      );
    } else {
      MDS.log("❌ [CHANNEL] handleChannelInfoUpdate error: " + res.error);
    }
  });
}

// ---------------------------------------------------------------------------
// channel_role_update
// ---------------------------------------------------------------------------

function handleChannelRoleUpdate(pubkey, maxjson) {
  MDS.log(
    "📢 [CHANNEL] handleChannelRoleUpdate from " + pubkey.substring(0, 10),
  );

  var channelId = maxjson.channelId;
  var targetPubkey = (maxjson.targetPubkey || "").replace(/'/g, "''");
  var newRole = (maxjson.newRole || "subscriber").replace(/'/g, "''");

  if (!channelId || !targetPubkey) {
    MDS.log(
      "❌ [CHANNEL-ROLE] Missing required fields (channelId or targetPubkey)",
    );
    return;
  }

  var checkSenderSql =
    "SELECT role FROM CHANNEL_SUBSCRIBERS WHERE channel_id='" +
    channelId +
    "' AND publickey='" +
    pubkey +
    "'";
  MDS.sql(checkSenderSql, function (resSender) {
    if (!resSender.status || !resSender.rows || resSender.rows.length === 0)
      return;

    var senderRole = (
      resSender.rows[0].ROLE ||
      resSender.rows[0].role ||
      ""
    ).toLowerCase();
    if (senderRole !== "admin") return;

    var updateSql =
      "UPDATE CHANNEL_SUBSCRIBERS SET role='" +
      newRole +
      "' WHERE channel_id='" +
      channelId +
      "' AND publickey='" +
      targetPubkey +
      "'";
    channelRunSQL(updateSql, function (updateRes) {
      if (updateRes.status) {
        MDS.comms.solo(
          JSON.stringify({ type: "CHANNEL_UPDATE", channelId: channelId }),
        );
      }
    });
  });
}

// ---------------------------------------------------------------------------
// channel_join_request
// ---------------------------------------------------------------------------

function handleChannelJoinRequest(pubkey, maxjson) {
  try {
    var channelId = maxjson.channelId;
    var requesterName = (maxjson.requesterName || "Anonymous").replace(
      /'/g,
      "''",
    );
    var requesterAddress = (maxjson.requesterAddress || pubkey).replace(
      /'/g,
      "''",
    );

    MDS.log(
      "🎟️ [CHANNEL] Join request for " + channelId + " from " + requesterName,
    );

    MDS.cmd("maxima action:info", function (info) {
      var myPubkey = info.response.publickey;
      var myName = (info.response.name || "Admin").replace(/'/g, "''");

      // 1. Get channel info
      MDS.sql(
        "SELECT * FROM CHANNELS WHERE channel_id='" + channelId + "'",
        function (chanRes) {
          if (!chanRes.rows || chanRes.rows.length === 0) return;
          var chan = chanRes.rows[0];

          // 2. Add subscriber
          var insSub =
            "INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role) " +
            "VALUES ('" +
            channelId +
            "', '" +
            pubkey +
            "', '" +
            requesterName +
            "', " +
            Date.now() +
            ", 'subscriber')";

          MDS.sql(insSub, function (insRes) {
            if (!insRes.status) return;

            // 3. Send INVITE back (as "acceptance")
            var invitePayload = {
              app: "metachain-channel",
              messageType: "channel_invite",
              channelId: channelId,
              channelName: chan.NAME || chan.name,
              description: chan.DESCRIPTION || chan.description || "",
              adminPublickey: myPubkey,
              adminUsername: myName,
              createdDate: chan.CREATED_DATE || chan.created_date,
              avatar: chan.AVATAR || chan.avatar || "",
              inviteePublickey: pubkey,
              inviteeUsername: requesterName,
              timestamp: Date.now(),
            };

            // 3. Send INVITE back (as "acceptance") via smartSend
            var hexData = "0x" + utf8ToHex(JSON.stringify(invitePayload)).toUpperCase();
            smartSend(pubkey, "metachain-channel", hexData, "CHANNEL-JOIN-ACCEPT", false, requesterAddress);

            // 4. Send SYSTEM MESSAGE locally
            var systemMsg = requesterName + " joined the channel";
            var insSys =
              "INSERT INTO CHANNEL_MESSAGES (channel_id, sender_publickey, sender_username, type, message, date, read) " +
              "VALUES ('" +
              channelId +
              "', 'system', 'system', 'system', '" +
              systemMsg +
              "', " +
              Date.now() +
              ", 0)";
            MDS.sql(insSys);

            MDS.comms.solo(
              JSON.stringify({
                type: "CHANNEL_NEW_MESSAGE",
                channelId: channelId,
              }),
            );
          });
        },
      );
    });
  } catch (err) { }
}

// ---------------------------------------------------------------------------
// channel_subscriber_added / channel_subscriber_removed
// Called from main.js when the channel admin broadcasts a membership change.
// ---------------------------------------------------------------------------

function handleChannelSubscriberAdded(pubkey, maxjson) {
  var channelId = maxjson.channelId;
  var newPubkey = maxjson.subscriberPublickey || maxjson.publickey;
  var newUsername = maxjson.subscriberUsername || maxjson.username || "Unknown";
  if (!channelId || !newPubkey) return;

  MDS.log("📢 [CHANNEL] Subscriber added to " + channelId + ": " + newPubkey.substring(0, 10));

  var upsertSql =
    "MERGE INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, role) " +
    "KEY (channel_id, publickey) " +
    "VALUES ('" + escapeSql(channelId) + "', '" + escapeSql(newPubkey) + "', '" +
    escapeSql(newUsername) + "', 'subscriber')";
  MDS.sql(upsertSql, function () {
    MDS.comms.solo(JSON.stringify({ type: "CHANNEL_UPDATE", channelId: channelId }));
  });
}

function handleChannelSubscriberRemoved(pubkey, maxjson) {
  var channelId = maxjson.channelId;
  var removedPubkey = maxjson.subscriberPublickey || maxjson.publickey;
  if (!channelId || !removedPubkey) return;

  MDS.log("📢 [CHANNEL] Subscriber removed from " + channelId + ": " + removedPubkey.substring(0, 10));

  var delSql =
    "DELETE FROM CHANNEL_SUBSCRIBERS WHERE channel_id='" + escapeSql(channelId) +
    "' AND UPPER(publickey)=UPPER('" + escapeSql(removedPubkey) + "')";
  MDS.sql(delSql, function () {
    MDS.comms.solo(JSON.stringify({ type: "CHANNEL_UPDATE", channelId: channelId }));
  });
}

/**
 * MetaChain Service Worker - Chat Message Handler
 * Handles chat messages, read receipts, pings, pongs
 */

var LAST_PONG_SENT = {};
var PONG_THROTTLE_MS = 30000;

function handleChatMessage(pubkey, maxjson) {
  MDS.log(
    "💬 [CHAT-DEBUG] RAW INCOMING from " +
    pubkey +
    ": " +
    JSON.stringify(maxjson),
  );
  MDS.log(
    "💬 [CHAT] From: " +
    pubkey +
    " - " +
    (maxjson.message || "").substring(0, 30),
  );

  var now = Date.now();
  var safePubkey = escapeSql(pubkey);
  var safeUsername = escapeSql(maxjson.username || "Unknown");
  var safeMessage = escapeSql(maxjson.message || "");
  var safeFiledata = escapeSql(maxjson.filedata || "");
  var msgType = maxjson.type || "text";
  var amount = maxjson.amount || 0;
  var senderSeq = maxjson.seq ? parseInt(maxjson.seq) : 0; // SEQUENCE TRACKING
  var customid = maxjson.customid ? escapeSql(maxjson.customid) : "0x00";
  var transportDelay =
    maxjson.timestamp && parseInt(maxjson.timestamp) > 0
      ? now - parseInt(maxjson.timestamp)
      : -1;
  var forwarded =
    maxjson.forwarded === true ||
    maxjson.forwarded === "true" ||
    maxjson.forwarded === 1;

  MDS.log(
    "⏱️ [CHAT-LATENCY] customid=" +
    customid +
    " seq=" +
    senderSeq +
    " delay_ms=" +
    transportDelay,
  );

  // 1. CHECK IF BLOCKED
  var checkBlockSql =
    "SELECT blocked FROM CHAT_STATUS WHERE UPPER(publickey)=UPPER('" + safePubkey + "')";
  MDS.sql(checkBlockSql, function (blockRes) {
    var isBlocked = false;
    if (blockRes.status && blockRes.rows && blockRes.rows.length > 0) {
      var val = blockRes.rows[0].BLOCKED;
      isBlocked = val === true || val === "TRUE" || val === "true" || val === 1;
    }

    if (isBlocked) {
      MDS.log(
        "🚫 [CHAT] Message BLOCKED from: " +
        safeUsername +
        " (" +
        safePubkey +
        ")",
      );
      return; // Abort insertion
    } else {
      MDS.log("✅ [CHAT-DEBUG] Block check passed for " + safeUsername);
    }

    // GAP DETECTION LOGIC
    // Only run if we have a valid sequence number > 1 (1 is start)
    if (senderSeq > 1) {
      // Check the last sequence number we have from this sender
      var seqSql =
        "SELECT MAX(sender_seq) as last_seq FROM CHAT_MESSAGES WHERE UPPER(publickey)=UPPER('" +
        safePubkey +
        "')";
      MDS.sql(seqSql, function (seqRes) {
        var lastSeq = 0;
        if (seqRes.status && seqRes.rows && seqRes.rows.length > 0) {
          lastSeq = parseInt(seqRes.rows[0].LAST_SEQ || 0);
        }

        // If we have nothing (lastSeq=0) and incoming is > 1 -> Gap (start missed)
        // If we have lastSeq (e.g. 5) and incoming is > lastSeq + 1 (e.g. 7) -> Gap (6 missed)
        // Note: We used to check just > lastSeq+1, but if lastSeq=0, we expect senderSeq=1. Any start >1 is gap.
        if (senderSeq > lastSeq + 1) {
          var gapSize = senderSeq - lastSeq - 1;
          MDS.log(
            "⚠️ [GAP-DETECT] Sequence gap detected from " +
            safeUsername +
            " (Seq: " +
            senderSeq +
            ", Last: " +
            lastSeq +
            ", Missing: " +
            gapSize +
            ")",
          );

          // Trigger sync - use existing solo comms or direct function call if available
          if (typeof requestChatHistory === "function") {
            MDS.log("🔄 [GAP-FILL] Triggering sync to fill gap...");
            requestChatHistory(pubkey);
          }
        }
      });
    }

    // 2. Insert message to DB if not blocked
    var txpowid = maxjson.txpowid ? escapeSql(maxjson.txpowid) : null;
    var initialState = txpowid ? "sent" : "received"; // 'sent' triggers blink on receiver side if txpowid exists
    var txpowidVal = txpowid ? "'" + txpowid + "'" : "NULL";
    var originalTimestamp = maxjson.timestamp ? maxjson.timestamp : 0;
    // PERSIST CUSTOM ID (already normalized above)

    // CRITICAL FIX: Only store if we don't already have it
    // We check BOTH txpowid (if available) AND time window simultaneously to ensure we catch duplicates
    // even if one identifier is missing or slightly different.
    var checkDup =
      "SELECT COUNT(*) as count FROM CHAT_MESSAGES WHERE UPPER(publickey)=UPPER('" +
      safePubkey +
      "')";
    var conditions = [];

    // 1. Check by TxPoWID (Strongest check)
    if (txpowid) {
      conditions.push("txpowid='" + txpowid + "'");
    }

    // 2. Check by Time Window & Content (Fuzzy check for 60s window)
    // Checks against both original_timestamp (sender time) and date (local time)
    var minTime = originalTimestamp - 60000;
    var maxTime = originalTimestamp + 60000;
    var timeCondition =
      "message='" +
      safeMessage +
      "' AND (" +
      "(original_timestamp >= " +
      minTime +
      " AND original_timestamp <= " +
      maxTime +
      ") OR " +
      "(date >= " +
      minTime +
      " AND date <= " +
      maxTime +
      "))";
    conditions.push("(" + timeCondition + ")");

    // Combine with OR
    if (conditions.length > 0) {
      checkDup += " AND (" + conditions.join(" OR ") + ")";
    }

    MDS.log("🔍 [DEDUP-LIVE] Checking for duplicates with SQL: " + checkDup);

    MDS.sql(checkDup, function (dupRes) {
      if (dupRes.status && dupRes.rows && dupRes.rows[0].COUNT > 0) {
        MDS.log(
          "♻️ [CHAT] Ignoring duplicate message from " +
          safeUsername +
          " (already exists in DB)",
        );

        // CRITICAL FIX: Even if duplicate, UPDATE sender_seq if it's currently 0 or NULL
        // This fixes ordering if the message was first added via history sync (which might have lacked seq)
        if (maxjson.seq && maxjson.seq > 0) {
          var updateSeqSql =
            "UPDATE CHAT_MESSAGES SET sender_seq=" +
            maxjson.seq +
            " WHERE UPPER(publickey)=UPPER('" +
            safePubkey +
            "') AND (" +
            conditions.join(" OR ") +
            ")" +
            " AND (sender_seq IS NULL OR sender_seq = 0)";
          MDS.sql(updateSeqSql, function (res) {
            if (res.status && res.rowsAffected > 0) {
              MDS.log(
                "🔄 [CHAT] Updated sequence for duplicate message to: " +
                maxjson.seq,
              );
            }
          });
        }
        return;
      } else {
        MDS.log("✨ [CHAT-DEBUG] No duplicate found. Proceeding to INSERT...");
      }

      var forwardedVal = forwarded ? 1 : 0;
      var insertSql =
        "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, sender_seq, customid, forwarded) " +
        "VALUES ('', UPPER('" +
        safePubkey +
        "'), '" +
        safeUsername +
        "', '" +
        msgType +
        "', '" +
        safeMessage +
        "', '" +
        safeFiledata +
        "', '" +
        initialState +
        "', " +
        amount +
        ", " +
        (originalTimestamp || now) +
        ", " +
        txpowidVal +
        ", " +
        originalTimestamp +
        ", " +
        senderSeq +
        ", '" +
        customid +
        "', " +
        forwardedVal +
        ")";

      MDS.sql(insertSql, function (res) {
        if (res.status) {
          MDS.log("✅ [CHAT] Message saved successfully: { from: " + safeUsername + ", customid: " + customid + " }");

          // 3. NOTIFY FRONTEND (Immediate Sync)
          // This triggers a UI refresh now that the message is safely in the DB
          // We send the full payload to avoid an immediate DB re-query (Event-driven UI)
          var soloPayload = {
            type: "NEW_CHAT_MESSAGE",
            message: {
              roomname: "",
              publickey: pubkey,
              username: maxjson.username || "Unknown",
              type: msgType,
              message: maxjson.message || "",
              filedata: maxjson.filedata || "",
              state: initialState,
              amount: amount,
              date: originalTimestamp || now,
              txpowid: maxjson.txpowid || null,
              original_timestamp: originalTimestamp,
              sender_seq: senderSeq,
              customid: maxjson.customid || "0x00",
              forwarded: forwarded
            }
          };
          MDS.log("📡 [CHAT] Emitting NEW_CHAT_MESSAGE signal to Frontend...");
          MDS.comms.solo(JSON.stringify(soloPayload));

          // Also send legacy signal for broad compatibility with list views
          MDS.comms.solo("CHAT_LIST_UPDATE");

          // FIX: Auto-discover user on message receipt to fix "Unknown" in chat list
          if (
            safeUsername &&
            safeUsername !== "Unknown" &&
            safeUsername !== "System"
          ) {
            var safeAvatar = escapeSql(maxjson.avatar || "");
            var safeAddress = escapeSql(maxjson.from_address || "");

            // Proactively DELETE the old entry before merging to ensure a clean state with the fresh validated address.
            var delPeer = "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + safePubkey + "')";
            var insPeer =
              "INSERT INTO DISCOVERED_PEERS (publickey, alias, avatar, address, last_seen, source, allow_non_contact_chats) " +
              "VALUES (UPPER('" +
              safePubkey +
              "'), '" +
              safeUsername +
              "', '" +
              safeAvatar +
              "', '" +
              safeAddress +
              "', " +
              now +
              ", 'MSG', 1)";
              
            MDS.sql(delPeer, function() {
              MDS.sql(insPeer, function (pRes) {
                if (pRes.status) {
                  MDS.log("👤 [CHAT] Auto-discovered peer (Fresh IP): " + safeUsername);
                } else {
                  MDS.log("⚠️ [CHAT] Failed to auto-discover peer: " + pRes.error);
                }
              });
            });
          }

          // 3. SEND DELIVERY RECEIPT (New Logic)
          sendDeliveryReceipt(pubkey);
        } else {
          MDS.log("❌ [CHAT] Save failed: " + res.error + " | SQL: " + insertSql);
        }
      });
    });
  });
}

// Helper to send delivery receipt from Service Worker
function sendDeliveryReceipt(toPublicKey) {
  // Prevent sending receipts to self or system
  if (toPublicKey === "Me" || toPublicKey === "System") return;

  var payload = {
    message: "",
    type: "delivery_receipt",
    username: "Me",
    filedata: "",
  };

  var jsonStr = JSON.stringify(payload);
  var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

  // Use smart Address Resolution for non-contacts
  smartSend(toPublicKey, "metachain", hexData, "DELIVERY", false);
}

function handleReadReceipt(pubkey) {
  MDS.log("📖 [READ-RECEIPT] Received from " + pubkey);
  var safePubkey = escapeSql(pubkey);
  // Update 'sent' OR 'delivered' messages to 'read'.
  // Exclude 'pending' (not sent yet), 'failed' AND 'confirmed' (final state for transactions).
  // CRITICAL FIX: Do not overwrite 'confirmed' state with 'read'.
  // CRITICAL FIX 2: Only update TEXT messages. Token/Charm transactions should NOT go to 'read' state.
  var sql =
    "UPDATE CHAT_MESSAGES SET state='read' WHERE UPPER(publickey)=UPPER('" +
    safePubkey +
    "') AND username='Me' AND type='text' AND state!='pending' AND state!='failed' AND state!='read' AND state!='confirmed'";
  MDS.sql(sql);
}

function handleDeliveryReceipt(pubkey) {
  MDS.log("📬 [DELIVERY-RECEIPT] Received from " + pubkey);
  var safePubkey = escapeSql(pubkey);
  // Update 'sent' messages to 'delivered'.
  // Do NOT overwrite 'read' status (as read > delivered).
  var sql =
    "UPDATE CHAT_MESSAGES SET state='delivered' WHERE UPPER(publickey)=UPPER('" +
    safePubkey +
    "') AND username='Me' AND state='sent'";
  MDS.sql(sql);
}

function handlePing(pubkey) {
  var safeKey = (pubkey || "").trim();
  if (!safeKey) return;

  var now = Date.now();
  var lastSent = LAST_PONG_SENT[safeKey] || 0;
  if (now - lastSent < PONG_THROTTLE_MS) {
    return;
  }
  LAST_PONG_SENT[safeKey] = now;

  MDS.log("📡 [PING] Received from " + safeKey);

  var payload = {
    message: "",
    type: "pong",
    username: "Me",
    filedata: "",
  };

  var jsonStr = JSON.stringify(payload);
  var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

  // Smart Address Resolution for Non-Contacts
  smartSend(safeKey, "metachain", hexData, "PONG", false);
}

function handlePong(pubkey) {
  MDS.log("📡 [PONG] Received from " + pubkey);
  // Let the UI handle pong events
}

// ============================================================================
// HISTORY SYNC HANDLERS
// ============================================================================

function handleChatHistoryRequest(pubkey, maxjson) {
  MDS.log("🔄 [HISTORY-REQ] Request from " + pubkey.substring(0, 10) + "...");

  try {
    var since = maxjson.timestamp ? maxjson.timestamp : 0;
    // Limit history request to last 7 days by default if 0 provided
    if (since === 0) {
      since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    }

    var safePubkey = escapeSql(pubkey);

    // Filter: Only send messages where 'publickey' is the requester's key (direct chat)
    // OR where I am the sender TO the requester.
    // Wait, CHAT_MESSAGES table stores messages in a unified way?
    // 'publickey' column store the 'other party' key.
    // For incoming message: 'publickey' = sender.
    // For outgoing message: 'publickey' = recipient.

    // So we just select WHERE publickey = requester_pubkey
    // This gives both sent and received messages in that conversation.

    var sql =
      "SELECT * FROM CHAT_MESSAGES WHERE publickey='" +
      safePubkey +
      "' " +
      "AND (type='text' OR type='token' OR type='charm') " +
      "AND date > " +
      since +
      " " +
      "ORDER BY date ASC LIMIT 100"; // Lower limit to 100 to ensure payload is manageable

    MDS.sql(sql, function (res) {
      if (res.status && res.rows) {
        MDS.log(
          "🔄 [HISTORY-REQ] Found " +
          res.count +
          " messages for " +
          pubkey.substring(0, 10),
        );

        var messages = res.rows.map(function (row) {
          return {
            id: row.ID,
            message: row.MESSAGE,
            type: row.TYPE,
            username: row.USERNAME,
            date: row.DATE,
            filedata: row.FILEDATA,
            amount: row.AMOUNT,
            tokenid: row.TOKENID,
            state: row.STATE,
            txpowid: row.TXPOWID,
            sender_seq: row.SENDER_SEQ, // Include sequence for ordering
            forwarded: row.FORWARDED === 1 || row.forwarded === 1,
          };
        });

        // Send response back even if empty, so client knows sync happened
        sendChatHistoryResponse(pubkey, messages);
      } else {
        MDS.log(
          "🔄 [HISTORY-REQ] No messages found (SQL success but no rows?)",
        );
        sendChatHistoryResponse(pubkey, []);
      }
    });
  } catch (e) {
    MDS.log("❌ [HISTORY-REQ] Error processing request: " + e);
  }
}

function sendChatHistoryResponse(toPubkey, messages) {
  var payload = {
    type: "chat_history_response",
    messages: messages,
    timestamp: Date.now(),
  };

  var jsonStr = JSON.stringify(payload);
  var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

  // Log the size
  MDS.log(
    "🔄 [HISTORY-RESP] Sending response size: " +
    hexData.length +
    " chars to " +
    toPubkey.substring(0, 10),
  );

  // Smart Address Resolution with Fallback
  smartSend(toPubkey, "metachain", hexData, "HISTORY-RESP", false);
}

var _historyProcessingLock = {};

// ─── Chat sync guard ────────────────────────────────────────────────────────
// Prevents multiple concurrent history requests to the same peer.
// Keys are normalized to uppercase. Cleared on response or timeout.
var _pendingChatSyncs = {}; // normPk -> startedAt (Date.now())
var CHAT_SYNC_TIMEOUT_MS = 30000;

/**
 * Called from MDS_TIMER_10SECONDS in main.js.
 * Clears stale guards so a new sync can be triggered after timeout.
 */
function checkChatSyncTimeouts() {
  var now = Date.now();
  for (var pk in _pendingChatSyncs) {
    if (!_pendingChatSyncs.hasOwnProperty(pk)) continue;
    if (now - _pendingChatSyncs[pk] > CHAT_SYNC_TIMEOUT_MS) {
      MDS.log("⏱️ [CHAT-SYNC] Timeout for " + pk.substring(0, 10) + ". Clearing guard.");
      delete _pendingChatSyncs[pk];
    }
  }
}

function handleChatHistoryResponse(pubkey, maxjson) {
  // Clear sync guard — response received from this peer
  delete _pendingChatSyncs[pubkey ? pubkey.toUpperCase() : pubkey];

  // Prevent parallel processing for the same peer (race condition causes duplicates)
  if (_historyProcessingLock[pubkey]) {
    MDS.log("⏭️ [HISTORY-RESP] Already processing history from " + pubkey.substring(0, 10) + ", skipping duplicate response");
    return;
  }
  _historyProcessingLock[pubkey] = true;

  var messages = maxjson.messages;
  if (!messages || messages.length === 0) {
    MDS.log("🔄 [HISTORY-RESP] Received empty history from " + pubkey);
    delete _historyProcessingLock[pubkey];
    return;
  }

  MDS.log(
    "🔄 [HISTORY-RESP] Processing " +
    messages.length +
    " messages from " +
    pubkey,
  );
  var safePubkey = escapeSql(pubkey);
  processHistoryMessage(safePubkey, pubkey, messages, 0);
}

function processHistoryMessage(safePubkey, originalPubkey, messages, index) {
  if (index >= messages.length) {
    MDS.log("✅ [HISTORY-RESP] Completed processing batch");
    // Release lock so future history responses from this peer can be processed
    if (originalPubkey) delete _historyProcessingLock[originalPubkey];
    MDS.comms.solo("CHAT_LIST_UPDATE");
    return;
  }

  var msg = messages[index];
  var timestamp = msg.date;
  var type = escapeSql(msg.type || "text");
  var content = escapeSql(msg.message || "");
  var username = escapeSql(msg.username || "Unknown");
  var senderSeq = msg.sender_seq || 0; // Extract sender_seq

  var finalUsername = "Unknown";
  var isIncoming = false;

  if (msg.username === "Me") {
    isIncoming = true;
    // Check if we can find a better name in DISCOVERED_PEERS
    finalUsername = "Contact";
  } else {
    isIncoming = false;
    finalUsername = "Me";
  }

  // START ENHANCED DEDUPLICATION
  var tryInsert = function () {
    var safeFiledata = escapeSql(msg.filedata || "");
    var amount = msg.amount || 0;
    var txpowidVal = msg.txpowid ? "'" + escapeSql(msg.txpowid) + "'" : "NULL";

    // Use provided state if valid, otherwise fallback to 'read' or 'received' based on type
    var state = msg.state || "read";

    var safeCustomId = msg.customid ? escapeSql(msg.customid) : "0x00";

    // CRITICAL: Resolve Correct Username (Alias) if it's "Contact" (incoming)
    // This ensures compatibility with Live messages which use the resolved Alias
    if (isIncoming && finalUsername === "Contact") {
      MDS.sql(
        "SELECT alias FROM DISCOVERED_PEERS WHERE publickey='" +
        safePubkey +
        "'",
        function (res) {
          var resolvedName = "Contact";
          if (res.status && res.rows && res.rows.length > 0) {
            resolvedName = escapeSql(
              res.rows[0].ALIAS || res.rows[0].alias || "Contact",
            );
          }

          var forwardedVal = msg.forwarded ? 1 : 0;
          var insertSql =
            "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, customid, sender_seq, forwarded) " +
            "VALUES ('', '" +
            safePubkey +
            "', '" +
            resolvedName +
            "', '" +
            type +
            "', '" +
            content +
            "', '" +
            safeFiledata +
            "', '" +
            state +
            "', " +
            amount +
            ", " +
            timestamp +
            ", " +
            txpowidVal +
            ", " +
            timestamp +
            ", '" +
            safeCustomId +
            "', " +
            senderSeq +
            ", " +
            forwardedVal +
            ")";

          MDS.sql(insertSql, function (insRes) {
            if (insRes.status) {
              MDS.log(
                "✅ [HISTORY-SYNC] Recovered message from " +
                resolvedName +
                ": " +
                content.substring(0, 20),
              );
            } else {
              // Fallback log if insert fails
              MDS.log("❌ [HISTORY-SYNC] Insert failed: " + insRes.error);
            }
            processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
          });
        },
      );
      return; // EXIT here, async SQL handles the recursion
    }

    var forwardedVal = msg.forwarded ? 1 : 0;
    var insertSql =
      "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, customid, sender_seq, forwarded) " +
      "VALUES ('', '" +
      safePubkey +
      "', '" +
      finalUsername +
      "', '" +
      type +
      "', '" +
      content +
      "', '" +
      safeFiledata +
      "', '" +
      state +
      "', " +
      amount +
      ", " +
      timestamp +
      ", " +
      txpowidVal +
      ", " +
      timestamp +
      ", '" +
      safeCustomId +
      "', " +
      senderSeq +
      ", " +
      forwardedVal +
      ")";

    MDS.sql(insertSql, function (insRes) {
      if (insRes.status) {
        MDS.log(
          "✅ [HISTORY-SYNC] Recovered message: " + content.substring(0, 20),
        );
      }
      processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
    });
  };

  var tryUpdate = function (existingId) {
    if (!msg.txpowid) {
      processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
      return;
    }

    var newState = msg.state || "read";
    var safeTxPow = escapeSql(msg.txpowid);
    var updateSql =
      "UPDATE CHAT_MESSAGES SET txpowid='" +
      safeTxPow +
      "', state='" +
      newState +
      "' WHERE id=" +
      existingId;

    MDS.sql(updateSql, function (updRes) {
      MDS.log(
        "♻️ [HISTORY-SYNC] Updated existing message ID " +
        existingId +
        " with txpowid/state",
      );
      processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
    });
  };

  // 0. Primary Check: By CustomID (UUID)
  if (msg.customid && msg.customid !== "0x00") {
    var safeCustomId = escapeSql(msg.customid);
    var customCheck =
      "SELECT * FROM CHAT_MESSAGES WHERE customid='" + safeCustomId + "'";
    MDS.sql(customCheck, function (res) {
      if (res.status && res.rows && res.rows.length > 0) {
        // Found by UUID!
        if (msg.txpowid) {
          tryUpdate(res.rows[0].ID);
        } else {
          processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
        }
      } else {
        // Not found by UUID -> proceed to TxPoWID check
        checkByTxPoWID();
      }
    });
  } else {
    checkByTxPoWID();
  }

  // 1. First Check: By TXPOWID (if available)
  function checkByTxPoWID() {
    if (msg.txpowid) {
      var safeTxPow = escapeSql(msg.txpowid);
      var txCheckSql =
        "SELECT * FROM CHAT_MESSAGES WHERE txpowid='" + safeTxPow + "'";

      MDS.sql(txCheckSql, function (res) {
        if (res.status && res.rows && res.rows.length > 0) {
          // Exact match found by ID - skip
          processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
        } else {
          // Not found by ID - Fallback to Content/Time check
          checkByContentAndTime();
        }
      });
    } else {
      // No ID - direct check by Content/Time
      checkByContentAndTime();
    }
  }

  // 2. Second Check: By Content & Time (Fallback)
  function checkByContentAndTime() {
    // Use original_timestamp if available, else date
    // Note: 'timestamp' variable holds msg.date which IS the original timestamp for history messages
    var checkTime = msg.original_timestamp || timestamp;

    var minTime = checkTime - 60000; // 60 second window (increased to handle network/block latency)
    var maxTime = checkTime + 60000;
    var checkSql = "";

    if (isIncoming) {
      // Incoming messages: match by timestamp + type only (message content may include/exclude tokenid)
      checkSql =
        "SELECT * FROM CHAT_MESSAGES WHERE publickey='" +
        safePubkey +
        "' AND username!='Me' " +
        "AND type='" + type + "' " +
        "AND (original_timestamp BETWEEN " +
        minTime +
        " AND " +
        maxTime +
        " OR date BETWEEN " +
        minTime +
        " AND " +
        maxTime +
        ")";
    } else {
      // Outgoing messages: match by timestamp + type only (message content may differ, e.g. tokenid present in one but not the other)
      checkSql =
        "SELECT * FROM CHAT_MESSAGES WHERE publickey='" +
        safePubkey +
        "' AND username='Me' " +
        "AND type='" + type + "' " +
        "AND (original_timestamp BETWEEN " +
        minTime +
        " AND " +
        maxTime +
        " OR date BETWEEN " +
        minTime +
        " AND " +
        maxTime +
        ")";
    }

    MDS.sql(checkSql, function (res) {
      if (res.status && res.rows && res.rows.length > 0) {
        // Found by content! Update it if we have a txpowid to attach
        if (msg.txpowid) {
          tryUpdate(res.rows[0].ID);
        } else {
          processHistoryMessage(safePubkey, originalPubkey, messages, index + 1);
        }
      } else {
        // Not found by either method -> Insert
        tryInsert();
      }
    });
  }
}

function requestHistoryFromRecentContacts() {
  MDS.log("🔄 [HISTORY-SYNC] Starting startup sync (Enhanced)...");

  var sql =
    "SELECT publickey, address FROM DISCOVERED_PEERS WHERE source != 'SELF' ORDER BY last_seen DESC LIMIT 20";

  MDS.sql(sql, function (res) {
    MDS.log("🔍 [HISTORY-SYNC-DEBUG] SQL result status: " + res.status);
    if (res.status && res.rows && res.rows.length > 0) {
      MDS.log("🔄 [HISTORY-SYNC] Syncing with " + res.rows.length + " contacts from DISCOVERED_PEERS");
      res.rows.forEach(function (row) {
        MDS.log("🔄 [HISTORY-SYNC] Requesting history from: " + row.PUBLICKEY.substring(0, 20) + "...");
        requestChatHistory(row.PUBLICKEY, row.ADDRESS);
      });
    } else {
      // DISCOVERED_PEERS is empty at startup — fall back to CHAT_MESSAGES for known contacts
      MDS.log("⚠️ [HISTORY-SYNC] DISCOVERED_PEERS empty, falling back to CHAT_MESSAGES contacts...");
      var fallbackSql =
        "SELECT DISTINCT publickey FROM CHAT_MESSAGES WHERE publickey IS NOT NULL AND publickey != '' ORDER BY date DESC LIMIT 20";
      MDS.sql(fallbackSql, function (fbRes) {
        if (!fbRes.status || !fbRes.rows || fbRes.rows.length === 0) {
          MDS.log("⚠️ [HISTORY-SYNC] No contacts in CHAT_MESSAGES either, skipping startup sync");
          return;
        }
        MDS.log("🔄 [HISTORY-SYNC] Syncing with " + fbRes.rows.length + " contacts from CHAT_MESSAGES");
        fbRes.rows.forEach(function (row) {
          MDS.log("🔄 [HISTORY-SYNC] Requesting history from: " + row.PUBLICKEY.substring(0, 20) + "...");
          // No address available — smartSend will resolve via DB/publickey
          requestChatHistory(row.PUBLICKEY, null);
        });
      });
    }
  });
}

function requestChatHistory(toPublicKey, toAddress) {
  var normPk = toPublicKey ? toPublicKey.toUpperCase() : toPublicKey;

  // Guard: skip if sync already in flight for this peer
  if (_pendingChatSyncs[normPk]) {
    MDS.log("ℹ️ [CHAT-SYNC] Already in flight for " + normPk.substring(0, 10) + ". Skipping.");
    return;
  }
  _pendingChatSyncs[normPk] = Date.now();

  // Query last message timestamp from DB (same peer, both directions)
  var lastSql = "SELECT date FROM CHAT_MESSAGES WHERE UPPER(publickey)=UPPER('" +
    escapeSql(toPublicKey) + "') ORDER BY date DESC LIMIT 1";
  MDS.sql(lastSql, function (lastRes) {
    var since = (lastRes.status && lastRes.rows && lastRes.rows.length > 0)
      ? Number(lastRes.rows[0].DATE || lastRes.rows[0].date || 0)
      : Date.now() - 7 * 24 * 60 * 60 * 1000;

    var payload = {
      message: "",
      type: "chat_history_request",
      username: "Me",
      filedata: "",
      timestamp: since,
    };
    var hexData = "0x" + utf8ToHex(JSON.stringify(payload)).toUpperCase();

    if (toAddress && (toAddress.toLowerCase().startsWith("mx"))) {
      var cleanAddress = cleanMaximaAddress(toAddress);
      MDS.cmd(
        "maxima action:send to:" + cleanAddress + " application:metachain data:" + hexData + " poll:false",
        function (res) {
          if (!res.status) {
            MDS.log("⚠️ [CHAT-SYNC] Failed via address. Falling back to publickey.");
            smartSend(toPublicKey, "metachain", hexData, "CHAT-HISTORY-SYNC", false);
          }
        }
      );
    } else {
      smartSend(toPublicKey, "metachain", hexData, "CHAT-HISTORY-SYNC", false);
    }
  });
}

// (cleanMaximaAddress and smartSend are provided by utils.js)

// --------------------------------------------------------------------------
// SMART SYNC PROTOCOL (BIDIRECTIONAL)
// --------------------------------------------------------------------------

/**
 * Handle incoming sync status check (PHASE 1)
 * Peer says: "I have received messages from you up to sequence X"
 * We check: "Have I sent more than X?"
 * If yes -> Send sync_status_report ("You are missing Y messages")
 */
function handleSyncStatusCheck(msg, fromKey) {
  var peerLastSeq = msg.last_received_seq || 0;

  // Check what is the maximum sequence number we have sent to this user
  // We can infer this from CHAT_MESSAGES where publickey=fromKey AND fromMe=true?
  // Wait, CHAT_MESSAGES stores messages *received* from them or *sent* to them?
  // It stores both.
  // Messages WE sent to THEM have: publickey=THEM, username=ME (or similar).
  // AND they should have a 'seq' number we assigned them.
  // BUT 'sender_seq' col tracks what THEY sent US.
  // We need to know what WE sent THEM.
  // The MESSAGE_COUNTERS table tracks the 'next_seq' we will give to the NEXT message.
  // So 'next_seq - 1' is the last one we sent.

  var safeFromKey = escapeSql(fromKey);
  var sql =
    "SELECT next_seq FROM MESSAGE_COUNTERS WHERE UPPER(publickey)=UPPER('" +
    safeFromKey +
    "')";
  MDS.sql(sql, function (res) {
    var counterNextSeq = res.rows && res.rows.length > 0 ? res.rows[0].NEXT_SEQ : null;

    // If MESSAGE_COUNTERS has no row (or next_seq=1 which means no messages sent),
    // fall back to MAX(sender_seq) from CHAT_MESSAGES for outgoing messages to this contact.
    if (counterNextSeq !== null && counterNextSeq > 1) {
      // Counter row found and non-trivial — use it directly
      finishSyncCheck(counterNextSeq - 1);
    } else {
      var fallbackSql =
        "SELECT MAX(sender_seq) as max_seq FROM CHAT_MESSAGES WHERE UPPER(publickey)=UPPER('" +
        safeFromKey +
        "') AND state IN ('sent','delivered','read')";
      MDS.sql(fallbackSql, function (fbRes) {
        var maxSenderSeq = fbRes.rows && fbRes.rows.length > 0 ? (parseInt(fbRes.rows[0].MAX_SEQ) || 0) : 0;
        if (maxSenderSeq > 0) {
          MDS.log("🔄 [SMART-SYNC] No counter row, using CHAT_MESSAGES fallback: max_seq=" + maxSenderSeq);
        }
        finishSyncCheck(maxSenderSeq);
      });
    }

    function finishSyncCheck(myLastSentSeq) {
    var peerLastSeqNum = parseInt(peerLastSeq) || 0;

    MDS.log(
      "🔄 [SMART-SYNC] Check from " +
      fromKey.substring(0, 10) +
      ". Their last: " +
      peerLastSeqNum +
      ", My last sent: " +
      myLastSentSeq,
    );

    if (myLastSentSeq > peerLastSeqNum) {
      var missingCount = myLastSentSeq - peerLastSeqNum;
      MDS.log("⚠️ [SMART-SYNC] Peer is missing " + missingCount + " messages.");

      // Optimization: Get preview of the very last message to show in their UI
      // We find the message with highest ID sent to them?
      // We don't strictly index our sent 'seq' in CHAT_MESSAGES yet (we just send it).
      // We might need to query by date DESC.
      var previewSql =
        "SELECT message, date, type FROM CHAT_MESSAGES WHERE publickey='" +
        escapeSql(fromKey) +
        "' AND state IN ('sent','delivered','read') ORDER BY date DESC LIMIT 1";

      MDS.sql(previewSql, function (pRes) {
        var lastMsg = pRes.rows && pRes.rows.length > 0 ? pRes.rows[0] : null;

        var reportPayload = {
          type: "sync_status_report",
          missing_count: missingCount,
          my_highest_seq: myLastSentSeq,
          last_message_preview: lastMsg
            ? {
              text:
                lastMsg.TYPE === "text"
                  ? lastMsg.MESSAGE
                  : "[" + lastMsg.TYPE + "]",
              timestamp: lastMsg.DATE,
            }
            : null,
        };

        // Send report back via Maxima with Address Resolution
        var hexData = "0x" + utf8ToHex(JSON.stringify(reportPayload)).toUpperCase();
        smartSend(fromKey, "metachain", hexData, "SMART-SYNC", false);
      });
    } else {
      MDS.log("✅ [SMART-SYNC] Peer is up to date.");
    }
    } // end finishSyncCheck
  }); // end outer MESSAGE_COUNTERS MDS.sql
}

/**
 * Handle incoming sync status report (PHASE 1 Response)
 * Peer says: "You are missing X messages. Last one was 'Hello'"
 * We action: Update UI to show "Unread/Syncing" state? or Trigger fetch?
 * For Phase 1: Just Log and maybe emit event for UI.
 * For Phase 2: This will auto-trigger 'sync_data_request'
 */
function handleSyncStatusReport(msg, fromKey) {
  MDS.log(
    "📊 [SMART-SYNC] Report from " +
    fromKey.substring(0, 10) +
    ": Missing " +
    msg.missing_count +
    " messages.",
  );

  // Emit the report to the frontend so minima.service.ts can present it to the UI
  var payload = {
    type: "sync_status_report",
    missing_count: msg.missing_count,
    fromKey: fromKey,
    last_message_preview: msg.last_message_preview,
  };
  MDS.comms.solo(JSON.stringify(payload));
}

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
            var deleteSql = "DELETE FROM CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('" + safeFrom + "') AND UPPER(to_publickey)=UPPER('" + myPk + "')";
            MDS.sql(deleteSql, function () {
                var insertSql = "INSERT INTO CONTACT_REQUESTS(from_publickey, from_name, from_avatar, from_address, to_publickey, status, created_at, updated_at) "
                    + "VALUES(UPPER('" + safeFrom + "'), '" + safeName + "', '" + safeAvatar + "', '" + safeFromAddress + "', UPPER('" + myPk + "'), 'pending', " + now + ", " + now + ")";

                MDS.sql(insertSql, function () {
                    MDS.log("✅ [CONTACTS] Request saved to database");
                });
            });

            // Insert system message
            var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
                + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Chat request received', '', 'received', 0, " + now + ")";
            MDS.sql(sysMsgSql);
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
    });

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Chat request declined', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleContactCancelled(pubkey) {
    MDS.log("🚫 [CONTACTS] Request cancelled by sender " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var deleteSql = "DELETE FROM CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('" + safeFrom + "') AND status='pending'";
    MDS.sql(deleteSql, function () {
        MDS.log("✅ [CONTACTS] Removed cancelled request");
    });

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Chat request cancelled', '', 'received', 0, " + now + ")";
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
                    });
                } else {
                    // Does not exist -> Insert new accepted record
                    var insertSql = "INSERT INTO CONTACT_REQUESTS (from_publickey, to_publickey, status, created_at, updated_at) "
                        + "VALUES (UPPER('" + myPk + "'), UPPER('" + safeFrom + "'), 'accepted', " + now + ", " + now + ")";
                    MDS.sql(insertSql, function () {
                        MDS.log("✅ [CONTACTS] Created new accepted request record");
                    });
                }
            });
        }
    });

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Chat request accepted', '', 'received', 0, " + now + ")";
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

            var deleteSql = "DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('" + safeFrom + "') AND UPPER(to_publickey)=UPPER('" + myPk + "')";
            MDS.sql(deleteSql, function () {
                var insertSql = "INSERT INTO MAXIMA_CONTACT_REQUESTS(from_publickey, from_name, to_publickey, status, created_at, updated_at) "
                    + "VALUES(UPPER('" + safeFrom + "'), '" + safeName + "', UPPER('" + myPk + "'), 'pending', " + now + ", " + now + ")";

                MDS.sql(insertSql, function () {
                    MDS.log("✅ [MAXIMA CONTACT] Request saved");
                });
            });

            var sysMsg = "Maxima contact request received";
            var chatSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
                + "VALUES('" + safeName + "', UPPER('" + safeFrom + "'), '" + safeName + "', 'system', '" + sysMsg + "', '', 'received', 0, " + now + ")";
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

    var updateSql = "UPDATE MAXIMA_CONTACT_REQUESTS SET status='accepted', updated_at=" + now + " WHERE UPPER(to_publickey)=UPPER('" + safeFrom + "')";
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
        + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Maxima contact accepted', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleMaximaContactDeclined(pubkey) {
    MDS.log("🚫 [MAXIMA CONTACT] Request declined by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var updateSql = "UPDATE MAXIMA_CONTACT_REQUESTS SET status='declined', updated_at=" + now + " WHERE UPPER(to_publickey)=UPPER('" + safeFrom + "')";
    MDS.sql(updateSql);

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Maxima contact declined', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleMaximaContactCancelled(pubkey) {
    MDS.log("🚫 [MAXIMA CONTACT] Request cancelled by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    var deleteSql = "DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('" + safeFrom + "') AND status='pending'";
    MDS.sql(deleteSql);

    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Maxima contact cancelled', '', 'received', 0, " + now + ")";
    MDS.sql(sysMsgSql);
}

function handleMaximaContactRemoved(pubkey, maxjson) {
    MDS.log("🗑️ [MAXIMA CONTACT] Removed by " + pubkey);

    var now = Date.now();
    var safeFrom = escapeSql(pubkey);

    // Insert system message
    var sysMsgSql = "INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) "
        + "VALUES('', UPPER('" + safeFrom + "'), 'System', 'system', 'Contact removed', '', 'received', 0, " + now + ")";
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

/**
 * Transaction Handler
 * Manages pending transactions and confirmation checks in the background.
 */

// Check for zombie pending transactions (cancelled while DApp was closed)
// AND detect accepted transactions to send Maxima messages
function checkPendingTransactions() {
    MDS.log("🔍 [SW-TX] Checking pending transactions...");

    // Get all local pending transactions
    MDS.sql("SELECT * FROM TRANSACTIONS WHERE status = 'pending'", function (res) {
        if (res.status && res.rows.length > 0) {
            var localPending = res.rows;
            MDS.log("📋 [SW-TX] Found " + localPending.length + " pending transactions in DB");

            // Check each pending transaction directly against blockchain/mempool
            // We don't use 'mds action:pending' because it creates phantom pending commands in Read Mode
            for (var j = 0; j < localPending.length; j++) {
                var tx = localPending[j];
                var txUid = tx.PENDINGUID || tx.pendinguid;
                var messageTimestamp = tx.MESSAGE_TIMESTAMP || tx.message_timestamp;

                // Skip if no pendinguid
                if (!txUid || txUid === 'null') {
                    continue;
                }

                MDS.log("🔍 [SW-TX] Checking zombie status for transaction: " + txUid);

                // Search for it in blockchain/mempool
                findInBlockchainOrMempool(messageTimestamp, function (err, foundTxpowid) {
                    if (err) {
                        MDS.log("❌ [SW-TX] Error checking transaction: " + err);
                        return;
                    }

                    if (foundTxpowid) {
                        // ACCEPTED! Transaction was approved while DApp was closed
                        MDS.log("✅ [SW-TX] Zombie transaction ACCEPTED: " + foundTxpowid);
                        handleAcceptedTransaction(tx, foundTxpowid);
                    } else {
                        // DENIED/CANCELLED - it's a zombie
                        // Note: This might also trigger for very recent transactions that haven't been mined yet
                        // So we should only clean up transactions older than a certain threshold
                        var txAge = Date.now() - messageTimestamp;
                        var ZOMBIE_THRESHOLD = 10000; // 10 seconds (matches confirmation checker interval)

                        if (txAge > ZOMBIE_THRESHOLD) {
                            MDS.log("🗑️ [SW-TX] Zombie transaction DENIED/CANCELLED: " + txUid);
                            handleDeniedTransaction(tx);
                        } else {
                            MDS.log("⏳ [SW-TX] Transaction too recent to determine zombie status: " + txUid);
                        }
                    }
                });
            }
        } else {
            MDS.log("✅ [SW-TX] No pending transactions in DB");
        }
    });
}

/**
 * Check for SENT transactions that need confirmation (3 blocks)
 * This was missing! Causing transactions to remain 'sent' forever.
 */
function checkSentTransactions() {
    MDS.log("🔍 [SW-TX-CONFIRM] Checking SENT transactions...");

    MDS.sql("SELECT * FROM TRANSACTIONS WHERE status = 'sent'", function (res) {
        if (res.status && res.rows.length > 0) {
            var sentTxs = res.rows;
            MDS.log("📋 [SW-TX-CONFIRM] Found " + sentTxs.length + " sent transactions waiting for confirmation");

            for (var i = 0; i < sentTxs.length; i++) {
                var tx = sentTxs[i];
                var txpowid = tx.TXPOWID || tx.txpowid;

                if (!txpowid || txpowid === 'null') continue;

                check3BlockConfirmation(txpowid, function (err, status) {
                    if (!err && status === 'confirmed') {
                        MDS.log("✅ [SW-TX-CONFIRM] 3-Block Confirmation achieved for: " + txpowid);
                        updateTransactionAsConfirmed(tx, txpowid);
                    }
                });
            }
        }
    });
}

/**
 * Clean up orphaned pending chat messages
 * These are messages stuck in 'pending' state but have no corresponding entry in TRANSACTIONS table
 */
function cleanupOrphanedChatMessages() {
    MDS.log("🧹 [SW-CLEANUP] Starting orphan cleanup check...");
    var oneMinuteAgo = Date.now() - 60000; // 1 minute timeout for orphaned messages

    // Select pending messages older than 1 minute
    MDS.sql("SELECT * FROM CHAT_MESSAGES WHERE state='pending' AND (type='token' OR type='charm') AND date < " + oneMinuteAgo, function (res) {
        if (res.status && res.rows.length > 0) {
            MDS.log("🧹 [SW-CLEANUP] Found " + res.rows.length + " potential orphans. Checking against TRANSACTIONS...");
            checkAndExpireOrphans(res.rows);
        } else {
            MDS.log("✅ [SW-CLEANUP] No old pending messages found.");
        }
    });
}

function checkAndExpireOrphans(orphans) {
    if (!orphans || orphans.length === 0) {
        MDS.log("✅ [SW-CLEANUP] Cleanup check complete.");
        return;
    }

    var potentialOrphan = orphans[0];
    var messageTimestamp = potentialOrphan.DATE || potentialOrphan.date;
    var msgId = potentialOrphan.ID || potentialOrphan.id;

    if (!messageTimestamp) {
        MDS.log("⚠️ [SW-CLEANUP] Skipping orphan with no date: " + JSON.stringify(potentialOrphan));
        checkAndExpireOrphans(orphans.slice(1));
        return;
    }

    MDS.sql("SELECT * FROM TRANSACTIONS WHERE message_timestamp=" + messageTimestamp, function (res) {
        var isTracked = res.status && res.rows.length > 0;

        if (!isTracked) {
            MDS.log("🗑️ [SW-CLEANUP] EXPIRED ORPHAN (No Transaction): " + messageTimestamp + " ID: " + msgId);
            MDS.sql("UPDATE CHAT_MESSAGES SET state='failed' WHERE id=" + msgId, function (updateRes) {
                if (updateRes.status) MDS.log("✅ [SW-CLEANUP] Marked as failed.");
                else MDS.log("❌ [SW-CLEANUP] Update failed: " + updateRes.error);

                // Next
                checkAndExpireOrphans(orphans.slice(1));
            });
        } else {
            MDS.log("ℹ️ [SW-CLEANUP] Message " + messageTimestamp + " is tracked in TRANSACTIONS. Ignoring.");
            // It is tracked, let normal pending check handle it.
            checkAndExpireOrphans(orphans.slice(1));
        }
    });
}

/**
 * Handle an accepted transaction - send Maxima message and update DB
 */
function handleAcceptedTransaction(tx, txpowid) {
    MDS.log("📤 [SW-TX] Handling accepted transaction: " + txpowid);

    var txType = tx.TYPE || tx.type;
    var publickey = tx.PUBLICKEY || tx.publickey;
    var messageTimestamp = tx.MESSAGE_TIMESTAMP || tx.message_timestamp;
    var metadataStr = tx.METADATA || tx.metadata || '{}';

    try {
        var metadata = JSON.parse(metadataStr);
        var senderName = metadata.username || "Me";

        // Send Maxima message based on type
        if (txType === 'charm') {
            var charmId = metadata.charmId;
            var amount = metadata.amount || 0;

            MDS.log("💎 [SW-TX] Sending charm message: " + charmId + " (" + amount + " Minima)");

            sendCharmMessage(publickey, charmId, amount, {
                senderName: senderName,
                timestamp: messageTimestamp,
                txpowid: txpowid
            }, function (err, result) {
                if (err) {
                    MDS.log("❌ [SW-TX] Failed to send charm message: " + err);
                } else {
                    MDS.log("✅ [SW-TX] Charm message sent successfully");
                    updateTransactionAsConfirmed(tx, txpowid);
                }
            });

        } else if (txType === 'token') {
            var tokenAmount = metadata.amount;
            var tokenName = metadata.tokenName || 'Minima';
            var tokenData = { amount: tokenAmount, tokenName: tokenName };

            MDS.log("💰 [SW-TX] Sending token message: " + tokenAmount + " " + tokenName);

            sendTokenMessage(publickey, tokenData, {
                senderName: senderName,
                timestamp: messageTimestamp,
                txpowid: txpowid
            }, function (err, result) {
                if (err) {
                    MDS.log("❌ [SW-TX] Failed to send token message: " + err);
                } else {
                    MDS.log("✅ [SW-TX] Token message sent successfully");
                    updateTransactionAsConfirmed(tx, txpowid);
                }
            });
        }

    } catch (e) {
        MDS.log("❌ [SW-TX] Error parsing metadata: " + e);
    }
}

/**
 * Update transaction and message as confirmed
 */
function updateTransactionAsConfirmed(tx, txpowid) {
    var txId = tx.ID || tx.id;
    var messageTimestamp = tx.MESSAGE_TIMESTAMP || tx.message_timestamp;
    var now = Date.now();

    // Update TRANSACTIONS table
    MDS.sql("UPDATE TRANSACTIONS SET txpowid='" + txpowid + "', status='confirmed', updated_at=" + now + " WHERE id=" + txId, function (updateRes) {
        if (updateRes.status) {
            MDS.log("✅ [SW-TX] Transaction marked as confirmed: " + txpowid);
        }
    });

    // Update CHAT_MESSAGES table
    MDS.sql("UPDATE CHAT_MESSAGES SET state='confirmed', txpowid='" + txpowid + "' WHERE date=" + messageTimestamp, function (chatRes) {
        if (chatRes.status) {
            MDS.log("✅ [SW-TX] Chat message marked as confirmed");
        }
    });
}

/**
 * Handle a denied/cancelled transaction - mark as failed
 */
function handleDeniedTransaction(tx) {
    var txId = tx.ID || tx.id;
    var txpowid = tx.TXPOWID || tx.txpowid;
    var messageTimestamp = tx.MESSAGE_TIMESTAMP || tx.message_timestamp;

    MDS.log("🗑️ [SW-TX] Marking transaction as failed: " + txId);

    // Update TRANSACTIONS table
    MDS.sql("UPDATE TRANSACTIONS SET status='failed' WHERE id=" + txId, function (updateRes) {
        if (updateRes.status) {
            MDS.log("✅ [SW-TX] Transaction marked as failed");
        }
    });

    // Update CHAT_MESSAGES table
    var chatUpdateSql = "UPDATE CHAT_MESSAGES SET state='failed' WHERE ";
    if (txpowid && txpowid !== 'null' && !txpowid.startsWith('PENDING_')) {
        chatUpdateSql += "txpowid='" + txpowid + "'";
    } else {
        chatUpdateSql += "date=" + messageTimestamp;
    }

    MDS.sql(chatUpdateSql, function (chatRes) {
        if (chatRes.status) {
            MDS.log("✅ [SW-TX] Chat message marked as failed");
        }
    });
}


/**
 * MetaChain Service Worker - Beacon Handler
 * Handles peer discovery beacons and user registry
 */

function encodeBase64Utf8(str) {
  if (!str) return "";
  try {
    if (typeof btoa === "function") {
      return btoa(unescape(encodeURIComponent(str)));
    }
  } catch (e) {}
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(str, "utf8").toString("base64");
    }
  } catch (e) {}
  return "";
}

function normalizeAllowNonContactChats(value, defaultValue) {
  if (defaultValue === undefined || defaultValue === null) defaultValue = 1;
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value ? 1 : 0;
  if (typeof value === "string") {
    var normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes")
      return 1;
    if (normalized === "false" || normalized === "0" || normalized === "no")
      return 0;
  }
  return defaultValue;
}

function buildJoinLink(listingType, joinPayload) {
  if (!joinPayload) return "";
  var scheme = listingType === "group" ? "mcgrp://" : "mcch://";
  var payload =
    listingType === "group"
      ? {
          g: joinPayload.id,
          n: joinPayload.name,
          p: joinPayload.admin_publickey,
          a: joinPayload.admin_address,
        }
      : {
          c: joinPayload.id,
          n: joinPayload.name,
          p: joinPayload.admin_publickey,
          a: joinPayload.admin_address,
        };
  if (!payload.g && !payload.c) return "";
  var base64 = encodeBase64Utf8(JSON.stringify(payload));
  return base64 ? scheme + base64 : "";
}

function buildPublicListings(myPubkey, myAddress, callback) {
  var listings = [];
  var groupSql =
    "SELECT group_id, name, description, created_date FROM GROUPS WHERE COALESCE(is_public, FALSE) = TRUE AND (archived IS NULL OR archived = FALSE)";
  MDS.sql(groupSql, function (groupRes) {
    if (groupRes.status && groupRes.rows) {
      for (var i = 0; i < groupRes.rows.length; i++) {
        var row = groupRes.rows[i];
        var groupId = row.GROUP_ID || row.group_id;
        var name = row.NAME || row.name;
        var description = row.DESCRIPTION || row.description || "";
        var createdDate = row.CREATED_DATE || row.created_date || 0;
        if (!groupId || !name) continue;
        var joinPayload = {
          id: groupId,
          name: name,
          admin_publickey: myPubkey,
          admin_address: myAddress,
        };
        listings.push({
          type: "group",
          id: groupId,
          name: name,
          description: description,
          created_date: createdDate,
          join: joinPayload,
          link: buildJoinLink("group", joinPayload),
        });
      }
    }

    var channelSql =
      "SELECT channel_id, name, description, created_date FROM CHANNELS WHERE COALESCE(is_public, FALSE) = TRUE AND (archived IS NULL OR archived = FALSE)";
    MDS.sql(channelSql, function (channelRes) {
      if (channelRes.status && channelRes.rows) {
        for (var j = 0; j < channelRes.rows.length; j++) {
          var rowC = channelRes.rows[j];
          var channelId = rowC.CHANNEL_ID || rowC.channel_id;
          var cName = rowC.NAME || rowC.name;
          var cDescription = rowC.DESCRIPTION || rowC.description || "";
          var cCreatedDate = rowC.CREATED_DATE || rowC.created_date || 0;
          if (!channelId || !cName) continue;
          var joinPayloadC = {
            id: channelId,
            name: cName,
            admin_publickey: myPubkey,
            admin_address: myAddress,
          };
          listings.push({
            type: "channel",
            id: channelId,
            name: cName,
            description: cDescription,
            created_date: cCreatedDate,
            join: joinPayloadC,
            link: buildJoinLink("channel", joinPayloadC),
          });
        }
      }

      listings.sort(function (a, b) {
        return (b.created_date || 0) - (a.created_date || 0);
      });
      callback(listings.slice(0, 10));
    });
  });
}

function normalizeListings(listings) {
  if (!Array.isArray(listings)) return [];
  var normalized = [];
  for (var i = 0; i < listings.length; i++) {
    var item = listings[i];
    if (!item || typeof item !== "object") continue;
    var type = item.type;
    if (type !== "group" && type !== "channel") continue;
    var id = item.id || item.group_id || item.channel_id;
    var name = item.name;
    if (!id || !name) continue;
    normalized.push({
      type: type,
      id: id,
      name: name,
      description: item.description || "",
      join: item.join || null,
      link: item.link || "",
    });
  }
  return normalized.slice(0, 10);
}

function saveBeaconListings(beacon, now) {
  if (!beacon || !beacon.pubkey) return;
  if (!Array.isArray(beacon.listings)) return;

  var incomingTimestamp = beacon.timestamp || 0;
  if (incomingTimestamp <= 0) return;

  var pk = beacon.pubkey;
  var safePk = escapeSql(pk);
  var cleanedListings = normalizeListings(beacon.listings);
  var listingsJson = escapeSql(JSON.stringify(cleanedListings));

  MDS.sql(
    "SELECT timestamp FROM DISCOVERED_LISTINGS WHERE UPPER(owner_publickey)=UPPER('" +
      safePk +
      "')",
    function (res) {
      var storedTimestamp = 0;
      if (res.status && res.rows && res.rows.length > 0) {
        storedTimestamp = res.rows[0].TIMESTAMP || res.rows[0].timestamp || 0;
      }

      if (storedTimestamp >= incomingTimestamp) {
        MDS.sql(
          "UPDATE DISCOVERED_LISTINGS SET last_seen=" +
            now +
            " WHERE UPPER(owner_publickey)=UPPER('" +
            safePk +
            "')",
        );
        return;
      }

      var upsertSql =
        "MERGE INTO DISCOVERED_LISTINGS (owner_publickey, listings, timestamp, last_seen) " +
        "KEY (owner_publickey) " +
        "VALUES (UPPER('" +
        safePk +
        "'), '" +
        listingsJson +
        "', " +
        incomingTimestamp +
        ", " +
        now +
        ")";
      MDS.sql(upsertSql, function (saveRes) {
        if (saveRes.status) {
          MDS.log("✅ [LISTINGS] Updated listings for " + pk.substring(0, 10));
        } else {
          MDS.log(
            "❌ [LISTINGS] Failed to save listings: " + JSON.stringify(saveRes),
          );
        }
      });
    },
  );
}

function handleBeacon(beacon, source) {
  try {
    // Validation logging
    if (!beacon.pubkey || !beacon.address || !beacon.alias) {
      MDS.log(
        "⚠️ [BEACON-REJECT] Missing required fields from " +
          source +
          " - pubkey:" +
          !!beacon.pubkey +
          " address:" +
          !!beacon.address +
          " alias:" +
          !!beacon.alias,
      );
      return;
    }

    // Debounce (except for important sources)
    var isImportant = source === "GOSSIP" || source === "BOOTSTRAP";
    if (
      !isImportant &&
      BEACON_CACHE[beacon.pubkey] &&
      Date.now() - BEACON_CACHE[beacon.pubkey] < 10000
    ) {
      MDS.log(
        "⏭️ [BEACON-DEBOUNCE] Skipping " +
          beacon.alias +
          " from " +
          source +
          " (recently processed)",
      );
      return;
    }

    // Check if this is our own beacon (allow SELF to persist)
    if (MY_MAXIMA_PK && beacon.pubkey === MY_MAXIMA_PK && source !== "SELF") {
      MDS.log("⏭️ [BEACON-SELF] Ignoring own beacon from " + source);
      return;
    }

    BEACON_CACHE[beacon.pubkey] = Date.now();

    var now = Date.now();
    var escapedAlias = escapeSql(beacon.alias);
    var bioValue = beacon.bio || "";
    // Clean address to prevent NumberFormatException (remove extra spaces)
    var cleanAddress = (beacon.address || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s*:\s*/g, ":");

    var allowNonContactChats = normalizeAllowNonContactChats(
      beacon.allowNonContactChats,
      1,
    );

    MDS.log("📡 [BEACON] " + beacon.alias + " from " + source);

    saveBeaconListings(beacon, now);

    // Save beacon - handle bio caching
    if (bioValue) {
      saveBeaconWithBio(
        beacon,
        source,
        escapedAlias,
        bioValue,
        cleanAddress,
        allowNonContactChats,
        now,
      );
    } else {
      // Check DB for cached bio
      MDS.sql(
        "SELECT bio FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
          beacon.pubkey +
          "')",
        function (checkRes) {
          var bioToSave = "";
          if (
            checkRes.status &&
            checkRes.rows &&
            checkRes.rows.length > 0 &&
            checkRes.rows[0].BIO
          ) {
            bioToSave = checkRes.rows[0].BIO;
          }
          saveBeaconWithBio(
            beacon,
            source,
            escapedAlias,
            bioToSave,
            cleanAddress,
            allowNonContactChats,
            now,
          );
        },
      );
    }
  } catch (e) {
    MDS.log("❌ [BEACON] Handler error: " + e.message);
  }
}

function saveBeaconWithBio(
  beacon,
  source,
  escapedAlias,
  bio,
  cleanAddress,
  allowNonContactChats,
  now
) {
  var escapedBio = escapeSql(bio);
  var extraData = escapeSql(JSON.stringify(beacon));
  var incomingTimestamp = beacon.timestamp || 0;

  // Check stored beacon timestamp to avoid overwriting newer profile data with old gossip
  MDS.sql(
    "SELECT extra_data FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" +
      beacon.pubkey +
      "')",
    function (existingRes) {
      var storedTimestamp = 0;
      var hasExisting = false;
      if (
        existingRes.status &&
        existingRes.rows &&
        existingRes.rows.length > 0 &&
        existingRes.rows[0].EXTRA_DATA
      ) {
        hasExisting = true;
        try {
          var stored = JSON.parse(existingRes.rows[0].EXTRA_DATA);
          storedTimestamp = stored.timestamp || 0;
        } catch (e) {}
      } else if (
        existingRes.status &&
        existingRes.rows &&
        existingRes.rows.length > 0
      ) {
        hasExisting = true;
      }

      // If incoming beacon has no timestamp and we already have a profile, only touch last_seen
      if (incomingTimestamp <= 0 && hasExisting) {
        MDS.log(
          "⏭️ [BEACON] Missing timestamp for " +
            beacon.alias +
            " — preserving existing profile. Touching last_seen only.",
        );
        MDS.sql(
          "UPDATE DISCOVERED_PEERS SET last_seen=" +
            now +
            " WHERE UPPER(publickey)=UPPER('" +
            beacon.pubkey +
            "')",
          function (updateRes) {
            if (updateRes.status) {
              MDS.log("✅ [BEACON] Touched last_seen for: " + beacon.alias);
            }
          },
        );
        return;
      }

      // If the incoming beacon is older than what we have stored, only touch last_seen
      if (incomingTimestamp > 0 && storedTimestamp > incomingTimestamp) {
        MDS.log(
          "⏭️ [BEACON] Skipping profile overwrite for " +
            beacon.alias +
            " — stored beacon is newer (" +
            storedTimestamp +
            " > " +
            incomingTimestamp +
            "). Touching last_seen only.",
        );
        MDS.sql(
          "UPDATE DISCOVERED_PEERS SET last_seen=" +
            now +
            " WHERE UPPER(publickey)=UPPER('" +
            beacon.pubkey +
            "')",
          function (updateRes) {
            if (updateRes.status) {
              MDS.log("✅ [BEACON] Touched last_seen for: " + beacon.alias);
            }
          },
        );
        return;
      }

      // Proceed with full profile MERGE
      // Task 4: Proactive cleanup for direct communications
      var isDirect = source === "P2P" || source === "MAXIMA" || source === "SELF" || source === "BOOTSTRAP";
      var deleteOldSql = "DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + beacon.pubkey + "')";
      
      // Task 3: Conditional LAST_SEEN logic
      var lastSeenToSave = now; // Default for direct
      if (source === "GOSSIP") {
        lastSeenToSave = incomingTimestamp > 0 ? incomingTimestamp : now;
        MDS.log("🗣️ [GOSSIP-TIME] Using original timestamp " + lastSeenToSave + " for " + beacon.alias);
      }

      var discoverySql =
        "MERGE INTO DISCOVERED_PEERS (publickey, alias, bio, address, last_seen, source, allow_non_contact_chats, extra_data) " +
        "KEY (publickey) " +
        "VALUES (UPPER('" +
        beacon.pubkey +
        "'), '" +
        escapedAlias +
        "', '" +
        escapedBio +
        "', '" +
        cleanAddress +
        "', " +
        lastSeenToSave +
        ", '" +
        source +
        "', " +
        allowNonContactChats +
        ", '" +
        extraData +
        "')";

      // If it's a direct message, we clean up first to ensure we have exactly one fresh entry with the validated IP
      if (isDirect) {
        MDS.sql(deleteOldSql, function() {
          MDS.sql(discoverySql, function (res) {
            if (res.status) {
              MDS.log("✅ [BEACON-DIRECT] Validated IP & Saved: " + beacon.alias + " (" + cleanAddress + ")");
              promoteToUserRegistry(beacon, now);
              
              // Reactive gossip
              if ((source === "P2P" || source === "MAXIMA") && !hasExisting) {
                sendWelcomePackage(beacon.pubkey, beacon.alias, cleanAddress);
                askPeers([beacon.pubkey]);
              }
            }
          });
        });
      } else {
        // For GOSSIP, just merge (Task 3 applies via lastSeenToSave)
        MDS.sql(discoverySql, function (res) {
          if (res.status) {
            MDS.log("✅ [BEACON] Saved: " + beacon.alias);
            promoteToUserRegistry(beacon, now);
          } else {
            MDS.log("❌ [BEACON] Save failed: " + JSON.stringify(res));
          }
        });
      }
    },
  );
}

function promoteToUserRegistry(beacon, now) {
  var user_id = beacon.pubkey;
  var escapedAlias = escapeSql(beacon.alias);

  MDS.sql(
    "SELECT * FROM METACHAIN_USERS WHERE UPPER(user_id)=UPPER('" + user_id + "')",
    function (res) {
      if (res.status && res.rows && res.rows.length > 0) {
        // Update existing
        var updateSql =
          "UPDATE METACHAIN_USERS SET alias='" +
          escapedAlias +
          "', address='" +
          (beacon.address || "") +
          "', last_updated=" +
          now +
          " WHERE UPPER(user_id)=UPPER('" +
          user_id +
          "')";
        MDS.sql(updateSql);
      } else {
        // Insert new
        var insertSql =
          "INSERT INTO METACHAIN_USERS (user_id, publickey, alias, address, first_seen, last_updated) " +
          "VALUES (UPPER('" +
          user_id +
          "'), UPPER('" +
          beacon.pubkey +
          "'), '" +
          escapedAlias +
          "', '" +
          (beacon.address || "") +
          "', " +
          now +
          ", " +
          now +
          ")";
        MDS.sql(insertSql);
      }
    },
  );
}

function sendBackgroundBeacon() {
  MDS.log("📡 [BG-BEACON] Preparing beacon...");

  MDS.cmd("maxima action:info", function (maxInfo) {
    if (!maxInfo.status) {
      MDS.log("❌ [BG-BEACON] Maxima info failed");
      return;
    }

    var myPubkey = maxInfo.response.publickey;
    var myAddress = maxInfo.response.contact;
    var myName = maxInfo.response.name || "Anonymous";
    var myAvatar = maxInfo.response.icon
      ? decodeURIComponent(maxInfo.response.icon)
      : "";

    MDS.keypair.get("p2p_bio", function (bioRes) {
      var bio = bioRes.status && bioRes.value ? bioRes.value : "";

      // Get additional profile data
      MDS.keypair.get("profile_country", function (countryRes) {
        var country =
          countryRes.status && countryRes.value ? countryRes.value : "";

        MDS.keypair.get("profile_languages", function (langRes) {
          var languages = langRes.status && langRes.value ? langRes.value : "";

          MDS.keypair.get("profile_minima_address", function (addrRes) {
            var minimaAddress =
              addrRes.status && addrRes.value ? addrRes.value : "";

            var finalizeBeacon = function (resolvedMinimaAddress) {
              // Get all profile data including avatar (like the working example)
              MDS.sql(
                "SELECT * FROM MY_PROFILE WHERE id=1",
                function (permRes) {
                  var allowNonContactChats = true;
                  var avatar = "";
                  var dbCountry = "";
                  var dbLanguages = [];

                  if (
                    permRes.status &&
                    permRes.rows &&
                    permRes.rows.length > 0
                  ) {
                    var row = permRes.rows[0];
                    var val =
                      row.ALLOW_NON_CONTACT_CHATS ||
                      row.allow_non_contact_chats;
                    allowNonContactChats =
                      val === 1 ||
                      val === true ||
                      val === "true" ||
                      val === "1";
                    // Get avatar from DB (same as working example line 1714)
                    avatar = row.AVATAR || row.avatar || "";
                    // Get country from DB (with decoding like example line 1711)
                    dbCountry = decodeURIComponent(
                      row.COUNTRY || row.country || "",
                    );
                    // Get languages from DB and parse as JSON array (like example line 1712-1713)
                    try {
                      dbLanguages = JSON.parse(
                        decodeURIComponent(
                          row.LANGUAGES || row.languages || "[]",
                        ),
                      );
                    } catch (e) {
                      dbLanguages = [];
                    }
                  }

                  // Use DB values as primary, keypair as fallback
                  var finalCountry = dbCountry || country;
                  var finalLanguages =
                    dbLanguages.length > 0 ? dbLanguages : [];
                  // Try to parse keypair languages if DB is empty
                  if (finalLanguages.length === 0 && languages) {
                    try {
                      finalLanguages = JSON.parse(languages);
                    } catch (e) {
                      finalLanguages = [];
                    }
                  }

                  buildPublicListings(myPubkey, myAddress, function (listings) {
                    var beacon = {
                      app: "metachain",
                      type: "BEACON",
                      v: 1,
                      pubkey: myPubkey,
                      alias: myName,
                      bio: bio,
                      address: myAddress,
                      allowNonContactChats: allowNonContactChats,
                      country: finalCountry,
                      languages: finalLanguages,
                      // Persist our immutable Wallet Address
                      minimaaddress: resolvedMinimaAddress,
                      // Use maxima icon as primary, MY_PROFILE as fallback
                      avatar: myAvatar || avatar,
                      listings: listings || [],
                      timestamp: Date.now(),
                    };

                    var jsonStr = JSON.stringify(beacon);
                    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                    // P2P broadcast
                    MDS.cmd("message data:" + hexData, function (res) {
                      MDS.log("📡 [BG-BEACON] P2P broadcast sent");
                    });

                    // MLS unicast (Maxima) to make MLS a discovery hub
                    sendBeaconToMLS(maxInfo.response, hexData);

                    // Save self to DB
                    handleBeacon(beacon, "SELF");
                  });
                },
              );
            };

            if (!minimaAddress) {
              MDS.cmd("getaddress", function (addrRes) {
                if (
                  addrRes &&
                  addrRes.status &&
                  addrRes.response &&
                  addrRes.response.miniaddress
                ) {
                  minimaAddress = addrRes.response.miniaddress;
                }
                finalizeBeacon(minimaAddress);
              });
            } else {
              finalizeBeacon(minimaAddress);
            }
          });
        });
      });
    });
  });
}

function sendBeaconToMLS(maxInfoResponse, hexData) {
  if (!maxInfoResponse) return;

  var mls = maxInfoResponse.mls;
  if (!mls) {
    return;
  }

  // MLS format: MxG18HGG...@45.128.3.158:9001
  var atIndex = mls.indexOf("@");
  if (atIndex === -1) {
    MDS.log("⚠️ [BEACON-MLS] Invalid MLS format: " + mls);
    return;
  }

  var mlsMxPrefix = mls.substring(0, atIndex);
  var myMxPrefix = maxInfoResponse.p2pidentity || "";
  if (myMxPrefix.indexOf("@") !== -1) {
    myMxPrefix = myMxPrefix.substring(0, myMxPrefix.indexOf("@"));
  }
  if (!myMxPrefix) {
    var myContact = maxInfoResponse.contact || "";
    myMxPrefix =
      myContact.indexOf("@") !== -1
        ? myContact.substring(0, myContact.indexOf("@"))
        : myContact;
  }

  // Avoid self-send if we are the MLS server (self-messages are dropped)
  if (mlsMxPrefix && myMxPrefix && mlsMxPrefix === myMxPrefix) {
    return;
  }

  MDS.cmd(
    "maxima action:send to:" +
      mls +
      " application:metachain data:" +
      hexData +
      " poll:false",
    function (res) {
      if (res.status) {
        MDS.log("✅ [BEACON-MLS] Beacon sent to MLS");
      } else {
        MDS.log(
          "⚠️ [BEACON-MLS] Failed to send beacon to MLS: " +
            (res.error || "unknown error"),
        );
      }
    },
  );
}

function startCleanupTimer() {
  var now = Date.now();
  var TTL = 600000; // 10 minutes

  var cleanupSql =
    "DELETE FROM DISCOVERED_PEERS WHERE last_seen < " +
    (now - TTL) +
    " AND source != 'SELF'";
  MDS.sql(cleanupSql, function (res) {
    if (res.status && res.count > 0) {
      MDS.log("🧹 [CLEANUP] Removed " + res.count + " stale peers");
    }
  });
}

function createDiscoveredPeersTable() {
  MDS.log("💾 [DB] DISCOVERED_PEERS table check (already created in init).");
}

var LAST_MLS_BOOTSTRAP_AT = 0;
var MLS_BOOTSTRAP_THROTTLE_MS = 30000;

/**
 * Bootstrap discovery by sending get_peers to the configured MLS server.
 * Called on startup when DISCOVERED_PEERS may be empty (e.g. after -clean).
 * The MLS server has MetaChain and knows all registered peers — asking it
 * breaks the chicken-and-egg problem without requiring prior contacts.
 */
function bootstrapFromMLS() {
  var now = Date.now();
  if (now - LAST_MLS_BOOTSTRAP_AT < MLS_BOOTSTRAP_THROTTLE_MS) {
    MDS.log("⏭️ [BOOTSTRAP] Throttled repeated MLS bootstrap attempt.");
    return;
  }
  LAST_MLS_BOOTSTRAP_AT = now;

  MDS.log("🔗 [BOOTSTRAP] Checking DISCOVERED_PEERS count...");

  MDS.sql(
    "SELECT COUNT(*) AS cnt FROM DISCOVERED_PEERS WHERE source != 'SELF'",
    function (countRes) {
      var count =
        countRes.status && countRes.rows && countRes.rows.length > 0
          ? countRes.rows[0].CNT || countRes.rows[0].cnt || 0
          : 0;

      if (count > 0) {
        MDS.log(
          "🔗 [BOOTSTRAP] Already have " +
            count +
            " peers — skipping MLS bootstrap.",
        );
        return;
      }

      MDS.log("🔗 [BOOTSTRAP] No peers found. Attempting MLS bootstrap...");

      MDS.cmd("maxima action:info", function (maxInfo) {
        if (!maxInfo.status) {
          MDS.log("⚠️ [BOOTSTRAP] Could not get Maxima info.");
          return;
        }

        var mls = maxInfo.response.mls;
        if (!mls) {
          MDS.log(
            "⚠️ [BOOTSTRAP] No MLS server configured — skipping bootstrap.",
          );
          return;
        }

        // MLS format: MxG18HGG...@45.128.3.158:9001
        var atIndex = mls.indexOf("@");
        if (atIndex === -1) {
          MDS.log("⚠️ [BOOTSTRAP] Invalid MLS format: " + mls);
          return;
        }

        var mlsMxPrefix = mls.substring(0, atIndex);
        var mlsHost = mls.substring(atIndex + 1);

        // Detect self-bootstrap: if we ARE the MLS server, skip (self-messages are dropped by Minima)
        var myMxPrefix = maxInfo.response.p2pidentity || "";
        if (myMxPrefix.indexOf("@") !== -1) {
          myMxPrefix = myMxPrefix.substring(0, myMxPrefix.indexOf("@"));
        }
        if (!myMxPrefix) {
          var myContact = maxInfo.response.contact || "";
          myMxPrefix =
            myContact.indexOf("@") !== -1
              ? myContact.substring(0, myContact.indexOf("@"))
              : myContact;
        }
        if (mlsMxPrefix && myMxPrefix && mlsMxPrefix === myMxPrefix) {
          MDS.log(
            "⏭️ [BOOTSTRAP] We ARE the MLS server — skipping self-bootstrap.",
          );
          return;
        }

        var mlsFullAddress = mls; // Full address: MxG18HGG...@45.128.3.158:9001
        MDS.log("🔗 [BOOTSTRAP] Sending get_peers to MLS @ " + mlsHost + "...");

        var myAlias = maxInfo.response.name || "Anonymous";
        var myAddress = maxInfo.response.contact || "";

        var requestPayload = {
          app: "metachain",
          type: "get_peers",
          alias: myAlias,
          address: myAddress,
        };

        var hexData =
          "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

        MDS.cmd(
          "maxima action:send to:" +
            mlsFullAddress +
            " application:metachain data:" +
            hexData +
            " poll:false",
          function (res) {
            if (res.status) {
              MDS.log(
                "✅ [BOOTSTRAP] get_peers sent to MLS server @ " + mlsHost,
              );
            } else {
              MDS.log(
                "⚠️ [BOOTSTRAP] Failed to send to MLS @ " +
                  mlsHost +
                  ": " +
                  (res.error || "unknown error"),
              );
            }
          },
        );
      });
    },
  );
}

/**
 * MetaChain Service Worker - Gossip Handler
 * Handles peer exchange (gossip) protocol
 */

function loadListingsMap(callback) {
  MDS.sql(
    "SELECT owner_publickey, listings, timestamp FROM DISCOVERED_LISTINGS",
    function (res) {
      var map = {};
      if (res.status && res.rows) {
        for (var i = 0; i < res.rows.length; i++) {
          var row = res.rows[i];
          var pk = row.OWNER_PUBLICKEY || row.owner_publickey;
          if (!pk) continue;
          var listJson = row.LISTINGS || row.listings || "[]";
          var parsed = [];
          try {
            parsed = JSON.parse(
              typeof listJson === "string"
                ? listJson
                : JSON.stringify(listJson),
            );
          } catch (e) {
            parsed = [];
          }
          map[pk] = {
            listings: parsed,
            timestamp: row.TIMESTAMP || row.timestamp || 0,
          };
        }
      }
      callback(map);
    },
  );
}

function handleGetPeers(pubkey, maxjson) {
  MDS.log(
    "🗣️ [GOSSIP] Peer request from " +
      (maxjson.alias || pubkey.substring(0, 10)),
  );

  loadListingsMap(function (listingsMap) {
    // Fetch known peers
    var peerSql =
      "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 50";
    MDS.sql(peerSql, function (res) {
      if (res.status && res.rows && res.rows.length > 0) {
        var peers = [];
        for (var i = 0; i < res.rows.length; i++) {
          var row = res.rows[i];
          var publickey = row.PUBLICKEY || row.publickey;

          // Parse extra_data
          var avatar = "";
          var country = "";
          var languages = [];
          var bio = row.BIO || "";
          var timestamp = 0;

          if (row.EXTRA_DATA) {
            try {
              var extraObj = JSON.parse(row.EXTRA_DATA);
              avatar = extraObj.avatar || "";
              country = extraObj.country || "";
              languages = extraObj.languages || [];
              if (!bio && extraObj.bio) bio = extraObj.bio;
              timestamp = extraObj.timestamp || 0;
            } catch (e) {}
          }

          var listingEntry = listingsMap[publickey];

          var ancc = row.ALLOW_NON_CONTACT_CHATS;
          peers.push({
            pubkey: publickey,
            alias: row.ALIAS,
            bio: bio,
            address: row.ADDRESS,
            allowNonContactChats:
              ancc === 1 || ancc === true || ancc === "1" || ancc === "true" || ancc === "TRUE",
            avatar: avatar,
            country: country,
            languages: languages,
            listings: listingEntry ? listingEntry.listings : undefined,
            timestamp: timestamp || (listingEntry ? listingEntry.timestamp : 0),
          });
        }

        // Send response (prefer address when provided to avoid contact requirement)
        var replyPayload = {
          app: "metachain",
          type: "peers_response",
          peers: peers,
        };
        var replyHex = "0x" + utf8ToHex(JSON.stringify(replyPayload)).toUpperCase();
        var targetAddress = maxjson && maxjson.address ? maxjson.address : "";

        if (targetAddress) {
            var sendCmd = "maxima action:send to:" + targetAddress + " application:metachain data:" + replyHex + " poll:false";
            MDS.cmd(sendCmd, function (sendRes) {
                if (sendRes && sendRes.status === false) {
                    MDS.log("⚠️ [GOSSIP] Failed to send peers to address: " + sendRes.error);
                } else {
                    MDS.log("✅ [GOSSIP] Sent " + peers.length + " peers to " + targetAddress);
                }
                // Always also send via smartSend (publickey fallback with resolution)
                smartSend(pubkey, "metachain", replyHex, "GOSSIP-REPLY", false);
            });
        } else {
            smartSend(pubkey, "metachain", replyHex, "GOSSIP-REPLY", false);
        }
      }
    });
  });
}

function handlePeersResponse(pubkey, maxjson) {
  var peerCount = maxjson.peers ? maxjson.peers.length : 0;
  var senderAlias = pubkey ? pubkey.substring(0, 10) : "P2P-broadcast";

  MDS.log("📥 [GOSSIP] Received " + peerCount + " peers from " + senderAlias);

  if (maxjson.peers && Array.isArray(maxjson.peers)) {
    var processedCount = 0;
    var skippedCount = 0;

    for (var i = 0; i < maxjson.peers.length; i++) {
      var peer = maxjson.peers[i];

      // Debug each peer
      MDS.log(
        "🔍 [GOSSIP-PEER] " +
          (i + 1) +
          "/" +
          peerCount +
          ": " +
          (peer.alias || "no-alias") +
          " (" +
          (peer.pubkey ? peer.pubkey.substring(0, 10) : "no-pubkey") +
          "...)",
      );

      if (peer.pubkey && peer.address && peer.alias) {
        MDS.log("✅ [GOSSIP-PEER] Processing beacon for: " + peer.alias);
        handleBeacon(peer, "GOSSIP");
        processedCount++;
      } else {
        MDS.log(
          "⚠️ [GOSSIP-PEER] Skipping incomplete peer - pubkey:" +
            !!peer.pubkey +
            " address:" +
            !!peer.address +
            " alias:" +
            !!peer.alias,
        );
        skippedCount++;
      }
    }

    MDS.log(
      "📊 [GOSSIP] Summary: " +
        processedCount +
        " processed, " +
        skippedCount +
        " skipped",
    );
  } else {
    MDS.log("⚠️ [GOSSIP] No valid peers array in response");
  }
}

function startGossip() {
  MDS.log("🗣️ [GOSSIP] Starting discovery...");

  // Try discovered peers first
  MDS.sql(
    "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT " + (typeof DISCOVERY_LIMIT !== "undefined" ? DISCOVERY_LIMIT : 5),
    function (res) {
      if (res.status && res.rows && res.rows.length > 0) {
        MDS.log(
          "🗣️ [GOSSIP] Asking " + res.rows.length + " discovered peers...",
        );
        var pubkeys = [];
        for (var i = 0; i < res.rows.length; i++) {
          pubkeys.push(res.rows[i].PUBLICKEY);
        }
        var validPubkeys = pubkeys.filter(function (pk) {
          return pk !== MY_MAXIMA_PK;
        });

        if (validPubkeys.length > 0) {
          askPeers(validPubkeys);
        } else {
          MDS.log(
            "⚠️ [GOSSIP] Only self found in discovery — triggering MLS bootstrap fallback.",
          );
          if (typeof bootstrapFromMLS === "function") {
            bootstrapFromMLS();
          }
        }
      } else {
        // Fallback to contacts
        MDS.cmd("maxcontacts", function (contactRes) {
          if (
            contactRes.status &&
            contactRes.response.contacts &&
            contactRes.response.contacts.length > 0
          ) {
            var targets = [];
            for (
              var i = 0;
              i < Math.min(5, contactRes.response.contacts.length);
              i++
            ) {
              targets.push(contactRes.response.contacts[i].publickey);
            }
            MDS.log("🗣️ [GOSSIP] Asking " + targets.length + " contacts...");
            askPeers(targets);
          } else {
            MDS.log(
              "⚠️ [GOSSIP] No peers or contacts — triggering MLS bootstrap fallback.",
            );
            if (typeof bootstrapFromMLS === "function") {
              bootstrapFromMLS();
            }
          }
        });
      }
    },
  );
}

function askPeers(pubkeys) {
  MDS.cmd("maxima action:info", function (maxInfo) {
    var myAlias = maxInfo.status ? maxInfo.response.name : "Anonymous";
    var myAddress = maxInfo.status
      ? maxInfo.response.mls || maxInfo.response.contact || ""
      : "";

    var requestPayload = {
      app: "metachain",
      type: "get_peers",
      alias: myAlias,
      address: myAddress,
    };

    var hexData =
      "0x" + utf8ToHex(JSON.stringify(requestPayload)).toUpperCase();

    for (var i = 0; i < pubkeys.length; i++) {
      var pk = pubkeys[i];
      if (MY_MAXIMA_PK && pk === MY_MAXIMA_PK) continue;

      smartSend(pk, "metachain", hexData, "GOSSIP-ASK", false);
    }
  });
}

function sendWelcomePackage(targetPubkey, targetAlias, targetAddress) {
  if (MY_MAXIMA_PK && targetPubkey === MY_MAXIMA_PK) return;

  MDS.log("🎁 [GOSSIP] Sending Welcome Package to " + targetAlias);

  loadListingsMap(function (listingsMap) {
    var peerSql =
      "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC LIMIT 50";
    MDS.sql(peerSql, function (res) {
      if (res.status && res.rows && res.rows.length > 0) {
        var peers = [];
        for (var i = 0; i < res.rows.length; i++) {
          var row = res.rows[i];
          var publickey = row.PUBLICKEY || row.publickey;

          var avatar = "";
          var country = "";
          var languages = [];
          var bio = row.BIO || "";
          var timestamp = 0;

          if (row.EXTRA_DATA) {
            try {
              var extraObj = JSON.parse(row.EXTRA_DATA);
              avatar = extraObj.avatar || "";
              country = extraObj.country || "";
              languages = extraObj.languages || [];
              if (!bio && extraObj.bio) bio = extraObj.bio;
              timestamp = extraObj.timestamp || 0;
            } catch (e) {}
          }

          var listingEntry = listingsMap[publickey];

          var ancc2 = row.ALLOW_NON_CONTACT_CHATS;
          peers.push({
            pubkey: publickey,
            alias: row.ALIAS,
            bio: bio,
            address: row.ADDRESS,
            allowNonContactChats:
              ancc2 === 1 || ancc2 === true || ancc2 === "1" || ancc2 === "true" || ancc2 === "TRUE",
            avatar: avatar,
            country: country,
            languages: languages,
            listings: listingEntry ? listingEntry.listings : undefined,
            timestamp: timestamp || (listingEntry ? listingEntry.timestamp : 0),
          });
        }

        var responsePayload = {
          app: "metachain",
          type: "peers_response",
          peers: peers,
        };

        var hexData =
          "0x" + utf8ToHex(JSON.stringify(responsePayload)).toUpperCase();

        // Send via Maxima unicast directly to the target
        // Prioritize to:address (no contact required), fallback to publickey
        if (targetAddress) {
            var sendCmd = "maxima action:send to:" + targetAddress + " application:metachain data:" + hexData + " poll:false";
            MDS.cmd(sendCmd, function (sendRes) {
                if (sendRes && sendRes.status === false) {
                    MDS.log("⚠️ [GOSSIP] Failed to send Welcome Package to " + targetAddress + ": " + sendRes.error);
                } else {
                    MDS.log("✅ [GOSSIP] Welcome Package sent to " + targetAddress);
                }
                // Always also send via smartSend (publickey fallback with resolution)
                smartSend(targetPubkey, "metachain", hexData, "GOSSIP-WELCOME", false);
            });
        } else {
            smartSend(targetPubkey, "metachain", hexData, "GOSSIP-WELCOME", false);
        }
      }
    });
  });
}

/**
 * MetaChain Service Worker - Main Dispatcher
 * Minimal entry point that routes events to handlers
 *
 * NOTE: This file is concatenated with handlers during build.
 * Build command: npm run build:service-worker
 */

// ============================================================================

// ============================================================================
// MAIN EVENT DISPATCHER
// ============================================================================

// Flag to ensure startup cleanup runs once after DB is ready (triggered by first NEWBLOCK)
var DB_INIT_DONE = false;
var DB_READY = false;
var INITIAL_CLEANUP_DONE = false;
var GROUP_STARTUP_SYNC_DONE = false;

// Flag to trigger coin discovery on first NEWBLOCK (when node is synced)
var COIN_DISCOVERY_PENDING = false;
var NEWBLOCK_COUNT = 0;

// Connection state tracking for reconnection sync
var LAST_MAXIMA_EVENT_TIME = 0;
var CONNECTION_TIMEOUT_MS = 120000; // 2 minutes - if no MAXIMA events, consider offline
var WAS_OFFLINE = false;

MDS.init(function (msg) {
  // Initialization
  if (msg.event == "inited") {
    MDS.log("🚀 [SW] Inited event received. Version v3.0");
    MDS.notify("MetaChain Service Worker Started");
    MDS.log("⏰ [SW] Starting Database Initialization...");
    initDatabase();

    // Load user-configurable discovery settings from keypair
    MDS.keypair.get("discovery_interval", function (res) {
      if (res && res.status && res.value) {
        var secs = parseInt(res.value) || 30;
        if (secs >= 30) {
          GOSSIP_INTERVAL = secs * 1000;
          MDS.log("⚙️ [SETTINGS] GOSSIP_INTERVAL=" + GOSSIP_INTERVAL + "ms");
        }
      }
    });
    MDS.keypair.get("discovery_limit", function (res) {
      if (res && res.status && res.value) {
        var lim = parseInt(res.value) || 5;
        if (lim >= 1 && lim <= 50) {
          DISCOVERY_LIMIT = lim;
          MDS.log("⚙️ [SETTINGS] DISCOVERY_LIMIT=" + DISCOVERY_LIMIT);
        }
      }
    });
  }

  // Periodic tasks via NEWBLOCK
  else if (msg.event == "NEWBLOCK") {
    // 1. WAIT FOR DB TO BE READY (Async Init)
    if (!DB_READY) {
      return;
    }

    // Run one-time startup cleanup if not done yet
    if (!INITIAL_CLEANUP_DONE) {
      INITIAL_CLEANUP_DONE = true;
      cleanupOrphanedChatMessages();
      // Delay group sync slightly to let DB settle
      MDS.cmd("timer 3000", function () {
        if (typeof requestAllGroupsHistory === "function") {
          requestAllGroupsHistory();
          requestAllChannelsHistory();
          GROUP_STARTUP_SYNC_DONE = true;
        }
      });
    }

    // Run coin discovery at block 5 (gives time for coins to sync)
    if (COIN_DISCOVERY_PENDING) {
      NEWBLOCK_COUNT++;
      if (NEWBLOCK_COUNT >= 5) {
        COIN_DISCOVERY_PENDING = false;
        MDS.log(
          "📦 [COIN-DISCOVERY] Running at block " + NEWBLOCK_COUNT + "...",
        );
        if (typeof discoverOfflineTokens === "function") {
          discoverOfflineTokens()
            .then(function (count) {
              if (count > 0) {
                MDS.log(
                  "📦 [COIN-DISCOVERY] Recovered " +
                    count +
                    " offline token(s)",
                );
              }
            })
            .catch(function (err) {
              MDS.log("⚠️ [COIN-DISCOVERY] Error: " + err);
            });
        }
      }
    }

    var now = Date.now();

    // Gossip interval
    if (now - LAST_GOSSIP > GOSSIP_INTERVAL) {
      LAST_GOSSIP = now;
      startGossip();
      startCleanupTimer();
      sendBackgroundBeacon();
      sendGroupAddressBeacon(); // Keep group member addresses fresh in DISCOVERED_PEERS
      checkPendingTransactions(); // Check for zombie transactions
      checkSentTransactions(); // Check for confirmations (sent -> confirmed)
    }
  }

  // Periodic 10-second timer — used for sync timeout checks
  else if (msg.event == "MDS_TIMER_10SECONDS") {
    if (typeof checkSyncTimeouts === "function") {
      checkSyncTimeouts();
    }
    if (typeof checkChannelSyncTimeouts === "function") {
      checkChannelSyncTimeouts();
    }
  }

  // Service commands from frontend
  else if (msg.event == "MDS_SERVICECMD") {
    if (msg.data && msg.data.service === "COINDISC") {
      MDS.log("📦 [SERVICE] Coin discovery requested from frontend");
      if (typeof discoverOfflineTokens === "function") {
        discoverOfflineTokens()
          .then(function (count) {
            if (count > 0) {
              MDS.log("📦 [SERVICE] Recovered " + count + " offline token(s)");
            } else {
              MDS.log("📦 [SERVICE] No new offline tokens found");
            }
          })
          .catch(function (err) {
            MDS.log("⚠️ [SERVICE] Coin discovery error: " + err);
          });
      }
    }
    // Frontend requests individual chat history sync — centralized in SW
    // Format: service:CHAT_SYNC:<pubkey>
    else if (msg.data && typeof msg.data.service === "string" && msg.data.service.indexOf("CHAT_SYNC:") === 0) {
      var syncPubkey = msg.data.service.substring("CHAT_SYNC:".length);
      if (syncPubkey && typeof requestChatHistory === "function") {
        MDS.log("🔄 [SERVICE] Chat sync requested from frontend for " + syncPubkey.substring(0, 10));
        requestChatHistory(syncPubkey);
      }
    }
    // Frontend requests group history sync — centralized in SW
    // Format: service:GROUP_SYNC:<groupId>
    else if (msg.data && typeof msg.data.service === "string" && msg.data.service.indexOf("GROUP_SYNC:") === 0) {
      var syncGroupId = msg.data.service.substring("GROUP_SYNC:".length);
      if (syncGroupId && typeof requestGroupHistoryFromSW === "function") {
        MDS.log("🔄 [SERVICE] Group sync requested from frontend for " + syncGroupId);
        requestGroupHistoryFromSW(syncGroupId);
      }
    }
  }

  // MAXIMA messages
  else if (msg.event == "MAXIMA") {
    // Track connection state for reconnection detection
    var now = Date.now();
    var wasOffline = now - LAST_MAXIMA_EVENT_TIME > CONNECTION_TIMEOUT_MS;

    if (wasOffline && LAST_MAXIMA_EVENT_TIME > 0) {
      MDS.log(
        "🔄 [RECONNECT] Node back online after offline period. Triggering history sync...",
      );
      WAS_OFFLINE = true;

      // Notify frontend to retry queued messages immediately
      MDS.comms.solo(
        JSON.stringify({
          type: "RECONNECTED",
          timestamp: now,
        }),
      );

      // Trigger history sync from recent contacts
      if (typeof requestHistoryFromRecentContacts === "function") {
        requestHistoryFromRecentContacts();
      }
      // Also sync all group histories
      if (typeof requestAllGroupsHistory === "function") {
        requestAllGroupsHistory();
      }
      if (typeof requestAllChannelsHistory === "function") {
        requestAllChannelsHistory();
      }
    }

    LAST_MAXIMA_EVENT_TIME = now;
    MDS.log(
      "📨 [MAXIMA] RAW DATA: App=" +
        msg.data.application +
        " From=" +
        msg.data.from.substring(0, 10) +
        " DataLen=" +
        (msg.data.data ? msg.data.data.length : 0),
    );
    logToUI(
      "📨 [MAXIMA] Event received. App: " +
        msg.data.application +
        " From: " +
        msg.data.from.substring(0, 10),
    );

    if (
      msg.data.application &&
      (msg.data.application.toLowerCase() == "metachain" ||
        msg.data.application.toLowerCase() == "metachain-group" ||
        msg.data.application.toLowerCase() == "metachain-channel")
    ) {
      var app = msg.data.application.toLowerCase();
      var pubkey = msg.data.from;
      var jsonstr = "";
      if (msg.data.data.startsWith("0x")) {
        var datastr = msg.data.data.substring(2);
        jsonstr = hexToUtf8(datastr);
      } else {
        jsonstr = msg.data.data;
      }

      try {
        var maxjson = JSON.parse(jsonstr);
        MDS.log(
          "🔍 [MAXIMA-DEBUG-ALL] App: " +
            app +
            " Type: " +
            (maxjson.type || maxjson.messageType) +
            " From: " +
            pubkey.substring(0, 10),
        );
        MDS.log("📨 [MAXIMA] Full JSON Payload: " + jsonstr);
        if (app === "metachain-group") {
          logToUI(
            "🔍 [MAXIMA-GROUP] Type: " +
              (maxjson.messageType || maxjson.type) +
              " From: " +
              pubkey.substring(0, 10),
          );
        }

        // ================== GROUP MESSAGES ==================
        if (
          app === "metachain-group" &&
          maxjson.messageType === "history_request"
        ) {
          handleGroupHistoryRequest(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          maxjson.messageType === "history_response"
        ) {
          handleGroupHistoryResponse(pubkey, maxjson);
          return;
        }

        if (
          (app === "metachain-group" &&
            maxjson.messageType === "group_message") ||
          (maxjson.groupId && maxjson.messageType === "group_message")
        ) {
          handleGroupMessage(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          maxjson.messageType === "group_invite"
        ) {
          handleGroupInvite(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          (maxjson.messageType === "group_member_added" ||
            maxjson.messageType === "group_member_removed")
        ) {
          handleGroupMemberUpdate(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          maxjson.messageType === "group_member_unbanned"
        ) {
          handleGroupMemberUnbanned(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          (maxjson.messageType === "group_rename" ||
            maxjson.messageType === "group_update_details" ||
            maxjson.messageType === "group_info_updated")
        ) {
          handleGroupUpdateDetails(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          maxjson.messageType === "group_role_update"
        ) {
          handleGroupRoleUpdate(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          (maxjson.messageType === "group_join_request" ||
            maxjson.messageType === "group_join_request_propagated" ||
            maxjson.messageType === "group_join_request_resolved" ||
            maxjson.type === "group_join_request")
        ) {
          handleGroupJoinRequestEvent(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-group" &&
          maxjson.messageType === "group_address_beacon"
        ) {
          handleGroupAddressBeacon(pubkey, maxjson);
          return;
        }

        if (app === "metachain-group") {
          MDS.log(
            "⚠️ [SW] Unhandled metachain-group message type: " +
              (maxjson.messageType || maxjson.type),
          );
        }

        // ================== CHANNEL MESSAGES ==================
        if (
          app === "metachain-channel" &&
          maxjson.messageType === "channel_invite"
        ) {
          handleChannelInvite(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-channel" &&
          maxjson.messageType === "channel_message"
        ) {
          handleChannelMessage(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-channel" &&
          maxjson.messageType === "channel_subscriber_added"
        ) {
          handleChannelSubscriberAdded(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-channel" &&
          maxjson.messageType === "channel_subscriber_removed"
        ) {
          handleChannelSubscriberRemoved(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-channel" &&
          maxjson.messageType === "channel_role_update"
        ) {
          handleChannelRoleUpdate(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-channel" &&
          maxjson.messageType === "channel_join_request"
        ) {
          handleChannelJoinRequest(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-channel" &&
          maxjson.messageType === "channel_info_updated"
        ) {
          handleChannelInfoUpdate(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-channel" &&
          maxjson.messageType === "channel_history_request"
        ) {
          handleChannelHistoryRequest(pubkey, maxjson);
          return;
        }

        if (
          app === "metachain-channel" &&
          maxjson.messageType === "channel_history_response"
        ) {
          handleChannelHistoryResponse(pubkey, maxjson);
          return;
        }

        // ================== CHAT MESSAGES ==================
        if (maxjson.type === "read") {
          handleReadReceipt(pubkey);
          return;
        }

        if (maxjson.type === "delivery_receipt") {
          handleDeliveryReceipt(pubkey);
          return;
        }

        if (maxjson.type === "ping") {
          handlePing(pubkey);
          return;
        }

        if (maxjson.type === "pong") {
          handlePong(pubkey);
          return;
        }

        if (maxjson.type === "chat_history_request") {
          handleChatHistoryRequest(pubkey, maxjson);
          return;
        }

        if (maxjson.type === "chat_history_response") {
          handleChatHistoryResponse(pubkey, maxjson);
          return;
        }

        // ================== BEACONS & DISCOVERY ==================
        if (maxjson.type === "register" || maxjson.type === "BEACON") {
          MDS.log("📡 [P2P] Beacon: " + maxjson.alias);
          handleBeacon(maxjson, "MAXIMA");
          return;
        }

        // ================== GOSSIP ==================
        if (maxjson.type === "get_peers") {
          MDS.log(
            "📨 [MAXIMA-GOSSIP] get_peers request from " +
              pubkey.substring(0, 10),
          );
          handleGetPeers(pubkey, maxjson);
          return;
        }

        if (maxjson.type === "peers_response") {
          MDS.log(
            "📨 [MAXIMA-GOSSIP] peers_response from " + pubkey.substring(0, 10),
          );
          handlePeersResponse(pubkey, maxjson);
          return;
        }

        // ================== PROFILE ==================
        if (maxjson.type === "profile_request") {
          handleProfileRequest(pubkey, maxjson);
          return;
        }

        if (maxjson.type === "profile_response") {
          handleProfileResponse(pubkey, maxjson);
          return;
        }

        // ================== CONTACT REQUESTS ==================
        if (maxjson.type === "contact_request") {
          handleContactRequest(pubkey, maxjson);
          return;
        }

        if (maxjson.type === "contact_request_received") {
          handleContactRequestReceived(pubkey);
          return;
        }

        if (maxjson.type === "contact_declined") {
          handleContactDeclined(pubkey);
          return;
        }

        if (maxjson.type === "contact_cancelled") {
          handleContactCancelled(pubkey);
          return;
        }

        if (maxjson.type === "contact_accepted") {
          handleContactAccepted(pubkey, maxjson);
          return;
        }

        // ================== MAXIMA CONTACT REQUESTS ==================
        if (maxjson.type === "maxima_contact_request") {
          handleMaximaContactRequest(pubkey, maxjson);
          return;
        }

        if (maxjson.type === "maxima_contact_accepted") {
          handleMaximaContactAccepted(pubkey, maxjson);
          return;
        }

        if (maxjson.type === "maxima_contact_declined") {
          handleMaximaContactDeclined(pubkey);
          return;
        }

        if (maxjson.type === "maxima_contact_cancelled") {
          handleMaximaContactCancelled(pubkey);
          return;
        }

        if (maxjson.type === "maxima_contact_removed") {
          handleMaximaContactRemoved(pubkey, maxjson);
          return;
        }

        if (maxjson.type === "contact_blocked") {
          handleContactBlocked(pubkey);
          return;
        }

        if (maxjson.type === "contact_unblocked") {
          handleContactUnblocked(pubkey);
          return;
        }

        // ================== SMART SYNCHRONIZATION ==================
        if (maxjson.type === "sync_status_check") {
          handleSyncStatusCheck(maxjson, pubkey);
          return;
        }

        if (maxjson.type === "sync_status_report") {
          handleSyncStatusReport(maxjson, pubkey);
          return;
        }

        // ================== CHAT MESSAGES (Default) ==================
        // FILTER: Only process actual chat message types
        var validChatTypes = [
          "text",
          "image",
          "video",
          "audio",
          "file",
          "charm",
          "token",
          "gif",
          "sticker",
          "voice",
        ];
        if (
          validChatTypes.indexOf(maxjson.type) !== -1 &&
          maxjson.message !== undefined
        ) {
          handleChatMessage(pubkey, maxjson);
          return;
        }

        MDS.log(
          "⚠️ [MAXIMA] Unhandled type: " +
            (maxjson.type || maxjson.messageType || "unknown"),
        );
      } catch (e) {
        MDS.log("❌ [MAXIMA] Parse error: " + e.message);
      }
    }
  }

  // MINIMALOG for P2P beacons
  else if (msg.event == "MINIMALOG") {
    if (msg.data && msg.data.message) {
      var logMsg = msg.data.message;

      // Ignore our own debug logs (prevent infinite loop)
      if (
        logMsg.indexOf("[BEACON]") !== -1 ||
        logMsg.indexOf("[P2P]") !== -1 ||
        logMsg.indexOf("[SW]") !== -1 ||
        logMsg.indexOf("[MAXIMA]") !== -1 ||
        logMsg.indexOf("[GOSSIP]") !== -1 ||
        logMsg.indexOf("[DB]") !== -1
      ) {
        return;
      }

      // P2P beacon detection - use flexible pattern like example
      var hexIndex = logMsg.toLowerCase().indexOf("0x7b");
      if (hexIndex !== -1) {
        try {
          var rawHex = logMsg.substring(hexIndex);
          var hexMatch = rawHex.match(/^(0x[0-9A-Fa-f]+)/);
          if (!hexMatch) return;

          var hexData = hexMatch[1].substring(2);
          var jsonStr = hexToUtf8(hexData);
          jsonStr = jsonStr.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
          var beacon = JSON.parse(jsonStr);

          if (
            beacon.app === "metachain" &&
            (beacon.type === "BEACON" || beacon.type === "register")
          ) {
            if (MY_MAXIMA_PK && beacon.pubkey === MY_MAXIMA_PK) {
              return; // Ignore self
            }
            MDS.log("📡 [P2P] Beacon: " + beacon.alias);
            handleBeacon(beacon, "P2P");
          } else if (
            beacon.app === "metachain" &&
            beacon.type === "peers_response"
          ) {
            MDS.log("📨 [P2P-GOSSIP] peers_response broadcast received");
            handlePeersResponse(null, beacon);
          }
        } catch (e) {
          // Silent fail
        }
      }
    }
  }
});

