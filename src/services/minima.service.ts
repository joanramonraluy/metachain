
import { MDS } from "@minima-global/mds";
import {
    runSQL,
    hexToUtf8,
    utf8ToHex,
    initDB,
    getAndIncrementSequenceNumber,
    //    resolveMaximaAddress, 
    //    escapeSql
} from './database.service';
import { chatService, ChatMessage, MessageCallback } from './chat.service';
import { transactionService } from './transaction.service';
import { messagingService } from './messaging.service';
import { contactRequestsService } from './contact-requests.service';
// import { DiscoveryService as discoveryService } from './discovery.service';
import { groupService } from './group.service';

import * as profileService from './profile.service';
import { offlineQueueService } from './offline-queue.service';




class MinimaService {

    private initialized = false;
    private processedMsgIds = new Set<string>();
    private instanceId = Math.floor(Math.random() * 10000);

    // Event system for light-weight UI updates (bypassing React Context complexity)
    private balanceUpdateListeners = new Set<() => void>();

    constructor() {
        console.log(`🔧[MinimaService] Instance created: #${this.instanceId} `);
        // Singleton pattern could be used, or just export an instance
    }

    /* ----------------------------------------------------------------------------
       EVENT LISTENERS (Balance)
    ---------------------------------------------------------------------------- */
    onBalanceUpdate(cb: () => void) {
        this.balanceUpdateListeners.add(cb);
        return () => this.balanceUpdateListeners.delete(cb);
    }

    notifyBalanceUpdate() {
        console.log("💰 [SERVICE] Notifying listeners of balance update...");
        this.balanceUpdateListeners.forEach(cb => cb());
        // Also dispatch window event for components not using the service subscription
        window.dispatchEvent(new CustomEvent('minima_balance_update'));
    }

    /* ----------------------------------------------------------------------------
       DATABASE & UTILITIES
    ---------------------------------------------------------------------------- */

    /**
     * Run SQL query (Promise wrapper)
     * Delegates to database.service
     */
    runSQL(sql: string): Promise<any> {
        return runSQL(sql);
    }

    /**
     * Run a Minima command (Generic wrapper)
     */
    runCommand(command: string): Promise<any> {
        return new Promise((resolve) => {
            MDS.executeRaw(command, (res: any) => {
                resolve(res);
            });
        });
    }

    /**
     * Convert Hex to UTF8
     * Delegates to database.service
     */
    hexToUtf8(hexStr: string): string {
        return hexToUtf8(hexStr);
    }

    /**
     * Convert UTF8 to Hex
     * Delegates to database.service
     */
    utf8ToHex(s: string): string {
        return utf8ToHex(s);
    }

    /**
     * Initialize Database Tables
     * Delegates to database.service
     */
    async initDB(): Promise<void> {
        await initDB();
        await offlineQueueService.init();
    }

    /* ----------------------------------------------------------------------------
       CHAT STATUS & MESSAGES (Delegated to ChatService)
    ---------------------------------------------------------------------------- */
    archiveChat(publickey: string): Promise<void> {
        return chatService.archiveChat(publickey);
    }

    unarchiveChat(publickey: string): Promise<void> {
        return chatService.unarchiveChat(publickey);
    }

    markChatAsOpened(publickey: string): Promise<void> {
        return chatService.markChatAsOpened(publickey);
    }

    setAppInstalled(publickey: string): Promise<void> {
        return chatService.setAppInstalled(publickey);
    }

    isAppInstalled(publickey: string): Promise<boolean> {
        return chatService.isAppInstalled(publickey);
    }

    muteContact(publickey: string): Promise<void> {
        return chatService.muteContact(publickey);
    }

    unmuteContact(publickey: string): Promise<void> {
        return chatService.unmuteContact(publickey);
    }

    isContactMuted(publickey: string): Promise<boolean> {
        return chatService.isContactMuted(publickey);
    }

    blockContact(publickey: string): Promise<void> {
        return chatService.blockContact(publickey);
    }

    unblockContact(publickey: string): Promise<void> {
        return chatService.unblockContact(publickey);
    }

    markChatAsFavorite(publickey: string): Promise<void> {
        return chatService.markChatAsFavorite(publickey);
    }

    unmarkChatAsFavorite(publickey: string): Promise<void> {
        return chatService.unmarkChatAsFavorite(publickey);
    }

    isChatFavorite(publickey: string): Promise<boolean> {
        return chatService.isChatFavorite(publickey);
    }

    getChatStatus(publickey: string): Promise<{ archived: boolean; lastOpened: number | null; favorite: boolean; blocked: boolean; blockedByThem: boolean }> {
        return chatService.getChatStatus(publickey);
    }

    async insertMessage(msg: ChatMessage & { date?: number }) {
        return chatService.insertMessage(msg);
    }

    getMessages(publickey: string): Promise<ChatMessage[]> {
        return chatService.getMessages(publickey);
    }

    deleteAllMessages(publickey: string): Promise<void> {
        return chatService.deleteAllMessages(publickey);
    }

    getRecentChats(): Promise<any[]> {
        return chatService.getRecentChats();
    }

    // Callbacks delegated to ChatService
    onNewMessage(cb: MessageCallback) {
        return chatService.onNewMessage(cb);
    }

    removeNewMessageCallback(cb: MessageCallback) {
        return chatService.removeNewMessageCallback(cb);
    }

    notifyNewMessage(msg: any) {
        return chatService.notifyNewMessage(msg);
    }

    onMuteStatusChange(cb: () => void) {
        return chatService.onMuteStatusChange(cb);
    }

    removeMuteStatusCallback(cb: () => void) {
        return chatService.removeMuteStatusCallback(cb);
    }

    onArchiveStatusChange(cb: () => void) {
        return chatService.onArchiveStatusChange(cb);
    }

    removeArchiveStatusCallback(cb: () => void) {
        return chatService.removeArchiveStatusCallback(cb);
    }

    onFavoriteStatusChange(cb: () => void) {
        return chatService.onFavoriteStatusChange(cb);
    }

    removeFavoriteStatusCallback(cb: () => void) {
        return chatService.removeFavoriteStatusCallback(cb);
    }

