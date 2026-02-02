
import { messagingService } from "./messaging.service";
import { groupService, GroupMaximaMessage } from "./group.service";
import { runSQL } from "./database.service";



interface ChatMessageData {
    publickey: string; // Recipient
    senderName: string;
    message: string; // Hex encrypted or plain? Usually sendMessage takes plain.
    type: string;
    filedata: string;
    amount: number;
    timestamp: number;
    recipientName: string;
    targetApplication: string;
    txpowid?: string;
    overrideSeq?: number;
}

interface GroupMessageData {
    groupId: string;
    messageId?: number; // Optional, might not be needed if we rebuild payload
    targetPublicKey: string; // Member to send to
    payload: GroupMaximaMessage;
}

class OfflineQueueService {
    private isPolling = false;
    private pollingInterval: NodeJS.Timeout | null = null;
    private readonly POLL_INTERVAL = 30000; // 30 seconds

    constructor() { }

    async init() {
        await this.createTable();
        this.setupReconnectionListener();
        // this.start(); // Manual start required (AppContext)
    }

    private setupReconnectionListener() {
        // Listen for reconnection events from Service Worker
        window.addEventListener('message', (event) => {
            if (event.data?.type === 'RECONNECTED') {
                console.log('🔄 [QUEUE] Node reconnected, triggering immediate retry...');
                this.poll(); // Immediate retry on reconnection
            }
        });
        console.log('✅ [QUEUE] Reconnection listener registered');
    }

    private async createTable() {
        const sql = `
            CREATE TABLE IF NOT EXISTS OFFLINE_QUEUE (
                ID INT PRIMARY KEY AUTO_INCREMENT,
                TYPE VARCHAR(32),
                DATA CLOB,
                CREATED_AT BIGINT,
                RETRY_COUNT INT DEFAULT 0,
                STATE VARCHAR(16) DEFAULT 'pending'
            )
        `;
        try {
            await runSQL(sql);
            console.log("✅ [QUEUE] OFFLINE_QUEUE table ready.");
        } catch (err) {
            console.error("❌ [QUEUE] Failed to create table:", err);
        }
    }

    async start() {
        if (this.isPolling) return;
        this.isPolling = true;
        console.log("🔄 [QUEUE] Starting offline message queue polling (serialized)...");
        this.pollRecursive();
    }

    stop() {
        this.isPolling = false;
        if (this.pollingInterval) {
            clearTimeout(this.pollingInterval);
            this.pollingInterval = null;
        }
        console.log("⏹️ [QUEUE] Stopped polling.");
    }

    private async pollRecursive() {
        if (!this.isPolling) return;

        try {
            await this.poll();
        } catch (err) {
            console.error("❌ [QUEUE] Polling error:", err);
        } finally {
            if (this.isPolling) {
                this.pollingInterval = setTimeout(() => this.pollRecursive(), this.POLL_INTERVAL);
            }
        }
    }

    async queueChatMessage(data: ChatMessageData) {
        const json = JSON.stringify(data).replace(/'/g, "''");
        const sql = `
            INSERT INTO OFFLINE_QUEUE (TYPE, DATA, CREATED_AT, STATE)
            VALUES ('chat_message', '${json}', ${Date.now()}, 'pending')
        `;
        try {
            await runSQL(sql);
            console.log("📥 [QUEUE] Queued chat message for retry.");
        } catch (err) {
            console.error("❌ [QUEUE] Failed to queue chat message:", err);
        }
    }

    async queueGroupMessage(data: GroupMessageData) {
        const json = JSON.stringify(data).replace(/'/g, "''");
        const sql = `
            INSERT INTO OFFLINE_QUEUE (TYPE, DATA, CREATED_AT, STATE)
            VALUES ('group_message', '${json}', ${Date.now()}, 'pending')
        `;
        try {
            await runSQL(sql);
            console.log(`📥 [QUEUE] Queued group message for member ${data.targetPublicKey.substring(0, 10)}...`);
        } catch (err) {
            console.error("❌ [QUEUE] Failed to queue group message:", err);
        }
    }

    private async poll() {
        // Prevent concurrent polls
        if (!this.isPolling) return;

        // Fetch pending items
        const fetchSql = `SELECT * FROM OFFLINE_QUEUE WHERE STATE='pending' LIMIT 5`; // Process in small batches
        let rows: any[] = [];
        try {
            const res = await runSQL(fetchSql);
            rows = res.rows || [];
        } catch (err) {
            console.error("❌ [QUEUE] Failed to fetch queue:", err);
            return;
        }

        if (rows.length === 0) return;

        console.log(`🔄 [QUEUE] Processing ${rows.length} pending items...`);

        for (const row of rows) {
            await this.processItem(row);
        }
    }

    private async processItem(row: any) {
        const id = row.ID;
        const type = row.TYPE;
        let data: any;

        try {
            // Decode CLOB data if necessary (Minima sometimes returns URL-encoded CLOBs? Usually plain text for JSON)
            data = JSON.parse(decodeURIComponent(row.DATA)); // Just in case, but usually row.DATA is string
        } catch (e) {
            // Try raw parse
            try {
                data = JSON.parse(row.DATA);
            } catch (err) {
                console.error(`❌ [QUEUE] Corrupt data for ID ${id}, deleting.`, err);
                await this.deleteItem(id);
                return;
            }
        }

        console.log(`🔄 [QUEUE] Retrying item ${id} (${type})...`);

        try {
            if (type === 'chat_message') {
                const msgData = data as ChatMessageData;
                // Retry sending via messaging service
                // Use a special flag or method to avoid recursive queueing if it fails again is handled by "catch" below
                // actually messagingService.sendMessage will try to queue AGAIN if it fails.
                // We need `messagingService.retryMessage` that DOES NOT queue on failure, just throws.
                await messagingService.retryMessage(msgData);
            }
            else if (type === 'group_message') {
                const grpData = data as GroupMessageData;
                await groupService.retryGroupMessage(grpData.targetPublicKey, grpData.payload);
            }

            // Success!
            console.log(`✅ [QUEUE] Item ${id} sent successfully.`);
            await this.deleteItem(id);

        } catch (err) {
            console.warn(`⚠️ [QUEUE] Item ${id} failed retry:`, err);
            // Increment retry count? Or just leave as pending for next poll?
            // Currently just leave pending.
        }
    }

    private async deleteItem(id: number) {
        const sql = `DELETE FROM OFFLINE_QUEUE WHERE ID=${id}`;
        await runSQL(sql);
    }
}

export const offlineQueueService = new OfflineQueueService();
