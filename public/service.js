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
var GOSSIP_INTERVAL = 30000; // 30 seconds
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
                    // Try to resolve to Maxima address first
                    resolveMaximaAddress(toPublicKey, function (err, mxAddress) {
                        if (!err && mxAddress) {
                            MDS.log("🔍 [SW-MAXIMA] Resolved 0x to Mx address: " + mxAddress);
                            sendMessage("maxima action:send to:" + cleanMaximaAddress(mxAddress) + " application:metachain data:" + hexData + " poll:false");
                        } else {
                            sendMessage("maxima action:send publickey:" + toPublicKey + " application:metachain data:" + hexData + " poll:false");
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
    MDS.cmd("event on newblock", function (res) { });

    // Get our own Maxima info
    MDS.cmd("maxima action:info", function (maxInfo) {
        if (maxInfo.status) {
            MY_MAXIMA_PK = maxInfo.response.publickey;
            MDS.log("🔑 [SW] My Public Key: " + MY_MAXIMA_PK);
        }
    });

    // START SEQUENTIAL INIT
    var chain = Promise.resolve();

    // 1. TRANSACTIONS
    chain = chain.then(function () {
        var sql = "CREATE TABLE IF NOT EXISTS TRANSACTIONS ( "
            + "  id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            + "  txpowid VARCHAR(128) NOT NULL, "
            + "  date BIGINT NOT NULL, "
            + "  amount VARCHAR(64) NOT NULL, "
            + "  tokenid VARCHAR(128) NOT NULL, "
            + "  message VARCHAR(255), "
            + "  status VARCHAR(32) DEFAULT 'pending' "
            + " )";
        return runSQL(sql).then(function (res) {
            MDS.log(res.status ? "📂 [DB] TRANSACTIONS table checked/init" : "❌ [DB] TRANSACTIONS init failed: " + res.error);
            // REPAIR: Always run these ALTERs
            return Promise.all([
                runSQL("ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS type VARCHAR(32)"),
                runSQL("ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS publickey VARCHAR(512)"),
                runSQL("ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS message_timestamp BIGINT"),
                runSQL("ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS metadata CLOB"),
                runSQL("ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS pendinguid VARCHAR(128)"),
                // FORCE ADD DATE COLUMN IF MISSING (Fix for 'Column DATE not found')
                runSQL("ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS date BIGINT"),
                runSQL("ALTER TABLE TRANSACTIONS ALTER COLUMN date SET NOT NULL") // Enforce not null if possible, or ignore
            ]);
        });
    });

    // 2. CHAT_MESSAGES
    chain = chain.then(function () {
        var sql = "CREATE TABLE IF NOT EXISTS CHAT_MESSAGES ( "
            + "  id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            + "  roomname varchar(160) NOT NULL, "
            + "  publickey varchar(512) NOT NULL, "
            + "  username varchar(160) NOT NULL, "
            + "  type varchar(64) NOT NULL, "
            + "  message varchar(512) NOT NULL, "
            + "  filedata clob(256K) NOT NULL, "
            + "  customid varchar(128) NOT NULL DEFAULT '0x00', "
            + "  state varchar(128) NOT NULL DEFAULT '', "
            + "  read int NOT NULL DEFAULT 0, "
            + "  amount int NOT NULL DEFAULT 0, "
            + "  date bigint NOT NULL "
            + " )";
        return runSQL(sql).then(function (res) {
            MDS.log(res.status ? "💾 [DB] CHAT_MESSAGES checked/init" : "❌ [DB] CHAT_MESSAGES init failed");
            return Promise.all([
                runSQL("ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS amount INT NOT NULL DEFAULT 0"),
                runSQL("ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS original_timestamp BIGINT"),
                runSQL("ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS txpowid VARCHAR(128)"),
                runSQL("ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS sender_seq INT DEFAULT 0"),
                runSQL("ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS customid VARCHAR(128)")
            ]);
        });
    });

    // 3. CHAT_STATUS
    chain = chain.then(function () {
        var sql = "CREATE TABLE IF NOT EXISTS CHAT_STATUS ( "
            + "  publickey VARCHAR(512) PRIMARY KEY, "
            + "  archived BOOLEAN NOT NULL DEFAULT FALSE, "
            + "  archived_date BIGINT, "
            + "  last_opened BIGINT, "
            + "  favorite BOOLEAN NOT NULL DEFAULT FALSE, "
            + "  blocked BOOLEAN NOT NULL DEFAULT FALSE, "
            + "  blocked_by_them BOOLEAN NOT NULL DEFAULT FALSE "
            + " )";
        return runSQL(sql).then(function () {
            return Promise.all([
                runSQL("ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE"),
                runSQL("ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE"),
                runSQL("ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked_by_them BOOLEAN NOT NULL DEFAULT FALSE")
            ]);
        });
    });

    // 4. MESSAGE_COUNTERS (for sequence tracking)
    chain = chain.then(function () {
        var sql = "CREATE TABLE IF NOT EXISTS MESSAGE_COUNTERS ( "
            + "  publickey VARCHAR(512) PRIMARY KEY, "
            + "  next_seq INT NOT NULL DEFAULT 1 "
            + " )";
        return runSQL(sql).then(function (res) {
            MDS.log(res.status ? "📊 [DB] MESSAGE_COUNTERS checked/init" : "❌ [DB] MESSAGE_COUNTERS init failed");
        });
    });

    // 5. MY_PROFILE
    chain = chain.then(function () {
        var sql = "CREATE TABLE IF NOT EXISTS MY_PROFILE ( "
            + "  id INT PRIMARY KEY, "
            + "  avatar TEXT, "
            + "  tags TEXT, "
            + "  bio_extended TEXT, "
            + "  social_links TEXT, "
            + "  location TEXT, "
            + "  last_updated BIGINT "
            + " )";
        return runSQL(sql).then(function () {
            runSQL("INSERT IGNORE INTO MY_PROFILE (id) VALUES (1)");
            return Promise.all([
                runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS phone TEXT"),
                runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS email TEXT"),
                runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS website TEXT"),
                runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS country TEXT"),
                runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS languages TEXT"),
                runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE"),
                runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l2 VARCHAR(20) DEFAULT 'public'"),
                runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l3 VARCHAR(20) DEFAULT 'contacts'"),
                runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS minimaaddress TEXT")
            ]);
        });
    });

    // 5. CONTACT_REQUESTS
    chain = chain.then(function () {
        var sql = "CREATE TABLE IF NOT EXISTS CONTACT_REQUESTS ( "
            + "  id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            + "  from_publickey VARCHAR(512) NOT NULL, "
            + "  from_name VARCHAR(255), "
            + "  from_avatar TEXT, "
            + "  to_publickey VARCHAR(512) NOT NULL, "
            + "  status VARCHAR(32) DEFAULT 'pending', "
            + "  created_at BIGINT NOT NULL, "
            + "  updated_at BIGINT "
            + " )";
        return runSQL(sql).then(function (res) {
            MDS.log(res.status ? "📂 [DB] CONTACT_REQUESTS checked/init" : "❌ [DB] CONTACT_REQUESTS init failed");
            return runSQL("ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_address VARCHAR(1024)");
        });
    });

    // 6. DISCOVERED_PEERS (Explicit sequence)
    chain = chain.then(function () {
        var sql = "CREATE TABLE IF NOT EXISTS DISCOVERED_PEERS ( "
            + "  publickey VARCHAR(512) PRIMARY KEY, "
            + "  alias VARCHAR(160) NOT NULL, "
            + "  bio VARCHAR(512), "
            + "  address VARCHAR(512) NOT NULL, "
            + "  last_seen BIGINT NOT NULL, "
            + "  source VARCHAR(20) NOT NULL"
            + " )";
        return runSQL(sql).then(function (res) {
            MDS.log(res.status ? "📂 [DB] DISCOVERED_PEERS checked/init" : "❌ [DB] DISCOVERED_PEERS init failed: " + res.error);
            return Promise.all([
                runSQL("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS bio VARCHAR(512)"),
                runSQL("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE"),
                runSQL("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS extra_data CLOB"),
                runSQL("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS avatar TEXT"),
                runSQL("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS minimaaddress VARCHAR(512)"),
                runSQL("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'P2P'")
            ]);
        });
    });

    // 7. PERSONAL_CONTACTS
    chain = chain.then(function () {
        var sql = "CREATE TABLE IF NOT EXISTS PERSONAL_CONTACTS ( publickey VARCHAR(512) PRIMARY KEY, created_at BIGINT )";
        return runSQL(sql);
    });

    // 8. MAXIMA_CONTACT_REQUESTS
    chain = chain.then(function () {
        var sql = "CREATE TABLE IF NOT EXISTS MAXIMA_CONTACT_REQUESTS ( "
            + "  id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            + "  from_publickey VARCHAR(512) NOT NULL, "
            + "  from_name VARCHAR(255), "
            + "  to_publickey VARCHAR(512) NOT NULL, "
            + "  status VARCHAR(32) DEFAULT 'pending', "
            + "  created_at BIGINT NOT NULL, "
            + "  updated_at BIGINT "
            + " )";
        return runSQL(sql);
    });

    // 9. METACHAIN_USERS
    chain = chain.then(function () {
        var sql = "CREATE TABLE IF NOT EXISTS METACHAIN_USERS ( "
            + "  user_id VARCHAR(512) PRIMARY KEY, "
            + "  publickey VARCHAR(512) UNIQUE NOT NULL, "
            + "  alias VARCHAR(160) NOT NULL, "
            + "  address VARCHAR(512) NOT NULL, "
            + "  first_seen BIGINT NOT NULL, "
            + "  last_updated BIGINT NOT NULL"
            + " )";
        return runSQL(sql).then(function (res) {
            MDS.log(res.status ? "📂 [DB] METACHAIN_USERS checked/init" : "❌ [DB] METACHAIN_USERS init failed");
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

        // Register for periodic tasks
        MDS.cmd("event on newblock", function () {
            MDS.log("✅ [INIT] NEWBLOCK listener registered for periodic tasks.");
        });

        // Trigger history sync to update message counters and chat list
        // Uses timestamp optimization to only fetch new messages
        if (typeof requestHistoryFromRecentContacts === 'function') {
            requestHistoryFromRecentContacts();
        } else {
            MDS.log("⚠️ [INIT] requestHistoryFromRecentContacts not loaded yet. Handlers might be missing.");
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

function handleGroupMessage(pubkey, maxjson) {
    MDS.log("📨 [GROUP-MSG] Processing...");

    // Migration: Ensure propagated column exists
    var migrationSql = "ALTER TABLE GROUP_MESSAGES ADD COLUMN propagated INT DEFAULT 0";
    MDS.sql(migrationSql, function (migRes) {
        var encoded = (maxjson.message || "").replace(/'/g, "''");
        var messageTimestamp = maxjson.timestamp || Date.now();
        var originalSender = maxjson.senderPublickey || pubkey;

        // Check for duplicates
        var checkSql = "SELECT id, propagated FROM GROUP_MESSAGES WHERE group_id='" + maxjson.groupId + "' AND sender_publickey='" + originalSender + "' AND date=" + messageTimestamp;

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
                    + "('" + maxjson.groupId + "','" + originalSender + "','" + maxjson.senderUsername + "','" + (maxjson.type || "text") + "','" + encoded + "','" + (maxjson.filedata || "") + "'," + messageTimestamp + ", 0, 1)";

                MDS.sql(groupMsgSql, function (res) {
                    if (res.status) {
                        MDS.log("✅ [DB] Group message saved (propagated=1).");
                    } else {
                        MDS.log("❌ [DB] Failed to save group message: " + res.error);
                        if (res.error && res.error.indexOf('propagated') !== -1) {
                            var retrySql = "INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read) VALUES "
                                + "('" + maxjson.groupId + "','" + originalSender + "','" + maxjson.senderUsername + "','" + (maxjson.type || "text") + "','" + encoded + "','" + (maxjson.filedata || "") + "'," + messageTimestamp + ", 0)";
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

    var membersSql = "SELECT * FROM GROUP_MEMBERS WHERE group_id='" + maxjson.groupId + "'";
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

    var createGroupSql = "INSERT INTO GROUPS (group_id, name, creator_publickey, created_date, description) VALUES "
        + "('" + maxjson.groupId + "','" + (maxjson.groupName || '').replace(/'/g, "''") + "','" + pubkey + "'," + maxjson.timestamp + ",'" + (maxjson.description || "").replace(/'/g, "''") + "')";

    MDS.sql(createGroupSql, function (res) {
        MDS.log("✅ [GROUP-MGMT] Group created/exists");

        if (maxjson.members) {
            var addMember = function (idx) {
                if (idx >= maxjson.members.length) return;
                var m = maxjson.members[idx];
                var role = (m.publickey === pubkey) ? 'creator' : 'member';

                var addMemberSql = "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES "
                    + "('" + maxjson.groupId + "','" + m.publickey + "','" + (m.username || 'Unknown').replace(/'/g, "''") + "'," + maxjson.timestamp + ",'" + role + "')";

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

    if (maxjson.messageType === "group_member_added") {
        var addMemberSql = "INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role) VALUES "
            + "('" + maxjson.groupId + "','" + maxjson.memberPublickey + "','" + (maxjson.memberUsername || 'Unknown').replace(/'/g, "''") + "'," + maxjson.timestamp + ",'member')";
        MDS.sql(addMemberSql);
    } else {
        var removeMemberSql = "DELETE FROM GROUP_MEMBERS WHERE group_id='" + maxjson.groupId + "' AND publickey='" + maxjson.memberPublickey + "'";
        MDS.sql(removeMemberSql);
    }
}

/**
 * MetaChain Service Worker - Chat Message Handler
 * Handles chat messages, read receipts, pings, pongs
 */

function handleChatMessage(pubkey, maxjson) {
    MDS.log("💬 [CHAT-DEBUG] RAW INCOMING from " + pubkey + ": " + JSON.stringify(maxjson));
    MDS.log("💬 [CHAT] From: " + pubkey + " - " + (maxjson.message || "").substring(0, 30));

    var now = Date.now();
    var safePubkey = escapeSql(pubkey);
    var safeUsername = escapeSql(maxjson.username || "Unknown");
    var safeMessage = escapeSql(maxjson.message || "");
    var safeFiledata = escapeSql(maxjson.filedata || "");
    var msgType = maxjson.type || "text";
    var amount = maxjson.amount || 0;
    var senderSeq = maxjson.seq ? parseInt(maxjson.seq) : 0; // SEQUENCE TRACKING

    // 1. CHECK IF BLOCKED
    var checkBlockSql = "SELECT blocked FROM CHAT_STATUS WHERE publickey='" + safePubkey + "'";
    MDS.sql(checkBlockSql, function (blockRes) {
        var isBlocked = false;
        if (blockRes.status && blockRes.rows && blockRes.rows.length > 0) {
            var val = blockRes.rows[0].BLOCKED;
            isBlocked = val === true || val === 'TRUE' || val === 'true' || val === 1;
        }

        if (isBlocked) {
            MDS.log("🚫 [CHAT] Message BLOCKED from: " + safeUsername + " (" + safePubkey + ")");
            return; // Abort insertion
        } else {
            MDS.log("✅ [CHAT-DEBUG] Block check passed for " + safeUsername);
        }

        // GAP DETECTION LOGIC
        // Only run if we have a valid sequence number > 1 (1 is start)
        if (senderSeq > 1) {
            // Check the last sequence number we have from this sender
            var seqSql = "SELECT MAX(sender_seq) as last_seq FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "'";
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
                    MDS.log("⚠️ [GAP-DETECT] Sequence gap detected from " + safeUsername + " (Seq: " + senderSeq + ", Last: " + lastSeq + ", Missing: " + gapSize + ")");

                    // Trigger sync - use existing solo comms or direct function call if available
                    if (typeof requestChatHistory === 'function') {
                        MDS.log("🔄 [GAP-FILL] Triggering sync to fill gap...");
                        requestChatHistory(pubkey);
                    }
                }
            });
        }

        // 2. Insert message to DB if not blocked
        var txpowid = maxjson.txpowid ? escapeSql(maxjson.txpowid) : null;
        var initialState = txpowid ? 'sent' : 'received'; // 'sent' triggers blink on receiver side if txpowid exists
        var txpowidVal = txpowid ? "'" + txpowid + "'" : "NULL";
        var originalTimestamp = maxjson.timestamp ? maxjson.timestamp : 0;
        var customid = maxjson.customid ? escapeSql(maxjson.customid) : "0x00"; // PERSIST CUSTOM ID

        // CRITICAL FIX: Only store if we don't already have it 
        // We check BOTH txpowid (if available) AND time window simultaneously to ensure we catch duplicates
        // even if one identifier is missing or slightly different.
        var checkDup = "SELECT COUNT(*) as count FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "'";
        var conditions = [];

        // 1. Check by TxPoWID (Strongest check)
        if (txpowid) {
            conditions.push("txpowid='" + txpowid + "'");
        }

        // 2. Check by Time Window & Content (Fuzzy check for 60s window)
        // Checks against both original_timestamp (sender time) and date (local time)
        var minTime = originalTimestamp - 60000;
        var maxTime = originalTimestamp + 60000;
        var timeCondition = "message='" + safeMessage + "' AND (" +
            "(original_timestamp >= " + minTime + " AND original_timestamp <= " + maxTime + ") OR " +
            "(date >= " + minTime + " AND date <= " + maxTime + "))";
        conditions.push("(" + timeCondition + ")");

        // Combine with OR
        if (conditions.length > 0) {
            checkDup += " AND (" + conditions.join(" OR ") + ")";
        }

        MDS.log("🔍 [DEDUP-LIVE] Checking for duplicates with SQL: " + checkDup);

        MDS.sql(checkDup, function (dupRes) {
            if (dupRes.status && dupRes.rows && dupRes.rows[0].COUNT > 0) {
                MDS.log("♻️ [CHAT] Ignoring duplicate message from " + safeUsername + " (already exists in DB)");

                // CRITICAL FIX: Even if duplicate, UPDATE sender_seq if it's currently 0 or NULL
                // This fixes ordering if the message was first added via history sync (which might have lacked seq)
                if (maxjson.seq && maxjson.seq > 0) {
                    var updateSeqSql = "UPDATE CHAT_MESSAGES SET sender_seq=" + maxjson.seq +
                        " WHERE publickey='" + safePubkey + "' AND (" + conditions.join(" OR ") + ")" +
                        " AND (sender_seq IS NULL OR sender_seq = 0)";
                    MDS.sql(updateSeqSql, function (res) {
                        if (res.status && res.rowsAffected > 0) {
                            MDS.log("🔄 [CHAT] Updated sequence for duplicate message to: " + maxjson.seq);
                        }
                    });
                }
                return;
            } else {
                MDS.log("✨ [CHAT-DEBUG] No duplicate found. Proceeding to INSERT...");
            }

            var insertSql = "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, sender_seq, customid) "
                + "VALUES ('', '" + safePubkey + "', '" + safeUsername + "', '" + msgType + "', '" + safeMessage + "', '" + safeFiledata + "', '" + initialState + "', " + amount + ", " + (originalTimestamp || now) + ", " + txpowidVal + ", " + originalTimestamp + ", " + senderSeq + ", '" + customid + "')";

            MDS.sql(insertSql, function (res) {
                if (res.status) {
                    MDS.log("✅ [CHAT] Message saved from " + safeUsername);

                    // FIX: Auto-discover user on message receipt to fix "Unknown" in chat list
                    if (safeUsername && safeUsername !== "Unknown" && safeUsername !== "System") {
                        var safeAvatar = escapeSql(maxjson.avatar || "");
                        var safeAddress = escapeSql(maxjson.from_address || "");

                        var upsertPeer = "MERGE INTO DISCOVERED_PEERS (publickey, alias, avatar, address, last_seen, source, allow_non_contact_chats) KEY(publickey) " +
                            "VALUES ('" + safePubkey + "', '" + safeUsername + "', '" + safeAvatar + "', '" + safeAddress + "', " + now + ", 'MSG', 1)";
                        MDS.sql(upsertPeer, function (pRes) {
                            MDS.log("👤 [CHAT] Auto-discovered peer: " + safeUsername);
                        });
                    }

                    // 3. SEND DELIVERY RECEIPT (New Logic)
                    sendDeliveryReceipt(pubkey);

                } else {
                    MDS.log("❌ [CHAT] Save failed: " + res.error);
                }
            });
        });
    });
}

// Helper to send delivery receipt from Service Worker
function sendDeliveryReceipt(toPublicKey) {
    // Prevent sending receipts to self or system
    if (toPublicKey === 'Me' || toPublicKey === 'System') return;

    var payload = {
        message: "",
        type: "delivery_receipt",
        username: "Me",
        filedata: ""
    };

    var jsonStr = JSON.stringify(payload);
    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    // We reuse the smart sending logic from handlePing or simple send
    // Simple send is enough for receipt, or we can look up address if needed commonly
    // For now, let's use the simplest robust method: send to publickey

    // NOTE: If we want to support Mx addresses for non-contacts, we'd query DB
    // But for simplicity in this handler, we trust the publickey source

    var sendCmd = "maxima action:send publickey:" + toPublicKey + " application:metachain data:" + hexData + " poll:false";
    MDS.cmd(sendCmd, function (res) {
        if (res.status) MDS.log("✅ [DELIVERY] Sent receipt to " + toPublicKey.substring(0, 10));
    });
}

function handleReadReceipt(pubkey) {
    MDS.log("📖 [READ-RECEIPT] Received from " + pubkey);
    // Update 'sent' OR 'delivered' messages to 'read'. 
    // Exclude 'pending' (not sent yet), 'failed' AND 'confirmed' (final state for transactions).
    // CRITICAL FIX: Do not overwrite 'confirmed' state with 'read'.
    // CRITICAL FIX 2: Only update TEXT messages. Token/Charm transactions should NOT go to 'read' state.
    var sql = "UPDATE CHAT_MESSAGES SET state='read' WHERE publickey='" + pubkey + "' AND username='Me' AND type='text' AND state!='pending' AND state!='failed' AND state!='read' AND state!='confirmed'";
    MDS.sql(sql);
}

function handleDeliveryReceipt(pubkey) {
    MDS.log("📬 [DELIVERY-RECEIPT] Received from " + pubkey);
    // Update 'sent' messages to 'delivered'. 
    // Do NOT overwrite 'read' status (as read > delivered).
    var sql = "UPDATE CHAT_MESSAGES SET state='delivered' WHERE publickey='" + pubkey + "' AND username='Me' AND state='sent'";
    MDS.sql(sql);
}

function handlePing(pubkey) {
    MDS.log("📡 [PING] Received from " + pubkey);

    var payload = {
        message: "",
        type: "pong",
        username: "Me",
        filedata: ""
    };

    var jsonStr = JSON.stringify(payload);
    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    // Smart Address Resolution for Non-Contacts
    if (pubkey.startsWith('0x')) {
        var safeKey = pubkey.replace(/'/g, "''");
        var peerSql = "SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='" + safeKey + "' AND ADDRESS IS NOT NULL LIMIT 1";

        MDS.sql(peerSql, function (peerRes) {
            var sendCmd;
            if (peerRes && peerRes.status && peerRes.count > 0) {
                var rawMx = peerRes.rows[0].ADDRESS;
                // Remove all whitespace and invalid characters
                var mxAddress = rawMx ? rawMx.replace(/\s+/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "").trim() : null;

                if (mxAddress && (mxAddress.startsWith('Mx') || mxAddress.startsWith('MX'))) {
                    sendCmd = 'maxima action:send to:' + mxAddress + ' application:metachain data:' + hexData + ' poll:false';
                } else {
                    sendCmd = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false";
                }
            } else {
                sendCmd = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false";
            }

            MDS.cmd(sendCmd, function () {
                MDS.log("✅ [PONG] Sent to " + pubkey.substring(0, 15) + "...");
            });
        });
    } else {
        var sendCmd;
        if (pubkey.startsWith('Mx') || pubkey.startsWith('MX')) {
            sendCmd = 'maxima action:send to:' + pubkey.trim() + ' application:metachain data:' + hexData + ' poll:false';
        } else {
            sendCmd = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + " poll:false";
        }
        MDS.cmd(sendCmd, function () {
            MDS.log("✅ [PONG] Sent to " + pubkey.substring(0, 15) + "...");
        });
    }
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
            since = Date.now() - (7 * 24 * 60 * 60 * 1000);
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

        var sql = "SELECT * FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "' " +
            "AND (type='text' OR type='token' OR type='charm') " +
            "AND date > " + since + " " +
            "ORDER BY date ASC LIMIT 100"; // Lower limit to 100 to ensure payload is manageable

        MDS.sql(sql, function (res) {
            if (res.status && res.rows) {
                MDS.log("🔄 [HISTORY-REQ] Found " + res.count + " messages for " + pubkey.substring(0, 10));

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
                        sender_seq: row.SENDER_SEQ // Include sequence for ordering
                    };
                });

                // Send response back even if empty, so client knows sync happened
                sendChatHistoryResponse(pubkey, messages);
            } else {
                MDS.log("🔄 [HISTORY-REQ] No messages found (SQL success but no rows?)");
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
        timestamp: Date.now()
    };

    var jsonStr = JSON.stringify(payload);
    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    // Log the size
    MDS.log("🔄 [HISTORY-RESP] Sending response size: " + hexData.length + " chars to " + toPubkey.substring(0, 10));

    // Smart Address Resolution with Fallback
    resolveAndSend(toPubkey, hexData, "HISTORY-RESP", true);
}

function handleChatHistoryResponse(pubkey, maxjson) {
    var messages = maxjson.messages;
    if (!messages || messages.length === 0) {
        MDS.log("🔄 [HISTORY-RESP] Received empty history from " + pubkey);
        return;
    }

    MDS.log("🔄 [HISTORY-RESP] Processing " + messages.length + " messages from " + pubkey);
    var safePubkey = escapeSql(pubkey);
    processHistoryMessage(safePubkey, messages, 0);
}

function processHistoryMessage(safePubkey, messages, index) {
    if (index >= messages.length) {
        MDS.log("✅ [HISTORY-RESP] Completed processing batch");
        // Notify frontend to reload chat list
        // MDS.comms.solo sends a message to the frontend
        MDS.comms.solo("CHAT_LIST_UPDATE", function () {
            MDS.log("📤 [HISTORY-SYNC] Notification sent to frontend");
        });
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

    if (msg.username === 'Me') {
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
            MDS.sql("SELECT alias FROM DISCOVERED_PEERS WHERE publickey='" + safePubkey + "'", function (res) {
                var resolvedName = "Contact";
                if (res.status && res.rows && res.rows.length > 0) {
                    resolvedName = escapeSql(res.rows[0].ALIAS || res.rows[0].alias || "Contact");
                }

                var insertSql = "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, customid, sender_seq) "
                    + "VALUES ('', '" + safePubkey + "', '" + resolvedName + "', '" + type + "', '" + content + "', '" + safeFiledata + "', '" + state + "', " + amount + ", " + timestamp + ", " + txpowidVal + ", " + timestamp + ", '" + safeCustomId + "', " + senderSeq + ")";

                MDS.sql(insertSql, function (insRes) {
                    if (insRes.status) {
                        MDS.log("✅ [HISTORY-SYNC] Recovered message from " + resolvedName + ": " + (content.substring(0, 20)));
                    } else {
                        // Fallback log if insert fails
                        MDS.log("❌ [HISTORY-SYNC] Insert failed: " + insRes.error);
                    }
                    processHistoryMessage(safePubkey, messages, index + 1);
                });
            });
            return; // EXIT here, async SQL handles the recursion
        }

        var insertSql = "INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, txpowid, original_timestamp, customid, sender_seq) "
            + "VALUES ('', '" + safePubkey + "', '" + finalUsername + "', '" + type + "', '" + content + "', '" + safeFiledata + "', '" + state + "', " + amount + ", " + timestamp + ", " + txpowidVal + ", " + timestamp + ", '" + safeCustomId + "', " + senderSeq + ")";

        MDS.sql(insertSql, function (insRes) {
            if (insRes.status) {
                MDS.log("✅ [HISTORY-SYNC] Recovered message: " + (content.substring(0, 20)));
            }
            processHistoryMessage(safePubkey, messages, index + 1);
        });
    };

    var tryUpdate = function (existingId) {
        if (!msg.txpowid) {
            processHistoryMessage(safePubkey, messages, index + 1);
            return;
        }

        var newState = msg.state || "read";
        var safeTxPow = escapeSql(msg.txpowid);
        var updateSql = "UPDATE CHAT_MESSAGES SET txpowid='" + safeTxPow + "', state='" + newState + "' WHERE id=" + existingId;

        MDS.sql(updateSql, function (updRes) {
            MDS.log("♻️ [HISTORY-SYNC] Updated existing message ID " + existingId + " with txpowid/state");
            processHistoryMessage(safePubkey, messages, index + 1);
        });
    };

    // 0. Primary Check: By CustomID (UUID)
    if (msg.customid && msg.customid !== '0x00') {
        var safeCustomId = escapeSql(msg.customid);
        var customCheck = "SELECT * FROM CHAT_MESSAGES WHERE customid='" + safeCustomId + "'";
        MDS.sql(customCheck, function (res) {
            if (res.status && res.rows && res.rows.length > 0) {
                // Found by UUID!
                if (msg.txpowid) {
                    tryUpdate(res.rows[0].ID);
                } else {
                    processHistoryMessage(safePubkey, messages, index + 1);
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
            var txCheckSql = "SELECT * FROM CHAT_MESSAGES WHERE txpowid='" + safeTxPow + "'";

            MDS.sql(txCheckSql, function (res) {
                if (res.status && res.rows && res.rows.length > 0) {
                    // Exact match found by ID - skip
                    processHistoryMessage(safePubkey, messages, index + 1);
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
            checkSql = "SELECT * FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "' AND username!='Me' " +
                "AND (original_timestamp BETWEEN " + minTime + " AND " + maxTime + " OR date BETWEEN " + minTime + " AND " + maxTime + ") " +
                "AND message='" + content + "'";
        } else {
            checkSql = "SELECT * FROM CHAT_MESSAGES WHERE publickey='" + safePubkey + "' AND username='Me' " +
                "AND (original_timestamp BETWEEN " + minTime + " AND " + maxTime + " OR date BETWEEN " + minTime + " AND " + maxTime + ") " +
                "AND message='" + content + "'";
        }

        MDS.sql(checkSql, function (res) {
            if (res.status && res.rows && res.rows.length > 0) {
                // Found by content! Update it if we have a txpowid to attach
                if (msg.txpowid) {
                    tryUpdate(res.rows[0].ID);
                } else {
                    processHistoryMessage(safePubkey, messages, index + 1);
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

    var sql = "SELECT publickey, address FROM DISCOVERED_PEERS WHERE source != 'SELF' ORDER BY last_seen DESC LIMIT 20";

    MDS.sql(sql, function (res) {
        MDS.log("🔍 [HISTORY-SYNC-DEBUG] SQL result status: " + res.status);
        if (res.status && res.rows) {
            MDS.log("🔄 [HISTORY-SYNC] Found " + res.rows.length + " contacts in DISCOVERED_PEERS");
            if (res.rows.length === 0) {
                MDS.log("⚠️ [HISTORY-SYNC] No contacts found to sync with");
                return;
            }
            MDS.log("🔄 [HISTORY-SYNC] Syncing with " + res.rows.length + " recent contacts");
            res.rows.forEach(function (row) {
                MDS.log("🔄 [HISTORY-SYNC] Requesting history from: " + row.PUBLICKEY.substring(0, 20) + "...");
                // Pass both publickey and address to increase success rate
                requestChatHistory(row.PUBLICKEY, row.ADDRESS);
            });
        } else {
            MDS.log("❌ [HISTORY-SYNC] SQL query failed: " + (res.error || "Unknown error"));
        }
    });
}

function requestChatHistory(toPublicKey, toAddress) {
    var payload = {
        message: "",
        type: "chat_history_request",
        username: "Me",
        filedata: "",
        timestamp: Date.now() - (7 * 24 * 60 * 60 * 1000)
    };

    var jsonStr = JSON.stringify(payload);
    var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    // Use specific address if known, otherwise fall back to resolution logic
    if (toAddress && (toAddress.startsWith('Mx') || toAddress.startsWith('MX'))) {
        // Use new robust cleaner
        var cleanAddress = cleanMaximaAddress(toAddress);

        // EXTRA DEBUG: Log address transformation
        MDS.log("🔍 [ADDR-DEBUG] Raw: '" + toAddress + "' -> Clean: '" + cleanAddress + "'");

        var sendCmd = 'maxima action:send to:' + cleanAddress + ' application:metachain data:' + hexData + ' poll:false';

        // DEBUG: Print EXACT command to see what Minima receives
        MDS.log("🔍 [CMD-DEBUG-V3] " + sendCmd);

        MDS.cmd(sendCmd, function (res) {
            if (!res.status) {
                MDS.log("⚠️ [HISTORY-SYNC] Failed to ask via address " + cleanAddress.substring(0, 10) + " Err: " + res.error);
            }
        });
    } else {
        // Fallback to resolving via DB or publickey
        resolveAndSend(toPublicKey, hexData, "HISTORY-SYNC", false);
    }
}

// Helper to clean Maxima Address specifically for the port issue
function cleanMaximaAddress(addr) {
    if (!addr) return "";

    // 1. Basic trim
    var s = String(addr).trim();

    // 2. CRITICAL: Remove ALL whitespace characters first (spaces, tabs, newlines, etc.)
    // This prevents Java NumberFormatException when parsing port numbers
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

        // Log deep debug if it looked suspicious
        if (cleanBase !== base || cleanPort !== port) {
            MDS.log("🔍 [ADDR-FIX-V3] Cleaned: '" + addr + "' -> '" + cleanBase + ":" + cleanPort + "'");
        }

        if (cleanBase && cleanPort) {
            return cleanBase + ":" + cleanPort;
        }
    }

    // Fallback: Just remove all whitespace and invalid chars
    return s.replace(/\s/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "");
}

// Helper for Robust Sending (Resolves Address)
function resolveAndSend(pubkey, hexData, logTag, usePoll) {
    var pollStr = usePoll ? " poll:true" : " poll:false";

    // Clean key
    var safeKey = pubkey.replace(/'/g, "''");

    var peerSql = "SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='" + safeKey + "' AND ADDRESS IS NOT NULL LIMIT 1";

    MDS.sql(peerSql, function (peerRes) {
        var sendCmd;
        if (peerRes && peerRes.status && peerRes.count > 0) {
            var rawMx = peerRes.rows[0].ADDRESS;
            // Use new robust cleaner
            var mxAddress = rawMx ? cleanMaximaAddress(rawMx) : null;

            if (mxAddress && (mxAddress.startsWith('Mx') || mxAddress.startsWith('MX'))) {
                sendCmd = 'maxima action:send to:' + mxAddress + ' application:metachain data:' + hexData + pollStr;
                MDS.log("🔍 [CMD-DEBUG-RES] " + sendCmd);
            } else {
                sendCmd = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + pollStr;
                MDS.log("🔍 [CMD-DEBUG-RES] " + sendCmd); // Log for publickey fallback as well
            }
        } else {
            sendCmd = "maxima action:send publickey:" + pubkey + " application:metachain data:" + hexData + pollStr;
            MDS.log("🔍 [CMD-DEBUG-RES] " + sendCmd); // Log for no peer address found
        }

        MDS.cmd(sendCmd, function (res) {
            if (res.status) {
                MDS.log("✅ [" + logTag + "] Sent to " + pubkey.substring(0, 10));
            } else {
                MDS.log("⚠️ [" + logTag + "] Failed send: " + res.error);
            }
        });
    });
}

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

    var sql = "SELECT next_seq FROM MESSAGE_COUNTERS WHERE publickey='" + escapeSql(fromKey) + "'";
    MDS.sql(sql, function (res) {
        var myNextSeq = (res.rows && res.rows.length > 0) ? res.rows[0].NEXT_SEQ : 1;
        var myLastSentSeq = myNextSeq - 1;

        MDS.log("🔄 [SMART-SYNC] Check from " + fromKey.substring(0, 10) + ". Their last: " + peerLastSeq + ", My last sent: " + myLastSentSeq);

        if (myLastSentSeq > peerLastSeq) {
            var missingCount = myLastSentSeq - peerLastSeq;
            MDS.log("⚠️ [SMART-SYNC] Peer is missing " + missingCount + " messages.");

            // Optimization: Get preview of the very last message to show in their UI
            // We find the message with highest ID sent to them? 
            // We don't strictly index our sent 'seq' in CHAT_MESSAGES yet (we just send it).
            // We might need to query by date DESC.
            var previewSql = "SELECT message, date, type FROM CHAT_MESSAGES WHERE publickey='" + escapeSql(fromKey) + "' AND state IN ('sent','delivered','read') ORDER BY date DESC LIMIT 1";

            MDS.sql(previewSql, function (pRes) {
                var lastMsg = (pRes.rows && pRes.rows.length > 0) ? pRes.rows[0] : null;

                var reportPayload = {
                    type: "sync_status_report",
                    missing_count: missingCount,
                    my_highest_seq: myLastSentSeq,
                    last_message_preview: lastMsg ? {
                        text: (lastMsg.TYPE === 'text') ? lastMsg.MESSAGE : ("[" + lastMsg.TYPE + "]"),
                        timestamp: lastMsg.DATE
                    } : null
                };

                // Send report back via Maxima
                MDS.cmd("maxima action:send publickey:" + fromKey + " application:metachain data:" + JSON.stringify(reportPayload) + " poll:false", function (sendRes) {
                    if (sendRes.status) MDS.log("✅ [SMART-SYNC] Sent status report to " + fromKey.substring(0, 10));
                });
            });

        } else {
            MDS.log("✅ [SMART-SYNC] Peer is up to date.");
        }
    });
}


/**
 * Handle incoming sync status report (PHASE 1 Response)
 * Peer says: "You are missing X messages. Last one was 'Hello'"
 * We action: Update UI to show "Unread/Syncing" state? or Trigger fetch?
 * For Phase 1: Just Log and maybe emit event for UI.
 * For Phase 2: This will auto-trigger 'sync_data_request'
 */
function handleSyncStatusReport(msg, fromKey) {
    MDS.log("📊 [SMART-SYNC] Report from " + fromKey.substring(0, 10) + ": Missing " + msg.missing_count + " messages.");

    // Store this 'gap' state potentially?
    // For now, let's trigger the 'gap detected' flow we already have?
    // OR just emit an event so the frontend knows.

    // If we are missing messages, we should probably just ask for them immediately if it's a small number?
    // User plan says: "Phase 1: Chat List updates... without downloading".
    // So we just need to notify the Frontend.

    // We can use 'peer_updated' or a new 'sync_state_update' event.
    // Let's send a specific event the Frontend can listen to relative to this peer.
    // Actually, we can reuse 'chat_history_response' type logic to just push a "meta" message? 
    // No, cleaner to keep it separate.

    // We will just log it for now as per Phase 1 reqs (UI implementation is next).
    // BUT, let's be proactive: If the gap is small (< 50), auto-fetch immediately?
    // The user said "Global Sync Check... Chat List updates... without downloading".
    // So we strictly wait for Phase 2 (Lazy Sync) to fetch.

    // We send this to frontend via NEWBLOCK or just rely on 'notifyNewMessage' in MinimaService which listens to Maxima?
    // 'minima.service.ts' processes all incoming Maxima messages.
    // So if we just let this message pass through to 'minima.service.ts', it will be dispatched to UI.
    // PERFECT. We don't need to do anything here if 'minima.service.ts' handles generic types.
    // Checking 'minima.service.ts'... it filters specific types. 
    // We need to add 'sync_status_report' to 'minima.service.ts'.
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
    if (maxjson.from_address) {
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

function handleBeacon(beacon, source) {
    try {
        // Validation logging
        if (!beacon.pubkey || !beacon.address || !beacon.alias) {
            MDS.log("⚠️ [BEACON-REJECT] Missing required fields from " + source +
                " - pubkey:" + !!beacon.pubkey + " address:" + !!beacon.address + " alias:" + !!beacon.alias);
            return;
        }

        // Debounce (except for important sources)
        var isImportant = (source === 'GOSSIP' || source === 'BOOTSTRAP');
        if (!isImportant && BEACON_CACHE[beacon.pubkey] && (Date.now() - BEACON_CACHE[beacon.pubkey] < 10000)) {
            MDS.log("⏭️ [BEACON-DEBOUNCE] Skipping " + beacon.alias + " from " + source + " (recently processed)");
            return;
        }

        // Check if this is our own beacon
        if (MY_MAXIMA_PK && beacon.pubkey === MY_MAXIMA_PK) {
            MDS.log("⏭️ [BEACON-SELF] Ignoring own beacon from " + source);
            return;
        }

        BEACON_CACHE[beacon.pubkey] = Date.now();

        var now = Date.now();
        var escapedAlias = escapeSql(beacon.alias);
        var bioValue = beacon.bio || "";
        // Clean address to prevent NumberFormatException (remove extra spaces)
        var cleanAddress = (beacon.address || "").trim().replace(/\s+/g, " ").replace(/\s*:\s*/g, ":");

        var allowNonContactChats = (beacon.allowNonContactChats !== undefined && beacon.allowNonContactChats !== null)
            ? (beacon.allowNonContactChats ? 1 : 0)
            : 1;

        MDS.log("📡 [BEACON] " + beacon.alias + " from " + source);

        // Save beacon - handle bio caching
        if (bioValue) {
            saveBeaconWithBio(beacon, source, escapedAlias, bioValue, cleanAddress, allowNonContactChats, now);
        } else {
            // Check DB for cached bio
            MDS.sql("SELECT bio FROM DISCOVERED_PEERS WHERE publickey='" + beacon.pubkey + "'", function (checkRes) {
                var bioToSave = "";
                if (checkRes.status && checkRes.rows && checkRes.rows.length > 0 && checkRes.rows[0].BIO) {
                    bioToSave = checkRes.rows[0].BIO;
                }
                saveBeaconWithBio(beacon, source, escapedAlias, bioToSave, cleanAddress, allowNonContactChats, now);
            });
        }
    } catch (e) {
        MDS.log("❌ [BEACON] Handler error: " + e.message);
    }
}

function saveBeaconWithBio(beacon, source, escapedAlias, bio, cleanAddress, allowNonContactChats, now) {
    var escapedBio = escapeSql(bio);
    var extraData = escapeSql(JSON.stringify(beacon));

    var discoverySql = "MERGE INTO DISCOVERED_PEERS (publickey, alias, bio, address, last_seen, source, allow_non_contact_chats, extra_data) "
        + "KEY (publickey) "
        + "VALUES ('" + beacon.pubkey + "', '" + escapedAlias + "', '" + escapedBio + "', '"
        + cleanAddress + "', " + now + ", '" + source + "', " + allowNonContactChats + ", '" + extraData + "')";

    MDS.sql(discoverySql, function (res) {
        if (res.status) {
            MDS.log("✅ [BEACON] Saved: " + beacon.alias);
            promoteToUserRegistry(beacon, now);

            // Reactive gossip
            if (source === 'P2P' || source === 'MAXIMA') {
                sendWelcomePackage(beacon.pubkey, beacon.alias);
                askPeers([beacon.pubkey]);
            }
        } else {
            MDS.log("❌ [BEACON] Save failed: " + JSON.stringify(res));
        }
    });
}

function promoteToUserRegistry(beacon, now) {
    var user_id = beacon.pubkey;
    var escapedAlias = escapeSql(beacon.alias);

    MDS.sql("SELECT * FROM METACHAIN_USERS WHERE user_id='" + user_id + "'", function (res) {
        if (res.status && res.rows && res.rows.length > 0) {
            // Update existing
            var updateSql = "UPDATE METACHAIN_USERS SET alias='" + escapedAlias + "', address='" + (beacon.address || "") + "', last_updated=" + now + " WHERE user_id='" + user_id + "'";
            MDS.sql(updateSql);
        } else {
            // Insert new
            var insertSql = "INSERT INTO METACHAIN_USERS (user_id, publickey, alias, address, first_seen, last_updated) "
                + "VALUES ('" + user_id + "', '" + beacon.pubkey + "', '" + escapedAlias + "', '" + (beacon.address || "") + "', " + now + ", " + now + ")";
            MDS.sql(insertSql);
        }
    });
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
        var myAvatar = maxInfo.response.icon ? decodeURIComponent(maxInfo.response.icon) : "";

        MDS.keypair.get("p2p_bio", function (bioRes) {
            var bio = (bioRes.status && bioRes.value) ? bioRes.value : "";

            // Get additional profile data
            MDS.keypair.get("profile_country", function (countryRes) {
                var country = (countryRes.status && countryRes.value) ? countryRes.value : "";

                MDS.keypair.get("profile_languages", function (langRes) {
                    var languages = (langRes.status && langRes.value) ? langRes.value : "";

                    MDS.keypair.get("profile_minima_address", function (addrRes) {
                        var minimaAddress = (addrRes.status && addrRes.value) ? addrRes.value : "";

                        // Get all profile data including avatar (like the working example)
                        MDS.sql("SELECT * FROM MY_PROFILE WHERE id=1", function (permRes) {
                            var allowNonContactChats = true;
                            var avatar = "";
                            var dbCountry = "";
                            var dbLanguages = [];

                            if (permRes.status && permRes.rows && permRes.rows.length > 0) {
                                var row = permRes.rows[0];
                                var val = row.ALLOW_NON_CONTACT_CHATS || row.allow_non_contact_chats;
                                allowNonContactChats = (val === 1 || val === true || val === 'true' || val === '1');
                                // Get avatar from DB (same as working example line 1714)
                                avatar = row.AVATAR || row.avatar || "";
                                // Get country from DB (with decoding like example line 1711)
                                dbCountry = decodeURIComponent(row.COUNTRY || row.country || "");
                                // Get languages from DB and parse as JSON array (like example line 1712-1713)
                                try {
                                    dbLanguages = JSON.parse(decodeURIComponent(row.LANGUAGES || row.languages || "[]"));
                                } catch (e) {
                                    dbLanguages = [];
                                }
                            }

                            // Use DB values as primary, keypair as fallback
                            var finalCountry = dbCountry || country;
                            var finalLanguages = dbLanguages.length > 0 ? dbLanguages : [];
                            // Try to parse keypair languages if DB is empty
                            if (finalLanguages.length === 0 && languages) {
                                try {
                                    finalLanguages = JSON.parse(languages);
                                } catch (e) {
                                    finalLanguages = [];
                                }
                            }

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
                                minimaaddress: minimaAddress,
                                // Use maxima icon as primary, MY_PROFILE as fallback
                                avatar: myAvatar || avatar,
                                timestamp: Date.now()
                            };

                            var jsonStr = JSON.stringify(beacon);
                            var hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

                            // P2P broadcast
                            MDS.cmd("message data:" + hexData, function (res) {
                                MDS.log("📡 [BG-BEACON] P2P broadcast sent");
                            });

                            // Save self to DB
                            handleBeacon(beacon, 'SELF');
                        });
                    });
                });
            });
        });
    });
}

function startCleanupTimer() {
    var now = Date.now();
    var TTL = 3600000; // 1 hour

    var cleanupSql = "DELETE FROM DISCOVERED_PEERS WHERE last_seen < " + (now - TTL) + " AND source != 'SELF'";
    MDS.sql(cleanupSql, function (res) {
        if (res.status && res.count > 0) {
            MDS.log("🧹 [CLEANUP] Removed " + res.count + " stale peers");
        }
    });
}

function createDiscoveredPeersTable() {
    MDS.log("💾 [DB] DISCOVERED_PEERS table check (already created in init).");
}

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
    var peerCount = (maxjson.peers ? maxjson.peers.length : 0);
    var senderAlias = pubkey ? pubkey.substring(0, 10) : "P2P-broadcast";

    MDS.log("📥 [GOSSIP] Received " + peerCount + " peers from " + senderAlias);

    if (maxjson.peers && Array.isArray(maxjson.peers)) {
        var processedCount = 0;
        var skippedCount = 0;

        for (var i = 0; i < maxjson.peers.length; i++) {
            var peer = maxjson.peers[i];

            // Debug each peer
            MDS.log("🔍 [GOSSIP-PEER] " + (i + 1) + "/" + peerCount + ": " +
                (peer.alias || "no-alias") + " (" +
                (peer.pubkey ? peer.pubkey.substring(0, 10) : "no-pubkey") + "...)");

            if (peer.pubkey && peer.address && peer.alias) {
                MDS.log("✅ [GOSSIP-PEER] Processing beacon for: " + peer.alias);
                handleBeacon(peer, 'GOSSIP');
                processedCount++;
            } else {
                MDS.log("⚠️ [GOSSIP-PEER] Skipping incomplete peer - pubkey:" +
                    !!peer.pubkey + " address:" + !!peer.address + " alias:" + !!peer.alias);
                skippedCount++;
            }
        }

        MDS.log("📊 [GOSSIP] Summary: " + processedCount + " processed, " + skippedCount + " skipped");
    } else {
        MDS.log("⚠️ [GOSSIP] No valid peers array in response");
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

            // Send via P2P broadcast instead of MAXIMA to avoid contact requirement
            MDS.cmd("message data:" + hexData, function (msgRes) {
                if (msgRes.status) {
                    MDS.log("✅ [GOSSIP] Welcome Package broadcast to network");
                } else {
                    MDS.log("⚠️ [GOSSIP] Failed to broadcast Welcome Package: " + (msgRes.error || "unknown error"));
                }
            });
        }
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
        MDS.log("🚀 [SW-VERSION-CHECK] Service Worker v2.7 DEBUG - " + new Date().toISOString());

        // IMMEDIATE INIT: Restore fast startup (like Reference Implementation)
        // Race conditions are now handled by the DB_READY flag in the NEWBLOCK loop.
        MDS.log("⏰ [SW] Starting Database Initialization...");
        initDatabase();
    }

    // Periodic tasks via NEWBLOCK
    else if (msg.event == "NEWBLOCK") {
        // 1. WAIT FOR DB TO BE READY (Async Init)
        // This prevents "Table Not Found" errors if Gossip runs before Init finishes.
        if (!DB_READY) {
            MDS.log("⏳ [SW] Database initializing... Skipping periodic tasks.");
            return;
        }

        // Run one-time startup cleanup if not done yet
        if (!INITIAL_CLEANUP_DONE) {
            INITIAL_CLEANUP_DONE = true;
            cleanupOrphanedChatMessages();
        }

        // Run coin discovery at block 5 (gives time for coins to sync)
        if (COIN_DISCOVERY_PENDING) {
            NEWBLOCK_COUNT++;
            if (NEWBLOCK_COUNT >= 5) {
                COIN_DISCOVERY_PENDING = false;
                MDS.log("📦 [COIN-DISCOVERY] Running at block " + NEWBLOCK_COUNT + "...");
                if (typeof discoverOfflineTokens === 'function') {
                    discoverOfflineTokens().then(function (count) {
                        if (count > 0) {
                            MDS.log("📦 [COIN-DISCOVERY] Recovered " + count + " offline token(s)");
                        }
                    }).catch(function (err) {
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
            checkPendingTransactions(); // Check for zombie transactions
            checkSentTransactions();    // Check for confirmations (sent -> confirmed)
        }
    }

    // Service commands from frontend
    else if (msg.event == "MDS_SERVICECMD") {
        if (msg.data && msg.data.service === "COINDISC") {
            MDS.log("📦 [SERVICE] Coin discovery requested from frontend");
            if (typeof discoverOfflineTokens === 'function') {
                discoverOfflineTokens().then(function (count) {
                    if (count > 0) {
                        MDS.log("📦 [SERVICE] Recovered " + count + " offline token(s)");
                    } else {
                        MDS.log("📦 [SERVICE] No new offline tokens found");
                    }
                }).catch(function (err) {
                    MDS.log("⚠️ [SERVICE] Coin discovery error: " + err);
                });
            }
        }
    }

    // MAXIMA messages
    else if (msg.event == "MAXIMA") {
        // Track connection state for reconnection detection
        var now = Date.now();
        var wasOffline = (now - LAST_MAXIMA_EVENT_TIME) > CONNECTION_TIMEOUT_MS;

        if (wasOffline && LAST_MAXIMA_EVENT_TIME > 0) {
            MDS.log("🔄 [RECONNECT] Node back online after offline period. Triggering history sync...");
            WAS_OFFLINE = true;

            // Notify frontend to retry queued messages immediately
            MDS.comms.solo(JSON.stringify({
                type: 'RECONNECTED',
                timestamp: now
            }));

            // Trigger history sync from recent contacts
            if (typeof requestHistoryFromRecentContacts === 'function') {
                requestHistoryFromRecentContacts();
            }
        }

        LAST_MAXIMA_EVENT_TIME = now;
        MDS.log("📨 [MAXIMA] Event received. App: " + msg.data.application);

        if (msg.data.application && (msg.data.application.toLowerCase() == "metachain" || msg.data.application.toLowerCase() == "metachain-group")) {
            var app = msg.data.application.toLowerCase();
            var pubkey = msg.data.from;
            var datastr = msg.data.data.substring(2);
            var jsonstr = hexToUtf8(datastr);

            try {
                var maxjson = JSON.parse(jsonstr);
                MDS.log("🔍 [MAXIMA-DEBUG-ALL] App: " + app + " Type: " + (maxjson.type || maxjson.messageType) + " From: " + pubkey.substring(0, 10));
                MDS.log("🔍 [MAXIMA] Type: " + (maxjson.type || maxjson.messageType));

                // ================== GROUP MESSAGES ==================
                if (app === "metachain-group" && (maxjson.messageType === "history_request" || maxjson.messageType === "history_response")) {
                    MDS.log("ℹ️ [GROUP-SYNC] Ignoring: " + maxjson.messageType);
                    return;
                }

                if ((app === "metachain-group" && maxjson.messageType === "group_message") || (maxjson.groupId && maxjson.messageType === "group_message")) {
                    handleGroupMessage(pubkey, maxjson);
                    return;
                }

                if (app === "metachain-group" && maxjson.messageType === "group_invite") {
                    handleGroupInvite(pubkey, maxjson);
                    return;
                }

                if (app === "metachain-group" && (maxjson.messageType === "group_member_added" || maxjson.messageType === "group_member_removed")) {
                    handleGroupMemberUpdate(pubkey, maxjson);
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
                    handleBeacon(maxjson, 'MAXIMA');
                    return;
                }

                // ================== GOSSIP ==================
                if (maxjson.type === "get_peers") {
                    MDS.log("📨 [MAXIMA-GOSSIP] get_peers request from " + pubkey.substring(0, 10));
                    handleGetPeers(pubkey, maxjson);
                    return;
                }

                if (maxjson.type === "peers_response") {
                    MDS.log("📨 [MAXIMA-GOSSIP] peers_response from " + pubkey.substring(0, 10));
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
                    handleSyncStatusCheck(pubkey, maxjson);
                    return;
                }

                if (maxjson.type === "sync_status_report") {
                    handleSyncStatusReport(pubkey, maxjson);
                    return;
                }

                // ================== CHAT MESSAGES (Default) ==================
                // FILTER: Only process actual chat message types
                var validChatTypes = ["text", "image", "video", "audio", "file", "charm", "token", "gif", "sticker", "voice"];
                if (validChatTypes.indexOf(maxjson.type) !== -1 && maxjson.message !== undefined) {
                    handleChatMessage(pubkey, maxjson);
                    return;
                }

                MDS.log("⚠️ [MAXIMA] Unhandled type: " + (maxjson.type || maxjson.messageType || "unknown"));

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
            if (logMsg.indexOf("[BEACON]") !== -1 ||
                logMsg.indexOf("[P2P]") !== -1 ||
                logMsg.indexOf("[SW]") !== -1 ||
                logMsg.indexOf("[MAXIMA]") !== -1 ||
                logMsg.indexOf("[GOSSIP]") !== -1 ||
                logMsg.indexOf("[DB]") !== -1) {
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
                    var jsonStr = hexToUtf8Simple(hexData);
                    jsonStr = jsonStr.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
                    var beacon = JSON.parse(jsonStr);

                    if (beacon.app === "metachain" && (beacon.type === "BEACON" || beacon.type === "register")) {
                        if (MY_MAXIMA_PK && beacon.pubkey === MY_MAXIMA_PK) {
                            return; // Ignore self
                        }
                        MDS.log("📡 [P2P] Beacon: " + beacon.alias);
                        handleBeacon(beacon, 'P2P');
                    } else if (beacon.app === "metachain" && beacon.type === "peers_response") {
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

