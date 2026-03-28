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
  Settings,
  Users,
  Star,
  Image as ImageIcon,
  CheckCircle2,
} from "lucide-react";
import MessageBubble from "../../components/chat/MessageBubble";
import { compressImage } from "../../utils/image";

import { minimaService } from "../../services/minima.service";
import { chatService } from "../../services/chat.service";
import * as contactRequestsService from "../../services/contact-requests.service";
import { transactionService } from "../../services/transaction.service";
import { resolveHexFromAddress } from "../../services/messaging.service";
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
  status?: "pending" | "sent" | "delivered" | "read" | "failed" | "zombie";
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
}

// Helper function to format relative time
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  return "just now";
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
      if (!isDuplicate && keys.seqKey && seenSeqKeys.has(keys.seqKey))
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
          const timeA = a.originalTimestamp && a.originalTimestamp > 0 ? a.originalTimestamp : a.timestamp || 0;
          const timeB = b.originalTimestamp && b.originalTimestamp > 0 ? b.originalTimestamp : b.timestamp || 0;
          return timeA - timeB;
        } else if (aSeqUnknown) {
          return 1; // my pending goes after confirmed
        } else if (bSeqUnknown) {
          return -1;
        } else if (a.sender_seq === 0 || b.sender_seq === 0) {
          // Received message with seq=0: fall back to timestamp
          const timeA = a.originalTimestamp && a.originalTimestamp > 0 ? a.originalTimestamp : a.timestamp || 0;
          const timeB = b.originalTimestamp && b.originalTimestamp > 0 ? b.originalTimestamp : b.timestamp || 0;
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
    // console.log("📊 [SORT DEBUG] Sorted Messages:", JSON.stringify(sorted.map(m => ({
    //   txt: m.text?.substring(0, 20),
    //   seq: m.sender_seq,
    //   orig: m.originalTimestamp,
    //   ts: m.timestamp,
    //   sys: m.isSystem
    // }))));

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
          console.log(`🔄 [CHAT] Normalizing Identity: Resolved Mx ${address} -> Hex ${hex}`);
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

  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedByThem, setBlockedByThem] = useState(false);

  // Restore Read Mode state (Parent Managed)
  const [showReadModeWarning, setShowReadModeWarning] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteSending, setInviteSending] = useState(false);
  const [showForwardSuccess, setShowForwardSuccess] = useState(false);

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

  const { loaded, writeMode, userName, userAvatar, myPublicKey } =
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

  const defaultAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

  const getAvatar = (c: Contact | null) => {
    if (!c) return defaultAvatar;

    if (c.extradata?.icon) {
      try {
        const decoded = decodeURIComponent(c.extradata.icon);
        // Check if it's a valid data URL, and not a URL ending in /0x00 (no photo)
        if (decoded.startsWith("data:image") && !decoded.includes("/0x00")) {
          return decoded;
        }
      } catch (err) {
        console.warn("⚠️ [AVATAR] Error decoding:", err);
      }
    }
    return defaultAvatar;
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
          console.log(`🔍 [CHAT] Resolving address: ${address}`);
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
          if (!c.extradata?.minimaaddress && c.publickey) {
            try {
              const safeKey = c.publickey.replace(/'/g, "''");
              const dpRes: any = await withTimeout(
                MDS.sql(`SELECT MINIMAADDRESS FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${safeKey}') LIMIT 1`),
                2000,
              ).catch(() => ({ status: false }));
              if (dpRes.status && dpRes.rows?.length > 0 && dpRes.rows[0].MINIMAADDRESS) {
                if (!c.extradata) (c as any).extradata = {};
                c.extradata = { ...c.extradata, minimaaddress: dpRes.rows[0].MINIMAADDRESS };
                console.log("✅ [CHAT] Enriched maxcontact with minimaaddress from DISCOVERED_PEERS");
              }
            } catch (e) { /* ignore */ }
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

          const discoverySql = `SELECT * FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${safeQueryKey}')`;
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

              contactToSet = {
                publickey: peer.PUBLICKEY,
                currentaddress: peer.ADDRESS || address,
                extradata: {
                  name: peer.ALIAS || "Unknown",
                  minimaaddress:
                    peer.MINIMAADDRESS || parsedExtra.minimaaddress || "",
                  icon: peer.ICON || "",
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
    console.log(`🔍 [CHAT] Outgoing pending: ${hasPendingOutgoing}`);

    // Check for INCOMING requests (they sent to me)
    const hasPendingIncoming = await minimaService.checkIncomingChatRequest(
      contact.publickey,
    );
    console.log(`🔍 [CHAT] Incoming pending: ${hasPendingIncoming}`);

    // Check if we're already Maxima contacts
    let isContact = false;
    try {
      const res = await MDS.cmd.maxcontacts();
      const contacts: any[] = (res as any)?.response?.contacts || [];
      isContact = contacts.some((c: any) => c.publickey === contact.publickey);
      console.log(`🔍 [CHAT] Is Maxima contact: ${isContact}`);
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

    // Also log MY setting for comparison/debugging
    const myAllowNonContacts = await minimaService.getChatPermission();
    console.log(`🔍 [CHAT] My allowNonContacts setting: ${myAllowNonContacts}`);

    // CRITICAL: Maxima Contact Requests take precedence over everything else
    // We check this FIRST to ensure the banner appears if a request exists.
    let hasMaximaRequest = false;
    try {
      const escapeSql = (str: string) => str.replace(/'/g, "''");
      // Relaxed query: Check for ANY pending request from this user to us
      const maximaReqSql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS
                            WHERE UPPER(from_publickey)=UPPER('${escapeSql(contact.publickey)}')
                            AND status='pending'`;

      console.log(`🔍 [CHAT DEBUG] Checking Maxima Req SQL: ${maximaReqSql}`);
      const maximaReqRes = await minimaService.runSQL(maximaReqSql);
      console.log(`🔍 [CHAT DEBUG] Maxima Req Result:`, maximaReqRes);

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
      } catch (sqlErr) {
        console.warn("Error checking accepted status:", sqlErr);
      }
    }

    // If we just sent a request, reload messages to show the system message (once only)
    if ((searchParams as any)?.requestPending && !requestPendingHandled.current) {
      requestPendingHandled.current = true;
      console.log("🔍 [CHAT] requestPending detected, reloading.");
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

      console.log("🔍 [CHAT] Loading requests...");
      console.log("🔍 [CHAT] Contact address:", contact.publickey);
      console.log("🔍 [CHAT] Chat Pending:", chatRequests.length);
      console.log("🔍 [CHAT] Maxima Pending:", maximaRequests.length);

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
        console.log("🔍 [CHAT] Found 1 pending request.");
        pendingRequest = allRequests[0];
      } else if (allRequests.length > 1) {
        console.log("🔍 [CHAT] Multiple requests, matching...");
        // Try to match by hex publickey if contact has it
        if (contact.publickey.startsWith("0x")) {
          // Check FROM_PUBLICKEY (Chat) or from_publickey (Maxima - casing might differ from SQL)
          pendingRequest = allRequests.find((r: any) => {
            const fromPk = r.FROM_PUBLICKEY || r.from_publickey;
            return fromPk === contact.publickey;
          });
        }
      }

      console.log("🔍 [CHAT] Showing request:", pendingRequest);
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
        const res: any = await MDS.sql(resolveSql);
        if (res.status && res.rows && res.rows.length > 0) {
          resolvedKey = res.rows[0].PUBLICKEY;
          console.log(`🔍 [CHAT] Quick-resolved identity for query: ${resolvedKey}`);
        }
      }

      const fetchKeys = [address, resolvedKey].filter(Boolean) as string[];
      console.log(`🔄 [CHAT] Fetching messages from DB for: ${fetchKeys.join(", ")}`);
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
              if (tx) {
                // If we find a transaction with pending or sent status, show as pending in UI
                if (tx.status === "pending" || tx.status === "sent") {
                  console.log(
                    `🔄 [CHAT-DB] Found ${tx.status.toUpperCase()} tx for message ${msg.timestamp}. Showing as 'pending' in UI.`,
                  );
                  finalStatus = "pending";
                }
              } else if (finalStatus === "pending") {
                // No pending/sent transaction found — this message is already confirmed
                finalStatus = "confirmed";
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
        // Guarded history sync inside initChat (can also be called by useEffect, this is a fallback)
        if (historyRequestedFor.current !== contact.publickey) {
          historyRequestedFor.current = contact.publickey;
          console.log(
            "🔄 [CHAT] Triggering history sync (init) with",
            contact.publickey,
          );
          setIsSyncing(true);
          // Auto-clear after 15 seconds if no response
          if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
          syncTimeoutRef.current = setTimeout(() => {
            setIsSyncing(false);
            syncTimeoutRef.current = null;
          }, 15000);

          minimaService
            .requestChatHistory(contact.publickey)
            .catch((err) =>
              console.error("❌ [CHAT] Sync request failed:", err),
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
  const [lastSeen, setLastSeen] = useState<number | null>(null);

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
      // Only request if we haven't requested for this specific key yet in this session
      if (historyRequestedFor.current !== contact.publickey) {
        historyRequestedFor.current = contact.publickey;
        console.log(
          `🔄 [CHAT] Triggering history sync for: ${contact.publickey}`,
        );
        setIsSyncing(true);
        // Auto-clear after 15 seconds if no response
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          setIsSyncing(false);
          syncTimeoutRef.current = null;
        }, 15000);

        minimaService
          .requestChatHistory(contact.publickey)
          .catch(console.error);

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
              setLastSeen(lastSeenTimestamp);
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
          setLastSeen(null); // Clear last seen when user is online
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

        minimaService
          .requestChatHistory(contact.publickey)
          .catch(console.error);
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
          console.log("🚀 [CHAT] Receiving message via EVENT payload:", msg);

          // Parse and append to state immediately
          const newParsed: ParsedMessage = {
            id: msg.id,
            text: msg.message,
            fromMe: msg.username === "Me",
            charm: msg.type === "charm" ? { id: msg.message } : null,
            amount: msg.amount || null,
            timestamp: msg.date,
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

    // Reload messages when a pending transaction is accepted/denied
    const handleBalanceUpdate = () => {
      console.log("💰 [CHAT] Balance update — reloading messages for pending tx state change");
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

  const handleSendMessage = async () => {
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
      const newMsg: ParsedMessage = {
        text: input,
        fromMe: true,
        charm: null,
        amount: null,
        timestamp,
        status: "sent",
      };
      setMessages((prev) => [...prev, newMsg]);

      // OPTIMISTIC UPDATE: Clear input immediately to make UI feel responsive
      setInput("");

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
      );
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
      SEND CHARM
  ---------------------------------------------------------------------------- */
  const executeSendCharm = async (charmId: string, amount: number) => {
    console.log(
      `DEBUG: executeSendCharm called. charmId=${charmId}, amount=${amount}`,
    );

    // STRICT CHECK: Must have Minima Address (Wallet) for Charms too?
    // Actually Charms might NOT need wallet address if amount is 0?
    // BUT sendCharmWithTokens uses 'send' command which implies amount transfer usually.
    // If amount > 0, we need address. If amount = 0, maybe not?
    // Let's stick to strict to be safe.
    if (!contact?.publickey || !contact?.extradata?.minimaaddress) {
      console.error("DEBUG: executeSendCharm ABORTED. Missing contact info:", {
        hasPublicKey: !!contact?.publickey,
        hasMinimaAddress: !!contact?.extradata?.minimaaddress,
      });
      alert(
        "Cannot send Charm: Contact hasn't shared their Wallet Address yet.",
      );
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
      let destAddress = contact.extradata.minimaaddress;
      if (destAddress && destAddress.includes("@")) {
        destAddress = destAddress.split("@")[0];
      }

      if (!contact?.publickey) throw new Error("Missing public key");

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

    // STRICT CHECK: Must have Minima Address (Wallet)
    if (!contact?.extradata?.minimaaddress || !contact?.publickey) {
      console.error(
        "DEBUG: executeSendToken ABORTED. Missing Minima Address:",
        {
          hasPublicKey: !!contact?.publickey,
          hasMinimaAddress: !!contact?.extradata?.minimaaddress,
        },
      );
      alert(
        "Cannot send funds: This contact hasn't shared their Wallet Address yet. They need to come online once to sync their profile.",
      );
      return;
    }

    const tempTimestamp = Date.now();
    // Use sender's name (from context), not recipient's name
    const senderName = userName || "Me";
    const tokenData = JSON.stringify({ amount, tokenName });

    // FIX: Get correct sequence number for this token message (it consumes a slot in the timeline)
    // ATOMIC: Get and increment in one operation to prevent race conditions
    const tokenSeq = await getAndIncrementSequenceNumber(contact.publickey);

    console.log(
      `🔢 [ChatPage] Assigning Sequence ${tokenSeq} to Token Message`,
    );

    // Optimistic UI update - Show pending immediately
    const optimisticMsg: ParsedMessage = {
      text: "",
      fromMe: true,
      sender_seq: tokenSeq, // Include sequence in UI immediately
      charm: null,
      amount: Number(amount),
      timestamp: tempTimestamp,
      status: "pending",
      tokenAmount: { amount, tokenName },
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    console.log(
      `⏳ [ChatPage] Added optimistic pending token message (Seq: ${tokenSeq})`,
    );

    // CRITICAL: Save optimistic message to database so UPDATE statements can find it later
    // This ensures that when MDS_PENDING updates the status to 'sent', the message exists in the DB
    // IMPORTANT: Keep valid JSON (double quotes) but escape single quotes for SQL
    const escapedTokenData = tokenData.replace(/'/g, "''");

    // Note: Include all required columns (roomname, type, filedata) matching chat.service.ts pattern
    const insertSql = `INSERT INTO CHAT_MESSAGES (roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq) VALUES ('', UPPER('${contact.publickey}'), 'Me', 'token', '${escapedTokenData}', '', 'pending', ${amount}, ${tempTimestamp}, ${tokenSeq})`;

    await new Promise<void>((resolve) => {
      MDS.sql(insertSql, async (res: any) => {
        if (res.status) {
          console.log(
            `💾 [ChatPage] Saved optimistic message to DB: ${tempTimestamp} (Seq: ${tokenSeq})`,
          );
          // NOTE: No need to increment here - getAndIncrementSequenceNumber already did it atomically
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
    let destAddress = contact.extradata.minimaaddress;
    if (destAddress && destAddress.includes("@")) {
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
      const isTokenPending =
        tokenResponse &&
        (tokenResponse.pending ||
          (tokenResponse.error &&
            tokenResponse.error.toString().toLowerCase().includes("pending")));

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
          { tokenId, amount, tokenName, username: senderName, seq: tokenSeq },
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

      // FIX: Use overrideSeq to send the EXACT sequence number we reserved (tokenSeq)
      // FIX: Set saveToDb=false because we ALREADY inserted the optimistic message (Seq 12)
      // This prevents duplicates (Seq 12 + Seq 13) while ensuring the peer gets the correct sequence!
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
        false, // Don't save second copy
        txpowid,
        tokenSeq, // Force sequence 12
      );

      // Now we must manually update the optimistic message with the TXPOWID and 'sent' state
      if (txpowid) {
        const updateSql = `UPDATE CHAT_MESSAGES SET state='sent', txpowid='${txpowid}' WHERE sender_seq=${tokenSeq} AND UPPER(publickey)=UPPER('${contact.publickey}')`;
        await new Promise<void>((resolve) =>
          MDS.sql(updateSql, () => resolve()),
        );
      }

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

      // FIX: Notify user of failure
      alert(`Sent failed: ${err.message || "Unknown error"}`);

      // Reload to ensure consistent state
      loadMessagesFromDB();
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
    console.log("📍 [TRACE 1] WriteMode:", writeMode);
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

    // Check for Read Mode (Parent Managed)
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

  /* ----------------------------------------------------------------------------
      RENDER
  ---------------------------------------------------------------------------- */
  return (
    <div className="flex-1 w-full flex flex-col bg-[#E5DDD5] dark:bg-gray-900 min-h-0">
      {/* HEADER - Fixed at top */}
      <div className="bg-primary-600 dark:bg-gray-800 text-white p-4 pt-[calc(1rem+env(safe-area-inset-top))] px-4 flex items-center gap-3 flex-shrink-0 shadow-sm z-30 transition-colors border-b border-primary-700 dark:border-gray-700">
        {/* Back button */}
        <button
          onClick={() => navigate({ to: "/" })}
          className="p-2 hover:bg-white/10 rounded-full transition-colors"
          title="Back"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
        </button>

        <div
          className={`flex items-center gap-3 flex-1 min-w-0 transition-opacity ${
            appStatus !== "checking" && appStatus !== "not_found"
              ? "cursor-pointer hover:opacity-90"
              : ""
          }`}
          onClick={() => {
            if (appStatus !== "checking" && appStatus !== "not_found") {
              navigate({
                to: `/contact-info/${address}`,
                search: { returnTo: `/chat/${address}` },
              });
            }
          }}
        >
          <img
            src={getAvatar(contact)}
            alt="Avatar"
            className="w-12 h-12 rounded-full object-cover bg-gray-200 dark:bg-gray-700"
          />
          <div className="flex flex-col leading-tight flex-1 min-w-0">
            <strong className="text-[16px] truncate font-semibold flex items-center gap-1.5">
              {contact?.extradata?.name || "Unknown"}
              {isFavorite && (
                <Star
                  size={14}
                  fill="#fbbf24"
                  stroke="#f59e0b"
                  className="flex-shrink-0"
                />
              )}
            </strong>
            <div className="flex items-center gap-1.5 min-w-0">
              {appStatus === "installed" ? (
                <span className="text-xs text-green-200 flex items-center gap-1 font-medium">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                  Online
                </span>
              ) : appStatus === "checking" ? (
                <span className="text-xs opacity-80 cursor-default truncate">
                  Checking status...
                </span>
              ) : appStatus === "not_found" ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-red-200 cursor-default">
                    Dapp not detected
                  </span>
                  <span className="text-xs text-gray-400">•</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowInviteDialog(true);
                    }}
                    className="text-xs text-white font-medium hover:underline transition-colors"
                  >
                    Send Invite
                  </button>
                </div>
              ) : appStatus === "offline" ? (
                <span className="text-xs opacity-80 truncate block cursor-default">
                  {lastSeen
                    ? `Last seen ${formatRelativeTime(lastSeen)}`
                    : "Offline"}
                </span>
              ) : (
                <span className="text-xs opacity-80 truncate block">
                  online
                </span>
              )}

              {isSyncing && (
                <>
                  <span className="text-gray-400 opacity-60">·</span>
                  <span className="flex items-center gap-1 text-sky-200 animate-pulse whitespace-nowrap text-[11px] font-medium leading-none">
                    <svg
                      className="w-3 h-3 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Syncing...
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex gap-4 relative">
          <button
            className="opacity-80 hover:opacity-100"
            onClick={() => setShowMenu(!showMenu)}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
              />
            </svg>
          </button>

          {/* Dropdown Menu */}
          {showMenu && (
            <div className="absolute top-10 right-0 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 min-w-[200px] z-50 animate-in slide-in-from-top-2 fade-in duration-200">
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 rounded-t-lg transition-colors text-left"
                onClick={() => {
                  setShowMenu(false);
                  setShowChatInfo(true);
                }}
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Info size={16} />
                </div>
                <span className="font-medium">Chat Info</span>
              </button>
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 transition-colors text-left border-t border-gray-100 dark:border-gray-700"
                onClick={() => {
                  setShowMenu(false);
                  navigate({
                    to: `/contact-info/${address}`,
                    search: { returnTo: `/chat/${address}` },
                  });
                }}
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Users size={16} />
                </div>
                <span className="font-medium">Profile</span>
              </button>
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 transition-colors text-left border-t border-gray-100 dark:border-gray-700"
                onClick={() => {
                  setShowMenu(false);
                  navigate({
                    to: `/contact-info/${address}`,
                    search: { returnTo: `/chat/${address}`, tab: "settings" },
                  });
                }}
              >
                <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <Settings size={16} />
                </div>
                <span className="font-medium">Actions</span>
              </button>
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 transition-colors text-left border-t border-gray-100 dark:border-gray-700"
                onClick={() => {
                  setShowMenu(false);
                  handleToggleFavorite();
                }}
              >
                <div className="w-8 h-8 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-yellow-600 dark:text-yellow-400">
                  <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
                </div>
                <span className="font-medium">
                  {isFavorite ? "Unfavorite Chat" : "Favorite Chat"}
                </span>
              </button>
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 transition-colors text-left border-t border-gray-100 dark:border-gray-700"
                onClick={() => {
                  setShowMenu(false);
                  handleToggleArchive();
                }}
              >
                <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 dark:text-orange-400">
                  <Archive size={16} />
                </div>
                <span className="font-medium">
                  {isArchived ? "Unarchive Chat" : "Archive Chat"}
                </span>
              </button>
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded-b-lg transition-colors text-left border-t border-gray-100 dark:border-gray-700"
                onClick={() => {
                  setShowMenu(false);
                  setShowDeleteConfirm(true);
                }}
              >
                <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">
                  <Trash2 size={16} />
                </div>
                <span className="font-medium">Delete Chat</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 md:bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 fade-in duration-200 border border-gray-700 md:border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-bold text-white md:text-gray-900 dark:text-white mb-2">
              Delete Chat?
            </h3>
            <p className="text-gray-300 md:text-gray-600 dark:text-gray-300 mb-6">
              This will permanently delete all messages in this conversation.
              This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 border border-gray-600 md:border-gray-300 text-gray-300 md:text-gray-700 rounded-lg hover:bg-gray-700 md:hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  handleDeleteChat();
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Invite Dialog */}
      <InviteDialog
        isOpen={showInviteDialog}
        onClose={() => setShowInviteDialog(false)}
        onSend={handleSendInvite}
        isSending={inviteSending}
        contactName={contact?.extradata?.name || "this contact"}
      />
      {/* Chat Info Dialog */}
      {/* Chat Info Dialog */}
      {showChatInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 md:bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95 fade-in duration-200 border border-gray-700 md:border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white md:text-gray-900 dark:text-white">
                Chat Statistics
              </h3>
              <button
                onClick={() => setShowChatInfo(false)}
                className="text-gray-400 md:text-gray-500 hover:text-gray-300 md:hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Total Messages */}
              <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary-500/20 rounded-full flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-primary-400 md:text-primary-600 dark:text-primary-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-300 md:text-gray-700 dark:text-gray-300">
                    Total Messages
                  </span>
                </div>
                <span className="text-lg font-bold text-white md:text-gray-900 dark:text-white">
                  {messages.length}
                </span>
              </div>

              {/* Charms Sent/Received */}
              <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
                    <span className="text-xl">✨</span>
                  </div>
                  <span className="font-medium text-gray-300 md:text-gray-700 dark:text-gray-300">
                    Charms
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-400 md:text-gray-500 dark:text-gray-400">
                    Sent: {messages.filter((m) => m.charm && m.fromMe).length} |
                    Received:{" "}
                    {messages.filter((m) => m.charm && !m.fromMe).length}
                  </div>
                </div>
              </div>

              {/* Tokens Transferred */}
              <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-green-400 md:text-green-600 dark:text-green-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-300 md:text-gray-700 dark:text-gray-300">
                    Token Transfers
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-400 md:text-gray-500 dark:text-gray-400">
                    Sent:{" "}
                    {messages.filter((m) => m.tokenAmount && m.fromMe).length} |
                    Received:{" "}
                    {messages.filter((m) => m.tokenAmount && !m.fromMe).length}
                  </div>
                </div>
              </div>

              {/* First Message Date */}
              {messages.length > 0 && messages[0].timestamp && (
                <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-500/20 rounded-full flex items-center justify-center">
                      <svg
                        className="w-5 h-5 text-orange-400 md:text-orange-600 dark:text-orange-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <span className="font-medium text-gray-300 md:text-gray-700 dark:text-gray-300">
                      First Message
                    </span>
                  </div>
                  <span className="text-sm text-gray-400 md:text-gray-600 dark:text-gray-400">
                    {new Date(messages[0].timestamp).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowChatInfo(false)}
              className="w-full mt-6 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
      {/* CHAT BODY - Scrollable */}
      <div
        ref={scrollContainerRef}
        className={`flex-1 overflow-y-auto overflow-x-hidden flex flex-col p-2 sm:p-4 pb-20
          ${
            chatBackground === "diagonal"
              ? "bg-gray-50 dark:bg-gray-900"
              : chatBackground === "default"
                ? "bg-gray-50 dark:bg-gray-900"
                : "bg-gray-50 dark:bg-gray-900" /* Base for patterns */
          }`}
      >
        {/* Pattern Overlays - Fixed positioning ensures they cover full screen even with scroll */}
        {chatBackground === "dots" && (
          <div
            className="fixed inset-0 opacity-[0.05] dark:opacity-[0.1] pointer-events-none z-0"
            style={{
              backgroundImage: `radial-gradient(#0f172a 1.5px, transparent 1.5px)`,
              backgroundSize: "24px 24px",
            }}
          />
        )}
        {chatBackground === "grid" && (
          <div
            className="fixed inset-0 opacity-[0.4] dark:opacity-[0.05] pointer-events-none z-0"
            style={{
              backgroundImage: `linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(to right, #cbd5e1 1px, transparent 1px)`,
              backgroundSize: "20px 20px",
            }}
          />
        )}
        {chatBackground === "diagonal" && (
          <div
            className="fixed inset-0 opacity-[0.4] dark:opacity-[0.1] pointer-events-none z-0"
            style={{
              backgroundImage: `repeating-linear-gradient(45deg, #e2e8f0 0px, #e2e8f0 2px, transparent 2px, transparent 12px)`,
            }}
          />
        )}

        {/* Contact Request Banner */}
        {/* Contact Request Banner (Checking logic updated to use relaxed SQL) */}
        {showForwardSuccess && (
          <div className="sticky top-0 z-40 mb-2 mx-2 mt-2 pointer-events-none">
            <div className="bg-emerald-50/95 dark:bg-emerald-900/30 backdrop-blur-sm border border-emerald-200 dark:border-emerald-800 rounded-lg shadow-sm p-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-emerald-100 dark:bg-emerald-900/50 rounded-full flex items-center justify-center">
                  <CheckCircle2
                    size={16}
                    className="text-emerald-600 dark:text-emerald-400"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100 leading-none">
                    Message Forwarded!
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1 leading-none">
                    Sent successfully
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        {(contactRequest || blockReason === "incoming_restricted") && (
          <div className="sticky top-0 z-20 mb-4 mx-2 mt-2">
            <div className="bg-primary-50/95 dark:bg-gray-800/95 backdrop-blur-sm border border-primary-200 dark:border-gray-700 rounded-lg shadow-sm p-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-primary-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                    />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                    {(contactRequest as any)?.type === "maxima"
                      ? "Maxima Contact Request"
                      : "Chat Request"}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                    <strong>
                      {contact?.extradata?.name ||
                        contactRequest?.FROM_NAME ||
                        "Unknown"}
                    </strong>{" "}
                    {(contactRequest as any)?.type === "maxima"
                      ? "wants to add you as a contact."
                      : "wants to contact you."}
                  </p>

                  {/* FORCED ACCEPT OPTION */}
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        // Logic for accepting Maxima Request
                        if (
                          (contactRequest as any)?.type === "maxima" ||
                          (!contactRequest &&
                            blockReason === "incoming_restricted")
                        ) {
                          // If contactRequest is missing but we are here, assume Maxima request found by SQL
                          console.log(
                            "[UI] Accepting Maxima Request (via Service)",
                          );
                          if (contact && contact.publickey) {
                            try {
                              // OPTIMISTIC UPDATE: Clear the request immediately from UI (BEFORE DB operations!)
                              setContactRequest(null);
                              setBlockReason("none");

                              // PERSISTENCE FIX: Force local DB update immediately to prevent banner reappearing
                              // This is crucial for offline mode or slow network
                              try {
                                const validPk = contact.publickey.replace(
                                  /'/g,
                                  "''",
                                );
                                const now = Date.now();

                                await minimaService.runSQL(
                                  `UPDATE MAXIMA_CONTACT_REQUESTS SET status='accepted', updated_at=${now} WHERE UPPER(from_publickey)=UPPER('${validPk}') AND status='pending'`,
                                );

                                // Insert system message optimistically
                                const systemMsgSql = `
                                    INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp)
                                    VALUES('', UPPER('${validPk}'), 'System', 'system', 'Maxima contact accepted', '', 'sent', 0, ${now}, NULL, ${now})
                                `;
                                await minimaService.runSQL(systemMsgSql);

                                console.log(
                                  "[Chat] ✅ Forced local Maxima request update to 'accepted' & added message",
                                );

                                // Background network call (SKIP message insert, NO AWAIT)
                                minimaService
                                  .acceptMaximaContactRequest(
                                    contact.publickey,
                                    contact.currentaddress || "",
                                    { skipMessageInsert: true },
                                  )
                                  .then(() => {
                                    console.log(
                                      "[Chat] ✅ Maxima request accepted on network",
                                    );
                                    loadMessagesFromDB();
                                  })
                                  .catch((e) =>
                                    console.error(
                                      "Error accepting Maxima request on network:",
                                      e,
                                    ),
                                  );

                                // Refresh pending state and reload messages
                                checkPending();
                                loadMessagesFromDB();
                              } catch (localErr) {
                                console.warn(
                                  "[Chat] ⚠️ Failed to force local update:",
                                  localErr,
                                );
                                alert("Failed to accept locally");
                              }
                            } catch (e) {
                              console.error(
                                "Error accepting Maxima request:",
                                e,
                              );
                              alert("Failed to accept Maxima request");
                            }
                          }
                        } else {
                          handleAcceptRequest();
                        }
                      }}
                      disabled={processingRequest}
                      className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-primary-200 dark:border-gray-600 text-primary-600 dark:text-primary-400 text-sm font-medium rounded-lg hover:bg-primary-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {processingRequest ? "Processing..." : "Accept"}
                    </button>
                    <button
                      onClick={async () => {
                        if ((contactRequest as any)?.type === "maxima") {
                          console.log(
                            "[UI] Declining Maxima Request (Optimistic)",
                          );
                          if (contact && contact.publickey) {
                            // OPTIMISTIC UPDATE
                            setContactRequest(null);

                            try {
                              // Force local DB update immediately
                              const validPk = contact.publickey.replace(
                                /'/g,
                                "''",
                              );
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

                              console.log(
                                "[Chat] ✅ Forced local Maxima request update to 'declined'",
                              );

                              // Background network call (SKIP message insert)
                              minimaService
                                .declineMaximaContactRequest(
                                  contact.publickey,
                                  contact.currentaddress || "",
                                  { skipMessageInsert: true },
                                )
                                .then(() => {
                                  console.log(
                                    "[Chat] ✅ Maxima request declined on network",
                                  );
                                  loadMessagesFromDB();
                                })
                                .catch((e) =>
                                  console.error(
                                    "Error declining Maxima request on network:",
                                    e,
                                  ),
                                );

                              checkPending();
                              // loadMessagesFromDB(); // Done in background success
                            } catch (e) {
                              console.error(
                                "Error updating local Maxima request:",
                                e,
                              );
                            }
                          }
                        } else {
                          handleDeclineRequest();
                        }
                      }}
                      disabled={processingRequest}
                      className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pending Outgoing Request Banner */}
        {isPendingOutgoing && !contactRequest && (
          <div className="sticky top-0 z-20 mb-4 mx-2 mt-2">
            <div className="bg-primary-50/95 dark:bg-gray-800/95 backdrop-blur-sm border border-primary-200 dark:border-gray-700 rounded-lg shadow-sm p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-primary-100 dark:bg-primary-900/20 rounded-full flex items-center justify-center">
                  <span className="text-xl">📨</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Chat Request Sent
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    You have sent a request to{" "}
                    <strong>{contact?.extradata?.name || "this user"}</strong>.
                    Waiting for them to accept before you can chat.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pending Transactions Indicator */}
        {messages.filter(
          (m) => m.status === "pending" && (m.isCharm || m.isToken),
        ).length > 0 && (
          <div className="sticky top-0 z-20 mb-4 mx-2 mt-2">
            {messages
              .filter((m) => m.status === "pending" && (m.isCharm || m.isToken))
              .map((msg) => (
                <div
                  key={msg.timestamp}
                  className="bg-primary-50/95 backdrop-blur-sm border border-primary-200 rounded-lg shadow-sm p-4 mb-2 animate-in fade-in slide-in-from-top-2 duration-300"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                      <svg
                        className="w-5 h-5 text-primary-600 animate-spin"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 leading-tight">
                        Sending{" "}
                        {msg.tokenAmount ? (
                          <span className="font-semibold">
                            {msg.tokenAmount.amount} {msg.tokenAmount.tokenName}
                          </span>
                        ) : (
                          <span className="font-semibold">
                            {msg.amount} MINIMA
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-primary-600 font-medium mt-0.5">
                        Waiting for confirmation...
                      </p>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center z-0">
            <div className="bg-[#FFF5C4] dark:bg-yellow-900/30 text-gray-800 dark:text-yellow-200 text-[12.5px] p-3 rounded-lg shadow-sm text-center max-w-xs leading-relaxed select-none border border-yellow-200 dark:border-yellow-800">
              <span className="text-yellow-600 mr-1">🔒</span>
              Messages are end-to-end encrypted. No one outside of this chat,
              not even MetaChain, can read or listen to them.
            </div>
          </div>
        )}

        {messages
          .filter((m) => m.status !== "pending" && m.status !== "zombie")
          .map((msg, i, arr) => {
            const currentDate = new Date(msg.timestamp || 0).toDateString();
            const prevDate =
              i > 0 ? new Date(arr[i - 1].timestamp || 0).toDateString() : null;
            const showDate = currentDate !== prevDate;
            const isFirstInGroup =
              i === 0 ||
              arr[i - 1].fromMe !== msg.fromMe ||
              arr[i - 1].isSystem ||
              showDate;
            const isLastInGroup =
              i === arr.length - 1 ||
              arr[i + 1].fromMe !== msg.fromMe ||
              arr[i + 1].isSystem ||
              (i < arr.length - 1 &&
                new Date(arr[i + 1].timestamp || 0).toDateString() !==
                  currentDate);

            return (
              <div
                key={msg.timestamp}
                className="flex flex-col w-full z-0 relative"
              >
                {showDate && msg.timestamp && (
                  <div className="flex justify-center my-3 sticky top-2 z-10">
                    <span className="text-xs text-gray-600 dark:text-gray-300 font-medium bg-[#E1F3FB] dark:bg-gray-800 border border-white/50 dark:border-gray-700 px-3 py-1.5 rounded-lg shadow-sm uppercase tracking-wide backdrop-blur-sm">
                      {new Date(msg.timestamp).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                )}
                {msg.isSystem ? (
                  // System message (centered)
                  <div className="flex justify-center my-4 px-6">
                    <span
                      className={`text-xs px-3 py-1.5 rounded-full ${
                        msg.text?.toLowerCase().includes("accepted")
                          ? "text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/40" // Accepted = Green
                          : msg.text?.toLowerCase().includes("declined") ||
                              msg.text?.toLowerCase().includes("blocked")
                            ? "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40" // Declined or Blocked = Red
                            : msg.text?.toLowerCase().includes("unblocked")
                              ? "text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-gray-700" // Unblocked = Neutral/Gray
                              : "text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800" // Default
                      }`}
                    >
                      {msg.text}
                    </span>
                  </div>
                ) : (
                  <MessageBubble
                    key={`${msg.timestamp}-${i}`}
                    fromMe={msg.fromMe}
                    text={msg.text}
                    charm={msg.charm}
                    amount={msg.amount}
                    timestamp={msg.timestamp}
                    status={msg.status}
                    tokenAmount={msg.tokenAmount}
                    type={msg.type}
                    filedata={msg.filedata}
                    senderName={
                      msg.fromMe
                        ? userName || "You"
                        : contact?.extradata?.name || "Unknown User"
                    }
                    senderImage={
                      msg.fromMe ? userAvatar : contact?.extradata?.icon
                    }
                    forwarded={msg.forwarded}
                    currentChatId={address}
                    showName={isFirstInGroup}
                    showAvatar={isLastInGroup}
                  />
                )}
              </div>
            );
          })}

        <div ref={messagesEndRef} />
      </div>
      {/* INPUT BAR - Fixed at bottom */}
      <div className="w-full max-w-full px-1.5 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] bg-white dark:bg-gray-800 flex gap-0.5 items-center flex-shrink-0 z-10 relative border-t border-gray-200 dark:border-gray-700 transition-colors box-border">
        <button
          className={`p-2 rounded-full transition-colors ${
            !contact?.extradata?.minimaaddress
              ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            if (!contact?.extradata?.minimaaddress) {
              alert(
                "Cannot send funds: This contact hasn't shared their Wallet Address yet. They need to come online once to sync their profile.",
              );
              return;
            }

            // Small timeout to prevent UI flicker/bar effect
            setTimeout(() => {
              if (inputRef.current) inputRef.current.blur(); // Dismiss keyboard
              setShowTransferSelector(true);
            }, 50);
          }}
          title={
            !contact?.extradata?.minimaaddress
              ? "Wallet unavailable - Contact needs to come online to share their address"
              : "Send Value"
          }
          disabled={!contact?.extradata?.minimaaddress}
        >
          <Wallet className="w-6 h-6" />
        </button>

        {/* Hidden File Input for Image Attachments */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          className="hidden"
          onChange={handleImageSelect}
        />

        <button
          className={`p-2 mr-1 rounded-full transition-colors ${
            blockReason !== "none" || isBlocked || blockedByThem
              ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            if (blockReason !== "none" || isBlocked || blockedByThem) return;

            // Small timeout to prevent UI flicker/bar effect
            setTimeout(() => {
              if (inputRef.current) inputRef.current.blur(); // Dismiss keyboard
              fileInputRef.current?.click();
            }, 50);
          }}
          title={
            blockReason !== "none" || isBlocked || blockedByThem
              ? "Chat unavailable - Cannot send images right now"
              : "Attach Image"
          }
          disabled={blockReason !== "none" || isBlocked || blockedByThem}
        >
          <ImageIcon className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0 bg-white dark:bg-gray-700 rounded-2xl flex items-center border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent shadow-sm px-3 py-2 transition-all cursor-text relative">
          {/* EMOJI PICKER CONTAINER */}
          <div
            ref={emojiPickerRef}
            className={`absolute bottom-full mb-2 left-0 z-50 transition-all duration-200 shadow-2xl rounded-xl border border-gray-100 dark:border-gray-700 ${!showEmojiPicker ? "opacity-0 scale-95 pointer-events-none invisible" : "opacity-100 scale-100 visible"}`}
          >
            <Suspense
              fallback={
                <div className="h-[350px] w-[300px] bg-white dark:bg-gray-800 animate-pulse rounded-xl" />
              }
            >
              <EmojiPicker
                onEmojiClick={onEmojiClick}
                theme={mode === "dark" ? ("dark" as any) : ("light" as any)}
                width={320}
                height={400}
                searchDisabled={true}
                skinTonesDisabled
                previewConfig={{ showPreview: false }}
              />
            </Suspense>
          </div>

          <button
            className={`p-1 mr-1 rounded-full transition-colors ${showEmojiPicker ? "text-primary-500" : "text-gray-400 hover:text-gray-600"}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!showEmojiPicker) {
                Keyboard.hide().catch(() => {});
              }
              setShowEmojiPicker(!showEmojiPicker);
            }}
            title="Emoji"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>

          <input
            ref={inputRef}
            onFocus={() => setShowEmojiPicker(false)}
            onKeyUp={(e) => {
              cursorPositionRef.current = e.currentTarget.selectionStart;
            }}
            onClick={(e) => {
              cursorPositionRef.current = e.currentTarget.selectionStart;
            }}
            onSelect={(e) => {
              cursorPositionRef.current = e.currentTarget.selectionStart;
            }}
            className={`flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-[15px] max-h-32 py-1 disabled:opacity-100 disabled:cursor-not-allowed`}
            type="text"
            value={input}
            disabled={isBlocked || blockedByThem || blockReason !== "none"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isSendingRef.current) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={
              isBlocked || blockedByThem
                ? "This user is blocked"
                : blockReason !== "none"
                  ? "Waiting for approval..."
                  : "Type a message..."
            }
          />
        </div>

        <button
          className={`ml-1 p-2 rounded-full transition-all duration-200 shadow-sm
            ${
              input.trim() &&
              blockReason === "none" &&
              !isBlocked &&
              !blockedByThem
                ? "bg-primary-600 text-white hover:bg-primary-700 transform hover:scale-105"
                : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-default"
            }`}
          onClick={handleSendMessage}
          disabled={
            !input.trim() ||
            blockReason !== "none" ||
            isBlocked ||
            blockedByThem
          }
        >
          <svg
            className="w-5 h-5 translate-x-0.5"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
          </svg>
        </button>

        {showTransferSelector && (
          <TransferSelector
            onSend={handleTransfer}
            onCancel={() => setShowTransferSelector(false)}
          />
        )}

        {/* Read Mode Warning Dialog */}
        {showReadModeWarning && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-sm w-full p-6 shadow-xl animate-in fade-in zoom-in duration-200 border border-gray-100 dark:border-gray-800">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center text-yellow-600 dark:text-yellow-500">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Read Mode Active
                </h3>
                <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
                  The application is in <strong>Read Mode</strong>. This
                  transaction will appear in <strong>Pending Commands</strong>{" "}
                  in Minima.
                  <br />
                  <br />
                  You will need to approve it there to complete the transfer.
                </p>
                <div className="flex gap-3 w-full mt-2">
                  <button
                    onClick={() => {
                      setShowReadModeWarning(false);
                      setPendingAction(null);
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowReadModeWarning(false);
                      if (pendingAction) pendingAction();
                      setPendingAction(null);
                    }}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-colors shadow-lg shadow-primary-500/30"
                  >
                    Proceed
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