    /**
     * Handle NEWBALANCE event - a transaction has been confirmed
     */
    async handleNewBalance() {
        try {
            console.log('💰 [WALLET] Balance changed - notifying UI...');

            // Transaction cleanup is now handled by Service Worker
            // Just notify UI to refresh balance
            this.notifyBalanceUpdate();

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
            WHERE status = 'pending' 
            AND message_timestamp = ${stateId}
            LIMIT 1
        `;

        try {
            const res = await this.runSQL(sql);
            return res.rows && res.rows.length > 0 ? res.rows[0] : null;
        } catch (err) {
            console.error(`❌[TX] Failed to find pending transaction by stateId: `, err);
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
                console.log(`📨[MAXIMA - DEBUG] Processing msg type: ${json.type}, from: ${from} `);
                console.log(`📨[MAXIMA - DEBUG] Full Payload: `, json);

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
                        const cmd = `maxextra action:addpermanent publickey:${pubkey} `;
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
                        console.log(`🗣[GOSSIP] Processing ${json.peers.length} peers...`);

                        // Save each peer to Frontend's DISCOVERED_PEERS table
                        json.peers.forEach((peer: any) => {
                            if (!peer.pubkey) return;

                            const now = Date.now();
                            const escapedAlias = (peer.alias || 'Anonymous').replace(/'/g, "''");
                            const escapedBio = (peer.bio || "").replace(/'/g, "''");
                            const allowChats = (peer.allowNonContactChats !== undefined && peer.allowNonContactChats !== null)
                                ? (peer.allowNonContactChats ? 1 : 0)
                                : 1;

                            const sql = `MERGE INTO DISCOVERED_PEERS(publickey, alias, bio, address, last_seen, source, allow_non_contact_chats)
KEY(publickey)
VALUES('${peer.pubkey}', '${escapedAlias}', '${escapedBio}', '${peer.address}', ${now}, 'GOSSIP', ${allowChats})`;

                            MDS.sql(sql, (res: any) => {
                                if (res.status) {
                                    console.log(`✅[GOSSIP] Saved peer: ${peer.alias} `);
                                } else {
                                    console.error(`❌[GOSSIP] Failed to save ${peer.alias}: `, res.error);
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

                        const sql = `MERGE INTO DISCOVERED_PEERS(publickey, alias, bio, address, last_seen, source, allow_non_contact_chats)
KEY(publickey)
VALUES('${peer.pubkey}', '${escapedAlias}', '${escapedBio}', '${peer.address}', ${now}, 'P2P', ${allowChats})`;

                        MDS.sql(sql, (res: any) => {
                            if (res.status) {
                                console.log(`✅[SYNC] Peer saved to Frontend: ${peer.alias} `);
                                // Trigger UI refresh
                                window.dispatchEvent(new CustomEvent('DISCOVERY_UPDATE'));
                            } else {
                                console.error(`❌[SYNC] Failed to save ${peer.alias}: `, res.error);
                            }
                        });
                    }
                    return;
                }

                // Handle Internal Sync - Peer Updated (for open chats to refresh blocking state)
                if (json.type === "peer_updated") {
                    console.log("🔄 [PEER] Updated:", json.peer?.alias);
                    if (json.peer) {
                        // Emit event for open chats to refresh their state
                        window.dispatchEvent(new CustomEvent("peer_updated", {
                            detail: json.peer
                        }));
                    }
                    return;
                }

                if (json.type === "read") {
                    console.log("✅ [READ-RECEIPT] Received from", from);
                    // DB update is handled by Service Worker
                    // Notify listeners to refresh UI
                    chatService.notifyNewMessage({ ...json, type: 'read_receipt' });
                    return;
                }

                if (json.type === "delivery_receipt") {
                    console.log("✅ [DELIVERY-RECEIPT] Received from", from);
                    // DB update is handled by Service Worker
                    // Notify listeners to refresh UI
                    chatService.notifyNewMessage({ ...json, type: 'delivery_receipt' });
                    return;
                }

                if (json.type === "ping") {
                    console.log("📡 [PING] Ping received from", from, "- sending Pong");
                    // Send Pong response
                    this.sendPong(from).catch(err => console.error("❌ [PING] Failed to send Pong:", err));
                    // Notify listeners (optional, but good for debugging)
                    chatService.notifyNewMessage({ ...json, type: 'ping' });
                    return;
                }

                if (json.type === "pong") {
                    console.log("📡 [PING] Pong received from", from);

                    // Update last_seen timestamp in database
                    const now = Date.now();
                    const safeKey = from.replace(/'/g, "''");
                    const updateSql = `UPDATE DISCOVERED_PEERS SET last_seen=${now} WHERE UPPER(publickey)=UPPER('${safeKey}')`;
                    this.runSQL(updateSql).catch(err => {
                        console.warn("⚠️ [PING] Failed to update last_seen:", err);
                    });

                    // Notify listeners so UI can update app status
                    // Include 'from' so Discovery page can identify which profile responded
                    chatService.notifyNewMessage({ ...json, type: 'pong', from });
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
                    console.log(`👤 [PROFILE] Response received from ${from} - saving to Discovery DB`);

                    // SAVE TO DISCOVERED_PEERS (Fix for "Unknown User")
                    const now = Date.now();
                    const escapedAlias = (json.name || 'Unknown').replace(/'/g, "''");
                    const escapedBio = (json.bio || "").replace(/'/g, "''");
                    // Use a safe default for allowChats if missing
                    const allowChats = (json.allowNonContactChats !== undefined && json.allowNonContactChats !== null)
                        ? (json.allowNonContactChats ? 1 : 0)
                        : 1;

                    // Parse potential avatar? (Not currently supported in DISCOVERED_PEERS schema, but name/bio are)
                    const extraData = JSON.stringify(json);
                    const escapedExtraData = extraData.replace(/'/g, "''");

                    // CRITICAL: We MUST save the 'extra_data' column because that's where 'minimaaddress' lives!
                    const updateProfileSql = `MERGE INTO DISCOVERED_PEERS(publickey, alias, bio, extra_data, last_seen, source, allow_non_contact_chats)
                                              KEY(publickey)
                                              VALUES('${from}', '${escapedAlias}', '${escapedBio}', '${escapedExtraData}', ${now}, 'PROFILE_RESPONSE', ${allowChats})`;

                    try {
                        await this.runSQL(updateProfileSql);
                        console.log(`✅ [PROFILE] Saved ${json.name} to Discovery DB`);

                        // Notify UI via event so ChatPage can update immediately without waiting for timeout
                        // Re-using 'peer_updated' event which ChatPage might listen to or we can add listener
                        window.dispatchEvent(new CustomEvent('peer_updated', {
                            detail: { ...json, publickey: from, alias: json.name }
                        }));
                    } catch (err) {
                        console.error("❌ [PROFILE] Failed to save profile to DB:", err);
                    }

                    console.log(`👤 [PROFILE] Forwarding to ProfileService`);
                    // Use static service instance
                    profileService.handleProfileResponse(from, json);
                    return;
                }

                if (json.type === "contact_request") {
                    console.log("📨 [CONTACTS] Request received from", from);
                    // Save to database and THEN notify UI
                    this.saveContactRequest(from, json.name || "Unknown", json.avatar || "", maximaData.to, json.from_address)
                        .then(() => {
                            console.log("✅ [CONTACTS] Request saved, notifying UI...");
                            // Notify UI to show banner AFTER saving
                            chatService.notifyNewMessage({ ...json, type: 'contact_request', from });
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
                        console.log(`🔄[MIGRATION] Checking for chats with address ${fromAddress} to migrate to ${from} `);

                        // Migrate CHAT_MESSAGES
                        const migrateChatSql = `UPDATE CHAT_MESSAGES SET publickey = '${from}' WHERE publickey = '${fromAddress}'`;
                        await this.runSQL(migrateChatSql);

                        // Migrate CONTACT_REQUESTS (outgoing from us to them)
                        const migrateReqSql = `UPDATE CONTACT_REQUESTS SET to_publickey = '${from}' WHERE to_publickey = '${fromAddress}'`;
                        await this.runSQL(migrateReqSql);

                        console.log(`✅[MIGRATION] Complete for ${fromAddress}`);
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

                    const updateReqSql = `UPDATE CONTACT_REQUESTS SET status = 'accepted', updated_at = ${Date.now()} 
                                          WHERE (from_publickey = '${safeMyKey}' AND to_publickey = '${safeFrom}')
                                             OR (from_publickey = '${safeFrom}' AND to_publickey = '${safeMyKey}')`;

                    const checkRes = await this.runSQL(`SELECT count(*) as count FROM CONTACT_REQUESTS WHERE (from_publickey = '${safeMyKey}' AND to_publickey = '${safeFrom}') OR (from_publickey = '${safeFrom}' AND to_publickey = '${safeMyKey}')`);
                    const count = (checkRes && checkRes.rows && checkRes.rows[0]) ? checkRes.rows[0].COUNT : 0;

                    if (count > 0) {
                        await this.runSQL(updateReqSql);
                    } else {
                        // Insert new accepted record if none exists
                        console.log("⚠️ [CONTACTS] No pending request found - Creating new ACCEPTED record");
                        const insertReqSql = `INSERT INTO CONTACT_REQUESTS (from_publickey, to_publickey, status, created_at, updated_at)
                                              VALUES ('${safeMyKey}', '${safeFrom}', 'accepted', ${Date.now()}, ${Date.now()})`;
                        await this.runSQL(insertReqSql);
                    }

                    // Notify UI (Frontend only listens now)
                    chatService.notifyNewMessage({ ...json, type: 'contact_accepted', from });
                    return;
                }

                if (json.type === "contact_declined") {
                    console.log("🚫 [CONTACTS] Request declined by", from);

                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safeFrom = escapeSql(from);

                    // ROBUST FIX: Attempt to resolve Maxima Address from Public Key
                    // to ensure we update the request regardless of how it was sent (Hex vs Mx Address).
                    let addressClause = `to_publickey = '${safeFrom}'`;

                    try {
                        const discoverySql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE PUBLICKEY = '${safeFrom}' LIMIT 1`;
                        const discoveryRes = await this.runSQL(discoverySql);
                        if (discoveryRes.rows && discoveryRes.rows.length > 0) {
                            const mxAddress = discoveryRes.rows[0].ADDRESS;
                            console.log(`🔍[CONTACTS] Resolved decline sender to Maxima Address: ${mxAddress} `);
                            addressClause += ` OR to_publickey = '${escapeSql(mxAddress)}'`;
                        }
                    } catch (e) {
                        console.warn("⚠️ [CONTACTS] Failed to resolve address for decline check:", e);
                    }

                    // Update local DB immediately with robust check
                    const updateReqSql = `UPDATE CONTACT_REQUESTS SET status = 'declined', updated_at = ${Date.now()}
WHERE(${addressClause}) AND status = 'pending'`;

                    await this.runSQL(updateReqSql);
                    console.log("✅ [CONTACTS] Local request status updated to declined");

                    // Notify UI
                    chatService.notifyNewMessage({ ...json, type: 'contact_declined', from });
                    return;
                }

