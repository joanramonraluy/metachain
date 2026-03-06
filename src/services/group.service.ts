import { MDS } from "@minima-global/mds";
import { utf8ToHex } from "../utils/hex";
import { offlineQueueService } from "./offline-queue.service";
import { runSQL as dbRunSQL } from "./database.service";

export interface Group {
  group_id: string;
  name: string;
  creator_publickey: string;
  created_date: number;
  avatar?: string;
  description?: string;
  my_role?: "creator" | "admin" | "member";
}

export interface GroupMember {
  group_id: string;
  publickey: string;
  username: string;
  joined_date: number;
  role: string;
}

export interface GroupMessage {
  id?: number;
  group_id: string;
  sender_publickey: string;
  sender_username: string;
  type: string;
  message: string;
  filedata?: string;
  date: number;
  read?: number;
}

// MAXIMA message types for group communication
export interface GroupMaximaMessage {
  messageType:
    | "group_message"
    | "group_invite"
    | "group_member_added"
    | "group_member_removed"
    | "group_info_updated"
    | "group_member_unbanned"
    | "group_update_details"
    | "history_request"
    | "history_response"
    | "group_join_request"
    | "group_join_request_propagated"
    | "group_join_request_resolved"
    | "group_update_details"
    | "group_role_update"
    | "group_address_beacon";
  groupId: string;
  groupName: string;
  senderPublickey: string;
  senderUsername: string;
  timestamp: number;

  // For group_message:
  message?: string;
  type?: "text" | "image" | "file";
  filedata?: string;
  seq?: number; // Per-sender sequence number for gap detection

  // For group_invite:
  description?: string;
  members?: Array<{
    publickey: string;
    username: string;
    role: string;
    address?: string;
  }>;
  bannedMembers?: Array<{
    publickey: string;
    username: string;
    banned_by: string;
    banned_at: number;
  }>;
  creatorPublickey?: string;
  creatorUsername?: string;

  // For group_member_added/removed:
  memberPublickey?: string;
  memberUsername?: string;
  memberAddress?: string; // Mx address of the new/removed member for DISCOVERED_PEERS seeding

  // For group_info_updated:

  // For history_request:
  historySince?: number;

  // For history_response:
  historyMessages?: GroupMessage[];
  newName?: string;
  newDescription?: string;

  // For group_join_request
  requesterName?: string;
  requesterAddress?: string;

  // For group_join_request_resolved
  requesterPubkey?: string;
  resolutionStatus?: "approved" | "denied";
}

type GroupMessageCallback = (msg: GroupMaximaMessage) => void;
type GroupUpdateCallback = () => void;

class GroupService {
  private groupMessageCallbacks: GroupMessageCallback[] = [];
  private groupUpdateCallbacks: GroupUpdateCallback[] = [];

  constructor() {}

