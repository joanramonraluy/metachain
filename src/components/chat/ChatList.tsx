import { useContext, useEffect, useState, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { appContext } from "../../AppContext";
import { minimaService } from "../../services/minima.service";
import { MDS } from "@minima-global/mds";
import { Archive, Star } from "lucide-react";

interface Contact {
    currentaddress: string;
    publickey?: string;
    extradata?: {
        minimaaddress?: string;
        name?: string;
        icon?: string;
    };
    samechain?: boolean;
    lastseen?: number;
}

interface ChatItem {
    publickey: string;
    roomname: string;
    lastMessage: string;
    lastMessageType: string;
    lastMessageDate: number;
    lastMessageAmount: number;
    username: string;
    archived?: boolean;
    lastOpened?: number | null;
    unreadCount?: number;
    favorite?: boolean;
    avatar?: string;
}

export default function ChatList() {
    const { loaded } = useContext(appContext);
    const [chats, setChats] = useState<ChatItem[]>([]);
    const [contacts, setContacts] = useState<Map<string, Contact>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const [activeTab, setActiveTab] = useState<'all' | 'favorites' | 'archived'>('all');
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, publickey: string, archived: boolean, favorite: boolean } | null>(null);
    const navigate = useNavigate();

    // Close context menu on click outside
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    const fetchChats = async () => {
        try {
            const chatsList = await minimaService.getRecentChats();
            setChats(chatsList);
        } catch (err: any) {
            console.error("❌ [CHAT-LIST] Fetch error:", err);
        }
    };

    useEffect(() => {
        if (!loaded) return;

        let isMounted = true;

        const fetchData = async () => {
            // Helper for timeout
            const withTimeout = (promise: Promise<any>, ms: number = 3000) => {
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Request timed out")), ms)
                );
                return Promise.race([promise, timeout]);
            };

            let contactsMap = new Map<string, Contact>();

            // 1. Fetch Contacts Promise
            const fetchContactsPromise = (async () => {
                const contactsRes: any = await withTimeout(MDS.cmd.maxcontacts());
                const contactsList: Contact[] = contactsRes?.response?.contacts || [];

                contactsList.forEach((contact: Contact) => {
                    if (contact.publickey) {
                        contactsMap.set(contact.publickey, contact);
                    }
                });
            })();

            // 2. Fetch Chats Promise
            const fetchChatsPromise = fetchChats();

            // Run both concurrently
            const [contactsResult, chatsResult] = await Promise.allSettled([
                fetchContactsPromise,
                fetchChatsPromise
            ]);

            if (contactsResult.status === 'rejected') {
                console.warn("⚠️ [CHAT-LIST] Failed to fetch contacts (offline/timeout):", contactsResult.reason);
            }

            if (chatsResult.status === 'rejected') {
                console.error("❌ [CHAT-LIST] Fetch chats error:", chatsResult.reason);
                if (isMounted) setError(chatsResult.reason?.message || "Unknown error");
            }

            if (isMounted) {
                setContacts(contactsMap);
                setLoading(false);
            }
        };

        fetchData();

        // Listen for new messages to refresh the chat list
        const handleNewMessage = () => {
            fetchChats();
        };

        // Listen for mute status changes to refresh the chat list
        const handleMuteStatusChange = () => {
            console.log("🔄 [CHAT-LIST] Mute status changed (refreshing)");
            fetchChats();
        };

        // Listen for archive status changes to refresh the chat list
        const handleArchiveStatusChange = () => {
            console.log("🔄 [CHAT-LIST] Archive status changed (refreshing)");
            fetchChats();
        };

        // Listen for favorite status changes to refresh the chat list
        const handleFavoriteStatusChange = () => {
            console.log("⭐ [CHAT-LIST] Favorite status changed (refreshing)");
            fetchChats();
        };

        minimaService.onNewMessage(handleNewMessage);
        minimaService.onMuteStatusChange(handleMuteStatusChange);
        minimaService.onArchiveStatusChange(handleArchiveStatusChange);
        minimaService.onFavoriteStatusChange(handleFavoriteStatusChange);

        return () => {
            isMounted = false;
            minimaService.removeNewMessageCallback(handleNewMessage);
            minimaService.removeMuteStatusCallback(handleMuteStatusChange);
            minimaService.removeArchiveStatusCallback(handleArchiveStatusChange);
            minimaService.removeFavoriteStatusCallback(handleFavoriteStatusChange);
        };
    }, [loaded]);



    const handleArchive = async (publickey: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault(); // Prevent default context menu if triggered by right click

        try {
            await minimaService.archiveChat(publickey);
            // No need to fetchChats here as the listener will do it
        } catch (err) {
            console.error("❌ [CHAT-LIST] Archive error:", err);
        }
    };

    const handleToggleFavorite = async (publickey: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        try {
            const chat = chats.find(c => c.publickey === publickey);
            if (chat?.favorite) {
                await minimaService.unmarkChatAsFavorite(publickey);
            } else {
                await minimaService.markChatAsFavorite(publickey);
            }
        } catch (err) {
            console.error("❌ [CHAT-LIST] Favorite toggle error:", err);
        }
    };

    if (!loaded || loading) {
        return (
            <div className="flex items-center justify-center h-full bg-white dark:bg-gray-900">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full bg-white dark:bg-gray-900">
                <p className="text-red-500">⚠️ {error}</p>
            </div>
        );
    }

    const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

    const getAvatar = (publickey: string) => {
        // 1. Try contacts (MaxContacts)
        const contact = contacts.get(publickey);
        if (contact?.extradata?.icon) {
            try {
                const decoded = decodeURIComponent(contact.extradata.icon);
                // Check if it's a valid data URL, and not a URL ending in /0x00 (no photo)
                if (decoded.startsWith("data:image") && !decoded.includes("/0x00")) {
                    return decoded;
                }
            } catch (err) {
                console.warn("⚠️ [AVATAR] Decode error:", err);
            }
        }

        // 2. Try discovered avatar (from Chat Item)
        const chat = chats.find(c => c.publickey === publickey);
        if (chat?.avatar) {
            try {
                const decoded = decodeURIComponent(chat.avatar);
                if (decoded.startsWith("data:image") && !decoded.includes("/0x00")) {
                    return decoded;
                }
                // Also check if raw avatar is valid
                if (chat.avatar.startsWith("data:image") && !chat.avatar.includes("/0x00")) {
                    return chat.avatar;
                }
            } catch (err) {
                console.warn("⚠️ [AVATAR] Discovery decode error:", err);
            }
        }

        return defaultAvatar;
    };

    const getName = (chat: ChatItem) => {
        const contact = contacts.get(chat.publickey);
        return contact?.extradata?.name || chat.roomname || "Unknown";
    };

    const getLastMessagePreview = (chat: ChatItem) => {
        if (chat.lastMessageType === "charm") {
            return `✨ Charm sent`;
        }
        if (chat.lastMessageType === "token") {
            return `💰 Token sent`;
        }
        try {
            const decoded = chat.lastMessage;
            return decoded.length > 50 ? decoded.slice(0, 50) + "..." : decoded;
        } catch {
            return chat.lastMessage;
        }
    };

    const formatTime = (timestamp: number | string) => {
        if (!timestamp) return "";

        // Ensure timestamp is a number
        const timeNum = Number(timestamp);
        if (isNaN(timeNum)) return "";

        const date = new Date(timeNum);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        // Check if yesterday
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return "Yesterday";
        }

        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    const isNewChat = (chat: ChatItem) => {
        // Consider it "new" if there are unread messages
        // OR if it's never been opened (though unreadCount should cover this if there are messages)
        return (chat.unreadCount || 0) > 0 || !chat.lastOpened;
    };

    // Separate archived, favorite, and active chats
    const activeChats = chats.filter(c => !c.archived);
    const favoriteChats = chats.filter(c => c.favorite && !c.archived);
    const archivedChats = chats.filter(c => c.archived);

    // Get chats to display based on active tab
    let displayedChats = activeChats;
    if (activeTab === 'favorites') {
        displayedChats = favoriteChats;
    } else if (activeTab === 'archived') {
        displayedChats = archivedChats;
    }



    const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
    const longPressTriggeredRef = useRef(false);

    const handleUnarchive = async (publickey: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        try {
            await minimaService.unarchiveChat(publickey);
        } catch (err) {
            console.error("❌ [CHAT-LIST] Unarchive error:", err);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, publickey: string, archived?: boolean, favorite?: boolean) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, publickey, archived: !!archived, favorite: !!favorite });
    };

    return (
        <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 relative">
            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed bg-white dark:bg-gray-800 shadow-lg rounded-lg py-1 z-50 min-w-[200px] border border-gray-200 dark:border-gray-700"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    <button
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 flex items-center gap-3 transition-colors"
                        onClick={(e) => {
                            handleToggleFavorite(contextMenu.publickey, e);
                            setContextMenu(null);
                        }}
                    >
                        <div className="w-8 h-8 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-yellow-600 dark:text-yellow-400">
                            <Star size={16} fill={contextMenu.favorite ? "currentColor" : "none"} />
                        </div>
                        <span className="font-medium">{contextMenu.favorite ? "Unfavorite Chat" : "Favorite Chat"}</span>
                    </button>
                    <button
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 flex items-center gap-3 transition-colors border-t border-gray-100 dark:border-gray-700"
                        onClick={(e) => {
                            if (contextMenu.archived) {
                                handleUnarchive(contextMenu.publickey, e);
                            } else {
                                handleArchive(contextMenu.publickey, e);
                            }
                            setContextMenu(null);
                        }}
                    >
                        <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 dark:text-orange-400">
                            <Archive size={16} />
                        </div>
                        <span className="font-medium">{contextMenu.archived ? "Unarchive Chat" : "Archive Chat"}</span>
                    </button>
                </div>
            )}

            {/* Tabs */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 transition-colors">
                <div className="flex">
                    <button
                        onClick={() => setActiveTab('all')}
                        className={`flex-1 py-3 px-4 text-sm font-medium transition-colors relative ${activeTab === 'all'
                            ? 'text-primary-600 dark:text-primary-400'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                            }`}
                    >
                        All {activeChats.length > 0 && `(${activeChats.length})`}
                        {activeTab === 'all' && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600"></div>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('favorites')}
                        className={`flex-1 py-3 px-4 text-sm font-medium transition-colors relative ${activeTab === 'favorites'
                            ? 'text-primary-600 dark:text-primary-400'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                            }`}
                    >
                        ⭐ Favorites {favoriteChats.length > 0 && `(${favoriteChats.length})`}
                        {activeTab === 'favorites' && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600"></div>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('archived')}
                        className={`flex-1 py-3 px-4 text-sm font-medium transition-colors relative ${activeTab === 'archived'
                            ? 'text-primary-600 dark:text-primary-400'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                            }`}
                    >
                        Archived {archivedChats.length > 0 && `(${archivedChats.length})`}
                        {activeTab === 'archived' && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600"></div>
                        )}
                    </button>
                </div>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto p-3">
                {displayedChats.length > 0 ? (
                    <div className="space-y-2">
                        {displayedChats.map((chat, i) => (
                            <div
                                key={i}
                                onClick={(e) => {
                                    // If this interaction was flagged as a long press, ignore the click
                                    if (longPressTriggeredRef.current) {
                                        // Reset immediately so next click works
                                        longPressTriggeredRef.current = false;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        return;
                                    }

                                    navigate({
                                        to: "/chat/$address",
                                        params: {
                                            address: chat.publickey,
                                        },
                                    });
                                }}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    handleContextMenu(e, chat.publickey, chat.archived, chat.favorite);
                                }}
                                // Touch handlers for Long Press
                                onTouchStart={(e) => {
                                    // Clear any existing timer just in case
                                    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                    longPressTriggeredRef.current = false;

                                    const touch = e.touches[0];
                                    const clientX = touch.clientX;
                                    const clientY = touch.clientY;

                                    longPressTimerRef.current = setTimeout(() => {
                                        longPressTriggeredRef.current = true;
                                        // Trigger Context Menu
                                        const syntheticEvent = {
                                            preventDefault: () => { },
                                            stopPropagation: () => { },
                                            clientX: clientX,
                                            clientY: clientY,
                                        } as React.MouseEvent;
                                        handleContextMenu(syntheticEvent, chat.publickey, chat.archived, chat.favorite);
                                    }, 500);
                                }}
                                onTouchMove={() => {
                                    // If user moves finger (scrolls), cancel long press
                                    if (longPressTimerRef.current) {
                                        clearTimeout(longPressTimerRef.current);
                                        longPressTimerRef.current = null;
                                    }
                                }}
                                onTouchEnd={() => {
                                    // Clean up timer on release
                                    if (longPressTimerRef.current) {
                                        clearTimeout(longPressTimerRef.current);
                                        longPressTimerRef.current = null;
                                    }
                                }}
                                style={{ WebkitTouchCallout: 'none' } as any}
                                className={`relative rounded-lg shadow-sm border p-3 hover:shadow-md cursor-pointer transition-all select-none active:bg-gray-50 dark:active:bg-gray-700 ${isNewChat(chat)
                                    ? 'bg-primary-50 dark:bg-primary-900/10 border-l-4 border-l-primary-500 border-t-primary-200 border-r-primary-200 border-b-primary-200 dark:border-t-primary-800 dark:border-r-primary-800 dark:border-b-primary-800'
                                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                    }`}

                            >
                                <div className="flex items-center gap-3">
                                    {/* Avatar */}
                                    <div className="relative flex-shrink-0">
                                        <img
                                            src={getAvatar(chat.publickey)}
                                            alt={getName(chat)}
                                            className="w-12 h-12 rounded-full object-cover bg-gray-200 dark:bg-gray-700 pointer-events-none"
                                            onError={(e: any) => {
                                                e.target.src = defaultAvatar;
                                            }}
                                        />
                                        {chat.archived && (
                                            <div className="absolute -top-1 -right-1 bg-gray-100 dark:bg-gray-700 rounded-full p-0.5 border border-white dark:border-gray-800 shadow-sm">
                                                <Archive size={12} className="text-gray-500 dark:text-gray-400" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Chat Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                                                {getName(chat)}
                                                {chat.favorite && (
                                                    <Star size={14} fill="#fbbf24" stroke="#f59e0b" className="flex-shrink-0" />
                                                )}
                                                {(chat.unreadCount || 0) > 0 && (
                                                    <span className="ml-2 text-xs bg-primary-500 text-white px-2 py-0.5 rounded-full">
                                                        {chat.unreadCount}
                                                    </span>
                                                )}
                                                {/* Fallback for completely new chats with no messages yet (rare but possible if logic differs) */}
                                                {!chat.lastOpened && (chat.unreadCount || 0) === 0 && (
                                                    <span className="ml-2 text-xs bg-primary-500 text-white px-2 py-0.5 rounded-full">NEW</span>
                                                )}
                                            </h3>

                                            {/* Time or Quick Archive Action */}
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                                                    {formatTime(chat.lastMessageDate)}
                                                </span>

                                                {/* Quick Archive for New Chats */}
                                                {isNewChat(chat) && !chat.archived && (
                                                    <button
                                                        onClick={(e) => handleArchive(chat.publickey, e)}
                                                        className="p-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full text-gray-600 dark:text-gray-300 transition-colors"
                                                        title="Archive Chat"
                                                    >
                                                        <Archive size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-sm text-gray-600 dark:text-gray-300 truncate mt-0.5">
                                            {chat.username === "Me" && (
                                                <span className="text-primary-600 dark:text-primary-400 mr-1">You:</span>
                                            )}
                                            {getLastMessagePreview(chat)}
                                        </p>
                                    </div>


                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 p-8 text-center">
                        <div className="bg-primary-50 dark:bg-primary-900/20 p-4 rounded-full mb-4">
                            <svg className="w-12 h-12 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No chats yet</h3>
                        <p className="text-sm mb-6">Start a new conversation to see it here.</p>
                        <button
                            onClick={() => navigate({ to: "/contacts" })}
                            className="px-6 py-2 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors shadow-sm"
                        >
                            Start Messaging
                        </button>
                    </div>
                )}
            </div>

            {/* Floating Action Button (FAB) for New Chat - Telegram style */}
            <div className="fixed bottom-6 right-6">
                <button
                    onClick={() => navigate({ to: "/contacts" })}
                    className="w-14 h-14 bg-primary-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-primary-700 transition-transform hover:scale-105 active:scale-95"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                </button>
            </div>
        </div >
    );
}
