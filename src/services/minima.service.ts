import { MDS } from "@minima-global/mds";
import { groupService } from "./group.service";

export interface ChatMessage {
    id?: number;
    roomname: string;
    publickey: string;
    username: string;
    type: string;
    message: string;
    filedata?: string;
    customid?: string;
    state?: string;
    read?: number;
    amount?: number;
    date?: number;
}

export interface IncomingMessageData {
    application: string;
    from: string;
    data: string; // JSON string
}

export interface IncomingMessagePayload {
    username: string;
    type: string;
    message: string;
    filedata?: string;
}

type MessageCallback = (msg: IncomingMessagePayload) => void;
type MuteStatusCallback = () => void;

class MinimaService {
    private newMessageCallbacks: MessageCallback[] = [];
    private muteStatusCallbacks: MuteStatusCallback[] = [];
    private archiveStatusCallbacks: (() => void)[] = [];
    private favoriteStatusCallbacks: (() => void)[] = [];
    private initialized = false;

    constructor() {
        // Singleton pattern could be used, or just export an instance
    }

    /* ----------------------------------------------------------------------------
      HEX <-> UTF8
    ---------------------------------------------------------------------------- */
    hexToUtf8(s: string): string {
        return decodeURIComponent(
            s.replace(/\s+/g, "").replace(/[0-9A-F]{2}/g, "%$&")
        );
    }

    utf8ToHex(s: string): string {
        const encoder = new TextEncoder();
        let r = "";
        for (const b of encoder.encode(s)) r += ("0" + b.toString(16)).slice(-2);
        return r;
    }

    /* ----------------------------------------------------------------------------
      DATABASE
    ---------------------------------------------------------------------------- */
    /**
     * Initialize the database tables
     */
    async initDB(): Promise<void> {
        return new Promise((resolve) => {
            const createMessagesTable = `
            CREATE TABLE IF NOT EXISTS CHAT_MESSAGES (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                roomname VARCHAR(255) NOT NULL,
                publickey VARCHAR(512) NOT NULL,
                username VARCHAR(255) NOT NULL,
                type VARCHAR(32) NOT NULL,
                message TEXT,
                filedata TEXT,
                state VARCHAR(32) DEFAULT 'delivered',
                amount DECIMAL(30,8) DEFAULT 0,
                date BIGINT NOT NULL
            )`;

            MDS.sql(createMessagesTable, (res: any) => {
                if (!res.status) {
                    console.error("❌ [DB] Failed to create CHAT_MESSAGES table:", res.error);
                } else {
                    console.log("✅ [DB] CHAT_MESSAGES table initialized");
                }
            });

            const createStatusTable = `
            CREATE TABLE IF NOT EXISTS CHAT_STATUS (
                publickey VARCHAR(512) PRIMARY KEY,
                last_read BIGINT DEFAULT 0,
                unread_count INT DEFAULT 0,
                app_installed BOOLEAN DEFAULT FALSE,
                archived BOOLEAN DEFAULT FALSE,
                archived_date BIGINT,
                last_opened BIGINT,
                muted BOOLEAN DEFAULT FALSE,
                favorite BOOLEAN DEFAULT FALSE
            )`;

            MDS.sql(createStatusTable, (res: any) => {
                if (!res.status) {
                    console.error("❌ [DB] Failed to create CHAT_STATUS table:", res.error);
                } else {
                    console.log("✅ [DB] CHAT_STATUS table initialized");
                    // Add columns if they don't exist (migration for existing databases)
                    const alterSql1 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS app_installed BOOLEAN DEFAULT FALSE";
                    const alterSql2 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE";
                    const alterSql3 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS archived_date BIGINT";
                    const alterSql4 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS last_opened BIGINT";
                    const alterSql5 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS muted BOOLEAN DEFAULT FALSE";
                    const alterSql6 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE";

                    MDS.sql(alterSql1, (alterRes: any) => {
                        if (alterRes.status) console.log("✅ [DB] app_installed column added/verified");
                    });
                    MDS.sql(alterSql2, (alterRes: any) => {
                        if (alterRes.status) console.log("✅ [DB] archived column added/verified");
                    });
                    MDS.sql(alterSql3, (alterRes: any) => {
                        if (alterRes.status) console.log("✅ [DB] archived_date column added/verified");
                    });
                    MDS.sql(alterSql4, (alterRes: any) => {
                        if (alterRes.status) console.log("✅ [DB] last_opened column added/verified");
                    });
                    MDS.sql(alterSql5, (alterRes: any) => {
                        if (alterRes.status) console.log("✅ [DB] muted column added/verified");
                    });
                    MDS.sql(alterSql6, (alterRes: any) => {
                        if (alterRes.status) console.log("✅ [DB] favorite column added/verified");
                    });
                }
            });

            // Create TRANSACTIONS table for tracking transaction status
            const createTransactionsTable = `
            CREATE TABLE IF NOT EXISTS TRANSACTIONS (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                txpowid VARCHAR(256) UNIQUE,
                type VARCHAR(32) NOT NULL,
                publickey VARCHAR(512) NOT NULL,
                message_timestamp BIGINT NOT NULL,
                status VARCHAR(32) NOT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                metadata TEXT,
                pendinguid VARCHAR(128)
            )`;

            MDS.sql(createTransactionsTable, (res: any) => {
                if (!res.status) {
                    console.error("❌ [DB] Failed to create TRANSACTIONS table:", res.error);
                    resolve();
                } else {
                    console.log("✅ [DB] TRANSACTIONS table initialized");

                    // Migration 1: Add pendinguid column if it doesn't exist
                    const alterSql1 = "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS pendinguid VARCHAR(128)";
                    MDS.sql(alterSql1, (alterRes: any) => {
                        if (!alterRes.status) {
                            // console.warn("⚠️ [DB] Could not add pendinguid column (may already exist):", alterRes.error);
                        } else {
                            console.log("✅ [DB] pendinguid column added/verified");
                        }

                        // Resolve after the most critical table is ready
                        // Create PROFILES table for local storage of extended profile data
                        const createProfilesTable = `
            CREATE TABLE IF NOT EXISTS PROFILES (
                pubkey VARCHAR(512) PRIMARY KEY,
                username VARCHAR(255),
                location VARCHAR(255),
                website VARCHAR(255),
                bio TEXT,
                last_seen BIGINT
            )`;

                        MDS.sql(createProfilesTable, (res: any) => {
                            if (!res.status) {
                                console.error("❌ [DB] Failed to create PROFILES table:", res.error);
                            } else {
                                console.log("✅ [DB] PROFILES table initialized");
                            }

                            // Create GROUPS table for group chat functionality
                            const createGroupsTable = `
            CREATE TABLE IF NOT EXISTS GROUPS (
                group_id VARCHAR(256) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                creator_publickey VARCHAR(512) NOT NULL,
                created_date BIGINT NOT NULL,
                avatar TEXT,
                description TEXT
            )`;

                            MDS.sql(createGroupsTable, (res: any) => {
                                if (!res.status) {
                                    console.error("❌ [DB] Failed to create GROUPS table:", res.error);
                                } else {
                                    console.log("✅ [DB] GROUPS table initialized");
                                }

                                // Create GROUP_MEMBERS table
                                const createGroupMembersTable = `
            CREATE TABLE IF NOT EXISTS GROUP_MEMBERS (
                group_id VARCHAR(256) NOT NULL,
                publickey VARCHAR(512) NOT NULL,
                username VARCHAR(255) NOT NULL,
                joined_date BIGINT NOT NULL,
                role VARCHAR(32) DEFAULT 'member',
                PRIMARY KEY (group_id, publickey)
            )`;

                                MDS.sql(createGroupMembersTable, (res: any) => {
                                    if (!res.status) {
                                        console.error("❌ [DB] Failed to create GROUP_MEMBERS table:", res.error);
                                    } else {
                                        console.log("✅ [DB] GROUP_MEMBERS table initialized");
                                    }

                                    // Create GROUP_MESSAGES table
                                    const createGroupMessagesTable = `
            CREATE TABLE IF NOT EXISTS GROUP_MESSAGES (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                group_id VARCHAR(256) NOT NULL,
                sender_publickey VARCHAR(512) NOT NULL,
                sender_username VARCHAR(255) NOT NULL,
                type VARCHAR(32) NOT NULL,
                message TEXT,
                filedata TEXT,
                date BIGINT NOT NULL,
                read INTEGER DEFAULT 0
            )`;

                                    MDS.sql(createGroupMessagesTable, (res: any) => {
                                        if (!res.status) {
                                            console.error("❌ [DB] Failed to create GROUP_MESSAGES table:", res.error);
                                        } else {
                                            console.log("✅ [DB] GROUP_MESSAGES table initialized");
                                        }
                                        resolve();
                                    });
                                });
                            });
                        });
                    });
                }
            });
        });
    }

