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
    | "channel_subscriber_removed";
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
                console.log("🔄 [ChannelService] Global CHANNEL_UPDATE received:", ce.detail);
                this.notifyChannelUpdate();
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

    private notifyChannelUpdate() {
        this.channelUpdateCallbacks.forEach(cb => cb());
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
            return res.rows || [];
        } catch (err) {
            console.error("❌ [CHANNEL] getMyChannels failed:", err);
            return [];
        }
    }

    async getChannelInfo(channelId: string): Promise<Channel | null> {
        try {
            const res = await this.runSQL(`SELECT * FROM CHANNELS WHERE channel_id = '${channelId}'`);
            return res.rows?.length > 0 ? res.rows[0] : null;
        } catch {
            return null;
        }
    }

    async deleteChannel(channelId: string): Promise<void> {
        await this.runSQL(`DELETE FROM CHANNEL_MESSAGES WHERE channel_id = '${channelId}'`);
        await this.runSQL(`DELETE FROM CHANNEL_SUBSCRIBERS WHERE channel_id = '${channelId}'`);
        await this.runSQL(`DELETE FROM CHANNELS WHERE channel_id = '${channelId}'`);
        this.notifyChannelUpdate();
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
                WHERE cs.channel_id = '${channelId}'
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
}

export const channelService = new ChannelService();