  /* ----------------------------------------------------------------------------
      UTILITY FUNCTIONS
    ---------------------------------------------------------------------------- */
  private generateGroupId(): string {
    return `group_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  private runSQL(sql: string): Promise<any> {
    return new Promise((resolve, reject) => {
      MDS.sql(sql, (res: any) => {
        if (!res.status) {
          reject(new Error(res.error || "SQL query failed"));
        } else {
          resolve(res);
        }
      });
    });
  }

  /* ----------------------------------------------------------------------------
      GROUP MANAGEMENT
    ---------------------------------------------------------------------------- */
  async createGroup(
    name: string,
    description: string,
    memberPublicKeys: string[],
    myPublicKey: string,
    myUsername: string,
  ): Promise<string> {
    const groupId = this.generateGroupId();
    const now = Date.now();

    try {
      // 1. Create group in database
      const createGroupSql = `
                INSERT INTO GROUPS (group_id, name, creator_publickey, created_date, description)
                VALUES ('${groupId}', '${name.replace(/'/g, "''")}', '${myPublicKey}', ${now}, '${description.replace(/'/g, "''")}')
            `;
      await this.runSQL(createGroupSql);
      console.log("✅ [GROUP-MGMT] Created:", groupId);

      // 2. Add creator as member
      const addCreatorSql = `
                INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role)
                VALUES ('${groupId}', '${myPublicKey}', '${myUsername.replace(/'/g, "''")}', ${now}, 'creator')
            `;
      await this.runSQL(addCreatorSql);

      // 3. Add other members to database
      for (const memberPubkey of memberPublicKeys) {
        // Get username from contacts
        const username = await this.getUsernameFromContact(memberPubkey);
        const addMemberSql = `
                    INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role)
                    VALUES ('${groupId}', '${memberPubkey}', '${username.replace(/'/g, "''")}', ${now}, 'member')
                `;
        await this.runSQL(addMemberSql);
      }

      // 4. Get all members for the invite message
      const members = await this.getGroupMembers(groupId);

      // 5. Send invitations via MAXIMA to all members
      for (const memberPubkey of memberPublicKeys) {
        try {
          await this.sendGroupInvite(
            groupId,
            name,
            description,
            memberPubkey,
            myPublicKey,
            myUsername,
            members,
            now,
            myPublicKey,
            myUsername,
          );
        } catch (err) {
          console.error(
            `❌ [GROUP-INVITE] Failed to send invite to ${memberPubkey}:`,
            err,
          );
          // Continue with other members even if one fails
        }
      }

      // 6. Insert initial "Group Created" message
      const initialMsgSql = `
                INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read)
                VALUES ('${groupId}', '${myPublicKey}', '${myUsername.replace(/'/g, "''")}', 'system', 'You created the group', '', ${now}, 1)
            `;
      await this.runSQL(initialMsgSql);

      this.notifyGroupUpdate();
      return groupId;
    } catch (err) {
      console.error("❌ [GROUP-MGMT] Failed to create group:", err);
      throw err;
    }
  }

  async getMyGroups(myPublicKey: string): Promise<Group[]> {
    try {
      const sql = `
                SELECT DISTINCT g.*, gm.role AS my_role
                FROM GROUPS g
                INNER JOIN GROUP_MEMBERS gm ON g.group_id = gm.group_id
                WHERE gm.publickey = '${myPublicKey}'
                ORDER BY g.created_date DESC
            `;
      const res = await this.runSQL(sql);
      return res.rows || [];
    } catch (err) {
      console.error("❌ [GROUP-MGMT] Failed to get groups:", err);
      return [];
    }
  }

  async getGroupInfo(groupId: string): Promise<Group | null> {
    try {
      const sql = `SELECT * FROM GROUPS WHERE group_id = '${groupId}'`;
      const res = await this.runSQL(sql);
      return res.rows && res.rows.length > 0 ? res.rows[0] : null;
    } catch (err) {
      console.error("❌ [GROUP-MGMT] Failed to get group info:", err);
      return null;
    }
  }

  async deleteGroup(groupId: string): Promise<void> {
    try {
      // Verify group exists
      const group = await this.getGroupInfo(groupId);
      if (!group) {
        console.warn("Group not found, but proceeding with cleanup");
      }

      // Delete messages
      await this.runSQL(
        `DELETE FROM GROUP_MESSAGES WHERE group_id = '${groupId}'`,
      );
      // Delete members
      await this.runSQL(
        `DELETE FROM GROUP_MEMBERS WHERE group_id = '${groupId}'`,
      );
      // Delete bans
      await this.runSQL(`DELETE FROM GROUP_BANS WHERE group_id = '${groupId}'`);
      // Delete group
      await this.runSQL(`DELETE FROM GROUPS WHERE group_id = '${groupId}'`);

      console.log("✅ [GROUP-MGMT] Deleted:", groupId);
      this.notifyGroupUpdate(groupId);
    } catch (err) {
      console.error("❌ [GROUP-MGMT] Failed to delete group:", err);
      throw err;
    }
  }

  async updateGroupDetails(
    groupId: string,
    newName: string | null,
    newDescription: string | null,
    myPublicKey: string,
  ): Promise<void> {
    try {
      const updates: string[] = [];
      if (newName !== null)
        updates.push(`name = '${newName.replace(/'/g, "''")}'`);
      if (newDescription !== null)
        updates.push(`description = '${newDescription.replace(/'/g, "''")}'`);

      if (updates.length > 0) {
        const sql = `UPDATE GROUPS SET ${updates.join(", ")} WHERE group_id = '${groupId}'`;
        await this.runSQL(sql);
        console.log(
          `✅ [GROUP-MGMT] Updated group ${groupId} details locally.`,
        );
      }

      // Construct maxjson payload for broadcast
      const payload: any = {
        app: "metachain-group",
        type: "group_update_details",
        messageType: "group_update_details",
        groupId: groupId,
        timestamp: Date.now(),
      };
      if (newName !== null) payload.newName = newName;
      if (newDescription !== null) payload.newDescription = newDescription;

      const members = await this.getGroupMembers(groupId);
      let propagatedCount = 0;

      // Send to all members (except self)
      for (const member of members) {
        const pubkey = (member as any).PUBLICKEY || member.publickey;
        if (!pubkey || pubkey === myPublicKey) continue;

        try {
          // Try to resolve Maxima address from DISCOVERED_PEERS
          const res = await this.runSQL(
            `SELECT address FROM DISCOVERED_PEERS WHERE publickey='${pubkey.replace(/'/g, "''")}'`,
          );
          if (res.rows && res.rows.length > 0) {
            const address = res.rows[0].ADDRESS || res.rows[0].address;
            const jsonStr = JSON.stringify(payload);
            const hexData =
              "0x" +
              Array.from(new TextEncoder().encode(jsonStr))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")
                .toUpperCase();

            await MDS.cmd.maxima({
              params: {
                action: "send",
                to: address,
                application: "metachain-group",
                data: hexData,
                poll: false,
              } as any,
            });
            propagatedCount++;
          } else {
            console.warn(
              `[GROUP-RENAME] No address found for member ${pubkey}`,
            );
          }
        } catch (e) {
          console.error(`[GROUP-RENAME] Failed to send to ${pubkey}:`, e);
        }
      }

      console.log(
        `✅ [GROUP-RENAME] Broadcasted name change to ${propagatedCount} members.`,
      );
      this.notifyGroupUpdate();
    } catch (err) {
      console.error("❌ [GROUP-MGMT] Failed to rename group:", err);
      throw err;
    }
  }

  /* ----------------------------------------------------------------------------
      MEMBER MANAGEMENT
    ---------------------------------------------------------------------------- */

  async updateMemberRole(
    groupId: string,
    memberPubkey: string,
    newRole: "admin" | "member",
    myPublicKey: string,
  ): Promise<void> {
    try {
      // Optimistic update locally
      const sql = `UPDATE GROUP_MEMBERS SET role = '${newRole}' WHERE group_id = '${groupId}' AND publickey = '${memberPubkey}'`;
      await this.runSQL(sql);
      console.log(
        `✅ [GROUP-MGMT] Updated role for ${memberPubkey} to ${newRole} locally.`,
      );

      // Construct maxjson payload for broadcast
      const payload = {
        app: "metachain-group",
        type: "group_role_update",
        messageType: "group_role_update",
        groupId: groupId,
        targetPubkey: memberPubkey,
        newRole: newRole,
        timestamp: Date.now(),
      };

      const members = await this.getGroupMembers(groupId);
      let propagatedCount = 0;

      // Send to all members (except self)
      for (const member of members) {
        const pubkey = (member as any).PUBLICKEY || member.publickey;
        if (!pubkey || pubkey === myPublicKey) continue;

        try {
          // Try to resolve Maxima address from DISCOVERED_PEERS
          const res = await this.runSQL(
            `SELECT address FROM DISCOVERED_PEERS WHERE publickey='${pubkey.replace(/'/g, "''")}'`,
          );
          if (res.rows && res.rows.length > 0) {
            const address = res.rows[0].ADDRESS || res.rows[0].address;
            const jsonStr = JSON.stringify(payload);
            const hexData =
              "0x" +
              Array.from(new TextEncoder().encode(jsonStr))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")
                .toUpperCase();

            await MDS.cmd.maxima({
              params: {
                action: "send",
                to: address,
                application: "metachain-group",
                data: hexData,
                poll: false,
              } as any,
            });
            propagatedCount++;
          } else {
            console.warn(`[GROUP-ROLE] No address found for member ${pubkey}`);
          }
        } catch (e) {
          console.error(`[GROUP-ROLE] Failed to send to ${pubkey}:`, e);
        }
      }

      console.log(
        `✅ [GROUP-ROLE] Broadcasted role change to ${propagatedCount} members.`,
      );
      this.notifyGroupUpdate();
    } catch (err) {
      console.error("❌ [GROUP-MGMT] Failed to update member role:", err);
      throw err;
    }
  }

  async addMember(
    groupId: string,
    publickey: string,
    username: string,
    myPublicKey: string,
    myUsername: string,
  ): Promise<void> {
    try {
      // 🚫 Check if the member is banned
      const isBanned = await this.isMemberBanned(groupId, publickey);
      if (isBanned) {
        throw new Error(
          `This user has been removed from the group and cannot be re-added. Only the group creator can unban them from Group Info.`,
        );
      }

      const now = Date.now();

      // Add to database
      const sql = `
                INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role)
                VALUES ('${groupId}', '${publickey}', '${username.replace(/'/g, "''")}', ${now}, 'member')
            `;
      await this.runSQL(sql);

      // Get group info
      const group = await this.getGroupInfo(groupId);
      if (!group) throw new Error("Group not found");

      // Notify all existing members about the new member
      // Read the new member's Mx address from their join request (if it exists)
      const joinReqRes = await this.runSQL(
        `SELECT address FROM GROUP_JOIN_REQUESTS WHERE group_id='${groupId}' AND publickey='${publickey}' LIMIT 1`,
      );
      const memberAddress =
        joinReqRes.rows && joinReqRes.rows.length > 0
          ? joinReqRes.rows[0].ADDRESS || joinReqRes.rows[0].address || ""
          : "";

      const members = await this.getGroupMembers(groupId);
      for (const member of members) {
        if ((member as any).PUBLICKEY !== myPublicKey) {
          try {
            await this.sendMemberAddedNotification(
              groupId,
              (group as any).NAME,
              publickey,
              username,
              memberAddress,
              (member as any).PUBLICKEY,
              myPublicKey,
              myUsername,
            );
          } catch (err) {
            console.error(
              `❌ [GROUP-MEMBER] Failed to notify ${(member as any).PUBLICKEY}:`,
              err,
            );
          }
        }
      }

      // Send invite to the new member
      const creatorInfo = members.find(
        (m) => (m as any).ROLE === "creator" || (m as any).role === "creator",
      );
      const creatorPub = creatorInfo
        ? (creatorInfo as any).PUBLICKEY || creatorInfo.publickey
        : myPublicKey;
      const creatorName = creatorInfo
        ? (creatorInfo as any).USERNAME || creatorInfo.username
        : myUsername;

      await this.sendGroupInvite(
        groupId,
        (group as any).NAME,
        (group as any).DESCRIPTION || "",
        publickey,
        myPublicKey,
        myUsername,
        members,
        Number((group as any).CREATED_DATE || Date.now()),
        creatorPub,
        creatorName,
      );

      this.notifyGroupUpdate();
    } catch (err) {
      console.error("❌ [GROUP-MEMBER] Failed to add member:", err);
      throw err;
    }
  }

  async removeMember(
    groupId: string,
    publickey: string,
    myPublicKey: string,
    myUsername: string,
  ): Promise<void> {
    try {
      // Get member info before deleting
      const memberSql = `
                SELECT m.*, COALESCE(d.alias, m.username) as resolved_name
                FROM GROUP_MEMBERS m
                LEFT JOIN DISCOVERED_PEERS d ON UPPER(m.publickey) = UPPER(d.publickey)
                WHERE m.group_id = '${groupId}' AND m.publickey = '${publickey}'
            `;
      const memberRes = await this.runSQL(memberSql);
      if (!memberRes.rows || memberRes.rows.length === 0) {
        throw new Error("Member not found");
      }
      const member = memberRes.rows[0] as any;
      // Use the best available name (resolved from Discovery DB or stored username)
      const memberUsername =
        member.RESOLVED_NAME ||
        member.resolved_name ||
        member.USERNAME ||
        member.username ||
        "Unknown";

      // Get group info
      const group = await this.getGroupInfo(groupId);
      if (!group) throw new Error("Group not found");

      // Get all members (including the one to be removed) BEFORE deleting
      const allMembers = await this.getGroupMembers(groupId);

      // Remove from database
      const sql = `DELETE FROM GROUP_MEMBERS WHERE group_id = '${groupId}' AND publickey = '${publickey}'`;
      await this.runSQL(sql);

      // 🚫 Auto-ban the removed member to prevent re-entry
      await this.banMember(groupId, publickey, myPublicKey, memberUsername);

      // Notify ALL members including the removed one (so they clean up their local state)
      for (const m of allMembers) {
        try {
          await this.sendMemberRemovedNotification(
            groupId,
            (group as any).NAME,
            publickey,
            memberUsername,
            (m as any).PUBLICKEY,
            myPublicKey,
            myUsername,
          );
        } catch (err) {
          console.error(
            `❌ [GROUP-MEMBER] Failed to notify ${(m as any).PUBLICKEY}:`,
            err,
          );
        }
      }

      this.notifyGroupUpdate();
    } catch (err) {
      console.error("❌ [GROUP-MEMBER] Failed to remove member:", err);
      throw err;
    }
  }

  async leaveGroup(
    groupId: string,
    myPublicKey: string,
    myUsername: string,
  ): Promise<void> {
    // Leaving is NOT a ban — use a direct delete to skip the auto-ban logic
    const memberSql = `SELECT * FROM GROUP_MEMBERS WHERE group_id = '${groupId}' AND publickey = '${myPublicKey}'`;
    const memberRes = await this.runSQL(memberSql);
    if (!memberRes.rows || memberRes.rows.length === 0) return;

    await this.runSQL(
      `DELETE FROM GROUP_MEMBERS WHERE group_id = '${groupId}' AND publickey = '${myPublicKey}'`,
    );

    const group = await this.getGroupInfo(groupId);
    if (!group) return;

    const members = await this.getGroupMembers(groupId);
    for (const m of members) {
      try {
        await this.sendMemberRemovedNotification(
          groupId,
          (group as any).NAME,
          myPublicKey,
          myUsername,
          (m as any).PUBLICKEY,
          myPublicKey,
          myUsername,
        );
      } catch (err) {
        console.error(`❌ [GROUP-LEAVE] Failed to notify:`, err);
      }
    }

    this.notifyGroupUpdate();
  }

  /* ----------------------------------------------------------------------------
      BAN MANAGEMENT
    ---------------------------------------------------------------------------- */
  async banMember(
    groupId: string,
    publickey: string,
    bannedBy: string,
    username: string = "Unknown",
  ): Promise<void> {
    try {
      const now = Date.now();
      const sql = `MERGE INTO GROUP_BANS (group_id, publickey, username, banned_by, banned_at) KEY(group_id, publickey) VALUES ('${groupId}', '${publickey}', '${username.replace(/'/g, "''")}', '${bannedBy}', ${now})`;
      await this.runSQL(sql);
      console.log(
        `✅ [GROUP-BAN] Banned ${publickey.substring(0, 10)} from group ${groupId}`,
      );
    } catch (err) {
      console.error("❌ [GROUP-BAN] Failed to ban member:", err);
      throw err;
    }
  }

  async unbanMember(groupId: string, publickey: string): Promise<void> {
    try {
      const sql = `DELETE FROM GROUP_BANS WHERE group_id = '${groupId}' AND UPPER(publickey) = UPPER('${publickey}')`;
      await this.runSQL(sql);
      console.log(
        `✅ [GROUP-BAN] Unbanned ${publickey.substring(0, 10)} from group ${groupId}`,
      );

      // Broadcast unban
      const group = await this.getGroupInfo(groupId);
      if (!group) return;

      const { myPublicKey: senderPub, myUsername: senderName } =
        await this.getIdentity();

      const payload: any = {
        app: "metachain-group",
        messageType: "group_member_unbanned",
        groupId,
        groupName: (group as any).NAME,
        senderPublickey: senderPub,
        senderUsername: senderName,
        timestamp: Date.now(),
        memberPublickey: publickey,
      };

      const members = await this.getGroupMembers(groupId);
      for (const m of members) {
        const p = (m as any).PUBLICKEY;
        if (p && p !== senderPub) {
          await this.sendMaximaMessage(p, payload);
        }
      }

      this.notifyGroupUpdate();
    } catch (err) {
      console.error("❌ [GROUP-BAN] Failed to unban member:", err);
      throw err;
    }
  }

  async isMemberBanned(groupId: string, publickey: string): Promise<boolean> {
    try {
      const sql = `SELECT * FROM GROUP_BANS WHERE group_id = '${groupId}' AND UPPER(publickey) = UPPER('${publickey}')`;
      const res = await this.runSQL(sql);
      return res.rows && res.rows.length > 0;
    } catch (err) {
      return false;
    }
  }

  async getGroupBans(
    groupId: string,
  ): Promise<
    Array<{
      publickey: string;
      username: string;
      resolved_name: string;
      banned_by: string;
      banned_at: number;
    }>
  > {
    try {
      const sql = `
                SELECT
                    b.*,
                    COALESCE(d.alias, u.alias, b.username) as resolved_name
                FROM GROUP_BANS b
                LEFT JOIN DISCOVERED_PEERS d ON UPPER(b.publickey) = UPPER(d.publickey)
                LEFT JOIN METACHAIN_USERS u ON UPPER(b.publickey) = UPPER(u.publickey)
                WHERE b.group_id = '${groupId}'
                ORDER BY b.banned_at DESC
            `;
      const res = await this.runSQL(sql);
      return res.rows || [];
    } catch (err) {
      console.error("❌ [GROUP-BAN] Failed to get bans:", err);
      return [];
    }
  }

  async getGroupMembers(groupId: string): Promise<GroupMember[]> {
    try {
      const sql = `
                SELECT
                    m.*,
                    COALESCE(d.alias, u.alias, m.username) as resolved_name
                FROM GROUP_MEMBERS m
                LEFT JOIN DISCOVERED_PEERS d ON UPPER(m.publickey) = UPPER(d.publickey)
                LEFT JOIN METACHAIN_USERS u ON UPPER(m.publickey) = UPPER(u.publickey)
                WHERE m.group_id = '${groupId}'
                ORDER BY m.joined_date ASC
            `;
      const res = await this.runSQL(sql);
      return res.rows || [];
    } catch (err) {
      console.error("❌ [GROUP-MEMBER] Failed to get members:", err);
      return [];
    }
  }

  /* ----------------------------------------------------------------------------
      MESSAGE HANDLING
    ---------------------------------------------------------------------------- */
  async sendGroupMessage(
    groupId: string,
    message: string,
    type: string,
    myPublicKey: string,
    myUsername: string,
    filedata: string = "",
  ): Promise<void> {
    try {
      const now = Date.now();

      // Get group info and members
      const group = await this.getGroupInfo(groupId);
      if (!group) throw new Error("Group not found");

      const members = await this.getGroupMembers(groupId);

      // Get/increment per-sender sequence number for gap detection
      const seqRes = await this.runSQL(
        `SELECT my_next_seq FROM GROUP_MSG_COUNTERS WHERE group_id='${groupId}' AND sender_publickey='${myPublicKey}'`,
      );
      let mySeq = 1;
      if (seqRes.rows && seqRes.rows.length > 0) {
        mySeq = Number(
          seqRes.rows[0].MY_NEXT_SEQ || seqRes.rows[0].my_next_seq || 1,
        );
        await this.runSQL(
          `UPDATE GROUP_MSG_COUNTERS SET my_next_seq=${mySeq + 1} WHERE group_id='${groupId}' AND sender_publickey='${myPublicKey}'`,
        );
      } else {
        await this.runSQL(
          `INSERT INTO GROUP_MSG_COUNTERS (group_id, sender_publickey, last_seen_seq, my_next_seq) VALUES ('${groupId}', '${myPublicKey}', 0, ${mySeq + 1})`,
        );
      }

      // Save message locally - only escape SQL quotes
      const escapedMsg = message.replace(/'/g, "''");
      const insertSql = `
                INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, sender_seq)
                VALUES ('${groupId}', '${myPublicKey}', '${myUsername.replace(/'/g, "''")}', '${type}', '${escapedMsg}', '${filedata}', ${now}, 1, ${mySeq})
            `;
      await this.runSQL(insertSql);

      // Prepare message
      const maximaMessage: GroupMaximaMessage = {
        messageType: "group_message",
        groupId,
        groupName: (group as any).NAME,
        senderPublickey: myPublicKey,
        senderUsername: myUsername,
        timestamp: now,
        message,
        type: type as any,
        filedata,
        seq: mySeq,
      };

      // Send to ALL group members (no Maxima contact required — uses Mx address routing)
      let sentCount = 0;
      for (const member of members) {
        const memberPubkey = (member as any).PUBLICKEY;

        // Skip myself
        if (memberPubkey === myPublicKey) continue;

        try {
          await this.sendMaximaMessage(memberPubkey, maximaMessage);
          sentCount++;
          console.log(
            `📤 [GROUP-MSG] Sent to: ${memberPubkey.substring(0, 20)}...`,
          );
        } catch (err: any) {
          console.error(
            `❌ [GROUP-MSG] Failed to send to ${memberPubkey}:`,
            err,
          );
          // Queue for offline retry
          await offlineQueueService.queueGroupMessage({
            groupId,
            targetPublicKey: memberPubkey,
            payload: maximaMessage,
          });
        }
      }

      console.log(
        `✅ [GROUP-MSG] Sent to ${sentCount} members in group: ${groupId}`,
      );
    } catch (err) {
      console.error("❌ [GROUP-MSG] Message send failed:", err);
      throw err;
    }
  }

  async retryGroupMessage(
    targetPublicKey: string,
    payload: GroupMaximaMessage,
  ): Promise<void> {
    console.log(
      `🔄 [GROUP-RETRY] Retrying send to ${targetPublicKey.substring(0, 10)}...`,
    );
    // Just try sending. If it throws, the queue service handles the failure (leaves it pending).
    await this.sendMaximaMessage(targetPublicKey, payload);
  }

  async getGroupMessages(groupId: string): Promise<GroupMessage[]> {
    try {
      const sql = `
                SELECT * FROM GROUP_MESSAGES
                WHERE group_id = '${groupId}'
                ORDER BY date ASC
            `;
      const res = await this.runSQL(sql);
      return res.rows || [];
    } catch (err) {
      console.error("❌ [GROUP-MSG] Failed to get messages:", err);
      return [];
    }
  }

  async markGroupMessagesAsRead(groupId: string): Promise<void> {
    try {
      const sql = `UPDATE GROUP_MESSAGES SET read = 1 WHERE group_id = '${groupId}'`;
      await this.runSQL(sql);
    } catch (err) {
      console.error("❌ [GROUP-MSG] Failed to mark read:", err);
    }
  }

  /* ----------------------------------------------------------------------------
      MAXIMA COMMUNICATION
    ---------------------------------------------------------------------------- */
  private async sendMaximaMessage(
    toPublicKey: string,
    message: GroupMaximaMessage,
  ): Promise<void> {
    console.log(
      `📤 [MAXIMA] Sending type '${message.messageType}' to ${toPublicKey.substring(0, 20)}...`,
    );
    const jsonStr = JSON.stringify(message);
    const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    const safeKey = toPublicKey.replace(/'/g, "''");

    // Try direct Mx address first (bypasses Maxima routing, works even if relays are offline)
    let directSent = false;
    try {
      const peerRes = await dbRunSQL(
        `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE UPPER(PUBLICKEY)=UPPER('${safeKey}') AND ADDRESS IS NOT NULL LIMIT 1`,
      );
      if (peerRes && peerRes.rows && peerRes.rows.length > 0) {
        const rawAddr = peerRes.rows[0].ADDRESS as string;
        const mxAddr = rawAddr
          .replace(/\s+/g, "")
          .replace(/[^a-zA-Z0-9@:._-]/g, "");
        const sendCmd = `maxima action:send to:${mxAddr} application:metachain-group data:${hexData} poll:true`;
        console.log(`🔍 [MAXIMA] Using Mx address for group send`);
        const res = await new Promise<any>((resolve) => {
          MDS.executeRaw(sendCmd, (r: any) => resolve(r));
        });
        if (res && res.status !== false) {
          directSent = true;
        } else {
          console.warn(
            `⚠️ [MAXIMA] Direct Mx send failed: ${res?.error}. Falling back to publickey routing...`,
          );
        }
      }
    } catch (err) {
      console.warn(`⚠️ [MAXIMA] Mx address resolve/send failed:`, err);
    }

    // Always also send via publickey: routing (redundant but ensures reachability via Maxima network)
    // This uses poll:true so it queues if the peer is temporarily offline
    const fallbackCmd = `maxima action:send publickey:${toPublicKey} application:metachain-group data:${hexData} poll:true`;
    const fallbackRes = await new Promise<any>((resolve) => {
      MDS.executeRaw(fallbackCmd, (r: any) => resolve(r));
    });

    if (!directSent && (!fallbackRes || fallbackRes.status === false)) {
      throw new Error(fallbackRes?.error || "MAXIMA send failed");
    }
  }

  private async sendGroupInvite(
    groupId: string,
    groupName: string,
    description: string,
    toPublicKey: string,
    myPublicKey: string,
    myUsername: string,
    members: GroupMember[],
    createdDate?: number,
    creatorPub?: string,
    creatorName?: string,
  ): Promise<void> {
    const bannedDB = await this.getGroupBans(groupId);
    const bannedMembers = bannedDB.map((b) => ({
      publickey: b.publickey,
      username: b.username,
      banned_by: b.banned_by,
      banned_at: b.banned_at,
    }));

    // Enrich each member with their known Mx address from DISCOVERED_PEERS
    const enrichedMembers = await Promise.all(
      members.map(async (m: any) => {
        const pk = m.PUBLICKEY || m.publickey;
        let address = m.ADDRESS || m.address || "";
        if (!address) {
          try {
            const peerRes = await this.runSQL(
              `SELECT address FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${pk}') LIMIT 1`,
            );
            if (peerRes.rows && peerRes.rows.length > 0) {
              address =
                peerRes.rows[0].ADDRESS || peerRes.rows[0].address || "";
            }
          } catch (_) {
            /* ignore */
          }
        }
        return {
          publickey: pk,
          username: m.RESOLVED_NAME || m.USERNAME || m.username,
          role: m.ROLE || m.role || "member",
          address,
        };
      }),
    );

    const message: GroupMaximaMessage = {
      messageType: "group_invite",
      groupId,
      groupName,
      senderPublickey: myPublicKey,
      senderUsername: myUsername,
      timestamp: createdDate || Date.now(),
      description,
      creatorPublickey: creatorPub || myPublicKey,
      creatorUsername: creatorName || myUsername,
      members: enrichedMembers,
      bannedMembers,
    };

    console.log(
      `📨 [GROUP-INVITE] Inviting member: ${toPublicKey} to group ${groupId}`,
    );
    await this.sendMaximaMessage(toPublicKey, message);
  }

  private async sendMemberAddedNotification(
    groupId: string,
    groupName: string,
    memberPublickey: string,
    memberUsername: string,
    memberAddress: string,
    toPublicKey: string,
    myPublicKey: string,
    myUsername: string,
  ): Promise<void> {
    const message: GroupMaximaMessage = {
      messageType: "group_member_added",
      groupId,
      groupName,
      senderPublickey: myPublicKey,
      senderUsername: myUsername,
      timestamp: Date.now(),
      memberPublickey,
      memberUsername,
      memberAddress, // New member's Mx address so recipients can seed DISCOVERED_PEERS
    };

    await this.sendMaximaMessage(toPublicKey, message);
  }

  private async sendMemberRemovedNotification(
    groupId: string,
    groupName: string,
    memberPublickey: string,
    memberUsername: string,
    toPublicKey: string,
    myPublicKey: string,
    myUsername: string,
  ): Promise<void> {
    const message: GroupMaximaMessage = {
      messageType: "group_member_removed",
      groupId,
      groupName,
      senderPublickey: myPublicKey,
      senderUsername: myUsername,
      timestamp: Date.now(),
      memberPublickey,
      memberUsername,
    };

    await this.sendMaximaMessage(toPublicKey, message);
  }

  /* ----------------------------------------------------------------------------
      INCOMING MESSAGE HANDLING
    ---------------------------------------------------------------------------- */
  async handleIncomingGroupMessage(
    message: GroupMaximaMessage,
    fromPublicKey: string,
  ): Promise<void> {
    try {
      console.log("📨 [GROUP-MSG] Incoming:", message);

      switch (message.messageType) {
        case "group_invite":
          await this.handleGroupInvite(message, fromPublicKey);
          break;
        case "group_message":
          await this.handleGroupChatMessage(message, fromPublicKey);
          break;
        case "group_member_added":
          await this.handleMemberAdded(message);
          break;
        case "group_member_removed":
          await this.handleMemberRemoved(message);
          break;
        case "group_member_unbanned":
          await this.handleMemberUnbanned(message);
          break;
        case "history_request":
          await this.handleHistoryRequest(message, fromPublicKey);
          break;
        case "history_response":
          await this.handleHistoryResponse(message);
          break;
        case "group_join_request":
        case "group_join_request_propagated":
        case "group_join_request_resolved":
        case "group_update_details":
        case "group_role_update":
        case "group_address_beacon":
          // Handled by Service Worker
          break;
        default:
          console.warn("⚠️ [GROUP-MSG] Unknown type:", message.messageType);
      }

      // Notify UI
      this.notifyGroupMessage(message);
    } catch (err) {
      console.error("❌ [GROUP-MSG] Handler failed:", err);
    }
  }

  private async handleGroupInvite(
    message: GroupMaximaMessage,
    fromPublicKey: string,
  ): Promise<void> {
    // Check if group already exists
    const existing = await this.getGroupInfo(message.groupId);
    if (existing) {
      console.log("ℹ️ [GROUP-INVITE] Group exists, skipping");
      return;
    }

    // Create group locally
    const createGroupSql = `
            INSERT INTO GROUPS (group_id, name, creator_publickey, created_date, description)
            VALUES ('${message.groupId}', '${message.groupName.replace(/'/g, "''")}', '${fromPublicKey}', ${message.timestamp}, '${(message.description || "").replace(/'/g, "''")}')
        `;
    await this.runSQL(createGroupSql);

    // Add all members
    if (message.members) {
      for (const member of message.members) {
        const memberRole =
          member.role ||
          (member.publickey === message.creatorPublickey
            ? "creator"
            : "member");
        const addMemberSql = `
                    INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role)
                    VALUES ('${message.groupId}', '${member.publickey}', '${(member.username || "Unknown").replace(/'/g, "''")}', ${message.timestamp}, '${memberRole}')
                `;
        await this.runSQL(addMemberSql);
      }
    }

    console.log("✅ [GROUP-INVITE] Accepted:", message.groupId);
    this.notifyGroupUpdate();
  }

  private async handleGroupChatMessage(
    message: GroupMaximaMessage,
    fromPublicKey: string,
  ): Promise<void> {
    // Save message locally - only escape SQL quotes
    const escapedMsg = (message.message || "").replace(/'/g, "''");

    // FIX: Use ORIGINAL sender's public key (from payload), not the relayer's (fromPublicKey)
    const originalSender = message.senderPublickey || fromPublicKey;

    const insertSql = `
            INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read)
            VALUES ('${message.groupId}', '${originalSender}', '${message.senderUsername.replace(/'/g, "''")}', '${message.type}', '${escapedMsg}', '${message.filedata || ""}', ${message.timestamp}, 0)
        `;
    await this.runSQL(insertSql);

    console.log("✅ [GROUP-MSG] Saved:", message.groupId);
  }

  private async handleMemberAdded(message: GroupMaximaMessage): Promise<void> {
    if (!message.memberPublickey || !message.memberUsername) return;

    // Check if member already exists
    const checkSql = `SELECT * FROM GROUP_MEMBERS WHERE group_id = '${message.groupId}' AND publickey = '${message.memberPublickey}'`;
    const checkRes = await this.runSQL(checkSql);
    if (checkRes.rows && checkRes.rows.length > 0) {
      console.log("ℹ️ [GROUP-MEMBER] Exists, skipping");
      return;
    }

    // Add member
    const addSql = `
            INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role)
            VALUES ('${message.groupId}', '${message.memberPublickey}', '${message.memberUsername.replace(/'/g, "''")}', ${message.timestamp}, 'member')
        `;
    await this.runSQL(addSql);

    console.log("✅ [GROUP-MEMBER] Added:", message.memberPublickey);
    this.notifyGroupUpdate();
  }

  private async handleMemberRemoved(
    message: GroupMaximaMessage,
  ): Promise<void> {
    if (!message.memberPublickey) return;

    const { myPublicKey } = await this.getIdentity();

    if (message.memberPublickey === myPublicKey) {
      console.log(
        "🚫 [GROUP-MEMBER] I have been removed/banned from the group.",
      );
      await this.deleteGroup(message.groupId); // already calls notifyGroupUpdate(groupId)
      return;
    }

    const removeSql = `DELETE FROM GROUP_MEMBERS WHERE group_id = '${message.groupId}' AND UPPER(publickey) = UPPER('${message.memberPublickey}')`;
    await this.runSQL(removeSql);

    // If removed by someone else, auto-ban locally as well
    if (
      message.senderPublickey &&
      message.senderPublickey !== message.memberPublickey
    ) {
      const now = Date.now();
      const safeUsername = (message.memberUsername || "Unknown").replace(
        /'/g,
        "''",
      );
      const banSql = `MERGE INTO GROUP_BANS (group_id, publickey, username, banned_by, banned_at) KEY(group_id, publickey) VALUES ('${message.groupId}', '${message.memberPublickey}', '${safeUsername}', '${message.senderPublickey}', ${now})`;
      await this.runSQL(banSql);
    }

    console.log("✅ [GROUP-MEMBER] Removed:", message.memberPublickey);
    this.notifyGroupUpdate(message.groupId);
  }

  private async handleMemberUnbanned(
    message: GroupMaximaMessage,
  ): Promise<void> {
    if (!message.memberPublickey) return;
    const sql = `DELETE FROM GROUP_BANS WHERE group_id = '${message.groupId}' AND UPPER(publickey) = UPPER('${message.memberPublickey}')`;
    await this.runSQL(sql);
    console.log(
      "✅ [GROUP-BAN] Unbanned via broadcast:",
      message.memberPublickey,
    );
    this.notifyGroupUpdate();
  }

  /* ----------------------------------------------------------------------------
      HISTORY SYNC
    ---------------------------------------------------------------------------- */
  async requestGroupHistory(groupId: string): Promise<void> {
    console.log(`🔄 [HISTORY-SYNC] Requesting history for group ${groupId}...`);

    try {
      // 1. Get last message timestamp
      const lastMsgSql = `SELECT date FROM GROUP_MESSAGES WHERE group_id = '${groupId}' ORDER BY date DESC LIMIT 1`;
      const res = await this.runSQL(lastMsgSql);
      const lastTimestamp =
        res.rows && res.rows.length > 0 ? res.rows[0].DATE : 0;

      // 2. Prepare Request Message
      const requestMsg: GroupMaximaMessage = {
        messageType: "history_request",
        groupId: groupId,
        groupName: "SYNC", // Placeholder
        senderPublickey: "", // Filled by sendMaximaMessage
        senderUsername: "", // Filled by sendMaximaMessage
        timestamp: Date.now(),
        historySince: Number(lastTimestamp),
      };

      // 3. Get Members
      const members = await this.getGroupMembers(groupId);

      // 4. Send Request to ALL members (Mesh Sync — no Maxima contact required)
      const { myPublicKey } = await this.getIdentity();

      let sentCount = 0;
      for (const member of members) {
        const memberPubkey = (member as any).PUBLICKEY;

        // Skip myself
        if (memberPubkey === myPublicKey) continue;

        try {
          await this.sendMaximaMessage(memberPubkey, requestMsg);
          sentCount++;
        } catch (err) {
          console.warn(
            `⚠️ [HISTORY-SYNC] Failed to ask history from ${memberPubkey.substring(0, 10)}...`,
          );
        }
      }

      console.log(
        `📤 [HISTORY-SYNC] Requested history from ${sentCount} peers.`,
      );
    } catch (err) {
      console.error("❌ [HISTORY-SYNC] Failed to request history:", err);
    }
  }

  private async handleHistoryRequest(
    message: GroupMaximaMessage,
    fromPublicKey: string,
  ): Promise<void> {
    console.log(
      `📥 [HISTORY-SYNC] History request from ${message.senderUsername} since ${message.historySince}`,
    );

    // 1. Fetch missing messages
    // Limit to 50 to prevent huge payloads
    const sql = `
            SELECT * FROM GROUP_MESSAGES
            WHERE group_id = '${message.groupId}'
            AND date > ${message.historySince || 0}
            ORDER BY date ASC
            LIMIT 50
        `;

    try {
      const res = await this.runSQL(sql);
      const messages = res.rows || [];

      if (messages.length === 0) {
        console.log("ℹ️ [HISTORY-SYNC] No new history.");
        return;
      }

      console.log(
        `📤 [HISTORY-SYNC] Sending ${messages.length} messages to ${message.senderUsername}`,
      );

      // 2. Map DB rows to GroupMessage objects
      // We use DECODED message content here because handleHistoryResponse expects to ENCODE it.
      const historyMessages: GroupMessage[] = messages.map((row: any) => ({
        group_id: row.GROUP_ID,
        sender_publickey: row.SENDER_PUBLICKEY,
        sender_username: row.SENDER_USERNAME,
        type: row.TYPE,
        message: row.MESSAGE, // Send plain text now, was decodeURIComponent(row.MESSAGE)
        filedata: row.FILEDATA,
        date: Number(row.DATE),
        read: 1,
      }));

      // 3. Send Response
      const { myPublicKey, myUsername } = await new Promise<{
        myPublicKey: string;
        myUsername: string;
      }>((resolve) => {
        MDS.executeRaw("maxima", (res: any) => {
          let pub = "";
          let name = "User";
          if (res && res.status && res.response) {
            pub = res.response.publickey || "";
            name = res.response.name || "User";
          }
          resolve({ myPublicKey: pub, myUsername: name });
        });
      });

      const responseMsg: GroupMaximaMessage = {
        messageType: "history_response",
        groupId: message.groupId,
        groupName: message.groupName,
        senderPublickey: myPublicKey,
        senderUsername: myUsername,
        timestamp: Date.now(),
        historyMessages: historyMessages,
      };

      await this.sendMaximaMessage(fromPublicKey, responseMsg);
    } catch (err) {
      console.error(
        "❌ [HISTORY-SYNC] Failed to process history request:",
        err,
      );
    }
  }

  private async handleHistoryResponse(
    message: GroupMaximaMessage,
  ): Promise<void> {
    console.log(
      `📥 [HISTORY-SYNC] Received response: ${message.historyMessages?.length} messages`,
    );

    if (!message.historyMessages || message.historyMessages.length === 0)
      return;

    let addedCount = 0;
    for (const msg of message.historyMessages) {
      // Check if already exists to avoid duplicates
      // Also check using original sender public key
      const checkSql = `
                SELECT id FROM GROUP_MESSAGES
                WHERE group_id = '${message.groupId}'
                AND date = ${msg.date}
                AND sender_publickey = '${msg.sender_publickey}'
             `;

      try {
        const checkWin = await this.runSQL(checkSql);
        if (checkWin.rows && checkWin.rows.length > 0) {
          continue;
        }

        // Insert - only escape SQL quotes
        const escapedMsg = msg.message.replace(/'/g, "''");
        const filedata = msg.filedata || "";

        // FIX: Set propagated=1 to prevent Service Worker from re-broadcasting history as new messages
        const insertSql = `
                    INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read, propagated)
                    VALUES ('${message.groupId}', '${msg.sender_publickey}', '${msg.sender_username.replace(/'/g, "''")}', '${msg.type}', '${escapedMsg}', '${filedata}', ${msg.date}, 0, 1)
                 `;

        await this.runSQL(insertSql);
        addedCount++;
      } catch (err) {
        console.warn("❌ [DB] Error inserting sync message:", err);
      }
    }

    if (addedCount > 0) {
      console.log(`✅ [HISTORY-SYNC] Added ${addedCount} missing messages.`);
      this.notifyGroupUpdate();
      this.notifyGroupMessage(message); // Also notify message listeners to trigger refresh
    }
  }

  // Join Requests API
  async getPendingJoinRequests(groupId: string): Promise<any[]> {
    const sql = `SELECT * FROM GROUP_JOIN_REQUESTS WHERE group_id = '${groupId}' AND status = 'pending' ORDER BY timestamp ASC`;
    const res = await this.runSQL(sql);
    return res.rows || [];
  }

  async resolveJoinRequest(
    groupId: string,
    publickey: string,
    status: "approved" | "denied",
  ): Promise<void> {
    // First delete it locally
    await this.runSQL(
      `DELETE FROM GROUP_JOIN_REQUESTS WHERE group_id = '${groupId}' AND publickey = '${publickey}'`,
    );

    // Notify other admins that it was resolved
    const sql = `SELECT * FROM GROUP_MEMBERS WHERE group_id = '${groupId}' AND (role = 'creator' OR role = 'admin')`;
    const res = await this.runSQL(sql);
    if (res.status && res.rows) {
      const myIdentity = await this.getIdentity();
      const groupInfo = await this.getGroupInfo(groupId);
      const payload: any = {
        messageType: "group_join_request_resolved",
        groupId: groupId,
        groupName: groupInfo?.name || "Unknown Group",
        senderPublickey: myIdentity.myPublicKey,
        senderUsername: myIdentity.myUsername,
        timestamp: Date.now(),
        requesterPubkey: publickey,
        resolutionStatus: status,
      };
      for (const row of res.rows) {
        const adminPk = row.PUBLICKEY || row.publickey;
        if (adminPk !== myIdentity.myPublicKey) {
          await this.sendMaximaMessage(adminPk, payload as GroupMaximaMessage);
        }
      }
    }
    this.notifyGroupUpdate();
  }

  async generateInviteCode(
    groupId: string,
    groupName: string,
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
          g: groupId,
          n: groupName,
          p: adminPubkey,
          a: adminAddress,
        };

        // Convert to Base64
        const jsonStr = JSON.stringify(data);
        const base64 = window.btoa(unescape(encodeURIComponent(jsonStr)));

        // Prefix to identify it as a metachain invite
        resolve(`mcgrp://${base64}`);
      });
    });
  }

  async sendJoinRequest(inviteCode: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        if (!inviteCode.startsWith("mcgrp://")) {
          throw new Error("Invalid invite code format");
        }

        const base64 = inviteCode.substring(8);
        const jsonStr = decodeURIComponent(escape(window.atob(base64)));
        const data = JSON.parse(jsonStr);

        const groupId = data.g;
        const adminPubkey = data.p;
        const adminAddress = data.a;

        // Get our info
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
          messageType: "group_join_request",
          groupId: groupId,
          groupName: data.n || "Group Invite",
          senderPublickey: myInfo.response.publickey,
          senderUsername: myName,
          requesterName: myName,
          requesterAddress: myInfo.response.contact,
          timestamp: Date.now(),
        };

        // 💡 PERFORMANCE/RELIABILITY: Seed DISCOVERED_PEERS so sendMaximaMessage can use the Mx address
        // even if we are not yet full Maxima contacts.
        const now = Date.now();
        await this.runSQL(
          `DELETE FROM DISCOVERED_PEERS WHERE publickey='${adminPubkey}'`,
        );
        await this.runSQL(`
                    INSERT INTO DISCOVERED_PEERS (publickey, address, source, alias, last_seen, avatar)
                    VALUES ('${adminPubkey}', '${adminAddress}', 'INVITE', 'Unknown', ${now}, '')
                `);

        // Send directly via the admin address (Mx...) using poll:true
        // — same pattern as sendChatRequest. No need to add admin as a permanent Maxima contact.
        const payloadJsonStr = JSON.stringify({
          ...payload,
          app: "metachain-group",
        });
        const hexData =
          "0x" +
          Array.from(new TextEncoder().encode(payloadJsonStr))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase();

        MDS.executeRaw(
          `maxima action:send application:metachain-group to:${adminAddress} data:${hexData} poll:true`,
          (sendRes: any) => {
            if (sendRes.status) {
              resolve();
            } else {
              reject(
                "Could not send join request to group admin: " + sendRes.error,
              );
            }
          },
        );
      } catch (e: any) {
        reject("Failed to process invite link: " + e.message);
      }
    });
  }

  /* ----------------------------------------------------------------------------
      HELPER FUNCTIONS
    ---------------------------------------------------------------------------- */
  private async getUsernameFromContact(publickey: string): Promise<string> {
    try {
      const response = await MDS.cmd.maxcontacts();
      if (
        response &&
        (response as any).response &&
        (response as any).response.contacts
      ) {
        const contacts = (response as any).response.contacts;
        const contact = contacts.find((c: any) => c.publickey === publickey);
        if (contact) {
          return contact.extradata?.name || contact.currentaddress || "Unknown";
        }
      }
      return "Unknown";
    } catch (err) {
      console.error("❌ [CONTACTS] Failed to resolve username:", err);
      return "Unknown";
    }
  }

  private async getIdentity(): Promise<{
    myPublicKey: string;
    myUsername: string;
  }> {
    return new Promise((resolve) => {
      MDS.cmd.maxima((res: any) => {
        let pub = "";
        let name = "User";
        if (res && res.status && res.response) {
          pub = res.response.publickey || "";
          name = res.response.name || "User";
        }
        resolve({ myPublicKey: pub, myUsername: name });
      });
    });
  }

  /* ----------------------------------------------------------------------------
      CALLBACKS
    ---------------------------------------------------------------------------- */
  onGroupMessage(cb: GroupMessageCallback) {
    this.groupMessageCallbacks.push(cb);
  }

  removeGroupMessageCallback(cb: GroupMessageCallback) {
    const index = this.groupMessageCallbacks.indexOf(cb);
    if (index > -1) {
      this.groupMessageCallbacks.splice(index, 1);
    }
  }

  onGroupUpdate(cb: GroupUpdateCallback) {
    this.groupUpdateCallbacks.push(cb);
  }

  removeGroupUpdateCallback(cb: GroupUpdateCallback) {
    const index = this.groupUpdateCallbacks.indexOf(cb);
    if (index > -1) {
      this.groupUpdateCallbacks.splice(index, 1);
    }
  }

  private notifyGroupMessage(message: GroupMaximaMessage) {
    this.groupMessageCallbacks.forEach((cb) => cb(message));
  }

  private notifyGroupUpdate(groupId?: string) {
    this.groupUpdateCallbacks.forEach((cb) => cb());
    // Also fire a window event so routes subscribed via window.addEventListener are notified
    window.dispatchEvent(
      new CustomEvent("GROUP_UPDATE", {
        detail: { type: "group_update", groupId: groupId || "" },
      }),
    );
  }
}

export const groupService = new GroupService();