                // Maxima Contact Request handlers
                if (json.type === "maxima_contact_request") {
                    console.log("📨 [MAXIMA CONTACT] Request received from", from);
                    const fromName = json.name || "Unknown";
                    await this.saveMaximaContactRequest(from, fromName);
                    chatService.notifyNewMessage({ ...json, type: 'maxima_contact_request', from });
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

                    const updateReqSql = `UPDATE MAXIMA_CONTACT_REQUESTS SET status = 'accepted', updated_at = ${Date.now()} 
                                          WHERE from_publickey = '${safeMyKey}' AND to_publickey = '${safeFrom}'`;
                    await this.runSQL(updateReqSql);

                    chatService.notifyNewMessage({ ...json, type: 'maxima_contact_accepted', from });
                    return;
                }

                if (json.type === "maxima_contact_declined") {
                    console.log("🚫 [MAXIMA CONTACT] Request declined by", from);

                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safeFrom = escapeSql(from);

                    const updateReqSql = `UPDATE MAXIMA_CONTACT_REQUESTS SET status = 'declined', updated_at = ${Date.now()} 
                                          WHERE to_publickey = '${safeFrom}' AND status = 'pending'`;
                    await this.runSQL(updateReqSql);

                    chatService.notifyNewMessage({ ...json, type: 'maxima_contact_declined', from });
                    return;
                }

                if (json.type === "contact_blocked") {
                    console.log("🚫 [CONTACTS] Blocked by", from);
                    // Update local DB
                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safeFrom = escapeSql(from);
                    const updateSql = `MERGE INTO CHAT_STATUS (publickey, blocked_by_them) KEY(publickey) VALUES('${safeFrom}', TRUE)`;
                    await this.runSQL(updateSql);

                    // Notify UI
                    chatService.notifyNewMessage({ ...json, type: 'contact_blocked', from });
                    return;
                }

                if (json.type === "contact_unblocked") {
                    console.log("🔓 [CONTACTS] Unblocked by", from);
                    // Update local DB
                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safeFrom = escapeSql(from);
                    const updateSql = `UPDATE CHAT_STATUS SET blocked_by_them=FALSE WHERE publickey='${safeFrom}'`;
                    await this.runSQL(updateSql);

                    // Notify UI
                    chatService.notifyNewMessage({ ...json, type: 'contact_unblocked', from });
                    return;
                }

                if (json.type === "contact_blocked") {
                    console.log("🚫 [CONTACTS] Blocked by", from);
                    // Update local DB
                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safeFrom = escapeSql(from);
                    const updateSql = `MERGE INTO CHAT_STATUS (publickey, blocked_by_them) KEY(publickey) VALUES('${safeFrom}', TRUE)`;
                    await this.runSQL(updateSql);

                    // Notify UI
                    chatService.notifyNewMessage({ ...json, type: 'contact_blocked', from });
                    return;
                }

                if (json.type === "contact_unblocked") {
                    console.log("🔓 [CONTACTS] Unblocked by", from);
                    // Update local DB
                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safeFrom = escapeSql(from);
                    const updateSql = `UPDATE CHAT_STATUS SET blocked_by_them=FALSE WHERE publickey='${safeFrom}'`;
                    await this.runSQL(updateSql);

                    // Notify UI
                    chatService.notifyNewMessage({ ...json, type: 'contact_unblocked', from });
                    return;
                }

                // Redundant profile_response handler removed




