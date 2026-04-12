/**
 * Messaging Service - Sending and receiving Maxima messages
 * Handles: sendMessage, receipts, pings, pongs, invitations, chat history
 */

import { MDS } from "@minima-global/mds";
import {
  runSQL,
  utf8ToHex,
  getAndIncrementSequenceNumber,
} from "./database.service";
import { chatService, ChatMessage } from "./chat.service";
import { offlineQueueService } from "./offline-queue.service";

const VERBOSE_NETWORK_LOGS = false;
const networkLog = (...args: any[]) => {
  if (VERBOSE_NETWORK_LOGS) console.log(...args);
};

/* ----------------------------------------------------------------------------
   SESSION CACHE: Contact Status
---------------------------------------------------------------------------- */
const CONTACT_STATUS_CACHE: Record<string, boolean> = {};

/* ----------------------------------------------------------------------------
   SESSION CACHE: My Profile Info (Avatar, Maxima Address)
---------------------------------------------------------------------------- */
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let _cachedMyAvatar: string = "";
let _cachedMyAddress: string = "";
let _cacheTimestamp = 0;

async function getMySessionInfo(): Promise<{ avatar: string; address: string }> {
  const now = Date.now();
  if (_cacheTimestamp > 0 && now - _cacheTimestamp < SESSION_CACHE_TTL_MS) {
    return { avatar: _cachedMyAvatar, address: _cachedMyAddress };
  }
  try {
    const avatarRes = await MDS.keypair.get("profile_avatar");
    if (avatarRes && avatarRes.status && avatarRes.value)
      _cachedMyAvatar = avatarRes.value;
    const myInfo = await MDS.cmd.maxima({ params: { action: "info" } });
    _cachedMyAddress = (myInfo.response as any).contact || "";
  } catch (e) {
    console.warn("⚠️ [CACHE] Failed to refresh session info:", e);
  }
  _cacheTimestamp = Date.now();
  return { avatar: _cachedMyAvatar, address: _cachedMyAddress };
}

/**
 * Invalidate the session info cache (call when user updates profile)
 */
export function invalidateMessagingCache() {
  _cacheTimestamp = 0;
}

/**
 * Resolve Hex Public Key from any Maxima address
 */
