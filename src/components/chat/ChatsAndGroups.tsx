// src/components/chat/ChatsAndGroups.tsx

import { useState, useContext, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { appContext } from "../../AppContext";
import { minimaService } from "../../services/minima.service";
import { groupService } from "../../services/group.service";
import { MDS } from "@minima-global/mds";
import { Plus, Archive, Star, Users } from "lucide-react";

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
    const [activeTab, setActiveTab] = useState<'all' | 'individuals' | 'groups' | 'favorites' | 'archived'>('all');
    const [chats, setChats] = useState<ChatItem[]>([]);
    const [groups, setGroups] = useState<GroupWithUnread[]>([]);
    const [contacts, setContacts] = useState<Map<string, Contact>>(new Map());
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    const fetchChats = async () => {
        try {
            const chatsList = await minimaService.getRecentChats();
            setChats(chatsList);
        } catch (err) {
            console.error("🚨 Error fetching chats:", err);
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
            try {
                const contactsRes: any = await MDS.cmd.maxcontacts();
                const contactsList: Contact[] = contactsRes?.response?.contacts || [];
                const contactsMap = new Map<string, Contact>();
                contactsList.forEach((contact) => {
                    if (contact.publickey) {
                        contactsMap.set(contact.publickey, contact);
                    }
                });

                await fetchChats();
                await fetchGroups();

                setContacts(contactsMap);
            } catch (err: any) {
                console.error("🚨 Error fetching data:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();

        const handleNewMessage = () => {
            fetchChats();
        };

        const handleGroupMessage = () => {
            fetchGroups();
        };

        minimaService.onNewMessage(handleNewMessage);
        minimaService.onArchiveStatusChange(fetchChats);
        minimaService.onFavoriteStatusChange(fetchChats);
        groupService.onGroupMessage(handleGroupMessage);
        groupService.onGroupUpdate(fetchGroups);

        return () => {
            minimaService.removeNewMessageCallback(handleNewMessage);
            minimaService.removeArchiveStatusCallback(fetchChats);
            minimaService.removeFavoriteStatusCallback(fetchChats);
            groupService.removeGroupMessageCallback(handleGroupMessage);
            groupService.removeGroupUpdateCallback(fetchGroups);
        };
    }, [loaded, dbReady, myPublicKey]);

    if (!loaded || !dbReady || loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-white">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    const activeChats = chats.filter(c => !c.archived);
    const individualChats = activeChats;
    const favoriteChats = chats.filter(c => c.favorite && !c.archived);
    const archivedChats = chats.filter(c => c.archived);
    const favoriteGroups = groups.filter(() => false);
    const archivedGroups: GroupWithUnread[] = [];

    let displayedChats: ChatItem[] = [];
    let displayedGroups: GroupWithUnread[] = [];

    switch (activeTab) {
        case 'all':
            displayedChats = activeChats;
            displayedGroups = groups;
            break;
        case 'individuals':
            displayedChats = individualChats;
            displayedGroups = [];
            break;
        case 'groups':
            displayedChats = [];
            displayedGroups = groups;
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
        const contact = contacts.get(chat.publickey);
        return contact?.extradata?.name || chat.roomname || "Unknown";
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
    const favoritesCount = favoriteChats.length + favoriteGroups.length;
    const archivedCount = archivedChats.length + archivedGroups.length;

    return (
        <div className="h-screen flex flex-col bg-gray-50 overflow-x-hidden">
            {/* Modern Tabs */}
            <div className="bg-white flex-shrink-0 px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    <button
                        onClick={() => setActiveTab('all')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1 ${activeTab === 'all'
                            ? 'bg-[#0088cc] text-white shadow-md'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        <span className="md:hidden">📋</span>
                        <span className="hidden md:inline">All</span> {totalCount > 0 && `(${totalCount})`}
                    </button>
                    <button
                        onClick={() => setActiveTab('individuals')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1 ${activeTab === 'individuals'
                            ? 'bg-[#0088cc] text-white shadow-md'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        <span>💬</span> <span className="hidden md:inline">Individuals</span> {individualsCount > 0 && `(${individualsCount})`}
                    </button>
                    <button
                        onClick={() => setActiveTab('groups')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1 ${activeTab === 'groups'
                            ? 'bg-[#0088cc] text-white shadow-md'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        <span>👥</span> <span className="hidden md:inline">Groups</span> {groupsCount > 0 && `(${groupsCount})`}
                    </button>
                    <button
                        onClick={() => setActiveTab('favorites')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1 ${activeTab === 'favorites'
                            ? 'bg-[#0088cc] text-white shadow-md'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        <span>⭐</span> <span className="hidden md:inline">Favorites</span> {favoritesCount > 0 && `(${favoritesCount})`}
                    </button>
                    <button
                        onClick={() => setActiveTab('archived')}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1 ${activeTab === 'archived'
                            ? 'bg-[#0088cc] text-white shadow-md'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        <span>📦</span> <span className="hidden md:inline">Archived</span> {archivedCount > 0 && `(${archivedCount})`}
                    </button>

                    {activeTab === 'groups' && (
                        <button
                            onClick={() => navigate({ to: "/create-group" })}
                            className="ml-auto p-2 bg-[#0088cc] text-white rounded-full hover:bg-[#0077b5] transition-all shadow-md hover:shadow-lg flex-shrink-0"
                            title="Create Group"
                        >
                            <Plus size={20} />
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
                {displayedChats.length === 0 && displayedGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8 text-center">
                        <div className="bg-blue-50 p-4 rounded-full mb-4">
                            {activeTab === 'groups' ? (
                                <Users className="w-12 h-12 text-[#0088cc]" />
                            ) : (
                                <svg className="w-12 h-12 text-[#0088cc]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                            )}
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-1">
                            {activeTab === 'groups' ? 'No groups yet' : 'No chats yet'}
                        </h3>
                        <p className="text-sm mb-6">
                            {activeTab === 'groups'
                                ? 'Create a group to start chatting with multiple people.'
                                : 'Start a new conversation to see it here.'}
                        </p>
                        {activeTab === 'groups' ? (
                            <button
                                onClick={() => navigate({ to: "/create-group" })}
                                className="px-6 py-2 bg-[#0088cc] text-white rounded-full font-medium hover:bg-[#0077b5] transition-colors shadow-sm"
                            >
                                Create Group
                            </button>
                        ) : (
                            <button
                                onClick={() => navigate({ to: "/contacts" })}
                                className="px-6 py-2 bg-[#0088cc] text-white rounded-full font-medium hover:bg-[#0077b5] transition-colors shadow-sm"
                            >
                                Start Messaging
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {displayedGroups.map((group) => (
                            <div
                                key={group.group_id}
                                onClick={() => {
                                    console.log("🔵 Navigating to group:", group.group_id);
                                    navigate({ to: "/groups/$groupId", params: { groupId: group.group_id } });
                                }}
                                className={`rounded-xl p-4 cursor-pointer transition-all duration-200 ${(group.unreadCount || 0) > 0
                                    ? 'bg-blue-50 shadow-md hover:shadow-lg border-2 border-blue-200'
                                    : 'bg-white shadow-sm hover:shadow-md border border-gray-100'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="relative flex-shrink-0">
                                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-xl shadow-md">
                                            {group.name.charAt(0).toUpperCase()}
                                        </div>
                                        {(group.unreadCount || 0) > 0 && (
                                            <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shadow-md">
                                                {group.unreadCount}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline justify-between gap-2 mb-1">
                                            <h3 className="font-semibold text-gray-900 truncate text-base">
                                                {group.name}
                                            </h3>
                                            <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                                                {formatTime(group.lastMessageDate || group.created_date)}
                                            </span>
                                        </div>
                                        {group.description && (
                                            <p className="text-sm text-gray-600 truncate">{group.description}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}

                        {displayedChats.map((chat, i) => (
                            <div
                                key={i}
                                onClick={() => navigate({ to: "/chat/$address", params: { address: chat.publickey } })}
                                className={`rounded-xl p-4 cursor-pointer transition-all duration-200 ${(chat.unreadCount || 0) > 0
                                    ? 'bg-blue-50 shadow-md hover:shadow-lg border-2 border-blue-200'
                                    : 'bg-white shadow-sm hover:shadow-md border border-gray-100'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="relative flex-shrink-0">
                                        <img
                                            src={getAvatar(chat.publickey)}
                                            alt={getName(chat)}
                                            className="w-14 h-14 rounded-full object-cover bg-gray-200 shadow-md"
                                            onError={(e: any) => { e.target.src = defaultAvatar; }}
                                        />
                                        {chat.archived && (
                                            <div className="absolute -top-1 -right-1 bg-gray-500 rounded-full p-1 shadow-md">
                                                <Archive size={10} className="text-white" />
                                            </div>
                                        )}
                                        {(chat.unreadCount || 0) > 0 && (
                                            <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shadow-md">
                                                {chat.unreadCount}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline justify-between gap-2 mb-1">
                                            <h3 className="font-semibold text-gray-900 truncate flex items-center gap-1.5 text-base">
                                                {getName(chat)}
                                                {chat.favorite && (
                                                    <Star size={16} fill="#fbbf24" stroke="#f59e0b" className="flex-shrink-0" />
                                                )}
                                            </h3>
                                            <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                                                {formatTime(chat.lastMessageDate)}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-600 truncate">
                                            {chat.username === "Me" && <span className="text-[#0088cc] font-medium mr-1">You:</span>}
                                            {chat.lastMessageType === "charm" ? "✨ Charm sent" :
                                                chat.lastMessageType === "token" ? "💰 Token sent" :
                                                    decodeURIComponent(chat.lastMessage || "")}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="fixed bottom-6 right-6">
                <button
                    onClick={() => activeTab === 'groups' ? navigate({ to: "/create-group" }) : navigate({ to: "/contacts" })}
                    className="w-14 h-14 bg-[#0088cc] text-white rounded-full shadow-lg flex items-center justify-center hover:bg-[#0077b5] transition-transform hover:scale-105 active:scale-95"
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
