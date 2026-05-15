/**
 * Transaction Handler
 * Manages pending transactions and confirmation checks in the background.
 */

// Check for zombie pending transactions (cancelled while DApp was closed)
// AND detect accepted transactions to send Maxima messages
function checkPendingTransactions() {
    if (SW_DEBUG) MDS.log("🔍 [SW-TX] Checking pending transactions...");

    // Get all local pending transactions
    MDS.sql("SELECT * FROM TRANSACTIONS WHERE status = 'pending'", function (res) {
        if (res.status && res.rows.length > 0) {
            var localPending = res.rows;
            if (SW_DEBUG) MDS.log("📋 [SW-TX] Found " + localPending.length + " pending transactions in DB");

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

                if (SW_DEBUG) MDS.log("🔍 [SW-TX] Checking zombie status for transaction: " + txUid);

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
            if (SW_DEBUG) MDS.log("✅ [SW-TX] No pending transactions in DB");
        }
    });
}

/**
 * Check for SENT transactions that need confirmation (3 blocks)
 * This was missing! Causing transactions to remain 'sent' forever.
 */
function checkSentTransactions() {
    if (SW_DEBUG) MDS.log("🔍 [SW-TX-CONFIRM] Checking SENT transactions...");

    MDS.sql("SELECT * FROM TRANSACTIONS WHERE status = 'sent'", function (res) {
        if (res.status && res.rows.length > 0) {
            var sentTxs = res.rows;
            if (SW_DEBUG) MDS.log("📋 [SW-TX-CONFIRM] Found " + sentTxs.length + " sent transactions waiting for confirmation");

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
 * Check incoming token/charm messages in 'received' state.
 * Uses coin-based 3-block confirmation: finds the coin via 'coins relevant:true'
 * (matching state[0]=timestamp, state[1]=204) and checks currentBlock - coin.created >= 3.
 *
 * Why coins instead of txpow address: Minima generates a fresh address per transaction,
 * so 'getaddress' returns the current default address which may differ from the address
 * the incoming coin was actually received at. 'coins relevant:true' finds all owned coins
 * regardless of which address they arrived at, and the coin.created field gives the
 * exact block it was mined in — no txpowid needed for the confirmation check.
 */
function checkIncomingTransactions() {
    if (SW_DEBUG) MDS.log("🔍 [SW-TX-INCOMING] Checking incoming unconfirmed token/charm messages...");

    MDS.sql("SELECT * FROM CHAT_MESSAGES WHERE state IN ('received','read') AND username!='Me' AND (type='token' OR type='charm')", function (res) {
        if (!res.status || res.rows.length === 0) {
            if (SW_DEBUG) MDS.log("✅ [SW-TX-INCOMING] No incoming unconfirmed token messages");
            return;
        }

        if (SW_DEBUG) MDS.log("📋 [SW-TX-INCOMING] Found " + res.rows.length + " incoming unconfirmed message(s)");

        // Get current block once for all messages
        MDS.cmd("status", function(statusRes) {
            if (!statusRes.status || !statusRes.response) {
                MDS.log("⚠️ [SW-TX-INCOMING] Could not get current block");
                return;
            }
            var currentBlock = parseInt(statusRes.response.chain && statusRes.response.chain.block);
            if (!currentBlock) return;

            // Get all owned coins — finds coins at any address on this node
            MDS.cmd("coins relevant:true", function(coinsRes) {
                var coins = (coinsRes.status && Array.isArray(coinsRes.response)) ? coinsRes.response : [];

                for (var i = 0; i < res.rows.length; i++) {
                    (function(msg) {
                        var msgId    = msg.ID || msg.id;
                        var searchTs = String(msg.ORIGINAL_TIMESTAMP || msg.DATE || msg.date || '');

                        // Find matching coin by timestamp + MetaChain marker
                        var matchedCoin = null;
                        for (var c = 0; c < coins.length; c++) {
                            var coin = coins[c];
                            if (coin.state &&
                                coin.state['1'] && String(coin.state['1'].data) === '204' &&
                                coin.state['0'] && String(coin.state['0'].data) === searchTs) {
                                matchedCoin = coin;
                                break;
                            }
                        }

                        if (!matchedCoin) {
                            MDS.log("⏳ [SW-TX-INCOMING] No coin found yet for msg " + msgId + " (ts=" + searchTs + ") — not mined yet.");
                            return;
                        }

                        var coinBlock = parseInt(matchedCoin.created);
                        var confirmations = currentBlock - coinBlock;
                        MDS.log("🔍 [SW-TX-INCOMING] Msg " + msgId + ": coin at block " + coinBlock + ", current " + currentBlock + ", confirmations=" + confirmations);

                        if (confirmations >= 3) {
                            MDS.log("✅ [SW-TX-INCOMING] 3-Block confirmed incoming msg " + msgId);
                            MDS.sql("UPDATE CHAT_MESSAGES SET state='confirmed' WHERE id=" + msgId, function(updateRes) {
                                if (updateRes.status) {
                                    MDS.comms.solo(JSON.stringify({
                                        type: "TOKEN_INCOMING_CONFIRMED",
                                        msgId: msgId
                                    }));
                                }
                            });
                        } else {
                            MDS.log("⏳ [SW-TX-INCOMING] Msg " + msgId + " only " + confirmations + "/3 confirmations.");
                        }
                    })(res.rows[i]);
                }
            });
        });
    });
}

/**
 * Promote unverified messages directly from a NEWCOIN event.
 * When a coin arrives with MetaChain state vars (state['1']='204'),
 * match its state['0'] (timestamp) against unverified messages' original_timestamp
 * and promote them to 'received' without needing a txpow scan.
 *
 * @param {object} coinData - The coin object from msg.data.coin (NEWCOIN event)
 */
function promoteUnverifiedByCoin(coinData) {
    if (!coinData || !coinData.state) return;

    // Check if this is a MetaChain coin: state['1'].data === '204'
    var s1 = coinData.state['1'];
    if (!s1 || String(s1.data) !== '204') return;

    var s0 = coinData.state['0'];
    if (!s0 || !s0.data) return;

    var coinTimestamp = String(s0.data);
    MDS.log("🪙 [NEWCOIN-PROMOTE] MetaChain coin detected, ts=" + coinTimestamp);

    // Look for unverified messages matching this timestamp
    MDS.sql(
        "SELECT * FROM CHAT_MESSAGES WHERE state='unverified' AND username!='Me' " +
        "AND (type='token' OR type='charm') " +
        "AND (original_timestamp=" + coinTimestamp + " OR date=" + coinTimestamp + ")",
        function(res) {
            if (!res.status || !res.rows || res.rows.length === 0) {
                MDS.log("🪙 [NEWCOIN-PROMOTE] No matching unverified messages for ts=" + coinTimestamp);
                return;
            }

            MDS.log("🪙 [NEWCOIN-PROMOTE] Found " + res.rows.length + " matching unverified message(s) — promoting to 'received'.");
            var promoted = 0;
            for (var i = 0; i < res.rows.length; i++) {
                (function(msg) {
                    var msgId = msg.ID || msg.id;
                    MDS.sql(
                        "UPDATE CHAT_MESSAGES SET state='received' WHERE id=" + msgId + " AND state='unverified'",
                        function(upRes) {
                            if (upRes.status) {
                                promoted++;
                                MDS.log("✅ [NEWCOIN-PROMOTE] Message " + msgId + " promoted to 'received'.");
                                MDS.comms.solo("CHAT_LIST_UPDATE");
                            }
                        }
                    );
                })(res.rows[i]);
            }
        }
    );
}

/**
 * Verify incoming token/charm messages that are in 'unverified' state.
 * - If the blockchain transaction is found (via txpow scan or coins fallback) → promote to 'received'
 *   (existing checkIncomingTransactions will then handle age-based confirmation).
 * - If not verified after 30 minutes → delete the message (phantom tx, never happened).
 * - If not verified but recent → keep as 'unverified' and retry next cycle.
 */
function checkUnverifiedIncomingMessages() {
    if (SW_DEBUG) MDS.log("🔍 [SW-TX-VERIFY] Checking unverified incoming token/charm messages...");

    var TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    var now = Date.now();

    MDS.sql(
        "SELECT * FROM CHAT_MESSAGES WHERE state='unverified' AND username!='Me' AND (type='token' OR type='charm')",
        function(res) {
            if (!res.status || !res.rows || res.rows.length === 0) {
                if (SW_DEBUG) MDS.log("✅ [SW-TX-VERIFY] No unverified token/charm messages.");
                return;
            }

            if (SW_DEBUG) MDS.log("📋 [SW-TX-VERIFY] Found " + res.rows.length + " unverified message(s)");

            for (var i = 0; i < res.rows.length; i++) {
                (function(msg) {
                    var msgId      = msg.ID   || msg.id;
                    var txpowid    = msg.TXPOWID || msg.txpowid || null;
                    var senderKey  = msg.PUBLICKEY || msg.publickey || '';
                    // Use original_timestamp (= sender stateId) for blockchain lookup;
                    // fall back to date (local receipt time) if not set.
                    var msgTs      = msg.ORIGINAL_TIMESTAMP || msg.DATE || msg.date || 0;
                    var age        = now - parseInt(msgTs || 0);

                    var promoteMsg = function() {
                        MDS.log("✅ [SW-TX-VERIFY] Message " + msgId + " verified — promoting to 'received'.");
                        MDS.sql(
                            "UPDATE CHAT_MESSAGES SET state='received' WHERE id=" + msgId,
                            function(upRes) {
                                if (upRes.status) {
                                    MDS.comms.solo("CHAT_LIST_UPDATE");
                                }
                            }
                        );
                    };

                    verifyIncomingTransaction(msgTs, senderKey, txpowid, function(err, verified) {
                        if (verified) {
                            promoteMsg();
                        } else {
                            // Fallback: scan coins for MetaChain state vars matching timestamp
                            // (coins command is reliable even when txpow address: is not)
                            var tsStr = String(msgTs);
                            MDS.cmd("coins", function(coinsRes) {
                                if (coinsRes.status && Array.isArray(coinsRes.response)) {
                                    for (var c = 0; c < coinsRes.response.length; c++) {
                                        var coin = coinsRes.response[c];
                                        if (coin.state &&
                                            coin.state['1'] && String(coin.state['1'].data) === '204' &&
                                            coin.state['0'] && String(coin.state['0'].data) === tsStr) {
                                            MDS.log("✅ [SW-TX-VERIFY] Message " + msgId + " verified via coins fallback.");
                                            promoteMsg();
                                            return;
                                        }
                                    }
                                }
                                // Neither txpow nor coins matched
                                if (age > TIMEOUT_MS) {
                                    MDS.log("🗑️ [SW-TX-VERIFY] Message " + msgId + " unverified after 30 min — deleting phantom.");
                                    MDS.sql("DELETE FROM CHAT_MESSAGES WHERE id=" + msgId, function() {});
                                } else {
                                    MDS.log("⏳ [SW-TX-VERIFY] Message " + msgId + " not yet verifiable (age=" + Math.round(age / 1000) + "s). Will retry.");
                                }
                            });
                        }
                    });
                })(res.rows[i]);
            }
        }
    );
}