                if (json.type === "contact_request_received") {
                    console.log("✅ [CONTACTS] Request delivery confirmed by", from);
                    // Update local message state from 'sent' to 'delivered'
                    const escapeSql = (str: string) => str.replace(/'/g, "''");
                    const safePublicKey = escapeSql(from);
                    const updateSql = `UPDATE CHAT_MESSAGES 
                                       SET state = 'delivered' 
                                       WHERE publickey = '${safePublicKey}' 
                                       AND type = 'system' 
                                       AND message = 'Contact request sent'`;
                    this.runSQL(updateSql).then(() => {
                        console.log("✅ [CONTACTS] Message state updated to delivered");
                    }).catch(err => {
                        console.error("❌ [CONTACTS] Failed to update message state:", err);
                    });
                    return;
                }


                // SMART SYNC PROTOCOL
                // 'sync_status_check' is handled by the Service Worker (backend) to send auto-replies.
                // We ignore it here to avoid duplicate logic.
                if (json.type === "sync_status_check") {
                    console.log("🔄 [SMART-SYNC] Status check received (handled by SW).");
                    return;
                }

                // 'sync_status_report' is the response telling us we are behind.
                // We need to notify the UI to show a "Syncing..." or "Unread" state.
                if (json.type === "sync_status_report") {
                    console.log("📊 [SMART-SYNC] Gap report received:", json);
                    chatService.notifyNewMessage({ ...json, type: 'sync_status_report', from });
                    return;
                }
                // HANDLE HISTORY SYNC RESPONSE
                // The DB insertion is handled by the Service Worker (chat.handler.js)
                // We just need to wait a moment for it to finish and then tell the UI to refresh.
                if (json.type === "chat_history_response") {
                    console.log("🔄 [HISTORY] Received history sync response, triggering UI refresh...");
                    setTimeout(() => {
                        console.log("🔄 [HISTORY] Triggering UI update now.");
                        chatService.notifyNewMessage({
                            ...json,
                            type: 'history_sync', // Special type to trigger broad refresh
                            from
                        });
                    }, 2000);
                    return;
                }

                // Normal message - FILTER: Only process actual chat message types
                const validChatTypes = ["text", "image", "video", "audio", "file", "charm", "token", "gif", "sticker", "voice"];
                if (!validChatTypes.includes(json.type)) {
                    console.log(`ℹ️ [MAXIMA] Ignoring non-chat type: ${json.type}`);
                    return;
                }

                console.log("✅ [MAXIMA] Message received (saved by SW):", json.message);

                // DB insertion and Delivery Receipt are handled by Service Worker
                // We only need to notify the UI

                // Notify UI to refresh
                chatService.notifyNewMessage(json);
            } catch (err) {
                console.error("❌ [MAXIMA] Error processing message:", err);
                console.error("❌ [MAXIMA] Received data:", datastr);
            }
        } else {
            console.log(`ℹ️[MAXIMA] Message ignored(wrong app) "${maximaData.application}"`);
        }
    }

    /* ----------------------------------------------------------------------------
      SENDING MESSAGES
    ---------------------------------------------------------------------------- */
    async sendMessage(
        toPublicKey: string,
        senderName: string,
        message: string,
        type: string = "text",
        filedata: string = "",
        amount: number = 0,
        existingTimestamp?: number,
        recipientName?: string,
        targetApplication: string = "metachain",
        saveToDb: boolean = true,
        txpowid?: string,
        overrideSeq?: number
    ) {
        if (!this.initialized) await this.init();
        return messagingService.sendMessage(toPublicKey, senderName, message, type, filedata, amount, existingTimestamp, recipientName, targetApplication, saveToDb, txpowid, overrideSeq);
    }



    async updateMessageState(publickey: string, timestamp: number, state: string, newTimestamp?: number, txpowid?: string, sender_seq?: number) {
        console.log(`🔄[DB] Updating message state: newState = "${state}", timestamp = ${timestamp} `);

        let setClause = `state = '${state}'`;
        if (newTimestamp) {
            // Remove quotes for numeric date field
            setClause += `, date = ${newTimestamp} `;
        }
        if (txpowid) {
            setClause += `, txpowid = '${txpowid}' `;
        }
        if (sender_seq !== undefined) {
            setClause += `, sender_seq = ${sender_seq} `;
        }

        // Remove quotes for numeric date field in WHERE clause
        const sql = `
            UPDATE CHAT_MESSAGES
            SET ${setClause}
            WHERE publickey = '${publickey}' AND date = ${timestamp}
`;

        console.log(`💾[SQL] Updating message state to '${state}'${newTimestamp ? ` and date to ${newTimestamp}` : ''} for timestamp ${timestamp}`);

        try {
            const result = await this.runSQL(sql);
            console.log(`✅[SQL] Message state updated.Result: `, JSON.stringify(result));
            return result;
        } catch (err) {
            console.error("❌ [SQL] Error updating message state:", err);
            throw err;
        }
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
        return transactionService.insertTransaction(txpowid, type, publickey, messageTimestamp, metadata, pendinguid);
    }

    async updateTransactionStatus(txpowid: string, status: 'pending' | 'confirmed' | 'rejected'): Promise<void> {
        return transactionService.updateTransactionStatus(txpowid, status);
    }

    /**
     * Cleanup messages that are stuck in 'pending' state
     * NOTE: Transaction cleanup is now handled by Service Worker
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

        console.log(`🔍[CLEANUP] Found ${result.rows.length} pending messages.Verifying consistency...`);

        let fixedCount = 0;

        for (const msg of result.rows) {
            const timestamp = msg.DATE; // This links to TRANSACTIONS.message_timestamp

            // Check if there is a transaction for this message
            const txSql = `SELECT * FROM TRANSACTIONS WHERE message_timestamp = ${timestamp} `;
            const txResult = await this.runSQL(txSql);

            if (!txResult.rows || txResult.rows.length === 0) {
                // Case 1: Message is pending, but NO transaction record exists
                // This is a zombie message (transaction creation might have failed)
                // We should mark it as failed
                console.log(`🗑️[CLEANUP] Message ${timestamp} has NO transaction record - marking as failed`);
                await this.updateMessageState(msg.PUBLICKEY, timestamp, 'failed');
                fixedCount++;
            } else {
                // Case 2: Transaction record exists
                const tx = txResult.rows[0];

                if (tx.STATUS === 'confirmed') {
                    // Transaction is confirmed, but message is still pending -> Fix it
                    console.log(`✅[CLEANUP] Message ${timestamp} has CONFIRMED transaction - fixing state to sent`);
                    await this.updateMessageState(msg.PUBLICKEY, timestamp, 'sent');
                    fixedCount++;
                } else if (tx.STATUS === 'rejected') {
                    // Transaction is rejected, but message is still pending -> Fix it
                    console.log(`❌[CLEANUP] Message ${timestamp} has REJECTED transaction - fixing state to failed`);
                    await this.updateMessageState(msg.PUBLICKEY, timestamp, 'failed');
                    fixedCount++;
                }
                // If transaction is 'pending', we leave it (handled by cleanupOrphanedPendingTransactions)
            }
        }

        if (fixedCount > 0) {
            console.log(`✅[CLEANUP] Fixed ${fixedCount} stuck messages`);
        } else {
            console.log(`✅[CLEANUP] All pending messages have valid pending transactions`);
        }
    }

    async getPendingTransactions(): Promise<any[]> {
        return transactionService.getPendingTransactions();
    }

    async getTransactionByMessageTimestamp(timestamp: number): Promise<any | null> {
        return transactionService.getTransactionByMessageTimestamp(timestamp);
    }

    async getTransactionByPendingUid(pendinguid: string): Promise<any | null> {
        return transactionService.getTransactionByPendingUid(pendinguid);
    }

    async checkTransactionStatus(txpowid: string): Promise<{ status: 'pending' | 'confirmed' | 'rejected' | 'unknown', timestamp?: number }> {
        return transactionService.checkTransactionStatus(txpowid);
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
            console.log(`🔍[HISTORY] Querying txpows for address: ${myAddress} `);

            // Query transactions for our address (last 100)
            const txpowResponse: any = await new Promise((resolve) => {
                MDS.executeRaw(`txpow address:${myAddress} max: 100`, (res: any) => {
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
                                console.log(`✅[HISTORY] Found MetaChain tx: ${stateId} -> ${txpowid} (Time: ${timestamp})`);
                            }
                        }
                    }
                } catch (err) {
                    console.error('❌ [HISTORY] Error parsing txpow:', err);
                }
            }

            console.log(`✅[HISTORY] Found ${historyMap.size} MetaChain transaction(s) in blockchain`);
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
                MDS.executeRaw(`txpow address:${myAddress} max: 100`, (res: any) => {
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
                                    console.log(`⏳[MEMPOOL] Found pending MetaChain tx: ${stateId} -> ${txpowid} `);
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.error('❌ [MEMPOOL] Error parsing txpow:', err);
                }
            }

            console.log(`✅[MEMPOOL] Found ${pendingMap.size} pending MetaChain transaction(s) in mempool`);
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
                MDS.executeRaw(`txpow txpowid:${txpowid} `, (res: any) => {
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
            console.error(`❌[TX - CHECK] Error checking txpowid ${txpowid}: `, err);
            return 'not_found';
        }
    }

    /**
     * Check if a specific pending UID is still in the pending list
     * Uses 'checkpending' command which doesn't create a pending entry
     * Returns true if the UID is still pending, false otherwise
     */
    async checkPendingUID(uid: string): Promise<boolean> {
        return transactionService.checkPendingUID(uid);
    }

    async updateTransactionTxpowid(pendinguid: string, txpowid: string): Promise<void> {
        return transactionService.updateTransactionTxpowid(pendinguid, txpowid);
    }

    async updateTransactionStatusByPendingUid(pendinguid: string, status: 'pending' | 'sent' | 'confirmed' | 'rejected'): Promise<void> {
        return transactionService.updateTransactionStatusByPendingUid(pendinguid, status);
    }

    async getPendingMessages(publickey: string) {
        const sql = `SELECT * FROM CHAT_MESSAGES WHERE publickey = '${publickey}' AND state = 'pending'`;
        try {
            const res = await this.runSQL(sql);
            return res.rows;
        } catch (err) {
            console.error("❌ [DB] Error fetching pending messages:", err);
            return [];
        }
    }

    async sendReadReceipt(toPublicKey: string) {
        return messagingService.sendReadReceipt(toPublicKey);
    }

    async sendDeliveryReceipt(toPublicKey: string) {
        return messagingService.sendDeliveryReceipt(toPublicKey);
    }

    async sendInvitation(toPublicKey: string, fromUsername: string) {
        return messagingService.sendInvitation(toPublicKey, fromUsername);
    }

    async sendPing(toPublicKey: string) {
        return messagingService.sendPing(toPublicKey);
    }

    async requestChatHistory(toPublicKey: string) {
        return messagingService.requestChatHistory(toPublicKey);
    }

    async sendPong(toPublicKey: string) {
        return messagingService.sendPong(toPublicKey);
    }

    /* ----------------------------------------------------------------------------
      TOKEN SENDING
    ---------------------------------------------------------------------------- */
    async getBalance(): Promise<any[]> {
        return transactionService.getBalance();
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
        console.log(`🎯[CHARM] Sending charm ${charmId} with ${amount} Minima to ${recipientName} `);

        try {
            // Get my public key for chat ID generation
            const maximaInfo = await this.runCommand('maxima action:info');
            const myPublicKey = maximaInfo?.response?.publickey || '';

            // Step 1: Send the Minima tokens (tokenId 0x00 is always Minima)
            const tokenResponse = await this.sendToken("0x00", amount.toString(), minimaAddress, "Minima", stateId, myPublicKey, toPublicKey);

            // Extract txpowid and pendinguid from token response
            const txpowid = tokenResponse?.txpowid;
            const pendinguid = tokenResponse?.pendinguid;

            // Check if token send is pending
            const isTokenPending = tokenResponse && (tokenResponse.pending || (tokenResponse.error && tokenResponse.error.toString().toLowerCase().includes("pending")));

            if (isTokenPending) {
                console.log(`⚠️[CHARM] Token send is pending.Saving message locally but NOT sending via Maxima yet.`);

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
                    console.log(`💾[CHARM] Transaction tracked: ${txpowid || 'No TXPOWID'} (PendingUID: ${pendinguid || 'None'})`);
                } else {
                    console.warn(`⚠️[CHARM] Could not track transaction: No txpowid AND no pendinguid`);
                }

                return { pending: true, pendinguid, response: tokenResponse, txpowid };
            }

            // Step 2: Only send the charm message via Maxima if token was sent successfully
            console.log(`✅[CHARM] Token sent successfully.Now sending charm message via Maxima...`);
            const msgResponse = await this.sendMessage(toPublicKey, senderName, charmId, "charm", "", amount, stateId || undefined, recipientName, "metachain", true, txpowid);

            console.log(`✅[CHARM] ========== CHARM SENT SUCCESSFULLY ==========`);
            return { pending: false, response: msgResponse, txpowid };

        } catch (err) {
            console.error(`❌[CHARM] ========== CHARM SEND FAILED ==========`);
            console.error(`❌[CHARM] Error details: `, err);
            throw err;
        }
    }

    async sendToken(tokenId: string, amount: string, address: string, tokenName: string, stateId?: number, myPublicKey?: string, recipientPublicKey?: string): Promise<any> {
        console.log(`💸[WALLET] Sending ${amount} ${tokenName} to ${address} `);

        // Fire Optimistic Blink START immediately to sync SideMenu with Chat Bubble
        window.dispatchEvent(new CustomEvent('minima_balance_update_start'));
        console.log(`⚡ [WALLET] Dispatched minima_balance_update_start event`);

        try {
            let cmd = `send amount:${amount} address:${address} tokenid:${tokenId}`;

            // Add state variables if provided
            if (stateId && myPublicKey && recipientPublicKey) {
                // Import generateChatId from transaction.service
                const { generateChatId } = await import('./transaction.service');
                const chatId = await (generateChatId as any)(myPublicKey, recipientPublicKey);

                const state = {
                    0: stateId.toString(),
                    1: "204",
                    2: chatId,  // Deterministic chat identifier for recovery
                    3: myPublicKey // Sender public key for identification
                };
                console.log(`🏷️[WALLET] Adding state variables: ID = ${stateId}, ChatID = ${chatId}, Sender = ${myPublicKey} `);

                // Properly format JSON for Minima command line
                // state:{"0":"...","1":"..."}
                cmd += ` state:${JSON.stringify(state)}`;
            }

            console.log(`💸[WALLET] Executing command: ${cmd}`);

            // Use string command via runCommand helper
            const response = await this.runCommand(cmd);

            console.log(`💸[WALLET] Raw response: `, JSON.stringify(response, null, 2));

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
                console.log(`🆔[WALLET] Transaction ID captured: ${txpowid} `);
            } else if (pendinguid) {
                console.log(`⏳[WALLET] Pending UID captured: ${pendinguid} `);
            } else {
                console.warn(`⚠️[WALLET] No txpowid or pendinguid found in response`);
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
                    console.error(`❌[WALLET] Send command failed!`);
                    console.error(`❌[WALLET] Error: `, response.error || response.message || 'Unknown error');
                    throw new Error(response.error || response.message || 'Token send failed');
                }
            }

            console.log(`✅[WALLET] ========== TOKEN SENT SUCCESSFULLY ==========`);

            // Return response with txpowid/pendinguid included
            return {
                ...response,
                txpowid,
                pendinguid
            };
        } catch (err) {
            console.error(`❌[WALLET] ========== TOKEN SEND FAILED ==========`);
            console.error(`❌[WALLET] Error details: `, err);
            console.error(`❌[WALLET] Error type: `, typeof err);
            if (err instanceof Error) {
                console.error(`❌[WALLET] Error message: `, err.message);
                console.error(`❌[WALLET] Error stack: `, err.stack);
            }
            throw err;
        }
    }

    async initProfile() {
        // Publish our Minima address to Maxima profile so others can send us tokens
        try {
            // OPTIMIZATION: Check if we already have a cached address in KeyPair
            // This prevents calling 'getaddress' on every startup, which creates a 0-value transaction
            // and shows the "Sending 0 Minima" banner.
            const cachedAddrRes = await MDS.keypair.get("profile_minima_address");
            if (cachedAddrRes && cachedAddrRes.status && cachedAddrRes.value) {
                console.log("📍 [PROFILE] Found cached Minima Address in KeyPair:", cachedAddrRes.value);
                // We already have an address, no need to generate a new transaction
                return;
            }

            // FIX: Use core 'getaddress' command, not maxima
            const getAddrRes = await this.runCommand('getaddress');

            if (getAddrRes.status) {
                const myAddress = getAddrRes.response.miniaddress || getAddrRes.response.address;
                console.log("📍 [PROFILE] My Minima Address:", myAddress);

                if (myAddress) {
                    // Update Maxima profile with this address
                    // Assuming 'minimaaddress' is a field we want to add to 'extra' or equivalent
                    // Maxima 'action:setname' sets name. 'action:seticon'. 
                    // To set extra data, we might need to set the profile specifically?
                    // Usually we set 'minimaaddress' in the EXTRA DATA json.
                    // But here we rely on profile.handler.js reading it from where?
                    // profile.handler.js reads 'minimaaddress' from the ROOT of the JSON?
                    // OR from 'extra_data'?

                    // Let's assume we need to update the profile via 'maxima action:setminimaaddress' if it existed? No.
                    // We likely need to pack it into the profile somehow.
                    // Maxima natively supports 'minimaaddress' field?
                    // Ref: https://docs.minima.global/api/maxima/
                    // 'maxcontacts action:myaddress' ?

                    // Actually, let's look at how we construct the payload in 'messaging.service.ts'.
                    // Profile handler reads: var minimaAddress = escapeSql(maxjson.minimaaddress || "");
                    // So we must ensure our profile broadcast INCLUDES this field.
                    // 'initProfile' here seems to try to SET it somewhere.

                    // If we can't set it in Maxima 'info', we must include it in BEACON payloads manually.
                    // Let's check where 'initProfile' is called.
                    // It's called on init.

                    // Maybe we just store it in DB 'MY_PROFILE' table if it exists?
                    // Or KeyPair?

                    // Let's KeyPair it so Beacon can read it!
                    await MDS.keypair.set("profile_minima_address", myAddress);
                    console.log("📍 [PROFILE] Saved Minima Address to KeyPair for Beacons");
                }
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
                    console.warn(`⚠️[MDS] Duplicate MAXIMA event ignored: ${event.data.msgid} `);
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

        // Handle CHAT_LIST_UPDATE from service worker
        if (event.event === "CHAT_LIST_UPDATE") {
            console.log("🔄 [MDS] CHAT_LIST_UPDATE event detected from service worker");
            // Notify chat list to refresh - pass empty object as we just need to trigger refresh
            chatService.notifyNewMessage({});
        }
    }

    /**
     * SMART SYNC: Send status check to a peer (Phase 1)
     * Queries local DB for the last sequence number received from them,
     * then sends 'sync_status_check' to them.
     */
    /**
     * SMART SYNC: Send status check to a peer (Phase 1)
     * Queries local DB for the last sequence number received from them,
     * then sends 'sync_status_check' to them.
     */
    async sendSyncStatusCheck(publickey: string) {
        // Query max sender_seq from this peer
        const sql = `SELECT MAX(sender_seq) as last_seq FROM CHAT_MESSAGES WHERE publickey='${publickey}'`;

        try {
            const res = await this.runSQL(sql);
            const lastSeq = (res.rows && res.rows.length > 0) ? (res.rows[0].LAST_SEQ || 0) : 0;

            const payload = {
                type: "sync_status_check",
                last_received_seq: lastSeq,
                timestamp: Date.now()
            };

            console.log(`🔄 [SMART-SYNC] Sending status check to ${publickey.substring(0, 10)} (Last Seq: ${lastSeq})`);

            const dataHex = this.utf8ToHex(JSON.stringify(payload));

            // Helper to try sending
            const trySend = async (addressOrKey: string, isAddress: boolean) => {
                // Convert params to string for runCommand
                // maxcontacts action:add publickey:0x... OR maxcontacts action:add contact:Mx...
                // Wait, this is 'maxima action:send ...'

                let cmd = `maxima action:send application:metachain poll:true data:0x${dataHex}`;

                if (isAddress) {
                    cmd += ` to:${addressOrKey}`;
                } else {
                    cmd += ` publickey:${addressOrKey}`;
                }

                return this.runCommand(cmd);
            };

            // Attempt 1: Send via Public Key (Standard for Contacts)
            trySend(publickey, false).then(async (resp: any) => {
                if (resp.status) {
                    console.log("✅ [SMART-SYNC] Check sent (via Public Key).");
                } else {
                    // ERROR HANDLING: "No Contact found" usually means we need to use their Address
                    if (resp.error && (resp.error.includes("No Contact found") || resp.error.includes("not in contacts"))) {
                        console.log("⚠️ [SMART-SYNC] Not a contact. Attempting to resolve address from DISCOVERED_PEERS...");

                        // Attempt 2: Resolve Address locally
                        const peerSql = `SELECT address FROM DISCOVERED_PEERS WHERE publickey='${publickey}' LIMIT 1`;
                        const peerRes = await this.runSQL(peerSql);

                        if (peerRes.rows && peerRes.rows.length > 0 && peerRes.rows[0].ADDRESS) {
                            const address = peerRes.rows[0].ADDRESS;
                            console.log(`🔄 [SMART-SYNC] Found address: ${address}. Retrying send...`);

                            const retryResp = await trySend(address, true);
                            if (retryResp.status) {
                                console.log("✅ [SMART-SYNC] Check sent (via Resolved Address).");
                            } else {
                                console.warn("⚠️ [SMART-SYNC] Failed to send to address:", retryResp.error);
                            }
                        } else {
                            console.warn("⚠️ [SMART-SYNC] Peer address not found in DB. Cannot send non-contact message.");
                        }
                    } else {
                        console.warn("⚠️ [SMART-SYNC] Failed to send check:", resp.error);
                    }
                }
            });

        } catch (err) {
            console.error("❌ [SMART-SYNC] Error preparing check:", err);
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

            console.log(`🔔[MDS_PENDING] Transaction ${uid} - Accept: ${accept} `);

            // Find the transaction by pendinguid
            const sql = `SELECT * FROM TRANSACTIONS WHERE pendinguid = '${uid}' LIMIT 1`;
            const txResult = await this.runSQL(sql);

            if (!txResult.rows || txResult.rows.length === 0) {
                console.log(`⚠️[MDS_PENDING] No transaction found for uid: ${uid} `);
                return;
            }

            const transaction = txResult.rows[0];
            const { PUBLICKEY, MESSAGE_TIMESTAMP, TYPE, METADATA } = transaction;

            if (accept) {
                // Transaction was ACCEPTED by user
                // BUT we must check if execution was successful (e.g. sufficient funds)
                if (result && result.status === false) {
                    console.log(`❌[MDS_PENDING] Transaction ACCEPTED but FAILED execution: ${uid} `);
                    console.log(`❌[MDS_PENDING] Error: ${result.error} `);

                    // Update transaction status to rejected
                    await this.updateTransactionStatusByPendingUid(uid, 'rejected');

                    // Update message state to failed
                    await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'failed');

                    // Notify UI to reload messages (transaction failed, remove from chat)
                    this.notifyBalanceUpdate();
                    window.dispatchEvent(new CustomEvent('minima_balance_update'));

                    return;
                }

                console.log(`✅[MDS_PENDING] Transaction ACCEPTED and EXECUTED: ${uid} `);

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
                    console.log(`🆔[MDS_PENDING] Updated txpowid: ${txpowid} `);
                }

                // Update transaction status to 'sent' (not confirmed yet - needs 3 blocks)
                await this.updateTransactionStatusByPendingUid(uid, 'sent');

                // Extract blockchain timestamp from the transaction response
                const blockchainTimestamp = result.response?.header?.timemilli;
                const confirmationTime = blockchainTimestamp ? Number(blockchainTimestamp) : Date.now();
                console.log(`🕐[MDS_PENDING] Transaction confirmed at blockchain time: ${confirmationTime} (from header: ${!!blockchainTimestamp})`);

                // Generate sequence number for the message to ensure correct ordering
                // ATOMIC: Get and increment in one operation to prevent race conditions
                const seq = await getAndIncrementSequenceNumber(PUBLICKEY);

                // CRITICAL: Update message state to 'sent' but KEEP the original timestamp
                // We need to keep MESSAGE_TIMESTAMP unchanged so we can still find the transaction by message_timestamp
                // Also update txpowid so history sync can deduplicate correctly
                // AND update sender_seq so sorting works correctly (avoids pinned-to-bottom issue)
                await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'sent', undefined, txpowid || undefined, seq);

                // Send Maxima message
                const metadata = JSON.parse(METADATA || '{}');

                if (TYPE === 'charm') {
                    const { charmId, username, amount } = metadata;
                    console.log(`📤[MDS_PENDING] Sending charm message via Maxima...`);
                    await this.sendMessage(
                        PUBLICKEY,
                        username || 'Unknown',
                        charmId,
                        'charm',
                        '',
                        amount || 0,
                        MESSAGE_TIMESTAMP,  // Use original timestamp
                        undefined,         // recipientName
                        "metachain",       // targetApplication
                        false,             // saveToDb
                        txpowid || undefined, // txpowid for receiver confirmation
                        seq                // Pass generated sequence number
                    );
                } else if (TYPE === 'token') {
                    const { tokenName, username, amount } = metadata;
                    const tokenData = JSON.stringify({ amount, tokenName });
                    console.log(`📤[MDS_PENDING] Sending token message via Maxima (Seq: ${seq})...`);
                    await this.sendMessage(
                        PUBLICKEY,
                        username || 'Unknown',
                        tokenData,
                        'token',
                        '',
                        0,
                        MESSAGE_TIMESTAMP,  // Use original timestamp
                        undefined,         // recipientName
                        "metachain",       // targetApplication
                        false,             // saveToDb
                        txpowid || undefined, // txpowid for receiver confirmation
                        seq // Use generated sequence number
                    );
                }

                console.log(`✅[MDS_PENDING] Transaction ${uid} processed successfully`);

                // Notify UI to reload messages
                // This ensures the message goes from 'pending' to 'sent' immediately in the UI
                this.notifyBalanceUpdate();
                window.dispatchEvent(new CustomEvent('minima_balance_update'));
            } else {
                // Transaction was DENIED
                console.log(`❌[MDS_PENDING] Transaction DENIED: ${uid} `);

                // Update transaction status to rejected
                await this.updateTransactionStatusByPendingUid(uid, 'rejected');

                // Update message state to failed
                await this.updateMessageState(PUBLICKEY, MESSAGE_TIMESTAMP, 'failed');

                console.log(`✅[MDS_PENDING] Transaction ${uid} marked as failed`);

                // Notify UI to reload messages (even though balance didn't change)
                // This ensures the pending message disappears immediately
                this.notifyBalanceUpdate();
                window.dispatchEvent(new CustomEvent('minima_balance_update'));
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
    async sendChatRequest(toAddress: string, myName: string, myAvatar: string, toPublicKey?: string): Promise<void> {
        return contactRequestsService.sendChatRequest(toAddress, myName, myAvatar, toPublicKey);
    }

    /**
     * Get chat permission setting
     */
    async getChatPermission(): Promise<boolean> {
        return contactRequestsService.getChatPermission();
    }

    /**
     * Get a contact's chat permission setting from DISCOVERED_PEERS
     * This checks if THEY allow receiving chats from non-contacts
     */
    async getContactChatPermission(contactPublicKey: string): Promise<boolean> {
        return contactRequestsService.getContactChatPermission(contactPublicKey);
    }

    /**
     * Save incoming contact request to database
     */
    async saveChatRequest(fromPublicKey: string, fromName: string, fromAvatar: string, _toPublicKey: string, fromAddress?: string): Promise<void> {
        return contactRequestsService.saveChatRequest(fromPublicKey, fromName, fromAvatar, _toPublicKey, fromAddress);
    }

    /**
     * Check if there's a pending contact request from me to this user
     * Searches by BOTH hex publickey AND Maxima address to handle both formats
     */
    async checkPendingChatRequest(publickey: string): Promise<boolean> {
        return contactRequestsService.checkPendingChatRequest(publickey);
    }

    /**
     * Check if there's an incoming pending contact request FROM this user TO me
     */
    async checkIncomingChatRequest(fromPublickey: string): Promise<boolean> {
        return contactRequestsService.checkIncomingChatRequest(fromPublickey);
    }

    /**
     * Get pending contact requests for current user
     */
    async getChatRequests(myPublicKey: string): Promise<any[]> {
        return contactRequestsService.getChatRequests(myPublicKey);
    }

    /**
     * Accept a contact request
     */
    async acceptChatRequest(fromPublicKey: string, fromAddress: string, options?: { skipMessageInsert?: boolean }): Promise<void> {
        return contactRequestsService.acceptChatRequest(fromPublicKey, fromAddress, options);
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
    /**
     * Decline a contact request
     */
    async declineChatRequest(fromPublicKey: string, options?: { skipMessageInsert?: boolean }): Promise<void> {
        return contactRequestsService.declineChatRequest(fromPublicKey, options);
    }

    /**
     * Cancel own outgoing contact request (sender-initiated)
     */
    async cancelChatRequest(toPublicKey: string): Promise<void> {
        return contactRequestsService.cancelChatRequest(toPublicKey);
    }

    /**
     * Get the last seen timestamp for a peer from DISCOVERED_PEERS
     */
    async getPeerLastSeen(publickey: string): Promise<number | null> {
        // Safe escape
        const safeKey = publickey.replace(/'/g, "''");
        const sql = `SELECT last_seen FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${safeKey}')`;

        try {
            const res = await this.runSQL(sql);
            if (res.rows && res.rows.length > 0) {
                // H2 returns uppercase keys usually
                const lastSeen = res.rows[0].LAST_SEEN || res.rows[0].last_seen;
                return lastSeen ? parseInt(lastSeen) : null;
            }
        } catch (err) {
            console.error("❌ [DB] Error fetching last_seen:", err);
        }
        return null;
    }

    /* ----------------------------------------------------------------------------
      MAXIMA CONTACT REQUESTS
    ---------------------------------------------------------------------------- */

    async sendMaximaContactRequest(toAddress: string, toPublicKey?: string): Promise<void> {
        return contactRequestsService.sendMaximaContactRequest(toAddress, toPublicKey);
    }

    async acceptMaximaContactRequest(fromPublicKey: string, fromAddress: string, options?: { skipMessageInsert?: boolean }): Promise<void> {
        return contactRequestsService.acceptMaximaContactRequest(fromPublicKey, fromAddress, options);
    }

    async declineMaximaContactRequest(fromPublicKey: string, _fromAddress: string, options?: { skipMessageInsert?: boolean }): Promise<void> {
        return contactRequestsService.declineMaximaContactRequest(fromPublicKey, _fromAddress, options);
    }

    /**
     * Cancel own outgoing Maxima contact request (sender-initiated)
     */
    async cancelMaximaContactRequest(toPublicKey: string): Promise<void> {
        return contactRequestsService.cancelMaximaContactRequest(toPublicKey);
    }

    async getMaximaContactRequests(myPublicKey: string): Promise<any[]> {
        return contactRequestsService.getMaximaContactRequests(myPublicKey);
    }

    async saveMaximaContactRequest(fromPublicKey: string, fromName: string): Promise<void> {
        return contactRequestsService.saveMaximaContactRequest(fromPublicKey, fromName);
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

    /**
     * Migration: Fix duplicate chats by converting Maxima Address (Mx...) keys to Hex Public Keys (0x...)
     * using the DISCOVERED_PEERS table.
     */
    async migrateLegacyChats(): Promise<void> {
        console.log("🧹 [MIGRATION] Checking for legacy chat keys (Mx addresses)...");

        // Find distinct chat keys that look like Maxima Addresses
        const sql = "SELECT DISTINCT publickey FROM CHAT_MESSAGES WHERE publickey LIKE 'Mx%'";
        const res = await this.runSQL(sql);

        if (!res.rows || res.rows.length === 0) {
            console.log("✅ [MIGRATION] No legacy chat keys found.");
            return;
        }

        console.log(`🧹 [MIGRATION] Found ${res.rows.length} legacy chat keys. Attempting to resolve...`);

        for (const row of res.rows) {
            const mxAddress = row.PUBLICKEY;
            let resolvedPubkey = null;

            // 1. Exact Match Check
            const exactSql = `SELECT publickey FROM DISCOVERED_PEERS WHERE address = '${mxAddress}' LIMIT 1`;
            const exactRes = await this.runSQL(exactSql);

            if (exactRes.rows && exactRes.rows.length > 0) {
                resolvedPubkey = exactRes.rows[0].PUBLICKEY;
                console.log(`🔄 [MIGRATION] Exact match found! Resolving ${mxAddress} -> ${resolvedPubkey}`);
            } else {
                // 2. Fuzzy/Prefix Match Check
                // Maxima addresses generally start with "Mx" + Base58IdentityKey + Location.
                // The IDENTITY part should be stable. The location part (IP/Port) changes.
                // We'll extract the first 45 chars as a "safe" prefix to match against.
                // Example Start: MxG18HGG6FJ038614Y8CW46US6G20810K0070CD00Z83282G60... (50+ chars)

                if (mxAddress.length > 50) {
                    const prefix = mxAddress.substring(0, 45); // Take a robust chunk
                    console.log(`🔍 [MIGRATION] Exact match failed. Trying prefix match: ${prefix}...`);

                    const fuzzySql = `SELECT publickey FROM DISCOVERED_PEERS WHERE address LIKE '${prefix}%' LIMIT 1`;
                    const fuzzyRes = await this.runSQL(fuzzySql);

                    if (fuzzyRes.rows && fuzzyRes.rows.length > 0) {
                        resolvedPubkey = fuzzyRes.rows[0].PUBLICKEY;
                        console.log(`✅ [MIGRATION] Fuzzy match found! Resolving ${mxAddress} -> ${resolvedPubkey}`);
                    }
                }
            }

            if (resolvedPubkey) {
                await this.performChatMigration(mxAddress, resolvedPubkey);
            } else {
                console.warn(`⚠️ [MIGRATION] Could not resolve ${mxAddress} to a public key (peer not found).`);
            }
        }
    }

    private async performChatMigration(oldKey: string, newKey: string): Promise<void> {
        console.log(`🔄 [MIGRATION] Migrating messages from ${oldKey} to ${newKey}...`);

        // Update Messages
        const msgSql = `UPDATE CHAT_MESSAGES SET publickey = '${newKey}' WHERE publickey = '${oldKey}'`;
        await this.runSQL(msgSql);

        // Update Status (Archived, Muted, etc) - Handle Conflicts
        // If status exists for newKey, we might overwrite or merge. Simplest is DELETE old if NEW exists, else UPDATE.
        const checkSql = `SELECT * FROM CHAT_STATUS WHERE publickey = '${newKey}'`;
        const checkRes = await this.runSQL(checkSql);

        if (checkRes.rows && checkRes.rows.length > 0) {
            // New key already has status, just delete the old status to avoid constraint error
            console.log(`ℹ️ [MIGRATION] Status for ${newKey} already exists. Deleting status for ${oldKey}.`);
            await this.runSQL(`DELETE FROM CHAT_STATUS WHERE publickey = '${oldKey}'`);
        } else {
            console.log(`ℹ️ [MIGRATION] Moving status from ${oldKey} to ${newKey}.`);
            await this.runSQL(`UPDATE CHAT_STATUS SET publickey = '${newKey}' WHERE publickey = '${oldKey}'`);
        }

        console.log(`✅ [MIGRATION] Migrated chat from ${oldKey} to ${newKey}`);
    }

    /**
     * Start the transaction confirmation checker
     * Checks all 'sent' transactions periodically for 3-block confirmations
     */
    startConfirmationChecker(): void {
        return transactionService.startConfirmationChecker();
    }
}

export const minimaService = new MinimaService();
