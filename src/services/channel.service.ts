import { MDS } from "@minima-global/mds";
import { utf8ToHex } from "../utils/hex";
import { runSQL as dbRunSQL } from "./database.service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Channel {
    channel_id: string;
    name: string;
    description?: string;
    admin_publickey: string;
    created_date: number;
    avatar?: string;
    archived?: boolean;
    archived_date?: number;
    favorite?: boolean;
}

export interface ChannelSubscriber {
    channel_id: string;
    publickey: string;
    username: string;
    joined_date: number;
    role: "admin" | "subscriber";
}

export interface ChannelMessage {
    id?: number;
    channel_id: string;
    sender_publickey: string;
    sender_username: string;
    type: string;
    message: string;
    filedata?: string;
    date: number;
    read?: number;
}

export interface ChannelMaximaMessage {
    messageType:
    | "channel_invite"
    | "channel_message"
    | "channel_subscriber_added"
    | "channel_subscriber_removed"
    | "channel_role_update"
    | "channel_info_updated";
    channelId: string;
    channelName: string;
    adminPublickey: string;
    adminUsername: string;
    senderPublickey?: string;
    senderUsername?: string;
    timestamp: number;

    // channel_invite
    description?: string;
    createdDate?: number;
    avatar?: string;
    inviteePublickey?: string;
    inviteeUsername?: string;

    // channel_message
    message?: string;
    messageContentType?: "text" | "image" | "file";
    filedata?: string;

    // channel_subscriber_added / removed
    subscriberPublickey?: string;
    subscriberUsername?: string;

    // channel_role_update
    targetPubkey?: string;
    newRole?: "admin" | "subscriber";

    // channel_info_updated
    newName?: string;
    newDescription?: string;
}

