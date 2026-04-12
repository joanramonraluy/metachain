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

            if (!coinsRes.status) {
                MDS.log("⚠️ [COIN-DISCOVERY-DEBUG] Status false. Error: " + (coinsRes.error || "No error message"));
                MDS.log("⚠️ [COIN-DISCOVERY] Failed to get coins");
                resolveMain(0);
                return;
            }

            if (!coinsRes.response) {
                MDS.log("⚠️ [COIN-DISCOVERY] Failed to get coins - no response object");
                resolveMain(0);
                return;
            }

            // Coins are returned directly in response array, not response.coins
            if (!Array.isArray(coinsRes.response)) {
                MDS.log("⚠️ [COIN-DISCOVERY] Failed to get coins - response not an array");
                resolveMain(0);
                return;
            }

            var allCoins = coinsRes.response;

            // Filter coins with MetaChain state variables: state[1].data === '204'
            var stateCoins = allCoins.filter(function (coin) {
                return coin.storestate === true &&
                    coin.state &&
                    coin.state['0'] &&
                    coin.state['1'] && coin.state['1'].data === '204' &&
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
                        MDS.comms.solo("CHAT_LIST_UPDATE");
                    } else {
                        MDS.log("📦 [COIN-DISCOVERY] No new offline tokens to recover");
                    }
                    resolveMain(recoveredCount);
                    return;
                }

                var coin = stateCoins[currentIndex];
                // MetaChain state vars: state[0]=timestamp, state[1]='204', state[3]=senderPublicKey
                var timestamp = coin.state['0'].data;
                var senderKey = coin.state['3'] ? coin.state['3'].data : null;

                MDS.log("📦 [COIN-DISCOVERY] Processing coin ts=" + timestamp + " sender=" + (senderKey || "UNKNOWN").substring(0, 20) + "...");

                // Check if message already exists - use time window AND coinid/txpowid
                var minTime = parseInt(timestamp) - 60000;
                var maxTime = parseInt(timestamp) + 60000;
                var checkSql = "SELECT * FROM CHAT_MESSAGES WHERE type='token' AND (" +
                    "(date >= " + minTime + " AND date <= " + maxTime + ") OR " +
                    "(original_timestamp >= " + minTime + " AND original_timestamp <= " + maxTime + ")" +
                    ")";
                MDS.sql(checkSql, function (existing) {
                    if (existing.status && existing.rows && existing.rows.length > 0) {
                        MDS.log("♻️ [COIN-DISCOVERY] Skipping duplicate coin (already exists): " + coin.coinid);
                        // Message already exists, skip to next
                        currentIndex++;
                        processNextCoin();
                        return;
                    }

                    // Extract sender publickey from state[3]
                    var senderPubkey = (senderKey && senderKey.trim().length > 0) ? senderKey.trim() : 'UNKNOWN';
                    if (senderPubkey === 'UNKNOWN') {
                        MDS.log("❌ [COIN-DISCOVERY] No valid sender key found in state[3]!");
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

                    // Insert retroactive message — coin is already on-chain so state='confirmed'
                    var insertSql = "INSERT INTO CHAT_MESSAGES " +
                        "(publickey, username, message, type, date, state, amount, txpowid, roomname, filedata, customid, original_timestamp) " +
                        "VALUES (" +
                        "UPPER('" + senderPubkey + "'), " +
                        "'Unknown', " +
                        "'" + escapedPayload + "', " +
                        "'token', " +
                        parseInt(timestamp) + ", " +
                        "'confirmed', " +
                        parseFloat(amount) + ", " +
                        "'" + coin.coinid + "', " +
                        "'', " +
                        "'', " +
                        "'0x00', " +
                        parseInt(timestamp) +
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
