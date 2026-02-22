/**
 * Chat Service - Chat and message management
 * Handles: messages, chat status, archiving, favorites, muting
 */

import { MDS } from "@minima-global/mds";
import { runSQL } from "./database.service";

import { LocalNotifications } from '@capacitor/local-notifications';
import { Badge } from '@capawesome/capacitor-badge';

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
    sender_seq?: number;
    originalTimestamp?: number;
}

export type MessageCallback = (msg: any) => void;

class ChatService {
    private newMessageCallbacks: MessageCallback[] = [];
    private muteStatusCallbacks: (() => void)[] = [];
    private archiveStatusCallbacks: (() => void)[] = [];
    private favoriteStatusCallbacks: (() => void)[] = [];

    /* ----------------------------------------------------------------------------
      BADGE / NOTIFICATION MANAGEMENT (Android "Badge" via Notifications)
    ---------------------------------------------------------------------------- */
    async requestNotificationPermission() {
        try {
            const result = await LocalNotifications.requestPermissions();
            if (result.display === 'granted') {
                console.log("✅ [NOTIFICATIONS] Permission granted");
            } else {
                console.warn("⚠️ [NOTIFICATIONS] Permission denied / limited");
            }
        } catch (err) {
            console.error("❌ [NOTIFICATIONS] Failed to request permission:", err);
        }
    }

    async clearNotifications() {
        try {
            // Cancel our specific badge notification ID (999)
            await LocalNotifications.cancel({ notifications: [{ id: 999 }] });
            // Also clear badge count if supported by OS/Launcher
            // await LocalNotifications.removeAllDeliveredNotifications(); // Optional
        } catch (err) {
            // Put it in a try/catch as it might fail on Web or some envs
            console.warn("⚠️ [NOTIFICATIONS] clearNotifications failed (swallowed):", err);
        }
    }

    async updateUnreadNotification() {
        // Only run if native (optional check)
        try {
            const sql = `
                SELECT COUNT(*) as count 
                FROM CHAT_MESSAGES m
                LEFT JOIN CHAT_STATUS s ON m.publickey = s.publickey
                WHERE m.username != 'Me' 
                AND (s.last_opened IS NULL OR m.date > s.last_opened)
            `;
            MDS.sql(sql, async (res: any) => {
                if (res.status && res.rows && res.rows.length > 0) {
                    const count = parseInt(res.rows[0].COUNT);
                    console.log("🔴 [NOTIFICATIONS] Unread count:", count);

                    if (count > 0) {
                        // Schedule or Update notification
                        await LocalNotifications.schedule({
                            notifications: [
                                {
                                    title: "MetaChain",
                                    body: `You have ${count} unread message${count > 1 ? 's' : ''}`,
                                    id: 999, // Constant ID to update the same notification
                                    schedule: { at: new Date(Date.now() + 100) }, // Immediate
                                    sound: undefined, // Default sound or null
                                    attachments: undefined,
                                    actionTypeId: "",
                                    extra: {
                                        unreadCount: count
                                    },
                                    // Android specific:
                                    smallIcon: "ic_stat_icon_config_sample", // Use default or configure custom
                                    iconColor: "#488AFF"
                                }
                            ]
                        });

                        try {
                            await Badge.set({ count });
                        } catch (e) {
                            console.warn("⚠️ [BADGE] Failed to set badge:", e);
                        }
                    } else {
                        // If 0, ensure notification is gone
                        await this.clearNotifications();
                        try {
                            await Badge.clear();
                        } catch (e) {
                            console.warn("⚠️ [BADGE] Failed to clear badge:", e);
                        }
                    }
                }
            });
        } catch (err) {
            console.error("❌ [NOTIFICATIONS] Failed to update notification:", err);
        }
    }

