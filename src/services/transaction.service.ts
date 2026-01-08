/**
 * Transaction Service - Transaction and token management
 * Handles: transaction tracking, balance, token/charm sending, cleanup
 */

import { MDS } from "@minima-global/mds";
import { runSQL } from "./database.service";
// import { chatService, ChatMessage } from "./chat.service";

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

    const txpowidVal = txpowid ? `'${txpowid}'` : 'NULL';
    const pendinguidVal = pendinguid ? `'${pendinguid}'` : 'NULL';

    const sql = `
        INSERT INTO TRANSACTIONS (txpowid, type, publickey, message_timestamp, status, created_at, updated_at, metadata, pendinguid)
        VALUES (${txpowidVal}, '${type}', '${publickey}', ${messageTimestamp}, 'pending', ${now}, ${now}, '${metadataStr}', ${pendinguidVal})
    `;

    console.log(`💾 [TX] Inserting transaction: ${txpowid} (${type})`);

    try {
        await runSQL(sql);
        console.log(`✅ [TX] Transaction inserted: ${txpowid}`);
    } catch (err) {
        console.error(`❌ [TX] Failed to insert transaction:`, err);
        throw err;
    }
}

export async function updateTransactionStatus(txpowid: string, status: 'pending' | 'confirmed' | 'rejected'): Promise<void> {
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

export async function updateTransactionStatusByPendingUid(pendinguid: string, status: 'pending' | 'confirmed' | 'rejected'): Promise<void> {
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
    const sql = `SELECT * FROM TRANSACTIONS WHERE status='pending' ORDER BY created_at ASC`;

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
    const sql = `SELECT * FROM TRANSACTIONS WHERE message_timestamp=${stateId} AND status='pending'`;

    try {
        const res = await runSQL(sql);
        return res.rows && res.rows.length > 0 ? res.rows[0] : null;
    } catch (err) {
        console.error(`❌ [TX] Error finding pending transaction by state id:`, err);
        return null;
    }
}

/* ----------------------------------------------------------------------------
   TRANSACTION STATUS CHECKING
---------------------------------------------------------------------------- */

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

export async function sendToken(tokenId: string, amount: string, address: string, tokenName: string, stateId?: number): Promise<any> {
    console.log(`💸 [WALLET] Sending ${amount} ${tokenName} to ${address}`);

    try {
        const sendParams: any = {
            amount: amount,
            address: address,
            tokenid: tokenId
        };

        if (stateId) {
            sendParams.state = {
                0: stateId,
                1: 204
            };
            console.log(`🏷️ [WALLET] Adding state variables: ID = ${stateId}`);
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
            } else {
                console.error(`❌ [WALLET] Send command failed!`);
                console.error(`❌ [WALLET] Error:`, response.error || response.message || 'Unknown error');
                throw new Error(response.error || response.message || 'Token send failed');
            }
        }

        console.log(`✅ [WALLET] ========== TOKEN SENT SUCCESSFULLY ==========`);

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
    getMyTransactionHistory,
    getMyPendingTransactions,
    getBalance,
    sendToken,
    updateMessageState,
    getPendingMessages
};
