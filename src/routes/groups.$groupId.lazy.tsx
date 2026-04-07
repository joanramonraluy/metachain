// src/routes/groups.$groupId.tsx
import {
  useEffect,
  useRef,
  useState,
  useContext,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { appContext } from "../AppContext";
import {
  ArrowLeft,
  Trash2,
  Star,
  Archive,
  Info,
  Image as ImageIcon,
  CheckCircle2,
  MoreVertical,
  ChevronRight,
  ShieldCheck,
  History,
  Zap,
  Radio,
} from "lucide-react";
import { groupService } from "../services/group.service";
import MessageBubble from "../components/chat/MessageBubble";
import { compressImage } from "../utils/image";
import { useTheme } from "../context/ThemeContext";
import { EmojiClickData } from "emoji-picker-react";
import { MDS } from "@minima-global/mds";

// Lazy load EmojiPicker to reduce initial bundle size (~60KB)
const EmojiPicker = lazy(() => import("emoji-picker-react"));

export const Route = createLazyFileRoute("/groups/$groupId")({
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
  status?:
    | "pending"
    | "sent"
    | "delivered"
    | "read"
    | "failed"
    | "zombie"
    | "confirmed";
  tokenAmount?: { amount: string; tokenName: string }; // For token transfer messages
  senderPublicKey?: string;
  senderUsername?: string; // Added to store original username
  type?: string;
  customid?: string;
  filedata?: string;
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
  // Helper to remove duplicate messages (by timestamp + text)
  const deduplicateMessages = (msgs: ParsedMessage[]) => {
    const seen = new Set<string>();
    return msgs.filter((m) => {
      // Prioritize customid for deduplication
      if (m.customid) {
        if (seen.has(m.customid)) return false;
        seen.add(m.customid);
        return true;
      }

      // Fallback to timestamp + text for messages without customid (legacy or system)
      const typeStr = m.charm ? "charm" : m.tokenAmount ? "token" : "text";
      const key = `${m.timestamp}-${typeStr}-${m.text || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const { groupId: address } = Route.useParams();
  const navigate = useNavigate();
  const [contact, setContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [contactsMap, setContactsMap] = useState<
    Record<string, { name: string; icon?: string }>
  >({});
  const [input, setInput] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [memberCount, setMemberCount] = useState<number>(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [myRole, setMyRole] = useState<"creator" | "admin" | "member" | null>(
    null,
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [showForwardSuccess, setShowForwardSuccess] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{
    customid: string;
    text: string;
    senderName: string;
    type: string;
  } | null>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const cursorPositionRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { userName, userAvatar, myPublicKey } = useContext(appContext);
  const isLoadingMessages = useRef(false); // Flag to prevent simultaneous loads
  const { chatBackground, mode } = useTheme();

  const defaultAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

  const decodeStoredAvatar = (avatar?: string | null) => {
    if (!avatar || avatar === "0x00") return "";

    const candidates = [avatar];
    try {
      candidates.unshift(decodeURIComponent(avatar));
    } catch (err) {
      console.warn("⚠️ [GROUP-CHAT] Error decoding avatar:", err);
    }

    const validAvatar = candidates.find(
      (candidate) =>
        candidate &&
        candidate.startsWith("data:image") &&
        !candidate.includes("/0x00"),
    );

    return validAvatar || "";
  };

  /* ----------------------------------------------------------------------------
      GET GROUP INFO
  ---------------------------------------------------------------------------- */
  useEffect(() => {
    const fetchGroupData = async () => {
      try {
        const info = await groupService.getGroupInfo(address);
        // Store group info in contact state for now (we'll use the same structure)
        if (info) {
          const groupAvatar = decodeStoredAvatar((info as any).avatar);
          setContact({
            currentaddress: address,
            publickey: address,
            extradata: {
              name: (info as any).NAME,
              minimaaddress: address,
              icon: groupAvatar,
            },
          } as any);
          setIsFavorite(!!info.favorite);
          setIsArchived(!!info.archived);
          if (info.my_role) setMyRole(info.my_role);
        }

        const members = await groupService.getGroupMembers(address);
        setMemberCount(members.length);

        // Sync history
        await groupService.requestGroupHistory(address);
      } catch (err) {
        console.error("❌ [GROUP-MGMT] Error loading group:", err);
      }
    };

    fetchGroupData();
  }, [address]);

  // Handle click outside menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMenu]);

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

  // Handle click outside emoji picker
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
      const currentPos = cursorPositionRef.current ?? prev.length;
      const safePos = Math.min(Math.max(0, currentPos), prev.length);
      const textBefore = prev.substring(0, safePos);
      const textAfter = prev.substring(safePos);
      cursorPositionRef.current = safePos + data.emoji.length;
      return textBefore + data.emoji + textAfter;
    });
  }, []);

  /* ----------------------------------------------------------------------------
      LOAD MESSAGES FROM DB
  ---------------------------------------------------------------------------- */
  // Helper to load messages from DB - reusable for initial load and after sending
  const loadMessagesFromDB = useCallback(async () => {
    if (!address) return;

    // Prevent simultaneous loads
    if (isLoadingMessages.current) {
      console.log("⏭️ [GROUP-CHAT] Skipping load (active).");
      return;
    }

    isLoadingMessages.current = true;

    try {
      const rawMessages = await groupService.getGroupMessages(address);

      if (Array.isArray(rawMessages)) {
        const parsedMessages = rawMessages.map((row: any) => {
          const displayText = row.MESSAGE || row.message || "";
          const senderPk = row.SENDER_PUBLICKEY || row.sender_publickey || "";
          const type = row.TYPE || row.type || "text";

          const parsed: ParsedMessage = {
            text: displayText,
            fromMe:
              (senderPk || "").toLowerCase() ===
              (myPublicKey || "").toLowerCase(),
            charm: null,
            amount: null,
            timestamp: Number(row.DATE || row.date || 0),
            senderPublicKey: senderPk,
            senderUsername: row.SENDER_USERNAME || row.sender_username,
            type: type,
            customid: row.CUSTOMID || row.customid,
            filedata: row.FILEDATA || row.filedata,
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
            deleted: row.DELETED === 1 || row.DELETED === "1" || row.deleted === 1 || row.deleted === "1",
          };

          return parsed;
        });

        // Merge DB messages with existing pending messages
        setMessages((prev) => {
          const pending = prev.filter((m) => m.status === "pending");
          return deduplicateMessages([...parsedMessages, ...pending]);
        });

        // Extract unique sender public keys (excluding self)
        const uniqueSenders = Array.from(
          new Set(
            parsedMessages
              .filter((m) => !m.fromMe && m.senderPublicKey)
              .map((m) => m.senderPublicKey as string),
          ),
        ) as string[];

        // Fetch missing contacts
        if (uniqueSenders.length > 0) {
          fetchContactsForKeys(uniqueSenders);
        }
      }
    } catch (err) {
      console.error("❌ [GROUP-CHAT] Message load error:", err);
    } finally {
      isLoadingMessages.current = false;
    }
  }, [address, myPublicKey]);

  useEffect(() => {
    if (!address) return;

    const initChat = async () => {
      // Initial load
      await loadMessagesFromDB();

      // Mark messages as read
      await groupService.markGroupMessagesAsRead(address);
    };

    initChat();

    // Poll for new messages every 10 seconds
    const interval = setInterval(() => {
      loadMessagesFromDB();
    }, 10000);

    return () => clearInterval(interval);
  }, [address]);

  /* ----------------------------------------------------------------------------
      LISTEN FOR INCOMING MESSAGES
  ---------------------------------------------------------------------------- */
  useEffect(() => {
    if (!address) return;

    const handleNewMessage = (payload: any) => {
      if (payload.groupId === address) {
        loadMessagesFromDB();
      }
    };

    // Subscribe to new group messages
    groupService.onGroupMessage(handleNewMessage);

    // Subscribe to group data updates (like name changes or sync)
    const handleGroupUpdate = async (e: any) => {
      if (
        !e.detail ||
        !e.detail.groupId ||
        e.detail.groupId.toUpperCase() !== address.toUpperCase()
      )
        return;

      const payload = e.detail;

      // Handle message deletion
      if (payload.type === "GROUP_MESSAGE_DELETED") {
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

      // Handle Sync Events
      if (payload.type === "GROUP_SYNC_START") {
        setIsSyncing(true);
        // Auto-clear after 15 seconds if no response
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          setIsSyncing(false);
          syncTimeoutRef.current = null;
        }, 15000);
        return;
      }
      if (payload.type === "GROUP_SYNC_END") {
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
          syncTimeoutRef.current = null;
        }
        setIsSyncing(false);
        loadMessagesFromDB();
        return;
      }

      // Check if the group still exists (we may have been kicked)
      try {
        const group = await groupService.getGroupInfo(address);
        if (!group) {
          // Group was deleted — we were kicked. Navigate away.
          console.log(
            "🚫 [GROUP-CHAT] Group no longer exists, navigating away.",
          );
          navigate({ to: "/" });
          return;
        }
      } catch {
        navigate({ to: "/" });
        return;
      }

      // Group still exists — update name and status
      if (payload.name) {
        setContact((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            extradata: { ...prev.extradata, name: payload.name },
          };
        });
      }
      if (payload.avatar !== undefined) {
        const groupAvatar = decodeStoredAvatar(payload.avatar);
        setContact((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            extradata: { ...prev.extradata, icon: groupAvatar },
          };
        });
      }
      if (payload.favorite !== undefined) {
        setIsFavorite(!!payload.favorite);
      }
      if (payload.archived !== undefined) {
        setIsArchived(!!payload.archived);
      }
    };
    window.addEventListener("GROUP_UPDATE", handleGroupUpdate);

    return () => {
      groupService.removeGroupMessageCallback(handleNewMessage);
      window.removeEventListener("GROUP_UPDATE", handleGroupUpdate);
    };
  }, [address]);

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
    const messageText = input.trim();
    if (!messageText || !address) return;
    const customId = `group_${address}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const currentReplyTo = replyingTo;
    const newMsg: ParsedMessage = {
      text: messageText,
      fromMe: true,
      charm: null,
      amount: null,
      timestamp: Date.now(),
      status: "pending", // Use pending to ensure it's not replaced by DB load until synced
      senderUsername: userName,
      customid: customId,
      replyTo: currentReplyTo ?? undefined,
    };
    setMessages((prev) => [...prev, newMsg]);
    setReplyingTo(null);
    setInput("");

    try {
      await groupService.sendGroupMessage(
        address,
        messageText,
        "text",
        myPublicKey,
        userName,
        "",
        false,
        currentReplyTo ?? undefined,
      );
      // After sending, refresh to get the actual DB record (which will match by customid)
      setTimeout(() => loadMessagesFromDB(), 100);
    } catch (err) {
      console.error("❌ [GROUP-CHAT] Send error:", err);
      // Update its status to failed
      setMessages((prev) =>
        prev.map((m) =>
          m.customid === customId ? { ...m, status: "failed" as const } : m,
        ),
      );
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

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) {
      alert(`Aquest fitxer és massa gran. (Max: ${MAX_MB}MB)`);
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("Aquest fitxer no és una imatge vàlida.");
      return;
    }

    if (!address || !userName || !myPublicKey) return;

    try {
      const compressedBase64 = await compressImage(file, 800, 800, 0.7);

      const customId = `group_${address}_img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = Date.now();

      const newMsg: ParsedMessage = {
        text: "",
        fromMe: true,
        charm: null,
        amount: null,
        timestamp,
        status: "pending",
        senderUsername: userName,
        customid: customId,
        type: "image",
        filedata: compressedBase64,
      };

      setMessages((prev) => [...prev, newMsg]);

      await groupService.sendGroupMessage(
        address,
        "",
        "image",
        myPublicKey,
        userName,
        compressedBase64,
      );

      setTimeout(() => loadMessagesFromDB(), 100);
    } catch (err) {
      console.error("❌ [GROUP-CHAT] Send image error:", err);
      alert(
        "Error processing the image. It might be too complex or an unsupported format.",
      );
    }
  };

  /* ----------------------------------------------------------------------------
      DELETE GROUP
  ---------------------------------------------------------------------------- */
  const handleToggleArchive = async () => {
    if (!address) return;
    try {
      if (isArchived) {
        await groupService.unarchiveGroup(address);
      } else {
        await groupService.archiveGroup(address);
      }
      setIsArchived(!isArchived);
    } catch (err) {
      console.error("❌ [GROUP] Toggle archive error:", err);
    }
  };

  const handleToggleFavorite = async () => {
    if (!address) return;
    try {
      if (isFavorite) {
        await groupService.unfavoriteGroup(address);
      } else {
        await groupService.favoriteGroup(address);
      }
      setIsFavorite(!isFavorite);
    } catch (err) {
      console.error("❌ [GROUP] Toggle favorite error:", err);
    }
  };

  const handleDeleteGroupMessage = async (customid: string) => {
    if (!address || !myPublicKey) return;
    // Optimistic update
    setMessages((prev) =>
      prev.map((m) => (m.customid === customid ? { ...m, deleted: true } : m)),
    );
    try {
      const members = await groupService.getGroupMembers(address);
      await groupService.deleteGroupMessage(address, customid);
      await groupService.sendGroupDeleteMessage(
        address,
        customid,
        members,
        myPublicKey,
      );
    } catch (err) {
      console.error("❌ [GROUP-CHAT] Delete message failed:", err);
      setMessages((prev) =>
        prev.map((m) =>
          m.customid === customid ? { ...m, deleted: false } : m,
        ),
      );
    }
  };

  const handleDeleteChat = async () => {
    if (!address) return;

    try {
      await groupService.deleteGroup(address);
      console.log("✅ [GROUP-MGMT] Group deleted.");
      // Navigate back to chat list
      navigate({ to: "/" });
    } catch (err) {
      console.error("❌ [GROUP-MGMT] Delete failed:", err);
    }
  };

  /* ----------------------------------------------------------------------------
      FETCH CONTACTS HELPER
  ---------------------------------------------------------------------------- */
  const fetchContactsForKeys = useCallback(
    async (publicKeys: string[]) => {
      // Filter out keys we already have
      const missingKeys = publicKeys.filter((key) => !contactsMap[key]);
      if (missingKeys.length === 0) return;

      try {
        // Get all contacts from MAXIMA
        const res: any = await MDS.cmd.maxcontacts({
          params: { action: "list" },
        });
        if (res.status && res.response && res.response.contacts) {
          const newContacts: Record<string, { name: string; icon?: string }> =
            {};

          res.response.contacts.forEach((c: any) => {
            if (missingKeys.includes(c.publickey)) {
              let icon = c.extradata?.icon;
              let validIcon: string | undefined = undefined;

              if (icon && typeof icon === "string") {
                try {
                  // Handle both encoded (data%3A) and regular strings
                  const decoded = icon.startsWith("data%3A")
                    ? decodeURIComponent(icon)
                    : icon;
                  // Validate it's a real image data URI and not 0x00
                  if (
                    decoded.startsWith("data:image") &&
                    !decoded.includes("0x00")
                  ) {
                    validIcon = decoded;
                  }
                } catch (e) {
                  console.warn("⚠️ [AVATAR] Decode warning:", e);
                }
              }

              newContacts[c.publickey] = {
                name: c.extradata?.name || c.currentaddress || "Unknown",
                icon: validIcon,
              };
            }
          });

          setContactsMap((prev) => ({ ...prev, ...newContacts }));
        }
      } catch (err) {
        console.error("❌ [CONTACTS] Fetch error:", err);
      }
    },
    [contactsMap],
  );

  /* ----------------------------------------------------------------------------
      RENDER
  ---------------------------------------------------------------------------- */
  return (
    <div className="flex-1 w-full flex flex-col bg-[#f8fafc] dark:bg-gray-950 min-h-0">
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

          <div className="flex items-center gap-5 flex-1 min-w-0">
            {/* Elite Avatar Hub */}
            <div
              className="relative group cursor-pointer"
              onClick={() => navigate({ to: `/group-info/${address}` })}
            >
              <div className="absolute inset-0 bg-primary-500 rounded-[1.5rem] blur-2xl opacity-0 group-hover:opacity-30 transition-opacity duration-500" />
              <div className="w-16 h-16 rounded-[1.5rem] border-2 border-white dark:border-gray-800 bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-gray-400 dark:text-gray-500 font-black text-2xl flex-shrink-0 overflow-hidden shadow-2xl relative z-10 group-hover:scale-105 transition-transform duration-500">
                {contact?.extradata?.icon ? (
                  <img
                    src={contact.extradata.icon}
                    alt={contact?.extradata?.name || "Group"}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = defaultAvatar;
                    }}
                  />
                ) : (
                  <span className="uppercase">{contact?.extradata?.name?.charAt(0) || "G"}</span>
                )}
              </div>
              {isSyncing && (
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-primary-500 rounded-full border-4 border-white dark:border-gray-900 flex items-center justify-center z-20 animate-bounce">
                  <Zap size={10} strokeWidth={4} className="text-white" fill="currentColor" />
                </div>
              )}
            </div>

            <div className="flex flex-col text-left min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-gray-900 dark:text-white truncate uppercase tracking-tight">
                  {contact?.extradata?.name || "Group Registry"}
                </h1>
                {isFavorite && (
                  <Star
                    size={16}
                    fill="#fbbf24"
                    stroke="#fbbf24"
                    className="flex-shrink-0 drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]"
                  />
                )}
              </div>
              <div className="flex items-center gap-3 overflow-hidden">
                <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.3em] whitespace-nowrap">
                  {memberCount} MEMBERS
                </span>
                {isSyncing ? (
                  <span className="flex items-center gap-2 text-[9px] font-black text-primary-500 uppercase tracking-widest animate-pulse whitespace-nowrap">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                    Synchronizing Grid
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-[9px] font-black text-emerald-500 uppercase tracking-widest whitespace-nowrap">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                    Protocol Stable
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Elite Header Actions */}
          <div className="flex gap-4 relative pr-4" ref={menuRef}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className={`w-14 h-14 flex items-center justify-center rounded-2xl transition-all duration-500 ${showMenu ? "bg-primary-500 text-white shadow-lg shadow-primary-500/30" : "bg-gray-100 dark:bg-white/5 text-gray-500 hover:text-primary-500 shadow-inner"}`}
            >
              <MoreVertical size={24} strokeWidth={3} />
            </button>

            {showMenu && (
              <div className="absolute top-20 right-0 w-[280px] backdrop-blur-2xl bg-white/95 dark:bg-gray-900/95 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-white/20 dark:border-white/5 py-4 overflow-hidden z-[100] animate-in slide-in-from-top-4 fade-in duration-500">
                <div className="px-6 py-4 mb-2 border-b border-gray-100 dark:border-white/5">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em]">Grid Operations</span>
                </div>

                {[
                  { label: "Group Profile", icon: Info, action: () => navigate({ to: `/group-info/${address}` }), color: "text-blue-500", bg: "bg-blue-500/10" },
                  { label: "Manage Roles", icon: ShieldCheck, action: () => navigate({ to: `/group-info/${address}`, search: { returnTo: `/groups/${address}`, tab: "settings" } }), color: "text-primary-500", bg: "bg-primary-500/10" },
                  { label: isFavorite ? "Dismiss Star" : "Star Registry", icon: Star, action: handleToggleFavorite, color: "text-amber-500", bg: "bg-amber-500/10", fill: isFavorite },
                  { label: isArchived ? "Restore Vault" : "Archive Vault", icon: Archive, action: handleToggleArchive, color: "text-orange-500", bg: "bg-orange-500/10" },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    className="w-full flex items-center justify-between px-6 py-5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group/item"
                    onClick={() => { setShowMenu(false); item.action(); }}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-11 h-11 ${item.bg} ${item.color} rounded-xl flex items-center justify-center group-hover/item:scale-110 transition-transform duration-500 shadow-sm`}>
                        <item.icon size={20} strokeWidth={3} fill={item.fill ? "currentColor" : "none"} />
                      </div>
                      <span className="text-[11px] font-black text-gray-700 dark:text-gray-200 uppercase tracking-widest">{item.label}</span>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 dark:text-gray-600 opacity-0 group-hover/item:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                  </button>
                ))}

                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-white/5">
                  <button
                    className="w-full flex items-center gap-4 px-6 py-5 text-red-500 hover:bg-red-500/10 transition-colors group/del"
                    onClick={() => { setShowMenu(false); setShowDeleteConfirm(true); }}
                  >
                    <div className="w-11 h-11 bg-red-500/10 rounded-xl flex items-center justify-center group-hover/del:bg-red-500 group-hover/del:text-white transition-all duration-500">
                      <Trash2 size={20} strokeWidth={3} />
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-widest">Expunge Registry</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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
      {/* ELITE DELETE CONFIRMATION */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-6 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-gray-900 rounded-[3rem] shadow-2xl max-w-sm w-full p-10 animate-in zoom-in-95 duration-500 border border-white/20 dark:border-white/5 text-center">
            <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center text-red-500 mx-auto mb-8 shadow-inner">
              <Trash2 size={40} strokeWidth={2.5} />
            </div>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-4 uppercase tracking-tighter">
              Expunge Registry?
            </h3>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-10 leading-relaxed uppercase tracking-widest">
              CAUTION: This will disconnect your node from this encrypted grid. All session history will be inaccessible.
            </p>
            <div className="flex flex-col gap-4">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  handleDeleteChat();
                }}
                className="w-full py-5 bg-red-600 text-white rounded-2xl hover:bg-red-700 transition-all duration-500 font-black uppercase tracking-[0.2em] shadow-lg shadow-red-600/20 active:scale-95"
              >
                Confirm Expunge
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="w-full py-5 bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 rounded-2xl hover:bg-gray-200 dark:hover:bg-white/10 transition-all duration-500 font-black uppercase tracking-[0.2em] active:scale-95"
              >
                Abort
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ELITE CHAT BODY */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto flex flex-col p-4 sm:p-8 relative transition-colors bg-[#f8fafc] dark:bg-gray-950"
      >
        {/* Pattern Overlays */}
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

        {showForwardSuccess && (
          <div className="sticky top-4 z-40 mb-6 mx-auto w-full max-w-sm pointer-events-none">
            <div className="backdrop-blur-2xl bg-emerald-500/90 dark:bg-emerald-500/20 border border-emerald-400/30 rounded-3xl shadow-[0_20px_40px_rgba(16,185,129,0.2)] p-5 animate-in fade-in slide-in-from-top-6 duration-700">
              <div className="flex items-center gap-5">
                <div className="flex-shrink-0 w-12 h-12 bg-white dark:bg-emerald-500/20 rounded-2xl flex items-center justify-center shadow-lg">
                  <CheckCircle2
                    size={24}
                    className="text-emerald-600 dark:text-emerald-400"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black text-emerald-900 dark:text-emerald-400 uppercase tracking-[0.3em] leading-none mb-1">
                    Grid Transmission
                  </p>
                  <p className="text-sm font-black text-white dark:text-emerald-50 content-none uppercase tracking-tight">
                    Forwarded successfully
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center z-10 opacity-60">
            <div className="w-24 h-24 bg-primary-500/5 rounded-[2rem] flex items-center justify-center text-primary-500/20 mb-6 border border-primary-500/10">
              <Zap size={48} strokeWidth={1} />
            </div>
            <div className="backdrop-blur-sm bg-white/5 dark:bg-white/5 border border-white/10 p-8 rounded-[2.5rem] shadow-xl text-center max-w-sm">
              <p className="text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.4em] mb-4">Registry Status: Empty</p>
              <p className="text-sm font-black text-gray-400 dark:text-gray-500 uppercase tracking-tight">
                This grid has no recorded communications.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          {messages
            .filter((m) => m.status !== "pending" && m.status !== "zombie")
            .map((msg, i, arr) => {
              const currentDate = new Date(msg.timestamp || 0).toDateString();
              const prevDate =
                i > 0 ? new Date(arr[i - 1].timestamp || 0).toDateString() : null;
              const showDate = currentDate !== prevDate;
              const isFirstInGroup =
                i === 0 ||
                arr[i - 1].senderPublicKey !== msg.senderPublicKey ||
                arr[i - 1].type === "system" ||
                showDate;
              const isLastInGroup =
                i === arr.length - 1 ||
                arr[i + 1].senderPublicKey !== msg.senderPublicKey ||
                arr[i + 1].type === "system" ||
                (i < arr.length - 1 &&
                  new Date(arr[i + 1].timestamp || 0).toDateString() !==
                    currentDate);

              return (
                <div
                  key={`${msg.timestamp}-${msg.text || "no-text"}-${i}`}
                  className="flex flex-col w-full z-10 relative"
                >
                  {showDate && msg.timestamp && (
                    <div className="flex justify-center my-8 sticky top-2 z-20">
                      <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 bg-white/80 dark:bg-gray-900/80 border border-white/20 dark:border-white/5 px-6 py-2 rounded-full shadow-2xl uppercase tracking-[0.3em] backdrop-blur-xl">
                        {new Date(msg.timestamp).toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric"
                        })}
                      </span>
                    </div>
                  )}

                  {msg.type === "system" ? (
                    <div className="flex justify-center my-6 z-10 w-full animate-in fade-in duration-1000">
                      <div className="flex items-center gap-3 bg-gray-100/50 dark:bg-white/5 px-6 py-3 rounded-2xl backdrop-blur-sm border border-black/5 dark:border-white/5">
                        <History size={14} className="text-gray-400" />
                        <span className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                          {msg.text}
                        </span>
                      </div>
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
                      senderName={
                        msg.fromMe
                          ? userName || "YOU"
                          : msg.senderPublicKey
                            ? contactsMap[msg.senderPublicKey]?.name ||
                              msg.senderUsername ||
                              msg.senderPublicKey.substring(0, 6)
                            : msg.senderUsername || "UNKNOWN"
                      }
                      senderImage={
                        msg.fromMe
                          ? userAvatar
                          : msg.senderPublicKey
                            ? contactsMap[msg.senderPublicKey]?.icon
                            : undefined
                      }
                      forwarded={msg.forwarded}
                      showName={isFirstInGroup}
                      showAvatar={isLastInGroup}
                      currentChatId={address}
                      onAvatarClick={
                        !msg.fromMe && msg.senderPublicKey
                          ? () =>
                              navigate({
                                to: `/contact-info/${msg.senderPublicKey}`,
                                search: { returnTo: `/groups/${address}` },
                              })
                          : undefined
                      }
                      replyTo={msg.replyTo}
                      deleted={msg.deleted}
                      onDelete={
                        (msg.fromMe ||
                          myRole === "admin" ||
                          myRole === "creator") &&
                        !msg.deleted &&
                        msg.customid
                          ? () => handleDeleteGroupMessage(msg.customid!)
                          : undefined
                      }
                      onReply={() => {
                        const senderName = msg.fromMe
                          ? userName || "YOU"
                          : msg.senderPublicKey
                            ? contactsMap[msg.senderPublicKey]?.name ||
                              msg.senderUsername ||
                              "UNKNOWN"
                            : msg.senderUsername || "UNKNOWN";
                        setReplyingTo({
                          customid: msg.customid || "",
                          text: msg.text || (msg.type === "image" ? "Image" : ""),
                          senderName,
                          type: msg.type || "text",
                        });
                        setTimeout(() => inputRef.current?.focus(), 50);
                      }}
                    />
                  )}
                </div>
              );
            })}
        </div>

        <div ref={messagesEndRef} className="h-4" />
      </div>

      {/* ELITE REPLY INTERFACE */}
      {replyingTo && (
        <div className="mx-6 mb-4 animate-in slide-in-from-bottom-4 duration-500">
          <div className="backdrop-blur-2xl bg-white/80 dark:bg-gray-900/80 border border-white/20 dark:border-white/5 rounded-[1.5rem] p-4 flex items-center gap-4 shadow-2xl relative overflow-hidden group">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-primary-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] font-black text-primary-500 uppercase tracking-[0.2em]">Context Link</span>
                <span className="text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em]">{replyingTo.senderName}</span>
              </div>
              <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate uppercase tracking-tight">
                {replyingTo.type === "image" ? "IMAGE PAYLOAD" : replyingTo.text}
              </p>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              className="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-white/5 text-gray-400 hover:text-red-500 rounded-xl transition-all duration-300"
            >
              <Trash2 size={16} strokeWidth={3} />
            </button>
          </div>
        </div>
      )}

      {/* ELITE INPUT HUB */}
      <div className="px-6 pb-10 pt-2 relative z-50">
        <div className="max-w-screen-xl mx-auto flex items-end gap-4">
          <div className="flex-1 relative group">
            {/* Glassmorphic Backing */}
            <div className="absolute inset-0 bg-white/40 dark:bg-gray-900/40 backdrop-blur-3xl rounded-[2.5rem] border border-white/20 dark:border-white/5 shadow-2xl transition-all duration-500 group-focus-within:border-primary-500/50 group-focus-within:bg-white/60 dark:group-focus-within:bg-gray-900/60" />

            <div className="relative flex items-center px-4 py-3 min-h-[72px]">
              {/* Emoji Trigger */}
              <div ref={emojiPickerRef} className="relative">
                <div className={`absolute bottom-full mb-6 left-0 z-50 transition-all duration-500 ${!showEmojiPicker ? "opacity-0 scale-95 pointer-events-none translate-y-4" : "opacity-100 scale-100 translate-y-0"}`}>
                  <div className="backdrop-blur-3xl bg-white/95 dark:bg-gray-900/95 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-white/20 dark:border-white/5 overflow-hidden">
                    <Suspense fallback={<div className="h-[350px] w-[320px] bg-white dark:bg-gray-800 animate-pulse" />}>
                      <EmojiPicker
                        onEmojiClick={onEmojiClick}
                        theme={mode === "dark" ? ("dark" as any) : ("light" as any)}
                        width={320}
                        height={400}
                        searchDisabled
                        skinTonesDisabled
                        previewConfig={{ showPreview: false }}
                      />
                    </Suspense>
                  </div>
                </div>
                <button
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className={`w-12 h-12 flex items-center justify-center rounded-2xl transition-all duration-500 ${showEmojiPicker ? "bg-primary-500 text-white" : "text-gray-400 hover:text-primary-500 bg-gray-100/50 dark:bg-white/5"}`}
                >
                  <Radio size={24} strokeWidth={2.5} />
                </button>
              </div>

              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                onFocus={() => setShowEmojiPicker(false)}
                placeholder="ENCRYPTED TRANSMISSION..."
                className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-sm font-bold text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 px-4 py-2 resize-none max-h-48 uppercase tracking-widest leading-relaxed"
                rows={1}
                style={{ minHeight: "24px" }}
              />

              <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleImageSelect} />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-12 h-12 flex items-center justify-center rounded-2xl text-gray-400 hover:text-primary-500 bg-gray-100/50 dark:bg-white/5 transition-all duration-500 mx-1"
              >
                <ImageIcon size={22} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          <button
            onClick={handleSendMessage}
            disabled={!input.trim()}
            className={`w-[72px] h-[72px] flex items-center justify-center rounded-[2rem] transition-all duration-500 shadow-2xl active:scale-90 flex-shrink-0 ${!input.trim() ? "bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-gray-600" : "bg-primary-500 text-white shadow-primary-500/30 hover:scale-105"}`}
          >
            <Zap size={28} strokeWidth={3} fill={input.trim() ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
    </div>
  );
}
