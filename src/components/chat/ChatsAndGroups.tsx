// src/components/chat/ChatsAndGroups.tsx

import { useState, useContext, useEffect, useRef } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { appContext } from "../../AppContext";
import { minimaService } from "../../services/minima.service";
import { groupService } from "../../services/group.service";
import { channelService } from "../../services/channel.service";
import { MDS } from "@minima-global/mds";
import {
  Plus,
  Archive,
  Star,
  Users,
  MessageCircle,
  LayoutGrid,
  Inbox,
  Globe,
  Radio,
  UserPlus,
  MessageSquarePlus,
} from "lucide-react";

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
  lastReceivedDate?: number;
}

interface GroupWithUnread {
  group_id: string;
  name: string;
  creator_publickey: string;
  my_role?: "creator" | "admin" | "member";
  created_date: number;
  avatar?: string;
  description?: string;
  unreadCount?: number;
  lastMessageDate?: number;
  lastMessage?: string;
  lastMessageType?: string;
  lastMessageUser?: string;
}

interface ChannelWithUnread {
  channel_id: string;
  name: string;
  description?: string;
  admin_publickey: string;
  created_date: number;
  unreadCount?: number;
  lastMessageDate?: number;
  lastMessage?: string;
  isAdmin?: boolean;
}

export default function ChatsAndGroups() {
  const { loaded, dbReady, myPublicKey } = useContext(appContext);
  const [activeTab, setActiveTab] = useState<
    | "all"
    | "individuals"
    | "groups"
    | "channels"
    | "requests"
    | "favorites"
    | "archived"
  >("all");
  // State to hold discovered peer names map
  const [peerNames, setPeerNames] = useState<Map<string, string>>(() => {
    try {
      const cached = localStorage.getItem("cached_peer_names");
      return cached ? new Map(JSON.parse(cached)) : new Map();
    } catch (e) {
      return new Map();
    }
  });
  const [chats, setChats] = useState<ChatItem[]>(() => {
    const cached = localStorage.getItem("cached_chats");
    return cached ? JSON.parse(cached) : [];
  });
  const [groups, setGroups] = useState<GroupWithUnread[]>(() => {
    const cached = localStorage.getItem("cached_groups");
    return cached ? JSON.parse(cached) : [];
  });
  const [channels, setChannels] = useState<ChannelWithUnread[]>(() => {
    const cached = localStorage.getItem("cached_channels");
    return cached ? JSON.parse(cached) : [];
  });
  const [contacts, setContacts] = useState<Map<string, Contact>>(() => {
    try {
      const cached = localStorage.getItem("cached_contacts");
      if (cached) {
        const list = JSON.parse(cached);
        const map = new Map<string, Contact>();
        list.forEach((c: Contact) => {
          if (c.publickey) map.set(c.publickey, c);
        });
        return map;
      }
    } catch (e) {}
    return new Map();
  });

  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  // Only show full loading spinner if we have absolutely no data
  const [loading, setLoading] = useState(() => {
    const hasChats = !!localStorage.getItem("cached_chats");
    return !hasChats;
  });
  const navigate = useNavigate();

  // Join Link Modal State
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinLink, setJoinLink] = useState("");
  const [joiningGroup, setJoiningGroup] = useState(false);
  const [joinError, setJoinError] = useState("");

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    publickey: string;
    archived: boolean;
    favorite: boolean;
  } | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTriggeredRef = useRef(false);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const handleContextMenu = (
    e: React.MouseEvent,
    publickey: string,
    archived?: boolean,
    favorite?: boolean,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      publickey,
      archived: !!archived,
      favorite: !!favorite,
    });
  };

  const handleArchive = async (publickey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await minimaService.archiveChat(publickey);
    } catch (err) {
      console.error("❌ Archive error:", err);
    }
  };

  const handleUnarchive = async (publickey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await minimaService.unarchiveChat(publickey);
    } catch (err) {
      console.error("❌ Unarchive error:", err);
    }
  };

  const handleToggleFavorite = async (
    publickey: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const chat = chats.find((c) => c.publickey === publickey);
      if (chat?.favorite) {
        await minimaService.unmarkChatAsFavorite(publickey);
      } else {
        await minimaService.markChatAsFavorite(publickey);
      }
    } catch (err) {
      console.error("❌ Favorite toggle error:", err);
    }
  };

  const fetchChats = async () => {
    try {
      const chatsList = await minimaService.getRecentChats();
      setChats(chatsList);
      // Cache successful fetch
      localStorage.setItem("cached_chats", JSON.stringify(chatsList));
    } catch (err) {
      console.error("🚨 Error fetching chats:", err);
      // Fallback to cache on error
      const cached = localStorage.getItem("cached_chats");
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
          const lastMsg =
            messages.length > 0 ? (messages[messages.length - 1] as any) : null;
          const lastMessageDate = lastMsg ? lastMsg.DATE : group.CREATED_DATE;
          const lastMessage = lastMsg ? lastMsg.MESSAGE : "";
          const lastMessageType = lastMsg ? lastMsg.TYPE : "text";
          let lastMessageUser = lastMsg ? lastMsg.SENDER_USERNAME : "";

          if (lastMsg && lastMsg.SENDER_PUBLICKEY === myPublicKey) {
            lastMessageUser = "You";
          }
          if (lastMsg && lastMsg.TYPE === "system") {
            lastMessageUser = "";
          }

          return {
            group_id: group.GROUP_ID,
            name: group.NAME,
            creator_publickey: group.CREATOR_PUBLICKEY,
            my_role: group.MY_ROLE || group.my_role,
            created_date: group.CREATED_DATE,
            avatar: group.AVATAR,
            description: group.DESCRIPTION,
            unreadCount,
            lastMessageDate,
            lastMessage,
            lastMessageType,
            lastMessageUser,
          };
        }),
      );

      groupsWithUnread.sort(
        (a, b) => (b.lastMessageDate || 0) - (a.lastMessageDate || 0),
      );
      setGroups(groupsWithUnread);
      localStorage.setItem("cached_groups", JSON.stringify(groupsWithUnread));
    } catch (err) {
      console.error("❌ [ChatsAndGroups] Error fetching groups:", err);
      // Fallback to cache
      const cached = localStorage.getItem("cached_groups");
      if (cached) {
        try {
          setGroups(JSON.parse(cached));
        } catch (e) {}
      }
    }
  };

  const fetchChannels = async () => {
    if (!myPublicKey) return;
    try {
      const list = await channelService.getMyChannels(myPublicKey);
      const withUnread = await Promise.all(
        list.map(async (ch: any) => {
          const msgs = await channelService.getChannelMessages(
            ch.CHANNEL_ID || ch.channel_id,
          );
          const unreadCount = msgs.filter(
            (m: any) => m.READ === 0 || m.read === 0,
          ).length;
          const lastMsg =
            msgs.length > 0 ? (msgs[msgs.length - 1] as any) : null;
          const isAdm = await channelService.isAdmin(
            ch.CHANNEL_ID || ch.channel_id,
            myPublicKey,
          );
          return {
            channel_id: ch.CHANNEL_ID || ch.channel_id,
            name: ch.NAME || ch.name,
            description: ch.DESCRIPTION || ch.description,
            admin_publickey: ch.ADMIN_PUBLICKEY || ch.admin_publickey,
            created_date: Number(ch.CREATED_DATE || ch.created_date || 0),
            unreadCount,
            lastMessageDate: lastMsg
              ? Number(lastMsg.DATE || lastMsg.date || 0)
              : Number(ch.CREATED_DATE || ch.created_date || 0),
            lastMessage: lastMsg
              ? lastMsg.MESSAGE || lastMsg.message || ""
              : "",
            isAdmin: isAdm,
          };
        }),
      );
      withUnread.sort(
        (a, b) => (b.lastMessageDate || 0) - (a.lastMessageDate || 0),
      );
      setChannels(withUnread);
      localStorage.setItem("cached_channels", JSON.stringify(withUnread));
    } catch (err) {
      console.error("❌ [ChatsAndGroups] Error fetching channels:", err);
      const cached = localStorage.getItem("cached_channels");
      if (cached) {
        try {
          setChannels(JSON.parse(cached));
        } catch (e) {}
      }
    }
  };

  useEffect(() => {
    if (!loaded || !dbReady) return;

    const fetchData = async () => {
      // Helper for timeout
      const withTimeout = (promise: Promise<any>, ms: number = 3000) => {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Request timed out")), ms),
        );
        return Promise.race([promise, timeout]);
      };

      // 1. Define result containers
      // const contactsMap = new Map<string, Contact>(); // Removed unused var

      // Parallelize fetching - Update state independently for instant feel
      const p1_contacts = async () => {
        try {
          const contactsRes: any = await withTimeout(
            MDS.cmd.maxcontacts(),
            3000,
          );
          const contactsList: Contact[] = contactsRes?.response?.contacts || [];
          const newMap = new Map<string, Contact>();
          contactsList.forEach((contact: Contact) => {
            if (contact.publickey) {
              newMap.set(contact.publickey, contact);
            }
          });
          setContacts(newMap);
          // Cache the LIST (Maps are not JSON serializable directly)
          localStorage.setItem("cached_contacts", JSON.stringify(contactsList));
        } catch (err) {
          console.warn(
            "⚠️ [ChatsAndGroups] Failed to fetch contacts (Offline/Timeout):",
            err,
          );
        }
      };

      const p2_peers = async () => {
        // 2. Fetch Discovered Peers (Might fail if offline, but usually local DB)
        try {
          const peersPromise = new Promise((resolve, reject) => {
            MDS.sql(
              "SELECT publickey, alias FROM DISCOVERED_PEERS",
              (res: any) => {
                if (res.status) resolve(res);
                else reject(new Error(res.error));
              },
            );
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
            // Cache map as array of entries
            localStorage.setItem(
              "cached_peer_names",
              JSON.stringify(Array.from(pMap.entries())),
            );
          }
        } catch (err) {
          console.warn("⚠️ [ChatsAndGroups] Peer fetch warning:", err);
        }
      };

      const p3_chats = async () => {
        try {
          await withTimeout(fetchChats(), 5000).catch((err) => {
            console.warn("⚠️ [ChatsAndGroups] Fetch chats timed out", err);
            return null;
          });
        } catch (err) {
          console.error("❌ [ChatsAndGroups] Fetch chats TIMEOUT/ERROR:", err);
        }
      };

      const p4_groups = async () => {
        try {
          await withTimeout(fetchGroups(), 5000).catch(() =>
            console.warn("Groups timeout"),
          );
        } catch (err) {
          console.warn(
            "⚠️ [ChatsAndGroups] Failed to fetch groups (timeout):",
            err,
          );
        }
      };

      const p5_channels = async () => {
        try {
          await withTimeout(fetchChannels(), 5000).catch(() =>
            console.warn("Channels timeout"),
          );
        } catch (err) {
          console.warn(
            "⚠️ [ChatsAndGroups] Failed to fetch channels (timeout):",
            err,
          );
        }
      };

      // Fire all requests - do NOT await them together
      // Use 'void' to fire-and-forget but we know they update state internally
      void p1_contacts();
      void p2_peers();

      // Critical content (chats/groups) -> once these settle (or fail), allow UI to show empty state if needed
      Promise.allSettled([p3_chats(), p4_groups(), p5_channels()]).then(() => {
        setLoading(false);
      });
    };

    fetchData();

    const handleNewMessage = () => {
      fetchChats();
    };

    const handleGroupMessage = () => {
      fetchGroups();
    };

    const handleChatListUpdate = () => {
      console.log(
        "🔄 [ChatsAndGroups] Chat list update triggered by service worker",
      );
      fetchChats();
    };

    minimaService.onChatListUpdate(handleChatListUpdate);
    minimaService.onNewMessage(handleNewMessage);
    minimaService.onArchiveStatusChange(fetchChats);
    minimaService.onFavoriteStatusChange(fetchChats);
    groupService.onGroupMessage(handleGroupMessage);
    groupService.onGroupUpdate(fetchGroups);
    const unsubChannels = channelService.onChannelUpdate(fetchChannels);

    return () => {
      minimaService.removeChatListUpdateCallback(handleChatListUpdate);
      minimaService.removeNewMessageCallback(handleNewMessage);
      minimaService.removeArchiveStatusCallback(fetchChats);
      minimaService.removeFavoriteStatusCallback(fetchChats);
      groupService.removeGroupMessageCallback(handleGroupMessage);
      groupService.removeGroupUpdateCallback(fetchGroups);
      unsubChannels();
    };
  }, [loaded, dbReady, myPublicKey]);

  // Show spinner only when we truly have nothing to render yet.
  // If we have cached chats, render immediately while AppContext keeps initializing.
  if ((!loaded || !dbReady) && chats.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-white dark:bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (loading && chats.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-white dark:bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  // Revert hide logic - User wants "Notes to Self"
  const activeChats = chats.filter((c) => !c.archived);

  // Helper function to check if a chat is from a contact
  const isContact = (publickey: string) => {
    if (publickey === myPublicKey) return true; // Self is always a contact
    return contacts.has(publickey);
  };

  // Filter chats based on contact status
  const contactChats = activeChats.filter((c) => isContact(c.publickey));
  const requestChats = activeChats.filter((c) => !isContact(c.publickey));

  if (import.meta.env.DEV) {
    console.log(
      "[ChatsAndGroups] Total chats:",
      activeChats.length,
      "Contacts:",
      contactChats.length,
      "Requests:",
      requestChats.length,
    );
  }

  const individualChats = contactChats; // Only contacts in Individuals tab
  const favoriteChats = chats.filter((c) => c.favorite && !c.archived);
  const archivedChats = chats.filter((c) => c.archived);
  const favoriteGroups = groups.filter(() => false);
  const archivedGroups: GroupWithUnread[] = [];

  let displayedChats: ChatItem[] = [];
  let displayedGroups: GroupWithUnread[] = [];
  let displayedChannels: ChannelWithUnread[] = [];

  switch (activeTab) {
    case "all":
      displayedChats = activeChats;
      displayedGroups = groups;
      displayedChannels = channels;
      break;
    case "individuals":
      displayedChats = individualChats;
      displayedGroups = [];
      displayedChannels = [];
      break;
    case "groups":
      displayedChats = [];
      displayedGroups = groups;
      displayedChannels = [];
      break;
    case "channels":
      displayedChats = [];
      displayedGroups = [];
      displayedChannels = channels;
      break;
    case "requests":
      displayedChats = requestChats;
      displayedGroups = [];
      displayedChannels = [];
      break;
    case "favorites":
      displayedChats = favoriteChats;
      displayedGroups = favoriteGroups;
      displayedChannels = [];
      break;
    case "archived":
      displayedChats = archivedChats;
      displayedGroups = archivedGroups;
      displayedChannels = [];
      break;
  }

  const allTimelineItems =
    activeTab === "all"
      ? [
          ...displayedChats.map((chat) => ({
            kind: "chat" as const,
            sortDate: Math.max(
              Number(chat.lastReceivedDate || 0),
              Number(chat.lastMessageDate || 0),
            ),
            chat,
          })),
          ...displayedGroups.map((group) => ({
            kind: "group" as const,
            sortDate: Number(group.lastMessageDate || group.created_date || 0),
            group,
          })),
          ...displayedChannels.map((channel) => ({
            kind: "channel" as const,
            sortDate: Number(
              channel.lastMessageDate || channel.created_date || 0,
            ),
            channel,
          })),
        ].sort((a, b) => b.sortDate - a.sortDate)
      : [];

  const defaultAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

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
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    }

    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const totalCount = activeChats.length + groups.length + channels.length;
  const individualsCount = individualChats.length;
  const groupsCount = groups.length;
  const channelsCount = channels.length;
  const requestsCount = requestChats.length;
  const favoritesCount = favoriteChats.length + favoriteGroups.length;
  const archivedCount = archivedChats.length + archivedGroups.length;

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-white dark:bg-gray-800 shadow-lg rounded-lg py-1 z-50 min-w-[200px] border border-gray-200 dark:border-gray-700 select-none"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 flex items-center gap-3 transition-colors touch-manipulation"
            onClick={(e) => {
              handleToggleFavorite(contextMenu.publickey, e);
              setContextMenu(null);
            }}
          >
            <div className="w-8 h-8 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-yellow-600 dark:text-yellow-400">
              <Star
                size={16}
                fill={contextMenu.favorite ? "currentColor" : "none"}
              />
            </div>
            <span className="font-medium">
              {contextMenu.favorite ? "Unfavorite Chat" : "Favorite Chat"}
            </span>
          </button>
          <button
            className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 flex items-center gap-3 transition-colors border-t border-gray-100 dark:border-gray-700 touch-manipulation"
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
            <span className="font-medium">
              {contextMenu.archived ? "Unarchive Chat" : "Archive Chat"}
            </span>
          </button>
        </div>
      )}

      {/* Modern Tabs */}
      <div className="bg-white dark:bg-gray-800 flex-shrink-0 px-4 py-3 shadow-sm transition-colors">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setActiveTab("all")}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${
              activeTab === "all"
                ? "bg-primary-600 text-white shadow-md"
                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            <LayoutGrid size={16} className="flex-shrink-0" />
            <span className="hidden md:inline">All</span>{" "}
            {totalCount > 0 && `(${totalCount})`}
          </button>
          <button
            onClick={() => setActiveTab("individuals")}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${
              activeTab === "individuals"
                ? "bg-primary-600 text-white shadow-md"
                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            <MessageCircle size={16} className="flex-shrink-0" />
            <span className="hidden md:inline">Individuals</span>{" "}
            {individualsCount > 0 && `(${individualsCount})`}
          </button>
          <button
            onClick={() => setActiveTab("groups")}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${
              activeTab === "groups"
                ? "bg-primary-600 text-white shadow-md"
                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            <Users size={16} className="flex-shrink-0" />
            <span className="hidden md:inline">Groups</span>{" "}
            {groupsCount > 0 && `(${groupsCount})`}
          </button>
          <button
            onClick={() => setActiveTab("channels")}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${
              activeTab === "channels"
                ? "bg-sky-600 text-white shadow-md"
                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            <Radio size={16} className="flex-shrink-0" />
            <span className="hidden md:inline">Channels</span>{" "}
            {channelsCount > 0 && `(${channelsCount})`}
          </button>
          <button
            onClick={() => setActiveTab("requests")}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${
              activeTab === "requests"
                ? "bg-primary-600 text-white shadow-md"
                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            <Inbox size={16} className="flex-shrink-0" />
            <span className="hidden md:inline">Non-Contacts</span>{" "}
            {requestsCount > 0 && `(${requestsCount})`}
          </button>
          <button
            onClick={() => setActiveTab("favorites")}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${
              activeTab === "favorites"
                ? "bg-primary-600 text-white shadow-md"
                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            <Star size={16} className="flex-shrink-0" />
            <span className="hidden md:inline">Favorites</span>{" "}
            {favoritesCount > 0 && `(${favoritesCount})`}
          </button>
          <button
            onClick={() => setActiveTab("archived")}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${
              activeTab === "archived"
                ? "bg-primary-600 text-white shadow-md"
                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            <Archive size={16} className="flex-shrink-0" />
            <span className="hidden md:inline">Archived</span>{" "}
            {archivedCount > 0 && `(${archivedCount})`}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {displayedChats.length === 0 && displayedGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 p-8 text-center">
            <div className="bg-primary-50 dark:bg-primary-900/20 p-4 rounded-full mb-4">
              {activeTab === "groups" ? (
                <Users className="w-12 h-12 text-primary-600" />
              ) : activeTab === "requests" ? (
                <Inbox className="w-12 h-12 text-primary-600" />
              ) : activeTab === "individuals" ? (
                <MessageCircle className="w-12 h-12 text-primary-600" />
              ) : (
                <LayoutGrid className="w-12 h-12 text-primary-600" />
              )}
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
              {activeTab === "groups"
                ? "No groups yet"
                : activeTab === "requests"
                  ? "No message requests"
                  : "No chats yet"}
            </h3>
            <p className="text-sm mb-6">
              {activeTab === "groups"
                ? "Create a group to start chatting with multiple people."
                : activeTab === "requests"
                  ? "Messages from non-contacts will appear here."
                  : "Start a new conversation to see it here."}
            </p>
            {activeTab === "groups" ? (
              <button
                onClick={() => navigate({ to: "/create-group" })}
                className="px-6 py-2 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors shadow-sm"
              >
                Create Group
              </button>
            ) : activeTab === "requests" ? (
              <button
                onClick={() => navigate({ to: "/discovery" })}
                className="px-6 py-2 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors shadow-sm"
              >
                Go to Community
              </button>
            ) : activeTab === "individuals" ? (
              <button
                onClick={() => navigate({ to: "/contacts" })}
                className="px-6 py-2 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors shadow-sm"
              >
                Start Personal Chat
              </button>
            ) : (
              <button
                onClick={() =>
                  activeTab === "all" || activeTab === "favorites"
                    ? setFabMenuOpen(true)
                    : navigate({ to: "/contacts" })
                }
                className="px-6 py-2 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors shadow-sm"
              >
                Start Messaging
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {activeTab === "all"
              ? allTimelineItems.map((item, i) => {
                  if (item.kind === "group") {
                    const group = item.group;
                    return (
                      <Link
                        key={`group-${group.group_id}`}
                        to="/groups/$groupId"
                        params={{ groupId: group.group_id }}
                        className={`block rounded-xl p-4 cursor-pointer transition-all duration-200 ${
                          (group.unreadCount || 0) > 0
                            ? "bg-primary-50 dark:bg-primary-900/10 shadow-md hover:shadow-lg border-2 border-primary-200 dark:border-primary-800"
                            : "bg-white dark:bg-gray-800 shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700"
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
                              <h3 className="font-semibold text-gray-900 dark:text-white truncate text-base flex items-center gap-1.5">
                                {group.name}
                                {group.my_role === "creator" ? (
                                  <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                                    creator
                                  </span>
                                ) : group.my_role === "admin" ? (
                                  <span className="text-[10px] bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded font-medium">
                                    admin
                                  </span>
                                ) : null}
                              </h3>
                              <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                                {formatTime(
                                  group.lastMessageDate || group.created_date,
                                )}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-300 truncate">
                              {group.lastMessageUser && (
                                <span className="text-primary-600 dark:text-primary-400 font-medium mr-1">
                                  {group.lastMessageUser}:
                                </span>
                              )}
                              {group.lastMessageType === "charm"
                                ? "✨ Charm sent"
                                : group.lastMessageType === "token"
                                  ? "💰 Token sent"
                                  : group.lastMessageType === "image"
                                    ? "🖼️ Image"
                                    : group.lastMessageType === "file"
                                      ? "📁 File"
                                      : group.lastMessage ||
                                        group.description ||
                                        "No messages yet"}
                            </p>
                          </div>
                        </div>
                      </Link>
                    );
                  }

                  if (item.kind === "channel") {
                    const channel = item.channel;
                    return (
                      <Link
                        key={`channel-${channel.channel_id}`}
                        to="/channels/$channelId"
                        params={{ channelId: channel.channel_id }}
                        className={`block rounded-xl p-4 cursor-pointer transition-all duration-200 ${
                          (channel.unreadCount || 0) > 0
                            ? "bg-sky-50 dark:bg-sky-900/10 shadow-md hover:shadow-lg border-2 border-sky-200 dark:border-sky-800"
                            : "bg-white dark:bg-gray-800 shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative flex-shrink-0">
                            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white shadow-md">
                              <Radio size={24} />
                            </div>
                            {(channel.unreadCount || 0) > 0 && (
                              <div className="absolute -top-1 -right-1 bg-sky-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shadow-md">
                                {channel.unreadCount}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2 mb-1">
                              <h3 className="font-semibold text-gray-900 dark:text-white truncate text-base flex items-center gap-1.5">
                                {channel.name}
                                {channel.admin_publickey === myPublicKey ? (
                                  <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                                    creator
                                  </span>
                                ) : channel.isAdmin ? (
                                  <span className="text-[10px] bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 px-1.5 py-0.5 rounded font-medium">
                                    admin
                                  </span>
                                ) : null}
                              </h3>
                              <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                                {formatTime(
                                  channel.lastMessageDate ||
                                    channel.created_date,
                                )}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-300 truncate">
                              {channel.lastMessage ||
                                channel.description ||
                                "No messages yet"}
                            </p>
                          </div>
                        </div>
                      </Link>
                    );
                  }

                  const chat = item.chat;
                  return (
                    <div
                      key={`chat-${chat.publickey}-${chat.lastMessageDate}-${i}`}
                      onClick={(e) => {
                        if (longPressTriggeredRef.current) {
                          longPressTriggeredRef.current = false;
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        navigate({
                          to: "/chat/$address",
                          params: { address: chat.publickey },
                        });
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        handleContextMenu(
                          e,
                          chat.publickey,
                          chat.archived,
                          chat.favorite,
                        );
                      }}
                      onTouchStart={(e) => {
                        if (longPressTimerRef.current)
                          clearTimeout(longPressTimerRef.current);
                        longPressTriggeredRef.current = false;
                        const touch = e.touches[0];
                        const clientX = touch.clientX;
                        const clientY = touch.clientY;
                        longPressTimerRef.current = setTimeout(() => {
                          longPressTriggeredRef.current = true;
                          const syntheticEvent = {
                            preventDefault: () => {},
                            stopPropagation: () => {},
                            clientX: clientX,
                            clientY: clientY,
                          } as React.MouseEvent;
                          handleContextMenu(
                            syntheticEvent,
                            chat.publickey,
                            chat.archived,
                            chat.favorite,
                          );
                        }, 500);
                      }}
                      onTouchMove={() => {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = null;
                        }
                      }}
                      onTouchEnd={() => {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = null;
                        }
                      }}
                      style={{ WebkitTouchCallout: "none" } as any}
                      className={`block rounded-xl p-4 cursor-pointer transition-all duration-200 select-none ${
                        (chat.unreadCount || 0) > 0
                          ? "bg-primary-50 dark:bg-primary-900/10 shadow-md hover:shadow-lg border-2 border-primary-200 dark:border-primary-800"
                          : "bg-white dark:bg-gray-800 shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                          {chat.publickey === myPublicKey ? (
                            <div className="w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shadow-sm">
                              <Inbox
                                size={24}
                                className="text-primary-600 dark:text-primary-400"
                              />
                            </div>
                          ) : (
                            <img
                              src={getAvatar(chat.publickey)}
                              alt={getName(chat)}
                              className="w-14 h-14 rounded-full object-cover bg-gray-200 dark:bg-gray-700 shadow-md pointer-events-none"
                              onError={(e: any) => {
                                e.target.src = defaultAvatar;
                              }}
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
                                <Star
                                  size={16}
                                  fill="#fbbf24"
                                  stroke="#f59e0b"
                                  className="flex-shrink-0"
                                />
                              )}
                            </h3>
                            <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                              {formatTime(chat.lastMessageDate)}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-300 truncate">
                            {chat.username === "Me" && (
                              <span className="text-primary-600 dark:text-primary-400 font-medium mr-1">
                                You:
                              </span>
                            )}
                            {chat.lastMessageType === "charm"
                              ? "✨ Charm sent"
                              : chat.lastMessageType === "token"
                                ? "💰 Token sent"
                                : chat.lastMessage || ""}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              : displayedGroups.map((group) => (
                  <Link
                    key={group.group_id}
                    to="/groups/$groupId"
                    params={{ groupId: group.group_id }}
                    className={`block rounded-xl p-4 cursor-pointer transition-all duration-200 ${
                      (group.unreadCount || 0) > 0
                        ? "bg-primary-50 dark:bg-primary-900/10 shadow-md hover:shadow-lg border-2 border-primary-200 dark:border-primary-800"
                        : "bg-white dark:bg-gray-800 shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700"
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
                          <h3 className="font-semibold text-gray-900 dark:text-white truncate text-base flex items-center gap-1.5">
                            {group.name}
                            {group.my_role === "creator" ? (
                              <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                                creator
                              </span>
                            ) : group.my_role === "admin" ? (
                              <span className="text-[10px] bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded font-medium">
                                admin
                              </span>
                            ) : null}
                          </h3>
                          <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                            {formatTime(
                              group.lastMessageDate || group.created_date,
                            )}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 truncate">
                          {group.lastMessageUser && (
                            <span className="text-primary-600 dark:text-primary-400 font-medium mr-1">
                              {group.lastMessageUser}:
                            </span>
                          )}
                          {group.lastMessageType === "charm"
                            ? "✨ Charm sent"
                            : group.lastMessageType === "token"
                              ? "💰 Token sent"
                              : group.lastMessageType === "image"
                                ? "🖼️ Image"
                                : group.lastMessageType === "file"
                                  ? "📁 File"
                                  : group.lastMessage ||
                                    group.description ||
                                    "No messages yet"}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}

            {activeTab !== "all" &&
              displayedChannels.map((channel) => (
                <Link
                  key={channel.channel_id}
                  to="/channels/$channelId"
                  params={{ channelId: channel.channel_id }}
                  className={`block rounded-xl p-4 cursor-pointer transition-all duration-200 ${
                    (channel.unreadCount || 0) > 0
                      ? "bg-sky-50 dark:bg-sky-900/10 shadow-md hover:shadow-lg border-2 border-sky-200 dark:border-sky-800"
                      : "bg-white dark:bg-gray-800 shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <div className="w-14 h-14 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white shadow-md">
                        <Radio size={24} />
                      </div>
                      {(channel.unreadCount || 0) > 0 && (
                        <div className="absolute -top-1 -right-1 bg-sky-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shadow-md">
                          {channel.unreadCount}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900 dark:text-white truncate text-base flex items-center gap-1.5">
                          {channel.name}
                          {channel.admin_publickey === myPublicKey ? (
                            <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                              creator
                            </span>
                          ) : channel.isAdmin ? (
                            <span className="text-[10px] bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 px-1.5 py-0.5 rounded font-medium">
                              admin
                            </span>
                          ) : null}
                        </h3>
                        <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                          {formatTime(
                            channel.lastMessageDate || channel.created_date,
                          )}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300 truncate">
                        {channel.lastMessage ||
                          channel.description ||
                          "No messages yet"}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}

            {activeTab !== "all" &&
              displayedChats.map((chat, i) => (
                <div
                  key={i}
                  onClick={(e) => {
                    if (longPressTriggeredRef.current) {
                      longPressTriggeredRef.current = false;
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    navigate({
                      to: "/chat/$address",
                      params: { address: chat.publickey },
                    });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    handleContextMenu(
                      e,
                      chat.publickey,
                      chat.archived,
                      chat.favorite,
                    );
                  }}
                  onTouchStart={(e) => {
                    if (longPressTimerRef.current)
                      clearTimeout(longPressTimerRef.current);
                    longPressTriggeredRef.current = false;
                    const touch = e.touches[0];
                    const clientX = touch.clientX;
                    const clientY = touch.clientY;
                    longPressTimerRef.current = setTimeout(() => {
                      longPressTriggeredRef.current = true;
                      const syntheticEvent = {
                        preventDefault: () => {},
                        stopPropagation: () => {},
                        clientX: clientX,
                        clientY: clientY,
                      } as React.MouseEvent;
                      handleContextMenu(
                        syntheticEvent,
                        chat.publickey,
                        chat.archived,
                        chat.favorite,
                      );
                    }, 500);
                  }}
                  onTouchMove={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  onTouchEnd={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  style={{ WebkitTouchCallout: "none" } as any}
                  className={`block rounded-xl p-4 cursor-pointer transition-all duration-200 select-none ${
                    (chat.unreadCount || 0) > 0
                      ? "bg-primary-50 dark:bg-primary-900/10 shadow-md hover:shadow-lg border-2 border-primary-200 dark:border-primary-800"
                      : "bg-white dark:bg-gray-800 shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      {chat.publickey === myPublicKey ? (
                        <div className="w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shadow-sm">
                          <Inbox
                            size={24}
                            className="text-primary-600 dark:text-primary-400"
                          />
                        </div>
                      ) : (
                        <img
                          src={getAvatar(chat.publickey)}
                          alt={getName(chat)}
                          className="w-14 h-14 rounded-full object-cover bg-gray-200 dark:bg-gray-700 shadow-md pointer-events-none"
                          onError={(e: any) => {
                            e.target.src = defaultAvatar;
                          }}
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
                            <Star
                              size={16}
                              fill="#fbbf24"
                              stroke="#f59e0b"
                              className="flex-shrink-0"
                            />
                          )}
                        </h3>
                        <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                          {formatTime(chat.lastMessageDate)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300 truncate">
                        {chat.username === "Me" && (
                          <span className="text-primary-600 dark:text-primary-400 font-medium mr-1">
                            You:
                          </span>
                        )}
                        {chat.lastMessageType === "charm"
                          ? "✨ Charm sent"
                          : chat.lastMessageType === "token"
                            ? "💰 Token sent"
                            : chat.lastMessage || ""}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* FAB Menu Actions */}
      {fabMenuOpen && (activeTab === "all" || activeTab === "favorites") && (
        <div className="fixed bottom-24 right-6 flex flex-col items-end gap-3 z-50">
          <button
            onClick={() => {
              setFabMenuOpen(false);
              setShowJoinModal(true);
            }}
            className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-gray-800 rounded-full shadow-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all border border-gray-100 dark:border-gray-700"
          >
            <span className="font-medium text-sm">Join via Link</span>
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600">
              <Plus size={20} />
            </div>
          </button>
          <button
            onClick={() => {
              setFabMenuOpen(false);
              navigate({ to: "/create-group" });
            }}
            className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-gray-800 rounded-full shadow-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all border border-gray-100 dark:border-gray-700"
          >
            <span className="font-medium text-sm">New Group</span>
            <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600">
              <Users size={20} />
            </div>
          </button>
          <button
            onClick={() => {
              setFabMenuOpen(false);
              navigate({ to: "/create-channel" });
            }}
            className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-gray-800 rounded-full shadow-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all border border-gray-100 dark:border-gray-700"
          >
            <span className="font-medium text-sm">New Channel</span>
            <div className="w-10 h-10 rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center text-sky-600">
              <Radio size={20} />
            </div>
          </button>
          <button
            onClick={() => {
              setFabMenuOpen(false);
              navigate({ to: "/contacts" });
            }}
            className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-gray-800 rounded-full shadow-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all border border-gray-100 dark:border-gray-700"
          >
            <span className="font-medium text-sm">New Chat</span>
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600">
              <UserPlus size={20} />
            </div>
          </button>
        </div>
      )}

      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => {
            if (activeTab === "groups") navigate({ to: "/create-group" });
            else if (activeTab === "requests") navigate({ to: "/discovery" });
            else if (activeTab === "all" || activeTab === "favorites")
              setFabMenuOpen(!fabMenuOpen);
            else navigate({ to: "/contacts" });
          }}
          className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 ${
            fabMenuOpen
              ? "bg-gray-700 text-white rotate-45"
              : "bg-primary-600 text-white"
          }`}
        >
          {activeTab === "groups" ? (
            <Users size={24} />
          ) : activeTab === "requests" ? (
            <Globe size={24} />
          ) : activeTab === "individuals" ? (
            <UserPlus size={24} />
          ) : activeTab === "all" || activeTab === "favorites" ? (
            <Plus size={24} />
          ) : (
            <MessageSquarePlus size={24} />
          )}
        </button>
      </div>

      {/* Join Link Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl relative overflow-hidden">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
              <UserPlus className="text-primary-500" />
              Join Group
            </h3>

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Paste the invite link to join a group.
            </p>

            <textarea
              value={joinLink}
              onChange={(e) => {
                setJoinLink(e.target.value);
                setJoinError("");
              }}
              className="w-full h-24 p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white resize-none mb-1 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              placeholder="mcgrp://..."
              disabled={joiningGroup}
            />
            {joinError && (
              <p className="text-xs text-red-500 mb-3">{joinError}</p>
            )}
            {!joinError && <div className="mb-3 h-4" />}

            <div className="flex gap-3 justify-end mt-4">
              <button
                onClick={() => {
                  setShowJoinModal(false);
                  setJoinLink("");
                  setJoinError("");
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
                disabled={joiningGroup}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!joinLink) {
                    setJoinError("Please enter a link");
                    return;
                  }
                  setJoiningGroup(true);
                  setJoinError("");
                  try {
                    await groupService.sendJoinRequest(joinLink);
                    setShowJoinModal(false);
                    setJoinLink("");
                  } catch (err: any) {
                    console.error("Join failed:", err);
                    setJoinError(err || "Failed to process link.");
                  } finally {
                    setJoiningGroup(false);
                  }
                }}
                disabled={joiningGroup || !joinLink}
                className="px-6 py-2 bg-primary-600 text-white font-medium rounded-lg shadow-md shadow-primary-500/30 hover:bg-primary-500 active:scale-95 transition-all disabled:opacity-50"
              >
                {joiningGroup ? "Sending..." : "Request to Join"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
