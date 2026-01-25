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
