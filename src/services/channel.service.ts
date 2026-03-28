import { MDS } from "@minima-global/mds";
import { utf8ToHex } from "../utils/hex";
import {
  runSQL as dbRunSQL,
  getAndIncrementChannelSequenceNumber,
} from "./database.service";

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
  is_public?: boolean;
}

export interface ChannelSubscriber {
  channel_id: string;
  publickey: string;
  username: string;
  joined_date: number;
  role: "creator" | "admin" | "subscriber";
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
  forwarded?: boolean;
  read?: number;
}

export interface ChannelMaximaMessage {
  messageType:
    | "channel_invite"
    | "channel_message"
    | "channel_subscriber_added"
    | "channel_subscriber_removed"
    | "channel_role_update"
    | "channel_info_updated"
    | "channel_join_request"
    | "channel_history_request"
    | "channel_history_response";
  channelId: string;
  channelName: string;
  adminPublickey: string;
  adminUsername: string;
  senderPublickey?: string;
  senderUsername?: string;
  sender_seq?: number;
  forwarded?: boolean;
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

  // channel_join_request
  requesterName?: string;
  requesterAddress?: string;

  // channel_history
  historySince?: number;
  historyMessages?: ChannelMaximaMessage[];
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
        console.log(
          "🔄 [ChannelService] Global CHANNEL_UPDATE received:",
          ce.detail,
        );
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

