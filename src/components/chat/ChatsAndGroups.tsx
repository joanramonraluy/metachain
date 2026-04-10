// src/components/chat/ChatsAndGroups.tsx

import { useState, useContext, useEffect } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { appContext } from "../../AppContext";
import { useTheme } from "../../context/ThemeContext";
import { minimaService } from "../../services/minima.service";
import { groupService } from "../../services/group.service";
import { channelService } from "../../services/channel.service";
import { MDS } from "@minima-global/mds";
import {
  Plus,
  Archive,
  Star,
  Info,
  Users,
  MessageCircle,
  LayoutGrid,
  Inbox,
  Globe,
  Radio,
  UserPlus,
  MessageSquarePlus,
  MessageSquare,
} from "lucide-react";
import EmptyState from "../common/EmptyState";

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
  avatar?: string;
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
  archived_date?: number;
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
  archived?: boolean;
  archived_date?: number;
  favorite?: boolean;
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
  avatar?: string;
  archived?: boolean;
  archived_date?: number;
  favorite?: boolean;
}

export default function ChatsAndGroups() {
  const { loaded, dbReady, myPublicKey } = useContext(appContext);
  const { mode, chatBackground } = useTheme();
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

  const handleArchive = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      if (groups.some((g) => g.group_id === id)) {
        await groupService.archiveGroup(id);
      } else if (channels.some((c) => c.channel_id === id)) {
        await channelService.archiveChannel(id);
      } else {
        await minimaService.archiveChat(id);
      }
    } catch (err) {
      console.error("❌ Archive error:", err);
    }
  };

  const handleUnarchive = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      if (groups.some((g) => g.group_id === id)) {
        await groupService.unarchiveGroup(id);
      } else if (channels.some((c) => c.channel_id === id)) {
        await channelService.unarchiveChannel(id);
      } else {
        await minimaService.unarchiveChat(id);
      }
    } catch (err) {
      console.error("❌ Unarchive error:", err);
    }
  };

  const handleShowProfile = (publickey: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    navigate({ to: `/contact-info/${publickey}` });
  };

  const handleShowGroupInfo = (groupId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.nativeEvent) {
      e.nativeEvent.stopImmediatePropagation();
    }
    
    setTimeout(() => {
      navigate({ to: `/group-info/${groupId}` });
    }, 10);
  };

  const handleShowChannelInfo = (channelId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.nativeEvent) {
      e.nativeEvent.stopImmediatePropagation();
    }
    
    setTimeout(() => {
      navigate({ to: `/channel-info/${channelId}` });
    }, 10);
  };

  const handleToggleFavorite = async (
    publickey: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const chat = chats.find((c) => c.publickey === publickey);
      const group = groups.find((g) => g.group_id === publickey);
      const channel = channels.find((c) => c.channel_id === publickey);

      if (chat) {
        if (chat.favorite) {
          await minimaService.unmarkChatAsFavorite(publickey);
        } else {
          await minimaService.markChatAsFavorite(publickey);
        }
      } else if (group) {
        if (group.favorite) {
          await groupService.unfavoriteGroup(publickey);
        } else {
          await groupService.favoriteGroup(publickey);
        }
      } else if (channel) {
        if (channel.favorite) {
          await channelService.unfavoriteChannel(publickey);
        } else {
          await channelService.favoriteChannel(publickey);
        }
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
          const messages = await groupService.getGroupMessages(group.group_id).catch(() => [] as any[]);
          const unreadCount = messages.filter(
            (m: any) => m.READ === 0 || m.read === 0,
          ).length;
          const lastMsg =
            messages.length > 0 ? (messages[messages.length - 1] as any) : null;
          const lastMessageDate = lastMsg
            ? Number(lastMsg.DATE || lastMsg.date || 0)
            : group.created_date;
          const lastMessage = lastMsg ? lastMsg.MESSAGE || lastMsg.message : "";
          const lastMessageType = lastMsg
            ? lastMsg.TYPE || lastMsg.type
            : "text";
          let lastMessageUser = lastMsg
            ? lastMsg.SENDER_USERNAME || lastMsg.sender_username
            : "";

          if (lastMsg && lastMsg.SENDER_PUBLICKEY === myPublicKey) {
            lastMessageUser = "You";
          }
          if (lastMsg && lastMsg.TYPE === "system") {
            lastMessageUser = "";
          }

          return {
            ...group,
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
          const msgs = await channelService.getChannelMessages(ch.channel_id);
          const unreadCount = msgs.filter(
            (m: any) => m.READ === 0 || m.read === 0,
          ).length;
          const lastMsg =
            msgs.length > 0 ? (msgs[msgs.length - 1] as any) : null;
          const isAdm = await channelService.isAdmin(
            ch.channel_id,
            myPublicKey,
          );
          return {
            ...ch,
            unreadCount,
            lastMessageDate: lastMsg
              ? Number(lastMsg.DATE || lastMsg.date || 0)
              : Number(ch.created_date || 0),
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
      const withTimeout = (promise: Promise<any>, ms: number = 3000) => {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Request timed out")), ms),
        );
        return Promise.race([promise, timeout]);
      };

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
          localStorage.setItem("cached_contacts", JSON.stringify(contactsList));
        } catch (err) {
          console.warn(
            "⚠️ [ChatsAndGroups] Failed to fetch contacts (Offline/Timeout):",
            err,
          );
        }
      };

      const p2_peers = async () => {
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

      void p1_contacts();
      void p2_peers();

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

  const activeChats = chats.filter((c) => !c.archived);
  const activeGroups = groups.filter((g) => !g.archived);
  const activeChannels = channels.filter((c) => !c.archived);

  const isContact = (publickey: string) => {
    if (publickey === myPublicKey) return true;
    return contacts.has(publickey);
  };

  const contactChats = activeChats.filter((c) => isContact(c.publickey));
  const requestChats = activeChats.filter((c) => !isContact(c.publickey));

  const individualChats = contactChats;
  const favoriteChats = chats.filter((c) => c.favorite && !c.archived);
  const archivedChats = chats.filter((c) => c.archived);
  const favoriteGroups = groups.filter((g) => g.favorite && !g.archived);
  const archivedGroups: GroupWithUnread[] = groups.filter((g) => g.archived);
  const favoriteChannels = channels.filter((c) => c.favorite && !c.archived);
  const archivedChannels: ChannelWithUnread[] = channels.filter(
    (c) => c.archived,
  );

  let displayedChats: ChatItem[] = [];
  let displayedGroups: GroupWithUnread[] = [];
  let displayedChannels: ChannelWithUnread[] = [];

  switch (activeTab) {
    case "all":
      displayedChats = activeChats;
      displayedGroups = activeGroups;
      displayedChannels = activeChannels;
      break;
    case "individuals":
      displayedChats = individualChats;
      displayedGroups = [];
      displayedChannels = [];
      break;
    case "groups":
      displayedChats = [];
      displayedGroups = activeGroups;
      displayedChannels = [];
      break;
    case "channels":
      displayedChats = [];
      displayedGroups = [];
      displayedChannels = activeChannels;
      break;
    case "requests":
      displayedChats = requestChats;
      displayedGroups = [];
      displayedChannels = [];
      break;
    case "favorites":
      displayedChats = favoriteChats;
      displayedGroups = favoriteGroups;
      displayedChannels = favoriteChannels;
      break;
    case "archived":
      displayedChats = archivedChats;
      displayedGroups = archivedGroups;
      displayedChannels = archivedChannels;
      break;
  }

  const allTimelineItems =
    activeTab === "all" || activeTab === "archived" || activeTab === "favorites"
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
        ].sort((a, b) => {
          const aItem =
            a.kind === "group"
              ? a.group
              : a.kind === "channel"
                ? a.channel
                : a.chat;
          const bItem =
            b.kind === "group"
              ? b.group
              : b.kind === "channel"
                ? b.channel
                : b.chat;

          if (activeTab === "archived") {
            return (
              Number(bItem.archived_date || 0) -
              Number(aItem.archived_date || 0)
            );
          }

          if (aItem.favorite && !bItem.favorite) return -1;
          if (!aItem.favorite && bItem.favorite) return 1;

          return b.sortDate - a.sortDate;
        })
      : [];

  const defaultAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

  const decodeStoredAvatar = (avatar?: string | null) => {
    if (!avatar || avatar === "0x00") return "";

    const candidates = [avatar];
    try {
      candidates.unshift(decodeURIComponent(avatar));
    } catch (err) {
      console.warn("⚠️ Error decoding avatar:", err);
    }

    const validAvatar = candidates.find(
      (candidate) =>
        candidate &&
        candidate.startsWith("data:image") &&
        !candidate.includes("/0x00"),
    );

    return validAvatar || "";
  };

  const getAvatar = (chat: ChatItem) => {
    const contact = contacts.get(chat.publickey);
    const contactAvatar = decodeStoredAvatar(contact?.extradata?.icon);
    if (contactAvatar) {
      return contactAvatar;
    }

    const chatAvatar = decodeStoredAvatar(chat.avatar);
    if (chatAvatar) {
      return chatAvatar;
    }

    const peerAvatar = decodeStoredAvatar(
      chats.find((item) => item.publickey === chat.publickey)?.avatar,
    );
    if (peerAvatar) {
      return peerAvatar;
    }

    return defaultAvatar;
  };

  const getName = (chat: ChatItem) => {
    if (chat.publickey === myPublicKey) return "Notes to Self";

    const contact = contacts.get(chat.publickey);
    if (contact?.extradata?.name) return contact.extradata.name;

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
  const favoritesCount =
    favoriteChats.length + favoriteGroups.length + favoriteChannels.length;
  const archivedCount =
    archivedChats.length + archivedGroups.length + archivedChannels.length;

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 transition-colors relative overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        ></div>
      </div>

      {chatBackground === "soft-gradient" && (
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-white via-gray-50 to-blue-50/30 dark:from-gray-950 dark:via-gray-950 dark:to-primary-950/20"></div>

          <div
            className="absolute -top-[10%] -left-[10%] w-[60%] h-[60%] rounded-full opacity-40 dark:opacity-20 blur-[120px] animate-pulse"
            style={{
              background:
                mode === "dark"
                  ? "radial-gradient(circle, var(--color-primary-900) 0%, transparent 70%)"
                  : "radial-gradient(circle, var(--color-primary-200) 0%, transparent 70%)",
              animationDuration: "8s",
            }}
          ></div>
          <div
            className="absolute -bottom-[10%] -right-[10%] w-[50%] h-[50%] rounded-full opacity-30 dark:opacity-10 blur-[120px] animate-pulse"
            style={{
              background:
                mode === "dark"
                  ? "radial-gradient(circle, var(--color-primary-800) 0%, transparent 70%)"
                  : "radial-gradient(circle, var(--color-primary-300) 0%, transparent 70%)",
              animationDuration: "12s",
              animationDelay: "2s",
            }}
          ></div>
        </div>
      )}

      <div className="sticky top-0 z-40 w-full flex items-center justify-center border-b border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-3xl overflow-x-auto no-scrollbar scrollbar-hide px-3 sm:px-6">
        <div className="flex items-center gap-1 sm:gap-4 md:gap-6">
          {(["all", "favorites", "individuals", "requests", "groups", "channels", "archived"] as const).map((tab) => {
            const isActive = activeTab === tab;
            const config = {
              all: { icon: LayoutGrid, label: "All", count: totalCount, color: "indigo" },
              favorites: { icon: Star, label: "Starred", count: favoritesCount, color: "amber" },
              individuals: { icon: MessageCircle, label: "Contacts", count: individualsCount, color: "indigo" },
              requests: { icon: Globe, label: "Community", count: requestsCount, color: "emerald" },
              groups: { icon: Users, label: "Groups", count: groupsCount, color: "violet" },
              channels: { icon: Radio, label: "Channels", count: channelsCount, color: "sky" },
              archived: { icon: Archive, label: "Archived", count: archivedCount, color: "rose" },
            }[tab];
            
            const Icon = config.icon;
            const colors = {
              indigo: "text-indigo-500 bg-indigo-500 shadow-indigo-500/50",
              amber: "text-amber-500 bg-amber-500 shadow-amber-500/50",
              emerald: "text-emerald-500 bg-emerald-500 shadow-emerald-500/50",
              violet: "text-violet-500 bg-violet-500 shadow-violet-500/50",
              sky: "text-sky-500 bg-sky-500 shadow-sky-500/50",
              rose: "text-rose-500 bg-rose-500 shadow-rose-500/50",
            }[config.color] || "text-primary-500 bg-primary-500 shadow-primary-500/50";

            const colorClass = colors.split(" ")[0];
            const bgClass = colors.split(" ")[1];
            const glowClass = colors.split(" ")[2];

            if (tab === "archived" && archivedCount === 0) return null;

            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative px-3 py-4 sm:py-5 flex items-center gap-2 transition-all duration-300 group flex-shrink-0 ${
                  isActive ? colorClass : "text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                <div className={`transition-all duration-500 ${isActive ? "scale-110" : "group-hover:scale-110"}`}>
                  <Icon size={16} strokeWidth={isActive ? 3 : 2.5} />
                </div>
                <span className="hidden sm:inline text-[11px] font-black tracking-widest uppercase">
                  {config.label}
                </span>
                <span className="opacity-40 text-[10px] font-bold">({config.count})</span>

                {/* Underline Indicator */}
                {isActive && (
                  <div className={`absolute bottom-0 left-0 right-0 h-1 rounded-full ${bgClass} shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${glowClass} animate-in fade-in zoom-in duration-500`} />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 scrollbar-hide no-scrollbar pb-24">
        {displayedChats.length === 0 &&
        displayedGroups.length === 0 &&
        displayedChannels.length === 0 ? (
          <EmptyState
            icon={
              activeTab === "groups"
                ? Users
                : activeTab === "requests"
                  ? Globe
                  : activeTab === "individuals"
                    ? MessageCircle
                    : activeTab === "archived"
                      ? Archive
                      : activeTab === "favorites"
                        ? Star
                        : MessageSquare
            }
            title={
              activeTab === "groups"
                ? "No groups yet"
                : activeTab === "requests"
                  ? "No community users yet"
                  : activeTab === "archived"
                    ? "No archived chats"
                    : activeTab === "favorites"
                      ? "No favorites yet"
                      : "No conversations"
            }
            description={
              activeTab === "groups"
                ? "Create a group to start chatting with multiple people."
                : activeTab === "requests"
                  ? "Users outside your Contacts will appear here."
                  : activeTab === "archived"
                    ? "Archived chats and groups will appear here."
                    : activeTab === "favorites"
                      ? "Mark messages as favorite to see them here."
                      : (
                        <span>
                          Start a new conversation to see it here or{" "}
                          <button
                            onClick={() => navigate({ to: "/discovery" })}
                            className="text-primary-500 hover:underline font-black"
                          >
                            browse the Community
                          </button>
                          .
                        </span>
                      )
            }
            action={
              activeTab === "groups"
                ? {
                    label: "Create Group",
                    onClick: () => navigate({ to: "/create-group" }),
                  }
                : activeTab === "requests"
                  ? {
                      label: "Go to Community",
                      onClick: () => navigate({ to: "/discovery" }),
                    }
                  : activeTab === "individuals"
                    ? {
                        label: "Find Contacts",
                        onClick: () => navigate({ to: "/contacts" }),
                      }
                    : activeTab === "archived" || activeTab === "favorites"
                      ? {
                          label: "Start Messaging",
                          onClick: () => navigate({ to: "/contacts" }),
                        }
                      : {
                          label: "Start Messaging",
                          onClick: () => setFabMenuOpen(true),
                        }
            }
            secondaryAction={
              activeTab !== "requests" && activeTab !== "groups"
                ? {
                    label: "Browse Community",
                    onClick: () => navigate({ to: "/discovery" }),
                  }
                : undefined
            }
            className="h-full"
          />
        ) : (
          <div className="space-y-3">
            {activeTab === "all"
              ? allTimelineItems.map((item) => {
                  if (item.kind === "group") {
                    const group = item.group;
                    return (
                      <div
                        key={`group-${group.group_id}`}
                        onClick={() => {
                          navigate({
                            to: "/groups/$groupId",
                            params: { groupId: group.group_id },
                          });
                        }}
                        className={`block rounded-[2.5rem] p-6 cursor-pointer transition-all duration-300 relative z-10 group overflow-hidden ${
                          (group.unreadCount || 0) > 0
                            ? "bg-primary-500/15 dark:bg-primary-500/20 shadow-xl shadow-primary-500/10 border border-primary-500/30"
                            : "bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 shadow-lg shadow-black/5"
                        } hover:scale-[1.02] active:scale-95 hover:shadow-2xl hover:z-20`}
                      >
                        <div className="flex items-center gap-5">
                          <div className="relative flex-shrink-0">
                            {group.avatar ? (
                              <img
                                src={group.avatar}
                                alt={group.name}
                                className="w-16 h-16 rounded-[1.5rem] object-cover bg-gray-200 dark:bg-gray-700 shadow-2xl pointer-events-none"
                                onError={(e: any) => {
                                  e.target.src = defaultAvatar;
                                }}
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-black text-2xl shadow-2xl">
                                {((group.name as string) || "?")
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                            {(group.unreadCount || 0) > 0 && (
                              <div className="absolute -top-2 -right-2 bg-primary-500 text-white text-[10px] font-black rounded-full w-7 h-7 flex items-center justify-center shadow-lg shadow-primary-500/40 ring-2 ring-white dark:ring-gray-900 animate-in zoom-in duration-300">
                                {group.unreadCount}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2 mb-1.5">
                              <h3 className="font-black text-gray-900 dark:text-white truncate text-base flex items-center gap-2 leading-tight uppercase tracking-tight">
                                {group.name}
                                {group.favorite && (
                                  <Star
                                    size={14}
                                    fill="var(--color-primary-500)"
                                    className="text-primary-500 flex-shrink-0"
                                  />
                                )}
                                {group.my_role === "creator" ? (
                                  <span className="text-[9px] bg-primary-500/10 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded-full font-black uppercase tracking-wider">
                                    creator
                                  </span>
                                ) : group.my_role === "admin" ? (
                                  <span className="text-[9px] bg-primary-500/10 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded-full font-black uppercase tracking-wider">
                                    admin
                                  </span>
                                ) : null}
                              </h3>
                              <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 font-black uppercase tracking-widest bg-black/5 dark:bg-white/5 px-2 py-1 rounded-lg">
                                {formatTime(
                                  group.lastMessageDate || group.created_date,
                                )}
                              </span>
                            </div>
                            <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate font-bold">
                              {group.lastMessageUser && (
                                <span className="text-primary-600 dark:text-primary-400 font-black mr-2">
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

                          <div className="flex items-center gap-1.5 ml-2 transition-all">
                            <button
                              onClick={(e) => {
                                handleToggleFavorite(group.group_id, e);
                              }}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                                group.favorite
                                  ? "bg-amber-500/20 text-amber-500"
                                  : "bg-black/5 dark:bg-white/5 text-gray-400 hover:bg-amber-500/10 hover:text-amber-500"
                              }`}
                              title={group.favorite ? "Unfavorite" : "Favorite"}
                            >
                              <Star
                                size={14}
                                strokeWidth={3}
                                fill={group.favorite ? "currentColor" : "none"}
                              />
                            </button>

                            <button
                              onClick={(e) => {
                                group.archived
                                  ? handleUnarchive(group.group_id, e)
                                  : handleArchive(group.group_id, e);
                              }}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                                group.archived
                                  ? "bg-orange-500/20 text-orange-500"
                                  : "bg-black/5 dark:bg-white/5 text-gray-400 hover:bg-orange-500/10 hover:text-orange-500"
                              }`}
                              title={group.archived ? "Unarchive" : "Archive"}
                            >
                              <Archive size={14} strokeWidth={3} />
                            </button>

                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                navigate({
                                  to: "/group-info/$groupId",
                                  params: { groupId: group.group_id },
                                });
                              }}
                              className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 text-primary-500 dark:text-primary-400 hover:bg-primary-500 hover:text-white flex items-center justify-center transition-all"
                              title="Group Info"
                            >
                              <Info size={14} strokeWidth={3} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (item.kind === "channel") {
                    const channel = item.channel;
                    return (
                      <div
                        key={`channel-${channel.channel_id}`}
                        onClick={() => {
                          navigate({
                            to: "/channels/$channelId",
                            params: { channelId: channel.channel_id },
                          });
                        }}
                        className={`block rounded-[2.5rem] p-6 cursor-pointer transition-all duration-300 relative z-10 group overflow-hidden ${
                          (channel.unreadCount || 0) > 0
                            ? "bg-sky-500/15 dark:bg-sky-500/20 shadow-xl shadow-sky-500/10 border border-sky-500/30"
                            : "bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 shadow-lg shadow-black/5"
                        } hover:scale-[1.02] active:scale-95 hover:shadow-2xl hover:z-20`}
                      >
                        <div className="flex items-center gap-5">
                          <div className="relative flex-shrink-0">
                            {channel.avatar ? (
                              <img
                                src={channel.avatar}
                                alt={channel.name}
                                className="w-16 h-16 rounded-[1.5rem] object-cover bg-gray-200 dark:bg-gray-700 shadow-2xl pointer-events-none"
                                onError={(e: any) => {
                                  e.target.src = defaultAvatar;
                                }}
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white shadow-2xl transition-transform duration-500 group-hover:scale-110">
                                <Radio size={28} strokeWidth={2.5} />
                              </div>
                            )}
                            {(channel.unreadCount || 0) > 0 && (
                              <div className="absolute -top-2 -right-2 bg-sky-500 text-white text-[10px] font-black rounded-full w-7 h-7 flex items-center justify-center shadow-lg shadow-sky-500/40 ring-2 ring-white dark:ring-gray-900 animate-in zoom-in duration-300">
                                {channel.unreadCount}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2 mb-1.5">
                              <h3 className="font-black text-gray-900 dark:text-white truncate text-base flex items-center gap-2 leading-tight uppercase tracking-tight">
                                {channel.name}
                                {channel.favorite && (
                                  <Star
                                    size={14}
                                    fill="var(--color-primary-500)"
                                    className="text-primary-500 flex-shrink-0"
                                  />
                                )}
                                {(
                                  channel.admin_publickey || ""
                                ).toUpperCase() ===
                                (myPublicKey || "").toUpperCase() ? (
                                  <span className="text-[9px] bg-primary-500/10 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded-full font-black uppercase tracking-wider">
                                    creator
                                  </span>
                                ) : channel.isAdmin ? (
                                  <span className="text-[9px] bg-sky-500/10 text-sky-600 dark:text-sky-400 px-1.5 py-0.5 rounded-full font-black uppercase tracking-wider">
                                    admin
                                  </span>
                                ) : null}
                              </h3>
                              <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 font-black uppercase tracking-widest bg-black/5 dark:bg-white/5 px-2 py-1 rounded-lg">
                                {formatTime(
                                  channel.lastMessageDate ||
                                    channel.created_date,
                                )}
                              </span>
                            </div>
                            <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate font-bold">
                              {channel.lastMessage ||
                                channel.description ||
                                "No messages yet"}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 ml-2 transition-all">
                            <button
                              onClick={(e) => {
                                handleToggleFavorite(channel.channel_id, e);
                              }}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                                channel.favorite
                                  ? "bg-amber-500/20 text-amber-500"
                                  : "bg-black/5 dark:bg-white/5 text-gray-400 hover:bg-amber-500/10 hover:text-amber-500"
                              }`}
                              title={channel.favorite ? "Unfavorite" : "Favorite"}
                            >
                              <Star
                                size={14}
                                strokeWidth={3}
                                fill={channel.favorite ? "currentColor" : "none"}
                              />
                            </button>

                            <button
                              onClick={(e) => {
                                channel.archived
                                  ? handleUnarchive(channel.channel_id, e)
                                  : handleArchive(channel.channel_id, e);
                              }}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                                channel.archived
                                  ? "bg-orange-500/20 text-orange-500"
                                  : "bg-black/5 dark:bg-white/5 text-gray-400 hover:bg-orange-500/10 hover:text-orange-500"
                              }`}
                              title={channel.archived ? "Unarchive" : "Archive"}
                            >
                              <Archive size={14} strokeWidth={3} />
                            </button>

                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                navigate({
                                  to: "/channel-info/$channelId",
                                  params: { channelId: channel.channel_id },
                                });
                              }}
                              className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 text-primary-500 dark:text-primary-400 hover:bg-primary-500 hover:text-white flex items-center justify-center transition-all"
                              title="Channel Info"
                            >
                              <Info size={14} strokeWidth={3} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const chat = item.chat;
                  return (
                    <div
                      key={chat.publickey}
                      onClick={(e) => {
                        if (e.defaultPrevented) return;
                        navigate({
                          to: "/chat/$address",
                          params: { address: chat.publickey },
                        });
                      }}
                      style={{ WebkitTouchCallout: "none" } as any}
                      className={`block rounded-[2.5rem] p-6 cursor-pointer transition-all duration-300 relative z-10 group overflow-hidden ${
                        (chat.unreadCount || 0) > 0
                          ? "bg-primary-500/15 dark:bg-primary-500/20 shadow-xl shadow-primary-500/10 border border-primary-500/30"
                          : "bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 shadow-lg shadow-black/5"
                      } hover:scale-[1.02] active:scale-95 hover:shadow-2xl hover:z-20`}
                    >
                      <div className="flex items-center gap-5">
                        <div className="relative flex-shrink-0">
                          {chat.publickey === myPublicKey ? (
                            <div className="w-16 h-16 rounded-[1.5rem] bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shadow-2xl">
                              <Inbox
                                size={28}
                                className="text-primary-600 dark:text-primary-400"
                              />
                            </div>
                          ) : (
                            <img
                              src={getAvatar(chat)}
                              alt={getName(chat)}
                              className="w-16 h-16 rounded-[1.5rem] object-cover bg-gray-200 dark:bg-gray-700 shadow-2xl pointer-events-none"
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
                            <div className="absolute -top-2 -right-2 bg-primary-500 text-white text-[10px] font-black rounded-full w-7 h-7 flex items-center justify-center shadow-lg shadow-primary-500/40 ring-2 ring-white dark:ring-gray-900 animate-in zoom-in duration-300">
                              {chat.unreadCount}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2 mb-1.5">
                            <h3 className="font-black text-gray-900 dark:text-white truncate flex items-center gap-2 text-base leading-tight uppercase tracking-tight">
                              {getName(chat)}
                              {chat.favorite && (
                                <Star
                                  size={16}
                                  fill="var(--color-primary-500)"
                                  className="text-primary-500 flex-shrink-0"
                                />
                              )}
                            </h3>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 font-black uppercase tracking-widest bg-black/5 dark:bg-white/5 px-2 py-1 rounded-lg">
                              {formatTime(chat.lastMessageDate)}
                            </span>
                          </div>
                          <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate font-bold">
                            {chat.username === "Me" && (
                              <span className="text-primary-600 dark:text-primary-400 font-black mr-2">
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

                        <div className="flex items-center gap-1 ml-2 transition-all relative z-50">
                          <button
                            onClick={(e) => {
                              handleToggleFavorite(chat.publickey, e);
                            }}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                              chat.favorite
                                ? "bg-amber-500/20 text-amber-500"
                                : "bg-black/5 dark:bg-white/5 text-gray-400 hover:bg-amber-500/10 hover:text-amber-500"
                            }`}
                            title={chat.favorite ? "Unfavorite" : "Favorite"}
                          >
                            <Star
                              size={14}
                              strokeWidth={3}
                              fill={chat.favorite ? "currentColor" : "none"}
                            />
                          </button>

                          <button
                            onClick={(e) => {
                              chat.archived
                                ? handleUnarchive(chat.publickey, e)
                                : handleArchive(chat.publickey, e);
                            }}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                              chat.archived
                                ? "bg-orange-500/20 text-orange-500"
                                : "bg-black/5 dark:bg-white/5 text-gray-400 hover:bg-orange-500/10 hover:text-orange-500"
                            }`}
                            title={chat.archived ? "Unarchive" : "Archive"}
                          >
                            <Archive size={14} strokeWidth={3} />
                          </button>

                          <button
                            onClick={(e) => handleShowProfile(chat.publickey, e)}
                            className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 text-primary-500 dark:text-primary-400 hover:bg-primary-500 hover:text-white flex items-center justify-center transition-all"
                            title="Contact Info"
                          >
                            <Info size={14} strokeWidth={3} />
                          </button>
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
                    className={`block rounded-[2.5rem] p-6 cursor-pointer transition-all duration-500 relative z-10 group overflow-hidden mb-4 ${
                      (group.unreadCount || 0) > 0
                        ? "bg-primary-500/15 dark:bg-primary-500/20 shadow-xl shadow-primary-500/10 border border-primary-500/30"
                        : "bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 shadow-lg shadow-black/5"
                    } hover:scale-[1.02] active:scale-95 hover:shadow-2xl hover:z-20`}
                  >
                    <div className="flex items-center gap-5">
                      <div className="relative flex-shrink-0">
                        {group.avatar ? (
                          <img
                            src={group.avatar}
                            alt={group.name}
                            className="w-16 h-16 rounded-[1.5rem] object-cover bg-gray-200 dark:bg-gray-700 shadow-2xl pointer-events-none transition-transform duration-500 group-hover:scale-110"
                            onError={(e: any) => {
                              e.target.src = defaultAvatar;
                            }}
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-black text-2xl shadow-2xl group-hover:scale-110 transition-transform duration-500">
                            {((group.name as string) || "?")
                              .charAt(0)
                              .toUpperCase()}
                          </div>
                        )}
                        {(group.unreadCount || 0) > 0 && (
                          <div className="absolute -top-2 -right-2 bg-primary-500 text-white text-[10px] font-black rounded-full w-7 h-7 flex items-center justify-center shadow-2xl shadow-primary-500/50 ring-2 ring-white dark:ring-gray-900 animate-in zoom-in duration-500">
                            {group.unreadCount}
                          </div>
                        )}
                      </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2 mb-1.5">
                            <h3 className="font-black text-gray-900 dark:text-white truncate text-base flex items-center gap-2 leading-tight uppercase tracking-tight">
                              {group.name}
                              {group.favorite && (
                                <Star
                                  size={16}
                                  fill="var(--color-primary-500)"
                                  className="text-primary-500 flex-shrink-0"
                                  strokeWidth={3}
                                />
                              )}
                            </h3>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 font-black uppercase tracking-widest bg-black/5 dark:bg-white/5 px-2 py-1 rounded-lg">
                              {formatTime(
                                group.lastMessageDate || group.created_date,
                              )}
                            </span>
                          </div>
                        <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate font-bold">
                          {group.lastMessageUser && (
                            <span className="text-primary-600 dark:text-primary-400 font-black mr-2">
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

                      <div className="flex items-center gap-1.5 ml-2 transition-all relative z-50">
                        <button
                          onClick={(e) => {
                            handleToggleFavorite(group.group_id, e);
                          }}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                            group.favorite
                              ? "bg-amber-500/20 text-amber-500"
                              : "bg-black/5 dark:bg-white/5 text-gray-400 hover:bg-amber-500/10 hover:text-amber-500"
                          }`}
                        >
                          <Star
                            size={14}
                            strokeWidth={3}
                            fill={group.favorite ? "currentColor" : "none"}
                          />
                        </button>

                        <button
                          onClick={(e) => handleShowGroupInfo(group.group_id, e)}
                          className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 text-primary-500 dark:text-primary-400 hover:bg-primary-500 hover:text-white flex items-center justify-center transition-all"
                          title="Group Info"
                        >
                          <Info size={14} strokeWidth={3} />
                        </button>
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
                  className={`block rounded-[2.5rem] p-6 cursor-pointer transition-all duration-500 relative z-10 group overflow-hidden mb-4 ${
                    (channel.unreadCount || 0) > 0
                      ? "bg-sky-500/15 dark:bg-sky-500/20 shadow-xl shadow-sky-500/10 border border-sky-500/30"
                      : "bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 shadow-lg shadow-black/5"
                  } hover:scale-[1.02] active:scale-95 hover:shadow-2xl hover:z-20`}
                >
                  <div className="flex items-center gap-5">
                    <div className="relative flex-shrink-0">
                      <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white shadow-2xl group-hover:scale-110 transition-transform duration-500">
                        <Radio size={28} strokeWidth={2.5} />
                      </div>
                      {(channel.unreadCount || 0) > 0 && (
                        <div className="absolute -top-2 -right-2 bg-sky-500 text-white text-[10px] font-black rounded-full w-7 h-7 flex items-center justify-center shadow-2xl shadow-sky-500/50 ring-2 ring-white dark:ring-gray-900 animate-in zoom-in duration-300">
                          {channel.unreadCount}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-1.5">
                        <h3 className="font-black text-gray-900 dark:text-white truncate text-base flex items-center gap-2 leading-tight uppercase tracking-tight">
                          {channel.name}
                          {channel.favorite && (
                            <Star
                              size={16}
                              fill="var(--color-primary-500)"
                              className="text-primary-500 flex-shrink-0"
                              strokeWidth={3}
                            />
                          )}
                          {(channel.admin_publickey || "").toUpperCase() ===
                          (myPublicKey || "").toUpperCase() ? (
                            <span className="text-[9px] bg-primary-500/10 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded-full font-black uppercase tracking-wider">
                              creator
                            </span>
                          ) : channel.isAdmin ? (
                            <span className="text-[9px] bg-sky-500/10 text-sky-600 dark:text-sky-400 px-1.5 py-0.5 rounded-full font-black uppercase tracking-wider">
                              admin
                            </span>
                          ) : null}
                        </h3>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 font-black uppercase tracking-widest bg-black/5 dark:bg-white/5 px-2 py-1 rounded-lg">
                          {formatTime(
                            channel.lastMessageDate || channel.created_date,
                          )}
                        </span>
                      </div>
                      <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate font-bold">
                        {channel.lastMessage ||
                          channel.description ||
                          "No messages yet"}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 ml-2 transition-all relative z-50">
                      <button
                        onClick={(e) => {
                          handleToggleFavorite(channel.channel_id, e);
                        }}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                          channel.favorite
                            ? "bg-amber-500/20 text-amber-500"
                            : "bg-black/5 dark:bg-white/5 text-gray-400 hover:bg-amber-500/10 hover:text-amber-500"
                        }`}
                      >
                        <Star
                          size={14}
                          strokeWidth={3}
                          fill={channel.favorite ? "currentColor" : "none"}
                        />
                      </button>

                      <button
                        onClick={(e) => handleShowChannelInfo(channel.channel_id, e)}
                        className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 text-primary-500 dark:text-primary-400 hover:bg-primary-500 hover:text-white flex items-center justify-center transition-all"
                        title="Channel Info"
                      >
                        <Info size={14} strokeWidth={3} />
                      </button>
                    </div>
                  </div>
                </Link>
              ))}

            {activeTab !== "all" &&
              displayedChats.map((chat) => (
                <div
                  key={chat.publickey}
                  onClick={(e) => {
                    if (e.defaultPrevented || (e.target as HTMLElement).closest('button')) return;
                    navigate({
                      to: "/chat/$address",
                      params: { address: chat.publickey },
                    });
                  }}
                  style={{ WebkitTouchCallout: "none" } as any}
                  className={`block rounded-[2.5rem] p-6 cursor-pointer transition-all duration-500 relative z-10 group overflow-hidden mb-4 ${
                    (chat.unreadCount || 0) > 0
                      ? "bg-primary-500/15 dark:bg-primary-500/20 shadow-xl shadow-primary-500/10 border border-primary-500/30"
                      : "bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 shadow-lg shadow-black/5"
                  } hover:scale-[1.02] active:scale-95 hover:shadow-2xl hover:z-20`}
                >
                  <div className="flex items-center gap-5">
                    <div className="relative flex-shrink-0">
                      {chat.publickey === myPublicKey ? (
                        <div className="w-16 h-16 rounded-[1.5rem] bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shadow-2xl">
                          <Inbox
                            size={28}
                            className="text-primary-600 dark:text-primary-400"
                          />
                        </div>
                      ) : (
                        <img
                          src={getAvatar(chat)}
                          alt={getName(chat)}
                          className="w-16 h-16 rounded-[1.5rem] object-cover bg-gray-200 dark:bg-gray-700 shadow-2xl pointer-events-none transition-transform duration-500 group-hover:scale-110"
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
                        <div className="absolute -top-2 -right-2 bg-primary-500 text-white text-[10px] font-black rounded-full w-7 h-7 flex items-center justify-center shadow-2xl shadow-primary-500/50 ring-2 ring-white dark:ring-gray-900 animate-in zoom-in duration-500">
                          {chat.unreadCount}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-1.5">
                        <h3 className="font-black text-gray-900 dark:text-white truncate text-base flex items-center gap-2 leading-tight uppercase tracking-tight">
                          {getName(chat)}
                          {chat.favorite && (
                            <Star
                              size={16}
                              fill="var(--color-primary-500)"
                              className="text-primary-500 flex-shrink-0"
                              strokeWidth={3}
                            />
                          )}
                        </h3>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 font-black uppercase tracking-widest bg-black/5 dark:bg-white/5 px-2 py-1 rounded-lg">
                          {formatTime(chat.lastMessageDate)}
                        </span>
                      </div>
                      <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate font-bold">
                        {chat.username === "Me" && (
                          <span className="text-primary-600 dark:text-primary-400 font-black mr-2">
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

                    <div className="flex items-center gap-1.5 ml-2 transition-all">
                      <button
                        onClick={(e) => {
                          handleToggleFavorite(chat.publickey, e);
                        }}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                          chat.favorite
                            ? "bg-amber-500/20 text-amber-500"
                            : "bg-black/5 dark:bg-white/5 text-gray-400 hover:bg-amber-500/10 hover:text-amber-500"
                        }`}
                        title={chat.favorite ? "Unfavorite" : "Favorite"}
                      >
                        <Star
                          size={14}
                          strokeWidth={3}
                          fill={chat.favorite ? "currentColor" : "none"}
                        />
                      </button>

                      <button
                        onClick={(e) => {
                          chat.archived
                            ? handleUnarchive(chat.publickey, e)
                            : handleArchive(chat.publickey, e);
                        }}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                          chat.archived
                            ? "bg-orange-500/20 text-orange-500"
                            : "bg-black/5 dark:bg-white/5 text-gray-400 hover:bg-orange-500/10 hover:text-orange-500"
                        }`}
                        title={chat.archived ? "Unarchive" : "Archive"}
                      >
                        <Archive size={14} strokeWidth={3} />
                      </button>

                      <button
                        onClick={(e) => handleShowProfile(chat.publickey, e)}
                        className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 text-primary-500 dark:text-primary-400 hover:bg-primary-500 hover:text-white flex items-center justify-center transition-all"
                        title="Contact Info"
                      >
                        <Info size={14} strokeWidth={3} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* FAB Menu Actions */}
      {fabMenuOpen && (activeTab === "all" || activeTab === "favorites") && (
        <div className="fixed bottom-24 right-6 flex flex-col items-end gap-4 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <button
            onClick={() => {
              setFabMenuOpen(false);
              setShowJoinModal(true);
            }}
            className="flex items-center gap-3 px-5 py-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl text-gray-700 dark:text-gray-200 hover:scale-105 active:scale-95 transition-all border border-white/20 dark:border-white/5 active:bg-primary-500/10"
          >
            <span className="font-bold text-sm">Join via Link</span>
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
              <Plus size={20} strokeWidth={3} />
            </div>
          </button>
          <button
            onClick={() => {
              setFabMenuOpen(false);
              navigate({ to: "/create-group" });
            }}
            className="flex items-center gap-3 px-5 py-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl text-gray-700 dark:text-gray-200 hover:scale-105 active:scale-95 transition-all border border-white/20 dark:border-white/5 active:bg-primary-500/10"
          >
            <span className="font-bold text-sm">New Group</span>
            <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-500">
              <Users size={20} strokeWidth={3} />
            </div>
          </button>
          <button
            onClick={() => {
              setFabMenuOpen(false);
              navigate({ to: "/create-channel" });
            }}
            className="flex items-center gap-3 px-5 py-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl text-gray-700 dark:text-gray-200 hover:scale-105 active:scale-95 transition-all border border-white/20 dark:border-white/5 active:bg-primary-500/10"
          >
            <span className="font-bold text-sm">New Channel</span>
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-500">
              <Radio size={20} strokeWidth={3} />
            </div>
          </button>
          <button
            onClick={() => {
              setFabMenuOpen(false);
              navigate({ to: "/contacts" });
            }}
            className="flex items-center gap-3 px-5 py-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl text-gray-700 dark:text-gray-200 hover:scale-105 active:scale-95 transition-all border border-white/20 dark:border-white/5 active:bg-primary-500/10"
          >
            <span className="font-bold text-sm">Direct Message</span>
            <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center text-green-500">
              <UserPlus size={20} strokeWidth={3} />
            </div>
          </button>
        </div>
      )}

      <div className="fixed bottom-32 md:bottom-10 right-6 z-50">
        <button
          onClick={() => {
            if (activeTab === "groups") navigate({ to: "/create-group" });
            else if (activeTab === "requests") navigate({ to: "/discovery" });
            else if (activeTab === "all" || activeTab === "favorites")
              setFabMenuOpen(!fabMenuOpen);
            else navigate({ to: "/contacts" });
          }}
          className={`w-16 h-16 rounded-2xl shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-90 group relative overflow-hidden ${
            fabMenuOpen
              ? "bg-gray-900 text-white"
              : "bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-primary-500/30"
          }`}
        >
          {/* Inner Glow Effect */}
          {!fabMenuOpen && (
            <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          )}

          <div className={`transition-transform duration-300 ${fabMenuOpen ? "rotate-45 scale-110" : "rotate-0"}`}>
            {activeTab === "groups" ? (
              <Users size={28} strokeWidth={2.5} />
            ) : activeTab === "requests" ? (
              <Globe size={28} strokeWidth={2.5} />
            ) : activeTab === "individuals" ? (
              <UserPlus size={28} strokeWidth={2.5} />
            ) : activeTab === "all" || activeTab === "favorites" ? (
              <Plus size={28} strokeWidth={2.5} />
            ) : (
              <MessageSquarePlus size={28} strokeWidth={2.5} />
            )}
          </div>
        </button>
      </div>

      {/* Join Link Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 transition-all duration-500">
          <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-2xl rounded-[2rem] p-8 w-full max-w-sm shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-white/20 dark:border-white/5 relative overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            {/* Background design accents */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary-500/10 blur-[60px] rounded-full pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-500/10 blur-[60px] rounded-full pointer-events-none" />

            <div className="w-14 h-14 rounded-2xl bg-primary-500/10 flex items-center justify-center text-primary-500 mb-6 shadow-sm border border-primary-500/10 ring-8 ring-primary-500/5">
              <UserPlus size={28} strokeWidth={2.5} />
            </div>

            <h3 className="text-2xl font-black mb-2 text-gray-900 dark:text-white leading-tight">
              Join via Link
            </h3>

            <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-6 font-medium leading-relaxed">
              Paste a discovery invite link (mcgrp:// or mcch://) to join a specific group or channel instantly.
            </p>

            <textarea
              value={joinLink}
              onChange={(e) => {
                setJoinLink(e.target.value);
                setJoinError("");
              }}
              className="w-full h-32 p-4 border-0 rounded-2xl bg-black/5 dark:bg-white/5 text-gray-900 dark:text-white resize-none mb-1 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:bg-white/50 dark:focus:bg-gray-800/50 transition-all font-medium text-sm placeholder:text-gray-400 placeholder:font-bold shadow-inner"
              placeholder="Paste mcgrp:// or mcch:// link here..."
              disabled={joiningGroup}
            />
            {joinError && (
              <p className="text-xs text-red-500 mt-2 font-bold flex items-center gap-1.5 animate-in slide-in-from-top-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                {joinError}
              </p>
            )}
            {!joinError && <div className="mt-2 h-4" />}

            <div className="flex gap-3 justify-end mt-8">
              <button
                onClick={() => {
                  setShowJoinModal(false);
                  setJoinLink("");
                  setJoinError("");
                }}
                className="px-6 py-2.5 text-gray-500 dark:text-gray-400 font-bold hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all active:scale-95"
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
                  const trimmed = joinLink.trim();
                  setJoiningGroup(true);
                  setJoinError("");
                  try {
                    if (trimmed.startsWith("mcch://")) {
                      await channelService.joinViaInviteLink(trimmed);
                    } else if (trimmed.startsWith("mcgrp://")) {
                      await groupService.sendJoinRequest(trimmed);
                    } else {
                      throw new Error(
                        "Invalid link format. Use mcgrp:// or mcch://",
                      );
                    }
                    setShowJoinModal(false);
                    setJoinLink("");
                  } catch (err: any) {
                    console.error("Join failed:", err);
                    setJoinError(
                      typeof err === "string"
                        ? err
                        : err?.message || "Failed to process link.",
                    );
                  } finally {
                    setJoiningGroup(false);
                  }
                }}
                disabled={joiningGroup || !joinLink}
                className="px-8 py-2.5 bg-gradient-to-br from-primary-400 to-primary-600 text-white font-bold rounded-xl shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:grayscale"
              >
                {joiningGroup ? "Joining..." : "Join Now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