export async function resolveHexFromAddress(
  mxAddress: string,
): Promise<string | null> {
  const safeMx = mxAddress.replace(/'/g, "''");
  const sql = `SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE UPPER(ADDRESS) LIKE UPPER('%${safeMx}%') LIMIT 1`;
  try {
    const res = await runSQL(sql);
    if (res.rows && res.rows.length > 0) {
      return res.rows[0].PUBLICKEY;
    }
    // Fallback to Contacts
    const contacts = await MDS.cmd.maxcontacts({ params: { action: "list" } });
    const contactList = (contacts.response as unknown as any[]) || [];
    const contact = contactList.find(
      (c: any) => c.currentaddress === mxAddress || c.address === mxAddress,
    );
    return contact?.publickey || null;
  } catch (e) {
    return null;
  }
}

/**
 * Clear a peer's contact status from the cache (e.g. when a request is accepted)
 */
export function clearContactStatusCache(publicKey: string) {
  if (publicKey) {
    delete CONTACT_STATUS_CACHE[publicKey.toLowerCase()];
    networkLog(`🧹 [CACHE] Cleared contact status for ${publicKey}`);
  }
}

/**
 * Check if a public key is a known contact (uses cache + DB)
 */
async function isTargetInContacts(publicKey: string): Promise<boolean> {
  if (!publicKey.startsWith("0x")) return false;
  const pk = publicKey.toLowerCase();

  // 1. Check Cache
  if (CONTACT_STATUS_CACHE[pk] !== undefined) {
    return CONTACT_STATUS_CACHE[pk];
  }

  // 2. Check Database (MAXIMA_CONTACT_REQUESTS or CONTACT_REQUESTS)
  try {
    const safePk = publicKey.replace(/'/g, "''");
    // Check if there's an accepted contact request in either direction
    const sql = `
      SELECT COUNT(*) as cnt FROM (
        SELECT 1 FROM MAXIMA_CONTACT_REQUESTS WHERE (UPPER(from_publickey)=UPPER('${safePk}') OR UPPER(to_publickey)=UPPER('${safePk}')) AND status='accepted'
        UNION ALL
        SELECT 1 FROM CONTACT_REQUESTS WHERE (UPPER(from_publickey)=UPPER('${safePk}') OR UPPER(to_publickey)=UPPER('${safePk}')) AND status='accepted'
      )
    `;
    const res = await runSQL(sql);
    const isContact =
      res &&
      res.rows &&
      res.rows.length > 0 &&
      (res.rows[0].CNT || res.rows[0].cnt || 0) > 0;

    // Update Cache
    CONTACT_STATUS_CACHE[pk] = isContact;
    return isContact;
  } catch (e) {
    console.warn("⚠️ [MAXIMA] Failed to check contact status in DB:", e);
    return false;
  }
}

/* ----------------------------------------------------------------------------
   HELPER: Address Cleaner (Ported from Service Worker)
---------------------------------------------------------------------------- */
function cleanMaximaAddress(addr: string): string {
  if (!addr) return "";
  let s = String(addr).trim();
  // CRITICAL: Remove ALL whitespace first to prevent Java NumberFormatException
  s = s.replace(/\s+/g, "");
  const idx = s.lastIndexOf(":");
  if (idx !== -1) {
    const base = s.substring(0, idx);
    const port = s.substring(idx + 1);
    const cleanBase = base.replace(/[^a-zA-Z0-9@._-]/g, "");
    const cleanPort = port.replace(/[^0-9]/g, "");
    if (cleanBase && cleanPort) {
      return cleanBase + ":" + cleanPort;
    }
  }
  return s.replace(/\s/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "");
}

/* ----------------------------------------------------------------------------
   HELPER: UUID Generator
---------------------------------------------------------------------------- */
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ----------------------------------------------------------------------------
   HELPER: Resolve Address from Discovery
---------------------------------------------------------------------------- */

async function resolveMaximaAddressFromPubkey(
  publicKey: string,
): Promise<string | null> {
  if (!publicKey.startsWith("0x")) return null;

  const safeKey = publicKey.replace(/'/g, "''");
  const peerSql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE UPPER(PUBLICKEY)=UPPER('${safeKey}') AND ADDRESS IS NOT NULL LIMIT 1`;

  try {
    const peerRes = await runSQL(peerSql);
    if (peerRes && peerRes.rows && peerRes.rows.length > 0) {
      const mxAddress = peerRes.rows[0].ADDRESS;
      if (mxAddress && mxAddress.startsWith("Mx")) {
        return mxAddress;
      }
    }
  } catch (e) {
    console.error("Error resolving address:", e);
  }
  return null;
}

/* ----------------------------------------------------------------------------
   SEND MESSAGE
---------------------------------------------------------------------------- */

export async function sendMessage(
  toPublicKey: string,
  senderName: string,
  message: string,
  type: string = "text",
  filedata: string = "",
  amount: number = 0,
  messageTimestamp: number = Date.now(),
  recipientName?: string,
  targetApplication: string = "metachain",
  saveToDb: boolean = true,
  txpowid?: string,
  overrideSeq?: number,
  forwarded: boolean = false,
  replyTo?: { customid: string; text: string; senderName: string; type: string } | null,
): Promise<any> {
  try {
    const cleanMessage = message.trim();
    const customid = generateUUID();
    const sendAgeMs = Math.max(0, Date.now() - messageTimestamp);

    // 1. RESOLVE IDENTIFIER
    let databasePublicKey = toPublicKey;
    const safeMxAddress = toPublicKey.replace(/'/g, "''");

    if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
      try {
        const discoverySql = `SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE UPPER(ADDRESS) LIKE UPPER('%${safeMxAddress}%') LIMIT 1`;
        const discoveryRes = await runSQL(discoverySql);

        if (discoveryRes.rows && discoveryRes.rows.length > 0) {
          databasePublicKey = discoveryRes.rows[0].PUBLICKEY;
          console.log(
            `🔍 [MAXIMA] Resolved Mx address to Hex PublicKey: ${databasePublicKey}`,
          );
        } else {
          const contacts = await MDS.cmd.maxcontacts({
            params: { action: "list" },
          });
          const contactList = (contacts.response as unknown as any[]) || [];
          const contact = contactList.find(
            (c: any) => c.currentaddress === toPublicKey,
          );
          if (contact && contact.publickey) {
            databasePublicKey = contact.publickey;
            console.log(
              `🔍 [MAXIMA] Resolved Mx address from Contacts to Hex PublicKey: ${databasePublicKey}`,
            );
          }
        }

        // LAZY MIGRATION
        if (databasePublicKey !== toPublicKey) {
          const migrateChatSql = `UPDATE CHAT_MESSAGES SET publickey=UPPER('${databasePublicKey}') WHERE UPPER(publickey)=UPPER('${safeMxAddress}')`;
          await runSQL(migrateChatSql);
          const migrateReqSql = `UPDATE CONTACT_REQUESTS SET to_publickey=UPPER('${databasePublicKey}') WHERE UPPER(to_publickey)=UPPER('${safeMxAddress}')`;
          await runSQL(migrateReqSql);
        }
      } catch (err) {
        console.warn(
          "⚠️ [MAXIMA] Failed to resolve Hex PublicKey, using address as-is:",
          err,
        );
      }
    }

    // 2. PREPARE PAYLOAD
    const { avatar: myAvatar, address: myAddress } = await getMySessionInfo();

    let seq = 0;
    if (overrideSeq !== undefined) {
      seq = overrideSeq;
    } else {
      // ATOMIC: Get and increment in one operation to prevent race conditions
      seq = await getAndIncrementSequenceNumber(databasePublicKey);
    }

    // 3. OPTIMISTIC SAVE (PENDING)
    if (saveToDb) {
      const msgData: ChatMessage = {
        roomname: recipientName || senderName,
        publickey: databasePublicKey,
        username: "Me",
        type,
        message: cleanMessage,
        filedata,
        state: "pending",
        amount,
        date: messageTimestamp,
        customid: customid,
        sender_seq: seq,
        originalTimestamp: messageTimestamp,
        forwarded: forwarded,
        reply_to_customid: replyTo?.customid ?? null,
        reply_to_text: replyTo?.text ?? null,
        reply_to_sender: replyTo?.senderName ?? null,
        reply_to_type: replyTo?.type ?? null,
      };

      await chatService.insertMessage(msgData);

      // NOTE: No need to increment here - getAndIncrementSequenceNumber already did it atomically
      // This prevents race conditions when sending multiple messages quickly
    }

    // 4. NETWORK SEND
    const payload: any = {
      message,
      type,
      username: senderName,
      filedata,
      timestamp: messageTimestamp,
      avatar: myAvatar,
      from_address: myAddress,
      txpowid: txpowid || undefined,
      customid: customid,
      seq: saveToDb || overrideSeq !== undefined ? seq : undefined,
      forwarded: forwarded,
      replyTo: replyTo ?? undefined,
    };

    if (type === "charm" && amount > 0) payload.amount = amount;

    const jsonStr = JSON.stringify(payload);
    const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    const sendParams: any = {
      action: "send",
      application: targetApplication,
      data: hexData,
      poll: false, // CORRECT: poll:true ensures message delivery for offline/non-contact recipients
    };

    if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
      sendParams.to = cleanMaximaAddress(toPublicKey);
    } else {
      sendParams.publickey = toPublicKey;
    }

    console.log(
      `📤 [MAXIMA] Sending type=${type} customid=${customid} to=${toPublicKey} age_ms=${sendAgeMs}`,
    );

    try {
      // STRATEGY: Deciding whether to try PK or Address first
      let primarySendParams = { ...sendParams };
      let fallbackSendParams: any = null;

      const isContact = await isTargetInContacts(toPublicKey);
      const discoveryAddress = await resolveMaximaAddressFromPubkey(toPublicKey);

      if (!isContact && discoveryAddress) {
        console.log(
          `🚀 [MAXIMA] Target ${toPublicKey.substring(0, 10)}... recognized as NON-CONTACT. Prioritizing address-based send.`,
        );
        primarySendParams.to = cleanMaximaAddress(discoveryAddress);
        delete primarySendParams.publickey;

        // Still keep PK as fallback just in case
        fallbackSendParams = { ...sendParams };
      }

      // Execute primary attempt
      const response = await MDS.cmd.maxima({ params: primarySendParams });

      if (!(response as any).status) {
        const error = (response as any).error || "";
        // If we didn't already try the fallback and this failed with "No Contact found", try fallback now
        if (
          !isContact &&
          discoveryAddress &&
          error.includes("No Contact found") &&
          fallbackSendParams
        ) {
          // This shouldn't happen if we correctly prioritized address, but added for robustness
          // Actually, if we prioritized address, the error wouldn't be "No Contact found" (that's only for PK sends).
        }
        throw new Error(error || "MDS command failed");
      }
      // Reference implementation only checks status, not delivered

      console.log(`✅ [MAXIMA] Sent successfully. customid=${customid}`);

      // 5. UPDATE TO SENT
      if (saveToDb) {
        await chatService.updateMessageState(
          databasePublicKey,
          messageTimestamp,
          "sent",
          txpowid,
        );
      }

      return response;
    } catch (networkErr: any) {
      const errorMessage = networkErr.message || "";

      // FALLBACK: If "No Contact found", try resolving address from Discovery and retry
      if (errorMessage.includes("No Contact found")) {
        console.log(
          "⚠️ [MAXIMA] Target not in contacts. Attempting to resolve address from Discovery...",
        );

        const safeKey = toPublicKey.replace(/'/g, "''");
        // Inline resolve query or call helper if available. runSQL is imported.
        const peerSql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE UPPER(PUBLICKEY)=UPPER('${safeKey}') LIMIT 1`;
        try {
          const peerRes = await runSQL(peerSql);

          if (peerRes.rows && peerRes.rows.length > 0) {
            const mxAddress = peerRes.rows[0].ADDRESS;
            console.log(
              `🔍 [MAXIMA] Found Mx address for non-contact: ${mxAddress}. Updating cache and retrying...`,
            );

            // Important: also mark as non-contact in cache for future sends
            CONTACT_STATUS_CACHE[toPublicKey.toLowerCase()] = false;

            // Retry using the specific Mx address
            const retryResponse = await MDS.cmd.maxima({
              params: {
                action: "send",
                to: cleanMaximaAddress(mxAddress),
                application: targetApplication,
                data: hexData,
                poll: false,
              } as any,
            });

            if (!(retryResponse as any).status) {
              throw new Error(
                (retryResponse as any).error || "Fallback retry failed",
              );
            }
            // Reference implementation only checks status, not delivered

            console.log(
              `✅ [MAXIMA] Message sent successfully via Mx address (fallback). customid=${customid}`,
            );

            if (saveToDb) {
              await chatService.updateMessageState(
                databasePublicKey,
                messageTimestamp,
                "sent",
                txpowid,
              );
            }
            return retryResponse;
          }
        } catch (fallbackErr: any) {
          console.warn(
            `⚠️ [MAXIMA] Fallback retry failed: ${fallbackErr.message}`,
          );
          // Continue to queueing logic below
        }
      }

      console.warn(
        `⚠️ [MAXIMA] Send failed: ${errorMessage}. Queueing customid=${customid}`,
      );

      // 6. QUEUE ON FAILURE
      if (saveToDb) {
        await offlineQueueService.queueChatMessage({
          publickey: toPublicKey,
          senderName,
          message: cleanMessage,
          type,
          filedata,
          amount,
          timestamp: messageTimestamp,
          recipientName: recipientName || "",
          targetApplication,
          txpowid,
          overrideSeq: seq,
          customid,
        });

        return {
          status: true,
          pending: true,
          message: "Queued for offline delivery",
        };
      } else {
        throw networkErr;
      }
    }
  } catch (err) {
    console.error("❌ [SEND] Critical failure:", err);
    return { status: false, error: err };
  }
}