  private notifyChannelUpdate(
    channelId?: string,
    extraDetail?: any,
    skipDispatch = false,
  ) {
    this.channelUpdateCallbacks.forEach((cb) => cb());
    if (!skipDispatch && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("CHANNEL_UPDATE", {
          detail: {
            type: "channel_update",
            channelId: channelId || "",
            _fromService: "ChannelService",
            ...(extraDetail || {}),
          },
        }),
      );
    }
  }

  onChannelUpdate(cb: ChannelUpdateCallback): () => void {
    this.channelUpdateCallbacks.push(cb);
    return () => {
      this.channelUpdateCallbacks = this.channelUpdateCallbacks.filter(
        (c) => c !== cb,
      );
    };
  }

  private async sendMaximaMessage(
    toPublicKey: string,
    message: ChannelMaximaMessage,
  ): Promise<void> {
    const jsonStr = JSON.stringify(message);
    const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    const safeKey = toPublicKey.replace(/'/g, "''");

    // Try direct Mx address first
    try {
      const peerRes = await dbRunSQL(
        `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE UPPER(PUBLICKEY)=UPPER('${safeKey}') AND ADDRESS IS NOT NULL LIMIT 1`,
      );
      if (peerRes?.rows?.length > 0) {
        const rawAddr = peerRes.rows[0].ADDRESS as string;
        const mxAddr = rawAddr
          .replace(/\s+/g, "")
          .replace(/[^a-zA-Z0-9@:._-]/g, "");
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
      console.warn(
        "[CHANNEL-MAXIMA] Mx address send failed, trying pubkey fallback:",
        e,
      );
    }

    // Fallback: pubkey routing
    const sendCmd = `maxima action:send publickey:${toPublicKey} application:metachain-channel data:${hexData} poll:true`;
    await new Promise<void>((resolve, reject) => {
      MDS.executeRaw(sendCmd, (r: any) => {
        if (r?.status || r?.response?.delivered === true) resolve();
        else
          reject(new Error("Maxima send failed: " + JSON.stringify(r?.error)));
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
    isPublic: boolean,
    avatar: string = "",
  ): Promise<string> {
    const channelId = this.generateChannelId();
    const now = Date.now();

    await this.runSQL(`
            INSERT INTO CHANNELS (channel_id, name, description, admin_publickey, created_date, avatar, is_public)
            VALUES ('${channelId}', '${name.replace(/'/g, "''")}', '${description.replace(/'/g, "''")}', UPPER('${myPublicKey}'), ${now}, '${avatar.replace(/'/g, "''")}', ${isPublic ? 1 : 0})
        `);

    // Insert self as creator subscriber
    await this.runSQL(`
            INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role)
            VALUES ('${channelId}', UPPER('${myPublicKey}'), '${myUsername.replace(/'/g, "''")}', ${now}, 'creator')
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
                WHERE UPPER(cs.publickey) = UPPER('${myPublicKey}')
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
        archived:
          String(row.ARCHIVED).toUpperCase() === "TRUE" ||
          String(row.ARCHIVED) === "1" ||
          String(row.archived).toUpperCase() === "TRUE" ||
          String(row.archived) === "1",
        archived_date: Number(row.ARCHIVED_DATE || row.archived_date || 0),
        favorite:
          String(row.FAVORITE).toUpperCase() === "TRUE" ||
          String(row.FAVORITE) === "1" ||
          String(row.favorite).toUpperCase() === "TRUE" ||
          String(row.favorite) === "1",
        is_public:
          String(row.IS_PUBLIC).toUpperCase() === "TRUE" ||
          String(row.IS_PUBLIC) === "1" ||
          String(row.is_public).toUpperCase() === "TRUE" ||
          String(row.is_public) === "1",
      }));
    } catch (err) {
      console.error("❌ [CHANNEL] getMyChannels failed:", err);
      return [];
    }
  }

  async getChannelInfo(channelId: string): Promise<Channel | null> {
    try {
      const res = await this.runSQL(
        `SELECT * FROM CHANNELS WHERE UPPER(channel_id) = UPPER('${channelId}')`,
      );
      if (res.rows && res.rows.length > 0) {
        const row = res.rows[0];
        return {
          channel_id: row.CHANNEL_ID || row.channel_id,
          name: row.NAME || row.name,
          description: row.DESCRIPTION || row.description,
          admin_publickey: row.ADMIN_PUBLICKEY || row.admin_publickey,
          created_date: Number(row.CREATED_DATE || row.created_date || 0),
          avatar: row.AVATAR || row.avatar,
          archived:
            String(row.ARCHIVED).toUpperCase() === "TRUE" ||
            String(row.ARCHIVED) === "1" ||
            String(row.archived).toUpperCase() === "TRUE" ||
            String(row.archived) === "1",
          archived_date: Number(row.ARCHIVED_DATE || row.archived_date || 0),
          favorite:
            String(row.FAVORITE).toUpperCase() === "TRUE" ||
            String(row.FAVORITE) === "1" ||
            String(row.favorite).toUpperCase() === "TRUE" ||
            String(row.favorite) === "1",
          is_public:
            String(row.IS_PUBLIC).toUpperCase() === "TRUE" ||
            String(row.IS_PUBLIC) === "1" ||
            String(row.is_public).toUpperCase() === "TRUE" ||
            String(row.is_public) === "1",
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async deleteChannel(channelId: string): Promise<void> {
    try {
      await this.runSQL(
        `DELETE FROM CHANNELS WHERE UPPER(channel_id) = UPPER('${channelId}')`,
      );
      await this.runSQL(
        `DELETE FROM CHANNEL_SUBSCRIBERS WHERE UPPER(channel_id) = UPPER('${channelId}')`,
      );
      await this.runSQL(
        `DELETE FROM CHANNEL_MESSAGES WHERE UPPER(channel_id) = UPPER('${channelId}')`,
      );
      this.notifyChannelUpdate();
    } catch (err) {
      console.error("❌ [CHANNEL] Failed to delete channel:", err);
      throw err;
    }
  }

  async isAdmin(channelId: string, myPublicKey: string): Promise<boolean> {
    try {
      const res = await this.runSQL(
        `SELECT role FROM CHANNEL_SUBSCRIBERS WHERE UPPER(channel_id)=UPPER('${channelId}') AND UPPER(publickey)=UPPER('${myPublicKey}')`,
      );
      if (!res.rows || res.rows.length === 0) return false;
      const role = (res.rows[0].ROLE || res.rows[0].role || "").toLowerCase();
      return role === "admin" || role === "creator";
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
                LEFT JOIN (
                    SELECT UPPER(publickey) AS pubkey_upper, MIN(alias) AS alias
                    FROM DISCOVERED_PEERS
                    GROUP BY UPPER(publickey)
                ) d ON UPPER(cs.publickey) = d.pubkey_upper
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
    myUsername: string,
  ): Promise<void> {
    const now = Date.now();
    const channel = await this.getChannelInfo(channelId);
    if (!channel) throw new Error("Channel not found");

    const safeChannel = channel as any;

    // Add to DB optimistically
    try {
      await this.runSQL(`
                INSERT INTO CHANNEL_SUBSCRIBERS (channel_id, publickey, username, joined_date, role)
                VALUES ('${channelId}', UPPER('${subscriberPublicKey.replace(/'/g, "''")}'), '${subscriberUsername.replace(/'/g, "''")}', ${now}, 'subscriber')
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
      createdDate: Number(
        safeChannel.CREATED_DATE || safeChannel.created_date || now,
      ),
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
        await this.sendMaximaMessage(pk, addedPayload).catch(() => {});
      }
    }

    this.notifyChannelUpdate();
  }

  async removeSubscriber(
    channelId: string,
    subscriberPublicKey: string,
    myPublicKey: string,
    myUsername: string,
  ): Promise<void> {
    const channel = await this.getChannelInfo(channelId);
    if (!channel) throw new Error("Channel not found");
    const safeChannel = channel as any;

    await this.runSQL(
      `DELETE FROM CHANNEL_SUBSCRIBERS WHERE UPPER(channel_id)=UPPER('${channelId}') AND UPPER(publickey)=UPPER('${subscriberPublicKey.replace(/'/g, "''")}')`,
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
        await this.sendMaximaMessage(pk, payload).catch(() => {});
      }
    }

    // Also notify the removed subscriber
    await this.sendMaximaMessage(subscriberPublicKey, payload).catch(() => {});
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
    filedata: string = "",
    forwarded: boolean = false,
  ): Promise<void> {
    const channel = await this.getChannelInfo(channelId);
    if (!channel) throw new Error("Channel not found");
    const safeChannel = channel as any;

    const now = Date.now();

    // 1. Get sequence number
    const seq = await getAndIncrementChannelSequenceNumber(
      channelId,
      myPublicKey,
    );

    // 2. Save locally
    const escapedMsg = message.replace(/'/g, "''");
    await this.runSQL(`
            INSERT INTO CHANNEL_MESSAGES (channel_id, sender_publickey, sender_username, type, message, filedata, date, read, sender_seq, forwarded)
            VALUES ('${channelId}', UPPER('${myPublicKey}'), '${myUsername.replace(/'/g, "''")}', '${type}', '${escapedMsg}', '${filedata}', ${now}, 1, ${seq}, ${forwarded ? 1 : 0})
        `);

    // 3. Construct payload
    const maximaMsg: ChannelMaximaMessage = {
      messageType: "channel_message",
      channelId,
      channelName: safeChannel.NAME || safeChannel.name,
      adminPublickey: myPublicKey,
      adminUsername: myUsername,
      senderPublickey: myPublicKey,
      senderUsername: myUsername,
      sender_seq: seq,
      message,
      messageContentType: type as any,
      filedata,
      timestamp: now,
      forwarded,
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
                WHERE UPPER(channel_id) = UPPER('${channelId}')
                ORDER BY date ASC
            `);
      return res.rows || [];
    } catch {
      return [];
    }
  }

  async markChannelMessagesAsRead(channelId: string): Promise<void> {
    try {
      await this.runSQL(
        `UPDATE CHANNEL_MESSAGES SET read = 1 WHERE channel_id = '${channelId}'`,
      );
    } catch (err) {
      console.error("❌ [CHANNEL] markRead failed:", err);
    }
  }

  async requestChannelHistory(channelId: string): Promise<void> {
    console.log(
      `🔄 [CHANNEL-SYNC] Requesting history for channel ${channelId}...`,
    );

    // Signal sync start to UI
    MDS.comms.solo(
      JSON.stringify({
        type: "CHANNEL_SYNC_START",
        channelId: channelId,
      }),
      () => {},
    );

    // NEW: Direct dispatch for immediate UI feedback
    window.dispatchEvent(
      new CustomEvent("CHANNEL_UPDATE", {
        detail: { type: "CHANNEL_SYNC_START", channelId: channelId },
      }),
    );

    try {
      const info = await this.getChannelInfo(channelId);
      if (!info) {
        this.notifyChannelSyncEnd(channelId);
        return;
      }

      // If we are the admin, there is no remote peer to ask for history.
      // End sync immediately to avoid header timeout loops.
      const myInfo = await new Promise<any>((resolve) => {
        MDS.executeRaw("maxima action:info", (res: any) => resolve(res));
      });
      const myPublicKey = myInfo?.response?.publickey || "";
      if (
        myPublicKey &&
        info.admin_publickey &&
        myPublicKey.toUpperCase() === info.admin_publickey.toUpperCase()
      ) {
        console.log("ℹ️ [CHANNEL-SYNC] Admin is self. Nothing remote to sync.");
        this.notifyChannelSyncEnd(channelId);
        return;
      }

      const lastMsgSql = `SELECT date FROM CHANNEL_MESSAGES WHERE UPPER(channel_id) = UPPER('${channelId}') ORDER BY date DESC LIMIT 1`;
      const res = await this.runSQL(lastMsgSql);
      const lastTimestamp =
        res.rows && res.rows.length > 0 ? res.rows[0].DATE : 0;

      const payload: ChannelMaximaMessage = {
        messageType: "channel_history_request",
        channelId: channelId,
        channelName: info.name,
        adminPublickey: info.admin_publickey,
        adminUsername: "Admin", // Placeholder
        timestamp: Date.now(),
        historySince: Number(lastTimestamp),
      };

      // Send to admin
      await this.sendMaximaMessage(info.admin_publickey, payload);
      console.log(
        `✅ [CHANNEL-SYNC] History request sent to admin: ${info.admin_publickey}`,
      );
    } catch (err) {
      console.error("❌ [CHANNEL-SYNC] Error:", err);
      this.notifyChannelSyncEnd(channelId);
    }
  }

  private notifyChannelSyncEnd(channelId: string) {
    const detail = { type: "CHANNEL_SYNC_END", channelId: channelId };
    MDS.comms.solo(JSON.stringify(detail), () => {});
    window.dispatchEvent(new CustomEvent("CHANNEL_UPDATE", { detail }));
  }

  async getUnreadCount(channelId: string): Promise<number> {
    try {
      const res = await this.runSQL(
        `SELECT COUNT(*) as cnt FROM CHANNEL_MESSAGES WHERE UPPER(channel_id)=UPPER('${channelId}') AND read=0`,
      );
      return Number(res.rows?.[0]?.CNT || res.rows?.[0]?.cnt || 0);
    } catch {
      return 0;
    }
  }

  /* ----------------------------------------------------------------------------
      INCOMING MESSAGE HANDLING
    ---------------------------------------------------------------------------- */

  async updateSubscriberRole(
    channelId: string,
    subscriberPubkey: string,
    newRole: "admin" | "subscriber",
    myPublicKey: string,
  ): Promise<void> {
    try {
      // Optimistic update locally
      const sql = `UPDATE CHANNEL_SUBSCRIBERS SET role = '${newRole}' WHERE UPPER(channel_id) = UPPER('${channelId}') AND UPPER(publickey) = UPPER('${subscriberPubkey}')`;
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
        timestamp: Date.now(),
      } as any;

      // Broadcast to all subscribers
      const subs = await this.getChannelSubscribers(channelId);
      for (const sub of subs) {
        const pk = (sub as any).PUBLICKEY || sub.publickey;
        if (!pk || pk === myPublicKey) continue;
        await this.sendMaximaMessage(pk, payload).catch((e) =>
          console.error("❌ [CHANNEL-ROLE] Broadcast failed to", pk, e),
        );
      }

      console.log(
        `✅ [CHANNEL-ROLE] Roles updated for ${subscriberPubkey} to ${newRole}`,
      );
      this.notifyChannelUpdate();
    } catch (err) {
      console.error("❌ [CHANNEL-ROLE] Update failed:", err);
      throw err;
    }
  }

  async updateChannelDetails(
    channelId: string,
    newName: string | null,
    newDescription: string | null,
    avatar: string | null,
    myPublicKey: string,
  ): Promise<void> {
    try {
      // Update local DB
      if (newName) {
        await this.runSQL(
          `UPDATE CHANNELS SET name = '${newName.replace(/'/g, "''")}' WHERE UPPER(channel_id) = UPPER('${channelId}')`,
        );
      }
      if (newDescription !== null) {
        await this.runSQL(
          `UPDATE CHANNELS SET description = '${newDescription.replace(/'/g, "''")}' WHERE UPPER(channel_id) = UPPER('${channelId}')`,
        );
      }
      if (avatar !== null) {
        await this.runSQL(
          `UPDATE CHANNELS SET avatar = '${avatar.replace(/'/g, "''")}' WHERE UPPER(channel_id) = UPPER('${channelId}')`,
        );
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
        avatar: avatar !== null ? avatar : undefined,
      };

      const subs = await this.getChannelSubscribers(channelId);
      for (const sub of subs) {
        const pk = (sub as any).PUBLICKEY || sub.publickey;
        if (pk && pk !== myPublicKey) {
          await this.sendMaximaMessage(pk, payload).catch(() => {});
        }
      }

      this.notifyChannelUpdate();
    } catch (err) {
      console.error("❌ [CHANNEL] updateDetails failed:", err);
      throw err;
    }
  }

  // Message Handling
  async handleIncomingChannelMessage(
    message: ChannelMaximaMessage,
    _fromPublicKey: string,
  ): Promise<void> {
    try {
      console.log("📨 [CHANNEL-MSG] Incoming:", message.messageType);

      switch (message.messageType) {
        case "channel_message":
          // SW persists, we just notify UI
          break;
        // Add other types as needed
      }

      // Notify UI
      this.notifyChannelUpdate(message.channelId, {
        type: "CHANNEL_NEW_MESSAGE",
      });
    } catch (err) {
      console.error("❌ [CHANNEL-SERVICE] Message handling error:", err);
    }
  }

  async archiveChannel(channelId: string): Promise<void> {
    try {
      await this.runSQL(
        `UPDATE CHANNELS SET archived = TRUE, archived_date = ${Date.now()} WHERE UPPER(channel_id) = UPPER('${channelId}')`,
      );
      this.notifyChannelUpdate(channelId, { archived: true });
    } catch (err) {
      console.error("❌ [CHANNEL] Failed to archive channel:", err);
      throw err;
    }
  }

  async unarchiveChannel(channelId: string): Promise<void> {
    try {
      await this.runSQL(
        `UPDATE CHANNELS SET archived = FALSE, archived_date = 0 WHERE UPPER(channel_id) = UPPER('${channelId}')`,
      );
      this.notifyChannelUpdate(channelId, { archived: false });
    } catch (err) {
      console.error("❌ [CHANNEL] Failed to unarchive channel:", err);
      throw err;
    }
  }

  async favoriteChannel(channelId: string): Promise<void> {
    try {
      await this.runSQL(
        `UPDATE CHANNELS SET favorite = TRUE WHERE UPPER(channel_id) = UPPER('${channelId}')`,
      );
      this.notifyChannelUpdate(channelId, { favorite: true });
    } catch (err) {
      console.error("❌ [CHANNEL] Failed to favorite channel:", err);
      throw err;
    }
  }

  async unfavoriteChannel(channelId: string): Promise<void> {
    try {
      await this.runSQL(
        `UPDATE CHANNELS SET favorite = FALSE WHERE UPPER(channel_id) = UPPER('${channelId}')`,
      );
      this.notifyChannelUpdate(channelId, { favorite: false });
    } catch (err) {
      console.error("❌ [CHANNEL] Failed to unfavorite channel:", err);
      throw err;
    }
  }

  async updateChannelPublic(
    channelId: string,
    isPublic: boolean,
  ): Promise<void> {
    try {
      await this.runSQL(
        `UPDATE CHANNELS SET is_public = ${isPublic ? 1 : 0} WHERE UPPER(channel_id) = UPPER('${channelId}')`,
      );
      this.notifyChannelUpdate(channelId, { is_public: isPublic });
    } catch (err) {
      console.error("❌ [CHANNEL] Failed to update public listing:", err);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Invite link (mcch://)
  // -----------------------------------------------------------------------

  async generateInviteCode(
    channelId: string,
    channelName: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      MDS.executeRaw("maxima action:info", (res: any) => {
        if (!res.status) {
          reject("Could not get maxima info");
          return;
        }
        const adminPubkey = res.response.publickey;
        const adminAddress = res.response.contact;

        const data = {
          c: channelId,
          n: channelName,
          p: adminPubkey,
          a: adminAddress,
        };

        const jsonStr = JSON.stringify(data);
        const base64 = window.btoa(unescape(encodeURIComponent(jsonStr)));
        resolve(`mcch://${base64}`);
      });
    });
  }

  async joinViaInviteLink(inviteCode: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        if (!inviteCode.startsWith("mcch://")) {
          throw new Error("Invalid channel invite link format");
        }

        const base64 = inviteCode.substring(7);
        const jsonStr = decodeURIComponent(escape(window.atob(base64)));
        const data = JSON.parse(jsonStr);

        const channelId = data.c;
        const adminAddress = data.a;

        // Get our identity
        const myInfo: any = await new Promise((res) =>
          MDS.executeRaw("maxima action:info", res),
        );
        const myNameData: any = await this.runSQL(
          `SELECT alias FROM METACHAIN_USERS WHERE UPPER(publickey)=UPPER('${myInfo.response.publickey}')`,
        );
        const myName =
          myNameData.rows && myNameData.rows.length > 0
            ? myNameData.rows[0].ALIAS ||
              myNameData.rows[0].alias ||
              myInfo.response.name ||
              "Anonymous"
            : myInfo.response.name || "Anonymous";

        const payload: any = {
          messageType: "channel_join_request",
          channelId,
          channelName: data.n || "Channel",
          adminPublickey: data.p,
          adminUsername: "Admin",
          senderPublickey: myInfo.response.publickey,
          senderUsername: myName,
          requesterName: myName,
          requesterAddress: myInfo.response.contact,
          timestamp: Date.now(),
        };

        // Seed DISCOVERED_PEERS so we can reach the admin via Mx address
        const now = Date.now();
        await this.runSQL(
          `DELETE FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${data.p}')`,
        );
        await this.runSQL(`
                    INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar)
                    VALUES (UPPER('${data.p}'), '${adminAddress}', 'CHANNEL_INVITE', 'Unknown', ${now}, '')
                `);

        const payloadJsonStr = JSON.stringify(payload);
        const hexData =
          "0x" +
          Array.from(new TextEncoder().encode(payloadJsonStr))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase();

        MDS.executeRaw(
          `maxima action:send application:metachain-channel to:${adminAddress} data:${hexData} poll:true`,
          (sendRes: any) => {
            if (sendRes.status) {
              resolve();
            } else {
              reject(
                "Could not send join request to channel admin: " +
                  sendRes.error,
              );
            }
          },
        );
      } catch (e: any) {
        reject("Failed to process invite link: " + e.message);
      }
    });
  }
}

export const channelService = new ChannelService();