    /* ----------------------------------------------------------------------------
      CHAT STATUS (Archive, Favorite, Mute)
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
                    resolve();
                } else {
                    console.log("✅ [SQL] Chat marked as opened");
                    // Also mark all messages in this chat as read
                    // NOTE: The 'read' column in CHAT_MESSAGES is what we use for the badge.
                    // We should update it here.
                    const updateReadSql = `UPDATE CHAT_MESSAGES SET read=1 WHERE publickey='${publickey}' AND read=0`;
                    MDS.sql(updateReadSql, () => {
                        this.updateUnreadNotification(); // UPDATE BADGE AFTER OPENING
                        resolve();
                    });
                }
            });
        });
    }

    setAppInstalled(publickey: string): Promise<void> {
        return new Promise((resolve) => {
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

    blockContact(publickey: string): Promise<void> {
        return new Promise((resolve) => {
            const sql = `
                MERGE INTO CHAT_STATUS (publickey, blocked)
                KEY (publickey)
                VALUES ('${publickey}', TRUE)
            `;
            MDS.sql(sql, (res: any) => {
                if (res.status) {
                    console.log("🚫 [DB] Contact blocked:", publickey);
                    // Notify any listeners
                    this.notifyMuteStatusChange(); // Re-use mute notification or add new one? 
                    // Let's add a generic status change or just rely on re-check
                } else {
                    console.error("❌ [DB] Failed to block contact:", res.error);
                }
                resolve();
            });
        });
    }

    unblockContact(publickey: string): Promise<void> {
        return new Promise((resolve) => {
            const sql = `UPDATE CHAT_STATUS SET blocked=FALSE WHERE publickey='${publickey}'`;
            MDS.sql(sql, (res: any) => {
                if (res.status) {
                    console.log("✅ [DB] Contact unblocked:", publickey);
                } else {
                    console.error("❌ [DB] Failed to unblock contact:", res.error);
                }
                resolve();
            });
        });
    }

    getChatStatus(publickey: string): Promise<{ archived: boolean; lastOpened: number | null; favorite: boolean; blocked: boolean; blockedByThem: boolean }> {
        return new Promise((resolve) => {
            const sql = `SELECT * FROM CHAT_STATUS WHERE publickey='${publickey}'`;
            MDS.sql(sql, (res: any) => {
                if (!res.status || !res.rows || res.rows.length === 0) {
                    resolve({ archived: false, lastOpened: null, favorite: false, blocked: false, blockedByThem: false });
                    return;
                }
                const row = res.rows[0];
                console.log("🔍 [DB DEBUG] Chat Status Row:", row); // DEBUG
                resolve({
                    archived: row.ARCHIVED === true || row.ARCHIVED === 'TRUE' || row.ARCHIVED === 'true' || row.ARCHIVED === 1,
                    lastOpened: row.LAST_OPENED ? Number(row.LAST_OPENED) : null,
                    favorite: row.FAVORITE === true || row.FAVORITE === 'TRUE' || row.FAVORITE === 'true' || row.FAVORITE === 1 || false,
                    blocked: row.BLOCKED === true || row.BLOCKED === 'TRUE' || row.BLOCKED === 'true' || row.BLOCKED === 1 || false,
                    blockedByThem: row.BLOCKED_BY_THEM === true || row.BLOCKED_BY_THEM === 'TRUE' || row.BLOCKED_BY_THEM === 'true' || row.BLOCKED_BY_THEM === 1 || false
                });
            });
        });
    }
    async insertMessage(msg: ChatMessage) {
        const { roomname, publickey, username, type, message, filedata = "", state = "", amount = 0, date, sender_seq, originalTimestamp, customid } = msg;

        // SAFE ESCAPING FOR ALL STRINGS
        const safeRoomname = roomname.replace(/'/g, "''");
        const safeKey = publickey.replace(/'/g, "''");
        const safeUsername = username.replace(/'/g, "''");
        // const safeType = type.replace(/'/g, "''"); // Types are usually strict enums
        const escapedMsg = message.replace(/'/g, "''");
        const safeFiledata = filedata ? filedata.replace(/'/g, "''") : "";
        const safeCustomId = (customid || "0x00").replace(/'/g, "''");

        const timestamp = date || Date.now();
        const msgOriginalTimestamp = originalTimestamp || timestamp;
        const sqlSeq = (sender_seq === null || sender_seq === undefined) ? "0" : sender_seq;

        const sql = `
            INSERT INTO CHAT_MESSAGES (roomname,publickey,username,type,message,filedata,state,amount,date,customid,sender_seq,original_timestamp)
            VALUES ('${safeRoomname}','${safeKey}','${safeUsername}','${type}','${escapedMsg}','${safeFiledata}','${state}',${amount},${timestamp},'${safeCustomId}', ${sqlSeq}, ${msgOriginalTimestamp})
        `;
        console.log("📥 [CHAT-DB] Inserting message:", { type, seq: sqlSeq, customid: safeCustomId });
        try {
            await runSQL(sql);
            console.log("✅ [CHAT-DB] Insert success");

            // Update badge count if message is not from 'Me'
            if (username !== 'Me') {
                this.updateUnreadNotification();
            }
        } catch (err) {
            console.error("❌ [SQL] INSERT failed:", err);
            console.error("❌ [SQL] FAILED QUERY:", sql);
        }
    }

    updateMessageState(publickey: string, date: number, state: string, txpowid?: string, sender_seq?: number): Promise<void> {
        return new Promise((resolve) => {
            const safeKey = publickey.replace(/'/g, "''");
            let sql = `UPDATE CHAT_MESSAGES SET state='${state}'`;
            if (txpowid) sql += `, txpowid='${txpowid.replace(/'/g, "''")}'`;
            if (sender_seq !== undefined) sql += `, sender_seq=${sender_seq}`;

            // Where clause
            // We use date (timestamp) as the primary identifier along with publickey for now
            sql += ` WHERE publickey='${safeKey}' AND date=${date}`;

            MDS.sql(sql, (res: any) => {
                if (!res.status) console.error("❌ [DB] Update state failed:", res.error);
                resolve();
            });
        });
    }

    getMessages(publickey: string): Promise<ChatMessage[]> {
        return new Promise((resolve) => {
            const sql = `
                SELECT * FROM CHAT_MESSAGES
                WHERE publickey='${publickey}'
                ORDER BY COALESCE(original_timestamp, date) ASC, sender_seq ASC, id ASC
            `;
            MDS.sql(sql, (res: any) => {
                if (!res.status || !res.rows) {
                    resolve([]);
                    return;
                }
                // FILTER: Remove messages that are strictly "undefined" string
                const validRows = res.rows.filter((r: any) => r.MESSAGE !== 'undefined');
                resolve(validRows);
            });
        });
    }

    getLastMessageTimestamp(publickey: string): Promise<number> {
        return new Promise((resolve) => {
            const sql = `
                SELECT MAX(date) as last_date FROM CHAT_MESSAGES
                WHERE publickey='${publickey}'
            `;
            MDS.sql(sql, (res: any) => {
                if (!res.status || !res.rows || res.rows.length === 0 || !res.rows[0].LAST_DATE) {
                    resolve(0); // No messages, return 0
                    return;
                }
                resolve(Number(res.rows[0].LAST_DATE));
            });
        });
    }

    deleteAllMessages(publickey: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM CHAT_MESSAGES WHERE publickey='${publickey}'`;
            console.log("🔥 [CHAT-DB-DEBUG] DELETING ALL MESSAGES for:", publickey);
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
            const sql = `
                SELECT 
                    m.*,
                    s.archived,
                    s.last_opened,
                    s.favorite,
                    COALESCE(d.alias, u.alias) as discovery_alias,
                    d.avatar as discovery_avatar,
                    d.address as discovery_address
                FROM CHAT_MESSAGES m
                LEFT JOIN CHAT_STATUS s ON m.publickey = s.publickey
                LEFT JOIN DISCOVERED_PEERS d ON UPPER(m.publickey) = UPPER(d.publickey)
                LEFT JOIN METACHAIN_USERS u ON UPPER(m.publickey) = UPPER(u.publickey)
                ORDER BY COALESCE(m.original_timestamp, m.date) DESC, m.sender_seq DESC, m.id DESC
            `;

            MDS.sql(sql, (res: any) => {
                if (!res.status) {
                    console.warn("⚠️ [SQL] Complex query failed, falling back to simple query:", res.error);
                    const simpleSql = `SELECT * FROM CHAT_MESSAGES ORDER BY COALESCE(original_timestamp, date) DESC, sender_seq DESC, id DESC`;
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
        const chatMap = new Map<string, any>();

        rows.forEach((row: any) => {
            const publickey = row.PUBLICKEY;

            // FILTER: Skip "undefined" messages
            if (row.MESSAGE === 'undefined') {
                return;
            }

            if (!chatMap.has(publickey)) {
                // Use original_timestamp if available for the preview date
                // This ensures the chat list sort order matches the message bubble sort order
                const displayDate = (row.ORIGINAL_TIMESTAMP && Number(row.ORIGINAL_TIMESTAMP) > 0)
                    ? Number(row.ORIGINAL_TIMESTAMP)
                    : Number(row.DATE);

                chatMap.set(publickey, {
                    publickey: row.PUBLICKEY,
                    currentaddress: row.DISCOVERY_ADDRESS,
                    roomname: row.DISCOVERY_ALIAS || row.ROOMNAME || "Unknown",
                    avatar: row.DISCOVERY_AVATAR,
                    lastMessage: row.MESSAGE,
                    lastMessageType: row.TYPE,
                    lastMessageDate: displayDate,
                    lastMessageAmount: row.AMOUNT,
                    username: row.USERNAME,
                    archived: row.ARCHIVED === true || row.ARCHIVED === 'TRUE' || row.ARCHIVED === 'true' || row.ARCHIVED === 1 || false,
                    lastOpened: row.LAST_OPENED ? Number(row.LAST_OPENED) : null,
                    favorite: row.FAVORITE === true || row.FAVORITE === 'TRUE' || row.FAVORITE === 'true' || row.FAVORITE === 1 || false,
                    unreadCount: 0
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

                if (!isFromMe && (!lastOpened || messageDate > lastOpened)) {
                    chat.unreadCount++;
                }
            }
        });

        // Convert map to array and sort: favorites first, then active chats, then archived
        const chats = Array.from(chatMap.values()).sort((a, b) => {
            if (a.archived !== b.archived) {
                return a.archived ? 1 : -1;
            }
            if (!a.archived && !b.archived && a.favorite !== b.favorite) {
                return a.favorite ? -1 : 1;
            }
            return b.lastMessageDate - a.lastMessageDate;
        });

        resolve(chats);
    }

    /* ----------------------------------------------------------------------------
      CALLBACKS
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

    notifyNewMessage(msg: any) {
        this.newMessageCallbacks.forEach(cb => cb(msg));
    }

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
}

export const chatService = new ChatService();
