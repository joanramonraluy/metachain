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
 * Verify an incoming token/charm transaction on the receiver's node.
 * Searches the blockchain for a txpow that has:
 *   state[0].data === messageTimestamp (stateId set by sender)
 *   state[1].data === '204'           (MetaChain magic)
 *
 * Fast path: if txpowid is provided, look it up directly, then verify state vars.
 * Slow path: scan recent txpows for this address and match timestamp + MetaChain marker.
 *
 * Note: state[3] (sender key) is NOT checked because key format mismatches between
 * the DB (UPPER-cased) and blockchain caused false negatives. Timestamp uniqueness
 * combined with MetaChain marker is sufficient.
 *
 * @param {number|string} messageTimestamp - The sender's stateId (original_timestamp in CHAT_MESSAGES)
 * @param {string} senderPublicKey - (unused, kept for signature compat)
 * @param {string|null} txpowid - Optional txpowid from Maxima payload (fast path)
 * @param {function} callback - callback(err, verified: boolean)
 */
function verifyIncomingTransaction(messageTimestamp, senderPublicKey, txpowid, callback) {
    var tsStr = String(messageTimestamp);

    // Helper: extract state var data by port number.
    // The txpow API returns state as an array of {port, type, data} objects;
    // array index may NOT equal port number (e.g. if ports are sparse).
    var getStateData = function(stateArr, port) {
        if (!stateArr) return '';
        // Try keyed access first (coin-style state object: state['0'])
        if (!Array.isArray(stateArr) && stateArr[String(port)]) {
            return String(stateArr[String(port)].data || '');
        }
        // Array of {port, data} objects (txpow-style)
        if (Array.isArray(stateArr)) {
            for (var j = 0; j < stateArr.length; j++) {
                if (stateArr[j] && (stateArr[j].port === port || stateArr[j].port === String(port))) {
                    return String(stateArr[j].data || '');
                }
            }
            // Fallback: direct index access (works when array is dense & ordered)
            if (stateArr[port] && stateArr[port].data !== undefined) {
                return String(stateArr[port].data || '');
            }
        }
        return '';
    };

    var matchesStateVars = function(tx) {
        var state = tx && tx.body && tx.body.txn && tx.body.txn.state;
        if (!state) return false;
        var stateId = getStateData(state, 0);
        var chainId = getStateData(state, 1);
        // Only require timestamp + MetaChain marker; sender key is optional extra check
        return chainId === '204' && stateId === tsStr;
    };

    var doScan = function() {
        MDS.cmd("getaddress", function(addrRes) {
            if (!addrRes.status || !addrRes.response) { callback(null, false); return; }
            var myAddr = addrRes.response.miniaddress;
            MDS.cmd("txpow address:" + myAddr + " max:50", function(txpowRes) {
                if (!txpowRes.status || !txpowRes.response) { callback(null, false); return; }
                var txpows = Array.isArray(txpowRes.response) ? txpowRes.response : [txpowRes.response];
                for (var i = 0; i < txpows.length; i++) {
                    if (matchesStateVars(txpows[i])) {
                        MDS.log("✅ [SW-TX-VERIFY] Incoming tx verified (scan): " + txpows[i].txpowid);
                        callback(null, true);
                        return;
                    }
                }
                MDS.log("⚠️ [SW-TX-VERIFY] Tx not found for ts=" + tsStr);
                callback(null, false);
            });
        });
    };

    if (txpowid && txpowid !== 'null' && !txpowid.startsWith('PENDING_')) {
        MDS.cmd("txpow txpowid:" + txpowid, function(res) {
            if (res.status && res.response && matchesStateVars(res.response)) {
                MDS.log("✅ [SW-TX-VERIFY] Incoming tx verified (txpowid): " + txpowid);
                callback(null, true);
            } else {
                // txpowid not found or state vars don't match — fall back to scan
                doScan();
            }
        });
    } else {
        doScan();
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
