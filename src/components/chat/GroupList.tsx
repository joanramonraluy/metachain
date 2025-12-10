// src/components/chat/GroupList.tsx

import { useContext, useEffect, useState } from "react";
import { appContext } from "../../AppContext";
import { groupService, Group } from "../../services/group.service";
import { useNavigate } from "@tanstack/react-router";
import { Users, Plus } from "lucide-react";

interface GroupWithUnread extends Group {
    unreadCount?: number;
    lastMessageDate?: number;
}

export default function GroupList() {
    const { loaded, myPublicKey } = useContext(appContext);
    const [groups, setGroups] = useState<GroupWithUnread[]>([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    const fetchGroups = async () => {
        if (!myPublicKey) return;

        try {
            const groupsList = await groupService.getMyGroups(myPublicKey);

            // Get unread count for each group
            const groupsWithUnread = await Promise.all(
                groupsList.map(async (group: any) => {
                    const messages = await groupService.getGroupMessages(group.GROUP_ID);
                    const unreadCount = messages.filter((m: any) => m.READ === 0).length;

                    // Get last message date
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

            // Sort by last message date
            groupsWithUnread.sort((a, b) => (b.lastMessageDate || 0) - (a.lastMessageDate || 0));

            setGroups(groupsWithUnread);
        } catch (err) {
            console.error("❌ [GroupList] Error fetching groups:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!loaded || !myPublicKey) return;

        fetchGroups();

        // Listen for group updates
        const handleGroupUpdate = () => {
            console.log("🔄 [GroupList] Group updated, refreshing list");
            fetchGroups();
        };

        const handleGroupMessage = () => {
            console.log("📨 [GroupList] New group message, refreshing list");
            fetchGroups();
        };

        groupService.onGroupUpdate(handleGroupUpdate);
        groupService.onGroupMessage(handleGroupMessage);

        return () => {
            groupService.removeGroupUpdateCallback(handleGroupUpdate);
            groupService.removeGroupMessageCallback(handleGroupMessage);
        };
    }, [loaded, myPublicKey]);

    if (!loaded || loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-white">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    const formatTime = (timestamp: number) => {
        if (!timestamp) return "";

        const date = new Date(timestamp);
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

    return (
        <div className="h-full flex flex-col bg-gray-50">
            {/* Group List */}
            <div className="flex-1 overflow-y-auto p-3">
                {groups.length > 0 ? (
                    <div className="space-y-2">
                        {groups.map((group) => (
                            <div
                                key={group.group_id}
                                onClick={() =>
                                    navigate({
                                        to: "/groups/$groupId",
                                        params: {
                                            groupId: group.group_id,
                                        },
                                    })
                                }
                                className={`relative rounded-lg shadow-sm border p-3 hover:shadow-md cursor-pointer transition-all active:bg-gray-50 ${(group.unreadCount || 0) > 0
                                    ? 'bg-blue-50 border-l-4 border-blue-500'
                                    : 'bg-white border-gray-200'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    {/* Group Avatar */}
                                    <div className="relative flex-shrink-0">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-lg">
                                            {group.name.charAt(0).toUpperCase()}
                                        </div>
                                    </div>

                                    {/* Group Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <h3 className="font-semibold text-gray-900 truncate flex items-center gap-1.5">
                                                {group.name}
                                                {(group.unreadCount || 0) > 0 && (
                                                    <span className="ml-2 text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full">
                                                        {group.unreadCount}
                                                    </span>
                                                )}
                                            </h3>

                                            <span className="text-xs text-gray-500 flex-shrink-0">
                                                {formatTime(group.lastMessageDate || group.created_date)}
                                            </span>
                                        </div>
                                        {group.description && (
                                            <p className="text-sm text-gray-600 truncate mt-0.5">
                                                {group.description}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8 text-center">
                        <div className="bg-blue-50 p-4 rounded-full mb-4">
                            <Users className="w-12 h-12 text-[#0088cc]" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-1">No groups yet</h3>
                        <p className="text-sm">Create a group to start chatting with multiple people.</p>
                    </div>
                )}
            </div>

            {/* Floating Action Button (FAB) for New Group */}
            <div className="fixed bottom-6 right-6">
                <button
                    onClick={() => navigate({ to: "/create-group" })}
                    className="w-14 h-14 bg-[#0088cc] text-white rounded-full shadow-lg flex items-center justify-center hover:bg-[#0077b5] transition-transform hover:scale-105 active:scale-95"
                >
                    <Plus className="w-6 h-6" />
                </button>
            </div>
        </div>
    );
}