    /* ----------------------------------------------------------------------------
      CHAT STATUS (Archive, Read, App Installed)
    ---------------------------------------------------------------------------- */
    archiveChat(publickey: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const sql = `
                MERGE INTO CHAT_STATUS (publickey, archived, archived_date)
                KEY (publickey)
                VALUES ('${publickey}', TRUE, ${Date.now()})
            `;
            console.log("📦 [SQL] Archiving chat:", publickey);
            MDS.sql(sql, (res: any) => {
                if (!res.status) {
                    console.error("❌ [SQL] Failed to archive chat:", res.error);
                    reject(new Error(res.error));
                } else {
                    console.log("✅ [SQL] Chat archived successfully");
                    this.notifyArchiveStatusChange();
                    resolve();
                }
            });
        });
    }

    unarchiveChat(publickey: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const sql = `UPDATE CHAT_STATUS SET archived=FALSE WHERE publickey='${publickey}'`;
            console.log("📂 [SQL] Unarchiving chat:", publickey);
            MDS.sql(sql, (res: any) => {
                if (!res.status) {
                    console.error("❌ [SQL] Failed to unarchive chat:", res.error);
                    reject(new Error(res.error));
                } else {
                    console.log("✅ [SQL] Chat unarchived successfully");
                    this.notifyArchiveStatusChange();
                    resolve();
                }
            });
        });
    }

    markChatAsOpened(publickey: string): Promise<void> {
        return new Promise((resolve) => {
            const sql = `
                MERGE INTO CHAT_STATUS (publickey, last_opened)
                KEY (publickey)
                VALUES ('${publickey}', ${Date.now()})
            `;
            console.log("👁️ [SQL] Marking chat as opened:", publickey);
            MDS.sql(sql, (res: any) => {
                if (!res.status) {
                    console.error("❌ [SQL] Failed to mark chat as opened:", res.error);
                    // Don't reject, just log error to avoid breaking UI flow
                    resolve();
                } else {
                    console.log("✅ [SQL] Chat marked as opened");
                    resolve();
                }
            });
        });
    }

    setAppInstalled(publickey: string): Promise<void> {
        return new Promise((resolve) => {
            // Use MERGE to update or insert
            const sql = `
                MERGE INTO CHAT_STATUS (publickey, app_installed)
                KEY (publickey)
                VALUES ('${publickey}', TRUE)
            `;
            MDS.sql(sql, (res: any) => {
                if (res.status) {
                    console.log("✅ [DB] App installed status saved for", publickey);
                } else {
                    console.error("❌ [DB] Failed to save app installed status:", res.error);
                }
                resolve();
            });
        });
    }

    isAppInstalled(publickey: string): Promise<boolean> {
        return new Promise((resolve) => {
            const sql = `SELECT app_installed FROM CHAT_STATUS WHERE publickey='${publickey}'`;
            MDS.sql(sql, (res: any) => {
                if (res.status && res.rows && res.rows.length > 0) {
                    const val = res.rows[0].APP_INSTALLED;
                    resolve(val === true || val === 'TRUE' || val === 1);
                } else {
                    resolve(false);
                }
            });
        });
    }

    muteContact(publickey: string): Promise<void> {
        return new Promise((resolve) => {
            const sql = `
                MERGE INTO CHAT_STATUS (publickey, muted)
                KEY (publickey)
                VALUES ('${publickey}', TRUE)
            `;
            MDS.sql(sql, (res: any) => {
                if (res.status) {
                    console.log("✅ [DB] Contact muted:", publickey);
                    this.notifyMuteStatusChange();
                } else {
                    console.error("❌ [DB] Failed to mute contact:", res.error);
                }
                resolve();
            });
        });
    }

    unmuteContact(publickey: string): Promise<void> {
        return new Promise((resolve) => {
            const sql = `UPDATE CHAT_STATUS SET muted=FALSE WHERE publickey='${publickey}'`;
            MDS.sql(sql, (res: any) => {
                if (res.status) {
                    console.log("✅ [DB] Contact unmuted:", publickey);
                    this.notifyMuteStatusChange();
                } else {
                    console.error("❌ [DB] Failed to unmute contact:", res.error);
                }
                resolve();
            });
        });
    }

    isContactMuted(publickey: string): Promise<boolean> {
        return new Promise((resolve) => {
            const sql = `SELECT muted FROM CHAT_STATUS WHERE publickey='${publickey}'`;
            MDS.sql(sql, (res: any) => {
                if (res.status && res.rows && res.rows.length > 0) {
                    const val = res.rows[0].MUTED;
                    const isMuted = val === true || val === 'TRUE' || val === 'true' || val === 1;
                    resolve(isMuted);
                } else {
                    resolve(false);
                }
            });
        });
    }

    markChatAsFavorite(publickey: string): Promise<void> {
        return new Promise((resolve) => {
            const sql = `
                MERGE INTO CHAT_STATUS (publickey, favorite)
                KEY (publickey)
                VALUES ('${publickey}', TRUE)
            `;
            MDS.sql(sql, (res: any) => {
                if (res.status) {
                    console.log("⭐ [DB] Chat marked as favorite:", publickey);
                    this.notifyFavoriteStatusChange();
                } else {
                    console.error("❌ [DB] Failed to mark chat as favorite:", res.error);
                }
                resolve();
            });
        });
    }

    unmarkChatAsFavorite(publickey: string): Promise<void> {
        return new Promise((resolve) => {
            const sql = `UPDATE CHAT_STATUS SET favorite=FALSE WHERE publickey='${publickey}'`;
            MDS.sql(sql, (res: any) => {
                if (res.status) {
                    console.log("☆ [DB] Chat unmarked as favorite:", publickey);
                    this.notifyFavoriteStatusChange();
                } else {
                    console.error("❌ [DB] Failed to unmark chat as favorite:", res.error);
                }
                resolve();
            });
        });
    }

    isChatFavorite(publickey: string): Promise<boolean> {
        return new Promise((resolve) => {
            const sql = `SELECT favorite FROM CHAT_STATUS WHERE publickey='${publickey}'`;
            MDS.sql(sql, (res: any) => {
                if (res.status && res.rows && res.rows.length > 0) {
                    const val = res.rows[0].FAVORITE;
                    const isFavorite = val === true || val === 'TRUE' || val === 'true' || val === 1;
                    resolve(isFavorite);
                } else {
                    resolve(false);
                }
            });
        });
    }

    getChatStatus(publickey: string): Promise<{ archived: boolean; lastOpened: number | null; favorite: boolean }> {
        return new Promise((resolve) => {
            const sql = `SELECT * FROM CHAT_STATUS WHERE publickey='${publickey}'`;
            MDS.sql(sql, (res: any) => {
                if (!res.status || !res.rows || res.rows.length === 0) {
                    resolve({ archived: false, lastOpened: null, favorite: false });
                    return;
                }
                const row = res.rows[0];
                resolve({
                    archived: row.ARCHIVED === true || row.ARCHIVED === 'TRUE' || row.ARCHIVED === 'true' || row.ARCHIVED === 1,
                    lastOpened: row.LAST_OPENED ? Number(row.LAST_OPENED) : null,
                    favorite: row.FAVORITE === true || row.FAVORITE === 'TRUE' || row.FAVORITE === 'true' || row.FAVORITE === 1 || false
                });
            });
        });
    }

    async insertMessage(msg: ChatMessage & { date?: number }) {
        const { roomname, publickey, username, type, message, filedata = "", state = "", amount = 0, date } = msg;
        const encodedMsg = encodeURIComponent(message).replace(/'/g, "%27");
        const timestamp = date || Date.now();
        const sql = `
      INSERT INTO CHAT_MESSAGES (roomname,publickey,username,type,message,filedata,state,amount,date)
      VALUES ('${roomname}','${publickey}','${username}','${type}','${encodedMsg}','${filedata}','${state}',${amount},${timestamp})
    `;
        console.log("💾 [SQL] Executing INSERT:", sql);
        try {
            await this.runSQL(sql);
            console.log("💾 [SQL] INSERT successful");
        } catch (err) {
            console.error("❌ [SQL] INSERT failed:", err);
        }
    }

    getMessages(publickey: string): Promise<ChatMessage[]> {
        return new Promise((resolve) => {
            const sql = `
        SELECT * FROM CHAT_MESSAGES
        WHERE publickey='${publickey}'
        ORDER BY date ASC
      `;
            console.log("💾 [SQL] Executing SELECT:", sql);
            MDS.sql(sql, (res: any) => {
                console.log("💾 [SQL] SELECT result:", res);
                if (!res.status || !res.rows) {
                    resolve([]);
                    return;
                }
                resolve(res.rows);
            });
        });
    }

    deleteAllMessages(publickey: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM CHAT_MESSAGES WHERE publickey='${publickey}'`;
            console.log("🗑️ [SQL] Deleting all messages for:", publickey);
            MDS.sql(sql, (res: any) => {
                if (!res.status) {
                    console.error("❌ [SQL] Failed to delete messages:", res.error);
                    reject(new Error(res.error));
                } else {
                    console.log("✅ [SQL] All messages deleted successfully");
                    resolve();
                }
            });
        });
    }

    getRecentChats(): Promise<any[]> {
        return new Promise((resolve) => {
            // Get all messages with their chat status
            const sql = `
                SELECT 
                    m.*,
                    s.archived,
                    s.last_opened,
                    s.favorite
                FROM CHAT_MESSAGES m
                LEFT JOIN CHAT_STATUS s ON m.publickey = s.publickey
                ORDER BY m.date DESC
            `;

            console.log("💾 [SQL] Executing getRecentChats with status");
            MDS.sql(sql, (res: any) => {
                // If the query fails (e.g. CHAT_STATUS table doesn't exist yet), fallback to simple query
                if (!res.status) {
                    console.warn("⚠️ [SQL] Complex query failed, falling back to simple query:", res.error);
                    const simpleSql = `SELECT * FROM CHAT_MESSAGES ORDER BY date DESC`;
                    MDS.sql(simpleSql, (simpleRes: any) => {
                        if (!simpleRes.status || !simpleRes.rows) {
                            resolve([]);
                            return;
                        }
                        this.processChatRows(simpleRes.rows, resolve);
                    });
                    return;
                }

                if (!res.rows) {
                    resolve([]);
                    return;
                }

                this.processChatRows(res.rows, resolve);
            });
        });
    }

    private processChatRows(rows: any[], resolve: (value: any[]) => void) {
        // Group by publickey manually and keep only the most recent message
        const chatMap = new Map<string, any>();

        rows.forEach((row: any) => {
            const publickey = row.PUBLICKEY;

            // If we haven't seen this publickey yet, or this message is newer
            if (!chatMap.has(publickey)) {
                chatMap.set(publickey, {
                    publickey: row.PUBLICKEY,
                    roomname: row.ROOMNAME,
                    lastMessage: row.MESSAGE,
                    lastMessageType: row.TYPE,
                    lastMessageDate: Number(row.DATE),
                    lastMessageAmount: row.AMOUNT,
                    username: row.USERNAME,
                    archived: row.ARCHIVED === true || row.ARCHIVED === 'TRUE' || row.ARCHIVED === 'true' || row.ARCHIVED === 1 || false,
                    lastOpened: row.LAST_OPENED ? Number(row.LAST_OPENED) : null,
                    favorite: row.FAVORITE === true || row.FAVORITE === 'TRUE' || row.FAVORITE === 'true' || row.FAVORITE === 1 || false,
                    unreadCount: 0 // Initialize unread counter
                });
            }
        });

        // Count unread messages for each chat
        rows.forEach((row: any) => {
            const publickey = row.PUBLICKEY;
            const chat = chatMap.get(publickey);

            if (chat) {
                const messageDate = Number(row.DATE);
                const lastOpened = chat.lastOpened;
                const isFromMe = row.USERNAME === "Me";

                // Count messages that are:
                // 1. Not sent by me
                // 2. Received after the chat was last opened (or never opened)
                if (!isFromMe && (!lastOpened || messageDate > lastOpened)) {
                    chat.unreadCount++;
                }
            }
        });

        // Convert map to array and sort: favorites first, then active chats, then archived
        const chats = Array.from(chatMap.values()).sort((a, b) => {
            // Archived chats go to the bottom
            if (a.archived !== b.archived) {
                return a.archived ? 1 : -1;
            }
            // Within active chats, favorites come first
            if (!a.archived && !b.archived && a.favorite !== b.favorite) {
                return a.favorite ? -1 : 1;
            }
            // Within same category (favorite/non-favorite), sort by date
            return b.lastMessageDate - a.lastMessageDate;
        });

        console.log("💾 [SQL] Processed chats with status:", chats);
        resolve(chats);
    }


    /* ----------------------------------------------------------------------------
      INCOMING MESSAGES
    ---------------------------------------------------------------------------- */
    onNewMessage(cb: MessageCallback) {
        this.newMessageCallbacks.push(cb);
    }

    removeNewMessageCallback(cb: MessageCallback) {
        const index = this.newMessageCallbacks.indexOf(cb);
        if (index > -1) {
            this.newMessageCallbacks.splice(index, 1);
        }
    }

    /* ----------------------------------------------------------------------------
       MUTE STATUS CALLBACKS
    ---------------------------------------------------------------------------- */
    onMuteStatusChange(cb: () => void) {
        this.muteStatusCallbacks.push(cb);
    }

    removeMuteStatusCallback(cb: () => void) {
        const index = this.muteStatusCallbacks.indexOf(cb);
        if (index > -1) {
            this.muteStatusCallbacks.splice(index, 1);
        }
    }

    private notifyMuteStatusChange() {
        this.muteStatusCallbacks.forEach(cb => cb());
    }

    /* ----------------------------------------------------------------------------
       ARCHIVE STATUS CALLBACKS
    ---------------------------------------------------------------------------- */
    onArchiveStatusChange(cb: () => void) {
        this.archiveStatusCallbacks.push(cb);
    }

    removeArchiveStatusCallback(cb: () => void) {
        const index = this.archiveStatusCallbacks.indexOf(cb);
        if (index > -1) {
            this.archiveStatusCallbacks.splice(index, 1);
        }
    }

    private notifyArchiveStatusChange() {
        this.archiveStatusCallbacks.forEach(cb => cb());
    }

    /* ----------------------------------------------------------------------------
       FAVORITE STATUS CALLBACKS
    ---------------------------------------------------------------------------- */
    onFavoriteStatusChange(cb: () => void) {
        this.favoriteStatusCallbacks.push(cb);
    }

    removeFavoriteStatusCallback(cb: () => void) {
        const index = this.favoriteStatusCallbacks.indexOf(cb);
        if (index > -1) {
            this.favoriteStatusCallbacks.splice(index, 1);
        }
    }

    private notifyFavoriteStatusChange() {
        this.favoriteStatusCallbacks.forEach(cb => cb());
    }

    /**
     * Handle NEWBALANCE event - a transaction has been confirmed
     */
    async handleNewBalance() {
        try {
            console.log('💰 [NEWBALANCE] Balance changed - checking for confirmed transactions...');

            // Instead of trying to find the specific transaction that triggered this (which is flaky with txpowlist),
            // we simply run the cleanup logic which checks ALL pending transactions against the blockchain history.
            // This is more robust and handles both "app closed" and "live update" scenarios uniformly.
            await this.cleanupOrphanedPendingTransactions();

        } catch (err) {
            console.error('❌ [NEWBALANCE] Error handling balance change:', err);
        }
    }

    /**
     * Find pending transaction by stateId (MESSAGE_TIMESTAMP)
     */
    async findPendingTransactionByStateId(stateId: string): Promise<any | null> {
        const sql = `
            SELECT * FROM TRANSACTIONS 
            WHERE status='pending' 
            AND message_timestamp=${stateId}
            LIMIT 1
        `;

        try {
            const res = await this.runSQL(sql);
            return res.rows && res.rows.length > 0 ? res.rows[0] : null;
        } catch (err) {
            console.error(`❌ [TX] Failed to find pending transaction by stateId:`, err);
            return null;
        }
    }

    processIncomingMessage(event: any) {
        if (!event.data) {
            console.warn("⚠️ [MAXIMA] Event has no data:", event);
            return;
        }

        const maximaData = event.data;

        // Log ALL Maxima events to see what's arriving
        console.log("📨 [MAXIMA] Event received:", {
            from: maximaData.from,
            application: maximaData.application,
            data: maximaData.data
        });

        if (!maximaData.application) {
            console.warn("⚠️ [MAXIMA] No application specified");
            return;
        }

        // Check if the message is for our application (case-insensitive)
        const app = maximaData.application.toLowerCase();
        if (app === "metachain" || app === "metachain-group") {
            const from = maximaData.from;
            let datastr = maximaData.data;

            // Check if data is in hex format (starts with 0x)
            if (typeof datastr === 'string' && datastr.startsWith('0x')) {
                console.log("🔄 [MAXIMA] Converting hex data to UTF8");
                datastr = this.hexToUtf8(datastr.substring(2)); // Remove 0x prefix
                console.log("📝 [MAXIMA] Converted data:", datastr);
            }

            try {
                const json = JSON.parse(datastr) as any;

                // Check if this is a group message (by app name OR content)
                if (app === "metachain-group" || (json.messageType && json.groupId)) {
                    console.log("👥 [MAXIMA] Group message detected:", json.messageType);
                    // Import dynamically to avoid circular dependency
                    // Replaced with static import
                    // import('./group.service').then(({ groupService }) => {
                    //    groupService.handleIncomingGroupMessage(json, from);
                    // });
                    // Static call now that circular dependency is resolved via utils/hex.ts
                    groupService.handleIncomingGroupMessage(json, from);



                    return;
                }

                if (json.type === "read") {
                    console.log("📖 [MAXIMA] Read receipt received from", from);
                    // DB update is handled by Service Worker
                    // Notify listeners to refresh UI
                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'read_receipt' }));
                    return;
                }

                if (json.type === "delivery_receipt") {
                    console.log("📬 [MAXIMA] Delivery receipt received from", from);
                    // DB update is handled by Service Worker
                    // Notify listeners to refresh UI
                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'delivery_receipt' }));
                    return;
                }

                if (json.type === "ping") {
                    console.log("📡 [MAXIMA] Ping received from", from, "- sending Pong");
                    // Send Pong response
                    this.sendPong(from).catch(err => console.error("❌ [MetaChain] Failed to send Pong:", err));
                    // Notify listeners (optional, but good for debugging)
                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'ping' }));
                    return;
                }

                if (json.type === "pong") {
                    console.log("📡 [MAXIMA] Pong received from", from);
                    // Notify listeners so UI can update app status
                    // Include 'from' so Discovery page can identify which profile responded
                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'pong', from } as any));
                    return;
                }

                // Normal message
                console.log("✅ [MetaChain] Missatge rebut (guardat per Service Worker):", json.message);

                // DB insertion and Delivery Receipt are handled by Service Worker
                // We only need to notify the UI

                // Notify UI to refresh
                this.newMessageCallbacks.forEach((cb) => cb(json));
            } catch (err) {
                console.error("❌ [MetaChain] Error processant missatge:", err);
                console.error("❌ [MetaChain] Data rebuda:", datastr);
            }
        } else {
            console.log(`ℹ️ [MAXIMA] Message from application "${maximaData.application}" (not MetaChain)`);
        }
    }

    /* ----------------------------------------------------------------------------
      SENDING MESSAGES
    ---------------------------------------------------------------------------- */
    async sendMessage(
        toPublicKey: string,
        username: string,
        message: string,
        type: string = "text",
        filedata: string = "",
        amount: number = 0,
        existingTimestamp?: number  // If provided, we're updating an existing pending message
    ) {
        try {
            // Determine the timestamp to use
            const messageTimestamp = existingTimestamp || Date.now();

            // Create payload with message data only (application is specified in Maxima params)
            const payload: any = {
                message,
                type,
                username,
                filedata,
                timestamp: messageTimestamp  // Include timestamp so recipient uses sender's time
            };

            // Include amount for charm messages
            if (type === "charm" && amount > 0) {
                payload.amount = amount;
            }

            // Convert to HEX manually to match MaxSolo behavior
            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            console.log("📤 [MetaChain] Sending message to:", toPublicKey, payload);
            console.log("🔢 [MetaChain] Hex data:", hexData);

            const response = await MDS.cmd.maxima({
                params: {
                    action: "send",
                    publickey: toPublicKey, // Use publickey for 0x... keys
                    application: "metachain", // Lowercase to match package.json
                    data: hexData,
                    poll: false,  // Send immediately instead of queuing
                } as any,
            });

            console.log("📡 [MDS] Full Maxima send response:", response);

            // Check if it's a pending command (Read Mode)
            const isPending = response && ((response as any).status === false) && (
                (response as any).pending ||
                ((response as any).error && (response as any).error.toString().toLowerCase().includes("pending"))
            );

            if (response && (response as any).status === false && !isPending) {
                console.error("❌ [MDS] Maxima send failed:", (response as any).error || response);
                throw new Error((response as any).error || "Maxima send failed");
            }

            if (isPending) {
                console.warn("⚠️ [MDS] Command is pending approval (Read Mode). Saving with 'pending' state.");
            } else {
                console.log("✅ [MetaChain] Message sent successfully");
            }

            // Only insert a new message if we're not updating an existing one
            if (!existingTimestamp) {
                this.insertMessage({
                    roomname: username,
                    publickey: toPublicKey,
                    username: "Me", // Set to "Me" so we know it's sent by us
                    type,
                    message,
                    filedata,
                    state: isPending ? "pending" : "sent", // Use 'pending' if command is pending
                    amount, // Include amount for charm messages
                });
            } else {
                console.log(`ℹ️ [MetaChain] Skipping message insertion - updating existing message with timestamp ${existingTimestamp}`);
            }

            return response;
        } catch (err) {
            console.error("❌ [MetaChain] Error enviant missatge:", err);
            throw err;
        }
    }

    async updateMessageState(publickey: string, timestamp: number, state: string, newTimestamp?: number) {
        console.log(`🔄 [updateMessageState] CALLED: publickey=${publickey.substring(0, 10)}..., timestamp=${timestamp}, newState="${state}", newTimestamp=${newTimestamp}`);

        // DEBUG: Check if the message exists with the given timestamp
        const checkSql = `SELECT * FROM CHAT_MESSAGES WHERE publickey='${publickey}' AND date=${timestamp}`;
        this.runSQL(checkSql).then(res => {
            console.log(`🔍 [updateMessageState] Check before update: Found ${res.rows ? res.rows.length : 0} rows for timestamp ${timestamp}`);
            if (res.rows && res.rows.length > 0) {
                console.log(`   -> Row data: ID=${res.rows[0].ID}, STATE=${res.rows[0].STATE}, DATE=${res.rows[0].DATE}`);
            } else {
                console.warn(`⚠️ [updateMessageState] NO ROW FOUND for timestamp ${timestamp}! Update will fail to match.`);
            }
        });

        let setClause = `state='${state}'`;
        if (newTimestamp) {
            // Remove quotes for numeric date field
            setClause += `, date=${newTimestamp}`;
        }

        // Remove quotes for numeric date field in WHERE clause
        const sql = `
            UPDATE CHAT_MESSAGES
            SET ${setClause}
            WHERE publickey='${publickey}' AND date=${timestamp}
        `;

        console.log(`💾 [SQL] Updating message state to '${state}'${newTimestamp ? ` and date to ${newTimestamp}` : ''} for timestamp ${timestamp}`);

        try {
            const result = await this.runSQL(sql);
            console.log(`✅[SQL] Message state updated. Result:`, JSON.stringify(result));
            return result;
        } catch (err) {
            console.error("❌ [SQL] Error updating message state:", err);
            throw err;
        }
    }

    /* ----------------------------------------------------------------------------
       SEND INVITATION VIA MAXSOLO
    ---------------------------------------------------------------------------- */
    async sendInvitation(publickey: string, senderName: string): Promise<void> {
        const inviteMessage = `${senderName} wants to connect with you on MetaChain!

MetaChain is a secure messaging Dapp on Minima where you can send messages, charms, and tokens.

Install it from the MiniDapp Store to start chatting!`;

        // Create a JSON object that MaxSolo expects
        const payload = {
            username: senderName,
            type: "text",
            message: inviteMessage,
            filedata: ""
        };

        // Convert JSON to string, then to HEX
        const jsonStr = JSON.stringify(payload);
        const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

        console.log("📤 [Invitation] Sending invitation to:", publickey);
        console.log("📝 [Invitation] Message Payload:", payload);

        try {
            const response = await MDS.cmd.maxima({
                params: {
                    action: "send",
                    publickey: publickey,
                    application: "maxsolo", // Send to MaxSolo instead of MetaChain
                    data: hexData,
                    poll: false,
                } as any,
            });

            console.log("📡 [Invitation] Response:", response);

            if (response && (response as any).status === false) {
                throw new Error((response as any).error || "Failed to send invitation");
            }

            console.log("✅ [Invitation] Invitation sent successfully via MaxSolo");
        } catch (err) {
            console.error("❌ [Invitation] Error sending invitation:", err);
            throw err;
        }
    }

    /* ----------------------------------------------------------------------------
       SQL HELPER (Promise wrapper)
    ---------------------------------------------------------------------------- */
    runSQL(sql: string): Promise<any> {
        return new Promise((resolve, reject) => {
            MDS.sql(sql, (res: any) => {
                if (res.status) {
                    resolve(res);
                } else {
                    console.error(`❌ [SQL Error] ${sql} ->`, res.error);
                    reject(res.error);
                }
            });
        });
    }

    /* ----------------------------------------------------------------------------
       TRANSACTION TRACKING
    ---------------------------------------------------------------------------- */
    async insertTransaction(
        txpowid: string | null,
        type: 'charm' | 'token',
        publickey: string,
        messageTimestamp: number,
        metadata: any = {},
        pendinguid: string | null = null
    ): Promise<void> {
        const now = Date.now();
        const metadataStr = JSON.stringify(metadata).replace(/'/g, "''"); // Escape single quotes

        // We need at least txpowid OR pendinguid
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
            await this.runSQL(sql);
            console.log(`✅ [TX] Transaction inserted: ${txpowid}`);
        } catch (err) {
            console.error(`❌ [TX] Failed to insert transaction:`, err);
            throw err;
        }
    }

    async updateTransactionStatus(txpowid: string, status: 'pending' | 'confirmed' | 'rejected'): Promise<void> {
        const now = Date.now();
        const sql = `
            UPDATE TRANSACTIONS
            SET status='${status}', updated_at=${now}
            WHERE txpowid='${txpowid}'
        `;

        console.log(`🔄 [TX] Updating transaction ${txpowid} to ${status}`);

        try {
            await this.runSQL(sql);
            console.log(`✅ [TX] Transaction status updated: ${txpowid} -> ${status}`);
        } catch (err) {
            console.error(`❌ [TX] Failed to update transaction status:`, err);
            throw err;
        }
    }

    /**
     * Cleanup orphaned pending transactions (manual trigger)
     * Call this to remove pending transactions that are no longer in node's pending list
     */
    async cleanupOrphanedPendingTransactions(): Promise<void> {
        console.log('🧹 [Cleanup] Starting manual cleanup of orphaned transactions...');

        // Get all pending transactions from DB
        // Get all pending transactions from DB
        const sql = "SELECT * FROM TRANSACTIONS WHERE status='pending'";
        const result = await this.runSQL(sql);
        const pendingDbTxs = result.rows || [];

        if (pendingDbTxs.length === 0) {
            console.log('✅ [Cleanup] No pending transactions found in DB (proceeding to check for stuck messages)');
        } else {
            console.log(`🔍 [Cleanup] Found ${pendingDbTxs.length} pending transactions in DB`);
        }

        // Get confirmed transaction history from blockchain
        const confirmedTxs = await this.getMyTransactionHistory();
        console.log(`🔍 [Cleanup] Found ${confirmedTxs.size} confirmed MetaChain transactions in blockchain`);

        // Get pending transactions from mempool
        const pendingTxs = await this.getMyPendingTransactions();
        console.log(`🔍 [Cleanup] Found ${pendingTxs.size} pending MetaChain transactions in mempool`);

        let cleanedCount = 0;

        // Check each DB transaction
        for (const tx of pendingDbTxs) {
            const { MESSAGE_TIMESTAMP, TXPOWID, PENDINGUID, PUBLICKEY, CREATED_AT } = tx;

            // Check if this transaction is in the blockchain (confirmed)
            const confirmedTxData = confirmedTxs.get(MESSAGE_TIMESTAMP.toString());

            if (confirmedTxData) {
                const { txpowid: confirmedTxpowid, timestamp: confirmedTimestamp } = confirmedTxData;

                // Transaction is confirmed in blockchain!
                console.log(`✅ [Cleanup] Transaction ${MESSAGE_TIMESTAMP} confirmed as ${confirmedTxpowid} at ${confirmedTimestamp}`);

                // Update txpowid if we only had pendinguid
                if (!TXPOWID || TXPOWID === 'null') {
                    await this.updateTransactionTxpowid(PENDINGUID, confirmedTxpowid);
                }

                // Mark as confirmed
                await this.updateTransactionStatus(confirmedTxpowid, 'confirmed');

                // Update message state to 'sent' AND update timestamp to blockchain confirmation time
                await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'sent', confirmedTimestamp);

                // Send Maxima notification (in case it wasn't sent yet)
                const { TYPE, METADATA } = tx;
                let metadata: any = {};
                try {
                    metadata = JSON.parse(METADATA || '{}');
                } catch (e) {
                    console.error('Error parsing metadata:', e);
                }

                if (TYPE === 'charm') {
                    const { charmId, amount, username } = metadata;
                    console.log(`📤 [Cleanup] Sending charm message via Maxima...`);
                    await this.sendMessage(
                        PUBLICKEY,
                        username || 'Unknown',
                        charmId,
                        'charm',
                        '',
                        amount || 0,
                        confirmedTimestamp  // Use blockchain timestamp, not MESSAGE_TIMESTAMP
                    );
                } else if (TYPE === 'token') {
                    const { amount, tokenName, username } = metadata;
                    const tokenData = JSON.stringify({ amount, tokenName });
                    console.log(`📤 [Cleanup] Sending token message via Maxima...`);
                    await this.sendMessage(
                        PUBLICKEY,
                        username || 'Unknown',
                        tokenData,
                        'token',
                        '',
                        0,
                        confirmedTimestamp  // Use blockchain timestamp, not MESSAGE_TIMESTAMP
                    );
                }

                cleanedCount++;
                continue;
            }

            // Check if this transaction is pending in mempool
            const pendingTxpowid = pendingTxs.get(MESSAGE_TIMESTAMP.toString());

            if (pendingTxpowid) {
                // Transaction is pending in mempool (mining)
                console.log(`⏳ [Cleanup] Transaction ${MESSAGE_TIMESTAMP} is pending in mempool as ${pendingTxpowid}`);

                // Update txpowid if we only had pendinguid
                if (!TXPOWID || TXPOWID === 'null') {
                    await this.updateTransactionTxpowid(PENDINGUID, pendingTxpowid);
                }

                continue; // Keep as pending
            }

            // Not in blockchain and not in mempool - determine if failed or still waiting for approval
            const age = Date.now() - CREATED_AT;
            const ageMinutes = Math.floor(age / (1000 * 60));

            // For transactions with PENDINGUID (waiting for user approval)
            // Check if still pending in MDS - if not, it was accepted or denied while app was closed
            if (PENDINGUID && (!TXPOWID || TXPOWID === 'null')) {
                // Check if this specific UID is still pending using checkpending (doesn't create pending)
                const isStillPending = await this.checkPendingUID(PENDINGUID);

                if (isStillPending) {
                    console.log(`⏳ [Cleanup] Transaction ${MESSAGE_TIMESTAMP} still pending approval (PENDINGUID: ${PENDINGUID})`);
                    // Still waiting for user approval - leave as pending
                    continue;
                } else {
                    // PENDINGUID exists but not in MDS pending list
                    // This could mean:
                    // 1. Transaction was accepted and is now in blockchain
                    // 2. Transaction was accepted and is in mempool (not yet in blockchain)
                    // 3. Transaction was denied/cancelled
                    // 4. checkpending failed to detect it (unreliable in some cases)

                    // Check if it was accepted by looking in confirmed transactions
                    const wasAccepted = confirmedTxs.has(MESSAGE_TIMESTAMP.toString());

                    // Check if it's in the mempool (approved but not yet confirmed)
                    const isInMempool = pendingTxs.has(MESSAGE_TIMESTAMP.toString());

                    if (wasAccepted) {
                        console.log(`✅ [Cleanup] Transaction ${MESSAGE_TIMESTAMP} was accepted and confirmed while app was closed`);
                        await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'sent');
                        cleanedCount++;
                    } else if (isInMempool) {
                        console.log(`⏳ [Cleanup] Transaction ${MESSAGE_TIMESTAMP} is in mempool (approved, waiting for confirmation)`);
                        // Transaction was approved and is waiting to be added to blockchain
                        // Update to 'sent' state since it's been approved
                        await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'sent');
                        cleanedCount++;
                    } else {
                        // Not in blockchain and not in mempool
                        // CONSERVATIVE APPROACH: Leave as pending instead of marking as failed
                        // Only MDS_PENDING event can reliably tell us if it was denied
                        console.log(`⚠️ [Cleanup] Transaction ${MESSAGE_TIMESTAMP} not found in blockchain or mempool - keeping as pending (will be updated by MDS_PENDING event if denied)`);
                        // Don't change state - leave as pending
                    }
                    continue;
                }
            }
            // For transactions with TXPOWID (already approved, check directly)
            else if (TXPOWID && TXPOWID !== 'null') {
                // Use direct lookup for efficiency
                const txStatus = await this.checkTransactionByTxpowid(TXPOWID);

                if (txStatus === 'confirmed') {
                    console.log(`✅ [Cleanup] Transaction ${TXPOWID} confirmed via direct lookup`);
                    await this.updateTransactionStatus(TXPOWID, 'confirmed');
                    await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'sent');
                    cleanedCount++;
                } else if (txStatus === 'pending') {
                    console.log(`⏳ [Cleanup] Transaction ${TXPOWID} still pending in mempool`);
                    // Keep as pending
                } else {
                    // not_found - give it grace period before marking as failed
                    if (age > 10 * 60 * 1000) {
                        console.log(`🗑️ [Cleanup] Transaction ${TXPOWID} not found after ${ageMinutes}m - marking as failed`);
                        await this.updateTransactionStatus(TXPOWID, 'rejected');
                        await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'failed');
                        cleanedCount++;
                    } else {
                        console.log(`⏳ [Cleanup] Transaction ${TXPOWID} propagating (${ageMinutes}m)...`);
                    }
                }
            }
            // Transactions without PENDINGUID or TXPOWID are orphans - clean immediately
            else {
                console.log(`🗑️ [Cleanup] Orphan transaction ${MESSAGE_TIMESTAMP} with no tracking ID - marking as failed`);
                await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'failed');
                cleanedCount++;
            }
        }

        console.log(`✅ [Cleanup] Processed ${cleanedCount} orphaned transactions from DB`);

        // -------------------------------------------------------------------------
        // SAFETY NET: Check for stuck messages in CHAT_MESSAGES
        // (zombies with no transaction record, likely from before the token fix)
        // -------------------------------------------------------------------------
        const stuckMessagesSql = "SELECT * FROM CHAT_MESSAGES WHERE state='pending'";
        const stuckMessages = await this.runSQL(stuckMessagesSql);

        if (stuckMessages.rows && stuckMessages.rows.length > 0) {
            console.log(`🧹 [Cleanup] Checking ${stuckMessages.rows.length} pending messages in CHAT_MESSAGES for zombies...`);

            for (const msg of stuckMessages.rows) {
                // Check if tracked in TRANSACTIONS
                const isTrackedSql = `SELECT * FROM TRANSACTIONS WHERE message_timestamp=${msg.DATE}`;
                const tracked = await this.runSQL(isTrackedSql);

                if (tracked.rows.length === 0) {
                    console.log(`⚠️ [Cleanup] Found untracked pending message: ${msg.DATE} (Amount: ${msg.AMOUNT})`);

                    // Check blockchain history using the message timestamp
                    const confirmedTxpowid = confirmedTxs.get(msg.DATE.toString());

                    if (confirmedTxpowid) {
                        console.log(`✅ [Cleanup] Recovered untracked transaction ${msg.DATE} -> ${confirmedTxpowid}`);
                        await this.updateMessageState(msg.PUBLICKEY, msg.DATE, 'sent');

                        // Optionally insert into TRANSACTIONS so it's tracked in the future
                        // But since it's already confirmed, we might just leave it as is
                    } else {
                        // Check age
                        const age = Date.now() - msg.DATE;
                        const ageMinutes = Math.floor(age / (1000 * 60));

                        if (age > 10 * 60 * 1000) { // 10 mins grace period
                            console.log(`🗑️ [Cleanup] Untracked message ${msg.DATE} is old (${ageMinutes}m) and not in blockchain - marking failed`);
                            await this.updateMessageState(msg.PUBLICKEY, msg.DATE, 'failed');
                        } else {
                            console.log(`⏳ [Cleanup] Untracked message ${msg.DATE} is recent (${ageMinutes}m) - giving it more time`);
                        }
                    }
                }
            }
        }

        console.log(`✅ [Cleanup] Complete.`);
    }

    /**
     * Cleanup messages that are stuck in 'pending' state
     */
    async cleanupStuckMessages(): Promise<void> {
        console.log('🧹 [Cleanup] Checking for stuck pending messages...');

        // Get all pending messages
        const sql = "SELECT * FROM CHAT_MESSAGES WHERE state='pending'";
        const result = await this.runSQL(sql);

        if (!result.rows || result.rows.length === 0) {
            console.log('✅ [Cleanup] No pending messages found');
            return;
        }

        console.log(`🔍 [Cleanup] Found ${result.rows.length} pending messages. Verifying consistency...`);

        let fixedCount = 0;

        for (const msg of result.rows) {
            const timestamp = msg.DATE; // This links to TRANSACTIONS.message_timestamp

            // Check if there is a transaction for this message
            const txSql = `SELECT * FROM TRANSACTIONS WHERE message_timestamp=${timestamp}`;
            const txResult = await this.runSQL(txSql);

            if (!txResult.rows || txResult.rows.length === 0) {
                // Case 1: Message is pending, but NO transaction record exists
                // This is a zombie message (transaction creation might have failed)
                // We should mark it as failed
                console.log(`🗑️ [Cleanup] Message ${timestamp} has NO transaction record - marking as failed`);
                await this.updateMessageState(msg.PUBLICKEY, timestamp, 'failed');
                fixedCount++;
            } else {
                // Case 2: Transaction record exists
                const tx = txResult.rows[0];

                if (tx.STATUS === 'confirmed') {
                    // Transaction is confirmed, but message is still pending -> Fix it
                    console.log(`✅ [Cleanup] Message ${timestamp} has CONFIRMED transaction - fixing state to sent`);
                    await this.updateMessageState(msg.PUBLICKEY, timestamp, 'sent');
                    fixedCount++;
                } else if (tx.STATUS === 'rejected') {
                    // Transaction is rejected, but message is still pending -> Fix it
                    console.log(`❌ [Cleanup] Message ${timestamp} has REJECTED transaction - fixing state to failed`);
                    await this.updateMessageState(msg.PUBLICKEY, timestamp, 'failed');
                    fixedCount++;
                }
                // If transaction is 'pending', we leave it (handled by cleanupOrphanedPendingTransactions)
            }
        }

        if (fixedCount > 0) {
            console.log(`✅ [Cleanup] Fixed ${fixedCount} stuck messages`);
        } else {
            console.log(`✅ [Cleanup] All pending messages have valid pending transactions`);
        }
    }

    async getPendingTransactions(): Promise<any[]> {
        const sql = `SELECT * FROM TRANSACTIONS WHERE status='pending' ORDER BY created_at ASC`;

        try {
            const res = await this.runSQL(sql);
            return res.rows || [];
        } catch (err) {
            console.error(`❌ [TX] Failed to get pending transactions:`, err);
            return [];
        }
    }

    async getTransactionByMessageTimestamp(timestamp: number): Promise<any | null> {
        const sql = `SELECT * FROM TRANSACTIONS WHERE message_timestamp=${timestamp}`;

        try {
            const res = await this.runSQL(sql);
            return res.rows && res.rows.length > 0 ? res.rows[0] : null;
        } catch (err) {
            console.error(`❌ [TX] Failed to get transaction by timestamp:`, err);
            return null;
        }
    }

    async getTransactionByPendingUid(pendinguid: string): Promise<any | null> {
        const sql = `SELECT * FROM TRANSACTIONS WHERE pendinguid='${pendinguid}'`;

        try {
            const res = await this.runSQL(sql);
            return res.rows && res.rows.length > 0 ? res.rows[0] : null;
        } catch (err) {
            console.error(`❌ [TX] Failed to get transaction by pendinguid:`, err);
            return null;
        }
    }

    async checkTransactionStatus(txpowid: string): Promise<{ status: 'pending' | 'confirmed' | 'rejected' | 'unknown', timestamp?: number }> {
        if (!txpowid || txpowid === 'null' || txpowid === 'undefined') return { status: 'unknown' };

        try {
            // Try to find the transaction using txpow command
            const response: any = await new Promise((resolve) => {
                MDS.executeRaw(`txpow txpowid:${txpowid}`, (res: any) => {
                    resolve(res);
                });
            });

            if (response && response.status) {
                const txpow = response.response;

                // If we got a response, the transaction exists
                if (txpow) {
                    // Check if it's in a block (confirmed)
                    if (txpow.isblock || txpow.inblock) {
                        // Get the blockchain timestamp from the txpow header
                        const blockTimestamp = txpow.header?.timemilli;
                        console.log(`✅ [TX] Transaction confirmed at blockchain time: ${blockTimestamp}`);
                        return {
                            status: 'confirmed',
                            timestamp: blockTimestamp ? Number(blockTimestamp) : Date.now()
                        };
                    }
                    // Transaction exists but not yet in a block
                    return { status: 'pending' };
                }
            }

            // Transaction not found - could be rejected or too old
            // However, we shouldn't be too hasty to call it 'unknown' or 'rejected' if it's just not found yet
            // But for now, 'unknown' is the safest fallback
            return { status: 'unknown' };
        } catch (err) {
            console.error(`❌ [TX] Error checking transaction status for ${txpowid}:`, err);
            return { status: 'unknown' };
        }
    }

    /**
     * Get transaction history from blockchain for MetaChain transactions
     * Returns a map of MESSAGE_TIMESTAMP -> { txpowid, timestamp } for quick lookup
     */
    async getMyTransactionHistory(): Promise<Map<string, { txpowid: string, timestamp: number }>> {
        try {
            console.log('🔍 [TxHistory] Fetching transaction history from blockchain...');

            // Get our Minima address
            const addressResponse: any = await new Promise((resolve) => {
                MDS.cmd.getaddress((res: any) => {
                    resolve(res);
                });
            });

            if (!addressResponse.status || !addressResponse.response) {
                console.error('❌ [TxHistory] Failed to get address');
                return new Map();
            }

            const myAddress = addressResponse.response.miniaddress;
            console.log(`🔍 [TxHistory] Querying txpows for address: ${myAddress}`);

            // Query transactions for our address (last 100)
            const txpowResponse: any = await new Promise((resolve) => {
                MDS.executeRaw(`txpow address:${myAddress} max:100`, (res: any) => {
                    resolve(res);
                });
            });

            if (!txpowResponse.status || !txpowResponse.response) {
                console.warn('⚠️ [TxHistory] No transaction history found');
                return new Map();
            }

            // Build map of MESSAGE_TIMESTAMP -> { txpowid, timestamp } for MetaChain transactions
            const historyMap = new Map<string, { txpowid: string, timestamp: number }>();
            const txpows = Array.isArray(txpowResponse.response) ? txpowResponse.response : [txpowResponse.response];

            for (const txpow of txpows) {
                try {
                    // Check if this is a MetaChain transaction
                    const state = txpow.body?.txn?.state;

                    if (state && Array.isArray(state) && state.length >= 2) {
                        const charmChainId = state[1]?.data;

                        // MetaChain identifier is 204 (0xCC)
                        if (charmChainId === '204') {
                            const stateId = state[0]?.data; // MESSAGE_TIMESTAMP
                            const txpowid = txpow.txpowid;
                            const timestamp = txpow.header?.timemilli ? Number(txpow.header.timemilli) : Date.now();

                            if (stateId && txpowid) {
                                historyMap.set(stateId, { txpowid, timestamp });
                                console.log(`✅ [TxHistory] Found MetaChain tx: ${stateId} -> ${txpowid} (Time: ${timestamp})`);
                            }
                        }
                    }
                } catch (err) {
                    console.error('❌ [TxHistory] Error parsing txpow:', err);
                }
            }

            console.log(`✅ [TxHistory] Found ${historyMap.size} MetaChain transaction(s) in blockchain`);
            return historyMap;

        } catch (err) {
            console.error('❌ [TxHistory] Error fetching transaction history:', err);
            return new Map();
        }
    }

    /**
     * Get pending transactions from mempool (not yet in blockchain)
     * Returns a map of MESSAGE_TIMESTAMP -> txpowid for quick lookup
     */
    async getMyPendingTransactions(): Promise<Map<string, string>> {
        try {
            console.log('🔍 [TxPending] Fetching pending transactions from mempool...');

            // Get our Minima address
            const addressResponse: any = await new Promise((resolve) => {
                MDS.cmd.getaddress((res: any) => {
                    resolve(res);
                });
            });

            if (!addressResponse.status || !addressResponse.response) {
                console.error('❌ [TxPending] Failed to get address');
                return new Map();
            }

            const myAddress = addressResponse.response.miniaddress;

            // Query transactions for our address
            const txpowResponse: any = await new Promise((resolve) => {
                MDS.executeRaw(`txpow address:${myAddress} max:100`, (res: any) => {
                    resolve(res);
                });
            });

            if (!txpowResponse.status || !txpowResponse.response) {
                console.warn('⚠️ [TxPending] No transactions found');
                return new Map();
            }

            // Build map of MESSAGE_TIMESTAMP -> txpowid for PENDING MetaChain transactions
            const pendingMap = new Map<string, string>();
            const txpows = Array.isArray(txpowResponse.response) ? txpowResponse.response : [txpowResponse.response];

            for (const txpow of txpows) {
                try {
                    // Check if this transaction is NOT yet in a block (pending in mempool)
                    const isInBlock = txpow.isblock || txpow.inblock;

                    if (!isInBlock) {
                        // Check if this is a MetaChain transaction
                        const state = txpow.body?.txn?.state;

                        if (state && Array.isArray(state) && state.length >= 2) {
                            const charmChainId = state[1]?.data;

                            // MetaChain identifier is 204 (0xCC)
                            if (charmChainId === '204') {
                                const stateId = state[0]?.data; // MESSAGE_TIMESTAMP
                                const txpowid = txpow.txpowid;

                                if (stateId && txpowid) {
                                    pendingMap.set(stateId, txpowid);
                                    console.log(`⏳ [TxPending] Found pending MetaChain tx: ${stateId} -> ${txpowid}`);
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.error('❌ [TxPending] Error parsing txpow:', err);
                }
            }

            console.log(`✅ [TxPending] Found ${pendingMap.size} pending MetaChain transaction(s) in mempool`);
            return pendingMap;

        } catch (err) {
            console.error('❌ [TxPending] Error fetching pending transactions:', err);
            return new Map();
        }
    }

    /**
     * Check if a specific transaction exists and get its status
     * Returns: 'confirmed' | 'pending' | 'not_found'
     */
    async checkTransactionByTxpowid(txpowid: string): Promise<'confirmed' | 'pending' | 'not_found'> {
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
            console.error(`❌ [TxCheck] Error checking txpowid ${txpowid}:`, err);
            return 'not_found';
        }
    }

    /**
     * Check if a specific pending UID is still in the pending list
     * Uses 'checkpending' command which doesn't create a pending entry
     * Returns true if the UID is still pending, false otherwise
     */
    async checkPendingUID(uid: string): Promise<boolean> {
        try {
            const response: any = await new Promise((resolve) => {
                MDS.executeRaw(`checkpending uid:${uid}`, (res: any) => {
                    resolve(res);
                });
            });

            if (!response.status) {
                console.log(`📋 [CheckPending] Could not check pending status for ${uid}`);
                return false;
            }

            // checkpending returns response.exists: true/false
            const exists = response.response?.exists || false;
            console.log(`📋 [CheckPending] UID ${uid} pending status: ${exists}`);
            return exists;

        } catch (err) {
            console.error(`❌ [CheckPending] Error checking pending UID ${uid}:`, err);
            return false;
        }
    }

    async updateTransactionTxpowid(pendinguid: string, txpowid: string): Promise<void> {
        const sql = `UPDATE TRANSACTIONS SET txpowid='${txpowid}' WHERE pendinguid='${pendinguid}'`;
        try {
            await this.runSQL(sql);
            console.log(`✅ [TX] Updated txpowid for pendinguid ${pendinguid} to ${txpowid}`);
        } catch (err) {
            console.error(`❌ [TX] Failed to update txpowid:`, err);
            throw err;
        }
    }

    async updateTransactionStatusByPendingUid(pendinguid: string, status: 'pending' | 'confirmed' | 'rejected'): Promise<void> {
        const now = Date.now();
        const sql = `UPDATE TRANSACTIONS SET status='${status}', updated_at=${now} WHERE pendinguid='${pendinguid}'`;
        try {
            await this.runSQL(sql);
            console.log(`✅ [TX] Updated status for pendinguid ${pendinguid} to ${status}`);
        } catch (err) {
            console.error(`❌ [TX] Failed to update status by pendinguid:`, err);
            throw err;
        }
    }

    async getPendingMessages(publickey: string) {
        const sql = `SELECT * FROM CHAT_MESSAGES WHERE publickey='${publickey}' AND state='pending'`;
        try {
            const res = await this.runSQL(sql);
            return res.rows;
        } catch (err) {
            console.error("❌ [MetaChain] Error fetching pending messages:", err);
            return [];
        }
    }

    async sendReadReceipt(toPublicKey: string) {
        console.log("📤 [MetaChain] Sending read receipt to", toPublicKey);
        try {
            const payload = {
                message: "",
                type: "read",
                username: "Me",
                filedata: ""
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            await MDS.cmd.maxima({
                params: {
                    action: "send",
                    publickey: toPublicKey,
                    application: "metachain",
                    data: hexData,
                    poll: false,
                } as any,
            });

            console.log("✅ [MetaChain] Read receipt sent successfully");

            // Mark received messages as read locally
            // IMPORTANT: Exclude 'pending' messages - they haven't been sent yet!
            const sql = `UPDATE CHAT_MESSAGES SET state = 'read' WHERE publickey = '${toPublicKey}' AND username != 'Me' AND state != 'read' AND state != 'pending'`;
            MDS.sql(sql, (res: any) => {
                console.log("✅ [DB] Marked received messages as read locally:", res);
            });

        } catch (err) {
            console.error("❌ [MetaChain] Error sending read receipt:", err);
        }
    }

    async sendDeliveryReceipt(toPublicKey: string) {
        console.log("📤 [MetaChain] Sending delivery receipt to", toPublicKey);
        try {
            const payload = {
                message: "",
                type: "delivery_receipt",
                username: "Me",
                filedata: ""
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            // Send without polling/waiting too much
            MDS.cmd.maxima({
                params: {
                    action: "send",
                    publickey: toPublicKey,
                    application: "metachain",
                    data: hexData,
                    poll: false,
                } as any,
            });

            console.log("✅ [MetaChain] Delivery receipt sent successfully");

        } catch (err) {
            console.error("❌ [MetaChain] Error sending delivery receipt:", err);
        }
    }

    async sendPing(toPublicKey: string) {
        console.log("📡 [MetaChain] Sending Ping to", toPublicKey);
        try {
            const payload = {
                message: "",
                type: "ping",
                username: "Me",
                filedata: ""
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            await MDS.cmd.maxima({
                params: {
                    action: "send",
                    publickey: toPublicKey,
                    application: "metachain",
                    data: hexData,
                    poll: false,
                } as any,
            });

            console.log("✅ [MetaChain] Ping sent successfully");
        } catch (err) {
            console.error("❌ [MetaChain] Error sending ping:", err);
            throw err;
        }
    }

    async sendPong(toPublicKey: string) {
        console.log("📡 [MetaChain] Sending Pong to", toPublicKey);
        try {
            const payload = {
                message: "",
                type: "pong",
                username: "Me",
                filedata: ""
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            await MDS.cmd.maxima({
                params: {
                    action: "send",
                    publickey: toPublicKey,
                    application: "metachain",
                    data: hexData,
                    poll: false,
                } as any,
            });

            console.log("✅ [MetaChain] Pong sent successfully");
        } catch (err) {
            console.error("❌ [MetaChain] Error sending pong:", err);
            throw err;
        }
    }

    /* ----------------------------------------------------------------------------
      TOKEN SENDING
    ---------------------------------------------------------------------------- */
    async getBalance(): Promise<any[]> {
        try {
            const response = await MDS.cmd.balance();
            return response.response;
        } catch (err) {
            console.error("❌ [MetaChain] Error fetching balance:", err);
            return [];
        }
    }


    async sendCharmWithTokens(
        toPublicKey: string,
        minimaAddress: string,
        username: string,
        charmId: string,
        amount: number,
        stateId?: number
    ): Promise<{ pending: boolean; pendinguid?: string; response?: any; txpowid?: string }> {
        console.log(`🎯[CHARM] Sending charm ${charmId} with ${amount} Minima to ${username}`);

        try {
            // Step 1: Send the Minima tokens (tokenId 0x00 is always Minima)
            const tokenResponse = await this.sendToken("0x00", amount.toString(), minimaAddress, "Minima", stateId);

            // Extract txpowid and pendinguid from token response
            const txpowid = tokenResponse?.txpowid;
            const pendinguid = tokenResponse?.pendinguid;

            // Check if token send is pending
            const isTokenPending = tokenResponse && (tokenResponse.pending || (tokenResponse.error && tokenResponse.error.toString().toLowerCase().includes("pending")));

            if (isTokenPending) {
                console.log(`⚠️[CHARM] Token send is pending. Saving message locally but NOT sending via Maxima yet.`);

                const messageTimestamp = stateId || Date.now();

                // Save message locally with 'pending' state, but don't send via Maxima
                await this.insertMessage({
                    roomname: username,
                    publickey: toPublicKey,
                    username: "Me",
                    type: "charm",
                    message: charmId,
                    filedata: "",
                    state: "pending",
                    amount,
                    date: messageTimestamp
                });

                // Store transaction in TRANSACTIONS table if we have a txpowid OR pendinguid
                if (txpowid || pendinguid) {
                    await this.insertTransaction(
                        txpowid,
                        'charm',
                        toPublicKey,
                        messageTimestamp,
                        { charmId, amount, username, minimaAddress },
                        pendinguid
                    );
                    console.log(`💾 [CHARM] Transaction tracked: ${txpowid || 'No TXPOWID'} (PendingUID: ${pendinguid || 'None'})`);
                } else {
                    console.warn(`⚠️ [CHARM] Could not track transaction: No txpowid AND no pendinguid`);
                }

                return { pending: true, pendinguid, response: tokenResponse, txpowid };
            }

            // Step 2: Only send the charm message via Maxima if token was sent successfully
            console.log(`✅[CHARM] Token sent successfully. Now sending charm message via Maxima...`);
            const msgResponse = await this.sendMessage(toPublicKey, username, charmId, "charm", "", amount);

            console.log(`✅[CHARM] ========== CHARM SENT SUCCESSFULLY ==========`);
            return { pending: false, response: msgResponse, txpowid };

        } catch (err) {
            console.error(`❌[CHARM] ========== CHARM SEND FAILED ==========`);
            console.error(`❌[CHARM] Error details:`, err);
            throw err;
        }
    }

    async sendToken(tokenId: string, amount: string, address: string, tokenName: string, stateId?: number): Promise<any> {
        console.log(`💸[TOKEN SEND] Sending ${amount} ${tokenName} to ${address}`);

        try {
            // Construct the send command parameters
            const sendParams: any = {
                amount: amount,
                address: address,
                tokenid: tokenId
            };

            // Add state variables if stateId provided (for tracking)
            if (stateId) {
                sendParams.state = {
                    0: stateId,      // Unique timestamp ID
                    1: 204           // MetaChain identifier (0xCC)
                };
                console.log(`🏷️[TOKEN SEND] Adding state variables: ID = ${stateId}`);
            }

            console.log(`💸[TOKEN SEND] Command parameters:`, JSON.stringify(sendParams, null, 2));
            console.log(`💸[TOKEN SEND] Executing MDS.cmd.send...`);

            const response = await (MDS.cmd as any).send(sendParams);

            console.log(`💸[TOKEN SEND] Raw response:`, JSON.stringify(response, null, 2));

            // Extract txpowid from response (try multiple locations)
            let txpowid = null;
            if (response) {
                // 1. Direct property
                if (response.txpowid) txpowid = response.txpowid;
                // 2. Inside response object
                else if (response.response && response.response.txpowid) txpowid = response.response.txpowid;
                // 3. Inside txpow object
                else if (response.response && response.response.txpow && response.response.txpow.txpowid) txpowid = response.response.txpow.txpowid;
                // 4. Inside body.txn (common for pending transactions)
                else if (response.response && response.response.body && response.response.body.txn && response.response.body.txn.txpowid) txpowid = response.response.body.txn.txpowid;
            }

            // Extract pendinguid if available
            let pendinguid = null;
            if (response) {
                if (response.pendinguid) pendinguid = response.pendinguid;
                else if (response.response && response.response.pendinguid) pendinguid = response.response.pendinguid;
            }

            if (txpowid) {
                console.log(`🆔 [TOKEN SEND] Transaction ID captured: ${txpowid}`);
            } else if (pendinguid) {
                console.log(`⏳ [TOKEN SEND] Pending UID captured: ${pendinguid}`);
            } else {
                console.warn(`⚠️ [TOKEN SEND] No txpowid or pendinguid found in response`);
            }

            if (response && response.status === false) {
                // Check if it's a pending command (Read Mode)
                const isPending = response.pending ||
                    (response.error && response.error.toString().toLowerCase().includes("pending"));

                if (isPending) {
                    console.warn("⚠️ [TOKEN SEND] Command is pending approval (Read Mode).");
                    console.log("🔍 [DEBUG] Full Pending Response Structure:", JSON.stringify(response, null, 2));

                    // Return response with txpowid/pendinguid so caller knows it "succeeded" (queued) and can track it
                    return {
                        ...response,
                        txpowid,
                        pendinguid
                    };
                } else {
                    console.error(`❌[TOKEN SEND] Send command failed!`);
                    console.error(`❌[TOKEN SEND] Error:`, response.error || response.message || 'Unknown error');
                    throw new Error(response.error || response.message || 'Token send failed');
                }
            }

            console.log(`✅[TOKEN SEND] ========== TOKEN SENT SUCCESSFULLY ==========`);

            // Return response with txpowid/pendinguid included
            return {
                ...response,
                txpowid,
                pendinguid
            };
        } catch (err) {
            console.error(`❌[TOKEN SEND] ========== TOKEN SEND FAILED ==========`);
            console.error(`❌[TOKEN SEND] Error details:`, err);
            console.error(`❌[TOKEN SEND] Error type:`, typeof err);
            if (err instanceof Error) {
                console.error(`❌[TOKEN SEND] Error message:`, err.message);
                console.error(`❌[TOKEN SEND] Error stack:`, err.stack);
            }
            throw err;
        }
    }

    async initProfile() {
        // Publish our Minima address to Maxima profile so others can send us tokens
        try {
            const maxResponse = await MDS.cmd.maxima({ action: "getaddress" } as any);
            if (maxResponse.status) {
                // Cast to any to avoid type errors if the type definition is incomplete
                const myAddress = (maxResponse.response as any).address;
                console.log("📍 [MetaChain] My Minima Address:", myAddress);

                // We'll just log it for now as we're not sure about the update command yet
                // and we want to avoid unused variable warnings
                // const updateCmd = ...
            }
        } catch (err) {
            console.error("❌ [MetaChain] Error initializing profile:", err);
        }
    }

    /* ----------------------------------------------------------------------------
      INITIALIZATION
    ---------------------------------------------------------------------------- */
    init() {
        if (this.initialized) return;
        this.initialized = true;

        if (!MDS) {
            console.error("MDS no està disponible!");
            return;
        }

        console.log("[Service] MinimaService inicialitzat - esperant MDS.init...");
        // DB initialization will be called from AppContext after MDS.init completes

        // Initialize profile (publish address)
        // We do this a bit later or when needed
    }

    processEvent(event: any) {
        // Handle MAXIMA events
        if (event.event === "MAXIMA") {
            console.log("✉️ [MDS] MAXIMA event detected:", event);
            this.processIncomingMessage(event);
        }

        // Handle NEWBALANCE events for transaction tracking
        if (event.event === "NEWBALANCE") {
            console.log("💰 [MDS] NEWBALANCE event detected");
            console.log("💰 [MDS] NEWBALANCE full event:", JSON.stringify(event, null, 2));
            this.handleNewBalance();
        }

        // Handle MDS_PENDING for immediate accept/deny detection
        if (event.event === "MDS_PENDING") {
            console.log("🔔 [MDS] MDS_PENDING event detected");
            console.log("🔔 [MDS] MDS_PENDING full event:", JSON.stringify(event, null, 2));
            this.handlePendingEvent(event.data);
        }
    }

    /**
     * Handle MDS_PENDING event - immediate notification when user accepts/denies a transaction
     * This is much faster and more reliable than polling
     */
    private async handlePendingEvent(data: any) {
        try {
            const { uid, accept, result } = data;

            if (!uid) {
                console.warn("⚠️ [MDS_PENDING] No uid in event data");
                return;
            }

            console.log(`🔔 [MDS_PENDING] Transaction ${uid} - Accept: ${accept}`);

            // Find the transaction by pendinguid
            const sql = `SELECT * FROM TRANSACTIONS WHERE pendinguid='${uid}' LIMIT 1`;
            const txResult = await this.runSQL(sql);

            if (!txResult.rows || txResult.rows.length === 0) {
                console.log(`⚠️ [MDS_PENDING] No transaction found for uid: ${uid}`);
                return;
            }

            const transaction = txResult.rows[0];
            const { PUBLICKEY, MESSAGE_TIMESTAMP, TYPE, METADATA } = transaction;

            if (accept) {
                // Transaction was ACCEPTED by user
                // BUT we must check if execution was successful (e.g. sufficient funds)
                if (result && result.status === false) {
                    console.log(`❌ [MDS_PENDING] Transaction ACCEPTED but FAILED execution: ${uid}`);
                    console.log(`❌ [MDS_PENDING] Error: ${result.error}`);

                    // Update transaction status to rejected
                    await this.updateTransactionStatusByPendingUid(uid, 'rejected');

                    // Update message state to failed
                    await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'failed');

                    return;
                }

                console.log(`✅ [MDS_PENDING] Transaction ACCEPTED and EXECUTED: ${uid}`);

                // Extract txpowid from result if available
                let txpowid = null;
                if (result && result.response) {
                    // Try multiple locations for txpowid
                    if (result.response.txpowid) txpowid = result.response.txpowid;
                    else if (result.response.txpow && result.response.txpow.txpowid) txpowid = result.response.txpow.txpowid;
                }

                // Update transaction with txpowid if we got it
                if (txpowid) {
                    await this.updateTransactionTxpowid(uid, txpowid);
                    console.log(`🆔 [MDS_PENDING] Updated txpowid: ${txpowid}`);
                }

                // Update transaction status to confirmed
                await this.updateTransactionStatusByPendingUid(uid, 'confirmed');

                // Extract blockchain timestamp from the transaction response
                const blockchainTimestamp = result.response?.header?.timemilli;
                const confirmationTime = blockchainTimestamp ? Number(blockchainTimestamp) : Date.now();
                console.log(`🕐 [MDS_PENDING] Transaction confirmed at blockchain time: ${confirmationTime} (from header: ${!!blockchainTimestamp})`);

                // Update message state to 'sent' AND update timestamp to blockchain confirmation time
                await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'sent', confirmationTime);

                // Send Maxima message
                const metadata = JSON.parse(METADATA || '{}');

                if (TYPE === 'charm') {
                    const { charmId, username, amount } = metadata;
                    console.log(`📤 [MDS_PENDING] Sending charm message via Maxima...`);
                    await this.sendMessage(
                        PUBLICKEY,
                        username || 'Unknown',
                        charmId,
                        'charm',
                        '',
                        amount || 0,
                        confirmationTime  // Use blockchain timestamp, not MESSAGE_TIMESTAMP
                    );
                } else if (TYPE === 'token') {
                    const { tokenName, username, amount } = metadata;
                    const tokenData = JSON.stringify({ amount, tokenName });
                    console.log(`📤 [MDS_PENDING] Sending token message via Maxima...`);
                    await this.sendMessage(
                        PUBLICKEY,
                        username || 'Unknown',
                        tokenData,
                        'token',
                        '',
                        0,
                        confirmationTime  // Use blockchain timestamp, not MESSAGE_TIMESTAMP
                    );
                }

                console.log(`✅ [MDS_PENDING] Transaction ${uid} processed successfully`);
            } else {
                // Transaction was DENIED
                console.log(`❌ [MDS_PENDING] Transaction DENIED: ${uid}`);

                // Update transaction status to rejected
                await this.updateTransactionStatusByPendingUid(uid, 'rejected');

                // Update message state to failed
                await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'failed');

                console.log(`✅ [MDS_PENDING] Transaction ${uid} marked as failed`);
            }
        } catch (err) {
            console.error('❌ [MDS_PENDING] Error handling pending event:', err);
        }
    }
}

export const minimaService = new MinimaService();
