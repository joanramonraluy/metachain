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
    private processedMsgIds = new Set<string>();
    private instanceId = Math.floor(Math.random() * 10000);

    constructor() {
        console.log(`🔧 [MinimaService] Instance created: #${this.instanceId}`);
        // Singleton pattern could be used, or just export an instance
    }

    /* ----------------------------------------------------------------------------
      HEX <-> UTF8
    ---------------------------------------------------------------------------- */
    hexToUtf8(hexStr: string): string {
        // Remove whitespace and 0x prefix
        hexStr = hexStr.replace(/\s+/g, '').replace(/^0x/i, '');

        // Convert hex pairs to bytes
        const bytes: number[] = [];
        for (let i = 0; i < hexStr.length; i += 2) {
            bytes.push(parseInt(hexStr.substr(i, 2), 16));
        }

        // Decode UTF-8 byte sequence
        let str = '';
        let i = 0;
        while (i < bytes.length) {
            const byte1 = bytes[i++];

            if (byte1 < 0x80) {
                // 1-byte character (ASCII)
                str += String.fromCharCode(byte1);
            } else if (byte1 >= 0xC0 && byte1 < 0xE0) {
                // 2-byte character (català, español, etc.)
                const byte2 = bytes[i++];
                const codePoint = ((byte1 & 0x1F) << 6) | (byte2 & 0x3F);
                str += String.fromCharCode(codePoint);
            } else if (byte1 >= 0xE0 && byte1 < 0xF0) {
                // 3-byte character (Chinese, Japanese, etc.)
                const byte2 = bytes[i++];
                const byte3 = bytes[i++];
                const codePoint = ((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F);
                str += String.fromCharCode(codePoint);
            } else if (byte1 >= 0xF0 && byte1 < 0xF8) {
                // 4-byte character (emojis, etc.)
                const byte2 = bytes[i++];
                const byte3 = bytes[i++];
                const byte4 = bytes[i++];
                let codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
                // Convert to surrogate pair
                codePoint -= 0x10000;
                str += String.fromCharCode(0xD800 + (codePoint >> 10));
                str += String.fromCharCode(0xDC00 + (codePoint & 0x3FF));
            }
        }

        return str;
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
                    console.log("📂 [DB] CHAT_MESSAGES table initialized");
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
                    console.log("📂 [DB] CHAT_STATUS table initialized");
                    // Add columns if they don't exist (migration for existing databases)
                    const alterSql1 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS app_installed BOOLEAN DEFAULT FALSE";
                    const alterSql2 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE";
                    const alterSql3 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS archived_date BIGINT";
                    const alterSql4 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS last_opened BIGINT";
                    const alterSql5 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS muted BOOLEAN DEFAULT FALSE";
                    const alterSql6 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE";

                    MDS.sql(alterSql1, (alterRes: any) => {
                        if (alterRes.status) console.log("📂 [DB] app_installed column added/verified");
                    });
                    MDS.sql(alterSql2, (alterRes: any) => {
                        if (alterRes.status) console.log("📂 [DB] archived column added/verified");
                    });
                    MDS.sql(alterSql3, (alterRes: any) => {
                        if (alterRes.status) console.log("📂 [DB] archived_date column added/verified");
                    });
                    MDS.sql(alterSql4, (alterRes: any) => {
                        if (alterRes.status) console.log("📂 [DB] last_opened column added/verified");
                    });
                    MDS.sql(alterSql5, (alterRes: any) => {
                        if (alterRes.status) console.log("📂 [DB] muted column added/verified");
                    });
                    MDS.sql(alterSql6, (alterRes: any) => {
                        if (alterRes.status) console.log("📂 [DB] favorite column added/verified");
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
                    console.log("📂 [DB] TRANSACTIONS table initialized");

                    // Migration 1: Add pendinguid column if it doesn't exist
                    const alterSql1 = "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS pendinguid VARCHAR(128)";
                    MDS.sql(alterSql1, (alterRes: any) => {
                        if (!alterRes.status) {
                            // console.warn("⚠️ [DB] Could not add pendinguid column (may already exist):", alterRes.error);
                        } else {
                            console.log("📂 [DB] pendinguid column added/verified");
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
                                console.log("📂 [DB] PROFILES table initialized");
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
                                    console.log("📂 [DB] GROUPS table initialized");
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
                                        console.log("📂 [DB] GROUP_MEMBERS table initialized");
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
                                            console.log("📂 [DB] GROUP_MESSAGES table initialized");
                                        }

                                        // Create CONTACT_REQUESTS table for bidirectional contact requests
                                        const createContactRequestsTable = `
            CREATE TABLE IF NOT EXISTS CONTACT_REQUESTS (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                from_publickey VARCHAR(512) NOT NULL,
                from_name VARCHAR(255),
                from_avatar TEXT,
                from_address VARCHAR(1024),
                to_publickey VARCHAR(512) NOT NULL,
                status VARCHAR(32) DEFAULT 'pending',
                created_at BIGINT NOT NULL,
                updated_at BIGINT
            )`;

                                        MDS.sql(createContactRequestsTable, (res: any) => {
                                            if (!res.status) {
                                                console.error("❌ [DB] Failed to create CONTACT_REQUESTS table:", res.error);
                                            } else {
                                                console.log("📂 [DB] CONTACT_REQUESTS table initialized");
                                            }

                                            // Add from_address column if it doesn't exist (for existing tables)
                                            const addFromAddressColumn = `ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_address VARCHAR(1024)`;
                                            MDS.sql(addFromAddressColumn, (res: any) => {
                                                if (!res.status) {
                                                    console.log("ℹ️ [DB] from_address column already exists or error:", res.error);
                                                } else {
                                                    console.log("📂 [DB] from_address column added/verified");
                                                }
                                            });

                                            // Create table for Maxima contact requests
                                            const createMaximaContactRequestsTable = `
                CREATE TABLE IF NOT EXISTS MAXIMA_CONTACT_REQUESTS (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    from_publickey VARCHAR(512) NOT NULL,
                    from_name VARCHAR(255),
                    to_publickey VARCHAR(512) NOT NULL,
                    status VARCHAR(32) DEFAULT 'pending',
                    created_at BIGINT NOT NULL,
                    updated_at BIGINT
                )`;

                                            MDS.sql(createMaximaContactRequestsTable, (res: any) => {
                                                if (!res.status) {
                                                    console.error("❌ [DB] Failed to create MAXIMA_CONTACT_REQUESTS table:", res.error);
                                                } else {
                                                    console.log("📂 [DB] MAXIMA_CONTACT_REQUESTS table initialized");
                                                }
                                                resolve();
                                            });
                                        });
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
            console.log("💾 [SQL] Archiving chat:", publickey);
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
            console.log("💾 [SQL] Unarchiving chat:", publickey);
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
            console.log("💾 [SQL] Marking chat as opened:", publickey);
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
        // Only escape single quotes for SQL safety - no URL encoding needed
        const escapedMsg = message.replace(/'/g, "''");
        const timestamp = date || Date.now();
        const sql = `
      INSERT INTO CHAT_MESSAGES (roomname,publickey,username,type,message,filedata,state,amount,date)
      VALUES ('${roomname}','${publickey}','${username}','${type}','${escapedMsg}','${filedata}','${state}',${amount},${timestamp})
    `;
        // console.log("💾 [SQL] Executing INSERT:", sql);
        try {
            await this.runSQL(sql);
            // console.log("💾 [SQL] INSERT successful");
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
            // console.log("💾 [SQL] Executing SELECT:", sql);
            MDS.sql(sql, (res: any) => {
                // console.log("💾 [SQL] SELECT result:", res);
                if (!res.status || !res.rows) {
                    resolve([]);
                    return;
                }
                // FILTER: Remove messages that are strictly "undefined" string
                // This cleans up ghost messages from the UI
                const validRows = res.rows.filter((r: any) => r.MESSAGE !== 'undefined');
                resolve(validRows);
            });
        });
    }

    deleteAllMessages(publickey: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM CHAT_MESSAGES WHERE publickey='${publickey}'`;
            console.log("💾 [SQL] Deleting all messages for:", publickey);
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

            // console.log("💾 [SQL] Executing getRecentChats with status");
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

            // FILTER: Skip "undefined" messages so we gracefully fallback to the previous valid message
            if (row.MESSAGE === 'undefined') {
                return;
            }

            // If we haven't seen this publickey yet, or this message is newer
            // (Note: rows are ordered by DATE DESC, so the first one we see is the newest)
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

        // console.log("💾 [SQL] Processed chats with status:", chats);
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
            console.log('💰 [WALLET] Balance changed - checking for confirmed transactions...');

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



    async processIncomingMessage(event: any) {
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
            const from = maximaData.from; // This is the Public Key
            let datastr = maximaData.data;

            // Check if data is in hex format (starts with 0x)
            if (typeof datastr === 'string' && datastr.startsWith('0x')) {
                console.log("🔄 [MAXIMA] Converting hex data to UTF8");
                datastr = this.hexToUtf8(datastr.substring(2)); // Remove 0x prefix
                console.log("📝 [MAXIMA] Data converted/parsed:", datastr);
            }

            try {
                const json = JSON.parse(datastr) as any;
                console.log(`📨 [MAXIMA-DEBUG] Processing msg type: ${json.type}, from: ${from}`);
                console.log(`📨 [MAXIMA-DEBUG] Full Payload:`, json);

                // Check if this is a group message (by app name OR content)
                if (app === "metachain-group" || (json.messageType && json.groupId)) {
                    console.log("👥 [GROUPS] Message detected:", json.messageType);
                    // Import dynamically to avoid circular dependency
                    // Replaced with static import
                    // import('./group.service').then(({ groupService }) => {
                    //    groupService.handleIncomingGroupMessage(json, from);
                    // });
                    // Static call now that circular dependency is resolved via utils/hex.ts
                    groupService.handleIncomingGroupMessage(json, from);



                    return;
                }

                if (json.type === "mls_register_permanent") {
                    console.log("🔭 [DISCOVERY] Registration request received from", from);
                    const pubkey = json.publickey;
                    if (pubkey) {
                        const cmd = `maxextra action:addpermanent publickey:${pubkey}`;
                        console.log("🔭 [DISCOVERY] Executing:", cmd);
                        MDS.executeRaw(cmd, (res: any) => {
                            if (res.status) {
                                console.log("✅ [DISCOVERY] Permanent address added for:", pubkey);
                                // Optional: Send confirmation back if needed
                            } else {
                                console.error("❌ [DISCOVERY] Failed to add permanent address:", res.error);
                            }
                        });
                    } else {
                        console.warn("⚠️ [DISCOVERY] Received registration request without public key");
                    }
                    return;
                }

                // Handle Gossip Protocol - Peer Exchange Response
                if (json.type === "peers_response") {
                    console.log("🗣 [GOSSIP] Received peer list from", from);
                    if (json.peers && Array.isArray(json.peers)) {
                        console.log(`🗣 [GOSSIP] Processing ${json.peers.length} peers...`);

                        // Save each peer to Frontend's DISCOVERED_PEERS table
                        json.peers.forEach((peer: any) => {
                            if (!peer.pubkey) return;

                            const now = Date.now();
                            const escapedAlias = (peer.alias || 'Anonymous').replace(/'/g, "''");
                            const escapedBio = (peer.bio || "").replace(/'/g, "''");
                            const allowChats = (peer.allowNonContactChats !== undefined && peer.allowNonContactChats !== null)
                                ? (peer.allowNonContactChats ? 1 : 0)
                                : 1;

                            const sql = `MERGE INTO DISCOVERED_PEERS (publickey, alias, bio, address, last_seen, source, allow_non_contact_chats) 
                                KEY (publickey) 
                                VALUES ('${peer.pubkey}', '${escapedAlias}', '${escapedBio}', '${peer.address}', ${now}, 'GOSSIP', ${allowChats})`;

                            MDS.sql(sql, (res: any) => {
                                if (res.status) {
                                    console.log(`✅ [GOSSIP] Saved peer: ${peer.alias}`);
                                } else {
                                    console.error(`❌ [GOSSIP] Failed to save ${peer.alias}:`, res.error);
                                }
                            });
                        });

                        // Trigger UI refresh
                        window.dispatchEvent(new CustomEvent('DISCOVERY_UPDATE'));
                    }
                    return;
                }

                // Handle Internal Sync - Peer Discovered from Beacon
                if (json.type === "peer_discovered") {
                    console.log("📡 [SYNC] Peer discovered notification from SW:", json.peer?.alias);
                    if (json.peer) {
                        const peer = json.peer;
                        const now = Date.now();
                        const escapedAlias = (peer.alias || 'Anonymous').replace(/'/g, "''");
                        const escapedBio = (peer.bio || "").replace(/'/g, "''");
                        const allowChats = (peer.allowNonContactChats !== undefined && peer.allowNonContactChats !== null)
                            ? (peer.allowNonContactChats ? 1 : 0)
                            : 1;

                        const sql = `MERGE INTO DISCOVERED_PEERS (publickey, alias, bio, address, last_seen, source, allow_non_contact_chats) 
                            KEY (publickey) 
                            VALUES ('${peer.pubkey}', '${escapedAlias}', '${escapedBio}', '${peer.address}', ${now}, 'P2P', ${allowChats})`;

                        MDS.sql(sql, (res: any) => {
                            if (res.status) {
                                console.log(`✅ [SYNC] Peer saved to Frontend: ${peer.alias}`);
                                // Trigger UI refresh
                                window.dispatchEvent(new CustomEvent('DISCOVERY_UPDATE'));
                            } else {
                                console.error(`❌ [SYNC] Failed to save ${peer.alias}:`, res.error);
                            }
                        });
                    }
                    return;
                }

                if (json.type === "read") {
                    console.log("✅ [READ-RECEIPT] Received from", from);
                    // DB update is handled by Service Worker
                    // Notify listeners to refresh UI
                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'read_receipt' }));
                    return;
                }

                if (json.type === "delivery_receipt") {
                    console.log("✅ [DELIVERY-RECEIPT] Received from", from);
                    // DB update is handled by Service Worker
                    // Notify listeners to refresh UI
                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'delivery_receipt' }));
                    return;
                }

                if (json.type === "ping") {
                    console.log("📡 [PING] Ping received from", from, "- sending Pong");
                    // Send Pong response
                    this.sendPong(from).catch(err => console.error("❌ [PING] Failed to send Pong:", err));
                    // Notify listeners (optional, but good for debugging)
                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'ping' }));
                    return;
                }

                if (json.type === "pong") {
                    console.log("📡 [PING] Pong received from", from);
                    // Notify listeners so UI can update app status
                    // Include 'from' so Discovery page can identify which profile responded
                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'pong', from } as any));
                    return;
                }

                if (json.type === "profile_request") {
                    console.log("👤 [PROFILE] Request received from", from, "- Delegating to Service Worker");
                    // SECURITY: Profile requests are ONLY handled by the Service Worker
                    // to ensure privacy filtering is applied correctly.
                    // The Service Worker will check privacy settings and send the appropriate response.
                    return;
                }

                if (json.type === "profile_response") {
                    console.log("👤 [PROFILE] Response received from", from);
                    // Import profile service and handle response
                    import('./profile.service').then(({ handleProfileResponse }) => {
                        handleProfileResponse(from, json);
                    });
                    return;
                }

                if (json.type === "contact_request") {
                    console.log("📨 [CONTACTS] Request received from", from);
                    // Save to database and THEN notify UI
                    this.saveContactRequest(from, json.name || "Unknown", json.avatar || "", maximaData.to, json.from_address)
                        .then(() => {
                            console.log("✅ [CONTACTS] Request saved, notifying UI...");
                            // Notify UI to show banner AFTER saving
                            this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'contact_request', from } as any));
                        })
                        .catch(err => console.error("❌ [CONTACTS] Failed to save:", err));
                    return;
                }

                // Handle Contact Accepted
                if (json.type === "contact_accepted") {
                    console.log("✅ [CONTACTS] Request accepted by", from);

                    // MIGRATION LOGIC: Check if we have a chat/request with their Maxima Address (Mx...)
                    // and migrate it to their Hex Public Key (0x...) to avoid duplicate chats.
                    const fromAddress = json.from_address; // New field we added

                    if (fromAddress && (fromAddress.startsWith("Mx") || fromAddress.startsWith("MX"))) {
                        console.log(`🔄 [MIGRATION] Checking for chats with address ${fromAddress} to migrate to ${from}`);

                        // Migrate CHAT_MESSAGES
                        const migrateChatSql = `UPDATE CHAT_MESSAGES SET publickey='${from}' WHERE publickey='${fromAddress}'`;
                        await this.runSQL(migrateChatSql);

                        // Migrate CONTACT_REQUESTS (outgoing from us to them)
                        const migrateReqSql = `UPDATE CONTACT_REQUESTS SET to_publickey='${from}' WHERE to_publickey='${fromAddress}'`;
                        await this.runSQL(migrateReqSql);

                        console.log(`✅ [MIGRATION] Complete for ${fromAddress}`);
                    }


                    // They accepted our request.
                    // We DO NOT add them to contacts automatically anymore.
                    // This must be a manual user action.
                    console.log("✅ [CONTACTS] Received acceptance - chat is now open (not added to Maxima contacts)");

                    // Also update any pending outgoing request we had to 'accepted'
                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safeFrom = escapeSql(from);

                    // Get my public key to identify the request
                    const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
                    const myPublicKey = (myInfo.response as any).publickey;
                    const safeMyKey = escapeSql(myPublicKey);

                    const updateReqSql = `UPDATE CONTACT_REQUESTS SET status='accepted', updated_at=${Date.now()} 
                                          WHERE from_publickey='${safeMyKey}' AND to_publickey='${safeFrom}'`;
                    await this.runSQL(updateReqSql);

                    // DUPLICATE CHECK: Check if we already received an accept message recently (last 10s)
                    const checkDupSql = `SELECT * FROM CHAT_MESSAGES 
                                         WHERE publickey='${safeFrom}' AND type='system' AND message='Chat request accepted' 
                                         AND date > ${Date.now() - 10000}`;
                    const dupRes = await this.runSQL(checkDupSql);

                    if (dupRes.count === 0) {
                        // Insert system message so the requester sees the acceptance
                        const now = Date.now();
                        const insertMsgSql = `
                            INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date)
                            VALUES ('', '${safeFrom}', 'System', 'system', 'Chat request accepted', '', 'received', 0, ${now})
                        `;
                        await this.runSQL(insertMsgSql);
                        console.log("✅ [CONTACTS] Saved acceptance message for requester");
                    } else {
                        console.log("⚠️ [CONTACTS] Ignoring duplicate accept message");
                    }

                    // Notify UI
                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'contact_accepted', from } as any));
                    return;
                }

                if (json.type === "contact_declined") {
                    console.log("🚫 [CONTACTS] Request declined by", from);

                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safeFrom = escapeSql(from);

                    // Update outgoing request status to 'declined'
                    // We sent the request (from=ME, to=THEM).
                    // So we update where to_publickey = FROM (sender of this decline msg)
                    const updateReqSql = `UPDATE CONTACT_REQUESTS SET status='declined', updated_at=${Date.now()} 
                                          WHERE to_publickey='${safeFrom}' AND status='pending'`;
                    await this.runSQL(updateReqSql);

                    // DUPLICATE CHECK: Check if we already received a decline message recently (last 10s)
                    const checkDupSql = `SELECT * FROM CHAT_MESSAGES 
                                         WHERE publickey='${safeFrom}' AND type='system' AND message='Contact request declined' 
                                         AND date > ${Date.now() - 10000}`;
                    const dupRes = await this.runSQL(checkDupSql);

                    if (dupRes.count === 0) {
                        // Insert system message: "Contact request declined" (received state)
                        const chatMessageSql = `
                            INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date)
                            VALUES('', '${safeFrom}', 'System', 'system', 'Contact request declined', '', 'received', 0, ${Date.now()})
                        `;
                        await this.runSQL(chatMessageSql);
                    } else {
                        console.log("⚠️ [CONTACTS] Ignoring duplicate decline message");
                    }

                    // Notify UI
                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'contact_declined', from } as any));
                    return;
                }

                // Maxima Contact Request handlers
                if (json.type === "maxima_contact_request") {
                    console.log("📨 [MAXIMA CONTACT] Request received from", from);
                    const fromName = json.name || "Unknown";
                    await this.saveMaximaContactRequest(from, fromName);
                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'maxima_contact_request', from } as any));
                    return;
                }

                if (json.type === "maxima_contact_accepted") {
                    console.log("✅ [MAXIMA CONTACT] Request accepted by", from);

                    MDS.cmd.maxcontacts({ action: "list" } as any).then((res: any) => {
                        const contacts = res.response?.contacts || [];
                        const contact = contacts.find((c: any) => c.publickey === from);
                        if (contact?.currentaddress) {
                            MDS.cmd.maxcontacts({
                                action: "add",
                                contact: contact.currentaddress
                            } as any);
                        }
                    });

                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safeFrom = escapeSql(from);
                    const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
                    const myPublicKey = (myInfo.response as any).publickey;
                    const safeMyKey = escapeSql(myPublicKey);

                    const updateReqSql = `UPDATE MAXIMA_CONTACT_REQUESTS SET status='accepted', updated_at=${Date.now()} 
                                          WHERE from_publickey='${safeMyKey}' AND to_publickey='${safeFrom}'`;
                    await this.runSQL(updateReqSql);

                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'maxima_contact_accepted', from } as any));
                    return;
                }

                if (json.type === "maxima_contact_declined") {
                    console.log("🚫 [MAXIMA CONTACT] Request declined by", from);

                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safeFrom = escapeSql(from);

                    const updateReqSql = `UPDATE MAXIMA_CONTACT_REQUESTS SET status='declined', updated_at=${Date.now()} 
                                          WHERE to_publickey='${safeFrom}' AND status='pending'`;
                    await this.runSQL(updateReqSql);

                    this.newMessageCallbacks.forEach((cb) => cb({ ...json, type: 'maxima_contact_declined', from } as any));
                    return;
                }

                // Handle Profile Response (for Extended Profile)
                if (json.type === "profile_response") {
                    console.log(`👤 [PROFILE] Response received from ${from}`);
                    import('./profile.service').then(({ handleProfileResponse }) => {
                        handleProfileResponse(from, json);
                    }).catch(err => console.error("❌ [PROFILE] Failed to load profile service:", err));
                    return;
                }



                if (json.type === "contact_request_received") {
                    console.log("✅ [CONTACTS] Request delivery confirmed by", from);
                    // Update local message state from 'sent' to 'delivered'
                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safePublicKey = escapeSql(from);
                    const updateSql = `UPDATE CHAT_MESSAGES 
                                       SET state='delivered' 
                                       WHERE publickey='${safePublicKey}' 
                                       AND type='system' 
                                       AND message='Contact request sent'`;
                    this.runSQL(updateSql).then(() => {
                        console.log("✅ [CONTACTS] Message state updated to delivered");
                    }).catch(err => {
                        console.error("❌ [CONTACTS] Failed to update message state:", err);
                    });
                    return;
                }

                // Normal message
                console.log("✅ [MAXIMA] Message received (saved by SW):", json.message);

                // DB insertion and Delivery Receipt are handled by Service Worker
                // We only need to notify the UI

                // Notify UI to refresh
                this.newMessageCallbacks.forEach((cb) => cb(json));
            } catch (err) {
                console.error("❌ [MAXIMA] Error processing message:", err);
                console.error("❌ [MAXIMA] Received data:", datastr);
            }
        } else {
            console.log(`ℹ️ [MAXIMA] Message ignored (wrong app) "${maximaData.application}"`);
        }
    }

    /* ----------------------------------------------------------------------------
      SENDING MESSAGES
    ---------------------------------------------------------------------------- */
    async sendMessage(
        toPublicKey: string,
        senderName: string,      // Name of sender (for payload)
        message: string,
        type: string = "text",
        filedata: string = "",
        amount: number = 0,
        existingTimestamp?: number,  // If provided, we're updating an existing pending message
        recipientName?: string,      // Name of recipient (for roomname) - optional for backwards compatibility
        targetApplication: string = "metachain" // Target application (default: metachain, fallback: maxima)
    ) {
        try {
            // Determine the timestamp to use
            const messageTimestamp = existingTimestamp || Date.now();

            // RESOLVE IDENTIFIER: If sending to a Maxima address (Mx...), try to find the Hex Public Key (0x...)
            // This ensures the message is saved in the same chat as the contact request.
            let databasePublicKey = toPublicKey;

            if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
                try {
                    // Escape for SQL
                    const safeMxAddress = toPublicKey.replace(/'/g, "''");

                    // Check Discovery DB first
                    const discoverySql = `SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE ADDRESS LIKE '%${safeMxAddress}%' LIMIT 1`;
                    const discoveryRes = await this.runSQL(discoverySql);

                    if (discoveryRes.rows && discoveryRes.rows.length > 0) {
                        databasePublicKey = discoveryRes.rows[0].PUBLICKEY;
                        console.log(`🔍 [MAXIMA] Resolved Mx address to Hex PublicKey: ${databasePublicKey}`);
                    } else {
                        // Fallback: Check Maxcontacts
                        const contacts = await MDS.cmd.maxcontacts({ params: { action: "list" } });
                        const contactList = (contacts.response as unknown as any[]) || [];
                        const contact = contactList.find((c: any) => c.currentaddress === toPublicKey);
                        if (contact && contact.publickey) {
                            databasePublicKey = contact.publickey;
                            console.log(`🔍 [MAXIMA] Resolved Mx address from Contacts to Hex PublicKey: ${databasePublicKey}`);
                        }
                    }

                    // LAZY MIGRATION: If we resolved it, migrate any old chats/requests using the Mx address to the Hex Key
                    if (databasePublicKey !== toPublicKey) {
                        console.log(`🔄 [MIGRATION] Lazy migration triggered for ${toPublicKey} -> ${databasePublicKey}`);

                        // Migrate CHAT_MESSAGES
                        const migrateChatSql = `UPDATE CHAT_MESSAGES SET publickey='${databasePublicKey}' WHERE publickey='${safeMxAddress}'`;
                        await this.runSQL(migrateChatSql);

                        // Migrate CONTACT_REQUESTS
                        const migrateReqSql = `UPDATE CONTACT_REQUESTS SET to_publickey='${databasePublicKey}' WHERE to_publickey='${safeMxAddress}'`;
                        await this.runSQL(migrateReqSql);
                    }

                } catch (err) {
                    console.warn("⚠️ [MAXIMA] Failed to resolve Hex PublicKey, using address as-is:", err);
                }
            }

            // Create payload with message data only (application is specified in Maxima params)
            const payload: any = {
                message,
                type,
                username: senderName,  // Sender's name goes in payload
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

            console.log("📤 [MAXIMA] Sending message to:", toPublicKey, payload);
            console.log("🔢 [MAXIMA] Hex data:", hexData);

            // Determine which parameter to use based on address format
            // MX# addresses use 'to', 0x addresses use 'publickey'
            const sendParams: any = {
                action: "send",
                application: targetApplication,
                data: hexData,
                poll: false,
            };

            if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
                sendParams.to = toPublicKey; // Maxima address format
            } else {
                sendParams.publickey = toPublicKey; // Public key format
            }

            const response = await MDS.cmd.maxima({
                params: sendParams
            });

            console.log("📡 [MAXIMA] Full send response:", response);

            // Check if it's a pending command (Read Mode)
            const isPending = response && ((response as any).status === false) && (
                (response as any).pending ||
                ((response as any).error && (response as any).error.toString().toLowerCase().includes("pending"))
            );

            if (response && (response as any).status === false && !isPending) {
                const errorMessage = (response as any).error || "";

                // Check if error is "No Contact found"
                if (errorMessage.includes("No Contact found")) {
                    console.log("⚠️ [MAXIMA] Target not in contacts. Attempting to resolve address from Discovery...");

                    // 1. Try to find their Maxima address in DISCOVERED_PEERS
                    const safeKey = toPublicKey.replace(/'/g, "''");
                    const peerSql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='${safeKey}' LIMIT 1`;
                    const peerRes = await this.runSQL(peerSql);

                    if (peerRes.rows && peerRes.rows.length > 0) {
                        const mxAddress = peerRes.rows[0].ADDRESS;
                        console.log(`🔍 [MAXIMA] Found Mx address for non-contact: ${mxAddress}`);

                        // 2. Retry sending using 'to' address (works for non-contacts)
                        const retryResponse = await MDS.cmd.maxima({
                            params: {
                                action: "send",
                                to: mxAddress, // Use the resolved Mx address
                                application: targetApplication,
                                data: hexData,
                                poll: false,
                            } as any,
                        });

                        if (retryResponse && (retryResponse as any).status === false) {
                            console.error("❌ [MAXIMA] Retry with Mx address failed:", (retryResponse as any).error);
                            // Fallback to original error if this fails
                            throw new Error(errorMessage);
                        }

                        console.log("✅ [MAXIMA] Message sent successfully via Mx address (non-contact)");
                        return retryResponse;
                    } else {
                        // 3. Fallback: Attempt to add contact (legacy behavior - unlikely to work without address)
                        console.warn("⚠️ [MAXIMA] Address not found in discovery. Trying legacy auto-add...");
                        try {
                            const addResponse = await MDS.cmd.maxcontacts({
                                action: "add",
                                contact: toPublicKey
                            } as any);

                            if (addResponse.status) {
                                console.log("✅ [CONTACTS] Contact added. Retrying send...");
                                const retryResponse = await MDS.cmd.maxima({
                                    params: {
                                        action: "send",
                                        publickey: toPublicKey,
                                        application: "metachain",
                                        data: hexData,
                                        poll: false,
                                    } as any,
                                });

                                if (retryResponse && (retryResponse as any).status === false) {
                                    throw new Error((retryResponse as any).error);
                                }
                                console.log("✅ [MAXIMA] Message sent after adding contact");
                                return retryResponse;
                            } else {
                                console.error("❌ [CONTACTS] Auto-add failed:", addResponse.error);
                                throw new Error(errorMessage);
                            }
                        } catch (e) {
                            throw new Error(errorMessage);
                        }
                    }
                } else {
                    console.error("❌ [MAXIMA] Send failed:", errorMessage);
                    throw new Error(errorMessage || "Maxima send failed");
                }
            }

            if (isPending) {
                console.warn("⚠️ [MAXIMA] Command is pending approval (Read Mode). Saving with 'pending' state.");
            } else {
                console.log("✅ [MAXIMA] Message sent successfully");
            }

            // Only insert a new message if we're not updating an existing one
            if (!existingTimestamp) {
                this.insertMessage({
                    roomname: recipientName || senderName,  // Use recipient name for roomname, fallback to sender for backwards compatibility
                    publickey: databasePublicKey, // USE RESOLVED KEY (0x) to ensure it acts on the migrated/unified chat
                    username: "Me", // Set to "Me" so we know it's sent by us
                    type,
                    message,
                    filedata,
                    state: isPending ? "pending" : "sent", // Use 'pending' if command is pending
                    amount, // Include amount for charm messages
                });
            } else {
                console.log(`ℹ️ [DB] Skipping message insertion - updating existing message with timestamp ${existingTimestamp}`);
            }

            return response;
        } catch (err) {
            console.error("❌ [MAXIMA] Error sending message:", err);
            throw err;
        }
    }

    async updateMessageState(publickey: string, timestamp: number, state: string, newTimestamp?: number) {
        console.log(`🔄 [DB] Updating message state: newState="${state}", timestamp=${timestamp}`);

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
       SQL HELPER (Promise wrapper)
    ---------------------------------------------------------------------------- */
    runSQL(sql: string): Promise<any> {
        return new Promise((resolve, reject) => {
            MDS.sql(sql, (res: any) => {
                if (res.status) {
                    resolve(res);
                } else {
                    console.error(`❌ [SQL] Error: ${sql} ->`, res.error);
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
        console.log('🧹 [CLEANUP] Starting manual cleanup of orphaned transactions...');

        // Get all pending transactions from DB
        // Get all pending transactions from DB
        const sql = "SELECT * FROM TRANSACTIONS WHERE status='pending'";
        const result = await this.runSQL(sql);
        const pendingDbTxs = result.rows || [];

        if (pendingDbTxs.length === 0) {
            console.log('✅ [CLEANUP] No pending transactions found in DB (proceeding to check for stuck messages)');
        } else {
            console.log(`🔍 [CLEANUP] Found ${pendingDbTxs.length} pending transactions in DB`);
        }

        // Get confirmed transaction history from blockchain
        const confirmedTxs = await this.getMyTransactionHistory();
        console.log(`🔍 [CLEANUP] Found ${confirmedTxs.size} confirmed MetaChain transactions in blockchain`);

        // Get pending transactions from mempool
        const pendingTxs = await this.getMyPendingTransactions();
        console.log(`🔍 [CLEANUP] Found ${pendingTxs.size} pending MetaChain transactions in mempool`);

        let cleanedCount = 0;

        // Check each DB transaction
        for (const tx of pendingDbTxs) {
            const { MESSAGE_TIMESTAMP, TXPOWID, PENDINGUID, PUBLICKEY, CREATED_AT } = tx;

            // Check if this transaction is in the blockchain (confirmed)
            const confirmedTxData = confirmedTxs.get(MESSAGE_TIMESTAMP.toString());

            if (confirmedTxData) {
                const { txpowid: confirmedTxpowid, timestamp: confirmedTimestamp } = confirmedTxData;

                // Transaction is confirmed in blockchain!
                console.log(`✅ [CLEANUP] Transaction ${MESSAGE_TIMESTAMP} confirmed as ${confirmedTxpowid} at ${confirmedTimestamp}`);

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
                    console.log(`📤 [CLEANUP] Sending charm message via Maxima...`);
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
                    console.log(`📤 [CLEANUP] Sending token message via Maxima...`);
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
                console.log(`⏳ [CLEANUP] Transaction ${MESSAGE_TIMESTAMP} is pending in mempool as ${pendingTxpowid}`);

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
                    console.log(`⏳ [CLEANUP] Transaction ${MESSAGE_TIMESTAMP} still pending approval (PENDINGUID: ${PENDINGUID})`);
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
                        console.log(`✅ [CLEANUP] Transaction ${MESSAGE_TIMESTAMP} was accepted and confirmed while app was closed`);
                        await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'sent');
                        cleanedCount++;
                    } else if (isInMempool) {
                        console.log(`⏳ [CLEANUP] Transaction ${MESSAGE_TIMESTAMP} is in mempool (approved, waiting for confirmation)`);
                        // Transaction was approved and is waiting to be added to blockchain
                        // Update to 'sent' state since it's been approved
                        await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'sent');
                        cleanedCount++;
                    } else {
                        // Not in blockchain and not in mempool
                        // CONSERVATIVE APPROACH: Leave as pending instead of marking as failed
                        // Only MDS_PENDING event can reliably tell us if it was denied
                        console.log(`⚠️ [CLEANUP] Transaction ${MESSAGE_TIMESTAMP} not found in blockchain or mempool - keeping as pending (will be updated by MDS_PENDING event if denied)`);
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
                    console.log(`✅ [CLEANUP] Transaction ${TXPOWID} confirmed via direct lookup`);
                    await this.updateTransactionStatus(TXPOWID, 'confirmed');
                    await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'sent');
                    cleanedCount++;
                } else if (txStatus === 'pending') {
                    console.log(`⏳ [CLEANUP] Transaction ${TXPOWID} still pending in mempool`);
                    // Keep as pending
                } else {
                    // not_found - give it grace period before marking as failed
                    if (age > 10 * 60 * 1000) {
                        console.log(`🗑️ [CLEANUP] Transaction ${TXPOWID} not found after ${ageMinutes}m - marking as failed`);
                        await this.updateTransactionStatus(TXPOWID, 'rejected');
                        await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'failed');
                        cleanedCount++;
                    } else {
                        console.log(`⏳ [CLEANUP] Transaction ${TXPOWID} propagating (${ageMinutes}m)...`);
                    }
                }
            }
            // Transactions without PENDINGUID or TXPOWID are orphans - clean immediately
            else {
                console.log(`🗑️ [CLEANUP] Orphan transaction ${MESSAGE_TIMESTAMP} with no tracking ID - marking as failed`);
                await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'failed');
                cleanedCount++;
            }
        }

        console.log(`✅ [CLEANUP] Processed ${cleanedCount} orphaned transactions from DB`);

        // -------------------------------------------------------------------------
        // SAFETY NET: Check for stuck messages in CHAT_MESSAGES
        // (zombies with no transaction record, likely from before the token fix)
        // -------------------------------------------------------------------------
        const stuckMessagesSql = "SELECT * FROM CHAT_MESSAGES WHERE state='pending'";
        const stuckMessages = await this.runSQL(stuckMessagesSql);

        if (stuckMessages.rows && stuckMessages.rows.length > 0) {
            console.log(`🧹 [CLEANUP] Checking ${stuckMessages.rows.length} pending messages in CHAT_MESSAGES for zombies...`);

            for (const msg of stuckMessages.rows) {
                // Check if tracked in TRANSACTIONS
                const isTrackedSql = `SELECT * FROM TRANSACTIONS WHERE message_timestamp=${msg.DATE}`;
                const tracked = await this.runSQL(isTrackedSql);

                if (tracked.rows.length === 0) {
                    console.log(`⚠️ [CLEANUP] Found untracked pending message: ${msg.DATE} (Amount: ${msg.AMOUNT})`);

                    // Check blockchain history using the message timestamp
                    const confirmedTxpowid = confirmedTxs.get(msg.DATE.toString());

                    if (confirmedTxpowid) {
                        console.log(`✅ [CLEANUP] Recovered untracked transaction ${msg.DATE} -> ${confirmedTxpowid}`);
                        await this.updateMessageState(msg.PUBLICKEY, msg.DATE, 'sent');

                        // Optionally insert into TRANSACTIONS so it's tracked in the future
                        // But since it's already confirmed, we might just leave it as is
                    } else {
                        // Check age
                        const age = Date.now() - msg.DATE;
                        const ageMinutes = Math.floor(age / (1000 * 60));

                        if (age > 10 * 60 * 1000) { // 10 mins grace period
                            console.log(`🗑️ [CLEANUP] Untracked message ${msg.DATE} is old (${ageMinutes}m) and not in blockchain - marking failed`);
                            await this.updateMessageState(msg.PUBLICKEY, msg.DATE, 'failed');
                        } else {
                            console.log(`⏳ [CLEANUP] Untracked message ${msg.DATE} is recent (${ageMinutes}m) - giving it more time`);
                        }
                    }
                }
            }
        }

        console.log(`✅ [CLEANUP] Complete.`);
    }

    /**
     * Cleanup messages that are stuck in 'pending' state
     */
    async cleanupStuckMessages(): Promise<void> {
        console.log('🧹 [CLEANUP] Checking for stuck pending messages...');

        // Get all pending messages
        const sql = "SELECT * FROM CHAT_MESSAGES WHERE state='pending'";
        const result = await this.runSQL(sql);

        if (!result.rows || result.rows.length === 0) {
            console.log('✅ [CLEANUP] No pending messages found');
            return;
        }

        console.log(`🔍 [CLEANUP] Found ${result.rows.length} pending messages. Verifying consistency...`);

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
                console.log(`🗑️ [CLEANUP] Message ${timestamp} has NO transaction record - marking as failed`);
                await this.updateMessageState(msg.PUBLICKEY, timestamp, 'failed');
                fixedCount++;
            } else {
                // Case 2: Transaction record exists
                const tx = txResult.rows[0];

                if (tx.STATUS === 'confirmed') {
                    // Transaction is confirmed, but message is still pending -> Fix it
                    console.log(`✅ [CLEANUP] Message ${timestamp} has CONFIRMED transaction - fixing state to sent`);
                    await this.updateMessageState(msg.PUBLICKEY, timestamp, 'sent');
                    fixedCount++;
                } else if (tx.STATUS === 'rejected') {
                    // Transaction is rejected, but message is still pending -> Fix it
                    console.log(`❌ [CLEANUP] Message ${timestamp} has REJECTED transaction - fixing state to failed`);
                    await this.updateMessageState(msg.PUBLICKEY, timestamp, 'failed');
                    fixedCount++;
                }
                // If transaction is 'pending', we leave it (handled by cleanupOrphanedPendingTransactions)
            }
        }

        if (fixedCount > 0) {
            console.log(`✅ [CLEANUP] Fixed ${fixedCount} stuck messages`);
        } else {
            console.log(`✅ [CLEANUP] All pending messages have valid pending transactions`);
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
            console.log('🔍 [HISTORY] Fetching transaction history from blockchain...');

            // Get our Minima address
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

            // Query transactions for our address (last 100)
            const txpowResponse: any = await new Promise((resolve) => {
                MDS.executeRaw(`txpow address:${myAddress} max:100`, (res: any) => {
                    resolve(res);
                });
            });

            if (!txpowResponse.status || !txpowResponse.response) {
                console.warn('⚠️ [HISTORY] No transaction history found');
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

    /**
     * Get pending transactions from mempool (not yet in blockchain)
     * Returns a map of MESSAGE_TIMESTAMP -> txpowid for quick lookup
     */
    async getMyPendingTransactions(): Promise<Map<string, string>> {
        try {
            console.log('🔍 [MEMPOOL] Fetching pending transactions from mempool...');

            // Get our Minima address
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

            // Query transactions for our address
            const txpowResponse: any = await new Promise((resolve) => {
                MDS.executeRaw(`txpow address:${myAddress} max:100`, (res: any) => {
                    resolve(res);
                });
            });

            if (!txpowResponse.status || !txpowResponse.response) {
                console.warn('⚠️ [MEMPOOL] No transactions found');
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
            console.error(`❌ [TX-CHECK] Error checking txpowid ${txpowid}:`, err);
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
                console.log(`📋 [TX-CHECK] Could not check pending status for ${uid}`);
                return false;
            }

            // checkpending returns response.exists: true/false
            const exists = response.response?.exists || false;
            console.log(`📋 [TX-CHECK] UID ${uid} pending status: ${exists}`);
            return exists;

        } catch (err) {
            console.error(`❌ [TX-CHECK] Error checking pending UID ${uid}:`, err);
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
            console.error("❌ [DB] Error fetching pending messages:", err);
            return [];
        }
    }

    async sendReadReceipt(toPublicKey: string) {
        console.log("📤 [READ-RECEIPT] Sending to", toPublicKey);
        console.log("🔍 [READ-RECEIPT] Called with parameter:", toPublicKey);
        try {
            const payload = {
                message: "",
                type: "read",
                username: "Me",
                filedata: ""
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            // Resolve Address for Non-Contacts
            let sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: false,
            };

            // If it's a 0x key, try to find the Maxima Address (Mx...)
            if (toPublicKey.startsWith('0x')) {
                console.log("🔍 [READ-RECEIPT] Parameter is 0x key, looking up Mx address...");
                const safeKey = toPublicKey.replace(/'/g, "''");
                const peerSql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='${safeKey}' AND ADDRESS IS NOT NULL LIMIT 1`;
                console.log("🔍 [READ-RECEIPT] SQL Query:", peerSql);
                try {
                    const peerRes = await this.runSQL(peerSql);
                    console.log("🔍 [READ-RECEIPT] SQL Result:", JSON.stringify(peerRes));
                    if (peerRes && peerRes.rows && peerRes.rows.length > 0) {
                        const mxAddress = peerRes.rows[0].ADDRESS;
                        console.log("🔍 [READ-RECEIPT] Found ADDRESS:", mxAddress);
                        if (mxAddress && mxAddress.startsWith('Mx')) {
                            console.log(`🔍 [READ-RECEIPT] ✅ Found Maxima Address for ${toPublicKey.substring(0, 10)}... -> ${mxAddress.substring(0, 10)}...`);
                            console.log("🔍 [READ-RECEIPT] Using 'to' parameter with Mx address");
                            sendParams.to = mxAddress; // Use Address for robust routing
                        } else {
                            console.log("🔍 [READ-RECEIPT] ADDRESS not valid Mx format, using publickey");
                            sendParams.publickey = toPublicKey;
                        }
                    } else {
                        console.log("🔍 [READ-RECEIPT] No rows found in DISCOVERED_PEERS, using publickey");
                        sendParams.publickey = toPublicKey;
                    }
                } catch (e) {
                    console.error("🔍 [READ-RECEIPT] SQL Error:", e);
                    sendParams.publickey = toPublicKey;
                }
            } else {
                console.log("🔍 [READ-RECEIPT] Parameter is NOT 0x key");
                // Already Mx... or something else
                if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
                    console.log("🔍 [READ-RECEIPT] Parameter is Mx address, using 'to'");
                    sendParams.to = toPublicKey;
                } else {
                    console.log("🔍 [READ-RECEIPT] Unknown format, using publickey");
                    sendParams.publickey = toPublicKey;
                }
            }

            console.log("🔍 [READ-RECEIPT] Final sendParams:", JSON.stringify(sendParams, null, 2));
            await MDS.cmd.maxima({ params: sendParams });

            console.log("✅ [READ-RECEIPT] Sent successfully");

            // Mark received messages as read locally
            // IMPORTANT: Exclude 'pending' messages - they haven't been sent yet!
            const sql = `UPDATE CHAT_MESSAGES SET state = 'read' WHERE publickey = '${toPublicKey}' AND username != 'Me' AND state != 'read' AND state != 'pending'`;
            MDS.sql(sql, (res: any) => {
                console.log("✅ [DB] Marked received messages as read locally:", res);
            });

        } catch (err) {
            console.error("❌ [READ-RECEIPT] Error sending:", err);
        }
    }

    async sendDeliveryReceipt(toPublicKey: string) {
        console.log("📤 [DELIVERY-RECEIPT] Sending to", toPublicKey);
        try {
            const payload = {
                message: "",
                type: "delivery_receipt",
                username: "Me",
                filedata: ""
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            // Resolve Address for Non-Contacts
            let sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: false,
            };

            // If it's a 0x key, try to find the Maxima Address (Mx...)
            if (toPublicKey.startsWith('0x')) {
                const safeKey = toPublicKey.replace(/'/g, "''");
                const peerSql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='${safeKey}' AND ADDRESS IS NOT NULL LIMIT 1`;
                try {
                    const peerRes = await this.runSQL(peerSql);
                    if (peerRes && peerRes.rows && peerRes.rows.length > 0) {
                        const mxAddress = peerRes.rows[0].ADDRESS;
                        if (mxAddress && mxAddress.startsWith('Mx')) {
                            // Correctly set 'to' for Mx address
                            sendParams.to = mxAddress;
                        } else {
                            sendParams.publickey = toPublicKey;
                        }
                    } else {
                        sendParams.publickey = toPublicKey;
                    }
                } catch (e) {
                    sendParams.publickey = toPublicKey;
                }
            } else {
                if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
                    sendParams.to = toPublicKey;
                } else {
                    sendParams.publickey = toPublicKey;
                }
            }

            // Send without polling/waiting too much
            await MDS.cmd.maxima({ params: sendParams });

            console.log("✅ [DELIVERY-RECEIPT] Sent successfully");
        } catch (err) {
            console.error("❌ [DELIVERY-RECEIPT] Error sending:", err);
        }
    }

    async sendInvitation(toPublicKey: string, fromUsername: string) {
        console.log("📨 [INVITE] Sending to", toPublicKey);
        try {
            const payload = {
                message: `${fromUsername} has invited you to join MetaChain! Install the app to start chatting.`,
                type: "invitation",
                username: fromUsername,
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
                    poll: true,  // Enable polling to ensure invitation is delivered
                } as any,
            });

            console.log("✅ [INVITE] Sent successfully");
        } catch (err) {
            console.error("❌ [INVITE] Error sending:", err);
            throw err;
        }
    }

    async sendPing(toPublicKey: string) {
        console.log("📡 [PING] Sending to", toPublicKey);
        console.log("📡 [PING] Received parameter:", toPublicKey);
        try {
            const payload = {
                message: "",
                type: "ping",
                username: "Me",
                filedata: ""
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            // Resolve Address for Non-Contacts (Critical for Discovery Pings)
            let sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: false,
            };

            // If it's a 0x key, try to find the Maxima Address (Mx...)
            if (toPublicKey.startsWith('0x')) {
                console.log("📡 [PING] Parameter is 0x key, looking up Maxima Address from DISCOVERED_PEERS...");
                const safeKey = toPublicKey.replace(/'/g, "''");
                const peerSql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='${safeKey}' AND ADDRESS IS NOT NULL LIMIT 1`;
                console.log("📡 [PING] SQL Query:", peerSql);
                try {
                    const peerRes = await this.runSQL(peerSql);
                    console.log("📡 [PING] SQL Result:", JSON.stringify(peerRes));
                    if (peerRes && peerRes.rows && peerRes.rows.length > 0) {
                        const mxAddress = peerRes.rows[0].ADDRESS;
                        console.log("📡 [PING] Found row with ADDRESS:", mxAddress);
                        if (mxAddress && mxAddress.startsWith('Mx')) {
                            console.log(`📡 [Ping] ✅ Found Maxima Address for ${toPublicKey.substring(0, 10)}... -> ${mxAddress.substring(0, 10)}...`);
                            console.log(`📡 [PING] Using 'to' parameter with Mx address`);
                            sendParams.to = mxAddress; // Use Address for robust routing to non-contacts
                        } else {
                            console.log(`📡 [PING] ❌ ADDRESS is not valid Mx format, using publickey`);
                            sendParams.publickey = toPublicKey;
                        }
                    } else {
                        console.log(`📡 [PING] ❌ No rows found in DISCOVERED_PEERS, using publickey`);
                        sendParams.publickey = toPublicKey;
                    }
                } catch (e) {
                    console.error(`📡 [PING] ❌ SQL Error:`, e);
                    sendParams.publickey = toPublicKey;
                }
            } else {
                console.log("📡 [PING] Parameter is NOT 0x key");
                if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
                    console.log("📡 [PING] Parameter is Mx address, using 'to' parameter");
                    sendParams.to = toPublicKey;
                } else {
                    console.log("📡 [PING] Parameter is unknown format, using 'publickey' parameter");
                    sendParams.publickey = toPublicKey;
                }
            }

            console.log("📡 [PING] Final sendParams:", JSON.stringify(sendParams, null, 2));
            await MDS.cmd.maxima({ params: sendParams });

            console.log("✅ [PING] Sent successfully");
        } catch (err) {
            console.error("❌ [PING] Error sending:", err);
            throw err;
        }
    }

    async requestChatHistory(toPublicKey: string) {
        console.log("🔄 [HISTORY-SYNC] Requesting from", toPublicKey);
        try {
            const payload = {
                message: "",
                type: "chat_history_request",
                username: "Me",
                filedata: "",
                timestamp: Date.now()
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            await MDS.cmd.maxima({
                params: {
                    action: "send",
                    publickey: toPublicKey,
                    application: "metachain",
                    data: hexData,
                    poll: true,  // Enable polling to ensure delivery
                } as any,
            });

            console.log("✅ [HISTORY-SYNC] Request sent successfully");
        } catch (err) {
            console.error("❌ [HISTORY-SYNC] Error requesting:", err);
            throw err;
        }
    }

    async sendPong(toPublicKey: string) {
        console.log("📡 [PONG] Sending to", toPublicKey);
        try {
            const payload = {
                message: "",
                type: "pong",
                username: "Me",
                filedata: ""
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            // Smart Address Resolution for Non-Contacts (same as sendPing)
            let sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: false,
            };

            // If it's a 0x key, try to find the Maxima Address (Mx...)
            if (toPublicKey.startsWith('0x')) {
                const safeKey = toPublicKey.replace(/'/g, "''");
                const peerSql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='${safeKey}' AND ADDRESS IS NOT NULL LIMIT 1`;
                try {
                    const peerRes = await this.runSQL(peerSql);
                    if (peerRes && peerRes.rows && peerRes.rows.length > 0) {
                        const mxAddress = peerRes.rows[0].ADDRESS;
                        if (mxAddress && mxAddress.startsWith('Mx')) {
                            console.log(`📡 [PONG] ✅ Found Maxima Address for ${toPublicKey.substring(0, 10)}... -> ${mxAddress.substring(0, 10)}...`);
                            sendParams.to = mxAddress; // Use Address for robust routing to non-contacts
                        } else {
                            sendParams.publickey = toPublicKey;
                        }
                    } else {
                        sendParams.publickey = toPublicKey;
                    }
                } catch (e) {
                    sendParams.publickey = toPublicKey;
                }
            } else {
                if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
                    sendParams.to = toPublicKey;
                } else {
                    sendParams.publickey = toPublicKey;
                }
            }

            await MDS.cmd.maxima({ params: sendParams });

            console.log("✅ [PONG] Sent successfully");
        } catch (err) {
            console.error("❌ [PONG] Error sending:", err);
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
            console.error("❌ [WALLET] Error fetching balance:", err);
            return [];
        }
    }


    async sendCharmWithTokens(
        toPublicKey: string,
        minimaAddress: string,
        senderName: string,      // Name of sender
        recipientName: string,   // Name of recipient
        charmId: string,
        amount: number,
        stateId?: number
    ): Promise<{ pending: boolean; pendinguid?: string; response?: any; txpowid?: string }> {
        console.log(`🎯 [CHARM] Sending charm ${charmId} with ${amount} Minima to ${recipientName}`);

        try {
            // Step 1: Send the Minima tokens (tokenId 0x00 is always Minima)
            const tokenResponse = await this.sendToken("0x00", amount.toString(), minimaAddress, "Minima", stateId);

            // Extract txpowid and pendinguid from token response
            const txpowid = tokenResponse?.txpowid;
            const pendinguid = tokenResponse?.pendinguid;

            // Check if token send is pending
            const isTokenPending = tokenResponse && (tokenResponse.pending || (tokenResponse.error && tokenResponse.error.toString().toLowerCase().includes("pending")));

            if (isTokenPending) {
                console.log(`⚠️ [CHARM] Token send is pending. Saving message locally but NOT sending via Maxima yet.`);

                const messageTimestamp = stateId || Date.now();

                // Save message locally with 'pending' state, but don't send via Maxima
                await this.insertMessage({
                    roomname: recipientName,  // Use recipient name for roomname
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
                        { charmId, amount, username: senderName, minimaAddress },
                        pendinguid
                    );
                    console.log(`💾 [CHARM] Transaction tracked: ${txpowid || 'No TXPOWID'} (PendingUID: ${pendinguid || 'None'})`);
                } else {
                    console.warn(`⚠️ [CHARM] Could not track transaction: No txpowid AND no pendinguid`);
                }

                return { pending: true, pendinguid, response: tokenResponse, txpowid };
            }

            // Step 2: Only send the charm message via Maxima if token was sent successfully
            console.log(`✅ [CHARM] Token sent successfully. Now sending charm message via Maxima...`);
            const msgResponse = await this.sendMessage(toPublicKey, senderName, charmId, "charm", "", amount, undefined, recipientName);

            console.log(`✅ [CHARM] ========== CHARM SENT SUCCESSFULLY ==========`);
            return { pending: false, response: msgResponse, txpowid };

        } catch (err) {
            console.error(`❌ [CHARM] ========== CHARM SEND FAILED ==========`);
            console.error(`❌ [CHARM] Error details:`, err);
            throw err;
        }
    }

    async sendToken(tokenId: string, amount: string, address: string, tokenName: string, stateId?: number): Promise<any> {
        console.log(`💸 [WALLET] Sending ${amount} ${tokenName} to ${address}`);

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
                console.log(`🏷️ [WALLET] Adding state variables: ID = ${stateId}`);
            }

            console.log(`💸 [WALLET] Command parameters:`, JSON.stringify(sendParams, null, 2));
            console.log(`💸 [WALLET] Executing MDS.cmd.send...`);

            const response = await (MDS.cmd as any).send(sendParams);

            console.log(`💸 [WALLET] Raw response:`, JSON.stringify(response, null, 2));

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
                console.log(`🆔 [WALLET] Transaction ID captured: ${txpowid}`);
            } else if (pendinguid) {
                console.log(`⏳ [WALLET] Pending UID captured: ${pendinguid}`);
            } else {
                console.warn(`⚠️ [WALLET] No txpowid or pendinguid found in response`);
            }

            if (response && response.status === false) {
                // Check if it's a pending command (Read Mode)
                const isPending = response.pending ||
                    (response.error && response.error.toString().toLowerCase().includes("pending"));

                if (isPending) {
                    console.warn("⚠️ [WALLET] Command is pending approval (Read Mode).");
                    console.log("🔍 [DEBUG] Full Pending Response Structure:", JSON.stringify(response, null, 2));

                    // Return response with txpowid/pendinguid so caller knows it "succeeded" (queued) and can track it
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

            // Return response with txpowid/pendinguid included
            return {
                ...response,
                txpowid,
                pendinguid
            };
        } catch (err) {
            console.error(`❌ [WALLET] ========== TOKEN SEND FAILED ==========`);
            console.error(`❌ [WALLET] Error details:`, err);
            console.error(`❌ [WALLET] Error type:`, typeof err);
            if (err instanceof Error) {
                console.error(`❌ [WALLET] Error message:`, err.message);
                console.error(`❌ [WALLET] Error stack:`, err.stack);
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
                console.log("📍 [PROFILE] My Minima Address:", myAddress);

                // We'll just log it for now as we're not sure about the update command yet
                // and we want to avoid unused variable warnings
                // const updateCmd = ...
            }
        } catch (err) {
            console.error("❌ [PROFILE] Error initializing:", err);
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

        console.log("⚙️ [SERVICE] MinimaService initialized - waiting for MDS.init...");
        // DB initialization will be called from AppContext after MDS.init completes

        // Initialize profile (publish address)
        // We do this a bit later or when needed
    }

    processEvent(event: any) {
        // Handle MAXIMA events
        // Handle MAXIMA events
        if (event.event === "MAXIMA") {
            // Deduplicate events by msgid
            if (event.data && event.data.msgid) {
                if (this.processedMsgIds.has(event.data.msgid)) {
                    console.warn(`⚠️ [MDS] Duplicate MAXIMA event ignored: ${event.data.msgid}`);
                    return;
                }
                this.processedMsgIds.add(event.data.msgid);
                // Keep set size manageable (e.g. last 1000 IDs)
                if (this.processedMsgIds.size > 1000) {
                    const firstIt = this.processedMsgIds.values().next();
                    if (firstIt.value) {
                        this.processedMsgIds.delete(firstIt.value);
                    }
                }
            }
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

    /* ----------------------------------------------------------------------------
       CONTACT REQUESTS
    ---------------------------------------------------------------------------- */

    /**
     * Send a contact request to another user
     */
    async sendChatRequest(toAddress: string, myName: string, myAvatar: string): Promise<void> {
        try {
            console.log(`📤 [Contact Request] Sending request to ${toAddress}`);

            const escapeSql = (str: string) => str.replace(/'/g, "''");

            // Get my Maxima address to include in the request
            const myMaximaInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myAddress = (myMaximaInfo.response as any).contact;

            const payload = {
                type: "contact_request",
                name: myName,
                avatar: myAvatar,
                from_address: myAddress,  // Include sender's address for reply
                timestamp: Date.now()
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            const sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: false,  // Use poll:false for immediate delivery
            };

            // Determine the recipient's hex publickey - this is what we'll use consistently
            // If toAddress is a Maxima address, we need to extract/find the hex publickey
            let recipientHexPublicKey = toAddress;

            if (toAddress.startsWith("Mx") || toAddress.startsWith("MX")) {
                sendParams.to = toAddress;

                // Try to find the hex publickey from Discovery DB
                try {
                    // Extract the encoded part (between MX and @)
                    const parts = toAddress.split('@');
                    if (parts.length > 0) {
                        const encoded = parts[0].substring(2); // Remove "MX" prefix

                        // Search Discovery DB for this address
                        const discoverySql = `SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE ADDRESS LIKE '%${escapeSql(encoded)}%' LIMIT 1`;
                        const discoveryRes = await this.runSQL(discoverySql);
                        if (discoveryRes.rows && discoveryRes.rows.length > 0) {
                            recipientHexPublicKey = discoveryRes.rows[0].PUBLICKEY;
                            console.log(`🔍 [Contact Request] Found hex publickey from Discovery: ${recipientHexPublicKey}`);
                        }
                    }
                } catch (err) {
                    console.log(`⚠️ [Contact Request] Could not find hex publickey, using address as-is:`, err);
                }
            } else {
                sendParams.publickey = toAddress;
                // toAddress is already hex publickey
            }

            console.log(`🔍 [Contact Request] Using hex publickey identifier: ${recipientHexPublicKey}`);

            const response = await MDS.cmd.maxima({ params: sendParams });

            if (response && (response as any).status === false) {
                throw new Error((response as any).error || "Failed to send contact request");
            }

            console.log("✅ [Contact Request] Request sent successfully");

            // Save a local system message so sender sees the outgoing request in their chat
            const now = Date.now();

            // IMPORTANT: Always use HEX publickey for consistency
            const safeHexPublicKey = escapeSql(recipientHexPublicKey);

            console.log(`🔍 [Contact Request] Saving chat/request with hex publickey: ${recipientHexPublicKey}`);

            // Always insert the system message so it appears in the timeline
            const insertChatSql = `
                INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date)
                VALUES ('', '${safeHexPublicKey}', 'System', 'system', 'Chat request sent', '', 'sent', 0, ${now})
            `;
            await this.runSQL(insertChatSql);
            console.log("✅ [Contact Request] Chat entry created/updated for outgoing request");


            // Save to CONTACT_REQUESTS table so we can detect it as pending
            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myPublicKey = (myInfo.response as any).publickey;
            const safeMyPublicKey = escapeSql(myPublicKey);

            // Use MERGE to handle existing rows (e.g. if we were previously declined, reset to pending)
            const insertRequestSql = `
                MERGE INTO CONTACT_REQUESTS (from_publickey, to_publickey, from_name, status, created_at, updated_at)
                KEY(from_publickey, to_publickey)
                VALUES ('${safeMyPublicKey}', '${safeHexPublicKey}', '${escapeSql(myName)}', 'pending', ${now}, ${now})
            `;
            await this.runSQL(insertRequestSql);
            console.log(`✅ [Contact Request] Outgoing request saved with to_publickey: ${recipientHexPublicKey}`);
        } catch (err) {
            console.error("❌ [Contact Request] Error sending request:", err);
            throw err;
        }
    }

    /**
     * Get chat permission setting
     */
    async getChatPermission(): Promise<boolean> {
        try {
            // Check DB first (Source of Truth)
            const sql = "SELECT allow_non_contact_chats FROM MY_PROFILE WHERE id=1 LIMIT 1";
            const res = await this.runSQL(sql);

            if (res && res.rows && res.rows.length > 0) {
                const rawValue = res.rows[0].ALLOW_NON_CONTACT_CHATS ?? res.rows[0].allow_non_contact_chats;
                // Handle 1/0, "true"/"false", boolean
                return (rawValue === 1 || rawValue === "1" || rawValue === true || rawValue === "true");
            }

            // Fallback to Keypair
            const resKp = await MDS.keypair.get('allow_noncontact_chats');
            if (resKp && resKp.status && resKp.value !== undefined) {
                return resKp.value === 'true';
            }

            return true; // Default to true if not set
        } catch (err) {
            console.error("❌ [Settings] Error getting chat permission:", err);
            return true; // Default to true on error
        }
    }

    /**
     * Get a contact's chat permission setting from DISCOVERED_PEERS
     * This checks if THEY allow receiving chats from non-contacts
     */
    async getContactChatPermission(contactPublicKey: string): Promise<boolean> {
        try {
            console.log(`🔍 [CHAT-PERM] Checking permission for contact: ${contactPublicKey.substring(0, 10)}...`);

            const escapeSql = (str: string) => str.replace(/'/g, "''");
            const safeKey = escapeSql(contactPublicKey);
            const sql = `SELECT allow_non_contact_chats FROM DISCOVERED_PEERS WHERE publickey='${safeKey}'`;

            const res = await this.runSQL(sql);
            console.log(`📊 [CHAT-PERM] Query result:`, res);

            if (res && res.rows && res.rows.length > 0) {
                const row = res.rows[0];
                const allowNonContactChats = row.ALLOW_NON_CONTACT_CHATS;

                // Handle boolean, integer, AND string values (true/'true'/1/'1' = true, false/'false'/0/'0' = false)
                const permissionGranted = (
                    allowNonContactChats === true ||
                    allowNonContactChats === 1 ||
                    allowNonContactChats === 'true' ||
                    allowNonContactChats === '1'
                );

                console.log(`✅ [CHAT-PERM] Contact ${contactPublicKey.substring(0, 10)}... allowNonContactChats: ${permissionGranted} (raw: ${allowNonContactChats})`);
                return permissionGranted;
            } else {
                console.log(`⚠️ [CHAT-PERM] Contact not found in DISCOVERED_PEERS, defaulting to TRUE`);
                return true; // Default to allowing if not found (they haven't broadcast their preference yet)
            }
        } catch (err) {
            console.error("❌ [CHAT-PERM] Error getting contact permission:", err);
            return true; // Default to true on error
        }
    }

    /**
     * Save incoming contact request to database
     */
    async saveChatRequest(fromPublicKey: string, fromName: string, fromAvatar: string, _toPublicKey: string, fromAddress?: string): Promise<void> {
        try {
            const now = Date.now();

            // Get the correct public key from Maxima (don't trust the 'to' field from the event)
            const maximaInfo = await MDS.cmd.maxima({ params: { action: "info" } });
            const toPublicKey = (maximaInfo.response as any)?.publickey || _toPublicKey;

            console.log("💾 [Contact Request] Saving request:");
            console.log("  from:", fromPublicKey);
            console.log("  to (from event):", _toPublicKey);
            console.log("  to (from maxima info):", toPublicKey);
            console.log("  name:", fromName);

            // Escape single quotes for SQL
            const escapeSql = (str: string) => str.replace(/'/g, "''");

            const safeFromPublicKey = escapeSql(fromPublicKey);
            const safeFromName = escapeSql(fromName);
            const safeFromAvatar = escapeSql(fromAvatar);
            const safeToPublicKey = escapeSql(toPublicKey);
            const safeFromAddress = fromAddress ? escapeSql(fromAddress) : '';

            // Nuclear Option: Delete any existing request logic
            // This replaces the complex 'supersede' and 'merge' logic which was causing duplicates/bugs
            // Nuclear Option: Delete any existing request for this pair to ensure fresh state
            // This prevents duplicates and ensures strict 'pending' status
            const deleteSql = `DELETE FROM CONTACT_REQUESTS WHERE from_publickey='${safeFromPublicKey}' AND to_publickey='${safeToPublicKey}'`;
            await this.runSQL(deleteSql);

            console.log("✅ [Contact Request] Inserting fresh request");
            await this.runSQL(`
                INSERT INTO CONTACT_REQUESTS (from_publickey, from_name, from_avatar, to_publickey, from_address, status, created_at, updated_at)
                VALUES ('${safeFromPublicKey}', '${safeFromName}', '${safeFromAvatar}', '${safeToPublicKey}', '${safeFromAddress}', 'pending', ${now}, ${now})
            `);
            console.log("✅ [Contact Request] Saved to database");

            // Send delivery confirmation back to sender
            console.log("📤 [Contact Request] Sending delivery confirmation to sender");
            const confirmPayload = {
                type: "contact_request_received",
                timestamp: Date.now()
            };

            const confirmJsonStr = JSON.stringify(confirmPayload);
            const confirmHexData = "0x" + this.utf8ToHex(confirmJsonStr).toUpperCase();

            await MDS.cmd.maxima({
                params: {
                    action: "send",
                    publickey: safeFromPublicKey,
                    application: "metachain",
                    data: confirmHexData,
                    poll: false  // Confirmation doesn't need polling
                } as any
            });
            console.log("✅ [Contact Request] Delivery confirmation sent");

            // Create a chat entry so it appears in the chat list
            // Always insert the system message so it appears in the timeline
            // DUPLICATE FIX: Service worker already inserts "Contact request received", so we don't need this one.
            // const insertChatSql = `
            //     INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date)
            //     VALUES ('', '${safeFromPublicKey}', 'System', 'system', '${safeFromName} sent a contact request', '', 'received', 0, ${now})
            // `;
            // await this.runSQL(insertChatSql);
            console.log("✅ [Contact Request] Chat entry creation skipped (Service Worker handles it)");
        } catch (err) {
            console.error("❌ [Contact Request] Error saving request:", err);
            throw err;
        }
    }

    /**
     * Check if there's a pending contact request from me to this user
     * Searches by BOTH hex publickey AND Maxima address to handle both formats
     */
    async checkPendingChatRequest(publickey: string): Promise<boolean> {
        try {
            console.log(`🔍 [checkPendingContactRequest] Checking for identifier: ${publickey}`);
            const escapeSql = (str: string) => str.replace(/'/g, "''");

            // RESOLUTION: Ensure we are checking against the Hex Public Key
            let checkPublicKey = publickey;
            let checkAddress: string | null = null; // Also check address if available

            if (publickey.startsWith("Mx") || publickey.startsWith("MX")) {
                checkAddress = publickey;
                // Try to resolve to public key
                try {
                    const safeAddr = escapeSql(publickey);
                    // Check Discovery first
                    const discoverySql = `SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE ADDRESS LIKE '%${safeAddr}%' LIMIT 1`;
                    const discoveryRes = await this.runSQL(discoverySql);
                    if (discoveryRes.rows && discoveryRes.rows.length > 0) {
                        checkPublicKey = discoveryRes.rows[0].PUBLICKEY;
                        console.log(`🔍 [checkPendingContactRequest] Resolved ${publickey} -> ${checkPublicKey}`);
                    } else {
                        console.log(`⚠️ [checkPendingContactRequest] Could not resolve ${publickey} to Hex Key`);
                    }
                } catch (e) {
                    console.error("Error resolving key in pending check:", e);
                }
            } else {
                // It is a public key, try to find address for completeness (handled below originally)
            }

            const safePublicKey = escapeSql(checkPublicKey);

            // Get my own publickey first
            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myPublicKey = (myInfo.response as any).publickey;
            const safeMyPublicKey = escapeSql(myPublicKey);

            // Try to get the Maxima address from DB if we don't have it yet
            if (!checkAddress && checkPublicKey.startsWith("0x")) {
                try {
                    const discoverySql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='${safePublicKey}' LIMIT 1`;
                    const discoveryRes = await this.runSQL(discoverySql);
                    if (discoveryRes.rows && discoveryRes.rows.length > 0) {
                        checkAddress = discoveryRes.rows[0].ADDRESS;
                    }
                } catch (err) {
                    // ignore
                }
            }

            // Build SQL to search by BOTH hex publickey AND Maxima address (if available)
            let sql = `SELECT * FROM CONTACT_REQUESTS 
                       WHERE from_publickey = '${safeMyPublicKey}' 
                       AND (to_publickey = '${safePublicKey}'`;

            if (checkAddress) {
                const safeMaximaAddress = escapeSql(checkAddress);
                sql += ` OR to_publickey = '${safeMaximaAddress}'`;
            }

            sql += `) AND status = 'pending'`;

            console.log(`🔍 [checkPendingContactRequest] SQL:`, sql);
            const res = await this.runSQL(sql);
            const hasPending = res.rows && res.rows.length > 0;

            console.log(`🔍 [checkPendingContactRequest] Query result:`, res);
            console.log(`🔍 [checkPendingContactRequest] Has pending: ${hasPending}`);
            console.log(`[Contact Request] Pending check for ${publickey.substring(0, 10)}: ${hasPending}`);
            return hasPending;
        } catch (err) {
            console.error("❌ [Contact Request] Error checking pending request:", err);
            return false; // Fail safe - if can't check, allow chat
        }
    }

    /**
     * Check if there's an incoming pending contact request FROM this user TO me
     */
    async checkIncomingChatRequest(fromPublickey: string): Promise<boolean> {
        try {
            console.log(`🔍 [checkIncomingContactRequest] Checking for incoming request from: ${fromPublickey}`);
            const escapeSql = (str: string) => str.replace(/'/g, "''");
            const safeFromPublicKey = escapeSql(fromPublickey);

            // Get my own publickey
            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myPublicKey = (myInfo.response as any).publickey;
            const safeMyPublicKey = escapeSql(myPublicKey);

            console.log(`🔍 [checkIncomingContactRequest] My publickey: ${myPublicKey}`);
            console.log(`🔍 [checkIncomingContactRequest] From publickey: ${fromPublickey}`);

            // Check if there's a pending request FROM them TO me
            const sql = `SELECT * FROM CONTACT_REQUESTS 
                         WHERE from_publickey = '${safeFromPublicKey}' 
                         AND to_publickey = '${safeMyPublicKey}' 
                         AND status = 'pending'`;

            console.log(`🔍 [checkIncomingContactRequest] SQL:`, sql);
            const res = await this.runSQL(sql);
            const hasIncoming = res.rows && res.rows.length > 0;

            console.log(`🔍 [checkIncomingContactRequest] Query result:`, res);
            console.log(`🔍 [checkIncomingContactRequest] Has incoming: ${hasIncoming}`);
            console.log(`[Contact Request] Incoming check for ${fromPublickey.substring(0, 10)}: ${hasIncoming}`);
            return hasIncoming;
        } catch (err) {
            console.error("❌ [Contact Request] Error checking incoming request:", err);
            return false; // Fail safe
        }
    }

    /**
     * Get pending contact requests for current user
     */
    async getChatRequests(myPublicKey: string): Promise<any[]> {
        try {
            console.log("🔍 [Contact Request] Getting requests for:", myPublicKey);
            const escapeSql = (str: string) => str.replace(/'/g, "''");
            const safePublicKey = escapeSql(myPublicKey);
            const sql = `SELECT * FROM CONTACT_REQUESTS WHERE to_publickey='${safePublicKey}' AND status='pending' ORDER BY created_at DESC`;
            console.log("🔍 [Contact Request] SQL:", sql);
            const result = await this.runSQL(sql);
            console.log("🔍 [Contact Request] Result:", result);
            return result.rows || [];
        } catch (err) {
            console.error("❌ [Contact Request] Error getting requests:", err);
            return [];
        }
    }

    /**
     * Accept a contact request
     */
    async acceptChatRequest(fromPublicKey: string, fromAddress: string): Promise<void> {
        try {
            console.log(`✅ [Contact Request] Accepting request from ${fromPublicKey}`);

            // 1. (Removed) Do NOT add to Maxima contacts automatically. 
            // This is now a separate user action. 
            // "Chat Accepted" != "Maxima Contact".
            console.log(`✅ [Contact Request] Accepted chat permission only.`);

            // 2. Get the request from DB to retrieve the sender's address
            const now = Date.now();
            const escapeSql = (str: string) => str.replace(/'/g, "''");
            const safeFromPublicKey = escapeSql(fromPublicKey);
            const selectSql = `SELECT from_address FROM CONTACT_REQUESTS WHERE from_publickey='${safeFromPublicKey}' AND status='pending' LIMIT 1`;
            const requestResult = await this.runSQL(selectSql);

            const senderAddress = requestResult.rows && requestResult.rows.length > 0
                ? requestResult.rows[0].FROM_ADDRESS
                : fromAddress; // Fallback to parameter if not in DB

            console.log(`📤[Contact Request] Sender address from DB: ${senderAddress || 'not found, using fallback'}`);

            // 3. Update request status in DB
            const updateSql = `UPDATE CONTACT_REQUESTS SET status='accepted', updated_at=${now} WHERE from_publickey='${safeFromPublicKey}' AND status='pending'`;
            await this.runSQL(updateSql);

            // 4. Send acceptance message so they add us too
            // Get my address to include in payload for migration
            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myAddress = (myInfo.response as any).contact;

            const payload = {
                type: "contact_accepted",
                timestamp: Date.now(),
                from_address: myAddress // Include my Mx address so they can migrate the chat
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            console.log(`📤[Contact Request] Sending contact_accepted to ${senderAddress} `);
            console.log(`📤[Contact Request] Payload: `, payload);

            const sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: false,  // Use poll:false like contact_request confirmation
            };

            // Simple strategy: Use address if we have it, otherwise publickey
            if (senderAddress && (senderAddress.startsWith("Mx") || senderAddress.startsWith("MX"))) {
                sendParams.to = senderAddress.replace(/\s/g, "");
                console.log(`📤[Contact Request] Sending via Maxima address: ${sendParams.to.substring(0, 20)}...`);
            } else if (senderAddress && senderAddress.startsWith("0x")) {
                sendParams.publickey = senderAddress;
                console.log(`📤[Contact Request] Sending via publickey: ${senderAddress.substring(0, 20)}...`);
            } else {
                // Fallback to fromPublicKey
                sendParams.publickey = fromPublicKey;
                console.log(`📤[Contact Request] Fallback to publickey: ${fromPublicKey.substring(0, 20)}...`);
            }

            const sendResult = await MDS.cmd.maxima({ params: sendParams });
            console.log(`📤[Contact Request] Send result: `, sendResult);

            // 5. Save system message locally so I see that I accepted it
            // This ensures symmetry: Sender sees "Accepted", Receiver (me) currently only saw "Received".
            // Now Receiver will see "Received" -> "Accepted".
            const insertMsgSql = `
                INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date)
                VALUES ('', '${safeFromPublicKey}', 'System', 'system', 'Chat request accepted', '', 'sent', 0, ${now})
            `;
            await this.runSQL(insertMsgSql);
            console.log("✅ [Contact Request] Local acceptance message saved");

            console.log("✅ [Contact Request] Request accepted and confirmation sent");
        } catch (err) {
            console.error("❌ [Contact Request] Error accepting request:", err);
            throw err;
        }
    }

    /**
     * Decline a contact request
     */
    /**
     * Helper to resolve a public key (0x...) to a Maxima Address (Mx...) using DISCOVERED_PEERS
     */
    async resolveMaximaAddress(publicKey: string): Promise<string | null> {
        if (!publicKey.startsWith('0x')) return publicKey; // Already an address or name?

        const safeKey = publicKey.replace(/'/g, "''");
        const sql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY='${safeKey}' AND ADDRESS IS NOT NULL LIMIT 1`;

        try {
            const res = await this.runSQL(sql);
            if (res.rows && res.rows.length > 0) {
                const addr = res.rows[0].ADDRESS;
                if (addr && (addr.startsWith('Mx') || addr.startsWith('MX'))) {
                    console.log(`🔍 [ADDRESS-RESOLVER] Resolved ${publicKey.substring(0, 10)}... to ${addr.substring(0, 10)}...`);
                    return addr;
                }
            }
        } catch (err) {
            console.error("❌ [ADDRESS-RESOLVER] Error resolving address:", err);
        }

        console.warn(`⚠️ [ADDRESS-RESOLVER] Could not resolve address for ${publicKey.substring(0, 10)}...`);
        return null; // Could not resolve
    }

    /**
     * Decline a contact request
     */
    async declineChatRequest(fromPublicKey: string): Promise<void> {
        try {
            const now = Date.now();
            const escapeSql = (str: string) => str.replace(/'/g, "''");
            const safeFromPublicKey = escapeSql(fromPublicKey);
            const sql = `UPDATE CONTACT_REQUESTS SET status = 'declined', updated_at = ${now} WHERE from_publickey = '${safeFromPublicKey}' AND status = 'pending'`;
            await this.runSQL(sql);
            console.log("✅ [Contact Request] Request declined");

            // Add a system message to the chat
            const chatMessageSql = `
                INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date)
            VALUES('', '${safeFromPublicKey}', 'System', 'system', 'Chat request declined', '', 'sent', 0, ${now})
                `;
            await this.runSQL(chatMessageSql);
            console.log("✅ [Contact Request] Added system message to chat");

            // Send "contact_declined" to the sender so they know to stop being pending
            const payload = {
                type: "contact_declined",
                timestamp: now
            };
            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            console.log(`📤 [Contact Request] Sending decline notification to ${fromPublicKey}`);

            // Resolve Address for Non-Contacts
            const mxAddress = await this.resolveMaximaAddress(fromPublicKey);

            const sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: true  // Enable polling to ensure delivery in background
            };

            if (mxAddress) {
                console.log(`📤 [Contact Request] Using resolved Maxima address: ${mxAddress}`);
                sendParams.to = mxAddress;
            } else {
                console.warn(`⚠️ [Contact Request] Could not resolve address, falling back to publickey (may fail if not contact)`);
                sendParams.publickey = fromPublicKey;
            }

            await MDS.cmd.maxima({ params: sendParams });
            console.log("✅ [Contact Request] Decline notification sent");

        } catch (err) {
            console.error("❌ [Contact Request] Error declining request:", err);
            throw err;
        }
    }

    /**
     * Cancel own outgoing contact request (sender-initiated)
     */
    async cancelChatRequest(toPublicKey: string): Promise<void> {
        try {
            const now = Date.now();
            const escapeSql = (str: string) => str.replace(/'/g, "''");

            // Get my own publickey
            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myPublicKey = (myInfo.response as any).publickey;
            const safeMyPublicKey = escapeSql(myPublicKey);
            const safeToPublicKey = escapeSql(toPublicKey);

            // Resolve address to check both PK and MX address
            let safeToAddress = '';
            console.log(`🔍 [CANCEL DEBUG] Input PublicKey: ${toPublicKey}`);

            if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
                safeToAddress = safeToPublicKey;
                console.log(`🔍 [CANCEL DEBUG] Input IS Address: ${safeToAddress}`);
            } else {
                const addr = await this.resolveMaximaAddress(toPublicKey);
                console.log(`🔍 [CANCEL DEBUG] Resolved Address: ${addr}`);
                if (addr) safeToAddress = escapeSql(addr);
            }

            // 1. SELECT first to find the pending request (Robustness Fix)


            const selectSql = `SELECT * FROM CONTACT_REQUESTS 
                               WHERE from_publickey='${safeMyPublicKey}' 
                               AND (to_publickey='${safeToPublicKey}' ${safeToAddress ? `OR to_publickey='${safeToAddress}'` : ''})
                               AND status='pending'`;

            console.log(`🔍 [CANCEL DEBUG] Search SQL: ${selectSql}`);
            const pendingRows = await this.runSQL(selectSql);

            if (pendingRows && pendingRows.rows && pendingRows.rows.length > 0) {
                const foundToPk = pendingRows.rows[0].TO_PUBLICKEY;
                console.log(`✅ [CANCEL DEBUG] Found pending request for: ${foundToPk}`);

                // DELETE precisely what we found
                const deleteSql = `DELETE FROM CONTACT_REQUESTS 
                                   WHERE from_publickey='${safeMyPublicKey}' 
                                   AND to_publickey='${foundToPk.replace(/'/g, "''")}' 
                                   AND status='pending'`;

                await this.runSQL(deleteSql);
                console.log("✅ [Contact Request] Request cancelled locally (Selected & Deleted)");
            } else {
                console.warn("⚠️ [CANCEL DEBUG] No pending local request found to delete!");
            }

            console.log("✅ [Contact Request] Request cancelled locally");

            // Send cancellation message to the user so they remove it too
            const payload = {
                type: "contact_cancelled",
                timestamp: Date.now()
            };
            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            const sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: true
            };

            if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
                sendParams.to = toPublicKey.trim();
            } else {
                // Use the safeToAddress resolved earlier if available
                if (safeToAddress && (safeToAddress.startsWith("Mx") || safeToAddress.startsWith("MX"))) {
                    sendParams.to = safeToAddress.trim();
                    console.log(`📤 [Contact Request] Sending cancellation to resolved address: ${safeToAddress}`);
                } else {
                    sendParams.publickey = toPublicKey.trim();
                    console.warn(`⚠️ [Contact Request] Sending cancellation to publickey (address not resolved): ${toPublicKey}`);
                }
            }
            try {
                await MDS.cmd.maxima({ params: sendParams });
                console.log("✅ [Contact Request] Cancellation sent to recipient");
            } catch (sendErr) {
                console.warn("⚠️ [Contact Request] Failed to send cancellation:", sendErr);
            }

            // Add a system message to the chat
            const chatMessageSql = `
                INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date)
                VALUES('', '${safeToPublicKey}', 'System', 'system', 'Chat request cancelled', '', 'sent', 0, ${now})
            `;
            await this.runSQL(chatMessageSql);
            console.log("✅ [Contact Request] Added cancellation message to chat");

        } catch (err) {
            console.error("❌ [Contact Request] Error cancelling request:", err);
            throw err;
        }
    }

    /* ----------------------------------------------------------------------------
      MAXIMA CONTACT REQUESTS
    ---------------------------------------------------------------------------- */

    async sendMaximaContactRequest(toAddress: string, toPublicKey?: string): Promise<void> {
        try {
            console.log(`📤 [Maxima Contact] Sending request to ${toAddress}`);

            let myName = "Unknown";
            try {
                const nameRes = await MDS.keypair.get("profile_name");
                if (nameRes?.value) myName = nameRes.value;
            } catch (err) {
                console.log("Could not get profile name");
            }

            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myPublicKey = (myInfo.response as any).publickey;

            let recipientHexPublicKey = toPublicKey ? toPublicKey.trim() : toAddress;

            // If not provided, try to resolve (fallback)
            if (!toPublicKey && (toAddress.startsWith("Mx") || toAddress.startsWith("MX"))) {
                try {
                    const contactsRes = await MDS.cmd.maxcontacts({ action: "list" } as any);
                    const contact = ((contactsRes.response as any)?.contacts || []).find((c: any) =>
                        c.currentaddress === toAddress
                    );
                    if (contact?.publickey) {
                        recipientHexPublicKey = contact.publickey;
                    }
                } catch (err) {
                    console.log(`⚠️ Could not resolve hex publickey:`, err);
                }
            }

            const payload = {
                type: "maxima_contact_request",
                name: myName,
                timestamp: Date.now()
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            // IMPORTANT: Always use 'to' with Maxima address, not 'publickey'
            // Maxima cannot send messages using only publickey if the contact is not added
            const sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: false,
                to: toAddress.replace(/\s/g, "")  // Always use Maxima address
            };

            console.log(`📤 [Maxima Contact] Sending to Address: ${toAddress.substring(0, 30)}...`);

            const sendResult = await MDS.cmd.maxima({ params: sendParams as any });
            console.log("✅ [Maxima Contact] Request sent command result:", sendResult);

            const now = Date.now();
            const escapeSql = (str: string) => str.replace(/'/g, "''");
            const safeMyPk = escapeSql(myPublicKey);
            const safeRecipPk = escapeSql(recipientHexPublicKey);
            const safeMyName = escapeSql(myName);

            // Insert system message for local echo
            const chatSql = `INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) 
                             VALUES('${safeMyName}', '${safeRecipPk}', 'System', 'system', 'Maxima contact request sent', '', 'sent', 0, ${now})`;
            await this.runSQL(chatSql);

            const deleteSql = `DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE from_publickey='${safeMyPk}' AND to_publickey='${safeRecipPk}'`;
            await this.runSQL(deleteSql);

            const insertSql = `
                INSERT INTO MAXIMA_CONTACT_REQUESTS (from_publickey, from_name, to_publickey, status, created_at, updated_at)
                VALUES ('${safeMyPk}', '${safeMyName}', '${safeRecipPk}', 'pending', ${now}, ${now})
            `;
            await this.runSQL(insertSql);

            console.log("✅ [Maxima Contact] Request sent and saved locally");
        } catch (err) {
            console.error("❌ [Maxima Contact] Error sending request:", err);
            throw err;
        }
    }

    async acceptMaximaContactRequest(fromPublicKey: string, fromAddress: string): Promise<void> {
        try {
            console.log(`✅ [Maxima Contact] Accepting request from ${fromPublicKey}`);

            if (fromAddress) {
                console.log(`📇 Adding ${fromAddress} to maxcontacts`);
                await MDS.cmd.maxcontacts({
                    action: "add",
                    contact: fromAddress
                } as any);
                console.log(`✅ Added to maxcontacts`);
            }

            const now = Date.now();
            const escapeSql = (str: string) => str.replace(/'/g, "''");
            const safeFromPk = escapeSql(fromPublicKey);

            const updateSql = `UPDATE MAXIMA_CONTACT_REQUESTS SET status='accepted', updated_at=${now} WHERE from_publickey='${safeFromPk}' AND status='pending'`;
            await this.runSQL(updateSql);

            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myAddress = (myInfo.response as any).contact;

            // Save system message locally (mirroring acceptChatRequest)
            const insertMsgSql = `
                INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date)
                VALUES ('', '${safeFromPk}', 'System', 'system', 'Maxima contact accepted', '', 'sent', 0, ${now})
            `;
            await this.runSQL(insertMsgSql);

            const payload = {
                type: "maxima_contact_accepted",
                timestamp: Date.now(),
                from_address: myAddress
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            const sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: true
            };

            if (fromAddress.startsWith("Mx") || fromAddress.startsWith("MX")) {
                sendParams.to = fromAddress.replace(/\s/g, ""); // Aggressive sanitization
            } else {
                sendParams.publickey = fromAddress;
            }

            await MDS.cmd.maxima({ params: sendParams });
            console.log("✅ [Maxima Contact] Acceptance sent");
        } catch (err) {
            console.error("❌ [Maxima Contact] Error accepting request:", err);
            throw err;
        }
    }

    async declineMaximaContactRequest(fromPublicKey: string, _fromAddress: string): Promise<void> {
        try {
            console.log(`🚫 [Maxima Contact] Declining request from ${fromPublicKey}`);

            const now = Date.now();
            const escapeSql = (str: string) => str.replace(/'/g, "''");
            const safeFromPk = escapeSql(fromPublicKey);

            const updateSql = `UPDATE MAXIMA_CONTACT_REQUESTS SET status='declined', updated_at=${now} WHERE from_publickey='${safeFromPk}' AND status='pending'`;
            await this.runSQL(updateSql);

            // Save system message locally (mirroring declineChatRequest)
            const insertMsgSql = `
                INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date)
                VALUES ('', '${safeFromPk}', 'System', 'system', 'Maxima contact declined', '', 'sent', 0, ${now})
            `;
            await this.runSQL(insertMsgSql);

            const mxAddress = await this.resolveMaximaAddress(fromPublicKey);

            const payload = {
                type: "maxima_contact_declined",
                timestamp: now
            };

            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            const sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: true
            };

            if (mxAddress) {
                sendParams.to = mxAddress.trim();
            } else {
                sendParams.publickey = fromPublicKey;
            }

            await MDS.cmd.maxima({ params: sendParams });
            console.log("✅ [Maxima Contact] Decline sent");
        } catch (err) {
            console.error("❌ [Maxima Contact] Error declining:", err);
            throw err;
        }
    }

    /**
     * Cancel own outgoing Maxima contact request (sender-initiated)
     */
    async cancelMaximaContactRequest(toPublicKey: string): Promise<void> {
        try {
            console.log(`🔍 [CANCEL MAXIMA DEBUG] Input PublicKey: ${toPublicKey}`);
            const escapeSql = (str: string) => str.replace(/'/g, "''");

            // Get my own publickey
            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myPublicKey = (myInfo.response as any).publickey;
            const safeMyPk = escapeSql(myPublicKey);
            const safeToPk = escapeSql(toPublicKey);

            // Resolve address to check both PK and MX address check
            let safeToAddress = '';
            if (toPublicKey.startsWith('Mx') || toPublicKey.startsWith('MX')) {
                safeToAddress = safeToPk;
                console.log(`🔍 [CANCEL MAXIMA DEBUG] Input IS Address: ${safeToAddress}`);
            } else {
                const addr = await this.resolveMaximaAddress(toPublicKey);
                console.log(`🔍 [CANCEL MAXIMA DEBUG] Resolved Address: ${addr}`);
                if (addr) safeToAddress = escapeSql(addr);
            }

            // 1. SELECT first to find the pending request (Robustness Fix)
            const selectSql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS 
                               WHERE from_publickey='${safeMyPk}' 
                               AND (to_publickey='${safeToPk}' ${safeToAddress ? `OR to_publickey='${safeToAddress}'` : ''})
                               AND status='pending'`;

            console.log(`🔍 [CANCEL MAXIMA DEBUG] Search SQL: ${selectSql}`);
            const pendingRows = await this.runSQL(selectSql);

            if (pendingRows && pendingRows.rows && pendingRows.rows.length > 0) {
                const foundToPk = pendingRows.rows[0].TO_PUBLICKEY;
                console.log(`✅ [CANCEL MAXIMA DEBUG] Found pending request for: ${foundToPk}`);

                // DELETE precisely what we found
                const deleteSql = `DELETE FROM MAXIMA_CONTACT_REQUESTS 
                                   WHERE from_publickey='${safeMyPk}' 
                                   AND to_publickey='${foundToPk.replace(/'/g, "''")}' 
                                   AND status='pending'`;

                await this.runSQL(deleteSql);
                console.log("✅ [Maxima Contact] Request cancelled locally (Selected & Deleted)");
            } else {
                console.warn("⚠️ [CANCEL MAXIMA DEBUG] No pending local request found to delete!");
            }

            // 2. Send cancellation message to recipient
            const payload = {
                type: "maxima_contact_cancelled",
                timestamp: Date.now()
            };
            const jsonStr = JSON.stringify(payload);
            const hexData = "0x" + this.utf8ToHex(jsonStr).toUpperCase();

            const sendParams: any = {
                action: "send",
                application: "metachain",
                data: hexData,
                poll: true
            };

            if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
                sendParams.to = toPublicKey.trim();
            } else {
                // Use resolved address
                if (safeToAddress && (safeToAddress.startsWith("Mx") || safeToAddress.startsWith("MX"))) {
                    sendParams.to = safeToAddress.trim();
                    console.log(`📤 [Maxima Contact] Sending cancellation to resolved address: ${safeToAddress}`);
                } else {
                    sendParams.publickey = toPublicKey.trim();
                    console.warn(`⚠️ [Maxima Contact] Sending cancellation to publickey (address not resolved): ${toPublicKey}`);
                }
            }
            try {
                await MDS.cmd.maxima({ params: sendParams });
                console.log("✅ [Maxima Contact] Cancellation sent to recipient");

                // Insert visual system message locally
                const now = Date.now();
                const sqlLocal = `INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date) 
                                  VALUES('', '${safeToPk}', 'System', 'system', 'Maxima contact request cancelled', '', 'sent', 0, ${now})`;
                await this.runSQL(sqlLocal);

            } catch (sendErr) {
                console.warn("⚠️ [Maxima Contact] Failed to send cancellation:", sendErr);
            }

        } catch (err) {
            console.error("❌ [Maxima Contact] Error cancelling request:", err);
            throw err;
        }
    }

    async getMaximaContactRequests(myPublicKey: string): Promise<any[]> {
        try {
            const escapeSql = (str: string) => str.replace(/'/g, "''");
            const safePk = escapeSql(myPublicKey);

            const sql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS WHERE to_publickey='${safePk}' AND status='pending' ORDER BY created_at DESC`;
            const result = await this.runSQL(sql);
            return result.rows || [];
        } catch (err) {
            console.error("❌ [Maxima Contact] Error getting requests:", err);
            return [];
        }
    }

    async saveMaximaContactRequest(fromPublicKey: string, fromName: string): Promise<void> {
        try {
            console.log("💾 [Maxima Contact] Saving request from:", fromPublicKey);

            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myPublicKey = (myInfo.response as any).publickey;

            const now = Date.now();
            const escapeSql = (str: string) => str.replace(/'/g, "''");
            const safeFromPk = escapeSql(fromPublicKey);
            const safeFromName = escapeSql(fromName);
            const safeMyPk = escapeSql(myPublicKey);

            const deleteSql = `DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE from_publickey='${safeFromPk}' AND to_publickey='${safeMyPk}'`;
            await this.runSQL(deleteSql);

            const insertSql = `
                INSERT INTO MAXIMA_CONTACT_REQUESTS (from_publickey, from_name, to_publickey, status, created_at, updated_at)
                VALUES ('${safeFromPk}', '${safeFromName}', '${safeMyPk}', 'pending', ${now}, ${now})
            `;
            await this.runSQL(insertSql);

            console.log("✅ [Maxima Contact] Request saved");
        } catch (err) {
            console.error("❌ [Maxima Contact] Error saving request:", err);
            throw err;
        }
    }
    // ============================================================================
    // BACKWARD COMPATIBILITY ALIASES (Refactoring Contact -> Chat Requests)
    // ============================================================================

    /** @deprecated Use sendChatRequest */
    async sendContactRequest(toAddress: string, myName: string, myAvatar: string): Promise<void> {
        return this.sendChatRequest(toAddress, myName, myAvatar);
    }

    /** @deprecated Use saveChatRequest */
    async saveContactRequest(fromPublicKey: string, fromName: string, fromAvatar: string, _toPublicKey: string, fromAddress?: string): Promise<void> {
        return this.saveChatRequest(fromPublicKey, fromName, fromAvatar, _toPublicKey, fromAddress);
    }

    /** @deprecated Use checkPendingChatRequest */
    async checkPendingContactRequest(publickey: string): Promise<boolean> {
        return this.checkPendingChatRequest(publickey);
    }

    /** @deprecated Use checkIncomingChatRequest */
    async checkIncomingContactRequest(fromPublickey: string): Promise<boolean> {
        return this.checkIncomingChatRequest(fromPublickey);
    }

    /** @deprecated Use getChatRequests */
    async getContactRequests(myPublicKey: string): Promise<any[]> {
        return this.getChatRequests(myPublicKey);
    }

    /** @deprecated Use acceptChatRequest */
    async acceptContactRequest(fromPublicKey: string, fromAddress: string): Promise<void> {
        return this.acceptChatRequest(fromPublicKey, fromAddress);
    }

    /** @deprecated Use declineChatRequest */
    async declineContactRequest(fromPublicKey: string): Promise<void> {
        return this.declineChatRequest(fromPublicKey);
    }

    /** @deprecated Use cancelChatRequest */
    async cancelContactRequest(toPublicKey: string): Promise<void> {
        return this.cancelChatRequest(toPublicKey);
    }
}

export const minimaService = new MinimaService();
