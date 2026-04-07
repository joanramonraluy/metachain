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
 * Check incoming token/charm messages in 'received' state that have a txpowid
 * and promote them to 'confirmed' once 3-block confirmation is achieved.
 * This runs on the recipient's node.
 */
function checkIncomingTransactions() {
    MDS.log("🔍 [SW-TX-INCOMING] Checking incoming unconfirmed token/charm messages...");

    // Include messages with NULL txpowid — they will be resolved via timestamp search
    MDS.sql("SELECT * FROM CHAT_MESSAGES WHERE state IN ('received','read') AND username!='Me' AND (type='token' OR type='charm')", function (res) {
        if (!res.status || res.rows.length === 0) {
            MDS.log("✅ [SW-TX-INCOMING] No incoming unconfirmed token messages");
            return;
        }

        MDS.log("📋 [SW-TX-INCOMING] Found " + res.rows.length + " incoming unconfirmed message(s)");

        for (var i = 0; i < res.rows.length; i++) {
            (function (msg) {
                var txpowid = msg.TXPOWID || msg.txpowid;
                var msgId = msg.ID || msg.id;
                var msgDate = msg.DATE || msg.date;

                var confirmAndUpdate = function (resolvedTxpowid) {
                    check3BlockConfirmation(resolvedTxpowid, function (err, status) {
                        if (err || status !== 'confirmed') return;

                        MDS.log("✅ [SW-TX-INCOMING] 3-Block confirmed incoming tx: " + resolvedTxpowid + " (msg ID " + msgId + ")");
                        MDS.sql("UPDATE CHAT_MESSAGES SET state='confirmed', txpowid='" + resolvedTxpowid + "' WHERE id=" + msgId, function (updateRes) {
                            if (updateRes.status) {
                                MDS.log("✅ [SW-TX-INCOMING] Message ID " + msgId + " marked as confirmed");
                                MDS.comms.solo(JSON.stringify({
                                    type: "TOKEN_INCOMING_CONFIRMED",
                                    msgId: msgId,
                                    txpowid: resolvedTxpowid
                                }));
                            }
                        });
                    });
                };

                if (txpowid && txpowid !== 'null') {
                    // Fast path: txpowid already stored
                    confirmAndUpdate(txpowid);
                } else if (msgDate) {
                    // Slow path: find real txpowid by timestamp
                    MDS.log("🔍 [SW-TX-INCOMING] No txpowid for msg " + msgId + ", searching by timestamp " + msgDate);
                    findInBlockchainOrMempool(msgDate, function (err, foundTxpowid) {
                        if (err || !foundTxpowid) {
                            MDS.log("⚠️ [SW-TX-INCOMING] Could not find txpowid for msg " + msgId);
                            return;
                        }
                        MDS.log("✅ [SW-TX-INCOMING] Found txpowid via timestamp: " + foundTxpowid);
                        confirmAndUpdate(foundTxpowid);
                    });
                }
            })(res.rows[i]);
        }
    });
}

