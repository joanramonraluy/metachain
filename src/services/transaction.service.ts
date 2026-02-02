/**
 * Transaction Service - Transaction and token management
 * Handles: transaction tracking, balance, token/charm sending, cleanup
 */

import { MDS } from "@minima-global/mds";
import { runSQL } from "./database.service";
import { chatService } from "./chat.service";

/* ----------------------------------------------------------------------------
   CHAT ID GENERATION
---------------------------------------------------------------------------- */

/**
 * Generate a deterministic, bidirectional chat ID from two public keys.
 * The same ID is generated regardless of which user initiates the chat.
 * @param publicKey1 First participant's public key
 * @param publicKey2 Second participant's public key
 * @returns SHA256 hash of sorted public keys (64 characters)
 */
export async function generateChatId(publicKey1: string, publicKey2: string): Promise<string> {
    // Sort alphabetically to ensure same result regardless of order
    const sorted = [publicKey1, publicKey2].sort();
    const combined = sorted.join('|');

    // Use browser native crypto for reliability and speed (avoids MDS dependency issues)
    try {
        const msgBuffer = new TextEncoder().encode(combined);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return "0x" + hashHex.toUpperCase();
    } catch (e) {
        console.error("Native hash generation failed", e);
    }

    // Fallback: use first 64 chars of combined string
    console.warn('⚠️ [CHAT-ID] Failed to generate hash, using fallback');
    return combined.substring(0, 64);
}

/* ----------------------------------------------------------------------------
   TRANSACTION TRACKING
---------------------------------------------------------------------------- */