/**
 * Retry sending a message (called by OfflineQueueService)
 */
export async function retryMessage(data: {
  publickey: string;
  senderName: string;
  message: string;
  type: string;
  filedata: string;
  amount: number;
  timestamp: number;
  recipientName: string;
  targetApplication: string;
  txpowid?: string;
  overrideSeq?: number;
  customid?: string;
}): Promise<void> {
  const retryCustomId = data.customid || generateUUID();
  const retryAgeMs = data.timestamp
    ? Math.max(0, Date.now() - data.timestamp)
    : -1;
  console.log(
    `🔄 [RETRY] Resending customid=${retryCustomId} to ${data.publickey} age_ms=${retryAgeMs}...`,
  );

  let target = data.publickey;
  if (data.publickey.startsWith("0x")) {
    const resolved = await resolveMaximaAddressFromPubkey(data.publickey);
    if (resolved) {
      target = resolved;
      console.log(`🔍 [RETRY] Resolved address: ${resolved}`);
    } else {
      console.log(
        `⚠️ [RETRY] No address found in DISCOVERED_PEERS for ${data.publickey.substring(0, 20)}...`,
      );
    }
  } else if (data.publickey.startsWith("Mx")) {
    target = cleanMaximaAddress(data.publickey);
  }

  console.log(
    `📤 [RETRY] Target for send: ${target.substring(0, 30)}... (type: ${target.startsWith("Mx") ? "address" : "publickey"})`,
  );

  const { avatar: myAvatar, address: myAddress } = await getMySessionInfo();

  const payload: any = {
    message: data.message,
    type: data.type,
    username: data.senderName,
    filedata: data.filedata,
    timestamp: data.timestamp,
    avatar: myAvatar,
    from_address: myAddress,
    txpowid: data.txpowid,
    customid: retryCustomId,
    seq: data.overrideSeq,
  };

  if (data.type === "charm" && data.amount > 0) payload.amount = data.amount;

  const jsonStr = JSON.stringify(payload);
  const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

  const sendParams: any = {
    action: "send",
    application: data.targetApplication,
    data: hexData,
    poll: false,
  };

  if (target.startsWith("Mx") || target.startsWith("MX")) {
    sendParams.to = target;
  } else {
    sendParams.publickey = target;
  }

  try {
    const response = await MDS.cmd.maxima({ params: sendParams });

    console.log(
      "🔍 [RETRY] Response:",
      JSON.stringify(response).substring(0, 200),
    );

    if (!(response as any).status) {
      const errMsg = (response as any).error || "MDS command failed";
      console.warn(`⚠️ [RETRY] MDS status false: ${errMsg}`);
      throw new Error(errMsg);
    }
    // Reference implementation only checks status, not delivered

    // Success - update DB
    let dbKey = data.publickey;
    if (dbKey.startsWith("Mx")) {
      const safeMx = dbKey.replace(/'/g, "''");
      const r = await runSQL(
        `SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE UPPER(ADDRESS) LIKE UPPER('%${safeMx}%') LIMIT 1`,
      );
      if (r.rows?.[0]?.PUBLICKEY) dbKey = r.rows[0].PUBLICKEY;
    }

    await chatService.updateMessageState(
      dbKey,
      data.timestamp,
      "sent",
      data.txpowid,
    );
    console.log(`✅ [RETRY] Success. customid=${retryCustomId}`);
  } catch (retryErr: any) {
    const errorMessage = retryErr.message || "";

    // FALLBACK: If "No Contact found", try resolving address from Discovery and retry
    if (
      errorMessage.includes("No Contact found") &&
      data.publickey.startsWith("0x")
    ) {
      console.log(
        "⚠️ [RETRY] Target not in contacts. Attempting to resolve address from Discovery...",
      );

      const safeKey = data.publickey.replace(/'/g, "''");
      const peerSql = `SELECT ADDRESS FROM DISCOVERED_PEERS WHERE UPPER(PUBLICKEY)=UPPER('${safeKey}') LIMIT 1`;

      const peerRes = await runSQL(peerSql);

      if (peerRes.rows && peerRes.rows.length > 0) {
        const mxAddress = peerRes.rows[0].ADDRESS;
        console.log(
          `🔍 [RETRY] Found Mx address for non-contact: ${mxAddress}`,
        );

        // Retry using the specific Mx address
        const fallbackResponse = await MDS.cmd.maxima({
          params: {
            action: "send",
            to: cleanMaximaAddress(mxAddress),
            application: data.targetApplication,
            data: hexData,
            poll: false,
          } as any,
        });

        if (
          !(fallbackResponse as any).status ||
          !(fallbackResponse as any).response.delivered
        ) {
          throw new Error(
            (fallbackResponse as any).error ||
              (fallbackResponse as any).response?.error ||
              "Fallback retry failed",
          );
        }

        console.log(
          `✅ [RETRY] Message sent successfully via Mx address (fallback). customid=${retryCustomId}`,
        );

        // Update DB
        await chatService.updateMessageState(
          data.publickey,
          data.timestamp,
          "sent",
          data.txpowid,
        );
        return;
      }
    }

    // If fallback didn't work or wasn't applicable, re-throw
    throw retryErr;
  }
}

/* ----------------------------------------------------------------------------
   RECEIPTS
---------------------------------------------------------------------------- */

export async function sendReadReceipt(toPublicKey: string) {
  networkLog("📤 [READ-RECEIPT] Sending to", toPublicKey);
  try {
    const payload = {
      message: "",
      type: "read",
      username: "Me",
      filedata: "",
    };

    const jsonStr = JSON.stringify(payload);
    const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    let sendParams: any = {
      action: "send",
      application: "metachain",
      data: hexData,
      poll: false,
    };

    if (toPublicKey.startsWith("0x")) {
      const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);
      if (mxAddress) {
        networkLog(
          `🔍 [READ-RECEIPT] ✅ Found Maxima Address for ${toPublicKey.substring(0, 10)}...`,
        );
        sendParams.to = mxAddress;
      } else {
        sendParams.publickey = toPublicKey;
      }
    } else if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
      sendParams.to = toPublicKey;
    } else {
      sendParams.publickey = toPublicKey;
    }

    await MDS.cmd.maxima({ params: sendParams });
    networkLog("✅ [READ-RECEIPT] Sent successfully");

    // Mark received messages as read locally
    // CRITICAL: Resolve Hex key for DB query
    let dbKey = toPublicKey;
    if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
      const hex = await resolveHexFromAddress(toPublicKey);
      if (hex) dbKey = hex;
    }

    // CRITICAL: Don't mark as 'read' if the message has an active transaction (pending/sent)
    // Use UPPER() for case-insensitivity
    const sql = `UPDATE CHAT_MESSAGES SET state = 'read' WHERE UPPER(publickey) = UPPER('${dbKey}') AND username != 'Me' AND state != 'read' AND state != 'pending' AND state != 'sent' AND state != 'confirmed' AND state != 'received' AND state != 'unverified'`;
    MDS.sql(sql, (res: any) => {
      console.log("✅ [DB] Marked received messages as read locally:", res);
    });
  } catch (err) {
    console.error("❌ [READ-RECEIPT] Error sending:", err);
  }
}

