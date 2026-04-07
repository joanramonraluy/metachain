// src/routes/channels.$channelId.lazy.tsx
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
  Radio,
  Settings,
  Info,
  Trash2,
  Star,
  Archive,
  Image as ImageIcon,
  CheckCircle2,
  Zap,
  ChevronRight,
  MoreVertical,
  ArrowLeft,
} from "lucide-react";
import { channelService } from "../services/channel.service";
import { compressImage } from "../utils/image";
import { useTheme } from "../context/ThemeContext";
import MessageBubble from "../components/chat/MessageBubble";
import { EmojiClickData } from "emoji-picker-react";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

export const Route = createLazyFileRoute("/channels/$channelId")({
  component: ChannelPage,
});

interface ParsedMessage {
  id?: number;
  text: string;
  fromMe: boolean;
  timestamp: number;
  senderPublicKey?: string;
  senderUsername?: string;
  type?: string;
  filedata?: string;
  forwarded?: boolean;
  replyTo?: {
    customid: string;
    text: string;
    senderName: string;
    type: string;
  } | null;
  customid?: string;
  sender_seq?: number;
  deleted?: boolean;
}

function ChannelPage() {
  const { channelId } = Route.useParams();
  const navigate = useNavigate();
  const { userName, myPublicKey } = useContext(appContext);
  const { chatBackground, mode } = useTheme();

  const [channelName, setChannelName] = useState("Channel");
  const [channelAvatar, setChannelAvatar] = useState("");
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showForwardSuccess, setShowForwardSuccess] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{
    customid: string;
    text: string;
    senderName: string;
    type: string;
  } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);
  const cursorPositionRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const defaultAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

  const decodeStoredAvatar = (avatar?: string | null) => {
    if (!avatar || avatar === "0x00") return "";

    const candidates = [avatar];
    try {
      candidates.unshift(decodeURIComponent(avatar));
    } catch (err) {
      console.warn("⚠️ [CHANNEL-CHAT] Error decoding avatar:", err);
    }

    const validAvatar = candidates.find(
      (candidate) =>
        candidate &&
        candidate.startsWith("data:image") &&
        !candidate.includes("/0x00"),
    );

    return validAvatar || "";
  };

  // -------------------------------------------------------------------------
  // Load channel info & messages
  // -------------------------------------------------------------------------
  const loadMessages = useCallback(async () => {
    const msgs = await channelService.getChannelMessages(channelId);
    const parsed: ParsedMessage[] = msgs.map((m: any) => ({
      id: m.ID || m.id,
      text: m.MESSAGE || m.message || "",
      fromMe:
        (m.SENDER_PUBLICKEY || m.sender_publickey || "").toLowerCase() ===
        (myPublicKey || "").toLowerCase(),
      timestamp: Number(m.DATE || m.date || 0),
      senderPublicKey: m.SENDER_PUBLICKEY || m.sender_publickey,
      senderUsername: m.SENDER_USERNAME || m.sender_username,
      type: m.TYPE || m.type || "text",
      forwarded: m.FORWARDED == 1 || m.forwarded == 1,
      filedata: m.FILEDATA || m.filedata,
      customid: m.CUSTOMID || m.customid,
      sender_seq:
        m.SENDER_SEQ != null
          ? Number(m.SENDER_SEQ)
          : m.sender_seq != null
            ? Number(m.sender_seq)
            : undefined,
      deleted: m.DELETED === 1 || m.DELETED === "1",
      replyTo:
        m.REPLY_TO_TEXT ||
        m.reply_to_text ||
        m.REPLY_TO_SENDER ||
        m.reply_to_sender
          ? {
              customid: m.REPLY_TO_CUSTOMID || m.reply_to_customid || "",
              text: m.REPLY_TO_TEXT || m.reply_to_text || "",
              senderName: m.REPLY_TO_SENDER || m.reply_to_sender || "",
              type: m.REPLY_TO_TYPE || m.reply_to_type || "text",
            }
          : null,
    }));
    setMessages(parsed);
  }, [channelId, myPublicKey]);

  const init = useCallback(async () => {
    const info = await channelService.getChannelInfo(channelId);
    if (info) {
      setChannelName((info as any).NAME || (info as any).name || "Channel");
      setChannelAvatar(
        decodeStoredAvatar((info as any).AVATAR || (info as any).avatar),
      );
      setIsFavorite(!!(info as any).favorite || !!(info as any).FAVORITE);
      setIsArchived(!!(info as any).archived || !!(info as any).ARCHIVED);
    }
    const admin = await channelService.isAdmin(channelId, myPublicKey);
    setIsAdmin(admin);
    const subs = await channelService.getChannelSubscribers(channelId);
    setSubscriberCount(subs.length);
    await loadMessages();
    await channelService.markChannelMessagesAsRead(channelId);
    await channelService.requestChannelHistory(channelId);
  }, [channelId, myPublicKey, loadMessages]);

  useEffect(() => {
    if (!channelId || !myPublicKey) return;

    init();
    isInitialLoad.current = true;

    const interval = setInterval(loadMessages, 10000);
    return () => clearInterval(interval);
  }, [channelId, myPublicKey, init, loadMessages]);

  // Listen for real-time SW events & Role Updates
  useEffect(() => {
    const handleUpdate = (e: any) => {
      if (
        !e.detail ||
        !e.detail.channelId ||
        e.detail.channelId.toUpperCase() !== channelId.toUpperCase()
      )
        return;

      const payload = e.detail;

      // Handle message deletion
      if (payload.type === "CHANNEL_MESSAGE_DELETED") {
        const deletedSeq = payload.senderSeq;
        if (deletedSeq != null) {
          setMessages((prev) =>
            prev.map((m) =>
              m.sender_seq === deletedSeq ? { ...m, deleted: true } : m,
            ),
          );
        }
        return;
      }

      // Handle Sync Events
      if (payload.type === "CHANNEL_SYNC_START") {
        setIsSyncing(true);
        // Auto-clear after 15 seconds if no response
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          setIsSyncing(false);
          syncTimeoutRef.current = null;
        }, 15000);
        return;
      }
      if (payload.type === "CHANNEL_SYNC_END") {
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
          syncTimeoutRef.current = null;
        }
        setIsSyncing(false);
        loadMessages();
        return;
      }
      if (payload.type === "CHANNEL_NEW_MESSAGE") {
        loadMessages();
        return;
      }

      console.log("📢 [CHANNEL-CHAT] refreshing info...");
      if (payload.favorite !== undefined) {
        setIsFavorite(!!payload.favorite);
      }
      if (payload.archived !== undefined) {
        setIsArchived(!!payload.archived);
      }
      if (payload.avatar !== undefined) {
        setChannelAvatar(decodeStoredAvatar(payload.avatar));
      }
      init();
    };

    window.addEventListener("CHANNEL_UPDATE", handleUpdate);

    // Listen for Forward Success event
    const handleForwardSuccess = () => {
      setShowForwardSuccess(true);
      setTimeout(() => {
        setShowForwardSuccess(false);
      }, 2000);
    };
    window.addEventListener("FORWARD_SUCCESS", handleForwardSuccess);

    return () => {
      window.removeEventListener("CHANNEL_UPDATE", handleUpdate);
      window.removeEventListener("FORWARD_SUCCESS", handleForwardSuccess);
    };
  }, [channelId, loadMessages, init]);

  // -------------------------------------------------------------------------
  // Scroll
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (isInitialLoad.current && messages.length > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop =
              scrollContainerRef.current.scrollHeight;
          }
        });
      });
      isInitialLoad.current = false;
    } else if (!isInitialLoad.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // -------------------------------------------------------------------------
  // Click outside handlers
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setShowMenu(false);
    };
    if (showMenu) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMenu]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(e.target as Node)
      )
        setShowEmojiPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const onEmojiClick = useCallback((data: EmojiClickData) => {
    setInput((prev) => {
      const pos = cursorPositionRef.current ?? prev.length;
      const safe = Math.min(Math.max(0, pos), prev.length);
      cursorPositionRef.current = safe + data.emoji.length;
      return prev.substring(0, safe) + data.emoji + prev.substring(safe);
    });
  }, []);

  // -------------------------------------------------------------------------
  // Send message (admin only)
  // -------------------------------------------------------------------------
  const handleSend = async () => {
    if (!input.trim() || !myPublicKey || !userName) return;
    setSending(true);
    const optimistic: ParsedMessage = {
      text: input,
      fromMe: true,
      timestamp: Date.now(),
      senderPublicKey: myPublicKey,
      senderUsername: userName,
      type: "text",
    };
    setMessages((prev) => [...prev, optimistic]);
    const toSend = input;
    const currentReplyTo = replyingTo;
    setInput("");
    setReplyingTo(null);
    try {
      await channelService.publishMessage(
        channelId,
        toSend,
        "text",
        myPublicKey,
        userName,
        "",
        false,
        currentReplyTo ?? undefined,
      );
      await loadMessages();
    } catch (err) {
      console.error("❌ [CHANNEL-CHAT] Send failed:", err);
    } finally {
      setSending(false);
    }
  };

  // -------------------------------------------------------------------------
  // Send Image message (admin only)
  // -------------------------------------------------------------------------
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

    if (!channelId || !myPublicKey || !userName) return;

    try {
      setSending(true);
      const compressedBase64 = await compressImage(file, 800, 800, 0.7);

      const optimistic: ParsedMessage = {
        text: "",
        fromMe: true,
        timestamp: Date.now(),
        senderPublicKey: myPublicKey,
        senderUsername: userName,
        type: "image",
        filedata: compressedBase64,
      };
      setMessages((prev) => [...prev, optimistic]);

      await channelService.publishMessage(
        channelId,
        "",
        "image",
        myPublicKey,
        userName,
        compressedBase64,
      );
    } catch (err) {
      console.error("❌ [CHANNEL-CHAT] Send image failed:", err);
      alert(
        "Error processing the image. It might be too complex or an unsupported format.",
      );
    } finally {
      setSending(false);
    }
  };

  // -------------------------------------------------------------------------
  // Delete message
  // -------------------------------------------------------------------------
  const handleDeleteChannelMessage = async (senderSeq: number) => {
    if (!myPublicKey || !userName) return;
    // Optimistic update
    setMessages((prev) =>
      prev.map((m) =>
        m.sender_seq === senderSeq ? { ...m, deleted: true } : m,
      ),
    );
    try {
      await channelService.deleteChannelMessage(channelId, senderSeq);
      await channelService.sendChannelDeleteMessage(
        channelId,
        senderSeq,
        myPublicKey,
        userName,
      );
    } catch (err) {
      console.error("❌ [CHANNEL] Delete message failed:", err);
      setMessages((prev) =>
        prev.map((m) =>
          m.sender_seq === senderSeq ? { ...m, deleted: false } : m,
        ),
      );
    }
  };

  // -------------------------------------------------------------------------
  // Delete channel
  // -------------------------------------------------------------------------
  const handleDelete = async () => {
    try {
      await channelService.deleteChannel(channelId);
      navigate({ to: "/" });
    } catch (err) {
      console.error("❌ [CHANNEL] Delete failed:", err);
    }
  };

  const handleToggleFavorite = async () => {
    try {
      if (isFavorite) {
        await channelService.unfavoriteChannel(channelId);
      } else {
        await channelService.favoriteChannel(channelId);
      }
      setIsFavorite(!isFavorite);
    } catch (err) {
      console.error("❌ [CHANNEL] Toggle favorite failed:", err);
    }
  };

  const handleToggleArchive = async () => {
    try {
      if (isArchived) {
        await channelService.unarchiveChannel(channelId);
      } else {
        await channelService.archiveChannel(channelId);
      }
      setIsArchived(!isArchived);
    } catch (err) {
      console.error("❌ [CHANNEL] Toggle archive failed:", err);
    }
  };

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
              onClick={() => navigate({ to: `/channel-info/${channelId}` })}
            >
              <div className="absolute inset-0 bg-primary-500 rounded-[1.5rem] blur-2xl opacity-0 group-hover:opacity-30 transition-opacity duration-500" />
              <div className="w-16 h-16 rounded-[1.5rem] border-2 border-white dark:border-gray-800 bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400 dark:text-gray-500 font-black text-2xl flex-shrink-0 overflow-hidden shadow-2xl relative z-10 group-hover:scale-105 transition-transform duration-500">
                {channelAvatar ? (
                  <img
                    src={channelAvatar}
                    alt={channelName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = defaultAvatar;
                    }}
                  />
                ) : (
                  <Radio size={28} strokeWidth={2.5} />
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
                  {channelName}
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
                  {subscriberCount} SUBSCRIBERS
                </span>
                {isSyncing ? (
                  <span className="flex items-center gap-2 text-[9px] font-black text-primary-500 uppercase tracking-widest animate-pulse whitespace-nowrap">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                    Synchronizing Grid
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-[9px] font-black text-emerald-500 uppercase tracking-widest whitespace-nowrap">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                    Broadcast Active
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
              <div className="absolute top-20 right-0 w-[240px] backdrop-blur-2xl bg-white/95 dark:bg-gray-900/95 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-white/20 dark:border-white/5 py-4 overflow-hidden z-[100] animate-in slide-in-from-top-4 fade-in duration-500">
                <div className="px-6 py-4 mb-2 border-b border-gray-100 dark:border-white/5">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em]">Grid Registry</span>
                </div>

                {[
                  { label: "Channel Info", icon: Info, action: () => navigate({ to: "/channel-info/$channelId", params: { channelId } }), color: "text-blue-500", bg: "bg-blue-500/10" },
                  { label: "Actions", icon: Settings, action: () => navigate({ to: "/channel-info/$channelId", params: { channelId }, search: { returnTo: `/channels/${channelId}`, tab: "settings" } }), color: "text-primary-500", bg: "bg-primary-500/10" },
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
                    <span className="text-[11px] font-black uppercase tracking-widest">Exit Channel</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ELITE BROADCAST POLICY BANNER */}
      {!isAdmin && (
        <div className="mx-6 mt-6 animate-in slide-in-from-top-4 duration-700">
          <div className="backdrop-blur-2xl bg-sky-500/10 border border-sky-400/20 rounded-[2rem] p-6 flex items-center gap-5 shadow-xl shadow-sky-500/5">
            <div className="w-12 h-12 bg-sky-500/20 rounded-2xl flex items-center justify-center text-sky-500 shadow-inner">
              <Radio size={24} strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-sky-600 dark:text-sky-400 uppercase tracking-[0.3em] mb-1">Grid Policy: Read-Only</p>
              <p className="text-sm font-black text-gray-900 dark:text-sky-100 uppercase tracking-tight">Only Grid Admins can broadcast to this registry.</p>
            </div>
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
              Exit Channel?
            </h3>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-10 leading-relaxed uppercase tracking-widest">
              {isAdmin
                ? "WARNING: This will permanently expunge this channel and all recorded history from the grid."
                : "CAUTION: You will stop receiving broadcasts from this registry signal."}
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-5 bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 rounded-2xl hover:bg-gray-200 dark:hover:bg-white/10 transition-all duration-500 font-black uppercase tracking-[0.2em] active:scale-95"
              >
                Abort
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  handleDelete();
                }}
                className="flex-1 py-5 bg-red-600 text-white rounded-2xl hover:bg-red-700 transition-all duration-500 font-black uppercase tracking-[0.2em] shadow-lg shadow-red-600/20 active:scale-95"
              >
                Exit Signal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MESSAGES BODY */}
      <div
        ref={scrollContainerRef}
        className={`flex-1 overflow-y-auto flex flex-col p-2 sm:p-4 relative transition-colors
          ${chatBackground === "dots" ? "" : chatBackground === "grid" ? "" : ""}`}
      >
        {showForwardSuccess && (
          <div className="sticky top-0 z-40 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="backdrop-blur-2xl bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-4 flex items-center gap-4 shadow-xl shadow-emerald-500/5">
              <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-500 shadow-inner">
                <CheckCircle2 size={20} strokeWidth={3} />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-0.5">Broadcast Success</p>
                <p className="text-sm font-black text-gray-900 dark:text-emerald-100 uppercase tracking-tight">Signal forwarded to destination grid.</p>
              </div>
            </div>
          </div>
        )}
        {/* Elite Pattern Overlays */}
        <div className="absolute inset-0 pointer-events-none z-0">
          {chatBackground === "dots" && (
            <div
              className="absolute inset-0 opacity-[0.03] dark:opacity-[0.07]"
              style={{
                backgroundImage: `radial-gradient(#000 1px, transparent 1px)`,
                backgroundSize: "24px 24px",
              }}
            />
          )}
          {chatBackground === "grid" && (
            <div
              className="absolute inset-0 opacity-[0.02] dark:opacity-[0.05]"
              style={{
                backgroundImage: `linear-gradient(#000 1px, transparent 1px), linear-gradient(to right, #000 1px, transparent 1px)`,
                backgroundSize: "32px 32px",
              }}
            />
          )}
          {chatBackground === "diagonal" && (
            <div
              className="absolute inset-0 opacity-[0.02] dark:opacity-[0.05]"
              style={{
                backgroundImage: `repeating-linear-gradient(45deg, #000 0px, #000 1px, transparent 1px, transparent 10px)`,
              }}
            />
          )}
        </div>

        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center relative z-10">
            <div className="max-w-xs w-full text-center p-10 backdrop-blur-2xl bg-white/40 dark:bg-gray-900/40 border border-white/20 dark:border-white/5 rounded-[3rem] shadow-2xl animate-in zoom-in-95 duration-700">
              <div className="w-20 h-20 bg-primary-500/10 rounded-[2rem] flex items-center justify-center text-primary-500 mx-auto mb-8 shadow-inner">
                <Radio size={40} strokeWidth={2.5} />
              </div>
              <h3 className="text-xl font-black text-gray-900 dark:text-white mb-3 uppercase tracking-tighter">Empty Grid</h3>
              <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] leading-relaxed">
                {isAdmin
                  ? "Initialize the broadcast channel. Be the first to publish a signal to this grid."
                  : "No signals recorded in this broadcast channel yet."}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4 relative z-10">
          {messages.map((msg, i, arr) => {
            const currentDate = new Date(msg.timestamp).toDateString();
            const prevDate = i > 0 ? new Date(arr[i - 1].timestamp).toDateString() : null;
            const showDate = currentDate !== prevDate;

            return (
              <div key={msg.id || `${msg.timestamp}-${msg.senderPublicKey}-${i}`} className="flex flex-col">
                {showDate && msg.timestamp > 0 && (
                  <div className="flex justify-center my-8">
                    <div className="px-5 py-2 backdrop-blur-2xl bg-gray-100/50 dark:bg-white/5 border border-white/20 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden relative">
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-shimmer" />
                      <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.4em] relative z-10">
                        {new Date(msg.timestamp).toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                )}

                {msg.type === "system" ? (
                  <div className="flex justify-center my-4">
                    <span className="text-[10px] font-black text-center text-primary-500/60 bg-primary-500/5 px-6 py-2 rounded-full uppercase tracking-widest border border-primary-500/10">
                      {msg.text}
                    </span>
                  </div>
                ) : (
                  <MessageBubble
                    fromMe={msg.fromMe}
                    text={msg.text}
                    timestamp={msg.timestamp}
                    type={msg.type}
                    filedata={msg.filedata}
                    senderName={msg.senderUsername || (msg.fromMe ? "You" : "Admin")}
                    forwarded={msg.forwarded}
                    showName={true}
                    showAvatar={true}
                    deleted={msg.deleted}
                    replyTo={msg.replyTo}
                    currentChatId={channelId}
                    onReply={isAdmin ? () => {
                      setReplyingTo({
                        customid: msg.customid || "",
                        text: msg.text || (msg.type === "image" ? "Image" : ""),
                        senderName: msg.senderUsername || "Admin",
                        type: msg.type || "text",
                      });
                      setTimeout(() => inputRef.current?.focus(), 50);
                    } : undefined}
                    onDelete={isAdmin && msg.sender_seq != null ? () => handleDeleteChannelMessage(msg.sender_seq!) : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* ELITE REPLY INTERFACE */}
      {isAdmin && replyingTo && (
        <div className="mx-6 mb-4 animate-in slide-in-from-bottom-4 duration-500">
          <div className="backdrop-blur-2xl bg-white/80 dark:bg-gray-900/80 border border-white/20 dark:border-white/10 rounded-2xl p-4 flex items-center gap-4 shadow-xl">
            <div className="w-1 bg-primary-500 rounded-full self-stretch" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-primary-500 uppercase tracking-widest mb-1">Replying to signal</p>
              <p className="text-[11px] font-bold text-gray-900 dark:text-gray-100 truncate opacity-80 uppercase tracking-tight">
                {replyingTo.senderName}: {replyingTo.type === "image" ? "📷 Image Source" : replyingTo.text}
              </p>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-white/5 text-gray-400 hover:text-red-500 transition-colors"
            >
              <Trash2 size={16} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}

      {/* ELITE INPUT HUB — Admins Only */}
      {isAdmin && (
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
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="ENCRYPTED SIGNAL..."
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
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className={`w-[72px] h-[72px] flex items-center justify-center rounded-[2rem] transition-all duration-500 shadow-2xl active:scale-90 flex-shrink-0 ${!input.trim() || sending ? "bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-gray-600" : "bg-primary-500 text-white shadow-primary-500/30 hover:scale-105"}`}
            >
              <Zap size={28} strokeWidth={3} fill={input.trim() ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
