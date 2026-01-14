/**
 * Chat Service - Chat and message management
 * Handles: messages, chat status, archiving, favorites, muting
 */

import { MDS } from "@minima-global/mds";
import { runSQL } from "./database.service";

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

export type MessageCallback = (msg: any) => void;

class ChatService {
    private newMessageCallbacks: MessageCallback[] = [];
    private muteStatusCallbacks: (() => void)[] = [];
    private archiveStatusCallbacks: (() => void)[] = [];
    private favoriteStatusCallbacks: (() => void)[] = [];

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
                    resolve();
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

    /* ----------------------------------------------------------------------------
      MESSAGE OPERATIONS
    ---------------------------------------------------------------------------- */
    async insertMessage(msg: ChatMessage & { date?: number }) {
        const { roomname, publickey, username, type, message, filedata = "", state = "", amount = 0, date } = msg;
        const escapedMsg = message.replace(/'/g, "''");
        const timestamp = date || Date.now();
        const sql = `
            INSERT INTO CHAT_MESSAGES (roomname,publickey,username,type,message,filedata,state,amount,date)
            VALUES ('${roomname}','${publickey}','${username}','${type}','${escapedMsg}','${filedata}','${state}',${amount},${timestamp})
        `;
        try {
            await runSQL(sql);
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
            const sql = `
                SELECT 
                    m.*,
                    s.archived,
                    s.last_opened,
                    s.favorite,
                    d.alias as discovery_alias,
                    d.avatar as discovery_avatar
                FROM CHAT_MESSAGES m
                LEFT JOIN CHAT_STATUS s ON m.publickey = s.publickey
                LEFT JOIN DISCOVERED_PEERS d ON m.publickey = d.publickey
                ORDER BY m.date DESC
            `;

            MDS.sql(sql, (res: any) => {
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
        const chatMap = new Map<string, any>();

        rows.forEach((row: any) => {
            const publickey = row.PUBLICKEY;

            // FILTER: Skip "undefined" messages
            if (row.MESSAGE === 'undefined') {
                return;
            }

            if (!chatMap.has(publickey)) {
                chatMap.set(publickey, {
                    publickey: row.PUBLICKEY,
                    roomname: row.DISCOVERY_ALIAS || row.ROOMNAME || "Unknown",
                    avatar: row.DISCOVERY_AVATAR,
                    lastMessage: row.MESSAGE,
                    lastMessageType: row.TYPE,
                    lastMessageDate: Number(row.DATE),
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