export async function sendDeliveryReceipt(toPublicKey: string) {
  console.log("📤 [DELIVERY-RECEIPT] Sending to", toPublicKey);
  try {
    const payload = {
      message: "",
      type: "delivery_receipt",
      username: "Me",
      filedata: "",
    };

    const jsonStr = JSON.stringify(payload);
    const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    let sendParams: any = {
      action: "send",
      application: "metachain",
      data: hexData,
      poll: false,
    };

    if (toPublicKey.startsWith("0x")) {
      const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);
      if (mxAddress) {
        sendParams.to = mxAddress;
      } else {
        sendParams.publickey = toPublicKey;
      }
    } else if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
      sendParams.to = toPublicKey;
    } else {
      sendParams.publickey = toPublicKey;
    }

    await MDS.cmd.maxima({ params: sendParams });
    console.log("✅ [DELIVERY-RECEIPT] Sent successfully");
  } catch (err) {
    console.error("❌ [DELIVERY-RECEIPT] Error sending:", err);
  }
}

/* ----------------------------------------------------------------------------
   MESSAGE DELETE
---------------------------------------------------------------------------- */

export async function sendChatDeleteMessage(toPublicKey: string, customid: string): Promise<void> {
  try {
    const payload = { type: "message_deleted", customid };
    const hexData = "0x" + utf8ToHex(JSON.stringify(payload)).toUpperCase();

    let sendParams: any = { action: "send", application: "metachain", data: hexData, poll: false };

    if (toPublicKey.toLowerCase().startsWith("0x")) {
      const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);
      sendParams = mxAddress ? { ...sendParams, to: mxAddress } : { ...sendParams, publickey: toPublicKey };
    } else {
      sendParams.to = toPublicKey;
    }

    await MDS.cmd.maxima({ params: sendParams });
  } catch (err) {
    console.error("❌ [CHAT-DELETE] Error sending delete notification:", err);
  }
}

