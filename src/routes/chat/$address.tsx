// src/routes/chat/$address.tsx
import {
  useEffect,
  useRef,
  useState,
  useContext,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { useNavigate, createFileRoute } from "@tanstack/react-router";
import { Keyboard } from "@capacitor/keyboard";
import { Capacitor } from "@capacitor/core";
import { MDS } from "@minima-global/mds";
import { appContext } from "../../AppContext";
import TransferSelector from "../../components/chat/TransferSelector";
import {
  Trash2,
  Wallet,
  Info,
  Archive,

  Star,
  CheckCircle2,
  SlidersHorizontal,
  ArrowLeft,
  MoreVertical,
  ChevronRight,
  ShieldCheck,
  Zap,
  X,
  Radio,
  Paperclip,
  Activity,
  ShieldAlert,
} from "lucide-react";
import MessageBubble from "../../components/chat/MessageBubble";
import { compressImage } from "../../utils/image";

import { minimaService } from "../../services/minima.service";
import { chatService } from "../../services/chat.service";
import * as contactRequestsService from "../../services/contact-requests.service";
import { transactionService } from "../../services/transaction.service";
import {
  resolveHexFromAddress,
  sendChatDeleteMessage,
} from "../../services/messaging.service";
import { requestProfile } from "../../services/profile.service";
import InviteDialog from "../../components/chat/InviteDialog";
import { useTheme } from "../../context/ThemeContext";
import { getAndIncrementSequenceNumber } from "../../services/database.service";
import { EmojiClickData } from "emoji-picker-react";

// Lazy load EmojiPicker to reduce initial bundle size (~60KB)
const EmojiPicker = lazy(() => import("emoji-picker-react"));

// Helper for timeout
const withTimeout = (promise: Promise<any>, ms: number) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((reason) => {
        clearTimeout(timer);
        reject(reason);
      });
  });
};

export const Route = createFileRoute("/chat/$address")({
  component: ChatPage,
});

// charms array removed as it is unused

interface Contact {
  currentaddress: string;
  publickey: string; // Added: needed to send messages
  allow_non_contact_chats?: boolean; // NEW: check if peer allows messages from strangers
  extradata?: {
    minimaaddress?: string;
    name?: string;
    icon?: string;
  };
  myaddress?: string;
}

interface ParsedMessage {
  text: string | null;
  fromMe: boolean;
  charm: { id: string } | null;
  amount: number | null;
  timestamp?: number;
  status?: "pending" | "sent" | "delivered" | "read" | "failed" | "zombie" | "confirmed" | "received";
  tokenAmount?: { amount: string; tokenName: string }; // For token transfer messages
  isSystem?: boolean; // For system messages (centered)
  isCharm?: boolean; // For charm messages
  isToken?: boolean; // For token transfer messages
  type?: "text" | "image" | "charm" | "token" | "system"; // Message type
  filedata?: string; // Base64 encoded file data (e.g., for images)
  sender_seq?: number;
  customid?: string;
  id?: number;
  originalTimestamp?: number; // Sender's creation time (for correct ordering across peers)
  forwarded?: boolean;
  replyTo?: {
    customid: string;
    text: string;
    senderName: string;
    type: string;
  } | null;
  deleted?: boolean;
}



