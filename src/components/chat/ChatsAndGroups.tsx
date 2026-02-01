// src/components/chat/ChatsAndGroups.tsx

import { useState, useContext, useEffect } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { appContext } from "../../AppContext";
import { minimaService } from "../../services/minima.service";
import { groupService } from "../../services/group.service";
import { MDS } from "@minima-global/mds";
import { Plus, Archive, Star, Users, MessageCircle, LayoutGrid, Inbox } from "lucide-react";

interface Contact {
    currentaddress: string;
    publickey?: string;
    extradata?: {
        minimaaddress?: string;
        name?: string;
        icon?: string;
    };
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
}

interface GroupWithUnread {
    group_id: string;
    name: string;
    creator_publickey: string;
    created_date: number;
    avatar?: string;
    description?: string;
    unreadCount?: number;
    lastMessageDate?: number;
}

export default function ChatsAndGroups() {
    const { loaded, dbReady, myPublicKey } = useContext(appContext);
    const [activeTab, setActiveTab] = useState<'all' | 'individuals' | 'groups' | 'requests' | 'favorites' | 'archived'>('all');
    // State to hold discovered peer names map
    const [peerNames, setPeerNames] = useState<Map<string, string>>(new Map());
    const [chats, setChats] = useState<ChatItem[]>(() => {
        const cached = localStorage.getItem('cached_chats');
        return cached ? JSON.parse(cached) : [];
    });
    const [groups, setGroups] = useState<GroupWithUnread[]>([]);
    const [contacts, setContacts] = useState<Map<string, Contact>>(new Map());
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    const fetchChats = async () => {
        try {
            const chatsList = await minimaService.getRecentChats();
            setChats(chatsList);
            // Cache successful fetch
            localStorage.setItem('cached_chats', JSON.stringify(chatsList));
        } catch (err) {
            console.error("🚨 Error fetching chats:", err);
            // Fallback to cache on error
            const cached = localStorage.getItem('cached_chats');
            if (cached) {
                try {
                    setChats(JSON.parse(cached));
                    console.log("⚠️ Used cached chats due to fetch error");
                } catch (e) {
                    // ignore
                }
            }
        }
    };

    const fetchGroups = async () => {
        if (!myPublicKey) return;

        try {
            const groupsList = await groupService.getMyGroups(myPublicKey);
            const groupsWithUnread = await Promise.all(
                groupsList.map(async (group: any) => {
                    const messages = await groupService.getGroupMessages(group.GROUP_ID);
                    const unreadCount = messages.filter((m: any) => m.READ === 0).length;
                    const lastMessageDate = messages.length > 0
                        ? (messages[messages.length - 1] as any).DATE
                        : group.CREATED_DATE;

                    return {
                        group_id: group.GROUP_ID,
                        name: group.NAME,
                        creator_publickey: group.CREATOR_PUBLICKEY,
                        created_date: group.CREATED_DATE,
                        avatar: group.AVATAR,
                        description: group.DESCRIPTION,
                        unreadCount,
                        lastMessageDate
                    };
                })
            );

            groupsWithUnread.sort((a, b) => (b.lastMessageDate || 0) - (a.lastMessageDate || 0));
            setGroups(groupsWithUnread);
        } catch (err) {
            console.error("❌ [ChatsAndGroups] Error fetching groups:", err);
        }
    };

    useEffect(() => {
        if (!loaded || !dbReady) return;

        const fetchData = async () => {
            // Helper for timeout
            const withTimeout = (promise: Promise<any>, ms: number = 3000) => {
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Request timed out")), ms)
                );
                return Promise.race([promise, timeout]);
            };

            // 1. Define result containers
            const contactsMap = new Map<string, Contact>();

            // Parallelize fetching to reduce wait time (max wait = longest timeout vs sum of timeouts)
            const p1_contacts = async () => {
                try {
                    const contactsRes: any = await withTimeout(MDS.cmd.maxcontacts(), 3000);
                    const contactsList: Contact[] = contactsRes?.response?.contacts || [];
                    contactsList.forEach((contact: Contact) => {
                        if (contact.publickey) {
                            contactsMap.set(contact.publickey, contact);
                        }
                    });
                } catch (err) {
                    console.warn("⚠️ [ChatsAndGroups] Failed to fetch contacts (Offline/Timeout):", err);
                }
            };

            const p2_peers = async () => {
                // 2. Fetch Discovered Peers (Might fail if offline, but usually local DB)
                try {
                    // Wrapper for MDS.sql which is callback based usually, but here we want to await it safely
                    // or just fire and forget. The original code used MDS.sql(..., callback).
                    // MDS.sql is fast (local). Converting to promise for safety.
                    const peersPromise = new Promise((resolve, reject) => {
                        MDS.sql("SELECT publickey, alias FROM DISCOVERED_PEERS", (res: any) => {
                            if (res.status) resolve(res);
                            else reject(new Error(res.error));
                        });
                    });

                    const res: any = await withTimeout(peersPromise, 2000);

                    if (res.status && res.rows) {
                        const pMap = new Map<string, string>();
                        res.rows.forEach((row: any) => {
                            if (row.PUBLICKEY && row.ALIAS) {
                                pMap.set(row.PUBLICKEY, row.ALIAS);
                            }
                        });
                        setPeerNames(pMap);
                    }
                } catch (err) {
                    // Non-critical
                    console.warn("⚠️ [ChatsAndGroups] Peer fetch warning:", err);
                }
            };

            const p3_chats = async () => {
                try {
                    // Return null on timeout instead of throwing to allow loading=false to proceed naturally
                    await withTimeout(fetchChats(), 5000).catch(err => {
                        console.warn("⚠️ [ChatsAndGroups] Fetch chats timed out - using cached data if available", err);
                        return null;
                    });
                } catch (err) {
                    console.error("❌ [ChatsAndGroups] Fetch chats TIMEOUT/ERROR:", err);
                }
            };

            const p4_groups = async () => {
                try {
                    await withTimeout(fetchGroups(), 5000).catch(() => console.warn("Groups timeout"));
                } catch (err) {
                    console.warn("⚠️ [ChatsAndGroups] Failed to fetch groups (timeout):", err);
                }
            };

            // Run all in parallel
            await Promise.all([p1_contacts(), p2_peers(), p3_chats(), p4_groups()]);

            setContacts(contactsMap);
            setLoading(false);
        };

        fetchData();

        const handleNewMessage = () => {
            fetchChats();
        };

        const handleGroupMessage = () => {
            fetchGroups();
        };

        // Listen for solo messages from service worker
        const handleSoloMessage = (msg: string) => {
            if (msg === "CHAT_LIST_UPDATE") {
                console.log("🔄 [ChatsAndGroups] Chat list update triggered by service worker");
                fetchChats();
            }
        };

        // Register solo listener
        (window as any).MDS_SOLO_LISTENER = handleSoloMessage;

        minimaService.onNewMessage(handleNewMessage);
        minimaService.onArchiveStatusChange(fetchChats);
        minimaService.onFavoriteStatusChange(fetchChats);
        groupService.onGroupMessage(handleGroupMessage);
        groupService.onGroupUpdate(fetchGroups);

        return () => {
            delete (window as any).MDS_SOLO_LISTENER;
            minimaService.removeNewMessageCallback(handleNewMessage);
            minimaService.removeArchiveStatusCallback(fetchChats);
            minimaService.removeFavoriteStatusCallback(fetchChats);
            groupService.removeGroupMessageCallback(handleGroupMessage);
            groupService.removeGroupUpdateCallback(fetchGroups);
        };
    }, [loaded, dbReady, myPublicKey]);

    // Show spinner only if purely loading (no cache) or system not ready
    if ((!loaded || !dbReady) || (loading && chats.length === 0)) {
        return (
            <div className="flex items-center justify-center h-screen bg-white dark:bg-gray-900">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    // Revert hide logic - User wants "Notes to Self"
    const activeChats = chats.filter(c => !c.archived);

    // Helper function to check if a chat is from a contact
    const isContact = (publickey: string) => {
        if (publickey === myPublicKey) return true; // Self is always a contact
        const result = contacts.has(publickey);
        if (!result) {
            console.log('[ChatsAndGroups] publickey not in contacts:', publickey);
        }
        return result;
    };

    // Filter chats based on contact status
    const contactChats = activeChats.filter(c => isContact(c.publickey));
    const requestChats = activeChats.filter(c => !isContact(c.publickey));

    console.log('[ChatsAndGroups] Total chats:', activeChats.length, 'Contacts:', contactChats.length, 'Requests:', requestChats.length);

    const individualChats = contactChats; // Only contacts in Individuals tab
    const favoriteChats = chats.filter(c => c.favorite && !c.archived);
    const archivedChats = chats.filter(c => c.archived);
    const favoriteGroups = groups.filter(() => false);
    const archivedGroups: GroupWithUnread[] = [];

    let displayedChats: ChatItem[] = [];
    let displayedGroups: GroupWithUnread[] = [];

    switch (activeTab) {
        case 'all':
            displayedChats = activeChats; // All chats (contacts + non-contacts)
            displayedGroups = groups;
            break;
        case 'individuals':
            displayedChats = individualChats; // Only contacts
            displayedGroups = [];
            break;
        case 'groups':
            displayedChats = [];
            displayedGroups = groups;
            break;
        case 'requests':
            displayedChats = requestChats; // Only non-contacts
            displayedGroups = [];
            break;
        case 'favorites':
            displayedChats = favoriteChats;
            displayedGroups = favoriteGroups;
            break;
        case 'archived':
            displayedChats = archivedChats;
            displayedGroups = archivedGroups;
            break;
    }

    const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

    const getAvatar = (publickey: string) => {
        const contact = contacts.get(publickey);
        if (contact?.extradata?.icon) {
            try {
                const decoded = decodeURIComponent(contact.extradata.icon);
                if (decoded.startsWith("data:image") && !decoded.includes("/0x00")) {
                    return decoded;
                }
            } catch (err) {
                console.warn("⚠️ Error decoding avatar:", err);
            }
        }
        return defaultAvatar;
    };

    const getName = (chat: ChatItem) => {
        if (chat.publickey === myPublicKey) return "Notes to Self";

        const contact = contacts.get(chat.publickey);
        if (contact?.extradata?.name) return contact.extradata.name;

        // Check discovered peers if not a contact
        const peerName = peerNames.get(chat.publickey);
        if (peerName) return peerName;

        return chat.roomname || "Unknown";
    };

    const formatTime = (timestamp: any) => {
        if (!timestamp) return "";
        const dateVal = Number(timestamp);
        if (isNaN(dateVal)) return "";

        const date = new Date(dateVal);
        if (isNaN(date.getTime())) return "";

        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return "Yesterday";
        }

        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    const totalCount = activeChats.length + groups.length;
    const individualsCount = individualChats.length;
    const groupsCount = groups.length;
    const requestsCount = requestChats.length;
    const favoritesCount = favoriteChats.length + favoriteGroups.length;
    const archivedCount = archivedChats.length + archivedGroups.length;

    return (
        <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
            {/* Modern Tabs */}
            <div className="bg-white dark:bg-gray-800 flex-shrink-0 px-4 py-3 shadow-sm transition-colors">
                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    <button
                        onClick={() => setActiveTab('all')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${activeTab === 'all'
                            ? 'bg-primary-600 text-white shadow-md'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                    >
                        <LayoutGrid size={16} className="flex-shrink-0" />
                        <span className="hidden md:inline">All</span> {totalCount > 0 && `(${totalCount})`}
                    </button>
                    <button
                        onClick={() => setActiveTab('individuals')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${activeTab === 'individuals'
                            ? 'bg-primary-600 text-white shadow-md'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                    >
                        <MessageCircle size={16} className="flex-shrink-0" />
                        <span className="hidden md:inline">Individuals</span> {individualsCount > 0 && `(${individualsCount})`}
                    </button>
                    <button
                        onClick={() => setActiveTab('groups')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${activeTab === 'groups'
                            ? 'bg-primary-600 text-white shadow-md'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                    >
                        <Users size={16} className="flex-shrink-0" />
                        <span className="hidden md:inline">Groups</span> {groupsCount > 0 && `(${groupsCount})`}
                    </button>
                    <button
                        onClick={() => setActiveTab('requests')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${activeTab === 'requests'
                            ? 'bg-primary-600 text-white shadow-md'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                    >
                        <Inbox size={16} className="flex-shrink-0" />
                        <span className="hidden md:inline">Non-Contacts</span> {requestsCount > 0 && `(${requestsCount})`}
                    </button>
                    <button
                        onClick={() => setActiveTab('favorites')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${activeTab === 'favorites'
                            ? 'bg-primary-600 text-white shadow-md'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                    >
                        <Star size={16} className="flex-shrink-0" />
                        <span className="hidden md:inline">Favorites</span> {favoritesCount > 0 && `(${favoritesCount})`}
                    </button>
                    <button
                        onClick={() => setActiveTab('archived')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${activeTab === 'archived'
                            ? 'bg-primary-600 text-white shadow-md'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                    >
                        <Archive size={16} className="flex-shrink-0" />
                        <span className="hidden md:inline">Archived</span> {archivedCount > 0 && `(${archivedCount})`}
                    </button>

                    {activeTab === 'groups' && (
                        <button
                            onClick={() => navigate({ to: "/create-group" })}
                            className="ml-auto p-2 bg-primary-600 text-white rounded-full hover:bg-primary-700 transition-all shadow-md hover:shadow-lg flex-shrink-0"
                            title="Create Group"
                        >
                            <Plus size={20} />
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
                {displayedChats.length === 0 && displayedGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 p-8 text-center">
                        <div className="bg-primary-50 dark:bg-primary-900/20 p-4 rounded-full mb-4">
                            {activeTab === 'groups' ? (
                                <Users className="w-12 h-12 text-primary-600" />
                            ) : activeTab === 'requests' ? (
                                <Inbox className="w-12 h-12 text-primary-600" />
                            ) : (
                                <svg className="w-12 h-12 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                            )}
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
                            {activeTab === 'groups' ? 'No groups yet' :
                                activeTab === 'requests' ? 'No message requests' :
                                    'No chats yet'}
                        </h3>
                        <p className="text-sm mb-6">
                            {activeTab === 'groups'
                                ? 'Create a group to start chatting with multiple people.'
                                : activeTab === 'requests'
                                    ? 'Messages from non-contacts will appear here.'
                                    : 'Start a new conversation to see it here.'}
                        </p>
                        {activeTab === 'groups' ? (
                            <button
                                onClick={() => navigate({ to: "/create-group" })}
                                className="px-6 py-2 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors shadow-sm"
                            >
                                Create Group
                            </button>
                        ) : (
                            <button
                                onClick={() => navigate({ to: "/contacts" })}
                                className="px-6 py-2 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors shadow-sm"
                            >
                                Start Messaging
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {displayedGroups.map((group) => (
                            <Link
                                key={group.group_id}
                                to="/groups/$groupId"
                                params={{ groupId: group.group_id }}
                                className={`block rounded-xl p-4 cursor-pointer transition-all duration-200 ${(group.unreadCount || 0) > 0
                                    ? 'bg-primary-50 dark:bg-primary-900/10 shadow-md hover:shadow-lg border-2 border-primary-200 dark:border-primary-800'
                                    : 'bg-white dark:bg-gray-800 shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="relative flex-shrink-0">
                                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-xl shadow-md">
                                            {group.name.charAt(0).toUpperCase()}
                                        </div>
                                        {(group.unreadCount || 0) > 0 && (
                                            <div className="absolute -top-1 -right-1 bg-primary-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shadow-md">
                                                {group.unreadCount}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline justify-between gap-2 mb-1">
                                            <h3 className="font-semibold text-gray-900 dark:text-white truncate text-base">
                                                {group.name}
                                            </h3>
                                            <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                                                {formatTime(group.lastMessageDate || group.created_date)}
                                            </span>
                                        </div>
                                        {group.description && (
                                            <p className="text-sm text-gray-600 dark:text-gray-300 truncate">{group.description}</p>
                                        )}
                                    </div>
                                </div>
                            </Link>
                        ))}

                        {displayedChats.map((chat, i) => (
                            <Link
                                key={i}
                                to="/chat/$address"
                                params={{ address: chat.publickey }}
                                className={`block rounded-xl p-4 cursor-pointer transition-all duration-200 ${(chat.unreadCount || 0) > 0
                                    ? 'bg-primary-50 dark:bg-primary-900/10 shadow-md hover:shadow-lg border-2 border-primary-200 dark:border-primary-800'
                                    : 'bg-white dark:bg-gray-800 shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="relative flex-shrink-0">
                                        {chat.publickey === myPublicKey ? (
                                            <div className="w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shadow-sm">
                                                <Inbox size={24} className="text-primary-600 dark:text-primary-400" />
                                            </div>
                                        ) : (
                                            <img
                                                src={getAvatar(chat.publickey)}
                                                alt={getName(chat)}
                                                className="w-14 h-14 rounded-full object-cover bg-gray-200 dark:bg-gray-700 shadow-md"
                                                onError={(e: any) => { e.target.src = defaultAvatar; }}
                                            />
                                        )}
                                        {chat.archived && (
                                            <div className="absolute -top-1 -right-1 bg-gray-500 rounded-full p-1 shadow-md">
                                                <Archive size={10} className="text-white" />
                                            </div>
                                        )}
                                        {(chat.unreadCount || 0) > 0 && (
                                            <div className="absolute -top-1 -right-1 bg-primary-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shadow-md">
                                                {chat.unreadCount}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline justify-between gap-2 mb-1">
                                            <h3 className="font-semibold text-gray-900 dark:text-white truncate flex items-center gap-1.5 text-base">
                                                {getName(chat)}
                                                {chat.favorite && (
                                                    <Star size={16} fill="#fbbf24" stroke="#f59e0b" className="flex-shrink-0" />
                                                )}
                                            </h3>
                                            <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                                                {formatTime(chat.lastMessageDate)}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-600 dark:text-gray-300 truncate">
                                            {chat.username === "Me" && <span className="text-primary-600 dark:text-primary-400 font-medium mr-1">You:</span>}
                                            {chat.lastMessageType === "charm" ? "✨ Charm sent" :
                                                chat.lastMessageType === "token" ? "💰 Token sent" :
                                                    chat.lastMessage || ""}
                                        </p>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            <div className="fixed bottom-6 right-6">
                <button
                    onClick={() => activeTab === 'groups' ? navigate({ to: "/create-group" }) : navigate({ to: "/contacts" })}
                    className="w-14 h-14 bg-primary-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-primary-700 transition-transform hover:scale-105 active:scale-95"
                >
                    {activeTab === 'groups' ? <Plus className="w-6 h-6" /> : (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                    )}
                </button>
            </div>
        </div >
    );
}