/* ----------------------------------------------------------------------------
   PING / PONG
---------------------------------------------------------------------------- */

export async function sendPing(toPublicKey: string) {
  networkLog("📡 [PING] Sending to", toPublicKey);
  try {
    const payload = {
      message: "",
      type: "ping",
      username: "Me",
      filedata: "",
    };

    const jsonStr = JSON.stringify(payload);
    const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    let sendParams: any = {
      action: "send",
      application: "metachain",
      data: hexData,
      poll: false,
    };

    if (toPublicKey.startsWith("0x")) {
      const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);
      if (mxAddress) {
        networkLog(`📡 [PING] ✅ Found Maxima Address`);
        sendParams.to = mxAddress;
      } else {
        sendParams.publickey = toPublicKey;
      }
    } else if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
      sendParams.to = toPublicKey;
    } else {
      sendParams.publickey = toPublicKey;
    }

    await MDS.cmd.maxima({ params: sendParams });
    networkLog("✅ [PING] Sent successfully");
  } catch (err) {
    console.error("❌ [PING] Error sending:", err);
    throw err;
  }
}

export async function sendPong(toPublicKey: string) {
  console.log("📡 [PONG] Sending to", toPublicKey);
  try {
    const payload = {
      message: "",
      type: "pong",
      username: "Me",
      filedata: "",
    };

    const jsonStr = JSON.stringify(payload);
    const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    let sendParams: any = {
      action: "send",
      application: "metachain",
      data: hexData,
      poll: false,
    };

    if (toPublicKey.startsWith("0x")) {
      const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);
      if (mxAddress) {
        console.log(`📡 [PONG] ✅ Found Maxima Address`);
        sendParams.to = mxAddress;
      } else {
        sendParams.publickey = toPublicKey;
      }
    } else if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
      sendParams.to = toPublicKey;
    } else {
      sendParams.publickey = toPublicKey;
    }

    await MDS.cmd.maxima({ params: sendParams });
    console.log("✅ [PONG] Sent successfully");
  } catch (err) {
    console.error("❌ [PONG] Error sending:", err);
    throw err;
  }
}