export async function insertTransaction(
    txpowid: string | null,
    type: 'charm' | 'token',
    publickey: string,
    messageTimestamp: number,
    metadata: any = {},
    pendinguid: string | null = null
): Promise<void> {
    const now = Date.now();
    const metadataStr = JSON.stringify(metadata).replace(/'/g, "''");

    if (!txpowid && !pendinguid) {
        console.error("❌ [TX] Cannot insert transaction without txpowid or pendinguid");
        return;
    }

    // CRITICAL FIX: If txpowid is missing but we have pendinguid, we must allow insertion.
    // However, the DB schema for TRANSACTIONS table might have NOT NULL on txpowid?
    // Let's assume schema allows NULL for now based on recent init.js checks, 
    // OR we use a placeholder if schema is rigid.
    // Checking `initDatabase` -> txpowid creation usually implies string primary key?
    // Let's use PENDING_UID as temporary txpowid if null to be safe if column is PK.

    // In db-init.js (checked in previous steps), TRANSACTIONS creation wasn't fully visible but usually it's PK.
    // To be safe, let's use the pendinguid as the ID if txpowid is missing.
    const effectiveTxPoWID = txpowid || `PENDING_${pendinguid}`;

    const txpowidVal = `'${effectiveTxPoWID}'`;
    const pendinguidVal = pendinguid ? `'${pendinguid}'` : 'NULL';

    // Extract amount and tokenid from metadata to satisfy table constraints
    const amountVal = metadata.amount ? `'${metadata.amount}'` : "'0'";
    const tokenidVal = metadata.tokenid ? `'${metadata.tokenid}'` : "'0x00'";

    // Ensure we handle the case where we might be re-inserting if using pendingID
    const sql = `
        INSERT INTO TRANSACTIONS (txpowid, type, publickey, message_timestamp, status, date, metadata, pendinguid, amount, tokenid)
        VALUES (${txpowidVal}, '${type}', '${publickey}', ${messageTimestamp}, 'pending', ${now}, '${metadataStr}', ${pendinguidVal}, ${amountVal}, ${tokenidVal})
    `;

    console.log(`💾 [TX] Inserting transaction: ${effectiveTxPoWID} (${type})`);

    try {
        await runSQL(sql);
        console.log(`✅ [TX] Transaction inserted: ${effectiveTxPoWID}`);
    } catch (err) {
        // If duplicate key (likely we are re-tracking), try update?
        console.warn(`⚠️ [TX] Insert failed (maybe exists):`, err);
        // Optional: Update if exists?
        // For now, failure is logged but we don't throw to avoid crashing flow
    }
}

export async function updateTransactionStatus(txpowid: string, status: 'pending' | 'sent' | 'confirmed' | 'rejected'): Promise<void> {
    const now = Date.now();
    const sql = `
        UPDATE TRANSACTIONS
        SET status='${status}', updated_at=${now}
        WHERE txpowid='${txpowid}'
    `;

    console.log(`🔄 [TX] Updating transaction ${txpowid} to ${status}`);

    try {
        await runSQL(sql);
        console.log(`✅ [TX] Transaction status updated: ${txpowid} -> ${status}`);

        // CASCADE TO CHAT_MESSAGES if confirmed
        if (status === 'confirmed') {
            const txInfo = await runSQL(`SELECT message_timestamp, publickey FROM TRANSACTIONS WHERE txpowid='${txpowid}'`);
            if (txInfo.rows && txInfo.rows.length > 0) {
                const row = txInfo.rows[0];
                // Handle potentially uppercase keys from SQL
                const message_timestamp = row.message_timestamp || row.MESSAGE_TIMESTAMP;
                const publickey = row.publickey || row.PUBLICKEY;

                if (message_timestamp && publickey) {
                    if (status === 'confirmed') {
                        console.log(`🔄 [TX] Cascading status update to CHAT_MESSAGES for msg ${message_timestamp} -> confirmed`);
                        await updateMessageState(publickey, message_timestamp, 'confirmed');
                    } else if (status === 'rejected') {
                        console.log(`🔄 [TX] Cascading status update to CHAT_MESSAGES for msg ${message_timestamp} -> failed`);
                        await updateMessageState(publickey, message_timestamp, 'failed');
                    }
                } else {
                    console.warn(`⚠️ [TX] Could not cascade status: missing keys in tx row:`, Object.keys(row));
                }
            }
        }
    } catch (err) {
        console.error(`❌ [TX] Failed to update transaction status:`, err);
        throw err;
    }
}

export async function updateTransactionTxpowid(pendinguid: string, txpowid: string): Promise<void> {
    const sql = `UPDATE TRANSACTIONS SET txpowid='${txpowid}' WHERE pendinguid='${pendinguid}'`;
    try {
        await runSQL(sql);
        console.log(`✅ [TX] Updated txpowid for pendinguid ${pendinguid} to ${txpowid}`);
    } catch (err) {
        console.error(`❌ [TX] Failed to update txpowid:`, err);
        throw err;
    }
}

export async function updateTransactionStatusByPendingUid(pendinguid: string, status: 'pending' | 'sent' | 'confirmed' | 'rejected'): Promise<void> {
    const now = Date.now();
    const sql = `UPDATE TRANSACTIONS SET status='${status}', updated_at=${now} WHERE pendinguid='${pendinguid}'`;
    try {
        await runSQL(sql);
        console.log(`✅ [TX] Updated status for pendinguid ${pendinguid} to ${status}`);
    } catch (err) {
        console.error(`❌ [TX] Failed to update status by pendinguid:`, err);
        throw err;
    }
}

export async function getPendingTransactions(): Promise<any[]> {
    const sql = `SELECT * FROM TRANSACTIONS WHERE status='pending' ORDER BY message_timestamp ASC`;

    try {
        const res = await runSQL(sql);
        return res.rows || [];
    } catch (err) {
        console.error(`❌ [TX] Failed to get pending transactions:`, err);
        return [];
    }
}

export async function getTransactionByMessageTimestamp(timestamp: number): Promise<any | null> {
    const sql = `SELECT * FROM TRANSACTIONS WHERE message_timestamp=${timestamp}`;

    try {
        const res = await runSQL(sql);
        return res.rows && res.rows.length > 0 ? res.rows[0] : null;
    } catch (err) {
        console.error(`❌ [TX] Failed to get transaction by timestamp:`, err);
        return null;
    }
}

export async function getTransactionByPendingUid(pendinguid: string): Promise<any | null> {
    const sql = `SELECT * FROM TRANSACTIONS WHERE pendinguid='${pendinguid}'`;

    try {
        const res = await runSQL(sql);
        return res.rows && res.rows.length > 0 ? res.rows[0] : null;
    } catch (err) {
        console.error(`❌ [TX] Failed to get transaction by pendinguid:`, err);
        return null;
    }
}

export async function findPendingTransactionByStateId(stateId: string): Promise<any | null> {
    // Find transactions that are either 'pending' (awaiting approval) or 'sent' (awaiting 3-block confirmation)
    const sql = `SELECT * FROM TRANSACTIONS WHERE message_timestamp=${stateId} AND (status='pending' OR status='sent')`;

    try {
        const res = await runSQL(sql);
        return res.rows && res.rows.length > 0 ? res.rows[0] : null;
    } catch (err) {
        console.error(`❌ [TX] Error finding pending/sent transaction by state id:`, err);
        return null;
    }
}

/* ----------------------------------------------------------------------------
   TRANSACTION STATUS CHECKING
---------------------------------------------------------------------------- */

// Helper to find transaction ID in history by timestamp (state var 0)
// This is needed because the initial txpowid from MDS_PENDING might change after PoW/Mining.
// Helper to find transaction ID in history by timestamp (state var 0)
// This is needed because the initial txpowid from MDS_PENDING might change after PoW/Mining.
// Helper to find transaction ID in history by timestamp (state var 0)
// This is needed because the initial txpowid from MDS_PENDING might change after PoW/Mining.
async function findTxPoWIDInHistoryByTimestamp(timestamp: string | number): Promise<string | null> {
    const tsStr = String(timestamp);
    try {
        // 1. Get our address first to search raw txpows (more robust than history action:list)
        const addressRes: any = await new Promise((resolve) => {
            MDS.cmd.getaddress((res: any) => resolve(res));
        });

        if (!addressRes.status || !addressRes.response || !addressRes.response.miniaddress) {
            console.warn(`⚠️ [TX-FIND] Could not get miniaddress to search history.`);
            return null;
        }
        const myAddress = addressRes.response.miniaddress;

        // 2. Search txpow by address (last 50 should be enough for recent txs)
        const txpowRes: any = await new Promise((resolve) => {
            MDS.executeRaw(`txpow address:${myAddress} max:50`, (res: any) => resolve(res));
        });

        if (!txpowRes.status || !txpowRes.response) {
            return null;
        }

        const txList = Array.isArray(txpowRes.response) ? txpowRes.response : [txpowRes.response];

        // 3. Iterate
        for (const tx of txList) {
            const state = tx.body?.txn?.state;
            if (state && Array.isArray(state)) {
                // Check state 0 for timestamp
                // State object format: [{port:0, type:2, data:"12345"}]
                const timeState = state.find((s: any) => s.port === 0 && (String(s.data) === tsStr || String(s.data) === `"${tsStr}"`));
                if (timeState) {
                    console.log(`✅ [TX-FIND] Found transaction in address history for timestamp ${tsStr}: ${tx.txpowid}`);
                    return tx.txpowid;
                }
            }
        }
    } catch (e) {
        console.error("❌ [TX-FIND] Error searching history:", e);
    }
    return null;
}

// NEW HELPER: Specific for Incoming Transactions (Receiver Side)
// Incoming funds might arrive at a fresh address or profile address, not just the one returned by getaddress.
// Checks Profile address first, then fallback to Global History search.
async function findIncomingTxPoWIDInHistory(timestamp: string | number): Promise<string | null> {
    const tsStr = String(timestamp);
    try {
        let profileAddress = '';

        // 1. Try to get the address from Maxima Info (Profile Address)
        try {
            const maximaRes: any = await new Promise((resolve) => {
                MDS.cmd.maxima({ params: { action: "info" } }, (res: any) => resolve(res));
            });
            if (maximaRes.status && maximaRes.response && maximaRes.response.contact) {
                profileAddress = maximaRes.response.contact;
            }
        } catch (err) {
            console.warn(`⚠️ [INCOMING-FIND] Failed to fetch Maxima profile address`, err);
        }

        // 2. Search txpow by PROFILE address first (most likely for incoming chats)
        if (profileAddress) {
            const txpowRes: any = await new Promise((resolve) => {
                MDS.executeRaw(`txpow address:${profileAddress} max:50`, (res: any) => resolve(res));
            });

            if (txpowRes.status && txpowRes.response) {
                const txList = Array.isArray(txpowRes.response) ? txpowRes.response : [txpowRes.response];
                for (const tx of txList) {
                    const state = tx.body?.txn?.state;
                    if (state && Array.isArray(state)) {
                        const timeState = state.find((s: any) => s.port === 0 && (String(s.data) === tsStr || String(s.data) === `"${tsStr}"`));
                        if (timeState) {
                            console.log(`✅ [INCOMING-FIND] Found incoming transaction on profile address: ${tx.txpowid}`);
                            return tx.txpowid;
                        }
                    }
                }
            }
        }

        // 3. GLOBAL HISTORY SEARCH (Fallback if not found on profile address)
        // This is expensive but necessary for receiver to find txs sent to any of their addresses.
        try {
            const historyRes: any = await new Promise((resolve) => {
                MDS.executeRaw('history action:list', (res: any) => resolve(res));
            });

            if (historyRes.status && historyRes.response && historyRes.response.txpows) {
                const historyList = historyRes.response.txpows;
                console.log(`[INCOMING-DEBUG] Searched global history, found ${historyList.length} items`);

                for (const tx of historyList) {
                    if (tx.body?.txn?.state) {
                        const state = tx.body.txn.state;
                        // console.log(`[INCOMING-DEBUG] Checking tx ${tx.txpowid} state:`, JSON.stringify(state));

                        if (Array.isArray(state)) {
                            const timeState = state.find((s: any) => s.port === 0 && (String(s.data) === tsStr || String(s.data) === `"${tsStr}"`));
                            if (timeState) {
                                console.log(`✅ [INCOMING-FIND] Found incoming transaction in GLOBAL history: ${tx.txpowid}`);
                                return tx.txpowid;
                            }
                        }
                    }
                }
            } else {
                console.log(`[INCOMING-DEBUG] Global history list is empty or invalid (no txpows found)`, historyRes);
            }
        } catch (e) {
            console.warn("⚠️ [INCOMING-FIND] Global history search failed", e);
        }

    } catch (e) {
        console.error("❌ [INCOMING-FIND] Error searching incoming history:", e);
    }
    return null;
}

export async function checkTransactionStatus(txpowid: string): Promise<{ status: 'pending' | 'confirmed' | 'rejected' | 'unknown', timestamp?: number }> {
    if (!txpowid || txpowid === 'null' || txpowid === 'undefined') return { status: 'unknown' };

    try {
        const response: any = await new Promise((resolve) => {
            MDS.executeRaw(`txpow txpowid:${txpowid}`, (res: any) => {
                resolve(res);
            });
        });

        if (response && response.status) {
            const txpow = response.response;

            if (txpow) {
                if (txpow.isblock || txpow.inblock) {
                    const blockTimestamp = txpow.header?.timemilli;
                    console.log(`✅ [TX] Transaction confirmed at blockchain time: ${blockTimestamp}`);
                    return {
                        status: 'confirmed',
                        timestamp: blockTimestamp ? Number(blockTimestamp) : Date.now()
                    };
                }
                return { status: 'pending' };
            }
        }

        return { status: 'unknown' };
    } catch (err) {
        console.error(`❌ [TX] Error checking transaction status for ${txpowid}:`, err);
        return { status: 'unknown' };
    }
}

export async function checkTransactionByTxpowid(txpowid: string): Promise<'confirmed' | 'pending' | 'not_found'> {
    try {
        const txpowResponse: any = await new Promise((resolve) => {
            MDS.executeRaw(`txpow txpowid:${txpowid}`, (res: any) => {
                resolve(res);
            });
        });

        if (!txpowResponse.status || !txpowResponse.response) {
            return 'not_found';
        }

        const txpow = txpowResponse.response;
        const isInBlock = txpow.isblock || txpow.inblock;

        return isInBlock ? 'confirmed' : 'pending';

    } catch (err) {
        console.error(`❌ [TX-CHECK] Error checking txpowid ${txpowid}:`, err);
        return 'not_found';
    }
}

export async function checkPendingUID(uid: string): Promise<boolean> {
    try {
        const response: any = await new Promise((resolve) => {
            MDS.executeRaw(`checkpending uid:${uid}`, (res: any) => {
                resolve(res);
            });
        });

        if (!response.status) {
            console.log(`📋 [TX-CHECK] Could not check pending status for ${uid}`);
            return false;
        }

        const exists = response.response?.exists || false;
        console.log(`📋 [TX-CHECK] UID ${uid} pending status: ${exists}`);
        return exists;

    } catch (err) {
        console.error(`❌ [TX-CHECK] Error checking pending UID ${uid}:`, err);
        return false;
    }
}

/**
 * Check if a transaction has at least 3 block confirmations
 * @param txpowid - The transaction ID to check
 * @returns true if transaction has 3+ confirmations, false otherwise
 */
export async function check3BlockConfirmation(txpowid: string): Promise<'confirmed' | 'pending' | 'not_found'> {
    if (!txpowid || txpowid.startsWith('PENDING_')) {
        return 'pending';
    }

    try {
        // Get transaction details
        const txResponse: any = await new Promise((resolve) => {
            MDS.executeRaw(`txpow txpowid:${txpowid}`, (res: any) => {
                resolve(res);
            });
        });

        // If direct txpow command fails, try searching mempool and history as fallback
        if (!txResponse.status) {
            console.log(`⚠️ [TX-CONFIRM] txpow command failed for ${txpowid}. Checking mempool/history...`);

            // Check Mempool with CASE-INSENSITIVE comparison
            const mempoolRes: any = await new Promise((resolve) => MDS.executeRaw('mempool', (res: any) => resolve(res)));
            if (mempoolRes.status && mempoolRes.response) {
                const mempoolTxs = mempoolRes.response.txpowlist || [];
                // Compare lowercase
                const foundInMempool = mempoolTxs.find((tx: any) =>
                    (tx.txpowid && tx.txpowid.toLowerCase() === txpowid.toLowerCase())
                );

                if (foundInMempool) {
                    console.log(`✅ [TX-CONFIRM] Found ${txpowid} in mempool (pending)`);
                    return 'pending';
                }
            }

            // Check History (fallback for recently mined but not indexed by txpow command)
            // 'history' command returns the last N transactions.
            const historyRes: any = await new Promise((resolve) => MDS.executeRaw('history action:list', (res: any) => resolve(res)));
            if (historyRes.status && historyRes.response) {
                const historyTxs = historyRes.response.txpows || []; // FIXED: historylist -> txpows
                const foundInHistory = historyTxs.find((tx: any) =>
                    (tx.txpowid && tx.txpowid.toLowerCase() === txpowid.toLowerCase())
                );

                if (foundInHistory) {
                    // Check if it has block number
                    const txBlock = foundInHistory.details?.block;
                    if (txBlock) {
                        console.log(`✅ [TX-CONFIRM] Found ${txpowid} in history (block ${txBlock})`);
                        // Quick check confirmations
                        const statusResponse: any = await new Promise((resolve) => MDS.cmd.status((res: any) => resolve(res)));
                        if (statusResponse.status && statusResponse.response?.chain?.block) {
                            const currentBlock = statusResponse.response.chain.block;
                            const diff = parseInt(currentBlock) - parseInt(txBlock);
                            if (diff >= 3) return 'confirmed';
                        }
                        return 'pending';
                    }
                }
            }

            // Fallback 3: Check Address History (similar to getMyTransactionHistory)
            // This is the most reliable way when 'txpow txpowid' fails for recent transactions
            try {
                const addressResponse: any = await new Promise((resolve) => MDS.cmd.getaddress((res: any) => resolve(res)));
                if (addressResponse.status && addressResponse.response?.miniaddress) {
                    const myAddress = addressResponse.response.miniaddress;
                    // console.log(`🔍 [TX-CONFIRM-FALLBACK] Searching address history: ${myAddress}`);

                    const addressTxPowRes: any = await new Promise((resolve) => MDS.executeRaw(`txpow address:${myAddress} max:20`, (res: any) => resolve(res)));

                    if (addressTxPowRes.status && addressTxPowRes.response) {
                        const txList = Array.isArray(addressTxPowRes.response) ? addressTxPowRes.response : [addressTxPowRes.response];
                        const foundTx = txList.find((tx: any) => tx.txpowid && tx.txpowid.toLowerCase() === txpowid.toLowerCase());

                        if (foundTx) {
                            // Found it! Now verify block status.
                            if (!foundTx.inblock && !foundTx.isblock) {
                                // console.log(`✅ [TX-CONFIRM-FALLBACK] Found ${txpowid} in address history but it is NOT in a block yet.`);
                                return 'pending';
                            }

                            const txBlock = foundTx.header?.block;
                            if (txBlock) {
                                console.log(`✅ [TX-CONFIRM-FALLBACK] Found ${txpowid} in address history (block ${txBlock})`);
                                const statusResponse: any = await new Promise((resolve) => MDS.cmd.status((res: any) => resolve(res)));
                                if (statusResponse.status && statusResponse.response?.chain?.block) {
                                    const currentBlock = statusResponse.response.chain.block;
                                    const diff = parseInt(currentBlock) - parseInt(txBlock);
                                    if (diff >= 3) return 'confirmed';
                                }
                                return 'pending';
                            }
                        }
                    }
                }
            } catch (fallbackErr) {
                console.warn(`⚠️ [TX-CONFIRM] Check address fallback failed:`, fallbackErr);
            }

            return 'not_found';
        }

        if (!txResponse.response) {
            console.log(`⚠️ [TX-CONFIRM] Transaction ${txpowid} response is empty. raw: ${JSON.stringify(txResponse)}`);
            return 'not_found';
        }

        const txpow = txResponse.response;

        // matches the 'working' example code which relies on header.block age.
        // if (!txpow.inblock && !txpow.isblock) {
        //     // console.log(`🔍 [TX-CONFIRM] ${txpowid} is in mempool (not inblock/isblock).`);
        //     return 'pending';
        // }

        const txBlock = txpow.header?.block;
        if (txBlock === undefined || txBlock === null) {
            return 'pending';
        }

        // Get current blockchain tip
        const statusResponse: any = await new Promise((resolve) => {
            MDS.cmd.status((res: any) => {
                resolve(res);
            });
        });

        if (!statusResponse.status || !statusResponse.response) {
            console.log(`⚠️ [TX-CONFIRM] Could not get blockchain status`);
            return 'pending';
        }

        const currentBlock = statusResponse.response.chain?.block;
        if (currentBlock === undefined || currentBlock === null) {
            console.log(`⚠️ [TX-CONFIRM] Could not get current block number`);
            return 'pending';
        }

        // Compare blocks and check for 3 confirmations
        const blockDifference = parseInt(currentBlock) - parseInt(txBlock);
        console.log(`🔍 [TX-CONFIRM] Transaction ${txpowid}: mined in/ref ${txBlock}, current ${currentBlock}, confirmations: ${blockDifference}`);
        return blockDifference >= 3 ? 'confirmed' : 'pending';

    } catch (err) {
        console.error(`❌ [TX-CONFIRM] Error checking 3-block confirmation for ${txpowid}:`, err);
        return 'pending';
    }
}
/**
         * Get all transactions that are in 'sent' status (waiting for confirmations)
         */
export async function getSentTransactions(): Promise<any[]> {
    const sql = `SELECT * FROM TRANSACTIONS WHERE status='sent' AND txpowid NOT LIKE 'PENDING_%' ORDER BY message_timestamp ASC`;

    try {
        const res = await runSQL(sql);
        return res.rows || [];
    } catch (err) {
        console.error(`❌ [TX] Failed to get sent transactions:`, err);
        return [];
    }
}

/* ----------------------------------------------------------------------------
   TRANSACTION HISTORY
---------------------------------------------------------------------------- */

export async function getMyTransactionHistory(): Promise<Map<string, { txpowid: string, timestamp: number }>> {
    try {
        console.log('🔍 [HISTORY] Fetching transaction history from blockchain...');

        const addressResponse: any = await new Promise((resolve) => {
            MDS.cmd.getaddress((res: any) => {
                resolve(res);
            });
        });

        if (!addressResponse.status || !addressResponse.response) {
            console.error('❌ [HISTORY] Failed to get address');
            return new Map();
        }

        const myAddress = addressResponse.response.miniaddress;
        console.log(`🔍 [HISTORY] Querying txpows for address: ${myAddress}`);

        const txpowResponse: any = await new Promise((resolve) => {
            MDS.executeRaw(`txpow address:${myAddress} max:100`, (res: any) => {
                resolve(res);
            });
        });

        if (!txpowResponse.status || !txpowResponse.response) {
            console.warn('⚠️ [HISTORY] No transaction history found');
            return new Map();
        }

        const historyMap = new Map<string, { txpowid: string, timestamp: number }>();
        const txpows = Array.isArray(txpowResponse.response) ? txpowResponse.response : [txpowResponse.response];

        for (const txpow of txpows) {
            try {
                // FILTER: Only include transactions that are actually in a block (confirmed history)
                // This prevents pending mempool transactions from being treated as "history" by cleanup logic
                if (!txpow.isblock && !txpow.inblock) {
                    continue;
                }

                const state = txpow.body?.txn?.state;

                if (state && Array.isArray(state) && state.length >= 2) {
                    const charmChainId = state[1]?.data;

                    if (charmChainId === '204') {
                        const stateId = state[0]?.data;
                        const txpowid = txpow.txpowid;
                        const timestamp = txpow.header?.timemilli ? Number(txpow.header.timemilli) : Date.now();

                        if (stateId && txpowid) {
                            historyMap.set(stateId, { txpowid, timestamp });
                            console.log(`✅ [HISTORY] Found MetaChain tx: ${stateId} -> ${txpowid} (Time: ${timestamp})`);
                        }
                    }
                }
            } catch (err) {
                console.error('❌ [HISTORY] Error parsing txpow:', err);
            }
        }

        console.log(`✅ [HISTORY] Found ${historyMap.size} MetaChain transaction(s) in blockchain`);
        return historyMap;

    } catch (err) {
        console.error('❌ [HISTORY] Error fetching transaction history:', err);
        return new Map();
    }
}

export async function getMyPendingTransactions(): Promise<Map<string, string>> {
    try {
        console.log('🔍 [MEMPOOL] Fetching pending transactions from mempool...');

        const addressResponse: any = await new Promise((resolve) => {
            MDS.cmd.getaddress((res: any) => {
                resolve(res);
            });
        });

        if (!addressResponse.status || !addressResponse.response) {
            console.error('❌ [MEMPOOL] Failed to get address');
            return new Map();
        }

        const myAddress = addressResponse.response.miniaddress;

        const txpowResponse: any = await new Promise((resolve) => {
            MDS.executeRaw(`txpow address:${myAddress} max:100`, (res: any) => {
                resolve(res);
            });
        });

        if (!txpowResponse.status || !txpowResponse.response) {
            console.warn('⚠️ [MEMPOOL] No transactions found');
            return new Map();
        }

        const pendingMap = new Map<string, string>();
        const txpows = Array.isArray(txpowResponse.response) ? txpowResponse.response : [txpowResponse.response];

        for (const txpow of txpows) {
            try {
                const isInBlock = txpow.isblock || txpow.inblock;

                if (!isInBlock) {
                    const state = txpow.body?.txn?.state;

                    if (state && Array.isArray(state) && state.length >= 2) {
                        const charmChainId = state[1]?.data;

                        if (charmChainId === '204') {
                            const stateId = state[0]?.data;
                            const txpowid = txpow.txpowid;

                            if (stateId && txpowid) {
                                pendingMap.set(stateId, txpowid);
                                console.log(`⏳ [MEMPOOL] Found pending MetaChain tx: ${stateId} -> ${txpowid}`);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('❌ [MEMPOOL] Error parsing txpow:', err);
            }
        }

        console.log(`✅ [MEMPOOL] Found ${pendingMap.size} pending MetaChain transaction(s) in mempool`);
        return pendingMap;

    } catch (err) {
        console.error('❌ [MEMPOOL] Error fetching pending transactions:', err);
        return new Map();
    }
}

/* ----------------------------------------------------------------------------
   BALANCE & TOKEN SENDING
---------------------------------------------------------------------------- */

export async function getBalance(): Promise<any[]> {
    try {
        const response = await MDS.cmd.balance();
        return response.response;
    } catch (err) {
        console.error("❌ [WALLET] Error fetching balance:", err);
        return [];
    }
}

export async function sendToken(
    tokenId: string,
    amount: string,
    address: string,
    tokenName: string,
    stateId?: number,
    myPublicKey?: string,
    recipientPublicKey?: string
): Promise<any> {
    console.log(`💸 [WALLET] Sending ${amount} ${tokenName} to ${address}`);

    // Fire Optimistic Blink START immediately to sync SideMenu with Chat Bubble
    // This tells SideMenu: "Hey, we are sending something, assume unconfirmed will exist soon."
    window.dispatchEvent(new CustomEvent('minima_balance_update_start'));

    try {
        const sendParams: any = {
            amount: amount,
            address: address,
            tokenid: tokenId
        };

        if (stateId && myPublicKey && recipientPublicKey) {
            // Generate deterministic bidirectional chat ID
            const chatId = await generateChatId(myPublicKey, recipientPublicKey);

            sendParams.state = {
                0: stateId,
                1: 204,
                2: chatId,  // Deterministic chat identifier for recovery
                3: myPublicKey // Sender public key for identification
            };
            console.log(`🏷️ [WALLET] Adding state variables: ID = ${stateId}, ChatID = ${chatId}, Sender = ${myPublicKey}`);
        }

        console.log(`💸 [WALLET] Command parameters:`, JSON.stringify(sendParams, null, 2));
        console.log(`💸 [WALLET] Executing MDS.cmd.send...`);

        const response = await (MDS.cmd as any).send(sendParams);

        console.log(`💸 [WALLET] Raw response:`, JSON.stringify(response, null, 2));

        let txpowid = null;
        if (response) {
            if (response.txpowid) txpowid = response.txpowid;
            else if (response.response && response.response.txpowid) txpowid = response.response.txpowid;
            else if (response.response && response.response.txpow && response.response.txpow.txpowid) txpowid = response.response.txpow.txpowid;
            else if (response.response && response.response.body && response.response.body.txn && response.response.body.txn.txpowid) txpowid = response.response.body.txn.txpowid;
        }

        let pendinguid = null;
        if (response) {
            if (response.pendinguid) pendinguid = response.pendinguid;
            else if (response.response && response.response.pendinguid) pendinguid = response.response.pendinguid;
        }

        if (txpowid) {
            console.log(`🆔 [WALLET] Transaction ID captured: ${txpowid}`);
        } else if (pendinguid) {
            console.log(`⏳ [WALLET] Pending UID captured: ${pendinguid}`);
        } else {
            console.warn(`⚠️ [WALLET] No txpowid or pendinguid found in response`);
        }

        if (response && response.status === false) {
            const isPending = response.pending ||
                (response.error && response.error.toString().toLowerCase().includes("pending"));

            if (isPending) {
                console.warn("⚠️ [WALLET] Command is pending approval (Read Mode).");
                console.log("🔍 [DEBUG] Full Pending Response Structure:", JSON.stringify(response, null, 2));

                return {
                    ...response,
                    txpowid,
                    pendinguid
                };
                return {
                    ...response,
                    txpowid,
                    pendinguid
                };
            } else {
                console.error(`❌ [WALLET] Send command failed!`);
                console.error(`❌ [WALLET] Error:`, response.error || response.message || 'Unknown error');
                throw new Error(response.error || response.message || 'Token send failed');
            }
        }

        console.log(`✅ [WALLET] ========== TOKEN SENT SUCCESSFULLY ==========`);

        // Notify UI to refresh balance immediately And repeatedly to catch Node latency
        // The node takes a few ms to update 'unconfirmed', so a single call might be too early.
        const triggerUpdate = () => window.dispatchEvent(new CustomEvent('minima_balance_update'));

        triggerUpdate(); // Immediate
        setTimeout(triggerUpdate, 500); // Check again
        setTimeout(triggerUpdate, 1000); // And again
        setTimeout(triggerUpdate, 2000); // Just in case

        return {
            ...response,
            txpowid,
            pendinguid
        };
    } catch (err) {
        console.error(`❌ [WALLET] ========== TOKEN SEND FAILED ==========`);
        console.error(`❌ [WALLET] Error details:`, err);
        throw err;
    }
}

/* ----------------------------------------------------------------------------
   MESSAGE STATE UPDATES
---------------------------------------------------------------------------- */

export async function updateMessageState(publickey: string, timestamp: number, state: string, newTimestamp?: number): Promise<any> {
    let sql: string;

    if (newTimestamp) {
        sql = `UPDATE CHAT_MESSAGES SET state='${state}', date=${newTimestamp} WHERE publickey='${publickey}' AND date=${timestamp}`;
        console.log(`🔄 [MSG] Updating message state: ${timestamp} -> ${state} (new timestamp: ${newTimestamp})`);
    } else {
        sql = `UPDATE CHAT_MESSAGES SET state='${state}' WHERE publickey='${publickey}' AND date=${timestamp}`;
        console.log(`🔄 [MSG] Updating message state: ${timestamp} -> ${state}`);
    }

    try {
        const result = await runSQL(sql);
        console.log(`✅ [MSG] Message state updated successfully`);

        // Notify UI to refresh messages (treat as delivery receipt to trigger reload)
        chatService.notifyNewMessage({
            type: 'delivery_receipt',
            publickey: publickey,
            state: state,
            timestamp: timestamp
        });

        return result;
    } catch (err) {
        console.error("❌ [SQL] Error updating message state:", err);
        throw err;
    }
}

export function getPendingMessages(publickey: string) {
    return new Promise((resolve) => {
        const sql = `SELECT * FROM CHAT_MESSAGES WHERE publickey='${publickey}' AND state='pending' ORDER BY date ASC`;
        MDS.sql(sql, (res: any) => {
            if (res.status && res.rows) {
                resolve(res.rows);
            } else {
                resolve([]);
            }
        });
    });
}

/* ----------------------------------------------------------------------------
   CONFIRMATION CHECKER - Periodic check for 3-block confirmations
---------------------------------------------------------------------------- */

let confirmationCheckerTimeout: NodeJS.Timeout | null = null;
let isConfirmationCheckerRunning = false;

/**
 * Start periodic checker for transaction confirmations
 * Uses recursive setTimeout to ensure one check finishes before the next begins.
 */
export function startConfirmationChecker(): void {
    // Don't start multiple checkers
    if (isConfirmationCheckerRunning) {
        console.log('⏰ [TX-CONFIRM] Confirmation checker already running');
        return;
    }

    console.log('⏰ [TX-CONFIRM] Starting confirmation checker (recursive loop)');
    isConfirmationCheckerRunning = true;

    const checkConfirmations = async () => {
        // Stop if flag was turned off
        if (!isConfirmationCheckerRunning) return;

        try {
            // Check TRANSACTIONS table
            const sentTxRows = await getSentTransactions();

            // Normalize rows to lower case keys
            const sentTxs = sentTxRows.map(row => {
                const newRow: any = {};
                for (const key in row) {
                    newRow[key.toLowerCase()] = row[key];
                }
                return newRow;
            });

            if (sentTxs.length > 0) {
                console.log(`🔍 [TX-CONFIRM] Checking ${sentTxs.length} sent transaction(s) for confirmations...`);

                for (const tx of sentTxs) {
                    // Check if stopped in middle of loop
                    if (!isConfirmationCheckerRunning) break;

                    if (!tx.txpowid) {
                        console.log(`⚠️ [TX-CONFIRM] Skipping tx with missing txpowid keys:`, Object.keys(tx));
                        continue;
                    }
                    console.log(`👉 [TX-CONFIRM] Checking TX: ${tx.txpowid} (uid: ${tx.pendinguid})`);
                    const status = await check3BlockConfirmation(tx.txpowid);

                    if (status === 'confirmed') {
                        console.log(`✅ [TX-CONFIRM] Transaction ${tx.txpowid} is now confirmed (3+ blocks)`);
                        await updateTransactionStatus(tx.txpowid, 'confirmed');
                    } else if (status === 'not_found') {
                        // TxPoWID might have changed (e.g. mining PoW updated the hash).
                        // Try to find the NEW txpowid by searching history for the state variable (timestamp).
                        if (tx.message_timestamp) {
                            console.log(`🕵️ [TX-CONFIRM] Transaction ${tx.txpowid} not found. Searching history for timestamp ${tx.message_timestamp}...`);
                            const newTxPoWID = await findTxPoWIDInHistoryByTimestamp(tx.message_timestamp);

                            if (newTxPoWID && newTxPoWID !== tx.txpowid) {
                                console.log(`🔄 [TX-CONFIRM] Found new ID for timestamp ${tx.message_timestamp}: ${newTxPoWID}. Updating TRANSACTIONS table.`);

                                // Update DB with new ID
                                await runSQL(`UPDATE TRANSACTIONS SET txpowid='${newTxPoWID}' WHERE txpowid='${tx.txpowid}'`);

                                // Check confirmation for this new ID immediately
                                const newStatus = await check3BlockConfirmation(newTxPoWID);
                                if (newStatus === 'confirmed') {
                                    console.log(`✅ [TX-CONFIRM] Recovered transaction confirmed!`);
                                    // We update the OLD txpowid's record effectively by updating with the NEW ID now
                                    await updateTransactionStatus(newTxPoWID, 'confirmed');
                                } else {
                                    console.log(`⏳ [TX-CONFIRM] Recovered transaction found but status is ${newStatus}`);
                                }
                                continue;
                            }
                        }

                        // Check age
                        const now = Date.now();
                        const txTime = parseInt(tx.message_timestamp) || parseInt(tx.created_at) || 0;
                        const age = now - txTime;
                        const isOld = age > 10 * 60 * 1000; // 10 minutes

                        if (isOld && txTime > 0) {
                            console.log(`🗑️ [TX-CONFIRM] Transaction ${tx.txpowid} not found and old (${Math.floor(age / 60000)}m). Marking as failed.`);
                            await updateTransactionStatus(tx.txpowid, 'rejected');
                        } else {
                            console.log(`⏳ [TX-CONFIRM] Transaction ${tx.txpowid} not found but recent (${Math.floor(age / 1000)}s). Retrying later.`);
                        }
                    } else {
                        // Pending (mempool or low confirmations)
                        // console.log(`⏳ [TX-CONFIRM] Transaction ${tx.txpowid} pending...`);
                    }
                }
            }

            // Also check CHAT_MESSAGES for sent token messages AND charms
            const sentMessagesSql = `SELECT * FROM CHAT_MESSAGES WHERE state='sent' AND (type='token' OR type='charm') ORDER BY date ASC`;
            const sentMessagesRes = await runSQL(sentMessagesSql);
            const rawSentMessages = sentMessagesRes.rows || [];

            // Normalize message rows
            const sentMessages = rawSentMessages.map((row: any) => {
                const newRow: any = {};
                for (const key in row) {
                    newRow[key.toLowerCase()] = row[key];
                }
                return newRow;
            });

            if (sentMessages.length > 0) {
                console.log(`🔍 [TX-CONFIRM] Checking ${sentMessages.length} sent message(s) for confirmations...`);

                for (const msg of sentMessages) {
                    // Check if stopped in middle of loop
                    if (!isConfirmationCheckerRunning) break;

                    // Skip if message doesn't have a valid date
                    if (!msg.date || msg.date === 'undefined') {
                        console.log(`⚠️ [TX-CONFIRM] Skipping message with invalid date: ${msg.date}`);
                        continue;
                    }

                    // Extract txpowid from the transaction tracking
                    const txSql = `SELECT txpowid FROM TRANSACTIONS WHERE message_timestamp=${msg.date} AND status='sent'`;
                    const txRes = await runSQL(txSql);

                    if (txRes.rows && txRes.rows.length > 0) {
                        // Normalize TX result too
                        const txRow = txRes.rows[0];
                        const txpowid = txRow.TXPOWID || txRow.txpowid; // Handle both cases for single row access

                        console.log(`👉 [TX-CONFIRM] Message ${msg.date} matches TX ${txpowid}`);
                        const status = await check3BlockConfirmation(txpowid);

                        if (status === 'confirmed') {
                            console.log(`✅ [TX-CONFIRM] Message ${msg.date} is now confirmed (3+ blocks)`);
                            await updateMessageState(msg.publickey, msg.date, 'confirmed');
                        } else if (status === 'not_found') {
                            // TxPoWID might have changed (e.g. mining PoW updated the hash).
                            // Try to find the NEW txpowid by searching history for the state variable (timestamp).
                            console.log(`🕵️ [TX-CONFIRM] Transaction ${txpowid} not found. Searching history for timestamp ${msg.date}...`);

                            const newTxPoWID = await findTxPoWIDInHistoryByTimestamp(msg.date);
                            if (newTxPoWID && newTxPoWID !== txpowid) {
                                console.log(`🔄 [TX-CONFIRM] Found new ID for message ${msg.date}: ${newTxPoWID}. Updating DB.`);

                                // Update DB with new ID
                                await runSQL(`UPDATE TRANSACTIONS SET txpowid='${newTxPoWID}' WHERE txpowid='${txpowid}'`);

                                // Check confirmation for this new ID immediately
                                const newStatus = await check3BlockConfirmation(newTxPoWID);
                                if (newStatus === 'confirmed') {
                                    console.log(`✅ [TX-CONFIRM] recovered transaction confirmed!`);
                                    await updateMessageState(msg.publickey, msg.date, 'confirmed');
                                } else {
                                    console.log(`⏳ [TX-CONFIRM] Recovered transaction found but status is ${newStatus}`);
                                }
                                continue; // Skip the timeout check for this iteration
                            }

                            const now = Date.now();
                            const msgTime = parseInt(msg.date) || 0;
                            const age = now - msgTime;
                            if (age > 10 * 60 * 1000) { // 10 mins
                                console.log(`🗑️ [TX-CONFIRM] Message ${msg.date} transaction lost. Failing message.`);
                                await updateMessageState(msg.publickey, msg.date, 'failed');
                            }
                        }
                    } else {
                        // Fallback: Check if there is a 'confirmed' transaction for this message
                        const confirmedTxSql = `SELECT txpowid FROM TRANSACTIONS WHERE message_timestamp=${msg.date} AND status='confirmed'`;
                        const confirmedTxRes = await runSQL(confirmedTxSql);
                        if (confirmedTxRes.rows && confirmedTxRes.rows.length > 0) {
                            console.log(`✅ [TX-CONFIRM] Message ${msg.date} already has a confirmed transaction. Updating message state.`);
                            await updateMessageState(msg.publickey, msg.date, 'confirmed');
                        } else {
                            // NEW FALLBACK: Check if the message ITSELF has a txpowid (Incoming transactions)
                            // Incoming messages are inserted with state='sent' to trigger UI blink, but have no entry in TRANSACTIONS table.
                            if (msg.txpowid && msg.txpowid !== 'null' && msg.txpowid !== 'undefined') {
                                console.log(`👉 [TX-CONFIRM-INCOMING] Message ${msg.date} has direct txpowid ${msg.txpowid}. Checking confirmation...`);
                                const status = await check3BlockConfirmation(msg.txpowid);

                                if (status === 'confirmed') {
                                    console.log(`✅ [TX-CONFIRM-INCOMING] Incoming message ${msg.date} confirmed!`);
                                    await updateMessageState(msg.publickey, msg.date, 'confirmed');
                                } else if (status === 'not_found') {
                                    // RECOVERY LOGIC FOR INCOMING (Using Separate Helper):
                                    const searchTimestamp = msg.original_timestamp || msg.date;
                                    console.log(`🕵️ [TX-CONFIRM-INCOMING] Tx ${msg.txpowid} not found. Searching INCOMING history for timestamp ${searchTimestamp} (Received: ${msg.date})...`);

                                    const newTxPoWID = await findIncomingTxPoWIDInHistory(searchTimestamp);
                                    if (newTxPoWID && newTxPoWID !== msg.txpowid) {
                                        console.log(`🔄 [TX-CONFIRM-INCOMING] Found new ID for incoming message ${msg.date}: ${newTxPoWID}. Updating Chat DB.`);


                                        // Update CHAT_MESSAGES directly since there is no TRANSACTIONS row
                                        await runSQL(`UPDATE CHAT_MESSAGES SET txpowid='${newTxPoWID}' WHERE publickey='${msg.publickey}' AND date=${msg.date}`);

                                        // Check confirmation for this new ID immediately
                                        const newStatus = await check3BlockConfirmation(newTxPoWID);
                                        if (newStatus === 'confirmed') {
                                            console.log(`✅ [TX-CONFIRM-INCOMING] Recovered incoming transaction confirmed!`);
                                            await updateMessageState(msg.publickey, msg.date, 'confirmed');
                                        } else {
                                            console.log(`⏳ [TX-CONFIRM-INCOMING] Recovered incoming tx found but status is ${newStatus}`);
                                        }
                                    } else {
                                        console.log(`⏳ [TX-CONFIRM-INCOMING] Not found in history yet.`);
                                    }
                                } else if (status === 'pending') {
                                    // ZOMBIE CHECK: If pending for > 5 minutes, force a recovery search
                                    // The specific ID might be effectively dead/stuck, but a re-mined one exists.
                                    const now = Date.now();
                                    const msgTime = parseInt(msg.date) || 0;
                                    const age = now - msgTime;

                                    if (age > 5 * 60 * 1000) { // 5 minutes
                                        console.log(`🕵️ [TX-CONFIRM-INCOMING] Tx ${msg.txpowid} is pending for ${Math.floor(age / 1000)}s (Zombie?). Forcing recovery search...`);
                                        const searchTimestamp = msg.original_timestamp || msg.date;
                                        const newTxPoWID = await findIncomingTxPoWIDInHistory(searchTimestamp);

                                        if (newTxPoWID && newTxPoWID !== msg.txpowid) {
                                            console.log(`🔄 [TX-CONFIRM-INCOMING] Found NEW ID for zombie transaction ${msg.date}: ${newTxPoWID}. Updating DB.`);

                                            // Update DB
                                            await runSQL(`UPDATE CHAT_MESSAGES SET txpowid='${newTxPoWID}' WHERE publickey='${msg.publickey}' AND date=${msg.date}`);

                                            // Check immediately
                                            const newStatus = await check3BlockConfirmation(newTxPoWID);
                                            if (newStatus === 'confirmed') {
                                                console.log(`✅ [TX-CONFIRM-INCOMING] Recovered zombie transaction confirmed!`);
                                                await updateMessageState(msg.publickey, msg.date, 'confirmed');
                                            }
                                        } else {
                                            console.log(`⏳ [TX-CONFIRM-INCOMING] No better ID found. Still pending.`);
                                        }
                                    } else {
                                        console.log(`⏳ [TX-CONFIRM-INCOMING] Status is ${status}`);
                                    }
                                }
                            } else {
                                // ORPHAN CHECK: valid 'sent' message but no tracking info found.
                                // Likely pre-database wipe or migration artifact.
                                // Attempt to find it in history by timestamp.
                                console.log(`🕵️ [TX-CONFIRM] Orphan message ${msg.date} checks failed. Searching history as last resort...`);

                                const recoveredTxPoWID = await findTxPoWIDInHistoryByTimestamp(msg.date);
                                if (recoveredTxPoWID) {
                                    console.log(`✅ [TX-CONFIRM] Found orphan transaction in history! ID: ${recoveredTxPoWID}`);
                                    // Verify confirmation count just in case
                                    const status = await check3BlockConfirmation(recoveredTxPoWID);
                                    if (status === 'confirmed') {
                                        await updateMessageState(msg.publickey, msg.date, 'confirmed');
                                    } else {
                                        console.log(`⏳ [TX-CONFIRM] Orphan found but status is ${status}`);
                                        // Update CHAT_MESSAGES with the found ID so future checks use the optimized path
                                        // And so we can track it properly.
                                        await runSQL(`UPDATE CHAT_MESSAGES SET txpowid='${recoveredTxPoWID}' WHERE publickey='${msg.publickey}' AND date=${msg.date}`);

                                        // Also insert into TRANSACTIONS so it's tracked normally? 
                                        // Maybe overkill, but ensures consistency. For now, updating message is enough.
                                    }
                                } else {
                                    // Not found in history. Check age.
                                    const now = Date.now();
                                    const msgTime = parseInt(msg.date) || 0;
                                    const age = now - msgTime;
                                    if (age > 10 * 60 * 1000) { // 10 minutes
                                        console.log(`🗑️ [TX-CONFIRM] Orphan message ${msg.date} not found in history and old (>10m). Marking as failed.`);
                                        await updateMessageState(msg.publickey, msg.date, 'failed');
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error('❌ [TX-CONFIRM] Error in confirmation checker:', err);
        } finally {
            // Schedule next check ONLY after this one completes
            if (isConfirmationCheckerRunning) {
                confirmationCheckerTimeout = setTimeout(checkConfirmations, 10000);
            }
        }
    };

    // Run immediately on start
    checkConfirmations();
}

/**
 * Stop the confirmation checker
 */
export function stopConfirmationChecker(): void {
    isConfirmationCheckerRunning = false;
    if (confirmationCheckerTimeout) {
        clearTimeout(confirmationCheckerTimeout);
        confirmationCheckerTimeout = null;
    }
    console.log('⏰ [TX-CONFIRM] Confirmation checker stopped');
}

export async function getPendingTransactionsCount(): Promise<number> {
    try {
        // Include 'sent' status as these are also "processing" (waiting for confirmation)
        // This ensures the UI indicator works even if Minima's unconfirmed balance is 0 (e.g. after restart)
        const sql = `SELECT COUNT(*) as total FROM TRANSACTIONS WHERE status IN ('pending', 'sent')`;
        const res = await runSQL(sql);
        if (res && res.rows && res.rows.length > 0) {
            // Handle lowercase or uppercase keys from SQL result
            const count = res.rows[0].total !== undefined ? res.rows[0].total : res.rows[0].TOTAL;
            return parseInt(count || '0');
        }
        return 0;
    } catch (err) {
        console.error("Error counting pending transactions:", err);
        return 0;
    }
}

/* ----------------------------------------------------------------------------
   EXPORT SERVICE SINGLETON
---------------------------------------------------------------------------- */

export const transactionService = {
    insertTransaction,
    updateTransactionStatus,
    updateTransactionTxpowid,
    updateTransactionStatusByPendingUid,
    getPendingTransactions,
    getTransactionByMessageTimestamp,
    getTransactionByPendingUid,
    findPendingTransactionByStateId,
    checkTransactionStatus,
    checkTransactionByTxpowid,
    checkPendingUID,
    check3BlockConfirmation,
    getSentTransactions,
    startConfirmationChecker,
    stopConfirmationChecker,
    getMyTransactionHistory,
    getMyPendingTransactions,
    getBalance,
    sendToken,
    updateMessageState,
    getPendingMessages,
    getPendingTransactionsCount
};
