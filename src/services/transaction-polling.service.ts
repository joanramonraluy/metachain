// src/services/transaction-polling.service.ts

import { minimaService } from './minima.service';

type TransactionStatusCallback = (txpowid: string, status: 'confirmed' | 'rejected', transaction: any) => void;

class TransactionPollingService {
    private pollingInterval: NodeJS.Timeout | null = null;
    private isPolling = false;
    private callbacks: Set<TransactionStatusCallback> = new Set();
    private readonly POLL_INTERVAL_MS = 10000; // 10 seconds
    private cleanupDone = false; // Track if initial cleanup has run

    /**
     * Start polling for pending transactions
     */
    start() {
        if (this.isPolling) {
            console.log('⚠️ [TxPolling] Already polling');
            return;
        }

        console.log('🔄 [TxPolling] Starting transaction polling service...');
        this.isPolling = true;

        // Start polling interval
        this.poll(); // Initial poll
        this.pollingInterval = setInterval(() => this.poll(), this.POLL_INTERVAL_MS);
    }

    /**
     * Stop polling
     */
    stop() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        this.isPolling = false;
        console.log('⏹️ [TxPolling] Stopped transaction polling service');
    }

    /**
     * Subscribe to transaction status updates
     */
    subscribe(callback: TransactionStatusCallback) {
        this.callbacks.add(callback);
        return () => this.callbacks.delete(callback);
    }

    /**
     * Poll for pending transactions and check their status
     */
    private async poll() {
        try {
            const pendingTransactions = await minimaService.getPendingTransactions();

            if (pendingTransactions.length === 0) {
                return; // No pending transactions
            }

            console.log(`🔍 [TxPolling] Checking ${pendingTransactions.length} pending transaction(s)`);

            // First poll: Cleanup orphaned pending transactions
            if (!this.cleanupDone) {
                await this.cleanupOrphanedTransactions();
                this.cleanupDone = true;
            }

            for (const tx of pendingTransactions) {
                await this.checkTransaction(tx);
            }
        } catch (err) {
            console.error('❌ [TxPolling] Error during polling:', err);
        }
    }

    /**
     * Clean up transactions that are pending in DB but no longer in node
     */
    private async cleanupOrphanedTransactions() {
        console.log('🧹 [TxPolling] Delegating to MinimaService for blockchain verification...');
        await minimaService.cleanupOrphanedPendingTransactions();
    }

    /**
     * Check the status of a single transaction
     */
    private async checkTransaction(transaction: any) {
        const { TXPOWID, PENDINGUID } = transaction;

        try {
            // If we have a TXPOWID, check it normally
            if (TXPOWID && TXPOWID !== 'null' && TXPOWID !== 'undefined') {
                const result = await minimaService.checkTransactionStatus(TXPOWID);

                console.log(`📊 [TxPolling] Transaction ${TXPOWID}: ${result.status}${result.timestamp ? ` at ${result.timestamp}` : ''}`);

                if (result.status === 'confirmed') {
                    await this.handleConfirmedTransaction(TXPOWID, transaction, result.timestamp);
                } else if (result.status === 'rejected') {
                    await this.handleRejectedTransaction(TXPOWID, transaction);
                }
                // If status is 'pending' or 'unknown', we'll check again next poll
            }
            // If no TXPOWID but we have PENDINGUID
            else if (PENDINGUID && PENDINGUID !== 'null' && PENDINGUID !== 'undefined') {
                // We can't check status of pending command without 'pending' command.
                // We just have to wait for MDS_PENDING event.
                // So we do nothing here.
                // console.log(`⏳ [TxPolling] Waiting for MDS_PENDING event for ${PENDINGUID}`);
            }

        } catch (err) {
            console.error(`❌ [TxPolling] Error checking transaction ${TXPOWID || PENDINGUID}:`, err);
        }
    }

    private async handleConfirmedTransaction(txpowid: string, transaction: any, blockchainTimestamp?: number) {
        console.log(`✅ [TxPolling] Transaction confirmed: ${txpowid}`);
        const { PUBLICKEY, MESSAGE_TIMESTAMP, TYPE, METADATA } = transaction;

        // Update transaction status in database
        await minimaService.updateTransactionStatus(txpowid, 'confirmed');

        // Update message status to 'sent' and timestamp to blockchain confirmation time
        // Use blockchain timestamp if available, otherwise fall back to current time
        const confirmationTime = blockchainTimestamp || Date.now();
        console.log(`🕐 [TxPolling] Using confirmation timestamp: ${confirmationTime} (blockchain: ${!!blockchainTimestamp})`);
        await minimaService.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'sent', confirmationTime);

        // Parse metadata
        let metadata: any = {};
        try {
            metadata = JSON.parse(METADATA || '{}');
        } catch (e) {
            console.error('Error parsing metadata:', e);
        }

        // Send Maxima notification
        if (TYPE === 'charm') {
            const { charmId, amount, username } = metadata;
            console.log(`📤 [TxPolling] Sending charm message via Maxima...`);
            await minimaService.sendMessage(
                PUBLICKEY,
                username || 'Unknown',
                charmId,
                'charm',
                '',
                amount || 0,
                confirmationTime  // Use blockchain timestamp, not MESSAGE_TIMESTAMP
            );
        } else if (TYPE === 'token') {
            const { amount, tokenName, username } = metadata;
            const tokenData = JSON.stringify({ amount, tokenName });
            console.log(`📤 [TxPolling] Sending token message via Maxima...`);
            await minimaService.sendMessage(
                PUBLICKEY,
                username || 'Unknown',
                tokenData,
                'token',
                '',
                0,
                confirmationTime  // Use blockchain timestamp, not MESSAGE_TIMESTAMP
            );
        }

        // Notify subscribers
        this.notifyCallbacks(txpowid, 'confirmed', transaction);
    }

    private async handleRejectedTransaction(txpowid: string, transaction: any) {
        console.log(`❌ [TxPolling] Transaction rejected: ${txpowid}`);
        const { PUBLICKEY, MESSAGE_TIMESTAMP } = transaction;

        // Update transaction status in database
        await minimaService.updateTransactionStatus(txpowid, 'rejected');

        // Update message status to 'failed'
        await minimaService.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'failed');

        // Notify subscribers
        this.notifyCallbacks(txpowid, 'rejected', transaction);
    }

    // Removed checkPendingCommand and getPendingCommands as they rely on 'pending' command

    /**
     * Notify all subscribers of a status change
     */
    private notifyCallbacks(txpowid: string, status: 'confirmed' | 'rejected', transaction: any) {
        this.callbacks.forEach(callback => {
            try {
                callback(txpowid, status, transaction);
            } catch (err) {
                console.error('❌ [TxPolling] Error in callback:', err);
            }
        });
    }
}

// Export singleton instance
export const transactionPollingService = new TransactionPollingService();