/* ----------------------------------------------------------------------------
   INVITATION & HISTORY
---------------------------------------------------------------------------- */

export async function sendInvitation(
  toPublicKey: string,
  fromUsername: string,
) {
  console.log("📨 [INVITE] Sending to", toPublicKey);
  try {
    const payload = {
      message: `${fromUsername} has invited you to join MetaChain! Install the app to start chatting.`,
      type: "invitation",
      username: fromUsername,
      filedata: "",
    };

    const jsonStr = JSON.stringify(payload);
    const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    await MDS.cmd.maxima({
      params: {
        action: "send",
        publickey: toPublicKey,
        application: "metachain",
        data: hexData,
        poll: false,
      } as any,
    });

    console.log("✅ [INVITE] Sent successfully");
  } catch (err) {
    console.error("❌ [INVITE] Error sending:", err);
    throw err;
  }
}

export async function requestChatHistory(toPublicKey: string) {
  console.log("🔄 [HISTORY-SYNC] Requesting from", toPublicKey);
  try {
    // RESOLVE HEX KEY FOR DB QUERY
    let dbKey = toPublicKey;
    if (toPublicKey.startsWith("Mx") || toPublicKey.startsWith("MX")) {
      const hex = await resolveHexFromAddress(toPublicKey);
      if (hex) dbKey = hex;
    }

    // Get the timestamp of the last message we have for this contact
    const lastMessageTime = await chatService.getLastMessageTimestamp(dbKey);

    // If we have no messages, request last 7 days. Otherwise, request from last message.
    const sinceTimestamp =
      lastMessageTime || Date.now() - 7 * 24 * 60 * 60 * 1000;

    console.log(
      `🔍 [HISTORY-SYNC] Last local message: ${lastMessageTime}, requesting since: ${sinceTimestamp}`,
    );

    const payload = {
      message: "",
      type: "chat_history_request",
      username: "Me",
      filedata: "",
      timestamp: sinceTimestamp,
    };

    const jsonStr = JSON.stringify(payload);
    const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    // Try to resolve MxAddress for better delivery reliability
    const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);

    if (mxAddress) {
      // FIX: Clean address to prevent NumberFormatException
      const cleanAddr = cleanMaximaAddress(mxAddress);
      console.log(
        "🔍 [HISTORY-SYNC] Using resolved address:",
        cleanAddr.substring(0, 20) + "...",
      );
      await MDS.cmd.maxima({
        params: {
          action: "send",
          to: cleanAddr,
          application: "metachain",
          data: hexData,
          poll: false,
        } as any,
      });
    } else {
      console.log("⚠️ [HISTORY-SYNC] No address found, using publickey");
      await MDS.cmd.maxima({
        params: {
          action: "send",
          publickey: toPublicKey,
          application: "metachain",
          data: hexData,
          poll: false,
        } as any,
      });
    }

    console.log("✅ [HISTORY-SYNC] Request sent successfully");
  } catch (err) {
    console.error("❌ [HISTORY-SYNC] Error requesting:", err);
    throw err;
  }
}