function ChatPage() {
  // Helper to remove duplicate messages (favors UUID/customid, then seq, then timestamp)
  // Helper to remove duplicate messages (favors UUID/customid, then seq, then timestamp)
  const deduplicateMessages = (msgs: ParsedMessage[]) => {
    // Maps to track seen values allowing cross-referencing
    const seenCustomIds = new Set<string>();
    const seenSeqKeys = new Set<string>(); // seq-sender-10
    const seenTimeKeys = new Set<string>(); // ts-type-text-12345

    // Filter duplicates
    const unique = msgs.filter((m) => {
      // 1. Gather all available keys for this message
      const keys: { customId?: string; seqKey?: string; timeKey: string } = {
        timeKey: `ts-${m.timestamp}-${m.charm ? "charm" : m.tokenAmount ? "token" : "text"}-${m.text || ""}`,
      };

      if (m.customid && m.customid !== "0x00" && m.customid !== "undefined") {
        keys.customId = m.customid;
      }

      if (m.sender_seq && m.sender_seq > 0) {
        keys.seqKey = `seq-${m.fromMe ? "me" : "them"}-${m.sender_seq}`;
      }

      // 2. CHECK: If ANY of these keys have been seen, it is a duplicate
      let isDuplicate = false;

      if (keys.customId && seenCustomIds.has(keys.customId)) isDuplicate = true;
      // Only use seqKey dedup when there is no customId — if a message has a UUID,
      // that's the authoritative identifier. SeqKey dedup on UUID messages causes
      // false positives when the sender's seq counter has been reset (different
      // messages end up sharing the same sender_seq number).
      if (!isDuplicate && keys.seqKey && !keys.customId && seenSeqKeys.has(keys.seqKey))
        isDuplicate = true;
      if (!isDuplicate && seenTimeKeys.has(keys.timeKey)) isDuplicate = true;

      // 3. ACTION: If duplicate, drop it. If unique, register ALL its keys
      if (isDuplicate) return false;

      if (keys.customId) seenCustomIds.add(keys.customId);
      if (keys.seqKey) seenSeqKeys.add(keys.seqKey);
      seenTimeKeys.add(keys.timeKey);

      return true;
    });

    // Sort by originalTimestamp if available (sender time), else fallback to local timestamp (arrival time)
    // This fixes ordering when network delivery is slightly out of order
    const sorted = unique.sort((a, b) => {
      // 1. Same sender priority: Sequence Number
      // If messages are from the same person (both Me or both Them), respect the sequence number absolutely.
      // This fixes cases where recent messages have slightly mixed timestamps (e.g. Async insertion).
      // CRITICAL FIX: Check for != null instead of truthy to properly handle sender_seq=0 (pending transactions)
      // 1. Same sender logic (Ignored for System messages - they rely on timestamp)
      if (
        a.fromMe === b.fromMe &&
        !a.isSystem &&
        !b.isSystem &&
        a.sender_seq != null &&
        b.sender_seq != null
      ) {
        // seq=0 as "most recent pending" only applies to MY outgoing messages.
        // For received messages (fromMe=false), seq=0 just means unknown — sort by timestamp.
        const aSeqUnknown = a.sender_seq === 0 && a.fromMe;
        const bSeqUnknown = b.sender_seq === 0 && b.fromMe;

        if (aSeqUnknown && bSeqUnknown) {
          // Both my pending — sort by timestamp
          const timeA =
            a.originalTimestamp && a.originalTimestamp > 0
              ? a.originalTimestamp
              : a.timestamp || 0;
          const timeB =
            b.originalTimestamp && b.originalTimestamp > 0
              ? b.originalTimestamp
              : b.timestamp || 0;
          return timeA - timeB;
        } else if (aSeqUnknown) {
          return 1; // my pending goes after confirmed
        } else if (bSeqUnknown) {
          return -1;
        } else if (a.sender_seq === 0 || b.sender_seq === 0) {
          // Received message with seq=0: fall back to timestamp
          const timeA =
            a.originalTimestamp && a.originalTimestamp > 0
              ? a.originalTimestamp
              : a.timestamp || 0;
          const timeB =
            b.originalTimestamp && b.originalTimestamp > 0
              ? b.originalTimestamp
              : b.timestamp || 0;
          return timeA - timeB;
        } else {
          // Both have valid seq — normal sequence comparison
          return a.sender_seq - b.sender_seq;
        }
      }

      // 2. Different senders or missing seq: Timestamp
      const timeA =
        a.originalTimestamp && a.originalTimestamp > 0
          ? a.originalTimestamp
          : a.timestamp || 0;
      const timeB =
        b.originalTimestamp && b.originalTimestamp > 0
          ? b.originalTimestamp
          : b.timestamp || 0;

      return timeA - timeB;
    });

    // Debug Log

    return sorted;
  };
  const { address } = Route.useParams();
  const navigate = useNavigate();

  // 0. Identity Normalization (Mx -> Hex)
  // Ensures that we always use the Hex Public Key as the primary identifier in the route
  useEffect(() => {
    if (address.startsWith("Mx") || address.startsWith("MX")) {
      resolveHexFromAddress(address).then((hex) => {
        if (hex) {
          console.log(
            `🔄 [CHAT] Normalizing Identity: Resolved Mx ${address} -> Hex ${hex}`,
          );
          navigate({ to: `/chat/${hex}`, replace: true });
        }
      });
    }
  }, [address, navigate]);

  const searchParams = Route.useSearch(); // Get search parameters
  const [contact, setContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProfileRequestAtRef = useRef<Map<string, number>>(new Map());
  const lastPingSentAtRef = useRef<Map<string, number>>(new Map());
  const [input, setInput] = useState("");
  const [showTransferSelector, setShowTransferSelector] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showReadModeWarning, setShowReadModeWarning] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);

  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedByThem, setBlockedByThem] = useState(false);

  // Block reason state

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteSending, setInviteSending] = useState(false);
  const [showForwardSuccess, setShowForwardSuccess] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{
    customid: string;
    text: string;
    senderName: string;
    type: string;
  } | null>(null);

  const { chatBackground, mode } = useTheme();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const PROFILE_REQUEST_THROTTLE_MS = 30000;
  const PING_THROTTLE_MS = 30000;
  const requestProfileThrottled = useCallback(
    async (targetAddress: string, targetPubkey: string, reason: string) => {
      if (!targetPubkey) return;
      const now = Date.now();
      const lastSent = lastProfileRequestAtRef.current.get(targetPubkey) || 0;
      if (now - lastSent < PROFILE_REQUEST_THROTTLE_MS) {
        console.log(
          `⏭️ [CHAT] Skipping profile request (${reason}) for ${targetPubkey.substring(
            0,
            10,
          )}...`,
        );
        return;
      }
      lastProfileRequestAtRef.current.set(targetPubkey, now);
      try {
        // force: true bypasses module-level throttle since component-level ref already guards
        await requestProfile(targetAddress, targetPubkey, 30000, true);
      } catch (err) {
        console.warn("⚠️ [CHAT] Profile request failed:", err);
      }
    },
    [],
  );
  const sendPingThrottled = useCallback(
    async (targetPubkey: string, reason: string) => {
      if (!targetPubkey) return;
      const now = Date.now();
      const lastSent = lastPingSentAtRef.current.get(targetPubkey) || 0;
      if (now - lastSent < PING_THROTTLE_MS) {
        console.log(
          `⏭️ [CHAT] Skipping ping (${reason}) for ${targetPubkey.substring(0, 10)}...`,
        );
        return;
      }
      lastPingSentAtRef.current.set(targetPubkey, now);
      try {
        await minimaService.sendPing(targetPubkey);
      } catch (err) {
        console.error(`❌ [PING] Failed to send:`, err);
      }
    },
    [],
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSendingRef = useRef(false); // Guard to prevent concurrent message sends
  const historyRequestedFor = useRef<string | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const cursorPositionRef = useRef<number | null>(null);

  // Removed duplicate navigate declaration (moved to top of ChatPage)

  // Auto-focus input
  useEffect(() => {
    if (showTransferSelector) return;
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [address, showTransferSelector]);

  // Scroll to bottom when keyboard opens
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleKeyboardShow = () => {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    };

    const showListener = Keyboard.addListener(
      "keyboardWillShow",
      handleKeyboardShow,
    );
    const didShowListener = Keyboard.addListener(
      "keyboardDidShow",
      handleKeyboardShow,
    );

    return () => {
      showListener.then((l) => l.remove());
      didShowListener.then((l) => l.remove());
    };
  }, []);

  // Handle click outside to close emoji picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showEmojiPicker &&
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmojiPicker]);

  const onEmojiClick = useCallback((data: EmojiClickData) => {
    setInput((prev) => {
      // Use tracked cursor position or fallback to end of current state
      const currentPos = cursorPositionRef.current ?? prev.length;

      // Ensure strict bounds (in case ref is stale and out of bounds)
      const safePos = Math.min(Math.max(0, currentPos), prev.length);

      const textBefore = prev.substring(0, safePos);
      const textAfter = prev.substring(safePos);

      // Update cursor position for NEXT insertion immediately
      cursorPositionRef.current = safePos + data.emoji.length;

      return textBefore + data.emoji + textAfter;
    });
  }, []);

  const { loaded, writeMode, userName, userAvatar, myPublicKey, synced } =
    useContext(appContext);
  const isLoadingMessages = useRef(false); // Flag to prevent simultaneous loads
  const pendingReload = useRef(false); // Flag to queue a reload if one is requested while loading
  const requestPendingHandled = useRef(false); // Ensure requestPending search param only triggers once

  // Contact request state
  const [contactRequest, setContactRequest] = useState<any | null>(null);
  const [processingRequest, setProcessingRequest] = useState(false);

  // Chat blocking state
  const [blockReason, setBlockReason] = useState<
    | "none"
    | "pending"
    | "recipient_restricted"
    | "incoming_restricted"
    | "no_permission"
  >("none");


  // Request notification permissions on app load (Android 13+)
  useEffect(() => {
    if (loaded) {
      chatService.requestNotificationPermission();
    }
  }, [loaded]);

  // Listen for Forward Success event
  useEffect(() => {
    const handleForwardSuccess = () => {
      setShowForwardSuccess(true);
      setTimeout(() => {
        setShowForwardSuccess(false);
      }, 2000);
    };

    window.addEventListener("FORWARD_SUCCESS", handleForwardSuccess);
    return () =>
      window.removeEventListener("FORWARD_SUCCESS", handleForwardSuccess);
  }, []);


  const decodeStoredAvatar = (avatar?: string | null) => {
    if (!avatar || avatar === "0x00") return "";

    const candidates = [avatar];
    try {
      candidates.unshift(decodeURIComponent(avatar));
    } catch (err) {
      console.warn("⚠️ [AVATAR] Error decoding stored avatar:", err);
    }

    const validAvatar = candidates.find(
      (candidate) =>
        candidate &&
        candidate.startsWith("data:image") &&
        !candidate.includes("/0x00"),
    );

    return validAvatar || "";
  };

  const getDiscoveryAvatar = (row: any) => {
    const directAvatar = decodeStoredAvatar(row?.AVATAR || row?.avatar);
    if (directAvatar) return directAvatar;

    const extraData = row?.EXTRA_DATA || row?.extra_data;
    if (!extraData) return "";

    try {
      const parsed =
        typeof extraData === "string" ? JSON.parse(extraData) : extraData;
      return decodeStoredAvatar(parsed?.avatar || parsed?.icon);
    } catch (err) {
      console.warn("⚠️ [CHAT] Failed to parse avatar from extra_data", err);
      return "";
    }
  };



  /* ----------------------------------------------------------------------------
      GET CONTACT INFO
  ---------------------------------------------------------------------------- */
  useEffect(() => {
    let mounted = true;
    const fetchContact = async () => {
      // 1. Try to load from localStorage cache first (Optimistic UI)
      const cacheKey = `cached_contact_${address}`;
      const cached = localStorage.getItem(cacheKey);

      if (cached) {
        try {
          const cachedContact = JSON.parse(cached);
          setContact(cachedContact);
          console.log("⚠️ [CHAT] Loaded contact from cache (Optimistic)");
        } catch (e) {
          console.warn("⚠️ [CHAT] Failed to parse cached contact");
        }
      }

      try {
        let contactToSet: Contact | null = null;
        let resolvedPublicKey = address; // Default to address as is

        // PRE-CHECK: If address is a Maxima address (Mx...), try to resolve to Hex Public Key first
        if (address && (address.startsWith("Mx") || address.startsWith("MX"))) {
          const safeMxAddress = address.replace(/'/g, "''");

          let resolveSql = `SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE ADDRESS = '${safeMxAddress}' LIMIT 1`;
          let resolveRes: any = await withTimeout(
            MDS.sql(resolveSql),
            3000,
          ).catch(() => ({ status: false }));

          if (
            !resolveRes.status ||
            !resolveRes.rows ||
            resolveRes.rows.length === 0
          ) {
            resolveSql = `SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE ADDRESS LIKE '%${safeMxAddress}%' LIMIT 1`;
            resolveRes = await withTimeout(MDS.sql(resolveSql), 3000).catch(
              () => ({ status: false }),
            );
          }

          if (
            resolveRes.status &&
            resolveRes.rows &&
            resolveRes.rows.length > 0
          ) {
            resolvedPublicKey = resolveRes.rows[0].PUBLICKEY;
            console.log(`✅ [CHAT] Resolved: ${resolvedPublicKey}`);
          } else {
            console.warn(`⚠️ [CHAT] Resolve failed: ${address}`);
          }
        }

        // 1. Try to find in Maxima contacts using the RESOLVED key
        const res: any = await withTimeout(MDS.cmd.maxcontacts(), 5000).catch(
          () => ({ status: false }),
        );
        const list: Contact[] = (res as any)?.response?.contacts || [];
        const c = list.find(
          (x) =>
            x.publickey === resolvedPublicKey ||
            x.currentaddress === address ||
            x.extradata?.minimaaddress === address,
        );

        if (c) {
          console.log("✅ [CHAT] User found in Contact cache");

          // Maxima contacts don't carry minimaaddress — enrich from DISCOVERED_PEERS
          if (
            (!c.extradata?.minimaaddress || !c.extradata?.icon) &&
            c.publickey
          ) {
            try {
              const safeKey = c.publickey.replace(/'/g, "''");
              const dpRes: any = await withTimeout(
                MDS.sql(
                  `SELECT MINIMAADDRESS, AVATAR, ALLOW_NON_CONTACT_CHATS, EXTRA_DATA FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${safeKey}') LIMIT 1`,
                ),
                2000,
              ).catch(() => ({ status: false }));
              if (dpRes.status && dpRes.rows?.length > 0) {
                if (!c.extradata) (c as any).extradata = {};

                const dpRow = dpRes.rows[0];
                const discoveryAvatar = getDiscoveryAvatar(dpRow);
                const dpAllowAll = dpRow.ALLOW_NON_CONTACT_CHATS === 1 || dpRow.ALLOW_NON_CONTACT_CHATS === true || dpRow.ALLOW_NON_CONTACT_CHATS === "1" || dpRow.ALLOW_NON_CONTACT_CHATS === "true";
                c.allow_non_contact_chats = dpAllowAll;
                let dpMinimaAddr = dpRow.MINIMAADDRESS || "";
                if (!dpMinimaAddr && dpRow.EXTRA_DATA) {
                  try {
                    const parsedExtra = typeof dpRow.EXTRA_DATA === "string" ? JSON.parse(dpRow.EXTRA_DATA) : dpRow.EXTRA_DATA;
                    dpMinimaAddr = parsedExtra?.minimaaddress || "";
                  } catch { /* ignore */ }
                }
                c.extradata = {
                  ...c.extradata,
                  minimaaddress:
                    dpMinimaAddr || c.extradata?.minimaaddress || "",
                  icon: c.extradata?.icon || discoveryAvatar,
                };

                console.log(
                  "✅ [CHAT] Enriched maxcontact from DISCOVERED_PEERS",
                );
              }
            } catch (e) {
              /* ignore */
            }
          }

          setContact(c);
          localStorage.setItem(cacheKey, JSON.stringify(c));
          // Preserve icon if we have one in cache AND we are offline/slow
          if (c.extradata?.icon) {
            console.log("🖼️ [CHAT] Preserving avatar from cache.");
          }
          // Profile Discovery Logic
          if (c.publickey && c.currentaddress) {
            console.log("🔄 [CHAT] Auto-requesting profile refresh...");
            requestProfileThrottled(
              c.currentaddress,
              c.publickey,
              "contact-cache",
            );
          }
        } else {
          // 2. If not found, try DISCOVERED_PEERS (using the RESOLVED key)
          console.log(
            `🔍 [CHAT] Checking Discovery DB: ${resolvedPublicKey}...`,
          );
          const queryKey = resolvedPublicKey.startsWith("0x")
            ? resolvedPublicKey
            : address;
          const safeQueryKey = queryKey.replace(/'/g, "''");

          const discoverySql = `SELECT *, ALLOW_NON_CONTACT_CHATS FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${safeQueryKey}')`;
          let discoveryRes: any = await withTimeout(
            MDS.sql(discoverySql),
            3000,
          ).catch(() => ({ status: false }));
          let foundInDiscovery =
            discoveryRes.status &&
            discoveryRes.rows &&
            discoveryRes.rows.length > 0;

          if (!foundInDiscovery) {
            console.log(
              `⚠️ [CHAT] Not in DISCOVERED_PEERS, checking METACHAIN_USERS...`,
            );
            const registrySql = `SELECT * FROM METACHAIN_USERS WHERE UPPER(publickey)=UPPER('${safeQueryKey}')`;
            discoveryRes = await withTimeout(MDS.sql(registrySql), 3000).catch(
              () => ({ status: false }),
            );
          }

          if (
            discoveryRes.status &&
            discoveryRes.rows &&
            discoveryRes.rows.length > 0
          ) {
            const peer = discoveryRes.rows[0];

            if (foundInDiscovery) {
              let parsedExtra: any = {};
              try {
                if (peer.EXTRA_DATA) {
                  parsedExtra =
                    typeof peer.EXTRA_DATA === "string"
                      ? JSON.parse(peer.EXTRA_DATA)
                      : peer.EXTRA_DATA;
                }
              } catch (e) {
                console.warn(
                  "⚠️ [CHAT] Failed to parse extra_data from discovery",
                  e,
                );
              }

              const dpAllowAll = peer.ALLOW_NON_CONTACT_CHATS === 1 || peer.ALLOW_NON_CONTACT_CHATS === true || peer.ALLOW_NON_CONTACT_CHATS === "1" || peer.ALLOW_NON_CONTACT_CHATS === "true";
              const discoveryAvatar = getDiscoveryAvatar(peer);

              contactToSet = {
                publickey: peer.PUBLICKEY,
                currentaddress: peer.ADDRESS || address,
                allow_non_contact_chats: dpAllowAll,
                extradata: {
                  name: peer.ALIAS || "Unknown",
                  minimaaddress:
                    peer.MINIMAADDRESS || parsedExtra.minimaaddress || "",
                  icon: discoveryAvatar,
                },
              };
            } else {
              contactToSet = {
                publickey: peer.PUBLICKEY || peer.publickey,
                currentaddress: peer.ADDRESS || peer.address || address,
                extradata: {
                  name: peer.ALIAS || peer.alias || "Unknown",
                  minimaaddress: "",
                  icon: "",
                },
              };
            }
          } else {
            // 3. FALLBACK: Check local CHAT_MESSAGES history
            // If we are offline and have chatted with them before, we might have their name stored in the messages
            console.log(
              `⚠️ [CHAT] Not in Discovery/Registry, checking local CHAT_MESSAGES for ${safeQueryKey}...`,
            );
            // CASE INSENSITIVE CHECK for robustness
            const historySql = `SELECT roomname, username FROM CHAT_MESSAGES WHERE UPPER(publickey)=UPPER('${safeQueryKey}') ORDER BY date DESC LIMIT 1`;
            const historyRes: any = await withTimeout(
              new Promise((resolve) => {
                MDS.sql(historySql, (res: any) => resolve(res));
              }),
              2000,
            ).catch((err) => {
              console.error("❌ [CHAT] History fallback SQL failed:", err);
              return { status: false };
            });

            console.log("⚠️ [CHAT] History result:", historyRes);

            if (
              historyRes.status &&
              historyRes.rows &&
              historyRes.rows.length > 0
            ) {
              const row = historyRes.rows[0];
              // Prefer roomname if set (usually recipient name), otherwise username?
              // Actually username is who sent it. If 'Me', it doesn't help.
              // But CHAT_MESSAGES stores 'roomname' as the *remote* party's name often (or empty).
              // Let's check what we have.
              // In ChatService.insertMessage, roomname is stored.
              // Warning: often roomname is empty '' in direct chats.
              // But 'ChatsAndGroups' seems to use 'roomname' from the chat item.

              const derivedName = row.ROOMNAME || "Unknown User";
              console.log(`✅ [CHAT] Found in history: ${derivedName}`);

              contactToSet = {
                publickey: resolvedPublicKey,
                currentaddress: address, // Best guess
                extradata: {
                  name: derivedName,
                  minimaaddress: "", // Can't recover this easily without token msg, but text works
                  icon: "",
                },
              };
            } else {
              console.log(
                "⚠️ [CHAT] Contact not found anywhere. Using raw/resolved.",
              );

              // Only use fallback "Unknown" if we DO NOT have cached data
              // If cached data exists, we prefer it over "Unknown User" fallback
              if (!cached) {
                contactToSet = {
                  publickey: resolvedPublicKey,
                  currentaddress: address,
                  extradata: {
                    name: "Unknown User",
                  },
                };
              } else {
                console.log(
                  "⚠️ [CHAT] Keeping cached contact instead of fallback Unknown",
                );
                // We keep contactToSet null so we don't overwrite cache with Unknown
              }
            }
          }
        }

        if (contactToSet) {
          // OFFLINE FIX: If the fresh contact data is missing the icon (common when offline/timeout),
          // but we have a cached icon, PRESERVE IT!
          if (!contactToSet.extradata?.icon && cached) {
            try {
              const cachedObj = JSON.parse(cached);
              if (cachedObj.extradata?.icon) {
                if (!contactToSet.extradata) contactToSet.extradata = {};
                contactToSet.extradata.icon = cachedObj.extradata.icon;
                console.log(
                  "⚠️ [CHAT] Restore icon from cache (offline persistence)",
                );
              }
            } catch (e) {
              // Ignore parse error
            }
          }

          setContact(contactToSet);
          // Update cache
          localStorage.setItem(cacheKey, JSON.stringify(contactToSet));

          // Check if we need a fresh profile (non-contacts or unknown name)
          let needsProfile = false;
          try {
            const res = await MDS.cmd.maxcontacts();
            const contactsList: any[] = (res as any)?.response?.contacts || [];
            const isMaximaContact = contactsList.some(
              (c: any) => c.publickey === contactToSet.publickey,
            );
            if (!isMaximaContact) {
              needsProfile = true;
            }
          } catch (e) {
            needsProfile = true; // Fallback to safe check
          }

          const isUnknown =
            contactToSet.extradata?.name === "Unknown User" ||
            !contactToSet.extradata?.name;
          const isMissingAddress = !contactToSet.extradata?.minimaaddress;

          if (needsProfile || isUnknown || isMissingAddress) {
            if (contactToSet.publickey) {
              console.log(
                "🔄 [CHAT] Non-contact or incomplete profile, requesting fresh profile...",
              );
              requestProfileThrottled(
                contactToSet.currentaddress || address,
                contactToSet.publickey,
                "incomplete-profile",
              );
            }
          }
        }
      } catch (err) {
        if (mounted) console.error("❌ [CHAT] Contact load error:", err);
      }
    };

    if (address) {
      fetchContact();

      // Trigger coin discovery to check for offline tokens
      // This runs once per chat open to catch any tokens that arrived while offline
      (window as any).MDS?.cmd("service:COINDISC", (res: any) => {
        if (res.status) {
          console.log("📦 [CHAT] Coin discovery triggered");
        }
      });
    }

    // LISTEN FOR PROFILE UPDATES
    const handlePeerUpdate = (e: CustomEvent) => {
      const updatedPeer = e.detail;
      console.log("🔄 [CHAT] Received peer_updated event:", updatedPeer);
      const updatedKey = updatedPeer?.publickey || updatedPeer?.pubkey;
      const updatedAddress =
        updatedPeer?.address ||
        updatedPeer?.currentaddress ||
        updatedPeer?.minimaaddress ||
        "";
      const contactKey = contact?.publickey || "";
      const contactAddr = contact?.currentaddress || "";
      const isMatch =
        (updatedKey &&
          contactKey &&
          updatedKey.toLowerCase() === contactKey.toLowerCase()) ||
        (updatedKey && contactAddr && updatedKey === contactAddr) ||
        (updatedKey && address && updatedKey === address) ||
        (updatedAddress && address && updatedAddress === address) ||
        (updatedAddress && contactAddr && updatedAddress === contactAddr);
      if (!isMatch) return;
      console.log("🔄 [CHAT] Triggering contact refresh due to peer update.");
      fetchContact();
    };

    window.addEventListener("peer_updated" as any, handlePeerUpdate);

    return () => {
      mounted = false;
      window.removeEventListener("peer_updated" as any, handlePeerUpdate);
    };
  }, [address]);

  // Check chat status (archived, favorite, and blocked)
  const checkChatStatus = async () => {
    if (!contact?.publickey) return;
    try {
      const status = await minimaService.getChatStatus(contact.publickey);
      setIsArchived(status.archived);
      setIsFavorite(status.favorite);
      setIsBlocked(status.blocked);
      setBlockedByThem(status.blockedByThem);
    } catch (err) {
      console.error("❌ [CHAT] Check status error:", err);
    }
  };

  // State to track if there is a pending outgoing request (separate from blocking)
  const [isPendingOutgoing, setIsPendingOutgoing] = useState(false);

  // Check for pending contact request when contact changes
  const checkPending = useCallback(async () => {
    if (!contact?.publickey) return;

    console.log(`🔍 [CHAT] Checking pending request: ${contact.publickey}`);

    // CRITICAL: Request updated profile to ensure we have the latest allowNonContactChats value
    // This is especially important because DISCOVERED_PEERS might have stale beacon data
    /*
    try {
      console.log(`🔄 [CHAT] Requesting fresh profile for permission check...`);
      await requestProfileThrottled(
        contact.currentaddress,
        contact.publickey,
        "pending-check",
      );
      // Give it a moment to process the response
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      console.warn(`⚠️ [CHAT] Could not request profile, using cached data:`, err);
    }
    */

    // Check for OUTGOING requests (I sent to them)
    // ... existing logic ...

    const hasPendingOutgoing = await minimaService.checkPendingChatRequest(
      contact.publickey,
    );
    setIsPendingOutgoing(hasPendingOutgoing);

    // Check for OUTGOING Maxima contact requests (treated as pending outgoing for the permission guard)
    try {
      const escapeSqlLocal = (str: string) => str.replace(/'/g, "''");
      const myPk = myPublicKey || "";
      if (myPk) {
        const outMaximaSql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS
                              WHERE UPPER(from_publickey)=UPPER('${escapeSqlLocal(myPk)}')
                              AND UPPER(to_publickey)=UPPER('${escapeSqlLocal(contact.publickey)}')
                              AND status='pending'`;
        const outMaximaRes = await minimaService.runSQL(outMaximaSql);
        const hasPendingMaximaOutgoing = outMaximaRes?.rows?.length > 0;
        if (hasPendingMaximaOutgoing && !hasPendingOutgoing) {
          // Treat as pending outgoing for the permission guard too
          setIsPendingOutgoing(true);
        }
      }
    } catch (err) {
      console.warn("⚠️ [CHAT] Error checking outgoing Maxima request:", err);
    }

    // Check for INCOMING requests (they sent to me)
    const hasPendingIncoming = await minimaService.checkIncomingChatRequest(
      contact.publickey,
    );

    // Check if we're already Maxima contacts
    let isContact = false;
    try {
      const res = await MDS.cmd.maxcontacts();
      const contacts: any[] = (res as any)?.response?.contacts || [];
      isContact = contacts.some((c: any) => c.publickey === contact.publickey);
    } catch (err) {
      console.error("❌ [CHAT] Error checking Maxima contacts:", err);
    }

    // CRITICAL FIX: Check THEIR permission, not mine!
    // When I (sender) want to chat with THEM (recipient), I need to check if THEY allow non-contact chats
    const recipientAllowsNonContacts =
      await minimaService.getContactChatPermission(contact.publickey);
    console.log(
      `🔍 [CHAT] Recipient ${contact?.extradata?.name || contact.publickey.substring(0, 10)} allowsNonContacts: ${recipientAllowsNonContacts}`,
    );

    // CRITICAL: Maxima Contact Requests take precedence over everything else
    // We check this FIRST to ensure the banner appears if a request exists.
    let hasMaximaRequest = false;
    try {
      const escapeSql = (str: string) => str.replace(/'/g, "''");
      // Relaxed query: Check for ANY pending request from this user to us
      const maximaReqSql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS
                            WHERE UPPER(from_publickey)=UPPER('${escapeSql(contact.publickey)}')
                            AND status='pending'`;

      const maximaReqRes = await minimaService.runSQL(maximaReqSql);

      if (maximaReqRes && maximaReqRes.rows && maximaReqRes.rows.length > 0) {
        // Has pending Maxima contact request - show banner but DO NOT auto-allow chat
        // We must still respect the sender's "Allow Direct Messages" setting

        // FIX: Ensure UI sees the request object so the banner appears!
        const foundReq = maximaReqRes.rows[0];
        if (!foundReq.type) foundReq.type = "maxima";
        setContactRequest(foundReq as any);
        console.log("🔔 [CHAT] Found incoming Maxima contact request");

        hasMaximaRequest = true;
      }
      // NOTE: Don't clear contactRequest here - there might be a pending CHAT request
    } catch (err) {
      console.error("❌ [CHAT] Error checking Maxima requests:", err);
    }

    // Block chat based on current privacy settings (not historical acceptance)
    if (isContact) {
      // Already Maxima contacts - always allow
      console.log("🔓 [CHAT] Allowing (Maxima Contact)");
      setBlockReason("none");
    } else if (hasPendingIncoming || hasMaximaRequest) {
      // They sent ME a request - I should be able to REPLY to them IF they allow it
      if (recipientAllowsNonContacts) {
        setBlockReason("none");
        console.log(
          "🔓 [CHAT] Allowing reply to incoming request (recipient allows non-contact chats)",
        );
      } else {
        setBlockReason("recipient_restricted");
        console.log(
          "🔒 [CHAT] Blocking reply (recipient doesn't allow non-contact chats). Must Accept Request first.",
        );
      }
    } else if (hasPendingOutgoing) {
      // I sent THEM a request - check THEIR permission
      if (recipientAllowsNonContacts) {
        console.log(
          "🔓 [CHAT] Allowing (pending request but recipient allows non-contact chats)",
        );
        setBlockReason("none");
      } else {
        console.log(
          "🔒 [CHAT] Blocking (pending request, recipient doesn't allow non-contact chats)",
        );
        setBlockReason("recipient_restricted");
      }
    } else {
      // No pending requests - check recipient's permission
      if (recipientAllowsNonContacts) {
        console.log("🔓 [CHAT] Allowing (recipient allows non-contact chats)");
        setBlockReason("none");
      } else {
        console.log(
          "🔒 [CHAT] Blocking (recipient doesn't allow non-contact chats)",
        );
        setBlockReason("recipient_restricted");
      }
    }

    // Always check override logic (no condition to avoid stale state)
    if (myPublicKey && contact?.publickey) {
      try {
        const sPeer = contact.publickey.replace(/'/g, "''");
        const sql = `SELECT * FROM CONTACT_REQUESTS
                   WHERE ((UPPER(from_publickey)=UPPER('${myPublicKey.replace(
                     /'/g,
                     "''",
                   )}') AND UPPER(to_publickey)=UPPER('${sPeer}'))
                      OR (UPPER(from_publickey)=UPPER('${sPeer}') AND UPPER(to_publickey)=UPPER('${myPublicKey.replace(
                        /'/g,
                        "''",
                      )}')))
                   AND status='accepted'`;

        const res = await new Promise<any>((resolve) => MDS.sql(sql, resolve));

        if (res.status && res.rows && res.rows.length > 0) {
          console.log(
            "🔓 [CHAT] Override: Found ACCEPTED request in DB -> Allow",
          );
          setBlockReason("none");
        } else {
          // Also check MAXIMA_CONTACT_REQUESTS for accepted state
          const maximaAcceptedSql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS
                     WHERE (UPPER(from_publickey)=UPPER('${sPeer}') OR UPPER(to_publickey)=UPPER('${sPeer}'))
                     AND status='accepted'`;
          const maximaAcceptedRes = await new Promise<any>((resolve) => MDS.sql(maximaAcceptedSql, resolve));

          if (maximaAcceptedRes.status && maximaAcceptedRes.rows && maximaAcceptedRes.rows.length > 0) {
            console.log(
              "🔓 [CHAT] Override: Found ACCEPTED Maxima request in DB -> Allow",
            );
            setBlockReason("none");
          } else {
            // HISTORY OVERRIDE
            const historySql = `SELECT * FROM CHAT_MESSAGES WHERE UPPER(publickey)=UPPER('${sPeer}') AND type!='system' LIMIT 1`;
            const histRes = await new Promise<any>((resolve) =>
              MDS.sql(historySql, resolve),
            );

            if (histRes.status && histRes.rows && histRes.rows.length > 0) {
              console.log(
                "🔓 [CHAT] Override: Found CHAT HISTORY -> Allow (Implied Contact)",
              );
              setBlockReason("none");
            }
          }
        }
      } catch (sqlErr) {
        console.warn("Error checking accepted status:", sqlErr);
      }
    }

    // If we just sent a request, reload messages to show the system message (once only)
    if (
      (searchParams as any)?.requestPending &&
      !requestPendingHandled.current
    ) {
      requestPendingHandled.current = true;
      setIsPendingOutgoing(true); // OPTIMISTIC: show bubble immediately
      loadMessagesFromDB();
    }
  }, [contact, searchParams]);

  useEffect(() => {
    if (contact?.publickey) {
      checkChatStatus();
      checkPending().catch((err) =>
        console.error("❌ [CHAT] Error checking pending:", err),
      );
    }
  }, [contact, checkPending]);

  // POLL FOR NEW MAXIMA EVENTS (Real-time reactivity for Header Banner)
  // Since we cannot easily hook into the global MDS.init from this component without potentially conflicting with AppContext,
  // simply polling the local DB state is safer and sufficient for "reactive" UI updates like this banner.
  useEffect(() => {
    // Polling replaced by event listener (handleNewMessage)
    // return () => clearInterval(intervalId);
  }, [contact, checkPending]);

  // Listen for balance updates to reload messages when transaction status changes
  // This ensures messages show updated pending/sent/confirmed status in real-time
  useEffect(() => {
    const handleBalanceUpdate = () => {
      console.log(
        "🔄 [CHAT] Balance updated - reloading messages to update transaction status",
      );
      loadMessagesFromDB();
    };

    const removeListener = minimaService.onBalanceUpdate(handleBalanceUpdate);

    return () => {
      removeListener();
    };
  }, []);

  // Listen for archive and favorite status changes
  useEffect(() => {
    const handleStatusChange = () => {
      checkChatStatus();
    };

    minimaService.onArchiveStatusChange(handleStatusChange);
    minimaService.onFavoriteStatusChange(handleStatusChange);

    return () => {
      minimaService.removeArchiveStatusCallback(handleStatusChange);
      minimaService.removeFavoriteStatusCallback(handleStatusChange);
    };
  }, [contact]);

  // Check for pending contact requests
  const loadContactRequest = useCallback(async () => {
    if (!contact?.publickey || !myPublicKey) return;

    try {
      const [chatRequests, maximaRequests] = await Promise.all([
        minimaService.getChatRequests(myPublicKey),
        minimaService.getMaximaContactRequests(myPublicKey),
      ]);

      console.log("🔍 [CHAT] Contact address:", contact.publickey);

      // Tag Maxima requests so UI knows how to handle them
      const taggedMaxima = maximaRequests.map((r: any) => ({
        ...r,
        type: "maxima",
      }));

      // Merge all requests
      const allRequests = [...chatRequests, ...taggedMaxima];

      // Simple solution: if there's only one pending request, show it
      // This works because users typically only have one pending request at a time
      // and they're viewing the chat with the person who sent it
      let pendingRequest = null;

      if (allRequests.length === 1) {
        pendingRequest = allRequests[0];
      } else if (allRequests.length > 1) {
        // Try to match by hex publickey if contact has it
        if (contact.publickey.startsWith("0x")) {
          // Check FROM_PUBLICKEY (Chat) or from_publickey (Maxima - casing might differ from SQL)
          pendingRequest = allRequests.find((r: any) => {
            const fromPk = r.FROM_PUBLICKEY || r.from_publickey;
            return fromPk === contact.publickey;
          });
        }
      }

      setContactRequest(pendingRequest || null);
    } catch (err) {
      console.error("❌ [CHAT] Load requests error:", err);
    }
  }, [contact, myPublicKey]);

  useEffect(() => {
    loadContactRequest();
  }, [loadContactRequest]);

  /* ----------------------------------------------------------------------------
      LOAD MESSAGES FROM DB
  ---------------------------------------------------------------------------- */
  // Helper to load messages from DB - reusable for initial load and after sending
  const loadMessagesFromDB = async (delay = 0) => {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));

    // FIX: Prioritize publickey (Canonical) over bridge address
    const targetKey = contact?.publickey || address;
    if (!targetKey) return;

    // QUEUEING MECHANISM: If already loading, mark as pending and skip this run
    if (isLoadingMessages.current) {
      console.log("⏭️ [CHAT] Load already active - queueing next run.");
      pendingReload.current = true;
      return;
    }

    isLoadingMessages.current = true;
    pendingReload.current = false; // Clear pending flag as we are starting now

    try {
      // 1. Try to load from cache
      const cacheKey = `cached_msgs_${targetKey}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const cachedMsgs = JSON.parse(cached);
          // Apply cache only on cold load (actual state is empty, not stale closure).
          // Use functional form to avoid stale closure on `messages`.
          if (Array.isArray(cachedMsgs) && cachedMsgs.length > 0) {
            setMessages((prev) => {
              if (prev.length > 0) return prev; // already have live messages, don't overwrite
              console.log("⚠️ [CHAT-DB] Loaded messages from cache");
              return deduplicateMessages(cachedMsgs);
            });
          }
        } catch (e) {}
      }

      // 0. Quick Resolve Fallback: If we only have an Mx address and NO public key, try a quick resolve
      // This helps when the contact state hasn't finished loading or resolving yet
      let resolvedKey: string | null = contact?.publickey || null;
      if (
        !resolvedKey &&
        address &&
        (address.startsWith("Mx") || address.startsWith("MX"))
      ) {
        const safeAddr = address.replace(/'/g, "''");
        const resolveSql = `SELECT PUBLICKEY FROM DISCOVERED_PEERS WHERE ADDRESS = '${safeAddr}' OR ADDRESS LIKE '%${safeAddr}%' LIMIT 1`;
        const res: any = await withTimeout(MDS.sql(resolveSql), 6000).catch(() => null);
        if (res && res.status && res.rows && res.rows.length > 0) {
          resolvedKey = res.rows[0].PUBLICKEY;
          console.log(
            `🔍 [CHAT] Quick-resolved identity for query: ${resolvedKey}`,
          );
        }
      }

      const fetchKeys = [address, resolvedKey].filter(Boolean) as string[];
      const rawMessages: any = await withTimeout(
        minimaService.getMessages(fetchKeys),
        5000,
      ).catch(() => null);

      if (Array.isArray(rawMessages)) {
        const parsedMessages = rawMessages.map((row: any) => {
          // Normalització de claus de la DB (poden venir en majúscules de H2)
          const type = row.TYPE || row.type;
          const rowMessage = row.MESSAGE || row.message;
          const isCharm = type === "charm";
          const isToken = type === "token";
          const charmObj = isCharm ? { id: rowMessage } : null;

          let tokenAmount: { amount: string; tokenName: string } | undefined;
          let displayText: string | null = null;

          if (isToken) {
            try {
              const tokenData = JSON.parse(rowMessage || "{}");
              tokenAmount = {
                amount: tokenData.amount,
                tokenName: tokenData.tokenName,
              };
              // Fallback text in case UI fails
              displayText = `${Number(tokenData.amount)} ${tokenData.tokenName}`;
            } catch (err) {
              console.error("❌ [CHAT-DB] Token parse error:", err);
              displayText = rowMessage || "";
            }
          } else if (!isCharm) {
            displayText = rowMessage || "";
          }

          // Safer status parsing - do NOT default to 'sent' blindly
          let parsedStatus: any = row.STATE || row.state;

          if (
            !parsedStatus ||
            parsedStatus === "null" ||
            parsedStatus === "undefined"
          ) {
            // If state is missing, default based on type AND sender
            const username = row.USERNAME;
            parsedStatus =
              (isCharm || isToken) && username === "Me" ? "pending" : "sent";
          }

          // DEBUG LOG: See what we are loading
          if (isToken) {
            console.log(
              `🔎 [CHAT-DB] Loaded Token: ID=${row.DATE}, Status=${parsedStatus}, Amount=${tokenAmount?.amount}`,
            );
          }

          // CRITICAL FIX: If it's a token/charm from me, we MUST verify against the TRANSACTIONS table
          // because CHAT_MESSAGES might default to 'sent' or be outdated, while TRANSACTIONS knows the real "pending" state.
          // We can use the timestamp (row.DATE) which corresponds to message_timestamp in TRANSACTIONS?
          // Let's assume we can check async or rely on what we have.
          // Since this is inside a map, we can't await easily without Promise.all.
          // For now, let's map it, and then do a second pass or Promise.all the list.

          return {
            id: row.ID,
            displayText,
            parsedStatus,
            isToken,
            isCharm,
            tokenAmount,
            txpowid: row.TXPOWID || row.txpowid || null,
            username: row.USERNAME,
            // ROBUST FIX: Case-insensitive check and log for debugging
            isSystem: (() => {
              const u = row.USERNAME ? String(row.USERNAME).trim() : "";
              const t = row.TYPE ? String(row.TYPE).trim() : "";
              const m = row.MESSAGE ? String(row.MESSAGE).trim() : "";

              // Check 1: Username is System (case insensitive)
              if (u.toLowerCase() === "system") return true;

              // Check 2: Type is system (case insensitive)
              if (t.toLowerCase() === "system") return true;

              // Check 3: Automated system event text patterns (fallback)
              if (m.toLowerCase().includes("chat accepted")) return true;
              if (m.toLowerCase().includes("request accepted")) return true;
              if (m.toLowerCase().includes("chat request sent")) return true;
              if (m.toLowerCase().includes("user chat accepted")) return true;

              return false;
            })(),
            type: row.TYPE, // Extract type (e.g., 'image')
            filedata: row.FILEDATA, // Extract base64 file data
            timestamp: Number(row.DATE) || Date.now(), // Convert to number, fallback to now if invalid
            message: row.MESSAGE,
            amount: row.AMOUNT,
            fromMe: row.USERNAME === "Me",
            charm: charmObj,
            sender_seq: row.SENDER_SEQ != null ? Number(row.SENDER_SEQ) : null, // Map sequence number (Strict Number)
            customid: row.CUSTOMID, // Map custom ID for deduplication
            originalTimestamp: row.ORIGINAL_TIMESTAMP
              ? Number(row.ORIGINAL_TIMESTAMP)
              : undefined, // Convert to number,
            forwarded: row.FORWARDED == 1 || row.forwarded == 1,
            replyTo:
              row.REPLY_TO_CUSTOMID || row.reply_to_customid
                ? {
                    customid: row.REPLY_TO_CUSTOMID || row.reply_to_customid,
                    text: row.REPLY_TO_TEXT || row.reply_to_text || "",
                    senderName:
                      row.REPLY_TO_SENDER || row.reply_to_sender || "",
                    type: row.REPLY_TO_TYPE || row.reply_to_type || "text",
                  }
                : null,
            deleted: row.DELETED === 1 || row.DELETED === "1",
          };
        });

        // Phase 2: Async Status Verification for Pending/Sent Transactions
        // Match the sidebar logic: check TRANSACTIONS table for pending/sent status
        const finalMessages = await Promise.all(
          parsedMessages.map(async (msg: any) => {
            let finalStatus = msg.parsedStatus;

            // Only check if it looks like a transaction from me
            if ((msg.isToken || msg.isCharm) && msg.fromMe) {
              // Check TRANSACTIONS table using the message timestamp as stateId
              const tx =
                await transactionService.findPendingTransactionByStateId(
                  msg.timestamp,
                );
              if (!tx && finalStatus === "pending") {
                // No active transaction found for an orphaned pending message — treat as confirmed
                finalStatus = "confirmed";
              }
            }

            // Check incoming tokens still in 'received' state: verify 3-block confirmation directly.
            // NOTE: The txpowid stored from the Maxima message is the pre-PoW id and may not be
            // findable via 'txpow txpowid:X'. Fall back to searching by originalTimestamp.
            if (
              (msg.isToken || msg.isCharm) &&
              !msg.fromMe &&
              finalStatus === "received"
            ) {
              const originalTs =
                msg.originalTimestamp || msg.timestamp;



              const isConfirmed = await new Promise<boolean>((resolve) => {
                if (!originalTs) {
                  resolve(false);
                  return;
                }
                // Try stored txpowid first (fast path)
                if (msg.txpowid && msg.txpowid !== "null") {
                  MDS.executeRaw(
                    `txpow txpowid:${msg.txpowid}`,
                    (txRes: any) => {
                      const txBlock = txRes?.response?.header?.block;
                      if (txBlock !== undefined && txBlock !== null) {
                        // Fast path succeeded
                        MDS.executeRaw(
                          "status",
                          (statusRes: any) => {
                            const currentBlock =
                              statusRes?.response?.chain?.block;
                            resolve(
                              currentBlock !== undefined &&
                                parseInt(currentBlock) -
                                  parseInt(txBlock) >=
                                  3,
                            );
                          },
                        );
                        return;
                      }
                      // Stored txpowid didn't work — cannot find incoming tx via address scan
                      // (txpow address: only returns outgoing txs). SW handles confirmation.
                      console.log(
                        `🔍 [CHAT] txpow lookup failed for stored id (ts=${originalTs}) — deferring to SW.`,
                      );
                      resolve(false);
                    },
                  );
                } else {
                  // No stored txpowid — cannot confirm incoming tx from frontend.
                  // SW handles confirmation via NEWBALANCE → unconfirmed=0.
                  resolve(false);
                }
              });

              if (isConfirmed) {
                finalStatus = "confirmed";
                console.log(
                  `✅ [CHAT] Incoming token confirmed via frontend check: msg ${msg.id}`,
                );
                MDS.sql(
                  `UPDATE CHAT_MESSAGES SET state='confirmed' WHERE id=${msg.id}`,
                  () => { loadMessagesFromDB(); },
                );
              }
            }

            return {
              id: msg.id,
              text: msg.displayText,
              fromMe: msg.fromMe,
              charm: msg.charm,
              amount: msg.amount,
              timestamp: msg.timestamp, // Already a number now
              status: finalStatus,
              tokenAmount: msg.tokenAmount,
              isCharm: msg.isCharm,
              isToken: msg.isToken,
              sender_seq: msg.sender_seq,
              customid: msg.customid,
              originalTimestamp: msg.originalTimestamp,
              isSystem: msg.isSystem,
              type: msg.type,
              filedata: msg.filedata,
              forwarded: msg.forwarded,
              replyTo: msg.replyTo,
              deleted: msg.deleted,
            } as ParsedMessage;
          }),
        );

        // Merge DB results with current state to avoid race condition:
        // If the EVENT path (NEW_CHAT_MESSAGE) just added a message to state,
        // but the DB query is stale (SW hasn't finished saving yet), a plain
        // setMessages(dbResult) would overwrite and lose the EVENT-added message.
        // Using the functional form merges DB (authoritative) + prev state (optimistic).
        setMessages((prev) => deduplicateMessages([...finalMessages, ...prev]));

        // Cache the LAST 50 messages to save space for offline use
        try {
          const toCache = deduplicateMessages([...finalMessages]).slice(-50);
          localStorage.setItem(
            `cached_msgs_${targetKey}`,
            JSON.stringify(toCache),
          );
        } catch (e) {
          console.warn("⚠️ [CHAT] Failed to cache messages", e);
        }
      }
    } catch (err) {
      console.error("❌ [CHAT] Message load error:", err);
    } finally {
      isLoadingMessages.current = false;

      // If a reload was requested while we were running, run again immediately
      if (pendingReload.current) {
        console.log(
          "🔄 [CHAT] Pending reload detected - re-running loadMessagesFromDB",
        );
        loadMessagesFromDB();
      }
    }
  };

  useEffect(() => {
    if (!address) return;

    // Use current address as target
    const targetKey = address;

    const initChat = async () => {
      // Initial load
      await loadMessagesFromDB();

      // Mark chat as opened
      minimaService.markChatAsOpened(targetKey);

      // Send read receipt for any unread messages after loading
      if (contact?.publickey) {
        minimaService.sendReadReceipt(contact.publickey);
      }

      // Transaction cleanup is now handled by Service Worker

      // TRIGGER SYNC: Request history from peer to catch up on missed messages
      if (contact?.publickey) {
        // Normalize pubkey to avoid 0X vs 0x guard bypass
        const normPk = contact.publickey.toUpperCase();
        if (historyRequestedFor.current !== normPk) {
          historyRequestedFor.current = normPk;
          console.log(
            "🔄 [CHAT] Triggering history sync (init) with",
            contact.publickey,
          );
          setIsSyncing(true);
          // Auto-clear after 15 seconds if no SW response
          if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
          syncTimeoutRef.current = setTimeout(() => {
            setIsSyncing(false);
            syncTimeoutRef.current = null;
          }, 15000);

          (window as any).MDS?.cmd(
            "service:CHAT_SYNC:" + normPk,
            function () {},
          );
        }
      }
    };

    initChat();

    // Polling removed in favor of event-based updates (onNewMessage)
    // The Service Worker handles DB insertion, and onNewMessage notifies the UI.

    return () => {
      // Cleanup if needed
    };
  }, [address, contact?.publickey]);

  const [appStatus, setAppStatus] = useState<
    "unknown" | "checking" | "installed" | "not_found" | "offline"
  >("unknown");
  // const [lastSeen, setLastSeen] = useState<number | null>(null);

  /* ----------------------------------------------------------------------------
      LISTEN FOR INCOMING MESSAGES
  ---------------------------------------------------------------------------- */
  useEffect(() => {
    if (!contact) return;

    // Always check app status when entering chat
    if (contact.publickey) {
      console.log(`📡 [PING] Starting check for: ${contact.publickey}`);
      setAppStatus("checking");

      // 1. Check if user is "Known" (in Discovery or Contacts)
      // This determines if they fall back to 'offline' or 'not_found' on timeout
      const safeKey = contact.publickey.replace(/'/g, "''");
      const discoverySql = `SELECT * FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${safeKey}')`;

      let isKnownUser = false;

      minimaService.runSQL(discoverySql).then((res: any) => {
        if (res && res.rows && res.rows.length > 0) {
          isKnownUser = true;
        } else {
          // If not in discovery, check if it's a valid 0x key (implies we know them via contact)
          if (contact.publickey.startsWith("0x")) {
            isKnownUser = true;
          }
        }
      });

      sendPingThrottled(contact.publickey, "chat-open");

      // Request chat history synchronization (GUARDED)
      // Normalize pubkey to avoid 0X vs 0x guard bypass
      const normPkForSync = contact.publickey.toUpperCase();
      if (historyRequestedFor.current !== normPkForSync) {
        historyRequestedFor.current = normPkForSync;
        console.log(
          `🔄 [CHAT] Triggering history sync for: ${contact.publickey}`,
        );
        setIsSyncing(true);
        // Auto-clear after 15 seconds if no SW response
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          setIsSyncing(false);
          syncTimeoutRef.current = null;
        }, 15000);

        (window as any).MDS?.cmd(
          "service:CHAT_SYNC:" + normPkForSync,
          function () {},
        );

        // SMART SYNC: Trigger Status Check (Phase 1/2)
        minimaService
          .sendSyncStatusCheck(contact.publickey)
          .catch((err) => console.warn("Sync Check Failed:", err));
      } else {
        console.log(
          `Skipping duplicate history request for ${contact.publickey}`,
        );
      }

      // Timeout for auto-check
      setTimeout(async () => {
        // Fetch last seen if needed
        const lastSeenTimestamp = await minimaService.getPeerLastSeen(
          contact.publickey,
        );

        // Use callback to get current state
        setAppStatus((currentStatus) => {
          if (currentStatus === "checking") {
            // No Pong received yet. Decide fallback based on "Known" status.
            if (isKnownUser) {
              // Set last seen timestamp when offline
              // setLastSeen(lastSeenTimestamp);
              console.log("🕐 [PING] Last seen:", lastSeenTimestamp);
              return "offline";
            } else {
              return "not_found";
            }
          }
          return currentStatus;
        });
      }, 5000);
    }

    const handleNewMessage = (payload: any) => {
      // Handle Pong response
      if (payload.type === "pong") {
        // Only update if it's from the current contact
        if (payload.from === contact?.publickey) {
          console.log("✅ [PING] Pong received from current contact");
          setAppStatus("installed");
          // setLastSeen(null); // Clear last seen when user is online
          // Save that this user has the app installed
          if (contact.publickey) {
            minimaService.setAppInstalled(contact.publickey);
          }
        }
        return;
      }

      // Handle Contact Requests (Real-time Banner Update)
      // This eliminates the need for polling!
      if (
        payload.type === "contact_request" ||
        payload.type === "maxima_contact_request"
      ) {
        console.log("🔔 [CHAT] Contact request received, refreshing UI...");
        checkPending();
        loadContactRequest();
      }

      // Handle Declined Requests
      if (
        payload.type === "contact_declined" ||
        payload.type === "maxima_contact_declined"
      ) {
        console.log("🚫 [CHAT] Contact request declined, refreshing UI...");
        loadMessagesFromDB(); // Force reload to show "Declined" system message
        loadContactRequest();

        // Request fresh profile then re-evaluate blocking state
        if (contact && contact.publickey) {
          requestProfileThrottled(
            contact.currentaddress,
            contact.publickey,
            "contact-declined",
          ).finally(() => {
            console.log("🔄 [CHAT] Profile refresh attempted after decline");
            checkPending();
          });
        } else {
          checkPending();
        }
        return;
      }

      // Handle contact accepted - CRITICAL for unblocking sender's chat
      if (
        payload.type === "contact_accepted" ||
        payload.type === "maxima_contact_accepted"
      ) {
        console.log("✅ [CHAT] Contact accepted! Updating state.");

        // 1. Immediately unblock locally to feel responsive
        setBlockReason("none");
        setIsPendingOutgoing(false); // Clear pending flag
        setContactRequest(null); // Clear request banner

        // 2. Wait a moment for DB update from service worker, then verify
        setTimeout(async () => {
          console.log("🔄 [CHAT] Verifying acceptance state...");

          // Reload everything
          loadMessagesFromDB();
          loadContactRequest();

          // CRITICAL: Refresh pending state to ensure UI is correct
          checkPending();

          // Manual fallback removed for stability
          console.log(
            "✅ [CHAT] Chat fully unblocked and updated after acceptance",
          );

          console.log(
            "✅ [CHAT] Chat fully unblocked and updated after acceptance",
          );
        }, 1000); // Increased timeout significantly to allow SW to finish
        return;
      }

      // Handle Block/Unblock
      if (
        payload.type === "contact_blocked" ||
        payload.type === "contact_unblocked"
      ) {
        console.log("🔒 [CHAT] Block status changed, refreshing...");
        checkChatStatus();
        loadMessagesFromDB(); // Reload to show the system message
        return;
      }

      // Handle contact request - reload to show the incoming request
      if (payload.type === "contact_request") {
        console.log("📨 [CHAT] Received contact request");
        if (contact.publickey && myPublicKey) {
          console.log(`📨 [CHAT] From: ${contact.publickey.substring(0, 10)}`);

          // Trust the Service Worker to satisfy the insert
          setTimeout(() => {
            loadMessagesFromDB();
            loadContactRequest(); // Refresh banner
          }, 500);
        }
        return;
      }

      // NOTE: contact_declined is already handled above (with maxima_contact_declined)

      // Suppress reloads for read/delivery receipts (checkmarks)
      // The Service Worker has already updated the DB.
      if (
        payload.type === "read_receipt" ||
        payload.type === "delivery_receipt"
      ) {
        console.log(
          `ℹ️ [CHAT] Receipt received (${payload.type}), suppressing reload.`,
        );
        return;
      }

      // Re-check permissions when peer info updates
      if (
        payload.type === "peer_discovered" ||
        payload.type === "profile_response"
      ) {
        console.log(
          `🔄 [CHAT] ${payload.type} received, re-checking permissions...`,
        );
        checkPending();
        return;
      }

      // SMART SYNC: Handle Gap Report
      if (payload.type === "sync_status_report") {
        console.log(
          `📊 [CHAT] Sync Report: Missing ${payload.missing_count} messages. Triggering fetch...`,
        );
        setIsSyncing(true);
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          setIsSyncing(false);
          syncTimeoutRef.current = null;
        }, 15000);

        (window as any).MDS?.cmd(
          "service:CHAT_SYNC:" + contact.publickey.toUpperCase(),
          function () {},
        );
        return;
      }

      // Skip loading for control types
      const controlTypes = [
        "ping",
        "pong",
        "sync_status_check",
        "profile_request",
        "profile_response",
        "chat_history_request",
        "chat_history_response",
      ];
      if (controlTypes.includes(payload.type)) {
        return;
      }

      // Event-driven UI: Handle full message payload from SW
      if (payload.type === "NEW_CHAT_MESSAGE") {
        const msg = payload.message;

        // Verify it belongs to this chat (Case-insensitive Hex comparison)
        const isTarget =
          msg.publickey &&
          (msg.publickey.toUpperCase() === address.toUpperCase() ||
            msg.publickey === address);

        if (isTarget) {
          // Skip unverified token/charm — the SW will verify the blockchain tx and
          // re-notify via TOKEN_INCOMING_CONFIRMED once confirmed. Showing it now
          // would display raw JSON and bypass the verification gate.
          if (msg.state === "unverified") {
            console.log("⏳ [CHAT] Skipping unverified token/charm — waiting for SW verification.");
            return;
          }

          console.log("🚀 [CHAT] Receiving message via EVENT payload:", msg);

          // Parse and append to state immediately
          const newParsed: ParsedMessage = {
            id: msg.id,
            text: msg.message,
            fromMe: msg.username === "Me",
            charm: msg.type === "charm" ? { id: msg.message } : null,
            amount: msg.amount || null,
            timestamp: Number(msg.date) || Date.now(),
            status: msg.state,
            type: msg.type,
            filedata: msg.filedata,
            sender_seq: msg.sender_seq,
            customid: msg.customid,
            originalTimestamp: msg.original_timestamp,
            forwarded: msg.forwarded,
          };

          setMessages((prev) => deduplicateMessages([...prev, newParsed]));

          // Mark as read in DB and trigger checkmarks
          if (address && !address.startsWith("Mx")) {
            minimaService.sendReadReceipt(address);
            minimaService.markChatAsOpened(address);
          }
          return;
        }
      }

      // Handle message deletion
      if (payload.type === "CHAT_MESSAGE_DELETED") {
        const deletedCustomId = payload.customid;
        if (deletedCustomId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.customid === deletedCustomId ? { ...m, deleted: true } : m,
            ),
          );
        }
        return;
      }

      // Handle incoming token/charm confirmation from SW
      if (payload.type === "TOKEN_INCOMING_CONFIRMED") {
        console.log(`💰 [CHAT] Incoming token confirmed (msg ID ${payload.msgId}). Reloading...`);
        loadMessagesFromDB();
        return;
      }

      // Handle Sync Completion and Generic List Updates from SW
      if (
        payload.type === "CHAT_LIST_UPDATE" ||
        payload.type === "history_sync"
      ) {
        console.log(
          `🔄 [CHAT] Received ${payload.type} from SW. Refreshing UI...`,
        );
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
          syncTimeoutRef.current = null;
        }
        setIsSyncing(false);
        // NO DELAY for CHAT_LIST_UPDATE because SW sends it AFTER DB insert
        loadMessagesFromDB();
        return;
      }

      // Only reload for actual new messages (Legacy Fallback)
      const contentTypes = [
        "text",
        "image",
        "video",
        "audio",
        "file",
        "charm",
        "token",
        "gif",
        "sticker",
        "voice",
      ];

      if (contentTypes.includes(payload.type)) {
        console.log(
          `📨 [CHAT] New ${payload.type} message event. Reloading with race-condition guard (200ms)...`,
        );
        // Add 200ms delay to handle race condition with SW insert
        loadMessagesFromDB(200).then(() => {
          if (contact && contact.publickey) {
            minimaService.sendReadReceipt(contact.publickey);
            minimaService.markChatAsOpened(contact.publickey);
          }
        });
        return;
      }
    };

    // Send read receipt immediately when entering the chat
    if (contact.publickey) {
      minimaService.sendReadReceipt(contact.publickey);
    }

    // Subscribe to new messages
    minimaService.onNewMessage(handleNewMessage);

    // Reload messages when a pending transaction is accepted/denied.
    const handleBalanceUpdate = () => {
      console.log(
        "💰 [CHAT] Balance update — reloading messages for pending tx state change",
      );
      loadMessagesFromDB();
    };
    window.addEventListener("minima_balance_update", handleBalanceUpdate);

    // Cleanup: remove listener when component unmounts or dependencies change
    return () => {
      minimaService.removeNewMessageCallback(handleNewMessage);
      window.removeEventListener("minima_balance_update", handleBalanceUpdate);
    };
  }, [contact?.publickey, address, navigate, sendPingThrottled]); // Re-run only when peer changes

  // Listen for peer_updated events from service worker (when beacon updates allowNonContactChats)
  useEffect(() => {
    const handlePeerUpdated = (event: Event) => {
      const customEvent = event as CustomEvent;
      const peer = customEvent.detail;

      // If it's the current contact, refresh state
      if (peer?.pubkey === contact?.publickey) {
        console.log(
          "🔄 [CHAT] Peer updated (beacon received), refreshing state...",
        );
        checkPending();
      }
    };

    window.addEventListener("peer_updated", handlePeerUpdated);

    return () => {
      window.removeEventListener("peer_updated", handlePeerUpdated);
    };
  }, [contact?.publickey, checkPending]);

  /* ----------------------------------------------------------------------------
      AUTOSCROLL
  ---------------------------------------------------------------------------- */
  const isInitialLoad = useRef(true);

  // Reset initial load state when address changes
  useEffect(() => {
    isInitialLoad.current = true;
  }, [address]);

  const scrollToBottom = () => {
    if (isInitialLoad.current) {
      // Use requestAnimationFrame to ensure DOM is updated before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop =
              scrollContainerRef.current.scrollHeight;
          }
        });
      });
      isInitialLoad.current = false;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };
  useEffect(scrollToBottom, [messages]);

  /* ----------------------------------------------------------------------------
      SEND TEXT MESSAGE
  ---------------------------------------------------------------------------- */

  const handleDeleteMessage = async (customid: string) => {
    if (!contact?.publickey) return;
    // Optimistic update
    setMessages((prev) =>
      prev.map((m) => (m.customid === customid ? { ...m, deleted: true } : m)),
    );
    try {
      await chatService.deleteChatMessage(customid, contact.publickey);
      await sendChatDeleteMessage(contact.publickey, customid);
    } catch (err) {
      console.error("❌ [CHAT] Delete message failed:", err);
      // Revert on error
      setMessages((prev) =>
        prev.map((m) =>
          m.customid === customid ? { ...m, deleted: false } : m,
        ),
      );
    }
  };

  const handleSendMessage = async () => {
    if (isActionRestricted) {
      console.warn("⚠️ [CHAT] Send blocked: Handshake or Protocol restriction active");
      return;
    }

    // Guard to prevent concurrent sends
    if (isSendingRef.current) return;

    if (blockReason !== "none") return; // Cannot send while blocked
    if (!input.trim()) return;
    if (!contact?.currentaddress && !contact?.publickey) {
      console.error(
        "[Send] Cannot send: no Maxima address or Public Key for contact",
      );
      return;
    }

    isSendingRef.current = true;
    try {
      // Use sender's name (from context) for payload, recipient's name for roomname
      const senderName = userName || "Me";
      const recipientName = contact?.extradata?.name || "Unknown";
      const messageToSend = input; // Capture input for async call

      let targetApp = "metachain";

      // Handle "Dapp not detected" case
      if (appStatus === "not_found") {
        const proceed = confirm(
          "⚠️ The recipient doesn't seem to have MetaChain installed.\n\nDo you want to send this as a standard Maxima message (MaxSolo)?",
        );
        if (!proceed) {
          isSendingRef.current = false;
          return;
        }
        targetApp = "maxima";
      }

      const timestamp = Date.now();
      // Capture replyTo before clearing state
      const currentReplyTo = replyingTo;
      const newMsg: ParsedMessage = {
        text: input,
        fromMe: true,
        charm: null,
        amount: null,
        timestamp,
        status: "sent",
        replyTo: currentReplyTo,
      };
      setMessages((prev) => [...prev, newMsg]);

      // OPTIMISTIC UPDATE: Clear input immediately to make UI feel responsive
      setInput("");
      setReplyingTo(null);
      // Release send lock immediately after optimistic UI update so user can type/send next message.
      // seqQueues in database.service.ts serializes concurrent sends safely.
      isSendingRef.current = false;

      // FIX: Use publickey (0x) for reliable DB storage, fallback to currentaddress for network
      // This ensures messages are always stored with the same key format as the URL param
      // FIX: Pass timestamp to prevent flicker (optimistic UI vs DB re-fetch mismatch)
      await minimaService.sendMessage(
        contact.publickey || contact.currentaddress,
        senderName,
        messageToSend,
        "text",
        "",
        0,
        timestamp,
        recipientName,
        targetApp,
        true,
        undefined,
        undefined,
        false,
        currentReplyTo ?? undefined,
      );
      await loadMessagesFromDB();
    } catch (err) {
      console.error("[Send] Error sending message:", err);
      // Optional: Restore input on failure? Or just show toast.
      // setInput(messageToSend); // Only restore if critical failure
    } finally {
      isSendingRef.current = false;
    }
  };

  /* ----------------------------------------------------------------------------
      HANDLE IMAGE ATTACHMENT
  ---------------------------------------------------------------------------- */
  const handleImageSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // 1. Validate File Size (Max 5MB uncompressed)
    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) {
      alert(`Aquest fitxer és massa gran. (Max: ${MAX_MB}MB)`);
      return;
    }

    // 2. Validate File Type
    if (!file.type.startsWith("image/")) {
      alert("Aquest fitxer no és una imatge vàlida.");
      return;
    }

    if (blockReason !== "none" || isBlocked || blockedByThem) {
      alert(
        "No pots enviar imatges. Aquest xat està bloquejat o pendent d'aprovació.",
      );
      return;
    }

    if (!contact?.currentaddress && !contact?.publickey) {
      console.error(
        "[Send Image] Cannot send: no Maxima address or Public Key for contact",
      );
      return;
    }

    const senderName = userName || "Me";
    const recipientName = contact?.extradata?.name || "Unknown";
    let targetApp = "metachain";

    if (appStatus === "not_found") {
      const proceed = confirm(
        "⚠️ The recipient doesn't seem to have MetaChain installed.\n\nDo you want to send this as a standard Maxima message (MaxSolo)?",
      );
      if (!proceed) return;
      targetApp = "maxima";
    }

    try {
      // Show optimistic pending image message? (Optional, but good UX)
      // For now, we will compress first. If compress takes long, a loader could be useful.

      // 3. Compress Image to fit within 64KB Maxima limit
      const compressedBase64 = await compressImage(file, 800, 800, 0.7);

      // Verify the compressed size is broadly under the ~60KB target
      // A base64 string's length * 0.75 roughly gives its size in bytes
      const approxBytes = compressedBase64.length * 0.75;
      if (approxBytes > 55000) {
        console.warn(
          `[Send Image] Compressed size is quite large (~${Math.round(approxBytes / 1024)}KB). It might fail Maxima transmission limits.`,
        );
      }

      const timestamp = Date.now();

      // Optimitistic UI Update
      const newMsg: ParsedMessage = {
        text: "",
        fromMe: true,
        charm: null,
        amount: null,
        timestamp,
        status: "sent",
        type: "image",
        customid: `img_${timestamp}`,
      };

      // Add 'filedata' to the object safely before putting in state to get the UI to render it
      (newMsg as any).filedata = compressedBase64;
      setMessages((prev) => [...prev, newMsg]);

      // 4. Send the message via Maxima using the `filedata` field
      await minimaService.sendMessage(
        contact.publickey || contact.currentaddress,
        senderName,
        "", // Send empty text for pure images, or include input if desired
        "image", // Use 'image' type
        compressedBase64, // The actual image data
        0,
        timestamp,
        recipientName,
        targetApp,
      );

      // Reload from DB to ensure it was saved correctly
      setTimeout(() => loadMessagesFromDB(), 500);
    } catch (err) {
      console.error("[Send Image] Error compressing or sending image:", err);
      alert(
        "Error processing the image. It might be too complex or an unsupported format.",
      );
    }
  };

  /* ----------------------------------------------------------------------------
      CONTACT REQUEST HANDLERS
  ---------------------------------------------------------------------------- */
  const handleAcceptRequest = async () => {
    if (!contact || !contactRequest) return;
    setProcessingRequest(true);

    try {
      console.log(
        `[Chat] Accepting contact request from ${contactRequest.FROM_PUBLICKEY}`,
      );

      // OPTIMISTIC UPDATE: Clear the request immediately from UI
      setContactRequest(null);
      setBlockReason("none");
      setProcessingRequest(false); // Stop spinner immediately

      // PERSISTENCE FIX: Update DB immediately so background polls don't revert state
      // This is crucial for offline mode
      try {
        // 1. Mark standard Contact Request as accepted (Case insensitive)
        await contactRequestsService.updateLocalRequestStatus(
          contactRequest.FROM_PUBLICKEY,
          "accepted",
        );

        // 2. ALSO clear any matching "Maxima Contact Request" (New protocol)
        // If we have a pending Maxima request from the same person, accepting the chat request
        // should strictly imply accepting the contact link too.
        const safePk = contactRequest.FROM_PUBLICKEY.replace(/'/g, "''");
        await minimaService.runSQL(
          `UPDATE MAXIMA_CONTACT_REQUESTS SET status='accepted', updated_at=${Date.now()} WHERE UPPER(from_publickey)=UPPER('${safePk}') AND status='pending'`,
        );

        // Fix Missing Accept Message: Insert it optimistically NOW so it appears immediately
        const now = Date.now();
        const systemMsgSql = `
            INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp)
            VALUES('', UPPER('${safePk}'), 'System', 'system', 'Chat request accepted', '', 'sent', 0, ${now}, NULL, ${now})
        `;
        await minimaService.runSQL(systemMsgSql);

        console.log(
          "[Chat] ✅ Local DB state forced to 'accepted' & system message added",
        );
      } catch (dbErr) {
        console.warn("[Chat] ⚠️ Failed to force local DB update:", dbErr);
      }

      // Perform network operations in background (SKIP message insert to avoid duplicate)
      minimaService
        .acceptChatRequest(
          contactRequest.FROM_PUBLICKEY,
          contact.currentaddress,
          { skipMessageInsert: true },
        )
        .then(async () => {
          console.log("[Chat] ✅ Request accepted on network");
          await loadMessagesFromDB();
        })
        .catch((err) => {
          console.error("[Chat] ❌ Network acceptance failed (queued?):", err);
        });

      console.log("[Chat] ✅ Optimistic accept triggered");

      // Reload messages to show acceptance message (optimistic)
      await loadMessagesFromDB();
      // alert("Contact request accepted!"); // Removed as per user request
    } catch (err: any) {
      console.error("[Chat] Error accepting request:", err);
      // Only alert if it's a critical logic error, not network
      // alert(`Failed to accept request: ${err.message || err}`);
    } finally {
      // setProcessingRequest(false); // Handled above
    }
  };

  const handleDeclineRequest = async () => {
    if (!contactRequest) return;
    setProcessingRequest(true);

    try {
      console.log(
        `[Chat] Declining contact request from ${contactRequest.FROM_PUBLICKEY}`,
      );

      // OPTIMISTIC UPDATE: Clear the request immediately from UI
      setContactRequest(null);
      setIsPendingOutgoing(false);
      setProcessingRequest(false); // Stop spinner immediately

      // PERSISTENCE FIX: Force local DB update immediately
      try {
        await contactRequestsService.updateLocalRequestStatus(
          contactRequest.FROM_PUBLICKEY,
          "declined",
        );

        // Fix Missing Decline Message: Insert it optimistically NOW so it appears immediately
        const now = Date.now();
        const safePk = contactRequest.FROM_PUBLICKEY.replace(/'/g, "''");
        const systemMsgSql = `
            INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp)
            VALUES('', UPPER('${safePk}'), 'System', 'system', 'Chat request declined', '', 'sent', 0, ${now}, NULL, ${now})
         `;
        await minimaService.runSQL(systemMsgSql);

        console.log(
          "[Chat] ✅ Local DB state forced to 'declined' & system message added",
        );
      } catch (dbErr) {
        console.warn("[Chat] ⚠️ Failed to force local DB update:", dbErr);
      }

      // Perform network operations in background (SKIP message insert to avoid duplicate)
      minimaService
        .declineChatRequest(contactRequest.FROM_PUBLICKEY, {
          skipMessageInsert: true,
        })
        .then(async () => {
          console.log("[Chat] ✅ Request declined on network");
          await loadMessagesFromDB();
        })
        .catch((err) => {
          console.error("[Chat] ❌ Network decline failed (queued?):", err);
        });

      console.log("[Chat] ✅ Optimistic decline triggered");

      // Reload messages to show system message (optimistic)
      // await loadMessagesFromDB();  // Moved to inside promise success

      // Re-verify pending status
      checkPending();
    } catch (err: any) {
      console.error("Error declining request:", err);
      // alert(`Failed to decline request: ${err.message || err}`); // Suppress alert for optimistic flow
    } finally {
      // setProcessingRequest(false); // Handled above
    }
  };

  /* ----------------------------------------------------------------------------
      RESOLVE MINIMA ADDRESS
      Tries contact.extradata.minimaaddress first, then falls back to DISCOVERED_PEERS
  ---------------------------------------------------------------------------- */
  const resolveMinimaAddress = async (c: Contact): Promise<string | null> => {
    if (c.extradata?.minimaaddress) return c.extradata.minimaaddress;
    if (!c.publickey) return null;
    try {
      const safeKey = c.publickey.replace(/'/g, "''");
      const res: any = await new Promise((resolve) =>
        MDS.sql(
          `SELECT MINIMAADDRESS, EXTRA_DATA FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${safeKey}') LIMIT 1`,
          resolve,
        ),
      );
      if (res?.status && res.rows?.length > 0) {
        const row = res.rows[0];
        let addr: string = row.MINIMAADDRESS || "";
        // Fallback: parse EXTRA_DATA which may contain minimaaddress
        if (!addr && row.EXTRA_DATA) {
          try {
            const parsed = typeof row.EXTRA_DATA === "string"
              ? JSON.parse(row.EXTRA_DATA)
              : row.EXTRA_DATA;
            addr = parsed?.minimaaddress || "";
          } catch { /* ignore */ }
        }
        if (addr) {
          setContact((prev) =>
            prev ? { ...prev, extradata: { ...prev.extradata, minimaaddress: addr } } : prev,
          );
          return addr;
        }
      }
    } catch { /* ignore */ }
    // Address not found — request profile so next attempt works
    requestProfileThrottled(c.currentaddress, c.publickey, "resolve-address");
    return null;
  };

  /* ----------------------------------------------------------------------------
      SEND CHARM
  ---------------------------------------------------------------------------- */
  const executeSendCharm = async (charmId: string, amount: number) => {
    console.log(
      `DEBUG: executeSendCharm called. charmId=${charmId}, amount=${amount}`,
    );

    if (!contact?.publickey) return;
    if (!synced) {
      alert("Cannot send tokens while the node is offline. Please wait until you are reconnected.");
      return;
    }
    const resolvedCharmAddr = await resolveMinimaAddress(contact);
    if (!resolvedCharmAddr) {
      alert("Wallet address not yet available. A profile sync has been requested — please try again in a few seconds.");
      return;
    }
    // Use sender's name (from context) for payload, recipient's name for roomname
    const senderName = userName || "Me";
    const recipientName = contact?.extradata?.name || "Unknown";

    // Optimistic UI update REMOVED - we will show a separate pending indicator instead
    const tempTimestamp = Date.now();

    try {
      console.log(
        "⏳ [ChatPage] Sending charm (pending indicator will be shown)...",
      );

      // FIX: Ensure address is valid for Minima (remove @host if present)
      let destAddress = resolvedCharmAddr;
      if (destAddress.includes("@")) {
        destAddress = destAddress.split("@")[0];
      }

      const response = await minimaService.sendCharmWithTokens(
        contact.publickey,
        destAddress,
        senderName,
        recipientName,
        charmId,
        amount,
        tempTimestamp, // Pass timestamp as stateId for tracking
      );

      // Reload messages from DB to get the inserted message (it will be pending or sent)
      await loadMessagesFromDB();

      // Only update to 'sent' if NOT pending
      if (!response || !response.pending) {
        console.log(
          "✅ [ChatPage] Charm sent successfully (not pending). Updating status to 'sent'.",
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.timestamp === tempTimestamp
              ? { ...m, status: "sent" as const }
              : m,
          ),
        );
      } else {
        console.log(
          "⚠️ [ChatPage] Charm command is pending (Read Mode). Keeping status as 'pending'.",
        );

        // Pending message tracking is now handled by transaction polling service
      }
    } catch (err) {
      console.error("Failed to send charm:", err);
      // Reload to ensure consistent state
      loadMessagesFromDB();
    }
  };

  /* ----------------------------------------------------------------------------
      SEND TOKEN
  ---------------------------------------------------------------------------- */
  const executeSendToken = async (
    tokenId: string,
    amount: string,
    tokenName: string,
  ) => {
    console.log(
      `DEBUG: executeSendToken called. tokenId=${tokenId}, amount=${amount}`,
    );

    if (!contact?.publickey) return;
    if (!synced) {
      alert("Cannot send tokens while the node is offline. Please wait until you are reconnected.");
      return;
    }
    const resolvedTokenAddr = await resolveMinimaAddress(contact);
    if (!resolvedTokenAddr) {
      alert("Wallet address not yet available. A profile sync has been requested — please try again in a few seconds.");
      return;
    }

    const tempTimestamp = Date.now();
    // Use sender's name (from context), not recipient's name
    const senderName = userName || "Me";
    const tokenData = JSON.stringify({ amount, tokenName });

    // Do NOT assign sender_seq here — seq will be assigned at approval time (MDS_PENDING)
    // so that the token sorts at its correct chronological position (when approved, not when submitted)

    // Generate a stable customid so the optimistic message deduplicates correctly with the DB version
    const pendingCustomId = crypto.randomUUID();

    // Optimistic UI update - Show pending immediately
    const optimisticMsg: ParsedMessage = {
      text: "",
      fromMe: true,
      sender_seq: 0,
      charm: null,
      amount: Number(amount),
      timestamp: tempTimestamp,
      status: "pending",
      tokenAmount: { amount, tokenName },
      isToken: true,
      customid: pendingCustomId,
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    console.log(
      `⏳ [ChatPage] Added optimistic pending token message (customid: ${pendingCustomId})`,
    );

    // CRITICAL: Save optimistic message to database so UPDATE statements can find it later
    // This ensures that when MDS_PENDING updates the status to 'sent', the message exists in the DB
    // IMPORTANT: Keep valid JSON (double quotes) but escape single quotes for SQL
    const escapedTokenData = tokenData.replace(/'/g, "''");

    // Note: Include customid so deduplicateMessages can identify it via customId key (not just timeKey)
    const insertSql = `INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, customid) VALUES ('', UPPER('${contact.publickey}'), 'Me', 'token', '${escapedTokenData}', '', 'pending', ${amount}, ${tempTimestamp}, 0, '${pendingCustomId}')`;

    await new Promise<void>((resolve) => {
      MDS.sql(insertSql, async (res: any) => {
        if (res.status) {
          console.log(
            `💾 [ChatPage] Saved optimistic message to DB: ${tempTimestamp} (seq=0, will be assigned on approval)`,
          );
        } else {
          console.error(
            "❌ [ChatPage] Failed to save optimistic message to DB:",
            res,
          );
        }
        resolve();
      });
    });

    // FIX: Ensure address is valid for Minima (remove @host if present)
    let destAddress = resolvedTokenAddr;
    if (destAddress.includes("@")) {
      destAddress = destAddress.split("@")[0];
    }

    try {
      // 1. Send the token via Minima with stateId (timestamp)
      const tokenResponse = await minimaService.sendToken(
        tokenId,
        amount,
        destAddress,
        tokenName,
        tempTimestamp,
        myPublicKey,
        contact.publickey,
      );

      // Check if token send is pending
      // Minima signals pending via: response.pending=true, response.status=false with pending:true,
      // or by returning a pendinguid without a txpowid (queued for authorization)
      const isTokenPending =
        tokenResponse &&
        (tokenResponse.pending ||
          (tokenResponse.error &&
            tokenResponse.error.toString().toLowerCase().includes("pending")) ||
          (!tokenResponse.txpowid && tokenResponse.pendinguid)); // has pendinguid but no confirmed txpowid

      // Extract txpowid and pendinguid
      const txpowid = tokenResponse?.txpowid;
      const pendinguid = tokenResponse?.pendinguid;

      // Store transaction in TRANSACTIONS table if we have a txpowid OR pendinguid
      if (txpowid || pendinguid) {
        await minimaService.insertTransaction(
          txpowid,
          "token",
          contact.publickey,
          tempTimestamp,
          { tokenId, amount, tokenName, username: senderName },
          pendinguid,
        );
        console.log(
          `💾[ChatPage] Token transaction tracked: ${txpowid || "No TXPOWID"} (PendingUID: ${pendinguid || "None"})`,
        );
      } else {
        console.warn(
          `⚠️[ChatPage] Could not track token transaction: No txpowid AND no pendinguid`,
        );
      }

      if (isTokenPending) {
        console.log(
          "⚠️ [ChatPage] Token send is pending. Keeping status as 'pending' and NOT sending notification message.",
        );

        // Pending message tracking is now handled by transaction polling service

        // Reload messages from DB to show the pending message
        // Delay slightly to ensure optimistic UI has a chance to render (fix for instant confirm perception)
        setTimeout(() => loadMessagesFromDB(), 500);

        // Don't send the Maxima message yet, keep it pending
        return;
      }

      // 2. Only send a chat message confirming the transaction if token was sent successfully
      console.log(
        "✅ [ChatPage] Token sent successfully. Now sending notification message via Maxima...",
      );
      const recipientName = contact?.extradata?.name || "Unknown";

      // Assign seq now — transaction confirmed, this is the correct chronological position
      const tokenSeq = await getAndIncrementSequenceNumber(contact.publickey);

      const msgResponse = await minimaService.sendMessage(
        contact.publickey,
        senderName,
        tokenData,
        "token",
        "",
        0,
        tempTimestamp,
        recipientName,
        "metachain",
        false, // Don't save second copy (already inserted optimistically with seq=0)
        txpowid,
        tokenSeq,
      );

      // Update the optimistic message with final state, txpowid and seq
      const updateSql = `UPDATE CHAT_MESSAGES SET state='sent', txpowid='${txpowid || ""}', sender_seq=${tokenSeq} WHERE date=${tempTimestamp} AND UPPER(publickey)=UPPER('${contact.publickey}')`;
      await new Promise<void>((resolve) =>
        MDS.sql(updateSql, () => resolve()),
      );

      // Check if message send is pending (shouldn't happen if token wasn't pending, but just in case)
      const isMsgPending =
        msgResponse &&
        (msgResponse.pending ||
          (msgResponse.error &&
            msgResponse.error.toString().toLowerCase().includes("pending")));

      // Only update to 'sent' if NOT pending
      if (!isMsgPending) {
        console.log(
          "✅ [ChatPage] Token sent successfully (not pending). Updating status to 'sent'.",
        );
        // Reload messages to show the sent message
        await loadMessagesFromDB();
      } else {
        console.log(
          "⚠️ [ChatPage] Message command is pending (Read Mode). Keeping status as 'pending'.",
        );
        // Reload messages to show the pending message
        await loadMessagesFromDB();
      }
    } catch (err: any) {
      console.error("Failed to send token:", err);

      // Mark the optimistic message as failed in DB and UI
      MDS.sql(
        `UPDATE CHAT_MESSAGES SET state='failed' WHERE date=${tempTimestamp} AND UPPER(publickey)=UPPER('${contact.publickey}')`,
        () => {},
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.timestamp === tempTimestamp ? { ...m, status: "failed" as const } : m,
        ),
      );

      alert(`Send failed: ${err.message || "Unknown error"}`);
    }
  };

  /* ----------------------------------------------------------------------------
      HANDLE TRANSFER
  ---------------------------------------------------------------------------- */
  const handleTransfer = async (data: {
    tokenId: string;
    amount: string;
    tokenName: string;
    charmId?: string;
  }) => {
    // Debugging trace
    console.log(
      "📍 [TRACE 1] handleTransfer entered. Data:",
      JSON.stringify(data),
    );

    console.log(
      "📍 [TRACE 1] FULL CONTACT OBJECT:",
      JSON.stringify(contact, null, 2),
    );

    // RELAXED SAFE CHECK: Allow fallback to currentaddress (Maxima Identity)
    // Legacy contacts might not have 'minimaaddress' yet.
    if (
      !contact ||
      (!contact.extradata?.minimaaddress && !contact.currentaddress)
    ) {
      console.error(
        "📍 [TRACE ABORT] No valid address found (minimaaddress OR currentaddress).",
      );
      if (contact)
        console.error("📍 [TRACE ABORT] Contact keys:", Object.keys(contact));

      alert("This contact does not have a valid address. Cannot send value.");
      return;
    }

    if (!contact.extradata?.minimaaddress) {
      console.warn(
        "⚠️ [TRACE WARN] Missing 'minimaaddress'. Will attempt to fallback to 'currentaddress' during send.",
      );
    }

    console.log("📍 [TRACE 2] Info check passed. Closing selector...");

    // CLOSE SELECTOR FIRST (Critical for z-index/focus stability)
    setShowTransferSelector(false);

    console.log("📍 [TRACE 3] Selector close signal sent.");

    const action = async () => {
      console.log("📍 [TRACE ACTION] Executing Transfer Action (Async)...");
      if (data.charmId) {
        // Send as Charm
        await executeSendCharm(data.charmId, Number(data.amount));
      } else {
        // Send as Token
        await executeSendToken(data.tokenId, data.amount, data.tokenName);
      }
    };

    // Check for Read Mode — show warning before proceeding
    if (!writeMode) {
      console.log("DEBUG: Read Mode detected. Showing warning.");
      setPendingAction(() => action);
      setShowReadModeWarning(true);
      return;
    }

    console.log("DEBUG: Write Mode detected. Proceeding directly.");
    await action();
  };

  /* ----------------------------------------------------------------------------
      DELETE CHAT
  ---------------------------------------------------------------------------- */
  const handleDeleteChat = async () => {
    if (!contact?.publickey) return;

    try {
      // Check if there's a pending INCOMING request and auto-decline it
      const hasPendingIncoming = await minimaService.checkIncomingChatRequest(
        contact.publickey,
      );
      if (hasPendingIncoming) {
        console.log(
          "🗑️ [DELETE] Auto-declining pending incoming request before deleting chat",
        );
        await minimaService.declineChatRequest(contact.publickey);
      }
      await minimaService.deleteAllMessages(contact.publickey);
      console.log("✅ Chat deleted successfully");
      // Navigate back to chat list
      navigate({ to: "/" });
    } catch (err) {
      console.error("❌ Failed to delete chat:", err);
    }
  };

  const handleToggleArchive = async () => {
    if (!contact?.publickey) return;
    try {
      if (isArchived) {
        await minimaService.unarchiveChat(contact.publickey);
      } else {
        await minimaService.archiveChat(contact.publickey);
      }
      setIsArchived(!isArchived);
    } catch (err) {
      console.error("❌ [CHAT] Toggle archive error:", err);
    }
  };

  const handleToggleFavorite = async () => {
    if (!contact?.publickey) return;
    try {
      if (isFavorite) {
        await minimaService.unmarkChatAsFavorite(contact.publickey);
      } else {
        await minimaService.markChatAsFavorite(contact.publickey);
      }
      setIsFavorite(!isFavorite);
    } catch (err) {
      console.error("❌ [CHAT] Toggle favorite error:", err);
    }
  };

  // Chat deletion function removed as it uses handleDeleteChat directly

  /* ----------------------------------------------------------------------------
      SEND INVITATION
  ---------------------------------------------------------------------------- */
  const handleSendInvite = async () => {
    if (!contact?.publickey) return;

    // Extra safety check
    if (appStatus !== "not_found") {
      console.warn("Cannot send invite: App status is not 'not_found'");
      return;
    }

    setInviteSending(true);
    try {
      const username = userName || "A friend"; // Fallback if userName is not set in context
      await minimaService.sendInvitation(contact.publickey, username);

      // Close dialog
      setShowInviteDialog(false);

      // Optional: Show a toast or feedback?
      // For now, we just close the dialog. The user will see the message in MaxSolo if they check sent messages,
      // but here we just want to confirm the action was taken.
      alert("Invitation sent successfully via Maxima!");
    } catch (err) {
      console.error("Failed to send invitation:", err);
      alert("Failed to send invitation. Please try again.");
    } finally {
      setInviteSending(false);
    }
  };

  const isActionRestricted =
    blockReason !== "none" ||
    isBlocked ||
    blockedByThem ||
    (contactRequest !== null && !contact?.allow_non_contact_chats) ||
    (isPendingOutgoing && !contact?.allow_non_contact_chats);

  /* ----------------------------------------------------------------------------
      RENDER
  ---------------------------------------------------------------------------- */
  return (
    <div className="flex-1 w-full flex flex-col bg-[#f8fafc] dark:bg-gray-950 min-h-0 relative overflow-hidden">
      {/* ELITE STICKY HEADER */}
      <div className="sticky top-0 z-[70] w-full pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] backdrop-blur-xl bg-white/70 dark:bg-gray-900/60 border-b border-white/20 dark:border-white/5 shadow-2xl shadow-black/5 transition-all duration-500">
        <div className="max-w-screen-xl mx-auto px-6 h-28 flex items-center gap-6">
          {/* Elite Back Navigation */}
          <button
            onClick={() => navigate({ to: "/" })}
            className="group relative w-14 h-14 flex items-center justify-center bg-gray-100 dark:bg-white/5 rounded-2xl hover:bg-primary-500 hover:text-white transition-all duration-500 active:scale-95 shadow-inner"
          >
            <div className="absolute inset-0 bg-primary-500 rounded-2xl opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500" />
            <ArrowLeft size={24} strokeWidth={3} className="relative z-10" />
          </button>

          {/* Elite Identity Registry */}
          <div
            className="flex-1 flex items-center gap-5 cursor-pointer group/id"
            onClick={() => navigate({ to: `/contact-info/${contact?.publickey || address}` })}
          >
            <div className="relative">
              {contact?.extradata?.icon ? (
                <img src={contact.extradata.icon} className="w-16 h-16 rounded-[1.5rem] object-cover border-2 border-white dark:border-gray-800 shadow-xl group-hover/id:scale-105 transition-transform duration-500" alt="" />
              ) : (
                <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center text-white text-xl font-black shadow-xl group-hover/id:scale-105 transition-transform duration-500">
                  {(contact?.extradata?.name || address).substring(0, 1).toUpperCase()}
                </div>
              )}
              <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-4 border-white dark:border-gray-900 shadow-sm animate-pulse
                ${appStatus === 'installed' ? 'bg-emerald-500' : 'bg-amber-500'}
              `} />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-3">
                <span className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight truncate">
                  {contact?.extradata?.name || "Syncing Profile..."}
                </span>
                {isFavorite && <Star size={16} className="text-amber-500 fill-amber-500" />}
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary-500 animate-ping" />
                <span className="text-[10px] font-black text-primary-500/80 uppercase tracking-[0.3em]">
                  {isSyncing ? "Syncing Grid..." : appStatus === 'installed' ? "Signal Active" : appStatus === 'checking' ? "Scanning..." : appStatus === 'not_found' ? "Link Standby" : "Link Standby"}
                </span>
              </div>
            </div>
          </div>

          {/* Elite Header Actions */}
          <div className="flex gap-4 relative pr-4">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className={`w-14 h-14 flex items-center justify-center rounded-2xl transition-all duration-500 ${showMenu ? "bg-primary-500 text-white shadow-lg shadow-primary-500/30" : "bg-gray-100 dark:bg-white/5 text-gray-500 hover:text-primary-500 shadow-inner"}`}
            >
              <MoreVertical size={24} strokeWidth={3} />
            </button>

            {showMenu && (
              <div className="absolute top-20 right-0 w-[260px] backdrop-blur-2xl bg-white/95 dark:bg-gray-900/95 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-white/20 dark:border-white/5 py-4 overflow-hidden z-[100] animate-in slide-in-from-top-4 fade-in duration-500">
                <div className="px-8 py-4 mb-2 border-b border-gray-100 dark:border-white/5">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em]">Grid Registry</span>
                </div>

                {[
                  { label: "Peer Profile", icon: Info, action: () => navigate({ to: `/contact-info/${contact?.publickey || address}` }), color: "text-blue-500", bg: "bg-blue-500/10", fill: false },
                  { label: "Security", icon: SlidersHorizontal, action: () => navigate({ to: `/contact-info/${contact?.publickey || address}`, search: { returnTo: `/chat/${address}`, tab: "settings" } }), color: "text-primary-500", bg: "bg-primary-500/10", fill: false },
                  { label: isFavorite ? "Dismiss Star" : "Star Registry", icon: Star, action: handleToggleFavorite, color: "text-amber-500", bg: "bg-amber-500/10", fill: isFavorite },
                  { label: isArchived ? "Restore Vault" : "Archive Vault", icon: Archive, action: handleToggleArchive, color: "text-orange-500", bg: "bg-orange-500/10", fill: isArchived },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    className="w-full flex items-center justify-between px-8 py-5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group/item"
                    onClick={() => { setShowMenu(false); item.action(); }}
                  >
                    <div className="flex items-center gap-4 text-left">
                      <div className={`w-11 h-11 ${item.bg} ${item.color} rounded-xl flex items-center justify-center group-hover/item:scale-110 transition-transform duration-500 shadow-sm flex-shrink-0`}>
                        <item.icon size={20} strokeWidth={3} fill={item.fill ? "currentColor" : "none"} />
                      </div>
                      <span className="text-[11px] font-black text-gray-700 dark:text-gray-200 uppercase tracking-widest leading-tight">{item.label}</span>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 dark:text-gray-600 opacity-0 group-hover/item:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                  </button>
                ))}

                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-white/5">
                  <button
                    className="w-full flex items-center gap-4 px-8 py-5 text-red-500 hover:bg-red-500/10 transition-colors group/del"
                    onClick={() => { setShowMenu(false); setShowDeleteConfirm(true); }}
                  >
                    <div className="w-11 h-11 bg-red-500/10 rounded-xl flex items-center justify-center group-hover/del:bg-red-500 group-hover/del:text-white transition-all duration-500 flex-shrink-0">
                      <Trash2 size={20} strokeWidth={3} />
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-widest text-left leading-tight">Expunge Registry</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* REGISTRY SCROLL VIEW */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto flex flex-col px-4 pt-6 pb-32 relative transition-colors"
      >
        {/* Pattern Overlays */}
        {chatBackground === "dots" && (
          <div className="fixed inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.05]" 
               style={{ backgroundImage: "radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)", backgroundSize: "24px 24px" }} />
        )}
        {chatBackground === "grid" && (
          <div className="fixed inset-0 pointer-events-none opacity-[0.02] dark:opacity-[0.04]" 
               style={{ backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        )}
        {chatBackground === "diagonal" && (
          <div className="fixed inset-0 pointer-events-none opacity-[0.02] dark:opacity-[0.04]" 
               style={{ backgroundImage: "repeating-linear-gradient(45deg, currentColor, currentColor 1px, transparent 1px, transparent 10px)", backgroundSize: "14px 14px" }} />
        )}
        {chatBackground === "soft-gradient" && (
          <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary-500/[0.03] via-transparent to-primary-500/[0.08] dark:from-primary-500/[0.08] dark:via-transparent dark:to-primary-500/[0.03]" />
            <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary-500/[0.06] blur-[120px] animate-pulse" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary-500/[0.06] blur-[120px] animate-pulse" style={{ animationDelay: '2s' }} />
          </div>
        )}

        {/* Elite Forward Success Banner */}
        {showForwardSuccess && (
          <div className="sticky top-4 z-40 mx-4 pointer-events-none mb-6">
            <div className="bg-emerald-500/90 dark:bg-emerald-900/60 backdrop-blur-2xl border border-white/20 dark:border-emerald-500/20 rounded-[2rem] shadow-[0_10px_40px_rgba(16,185,129,0.2)] p-6 animate-in fade-in slide-in-from-top-4 duration-500 flex items-center gap-6 pointer-events-auto">
              <div className="w-14 h-14 bg-white/20 dark:bg-emerald-500/20 rounded-2xl flex items-center justify-center shadow-inner">
                <CheckCircle2 size={28} className="text-white dark:text-emerald-400 animate-bounce" />
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-black text-white/60 dark:text-emerald-400/60 uppercase tracking-[0.3em]">Network confirmed</p>
                <p className="text-lg font-black text-white dark:text-emerald-100 uppercase tracking-tight leading-none mt-1">Message Forwarded</p>
              </div>
            </div>
          </div>
        )}

        {/* Elite Contact Request Banner - Shifted to avoid overlap */}
        {(contactRequest || blockReason === "incoming_restricted") && (
          <div className="sticky top-6 z-40 mx-4 mb-12">
            <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-3xl border border-white/20 dark:border-white/5 rounded-[3rem] shadow-[0_30px_70px_rgba(0,0,0,0.3)] p-8 animate-in fade-in slide-in-from-top-6 duration-700 ring-1 ring-black/5 dark:ring-white/5">
              <div className="flex flex-col lg:flex-row gap-8 items-start">
                <div className="w-20 h-20 bg-primary-500/10 rounded-[1.75rem] flex items-center justify-center text-primary-500 shadow-inner group-hover:scale-110 transition-transform duration-700 flex-shrink-0">
                  <ShieldCheck size={40} strokeWidth={2.5} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <span className="text-[10px] font-black text-primary-500 uppercase tracking-[0.4em] bg-primary-500/10 px-3 py-1 rounded-full">Grid handshake</span>
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em]">{(contactRequest as any)?.type === "maxima" ? "Maxima layer" : "Chat protocol"}</span>
                  </div>
                  
                  <h3 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight leading-none mb-3">
                    {contact?.extradata?.name || contactRequest?.FROM_NAME || "Peer Registry"}
                  </h3>
                  
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium leading-relaxed max-w-md">
                    {(contactRequest as any)?.type === "maxima"
                      ? "A new peer is requesting Maxima contact authorization to establish a secure synchronization tunnel."
                      : "Establishing a direct communication channel. Authorization is required to verify the grid identity."}
                  </p>
                </div>

                <div className="flex flex-col gap-3 justify-center w-full lg:w-auto lg:min-w-[280px]">
                  <button
                    onClick={async () => {
                      if ((contactRequest as any)?.type === "maxima" || (!contactRequest && blockReason === "incoming_restricted")) {
                        if (contact?.publickey) {
                          try {
                            setContactRequest(null);
                            setBlockReason("none");
                            const validPk = contact.publickey.replace(/'/g, "''");
                            const now = Date.now();
                            await minimaService.runSQL(`UPDATE MAXIMA_CONTACT_REQUESTS SET status='accepted', updated_at=${now} WHERE UPPER(from_publickey)=UPPER('${validPk}') AND status='pending'`);
                            await minimaService.runSQL(`INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp) VALUES('', UPPER('${validPk}'), 'System', 'system', 'Maxima contact accepted', '', 'sent', 0, ${now}, NULL, ${now})`);
                            minimaService.acceptMaximaContactRequest(contact.publickey, contact.currentaddress || "", { skipMessageInsert: true })
                                         .then(() => { if (typeof loadMessagesFromDB !== 'undefined') loadMessagesFromDB(); })
                                         .catch(() => {});
                            if (typeof checkPending !== 'undefined') checkPending();
                            if (typeof loadMessagesFromDB !== 'undefined') loadMessagesFromDB();
                          } catch (e) { console.error(e); }
                        }
                      } else { if (typeof handleAcceptRequest !== 'undefined') handleAcceptRequest(); }
                    }}
                    disabled={processingRequest}
                    className="w-full py-5 px-6 bg-primary-500 hover:bg-primary-600 text-white rounded-[1.5rem] font-black text-[10px] sm:text-xs uppercase tracking-[0.1em] sm:tracking-[0.15em] shadow-xl shadow-primary-500/30 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {processingRequest 
                      ? "Authorizing..." 
                      : (contactRequest as any)?.type === "maxima" 
                        ? "Authorize Maxima Connection" 
                        : "Accept Chat Handshake"}
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={async () => {
                        if ((contactRequest as any)?.type === "maxima") {
                          console.log("[UI] Declining Maxima Request (Optimistic)");
                          if (contact && contact.publickey) {
                            // OPTIMISTIC UPDATE
                            setContactRequest(null);

                            try {
                              // Force local DB update immediately — this prevents CHAT_LIST_UPDATE
                              // from finding the row still 'pending' and re-showing the banner
                              const validPk = contact.publickey.replace(/'/g, "''");
                              const now = Date.now();

                              await minimaService.runSQL(
                                `UPDATE MAXIMA_CONTACT_REQUESTS SET status='declined', updated_at=${now} WHERE UPPER(from_publickey)=UPPER('${validPk}') AND status='pending'`,
                              );

                              // Insert system message optimistically
                              const systemMsgSql = `
                                INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp)
                                VALUES('', '${validPk}', 'System', 'system', 'Maxima contact declined', '', 'sent', 0, ${now}, NULL, ${now})
                              `;
                              await minimaService.runSQL(systemMsgSql);

                              console.log("[Chat] ✅ Forced local Maxima request update to 'declined'");

                              // Background network call (SKIP message insert)
                              minimaService
                                .declineMaximaContactRequest(
                                  contact.publickey,
                                  contact.currentaddress || "",
                                  { skipMessageInsert: true },
                                )
                                .then(() => {
                                  console.log("[Chat] ✅ Maxima request declined on network");
                                  loadMessagesFromDB();
                                })
                                .catch((e) =>
                                  console.error("Error declining Maxima request on network:", e),
                                );

                              checkPending();
                            } catch (e) {
                              console.error("Error updating local Maxima request:", e);
                            }
                          }
                        } else {
                          if (typeof handleDeclineRequest !== 'undefined') handleDeclineRequest();
                        }
                      }}
                      disabled={processingRequest}
                      className="flex-1 py-5 px-6 bg-gray-100 dark:bg-white/5 hover:bg-rose-500/10 hover:text-rose-500 text-gray-500 dark:text-gray-400 rounded-[1.5rem] font-black text-[10px] sm:text-xs uppercase tracking-[0.1em] sm:tracking-[0.15em] transition-all active:scale-95 disabled:opacity-50"
                    >
                      Decline Request
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pending Outgoing Request Banner */}
        {isPendingOutgoing && !contactRequest && (
          <div className="sticky top-6 z-40 mx-4 mb-4">
             <div className="bg-primary-500/90 dark:bg-primary-600/40 backdrop-blur-3xl border border-primary-500/20 rounded-[2rem] p-6 flex items-center gap-6 shadow-2xl shadow-primary-500/20">
                <div className="w-12 h-12 bg-white dark:bg-white/10 text-primary-500 rounded-xl flex items-center justify-center shadow-lg">
                   <Zap size={24} className="animate-pulse" />
                </div>
                <div>
                   <p className="text-[10px] font-black text-white/60 dark:text-primary-400 uppercase tracking-widest leading-none mb-1">
                     Handshake pending
                   </p>
                   <p className="text-sm font-black text-white uppercase tracking-tight leading-none">
                     Waiting for authorization
                   </p>
                </div>
             </div>
          </div>
        )}

        {/* Pending Transactions Indicator */}
        {messages.filter(
          (m) => m.status === "pending" && (m.isCharm || m.isToken),
        ).length > 0 && (
          <div className="sticky top-2 z-20 mb-4 mx-2 mt-2">
            {messages
              .filter((m) => m.status === "pending" && (m.isCharm || m.isToken))
              .map((msg) => (
                <div
                  key={msg.timestamp}
                  className="bg-white/60 dark:bg-gray-950/40 backdrop-blur-3xl border border-white/20 dark:border-white/5 rounded-[2rem] p-5 mb-3 animate-in fade-in slide-in-from-top-4 duration-1000 shadow-xl overflow-hidden relative group"
                >
                  <div className="absolute inset-0 bg-gradient-to-tr from-primary-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
                  <div className="flex items-center gap-5 relative z-10">
                    <div className="flex-shrink-0 w-14 h-14 bg-primary-500/10 rounded-[1.25rem] flex items-center justify-center text-primary-500 shadow-inner group-hover:scale-110 transition-transform duration-700">
                      <Activity size={28} strokeWidth={2.5} className="animate-pulse" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
                        <span className="text-[9px] font-black text-primary-500 uppercase tracking-[0.4em]">Grid Transmission</span>
                      </div>
                      <p className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight leading-none mb-1">
                        Sending{" "}
                        {msg.tokenAmount ? (
                          <span className="text-primary-500">
                            {msg.tokenAmount.amount} {msg.tokenAmount.tokenName}
                          </span>
                        ) : (
                          <span className="text-primary-500">
                            {msg.amount} MINIMA
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 tracking-wide">
                        Awaiting blockchain confirmation...
                      </p>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Empty State Registry Security */}
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-20">
             <div className="bg-white dark:bg-gray-900/50 backdrop-blur-xl rounded-[2.5rem] border border-gray-100 dark:border-white/5 p-10 max-w-sm text-center shadow-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-b from-primary-500/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                <div className="w-24 h-24 bg-primary-500/10 rounded-[2rem] flex items-center justify-center text-primary-500 mb-8 mx-auto shadow-inner group-hover:scale-110 transition-transform duration-700">
                  <ShieldCheck size={48} strokeWidth={2.5} />
                </div>
                <h3 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-4 leading-none">Security Grid Active</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium leading-relaxed">Signal history is end-to-end encrypted on the Minima Layer. Absolute privacy is maintained within this peer vault.</p>
             </div>
          </div>
        )}

        {/* Message Registry Map Loop */}
        {messages.filter(m => m.status !== 'zombie' && !(m.status === 'pending' && (m.isCharm || m.isToken))).map((msg, i, arr) => {
          const currentDate = new Date(msg.timestamp || 0).toDateString();
          const prevDate = i > 0 ? new Date(arr[i-1].timestamp || 0).toDateString() : null;
          const showDate = currentDate !== prevDate;
          const isFirstInGroup = i === 0 || arr[i-1].fromMe !== msg.fromMe || arr[i-1].isSystem || showDate;
          const isLastInGroup = i === arr.length - 1 || arr[i+1].fromMe !== msg.fromMe || arr[i+1].isSystem || (i < arr.length - 1 && new Date(arr[i+1].timestamp || 0).toDateString() !== currentDate);

          return (
            <div key={`${msg.timestamp}-${i}`} className="flex flex-col w-full relative mb-1">
              {showDate && msg.timestamp && (
                <div className="flex justify-center my-8 sticky top-4 z-10">
                   <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/80 backdrop-blur-md px-4 py-2 rounded-full border border-gray-100 dark:border-white/5 uppercase tracking-[0.3em] shadow-sm">
                      {new Date(msg.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                   </span>
                </div>
              )}
              {msg.isSystem ? (
                <div className="flex justify-center my-6 px-12">
                   <span className={`text-[10px] font-black px-4 py-2 rounded-full uppercase tracking-widest ${msg.text?.toLowerCase().includes('accepted') ? 'text-emerald-500 bg-emerald-500/10' : msg.text?.toLowerCase().includes('declined') ? 'text-red-500 bg-red-500/10' : 'text-gray-400 bg-gray-100 dark:bg-white/5'}`}>
                      {msg.text}
                   </span>
                </div>
              ) : (
                <MessageBubble
                  fromMe={msg.fromMe}
                  text={msg.text}
                  charm={msg.charm}
                  amount={msg.amount}
                  timestamp={msg.timestamp}
                  status={msg.status}
                  tokenAmount={msg.tokenAmount}
                  type={msg.type}
                  filedata={msg.filedata}
                  senderName={msg.fromMe ? userName || 'You' : contact?.extradata?.name || 'Peer'}
                  senderImage={msg.fromMe ? userAvatar : contact?.extradata?.icon}
                  forwarded={msg.forwarded}
                  currentChatId={address}
                  showName={isFirstInGroup}
                  showAvatar={isLastInGroup}
                  replyTo={msg.replyTo}
                  deleted={msg.deleted}
                  onDelete={msg.fromMe && !msg.deleted && msg.customid ? () => handleDeleteMessage(msg.customid!) : undefined}
                  onReply={blockReason === 'none' && !isBlocked && !blockedByThem ? () => {
                     setReplyingTo({ customid: msg.customid || '', text: msg.text || (msg.type === 'image' ? 'Image' : ''), senderName: msg.fromMe ? userName || 'You' : contact?.extradata?.name || 'Peer', type: msg.type || 'text' });
                     setTimeout(() => inputRef.current?.focus(), 50);
                  } : undefined}
                />
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} className="h-4" />
      </div>

      {/* ELITE REPLY BANNER */}
      {replyingTo && (
        <div className="absolute bottom-32 left-8 right-8 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur-2xl rounded-3xl border border-white/20 dark:border-white/5 p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="w-1 h-10 bg-primary-500 rounded-full" />
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-black text-primary-500 uppercase tracking-[0.3em]">Replying to {replyingTo.senderName}</p>
              <p className="text-[13px] font-black text-gray-700 dark:text-gray-200 truncate mt-1 tracking-tight">{replyingTo.text}</p>
            </div>
            <button onClick={() => setReplyingTo(null)} className="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-white/5 rounded-xl text-gray-400 hover:text-red-500 transition-colors">
              <X size={18} strokeWidth={3} />
            </button>
          </div>
        </div>
      )}

      {/* ELITE INPUT HUB */}
      <footer className="sticky bottom-0 z-[60] px-4 pb-4 md:px-8 md:pb-8 pb-[max(1rem,env(safe-area-inset-bottom))] bg-transparent pointer-events-none">
        <div className="max-w-screen-xl mx-auto pointer-events-auto">
          <div className="backdrop-blur-3xl bg-white/80 dark:bg-gray-900/80 rounded-[3rem] p-3 shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-white/20 dark:border-white/5 flex items-end gap-3 ring-1 ring-black/5 dark:ring-white/5">
            <div className="flex-1 flex items-center gap-1 min-w-0 bg-gray-100/50 dark:bg-white/5 rounded-[2.5rem] border border-white/10 dark:border-white/5 px-2 focus-within:ring-2 focus-within:ring-primary-500/30 transition-all duration-500">
              <button
                className={`w-11 h-11 shrink-0 flex items-center justify-center rounded-2xl transition-all duration-500 ${showEmojiPicker ? "bg-primary-500 text-white shadow-lg shadow-primary-500/30" : "text-gray-400 hover:bg-white dark:hover:bg-white/10"}`}
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              >
                <Radio size={22} className={showEmojiPicker ? "animate-pulse" : ""} />
              </button>

              <textarea
                ref={inputRef as any}
                rows={1}
                value={input}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (typeof handleSendMessage !== 'undefined') handleSendMessage();
                  }
                }}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
                }}
                placeholder={
                  isBlocked || blockedByThem 
                    ? "Protocol Restricted" 
                    : (contactRequest || isPendingOutgoing || blockReason !== "none") && !contact?.allow_non_contact_chats
                    ? "Handshake Required"
                    : "Message..."
                }
                disabled={isActionRestricted}
                autoCapitalize="sentences"
                className="flex-1 min-w-0 bg-transparent py-4 px-2 text-[15px] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none resize-none max-h-32 self-center normal-case"
              />

              <div className="flex items-center gap-1 shrink-0">
                <button
                  className={`w-11 h-11 flex items-center justify-center rounded-2xl transition-all duration-500 ${isActionRestricted ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:bg-white dark:hover:bg-white/10'}`}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isActionRestricted}
                >
                  <Paperclip size={22} />
                </button>
                <button
                  className={`w-11 h-11 flex items-center justify-center rounded-2xl transition-all duration-500 ${!contact || isActionRestricted ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:bg-white dark:hover:bg-white/10'}`}
                  onClick={() => setShowTransferSelector(true)}
                  disabled={!contact || isActionRestricted}
                  title="Send Value"
                >
                  <Wallet size={22} />
                </button>
              </div>
            </div>

            <button
              onClick={() => { if (typeof handleSendMessage !== 'undefined') handleSendMessage(); }}
              disabled={!input.trim() || isSendingRef.current || isActionRestricted}
              className={`w-[68px] h-[68px] flex items-center justify-center rounded-[2.25rem] transition-all duration-700 shadow-2xl relative group overflow-hidden ${input.trim() && !isActionRestricted ? "bg-primary-500 text-white scale-100 rotate-0 shadow-primary-500/30" : "bg-gray-100 dark:bg-white/5 text-gray-300 scale-90 -rotate-12 opacity-50 cursor-not-allowed"}`}
            >
              <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
              <Zap size={28} strokeWidth={2.5} className="relative z-10 group-active:scale-90 transition-transform duration-500" />
            </button>
          </div>
        </div>
      </footer>

      {/* Modals & Dialogs */}
      {showTransferSelector && (
        <TransferSelector onSend={handleTransfer} onCancel={() => setShowTransferSelector(false)} />
      )}

      {/* Read Mode Warning Dialog */}
      {showReadModeWarning && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[110] p-6 animate-in fade-in duration-500">
          <div className="bg-white/90 dark:bg-gray-950/80 backdrop-blur-3xl border border-white/20 dark:border-white/5 rounded-[3rem] shadow-[0_40px_100px_rgba(0,0,0,0.3)] w-full max-w-sm p-3 overflow-hidden animate-in zoom-in-95 duration-500">
            {/* Elite Modal Header */}
            <div className="p-8 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-orange-500/10 rounded-[1.25rem] flex items-center justify-center text-orange-500 shadow-inner">
                  <ShieldAlert size={28} strokeWidth={2.5} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-black text-orange-500 uppercase tracking-[0.4em] mb-1">Grid Protocol</span>
                  <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight leading-none">Read Mode</h3>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowReadModeWarning(false);
                  setPendingAction(null);
                }}
                className="w-12 h-12 flex items-center justify-center bg-gray-100 dark:bg-white/5 text-gray-400 hover:text-red-500 rounded-[1.25rem] transition-all duration-300 active:scale-90"
              >
                <X size={20} strokeWidth={3} />
              </button>
            </div>

            <div className="p-8 pt-4">
              <div className="mb-8 space-y-4">
                <div className="flex items-center gap-3 mb-2 px-2">
                  <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Validation Required</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed font-medium">
                  The application is currently in <span className="text-orange-500 font-black uppercase">Read Mode</span>. 
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed italic border-l-2 border-orange-500/30 pl-4 py-2 bg-gray-50 dark:bg-white/2 rounded-r-xl">
                  This transaction will be queued in "Pending Commands". You will need to manually authorize it within Minima.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={async () => {
                    setShowReadModeWarning(false);
                    if (pendingAction) {
                      await pendingAction();
                      setPendingAction(null);
                    }
                  }}
                  className="w-full py-5 px-6 bg-primary-500 text-white rounded-[1.75rem] font-black text-[10px] sm:text-xs uppercase tracking-[0.1em] sm:tracking-[0.15em] transition-all duration-500 shadow-2xl shadow-primary-500/30 relative overflow-hidden active:scale-95 hover:scale-[1.02]"
                >
                  <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-700" />
                  <div className="flex items-center justify-center gap-3 relative z-10">
                    <Zap size={18} strokeWidth={3} />
                    <span>Proceed Transmission</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowReadModeWarning(false);
                    setPendingAction(null);
                  }}
                  className="w-full py-4 bg-transparent text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95"
                >
                  Abort Transaction
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {showInviteDialog && (
        <InviteDialog
          isOpen={showInviteDialog}
          onClose={() => setShowInviteDialog(false)}
          onSend={handleSendInvite}
          isSending={inviteSending}
          contactName={contact?.extradata?.name || "this contact"}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[110] p-8 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-gray-900 rounded-[3rem] max-w-sm w-full p-10 shadow-2xl border border-white/10">
            <div className="w-20 h-20 bg-red-500/10 rounded-[2rem] flex items-center justify-center text-red-500 mb-8 mx-auto">
              <Trash2 size={40} strokeWidth={2.5} />
            </div>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight text-center mb-4">Expunge Ledger?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center leading-relaxed mb-10 font-medium">This will permanently wipe all signal history with this peer from your local grid. This operation is irreversible.</p>
            <div className="flex flex-col gap-4">
              <button onClick={handleDeleteChat} className="w-full py-5 px-6 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-black text-[10px] sm:text-xs uppercase tracking-[0.1em] sm:tracking-[0.15em] transition-all shadow-xl shadow-red-500/20">Confirm Expunge</button>
              <button onClick={() => setShowDeleteConfirm(false)} className="w-full py-5 bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 rounded-2xl font-black text-xs uppercase tracking-[0.3em] hover:bg-gray-200 transition-all">Abort</button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden inputs & picker containers */}
      <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleImageSelect} />
      
      {/* EMOJI PICKER - Render outside fixed footer to avoid clipping */}
      <div
        ref={emojiPickerRef}
        className={`fixed bottom-24 left-8 z-[120] transition-all duration-300 ${!showEmojiPicker ? "opacity-0 scale-95 pointer-events-none translate-y-4" : "opacity-100 scale-100 translate-y-0"}`}
      >
        <div className="shadow-2xl rounded-[2.5rem] overflow-hidden border border-white/20">
          <Suspense fallback={<div className="h-[400px] w-[320px] bg-white/10 backdrop-blur-3xl animate-pulse" />}>
            <EmojiPicker
              onEmojiClick={onEmojiClick}
              theme={mode === "dark" ? "dark" : "light" as any}
              width={320}
              height={400}
              skinTonesDisabled
              searchDisabled
              previewConfig={{ showPreview: false }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

