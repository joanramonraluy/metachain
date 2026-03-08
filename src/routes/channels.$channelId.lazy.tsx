// src/routes/channels.$channelId.lazy.tsx
import { useEffect, useRef, useState, useContext, useCallback, lazy, Suspense } from "react";
import { useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { appContext } from "../AppContext";
import { Radio, Settings, Info, Trash2, Star, Archive } from "lucide-react";
import { channelService } from "../services/channel.service";
import { useTheme } from "../context/ThemeContext";
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
}

function ChannelPage() {
    const { channelId } = Route.useParams();
    const navigate = useNavigate();
    const { userName, myPublicKey } = useContext(appContext);
    const { chatBackground, mode } = useTheme();

    const [channelName, setChannelName] = useState("Channel");
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
    const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const menuRef = useRef<HTMLDivElement>(null);
    const emojiPickerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isInitialLoad = useRef(true);
    const cursorPositionRef = useRef<number | null>(null);

    // -------------------------------------------------------------------------
    // Load channel info & messages
    // -------------------------------------------------------------------------
    const loadMessages = useCallback(async () => {
        const msgs = await channelService.getChannelMessages(channelId);
        const parsed: ParsedMessage[] = msgs.map((m: any) => ({
            id: m.ID || m.id,
            text: m.MESSAGE || m.message || "",
            fromMe: (m.SENDER_PUBLICKEY || m.sender_publickey || "").toLowerCase() === (myPublicKey || "").toLowerCase(),
            timestamp: Number(m.DATE || m.date || 0),
            senderPublicKey: m.SENDER_PUBLICKEY || m.sender_publickey,
            senderUsername: m.SENDER_USERNAME || m.sender_username,
            type: m.TYPE || m.type || "text",
        }));
        setMessages(parsed);
    }, [channelId, myPublicKey]);

    const init = useCallback(async () => {
        const info = await channelService.getChannelInfo(channelId);
        if (info) {
            setChannelName((info as any).NAME || (info as any).name || "Channel");
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
            if (!e.detail || !e.detail.channelId || e.detail.channelId.toUpperCase() !== channelId.toUpperCase()) return;

            const payload = e.detail;

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
            init();
        };

        window.addEventListener("CHANNEL_UPDATE", handleUpdate);

        return () => {
            window.removeEventListener("CHANNEL_UPDATE", handleUpdate);
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
                        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
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
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
        };
        if (showMenu) document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [showMenu]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node))
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
        setInput("");
        try {
            await channelService.publishMessage(channelId, toSend, "text", myPublicKey, userName);
        } catch (err) {
            console.error("❌ [CHANNEL-CHAT] Send failed:", err);
        } finally {
            setSending(false);
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

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------
    const isReadOnly = !isAdmin;

    return (
        <div className="flex-1 w-full flex flex-col bg-[#E5DDD5] dark:bg-gray-900 min-h-0">
            {/* HEADER */}
            <div className="bg-primary-600 dark:bg-gray-800 text-white p-4 pt-[calc(1rem+env(safe-area-inset-top))] px-4 flex items-center gap-3 flex-shrink-0 shadow-sm z-30 transition-colors border-b border-primary-700 dark:border-gray-700">
                <button
                    onClick={() => navigate({ to: "/" })}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                </button>

                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-12 h-12 rounded-full bg-sky-500 flex items-center justify-center text-white flex-shrink-0">
                        <Radio size={22} />
                    </div>
                    <div className="flex flex-col leading-tight flex-1 min-w-0">
                        <strong className="text-[16px] truncate font-semibold flex items-center gap-1.5">
                            {channelName}
                            {isFavorite && (
                                <Star
                                    size={14}
                                    fill="#fbbf24"
                                    stroke="#f59e0b"
                                    className="flex-shrink-0"
                                />
                            )}
                        </strong>
                        <span className="text-xs opacity-80 flex items-center gap-1.5 min-w-0">
                            <span className="truncate">
                                {subscriberCount} subscriber{subscriberCount !== 1 ? "s" : ""}
                                {isAdmin ? " · admin" : " · read-only"}
                            </span>
                            {isSyncing && (
                                <>
                                    <span className="text-gray-400 opacity-60">·</span>
                                    <span className="flex items-center gap-1 text-sky-200 animate-pulse whitespace-nowrap text-[11px] font-medium leading-none">
                                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Syncing...
                                    </span>
                                </>
                            )}
                        </span>
                    </div>
                </div>

                {/* Menu */}
                <div className="relative" ref={menuRef}>
                    <button className="opacity-80 hover:opacity-100 p-2" onClick={() => setShowMenu(!showMenu)}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                        </svg>
                    </button>

                    {showMenu && (
                        <div className="absolute top-10 right-0 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 min-w-[180px] z-50 animate-in slide-in-from-top-2 fade-in duration-200">
                            <button
                                className="flex items-center gap-3 w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 rounded-t-lg transition-colors text-left"
                                onClick={() => {
                                    setShowMenu(false);
                                    navigate({ to: "/channel-info/$channelId", params: { channelId } });
                                }}
                            >
                                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                    <Info size={16} />
                                </div>
                                <span className="font-medium">Channel Info</span>
                            </button>
                            <button
                                className="flex items-center gap-3 w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 transition-colors text-left border-t border-gray-100 dark:border-gray-700"
                                onClick={() => {
                                    setShowMenu(false);
                                    navigate({ to: "/channel-info/$channelId", params: { channelId } });
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
                                    <Star
                                        size={16}
                                        fill={isFavorite ? "currentColor" : "none"}
                                    />
                                </div>
                                <span className="font-medium">
                                    {isFavorite ? "Unfavorite Channel" : "Favorite Channel"}
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
                                    {isArchived ? "Unarchive Channel" : "Archive Channel"}
                                </span>
                            </button>
                            <button
                                className="flex items-center gap-3 w-full p-3 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded-b-lg transition-colors text-left border-t border-gray-100 dark:border-gray-700"
                                onClick={() => { setShowMenu(false); setShowDeleteConfirm(true); }}
                            >
                                <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">
                                    <Trash2 size={16} />
                                </div>
                                <span className="font-medium">Exit Channel</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* READ-ONLY BANNER for non-admins */}
            {isReadOnly && (
                <div className="bg-sky-50 dark:bg-sky-900/20 border-b border-sky-200 dark:border-sky-800 px-4 py-2 flex items-center gap-2 text-sky-700 dark:text-sky-300 text-xs">
                    <Radio size={12} />
                    <span>This is a channel. Only admins can post messages.</span>
                </div>
            )}

            {/* Delete Confirm Dialog */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 fade-in duration-200">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                            Exit Channel?
                        </h3>
                        <p className="text-gray-600 dark:text-gray-300 mb-6">
                            {isAdmin
                                ? "This will permanently delete the channel and all its messages."
                                : "You will stop receiving messages from this channel."}
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => { setShowDeleteConfirm(false); handleDelete(); }}
                                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                            >
                                Exit
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MESSAGES BODY */}
            <div
                ref={scrollContainerRef}
                className={`flex-1 overflow-y-auto flex flex-col p-2 sm:p-4 relative transition-colors
          ${chatBackground === 'dots' ? "" : chatBackground === 'grid' ? "" : ""}`}
            >
                {/* Background patterns (same as group chat) */}
                {chatBackground === 'dots' && (
                    <div className="fixed inset-0 opacity-[0.05] dark:opacity-[0.1] pointer-events-none z-0"
                        style={{ backgroundImage: `radial-gradient(#0f172a 1.5px, transparent 1.5px)`, backgroundSize: '24px 24px' }} />
                )}
                {chatBackground === 'grid' && (
                    <div className="fixed inset-0 opacity-[0.4] dark:opacity-[0.05] pointer-events-none z-0"
                        style={{ backgroundImage: `linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(to right, #cbd5e1 1px, transparent 1px)`, backgroundSize: '20px 20px' }} />
                )}
                {chatBackground === 'diagonal' && (
                    <div className="fixed inset-0 opacity-[0.4] dark:opacity-[0.1] pointer-events-none z-0"
                        style={{ backgroundImage: `repeating-linear-gradient(45deg, #e2e8f0 0px, #e2e8f0 2px, transparent 2px, transparent 12px)` }} />
                )}

                {messages.length === 0 && (
                    <div className="flex-1 flex items-center justify-center z-0">
                        <div className="bg-[#FFF5C4] dark:bg-yellow-900/30 text-gray-800 dark:text-yellow-100 text-[12.5px] p-3 rounded-lg shadow-sm text-center max-w-xs leading-relaxed select-none border border-yellow-200 dark:border-yellow-800">
                            <span className="mr-1">📢</span>
                            {isAdmin ? "No posts yet. Be the first to publish a message!" : "No messages yet."}
                        </div>
                    </div>
                )}

                {messages.map((msg, i, arr) => {
                    const currentDate = new Date(msg.timestamp).toDateString();
                    const prevDate = i > 0 ? new Date(arr[i - 1].timestamp).toDateString() : null;
                    const showDate = currentDate !== prevDate;

                    return (
                        <div key={msg.id || `${msg.timestamp}-${msg.senderPublicKey}-${i}`} className="flex flex-col w-full z-0 relative">
                            {showDate && msg.timestamp > 0 && (
                                <div className="flex justify-center my-3 sticky top-2 z-10">
                                    <span className="text-xs text-gray-600 dark:text-gray-300 font-medium bg-[#E1F3FB] dark:bg-gray-800 border border-white/50 dark:border-gray-700 px-3 py-1.5 rounded-lg shadow-sm uppercase tracking-wide backdrop-blur-sm">
                                        {new Date(msg.timestamp).toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                                    </span>
                                </div>
                            )}
                            {msg.type === "system" ? (
                                <div className="flex justify-center my-4">
                                    <span className="text-xs text-center text-gray-500 bg-gray-100/80 dark:bg-gray-800/80 dark:text-gray-400 px-4 py-2 rounded-xl backdrop-blur-sm max-w-[80%] mx-auto">
                                        {msg.text}
                                    </span>
                                </div>
                            ) : (
                                /* Channel messages — always full-width, sender on left, styled consistently */
                                <div className="flex gap-3 mb-3 items-start">
                                    {/* Sender avatar */}
                                    <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
                                        {msg.senderUsername?.charAt(0).toUpperCase() || "?"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline gap-2 mb-1">
                                            <span className="text-xs font-semibold text-sky-600 dark:text-sky-400">
                                                {msg.senderUsername || "Admin"}
                                            </span>
                                            <span className="text-[10px] text-gray-400">
                                                {msg.timestamp > 0 ? new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                                            </span>
                                        </div>
                                        <div className="bg-white dark:bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm max-w-lg border border-gray-100 dark:border-gray-700">
                                            <p className="text-gray-900 dark:text-gray-100 text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                <div ref={messagesEndRef} />
            </div>

            {/* INPUT BAR — only for admins */}
            {isAdmin && (
                <div className="p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] bg-white dark:bg-gray-800 flex gap-1 items-center flex-shrink-0 z-10 relative border-t border-gray-200 dark:border-gray-700">
                    <div className="flex-1 min-w-0 bg-white dark:bg-gray-700 rounded-2xl flex items-center border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent shadow-sm px-3 py-2 transition-all relative">
                        {/* Emoji Picker */}
                        <div
                            ref={emojiPickerRef}
                            className={`absolute bottom-full mb-2 left-0 z-50 transition-all duration-200 shadow-2xl rounded-xl border border-gray-100 dark:border-gray-700 ${!showEmojiPicker ? "opacity-0 scale-95 pointer-events-none invisible" : "opacity-100 scale-100 visible"}`}
                        >
                            <Suspense fallback={<div className="h-[350px] w-[300px] bg-white dark:bg-gray-800 animate-pulse rounded-xl" />}>
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

                        <button
                            className={`p-1 mr-1 rounded-full transition-colors flex-shrink-0 ${showEmojiPicker ? "text-primary-500" : "text-gray-400 hover:text-gray-600"}`}
                            onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(!showEmojiPicker); }}
                            title="Emoji"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>

                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                            }}
                            onSelect={(e) => {
                                cursorPositionRef.current = (e.target as HTMLTextAreaElement).selectionStart;
                            }}
                            placeholder="Publish a message..."
                            rows={1}
                            className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm resize-none max-h-32 overflow-y-auto leading-6"
                            style={{ minHeight: "24px" }}
                        />
                    </div>

                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || sending}
                        className="w-10 h-10 bg-primary-600 flex-shrink-0 rounded-full flex items-center justify-center hover:bg-primary-700 transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed shadow-md"
                    >
                        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
}