/* ----------------------------------------------------------------------------
   EXPORT SERVICE SINGLETON
---------------------------------------------------------------------------- */

export const messagingService = {
  sendMessage,
  sendReadReceipt,
  sendDeliveryReceipt,
  sendPing,
  sendPong,
  sendInvitation,
  requestChatHistory,
  sendSyncResponse: sendChatHistoryResponse,
  retryMessage, // Added for OfflineQueueService
};

// Also export sendChatHistoryResponse for use by handlers if needed (though it's usually triggered by incoming request)
export async function sendChatHistoryResponse(
  toPublicKey: string,
  messages: any[],
) {
  console.log(
    "🔄 [HISTORY-RESP] Sending " +
      messages.length +
      " messages to " +
      toPublicKey,
  );
  try {
    const payload = {
      type: "chat_history_response",
      messages: messages,
      timestamp: Date.now(),
    };

    const jsonStr = JSON.stringify(payload);
    const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

    // Use resolution logic
    const mxAddress = await resolveMaximaAddressFromPubkey(toPublicKey);
    let sendParams: any = {
      action: "send",
      application: "metachain",
      data: hexData,
      poll: false,
    };

    if (mxAddress) {
      sendParams.to = cleanMaximaAddress(mxAddress);
    } else {
      sendParams.publickey = toPublicKey;
    }

    await MDS.cmd.maxima({ params: sendParams });
    console.log("✅ [HISTORY-RESP] Response sent successfully");
  } catch (err) {
    console.error("❌ [HISTORY-RESP] Error sending response:", err);
  }
}