type ChannelUpdateCallback = () => void;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class ChannelService {
    private channelUpdateCallbacks: ChannelUpdateCallback[] = [];

    constructor() {
        if (typeof window !== "undefined") {
            window.addEventListener("CHANNEL_UPDATE", (e: Event) => {
                const ce = e as CustomEvent;
                // Avoid infinite loop: ignore events sent by this service
                if (ce.detail && ce.detail._fromService === "ChannelService") {
                    return;
                }
                console.log("🔄 [ChannelService] Global CHANNEL_UPDATE received:", ce.detail);
                this.notifyChannelUpdate(ce.detail?.channelId, ce.detail, true);
            });
        }
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    private runSQL(sql: string): Promise<any> {
        return new Promise((resolve, reject) => {
            MDS.sql(sql, (res: any) => {
                if (!res.status) reject(new Error(res.error || "SQL query failed"));
                else resolve(res);
            });
        });
    }

    private generateChannelId(): string {
        return `channel_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    }

    private notifyChannelUpdate(channelId?: string, extraDetail?: any, skipDispatch = false) {
        this.channelUpdateCallbacks.forEach(cb => cb());
        if (!skipDispatch && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("CHANNEL_UPDATE", {
                detail: {
                    type: "channel_update",
                    channelId: channelId || "",
                    _fromService: "ChannelService",
                    ...(extraDetail || {})
                }
            }));
        }
    }

    onChannelUpdate(cb: ChannelUpdateCallback): () => void {
        this.channelUpdateCallbacks.push(cb);
        return () => {
            this.channelUpdateCallbacks = this.channelUpdateCallbacks.filter(c => c !== cb);
        };
    }

    private async sendMaximaMessage(toPublicKey: string, message: ChannelMaximaMessage): Promise<void> {
        const jsonStr = JSON.stringify(message);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        const safeKey = toPublicKey.replace(/'/g, "''");

        // Try direct Mx address first
        try {
            const peerRes = await dbRunSQL(
                `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE UPPER(PUBLICKEY)=UPPER('${safeKey}') AND ADDRESS IS NOT NULL LIMIT 1`
            );
            if (peerRes?.rows?.length > 0) {
                const rawAddr = peerRes.rows[0].ADDRESS as string;
                const mxAddr = rawAddr.replace(/\s+/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "");
                const sendCmd = `maxima action:send to:${mxAddr} application:metachain-channel data:${hexData} poll:true`;
                const res = await new Promise<any>((resolve) => {
                    MDS.executeRaw(sendCmd, (r: any) => resolve(r));
                });
                if (res?.status || res?.response?.delivered === true) {
                    console.log(`📤 [CHANNEL-MAXIMA] Sent via Mx address`);
                    return;
                }
            }
        } catch (e) {
            console.warn("[CHANNEL-MAXIMA] Mx address send failed, trying pubkey fallback:", e);
        }

        // Fallback: pubkey routing
        const sendCmd = `maxima action:send to:${toPublicKey} application:metachain-channel data:${hexData} poll:true`;
        await new Promise<void>((resolve, reject) => {
            MDS.executeRaw(sendCmd, (r: any) => {
                if (r?.status || r?.response?.delivered === true) resolve();
                else reject(new Error("Maxima send failed: " + JSON.stringify(r?.error)));
            });
        });
    }

    // -----------------------------------------------------------------------
    // Channel CRUD
    // -----------------------------------------------------------------------

    async createChannel(
        name: string,
        description: string,
        myPublicKey: string,
        myUsername: string,
        avatar: string = ""
    ): Promise<string> {
        const channelId = this.generateChannelId();
        const now = Date.now();

        await this.runSQL(`
            INSERT INTO CHANNELS (channel_id, name, description, admin_publickey, created_date, avatar)
            VALUES ('${channelId}', '${name.replace(/'/g, "''")}', '${description.replace(/'/g, "''")}', '${myPublicKey}', ${now}, '${avatar.replace(/'/g, "''")}')
        `);

        // Insert self as admin subscriber
        await this.runSQL(`
            INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role)
            VALUES ('${channelId}', '${myPublicKey}', '${myUsername.replace(/'/g, "''")}', ${now}, 'admin')
        `);

        console.log("✅ [CHANNEL] Created:", channelId);
        this.notifyChannelUpdate();
        return channelId;
    }

    async getMyChannels(myPublicKey: string): Promise<Channel[]> {
        try {
            const res = await this.runSQL(`
                SELECT DISTINCT c.*
                FROM CHANNELS c
                INNER JOIN CHANNEL_SUBSCRIBERS cs ON c.channel_id = cs.channel_id
                WHERE cs.publickey = '${myPublicKey}'
                ORDER BY c.created_date DESC
            `);
            if (!res.rows) return [];

            return res.rows.map((row: any) => ({
                channel_id: row.CHANNEL_ID || row.channel_id,
                name: row.NAME || row.name,
                description: row.DESCRIPTION || row.description,
                admin_publickey: row.ADMIN_PUBLICKEY || row.admin_publickey,
                created_date: Number(row.CREATED_DATE || row.created_date || 0),
                avatar: row.AVATAR || row.avatar,
                archived: String(row.ARCHIVED).toUpperCase() === "TRUE" || String(row.ARCHIVED) === "1" || String(row.archived).toUpperCase() === "TRUE" || String(row.archived) === "1",
                archived_date: Number(row.ARCHIVED_DATE || row.archived_date || 0),
                favorite: String(row.FAVORITE).toUpperCase() === "TRUE" || String(row.FAVORITE) === "1" || String(row.favorite).toUpperCase() === "TRUE" || String(row.favorite) === "1",
            }));
        } catch (err) {
            console.error("❌ [CHANNEL] getMyChannels failed:", err);
            return [];
        }
    }

    async getChannelInfo(channelId: string): Promise<Channel | null> {
        try {
            const res = await this.runSQL(`SELECT * FROM CHANNELS WHERE UPPER(channel_id) = UPPER('${channelId}')`);
            if (res.rows && res.rows.length > 0) {
                const row = res.rows[0];
                return {
                    channel_id: row.CHANNEL_ID || row.channel_id,
                    name: row.NAME || row.name,
                    description: row.DESCRIPTION || row.description,
                    admin_publickey: row.ADMIN_PUBLICKEY || row.admin_publickey,
                    created_date: Number(row.CREATED_DATE || row.created_date || 0),
                    avatar: row.AVATAR || row.avatar,
                    archived: String(row.ARCHIVED).toUpperCase() === "TRUE" || String(row.ARCHIVED) === "1" || String(row.archived).toUpperCase() === "TRUE" || String(row.archived) === "1",
                    archived_date: Number(row.ARCHIVED_DATE || row.archived_date || 0),
                    favorite: String(row.FAVORITE).toUpperCase() === "TRUE" || String(row.FAVORITE) === "1" || String(row.favorite).toUpperCase() === "TRUE" || String(row.favorite) === "1",
                };
            }
            return null;
        } catch {
            return null;
        }
    }

    async deleteChannel(channelId: string): Promise<void> {
        try {
            await this.runSQL(`DELETE FROM CHANNELS WHERE UPPER(channel_id) = UPPER('${channelId}')`);
            await this.runSQL(`DELETE FROM CHANNEL_SUBSCRIBERS WHERE UPPER(channel_id) = UPPER('${channelId}')`);
            await this.runSQL(`DELETE FROM CHANNEL_MESSAGES WHERE UPPER(channel_id) = UPPER('${channelId}')`);
            this.notifyChannelUpdate();
        } catch (err) {
            console.error("❌ [CHANNEL] Failed to delete channel:", err);
            throw err;
        }
    }

    async isAdmin(channelId: string, myPublicKey: string): Promise<boolean> {
        try {
            const res = await this.runSQL(
                `SELECT role FROM CHANNEL_SUBSCRIBERS WHERE channel_id='${channelId}' AND UPPER(publickey)=UPPER('${myPublicKey}')`
            );
            if (!res.rows || res.rows.length === 0) return false;
            const role = (res.rows[0].ROLE || res.rows[0].role || "").toLowerCase();
            return role === "admin";
        } catch {
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // Subscriber management
    // -----------------------------------------------------------------------

    async getChannelSubscribers(channelId: string): Promise<ChannelSubscriber[]> {
        try {
            const res = await this.runSQL(`
                SELECT cs.*, COALESCE(d.alias, cs.username) as resolved_name
                FROM CHANNEL_SUBSCRIBERS cs
                LEFT JOIN DISCOVERED_PEERS d ON UPPER(cs.publickey) = UPPER(d.publickey)
                WHERE UPPER(cs.channel_id) = UPPER('${channelId}')
                ORDER BY cs.joined_date ASC
            `);
            return res.rows || [];
        } catch {
            return [];
        }
    }

    async inviteSubscriber(
        channelId: string,
        subscriberPublicKey: string,
        subscriberUsername: string,
        myPublicKey: string,
        myUsername: string
    ): Promise<void> {
        const now = Date.now();
        const channel = await this.getChannelInfo(channelId);
        if (!channel) throw new Error("Channel not found");

        const safeChannel = channel as any;

        // Add to DB optimistically
        try {
            await this.runSQL(`
                INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role)
                VALUES ('${channelId}', '${subscriberPublicKey.replace(/'/g, "''")}', '${subscriberUsername.replace(/'/g, "''")}', ${now}, 'subscriber')
            `);
        } catch (e) {
            console.warn("Subscriber already in DB or error:", e);
        }

        // Build invite payload
        const payload: ChannelMaximaMessage = {
            messageType: "channel_invite",
            channelId,
            channelName: safeChannel.NAME || safeChannel.name,
            adminPublickey: myPublicKey,
            adminUsername: myUsername,
            description: safeChannel.DESCRIPTION || safeChannel.description || "",
            createdDate: Number(safeChannel.CREATED_DATE || safeChannel.created_date || now),
            avatar: safeChannel.AVATAR || safeChannel.avatar || "",
            inviteePublickey: subscriberPublicKey,
            inviteeUsername: subscriberUsername,
            timestamp: now,
        };

        await this.sendMaximaMessage(subscriberPublicKey, payload);

        // Notify other subscribers
        const subs = await this.getChannelSubscribers(channelId);
        const addedPayload: ChannelMaximaMessage = {
            messageType: "channel_subscriber_added",
            channelId,
            channelName: safeChannel.NAME || safeChannel.name,
            adminPublickey: myPublicKey,
            adminUsername: myUsername,
            subscriberPublickey: subscriberPublicKey,
            subscriberUsername,
            timestamp: now,
        };
        for (const sub of subs) {
            const pk = (sub as any).PUBLICKEY || sub.publickey;
            if (pk && pk !== myPublicKey && pk !== subscriberPublicKey) {
                await this.sendMaximaMessage(pk, addedPayload).catch(() => { });
            }
        }

        this.notifyChannelUpdate();
    }

    async removeSubscriber(
        channelId: string,
        subscriberPublicKey: string,
        myPublicKey: string,
        myUsername: string
    ): Promise<void> {
        const channel = await this.getChannelInfo(channelId);
        if (!channel) throw new Error("Channel not found");
        const safeChannel = channel as any;

        await this.runSQL(
            `DELETE FROM CHANNEL_SUBSCRIBERS WHERE channel_id='${channelId}' AND UPPER(publickey)=UPPER('${subscriberPublicKey.replace(/'/g, "''")}')`
        );

        const now = Date.now();
        const payload: ChannelMaximaMessage = {
            messageType: "channel_subscriber_removed",
            channelId,
            channelName: safeChannel.NAME || safeChannel.name,
            adminPublickey: myPublicKey,
            adminUsername: myUsername,
            subscriberPublickey: subscriberPublicKey,
            timestamp: now,
        };

        const subs = await this.getChannelSubscribers(channelId);
        for (const sub of subs) {
            const pk = (sub as any).PUBLICKEY || sub.publickey;
            if (pk && pk !== myPublicKey) {
                await this.sendMaximaMessage(pk, payload).catch(() => { });
            }
        }

        // Also notify the removed subscriber
        await this.sendMaximaMessage(subscriberPublicKey, payload).catch(() => { });
        this.notifyChannelUpdate();
    }

    // -----------------------------------------------------------------------
    // Messaging
    // -----------------------------------------------------------------------

    async publishMessage(
        channelId: string,
        message: string,
        type: string,
        myPublicKey: string,
        myUsername: string,
        filedata: string = ""
    ): Promise<void> {
        const channel = await this.getChannelInfo(channelId);
        if (!channel) throw new Error("Channel not found");
        const safeChannel = channel as any;

        const now = Date.now();

        // Save locally
        const escapedMsg = message.replace(/'/g, "''");
        await this.runSQL(`
            INSERT INTO CHANNEL_MESSAGES (channel_id, sender_publickey, sender_username, type, message, filedata, date, read)
            VALUES ('${channelId}', '${myPublicKey}', '${myUsername.replace(/'/g, "''")}', '${type}', '${escapedMsg}', '${filedata}', ${now}, 1)
        `);

        const maximaMsg: ChannelMaximaMessage = {
            messageType: "channel_message",
            channelId,
            channelName: safeChannel.NAME || safeChannel.name,
            adminPublickey: myPublicKey,
            adminUsername: myUsername,
            senderPublickey: myPublicKey,
            senderUsername: myUsername,
            message,
            messageContentType: type as any,
            filedata,
            timestamp: now,
        };

        // Send to all subscribers (except self)
        const subs = await this.getChannelSubscribers(channelId);
        for (const sub of subs) {
            const pk = (sub as any).PUBLICKEY || sub.publickey;
            if (pk && pk !== myPublicKey) {
                await this.sendMaximaMessage(pk, maximaMsg).catch((err) => {
                    console.error(`❌ [CHANNEL] Failed to send to ${pk}:`, err);
                });
            }
        }

        console.log(`✅ [CHANNEL] Published to ${channelId}`);
    }

    async getChannelMessages(channelId: string): Promise<ChannelMessage[]> {
        try {
            const res = await this.runSQL(`
                SELECT * FROM CHANNEL_MESSAGES
                WHERE channel_id = '${channelId}'
                ORDER BY date ASC
            `);
            return res.rows || [];
        } catch {
            return [];
        }
    }

    async markChannelMessagesAsRead(channelId: string): Promise<void> {
        try {
            await this.runSQL(`UPDATE CHANNEL_MESSAGES SET read = 1 WHERE channel_id = '${channelId}'`);
        } catch (err) {
            console.error("❌ [CHANNEL] markRead failed:", err);
        }
    }

    async getUnreadCount(channelId: string): Promise<number> {
        try {
            const res = await this.runSQL(
                `SELECT COUNT(*) as cnt FROM CHANNEL_MESSAGES WHERE channel_id='${channelId}' AND read=0`
            );
            return Number(res.rows?.[0]?.CNT || res.rows?.[0]?.cnt || 0);
        } catch {
            return 0;
        }
    }

    /* ----------------------------------------------------------------------------
      INCOMING MESSAGE HANDLING
    ---------------------------------------------------------------------------- */
    async handleIncomingChannelMessage(message: ChannelMaximaMessage, fromPublicKey: string): Promise<void> {
        try {
            console.log("📨 [CHANNEL-MSG] Incoming:", message);

            switch (message.messageType) {
                case "channel_invite":
                    await this.handleChannelInvite(message, fromPublicKey);
                    break;
                case "channel_message":
                    await this.handleChannelChatMessage(message, fromPublicKey);
                    break;
                case "channel_role_update":
                    await this.handleChannelRoleUpdate(message);
                    break;
                case "channel_info_updated":
                    await this.handleChannelInfoUpdate(message);
                    break;
                default:
                    console.warn("⚠️ [CHANNEL-MSG] Unknown type:", message.messageType);
            }

            // Notify UI
            this.notifyChannelUpdate();
        } catch (err) {
            console.error("❌ [CHANNEL-MSG] Handler failed:", err);
        }
    }

    private async handleChannelInvite(message: ChannelMaximaMessage, fromPublicKey: string): Promise<void> {
        // Check if channel already exists
        const existing = await this.getChannelInfo(message.channelId);
        if (existing) {
            console.log("ℹ️ [CHANNEL-INVITE] Channel exists, skipping");
            return;
        }

        // Create channel locally
        const createSql = `
            INSERT INTO CHANNELS (channel_id, name, admin_publickey, created_date, description, avatar)
            VALUES ('${message.channelId}', '${message.channelName.replace(/'/g, "''")}', '${fromPublicKey}', ${message.timestamp}, '${(message.description || "").replace(/'/g, "''")}', '${message.avatar || ""}')
        `;
        await this.runSQL(createSql);

        // Add admin as first subscriber
        const addAdminSql = `
            INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role)
            VALUES ('${message.channelId}', '${fromPublicKey}', '${(message.adminUsername || "Admin").replace(/'/g, "''")}', ${message.timestamp}, 'admin')
        `;
        await this.runSQL(addAdminSql);

        console.log("✅ [CHANNEL-INVITE] Accepted:", message.channelId);
        this.notifyChannelUpdate();
    }

    private async handleChannelChatMessage(message: ChannelMaximaMessage, fromPublicKey: string): Promise<void> {
        const msgTimestamp = message.timestamp || Date.now();
        const safeMsg = (message.message || "").replace(/'/g, "''");
        const safeUser = (message.adminUsername || "Admin").replace(/'/g, "''");
        const safeType = message.messageContentType || "text";

        const insertSql = `
            INSERT INTO CHANNEL_MESSAGES (channel_id, sender_publickey, sender_username, type, message, filedata, date, read)
            VALUES ('${message.channelId}', '${fromPublicKey}', '${safeUser}', '${safeType}', '${safeMsg}', '${message.filedata || ""}', ${msgTimestamp}, 0)
        `;
        await this.runSQL(insertSql);
        console.log("✅ [CHANNEL-MSG] Saved message for channel:", message.channelId);
    }

    async updateSubscriberRole(channelId: string, subscriberPubkey: string, newRole: "admin" | "subscriber", myPublicKey: string): Promise<void> {
        try {
            // Optimistic update locally
            const sql = `UPDATE CHANNEL_SUBSCRIBERS SET role = '${newRole}' WHERE channel_id = '${channelId}' AND publickey = '${subscriberPubkey}'`;
            await this.runSQL(sql);

            // Construct payload
            const payload: ChannelMaximaMessage = {
                messageType: "channel_role_update",
                channelId: channelId,
                channelName: "",
                adminPublickey: myPublicKey,
                adminUsername: "",
                targetPubkey: subscriberPubkey,
                newRole: newRole,
                timestamp: Date.now()
            } as any;

            // Broadcast to all subscribers
            const subs = await this.getChannelSubscribers(channelId);
            for (const sub of subs) {
                const pk = (sub as any).PUBLICKEY || sub.publickey;
                if (!pk || pk === myPublicKey) continue;
                await this.sendMaximaMessage(pk, payload).catch(e => console.error("❌ [CHANNEL-ROLE] Broadcast failed to", pk, e));
            }

            console.log(`✅ [CHANNEL-ROLE] Roles updated for ${subscriberPubkey} to ${newRole}`);
            this.notifyChannelUpdate();
        } catch (err) {
            console.error("❌ [CHANNEL-ROLE] Update failed:", err);
            throw err;
        }
    }

    private async handleChannelRoleUpdate(message: ChannelMaximaMessage): Promise<void> {
        const sql = `UPDATE CHANNEL_SUBSCRIBERS SET role = '${message.newRole}' WHERE channel_id = '${message.channelId}' AND publickey = '${message.targetPubkey}'`;
        await this.runSQL(sql);
        console.log(`✅ [CHANNEL-ROLE] Real-time role update for ${message.targetPubkey} to ${message.newRole}`);
    }

    async updateChannelDetails(channelId: string, newName: string | null, newDescription: string | null, avatar: string | null, myPublicKey: string): Promise<void> {
        try {
            // Update local DB
            if (newName) {
                await this.runSQL(`UPDATE CHANNELS SET name = '${newName.replace(/'/g, "''")}' WHERE channel_id = '${channelId}'`);
            }
            if (newDescription !== null) {
                await this.runSQL(`UPDATE CHANNELS SET description = '${newDescription.replace(/'/g, "''")}' WHERE channel_id = '${channelId}'`);
            }
            if (avatar !== null) {
                await this.runSQL(`UPDATE CHANNELS SET avatar = '${avatar.replace(/'/g, "''")}' WHERE channel_id = '${channelId}'`);
            }

            // Broadcast change
            const payload: ChannelMaximaMessage = {
                messageType: "channel_info_updated",
                channelId,
                channelName: newName || "",
                adminPublickey: myPublicKey,
                adminUsername: "",
                timestamp: Date.now(),
                newName: newName || undefined,
                newDescription: newDescription !== null ? newDescription : undefined,
                avatar: avatar !== null ? avatar : undefined
            };

            const subs = await this.getChannelSubscribers(channelId);
            for (const sub of subs) {
                const pk = (sub as any).PUBLICKEY || sub.publickey;
                if (pk && pk !== myPublicKey) {
                    await this.sendMaximaMessage(pk, payload).catch(() => { });
                }
            }

            this.notifyChannelUpdate();
        } catch (err) {
            console.error("❌ [CHANNEL] updateDetails failed:", err);
            throw err;
        }
    }

    private async handleChannelInfoUpdate(message: ChannelMaximaMessage): Promise<void> {
        if (message.newName) {
            await this.runSQL(`UPDATE CHANNELS SET name = '${message.newName.replace(/'/g, "''")}' WHERE channel_id = '${message.channelId}'`);
        }
        if (message.newDescription !== undefined) {
            await this.runSQL(`UPDATE CHANNELS SET description = '${message.newDescription.replace(/'/g, "''")}' WHERE channel_id = '${message.channelId}'`);
        }
        if (message.avatar !== undefined) {
            await this.runSQL(`UPDATE CHANNELS SET avatar = '${message.avatar.replace(/'/g, "''")}' WHERE channel_id = '${message.channelId}'`);
        }
        console.log(`✅ [CHANNEL-UPDATE] Real-time info update for ${message.channelId}`);
    }

    async archiveChannel(channelId: string): Promise<void> {
        try {
            await this.runSQL(`UPDATE CHANNELS SET archived = TRUE, archived_date = ${Date.now()} WHERE channel_id = '${channelId}'`);
            this.notifyChannelUpdate(channelId, { archived: true });
        } catch (err) {
            console.error("❌ [CHANNEL] Failed to archive channel:", err);
            throw err;
        }
    }

    async unarchiveChannel(channelId: string): Promise<void> {
        try {
            await this.runSQL(`UPDATE CHANNELS SET archived = FALSE, archived_date = 0 WHERE channel_id = '${channelId}'`);
            this.notifyChannelUpdate(channelId, { archived: false });
        } catch (err) {
            console.error("❌ [CHANNEL] Failed to unarchive channel:", err);
            throw err;
        }
    }

    async favoriteChannel(channelId: string): Promise<void> {
        try {
            await this.runSQL(`UPDATE CHANNELS SET favorite = TRUE WHERE channel_id = '${channelId}'`);
            this.notifyChannelUpdate(channelId, { favorite: true });
        } catch (err) {
            console.error("❌ [CHANNEL] Failed to favorite channel:", err);
            throw err;
        }
    }

    async unfavoriteChannel(channelId: string): Promise<void> {
        try {
            await this.runSQL(`UPDATE CHANNELS SET favorite = FALSE WHERE channel_id = '${channelId}'`);
            this.notifyChannelUpdate(channelId, { favorite: false });
        } catch (err) {
            console.error("❌ [CHANNEL] Failed to unfavorite channel:", err);
            throw err;
        }
    }
}

export const channelService = new ChannelService();
