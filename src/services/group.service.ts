import { MDS } from "@minima-global/mds";
import { utf8ToHex } from "../utils/hex";


export interface Group {
    group_id: string;
    name: string;
    creator_publickey: string;
    created_date: number;
    avatar?: string;
    description?: string;
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
    | "history_request"
    | "history_response";
    groupId: string;
    groupName: string;
    senderPublickey: string;
    senderUsername: string;
    timestamp: number;

    // For group_message:
    message?: string;
    type?: "text" | "image" | "file";
    filedata?: string;

    // For group_invite:
    description?: string;
    members?: Array<{ publickey: string, username: string }>;

    // For group_member_added/removed:
    memberPublickey?: string;
    memberUsername?: string;

    // For group_info_updated:

    // For history_request:
    historySince?: number;

    // For history_response:
    historyMessages?: GroupMessage[];
    newName?: string;
    newDescription?: string;
}

type GroupMessageCallback = (msg: GroupMaximaMessage) => void;
type GroupUpdateCallback = () => void;

class GroupService {
    private groupMessageCallbacks: GroupMessageCallback[] = [];
    private groupUpdateCallbacks: GroupUpdateCallback[] = [];

    constructor() { }

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
        myUsername: string
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
                        members
                    );
                } catch (err) {
                    console.error(`❌ [GROUP-INVITE] Failed to send invite to ${memberPubkey}:`, err);
                    // Continue with other members even if one fails
                }
            }

            // 6. Insert initial "Group Created" message
            const initialMsgSql = `
                INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read)
                VALUES ('${groupId}', '${myPublicKey}', '${myUsername.replace(/'/g, "''")}', 'text', 'You created the group', '', ${now}, 1)
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
                SELECT DISTINCT g.* 
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
            await this.runSQL(`DELETE FROM GROUP_MESSAGES WHERE group_id = '${groupId}'`);
            // Delete members
            await this.runSQL(`DELETE FROM GROUP_MEMBERS WHERE group_id = '${groupId}'`);
            // Delete group
            await this.runSQL(`DELETE FROM GROUPS WHERE group_id = '${groupId}'`);

            console.log("✅ [GROUP-MGMT] Deleted:", groupId);
            this.notifyGroupUpdate();
        } catch (err) {
            console.error("❌ [GROUP-MGMT] Failed to delete group:", err);
            throw err;
        }
    }

    /* ----------------------------------------------------------------------------
      MEMBER MANAGEMENT
    ---------------------------------------------------------------------------- */
    async addMember(
        groupId: string,
        publickey: string,
        username: string,
        myPublicKey: string,
        myUsername: string
    ): Promise<void> {
        try {
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
            const members = await this.getGroupMembers(groupId);
            for (const member of members) {
                if ((member as any).PUBLICKEY !== myPublicKey) {
                    try {
                        await this.sendMemberAddedNotification(
                            groupId,
                            (group as any).NAME,
                            publickey,
                            username,
                            (member as any).PUBLICKEY,
                            myPublicKey,
                            myUsername
                        );
                    } catch (err) {
                        console.error(`❌ [GROUP-MEMBER] Failed to notify ${(member as any).PUBLICKEY}:`, err);
                    }
                }
            }

            // Send invite to the new member
            await this.sendGroupInvite(
                groupId,
                (group as any).NAME,
                (group as any).DESCRIPTION || "",
                publickey,
                myPublicKey,
                myUsername,
                members
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
        myUsername: string
    ): Promise<void> {
        try {
            // Get member info before deleting
            const memberSql = `SELECT * FROM GROUP_MEMBERS WHERE group_id = '${groupId}' AND publickey = '${publickey}'`;
            const memberRes = await this.runSQL(memberSql);
            if (!memberRes.rows || memberRes.rows.length === 0) {
                throw new Error("Member not found");
            }
            const member = memberRes.rows[0] as any;

            // Remove from database
            const sql = `DELETE FROM GROUP_MEMBERS WHERE group_id = '${groupId}' AND publickey = '${publickey}'`;
            await this.runSQL(sql);

            // Get group info
            const group = await this.getGroupInfo(groupId);
            if (!group) throw new Error("Group not found");

            // Notify all remaining members
            const members = await this.getGroupMembers(groupId);
            for (const m of members) {
                try {
                    await this.sendMemberRemovedNotification(
                        groupId,
                        (group as any).NAME,
                        publickey,
                        member.USERNAME,
                        (m as any).PUBLICKEY,
                        myPublicKey,
                        myUsername
                    );
                } catch (err) {
                    console.error(`❌ [GROUP-MEMBER] Failed to notify ${(m as any).PUBLICKEY}:`, err);
                }
            }

            this.notifyGroupUpdate();
        } catch (err) {
            console.error("❌ [GROUP-MEMBER] Failed to remove member:", err);
            throw err;
        }
    }

    async leaveGroup(groupId: string, myPublicKey: string, myUsername: string): Promise<void> {
        await this.removeMember(groupId, myPublicKey, myPublicKey, myUsername);
    }

    async getGroupMembers(groupId: string): Promise<GroupMember[]> {
        try {
            const sql = `SELECT * FROM GROUP_MEMBERS WHERE group_id = '${groupId}' ORDER BY joined_date ASC`;
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
        filedata: string = ""
    ): Promise<void> {
        try {
            const now = Date.now();

            // Get group info and members
            const group = await this.getGroupInfo(groupId);
            if (!group) throw new Error("Group not found");

            const members = await this.getGroupMembers(groupId);

            // Save message locally - only escape SQL quotes
            const escapedMsg = message.replace(/'/g, "''");
            const insertSql = `
                INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read)
                VALUES ('${groupId}', '${myPublicKey}', '${myUsername.replace(/'/g, "''")}', '${type}', '${escapedMsg}', '${filedata}', ${now}, 1)
            `;
            await this.runSQL(insertSql);

            // Get my Maxima contacts
            const contacts = await this.getMyMaximaContacts();

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
                filedata
            };

            // Send to group members who are also my contacts (selective propagation)
            let sentCount = 0;
            for (const member of members) {
                const memberPubkey = (member as any).PUBLICKEY;

                // Skip myself
                if (memberPubkey === myPublicKey) continue;

                // Check if this member is in my contacts
                const isContact = contacts.some(c => c.publickey === memberPubkey);

                if (isContact) {
                    try {
                        await this.sendMaximaMessage(memberPubkey, maximaMessage);
                        sentCount++;
                        console.log(`📤 [GROUP-MSG] Sent to contact: ${memberPubkey.substring(0, 20)}...`);
                    } catch (err) {
                        console.error(`❌ [GROUP-MSG] Failed to send to ${memberPubkey}:`, err);
                    }
                } else {
                    console.log(`⏭️ [GROUP-MSG] Skipping non-contact: ${memberPubkey.substring(0, 20)}...`);
                }
            }

            console.log(`✅ [GROUP-MSG] Sent to ${sentCount} contact members in group: ${groupId}`);
        } catch (err) {
            console.error("❌ [GROUP-MSG] Message send failed:", err);
            throw err;
        }
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
    private async sendMaximaMessage(toPublicKey: string, message: GroupMaximaMessage, isRetry: boolean = false): Promise<void> {
        console.log(`📤 [MAXIMA] Sending type '${message.messageType}' to ${toPublicKey}${isRetry ? ' (RETRY)' : ''}...`);
        const jsonStr = JSON.stringify(message);
        const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

        const response = await new Promise<any>((resolve) => {
            MDS.executeRaw("maxima action:send publickey:" + toPublicKey + " application:metachain-group data:" + hexData, (res: any) => {
                resolve(res);
            });
        });

        console.log(`📤 [MAXIMA] Send response:`, response);

        if (!response || (response as any).status === false) {
            const errorMsg = (response as any).error || "MAXIMA send failed";

            // Check for specific "No Contact found" error
            if (errorMsg.includes("No Contact found") && !isRetry) {
                console.log(`⚠️ [MAXIMA] Contact missing for ${toPublicKey}. Attempting to add contact and retry...`);

                try {
                    await this.ensureMaximaContact(toPublicKey);
                    // Add a small delay to allow the contact add to propagate if needed (though usually immediate)
                    await new Promise(r => setTimeout(r, 2000));
                    return this.sendMaximaMessage(toPublicKey, message, true);
                } catch (addErr) {
                    console.error(`❌ [CONTACTS] Failed to add contact for retry:`, addErr);
                    // Fall through to throw original error
                }
            }

            throw new Error(errorMsg);
        }
    }

    private async sendGroupInvite(
        groupId: string,
        groupName: string,
        description: string,
        toPublicKey: string,
        myPublicKey: string,
        myUsername: string,
        members: GroupMember[]
    ): Promise<void> {
        const message: GroupMaximaMessage = {
            messageType: "group_invite",
            groupId,
            groupName,
            senderPublickey: myPublicKey,
            senderUsername: myUsername,
            timestamp: Date.now(),
            description,
            members: members.map(m => ({ publickey: (m as any).PUBLICKEY, username: (m as any).USERNAME }))
        };

        console.log(`📨 [GROUP-INVITE] Inviting member: ${toPublicKey} to group ${groupId}`);
        await this.sendMaximaMessage(toPublicKey, message);
    }

    private async sendMemberAddedNotification(
        groupId: string,
        groupName: string,
        memberPublickey: string,
        memberUsername: string,
        toPublicKey: string,
        myPublicKey: string,
        myUsername: string
    ): Promise<void> {
        const message: GroupMaximaMessage = {
            messageType: "group_member_added",
            groupId,
            groupName,
            senderPublickey: myPublicKey,
            senderUsername: myUsername,
            timestamp: Date.now(),
            memberPublickey,
            memberUsername
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
        myUsername: string
    ): Promise<void> {
        const message: GroupMaximaMessage = {
            messageType: "group_member_removed",
            groupId,
            groupName,
            senderPublickey: myPublicKey,
            senderUsername: myUsername,
            timestamp: Date.now(),
            memberPublickey,
            memberUsername
        };

        await this.sendMaximaMessage(toPublicKey, message);
    }

    /* ----------------------------------------------------------------------------
      INCOMING MESSAGE HANDLING
    ---------------------------------------------------------------------------- */
    async handleIncomingGroupMessage(message: GroupMaximaMessage, fromPublicKey: string): Promise<void> {
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
                case "history_request":
                    await this.handleHistoryRequest(message, fromPublicKey);
                    break;
                case "history_response":
                    await this.handleHistoryResponse(message);
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

    private async handleGroupInvite(message: GroupMaximaMessage, fromPublicKey: string): Promise<void> {
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
                const addMemberSql = `
                    INSERT INTO GROUP_MEMBERS (group_id, publickey, username, joined_date, role)
                    VALUES ('${message.groupId}', '${member.publickey}', '${(member.username || 'Unknown').replace(/'/g, "''")}', ${message.timestamp}, '${member.publickey === fromPublicKey ? 'creator' : 'member'}')
                `;
                await this.runSQL(addMemberSql);

                // Auto-add member as MAXIMA contact if not already
                await this.ensureMaximaContact(member.publickey);
            }
        }


        // Insert initial creation message
        const encodedMsg = `${message.senderUsername.replace(/'/g, "''")} created the group`;
        const initialMsgSql = `
            INSERT INTO GROUP_MESSAGES (group_id, sender_publickey, sender_username, type, message, filedata, date, read)
            VALUES ('${message.groupId}', '${message.senderPublickey}', '${message.senderUsername.replace(/'/g, "''")}', 'text', '${encodedMsg}', '', ${message.timestamp}, 0)
        `;
        await this.runSQL(initialMsgSql);

        console.log("✅ [GROUP-INVITE] Accepted:", message.groupId);
        this.notifyGroupUpdate();
    }

    private async handleGroupChatMessage(message: GroupMaximaMessage, fromPublicKey: string): Promise<void> {
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

        // Auto-add as MAXIMA contact
        await this.ensureMaximaContact(message.memberPublickey);

        console.log("✅ [GROUP-MEMBER] Added:", message.memberPublickey);
        this.notifyGroupUpdate();
    }

    private async handleMemberRemoved(message: GroupMaximaMessage): Promise<void> {
        if (!message.memberPublickey) return;

        const removeSql = `DELETE FROM GROUP_MEMBERS WHERE group_id = '${message.groupId}' AND publickey = '${message.memberPublickey}'`;
        await this.runSQL(removeSql);

        console.log("✅ [GROUP-MEMBER] Removed:", message.memberPublickey);
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
            const lastTimestamp = (res.rows && res.rows.length > 0) ? res.rows[0].DATE : 0;

            // 2. Prepare Request Message
            const requestMsg: GroupMaximaMessage = {
                messageType: "history_request",
                groupId: groupId,
                groupName: "SYNC", // Placeholder
                senderPublickey: "", // Filled by sendMaximaMessage
                senderUsername: "",  // Filled by sendMaximaMessage
                timestamp: Date.now(),
                historySince: Number(lastTimestamp)
            };

            // 3. Get Members and My Contacts
            const members = await this.getGroupMembers(groupId);
            const contacts = await this.getMyMaximaContacts();

            // 4. Send Request to ALL connected members (Mesh Sync)
            // This increases reliability: if creator is offline, any peer can provide history.
            const { myPublicKey } = await this.getIdentity();

            let sentCount = 0;
            for (const member of members) {
                const memberPubkey = (member as any).PUBLICKEY;

                // Skip myself
                if (memberPubkey === myPublicKey) continue;

                // Check if this member is in my contacts
                const isContact = contacts.some(c => c.publickey === memberPubkey);

                if (isContact) {
                    try {
                        await this.sendMaximaMessage(memberPubkey, requestMsg);
                        sentCount++;
                    } catch (err) {
                        console.warn(`⚠️ [HISTORY-SYNC] Failed to ask history from ${memberPubkey.substring(0, 10)}...`);
                    }
                }
            }

            console.log(`📤 [HISTORY-SYNC] Requested history from ${sentCount} peers.`);

        } catch (err) {
            console.error("❌ [HISTORY-SYNC] Failed to request history:", err);
        }
    }

    private async handleHistoryRequest(message: GroupMaximaMessage, fromPublicKey: string): Promise<void> {
        console.log(`📥 [HISTORY-SYNC] History request from ${message.senderUsername} since ${message.historySince}`);

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

            console.log(`📤 [HISTORY-SYNC] Sending ${messages.length} messages to ${message.senderUsername}`);

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
                read: 1
            }));

            // 3. Send Response
            const { myPublicKey, myUsername } = await new Promise<{ myPublicKey: string, myUsername: string }>((resolve) => {
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
                historyMessages: historyMessages
            };

            await this.sendMaximaMessage(fromPublicKey, responseMsg);

        } catch (err) {
            console.error("❌ [HISTORY-SYNC] Failed to process history request:", err);
        }
    }

    private async handleHistoryResponse(message: GroupMaximaMessage): Promise<void> {
        console.log(`📥 [HISTORY-SYNC] Received response: ${message.historyMessages?.length} messages`);

        if (!message.historyMessages || message.historyMessages.length === 0) return;

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

    /* ----------------------------------------------------------------------------
      HELPER FUNCTIONS
    ---------------------------------------------------------------------------- */
    private async getUsernameFromContact(publickey: string): Promise<string> {
        try {
            const response = await MDS.cmd.maxcontacts();
            if (response && (response as any).response && (response as any).response.contacts) {
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

    private async getIdentity(): Promise<{ myPublicKey: string, myUsername: string }> {
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

    private async getMyMaximaContacts(): Promise<any[]> {
        try {
            const response = await MDS.cmd.maxcontacts();
            if (response && (response as any).response && (response as any).response.contacts) {
                return (response as any).response.contacts;
            }
            return [];
        } catch (err) {
            console.error("❌ [CONTACTS] Failed to get contacts:", err);
            return [];
        }
    }

    private async ensureMaximaContact(publickey: string): Promise<void> {
        try {
            // Check if contact already exists
            const response = await MDS.cmd.maxcontacts();
            if (response && (response as any).response && (response as any).response.contacts) {
                const contacts = (response as any).response.contacts;
                const exists = contacts.some((c: any) => c.publickey === publickey);
                if (exists) {
                    console.log("ℹ️ [CONTACTS] Contact exists:", publickey);
                    return;
                }
            }

            // Add contact
            await MDS.cmd.maxcontacts({
                action: "add",
                contact: publickey
            } as any);
            console.log("✅ [CONTACTS] Auto-added:", publickey);
        } catch (err) {
            console.error("❌ [CONTACTS] Failed to add:", err);
        }
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
        this.groupMessageCallbacks.forEach(cb => cb(message));
    }

    private notifyGroupUpdate() {
        this.groupUpdateCallbacks.forEach(cb => cb());
    }
}

export const groupService = new GroupService();
