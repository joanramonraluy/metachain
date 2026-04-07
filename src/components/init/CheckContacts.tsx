// src/components/init/CheckContacts.tsx

import { useContext, useEffect, useState } from "react";
import { appContext } from "../../AppContext";
import { MDS } from "@minima-global/mds";
import { useNavigate } from "@tanstack/react-router";
import { Plus, VolumeX, UserCheck, LayoutGrid, X, Users, Globe, MessageCircle, ChevronRight, UserPlus, Info, BookUser } from "lucide-react";
import EmptyState from '../common/EmptyState';
import { minimaService } from "../../services/minima.service";
import { personalContactsService } from "../../services/personal-contacts.service";
import { chatService } from "../../services/chat.service";
import { useTheme } from "../../context/ThemeContext";

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
  muted?: boolean;
}

export default function CheckContacts() {
  const { loaded } = useContext(appContext);
  const { mode, chatBackground } = useTheme();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [personalContacts, setPersonalContacts] = useState<string[]>([]);
  const [chatOnlyContacts, setChatOnlyContacts] = useState<Contact[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'contacts' | 'community' | 'personal'>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddContactDialog, setShowAddContactDialog] = useState(false);
  const [contactAddress, setContactAddress] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);

  // Community Hint State
  const [showCommunityHint, setShowCommunityHint] = useState(() => {
    return localStorage.getItem('minima_dismiss_community_hint') !== 'true';
  });

  const navigate = useNavigate();

  const handleDismissHint = () => {
    setShowCommunityHint(false);
    localStorage.setItem('minima_dismiss_community_hint', 'true');
  };

  // Helper for timeouts
  const withTimeout = (promise: Promise<any>, ms: number = 5000) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Request timed out")), ms))
    ]);
  };

  const fetchContacts = async () => {
    // 1. Load from cache immediately (Optimistic UI)
    const cached = localStorage.getItem("cached_all_contacts");
    if (cached) {
      try {
        const cachedList = JSON.parse(cached);
        if (Array.isArray(cachedList)) {
          setContacts(cachedList);
          setLoading(false); // Show data immediately
          console.log("⚠️ [CONTACTS] Loaded from cache");
        }
      } catch (e) {
        console.warn("Error parsing cached contacts", e);
      }
    }

    try {
      console.log("🔄 [CONTACTS] Fetching fresh contacts...");
      // 2. Fetch fresh data with timeout
      const res: any = await withTimeout(MDS.cmd.maxcontacts(), 5000);
      let list: Contact[] = [];

      if (res?.response?.contacts && Array.isArray(res.response.contacts)) {
        list = res.response.contacts;
      } else if (res?.response && Array.isArray(res.response)) {
        list = res.response;
      } else if (res?.response?.response && Array.isArray(res.response.response)) {
        list = res.response.response;
      } else if (Array.isArray(res)) {
        list = res;
      }

      // Enrich contacts with mute status
      const enrichedList = await Promise.all(list.map(async (c) => {
        if (c.publickey) {
          try {
            // giving a small timeout for DB checks just in case
            const isMuted = await minimaService.isContactMuted(c.publickey);
            return { ...c, muted: isMuted };
          } catch (e) { return c; }
        }
        return c;
      }));

      // 3. Fetch Chats and filter for non-contacts
      const chats = await chatService.getRecentChats();
      const contactPublicKeys = new Set(enrichedList.map(c => c.publickey?.toUpperCase()).filter(Boolean));

      const chatOnlyList: Contact[] = chats
        .filter(chat =>
          chat.publickey &&
          !contactPublicKeys.has(chat.publickey.toUpperCase()) &&
          !chat.roomname.startsWith("Group: ") // Filter out group chats if needed, or keep them? Usually contacts are individuals.
          // Note: chatService might return groups too if they are just in message list.
          // For now, let's include them if they have a publickey that looks like a user one (Group IDs are usually different format if logic separates them).
          // Actually, group messages usually have specific group_id. getRecentChats groups by publickey which is the room ID for 1:1.
        )
        .map(chat => ({
          currentaddress: chat.publickey,
          publickey: chat.publickey,
          extradata: {
            name: chat.roomname,
            icon: chat.avatar
          },
          lastseen: chat.lastMessageDate,
          // We can check mute status for these too if we want
        }));

      // Enrich chat-only with mute status too
      const enrichedChatOnlyList = await Promise.all(chatOnlyList.map(async (c) => {
        if (c.publickey) {
          try {
            const isMuted = await minimaService.isContactMuted(c.publickey);
            return { ...c, muted: isMuted };
          } catch (e) { return c; }
        }
        return c;
      }));


      setContacts(enrichedList);
      setChatOnlyContacts(enrichedChatOnlyList);

      // 4. Update cache
      localStorage.setItem("cached_all_contacts", JSON.stringify(enrichedList));

    } catch (err: any) {
      // If we have no cache and fetch failed, show error.
      // If we have cache, we stay on cache and just log warning (silent fail for user)
      if (!cached) {
        console.error("🚨 Error fetching contacts:", err);
        setError(err.message || "Unknown error");
      } else {
        console.warn("⚠️ [CONTACTS] Offline/Timeout - keeping cached data", err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loaded) return;
    fetchContacts();
    loadPersonalContacts();
  }, [loaded]);

  const loadPersonalContacts = async () => {
    const personal = await personalContactsService.getPersonalContacts();
    setPersonalContacts(personal);
  };

  const handleAddContact = async () => {
    if (!contactAddress.trim()) {
      alert("Please enter a Maxima address");
      return;
    }

    setIsAdding(true);
    try {
      const res: any = await MDS.cmd.maxcontacts({
        params: {
          action: "add",
          contact: contactAddress.trim()
        } as any
      });

      console.log("Add contact response:", res);

      // Check if the command was successful
      if (res?.status) {
        // Success - close dialog and reset form
        setShowAddContactDialog(false);
        setContactAddress("");
        setIsSyncing(true);

        // Wait a moment for Maxima to sync, then refresh contacts list
        setTimeout(async () => {
          await fetchContacts();
          await loadPersonalContacts();
          setIsSyncing(false);
        }, 1000);
      } else {
        alert("Failed to add contact. Please check the address and try again.");
      }
    } catch (err) {
      console.error("Error adding contact:", err);
      alert("Error adding contact: " + (err as Error).message);
    } finally {
      setIsAdding(false);
    }
  };

  if (!loaded || loading) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-gray-900 transition-colors">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-gray-900 transition-colors">
        <p className="text-red-500">⚠️ {error}</p>
      </div>
    );
  }

  const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

  const getAvatar = (contact: Contact) => {
    if (contact.extradata?.icon) {
      try {
        const decoded = decodeURIComponent(contact.extradata.icon);
        // Check if it's a valid data URL, and not a URL ending in /0x00 (no photo)
        if (decoded.startsWith("data:image") && !decoded.includes("/0x00")) {
          return decoded;
        }
      } catch (err) {
        console.warn("⚠️ Error decoding avatar:", err);
      }
    }
    return defaultAvatar;
  };

  const timeAgo = (timestamp?: number | string) => {
    if (!timestamp) return "Unknown";
    const timeNum = Number(timestamp);
    if (isNaN(timeNum)) return "Unknown";

    const diff = Date.now() - timeNum;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "online";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <>
      {/* Add Contact Modal - Modernized Premium Style */}
      {showAddContactDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 transition-all duration-500">
          <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-3xl border border-white/20 dark:border-white/5 rounded-[2.5rem] p-8 w-full max-w-sm shadow-[0_20px_50px_rgba(0,0,0,0.3)] relative overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            {/* Background design accents */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary-500/10 blur-[60px] rounded-full pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-500/10 blur-[60px] rounded-full pointer-events-none" />

            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary-500/10 flex items-center justify-center text-primary-500 mb-6 shadow-sm border border-primary-500/10 ring-8 ring-primary-500/5">
                <UserPlus size={28} strokeWidth={2.5} />
              </div>

              <h3 className="text-2xl font-black mb-2 text-gray-900 dark:text-white leading-tight">
                Add New Contact
              </h3>

              <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-8 font-medium leading-relaxed max-w-[240px] mx-auto">
                Connect with a peer by pasting their Maxima address (Mx...) or public key.
              </p>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 ml-1">
                  Peers Address
                </label>
                <div className="relative group">
                  <textarea
                    placeholder="Mx... or 0x..."
                    value={contactAddress}
                    onChange={(e) => setContactAddress(e.target.value)}
                    className="w-full px-5 py-4 bg-black/5 dark:bg-white/5 border-2 border-transparent focus:border-primary-500/30 rounded-2xl text-[15px] font-mono text-gray-900 dark:text-white focus:outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 min-h-[120px] resize-none shadow-inner"
                    disabled={isAdding}
                  />
                  <div className="absolute right-4 bottom-4 opacity-0 group-focus-within:opacity-30 transition-opacity">
                    <UserPlus size={16} className="text-primary-500" />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <button
                  onClick={handleAddContact}
                  disabled={!contactAddress.trim() || isAdding}
                  className="w-full py-4 bg-gradient-to-br from-primary-400 to-primary-600 text-white rounded-2xl font-black text-base uppercase tracking-widest shadow-lg shadow-primary-500/30 hover:scale-102 hover:shadow-primary-500/50 active:scale-95 transition-all disabled:opacity-50 disabled:grayscale"
                >
                  {isAdding ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Requesting...</span>
                    </div>
                  ) : (
                    "Send Request"
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowAddContactDialog(false);
                    setContactAddress("");
                  }}
                  className="w-full py-3.5 text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest text-[11px] hover:bg-black/5 dark:hover:bg-white/10 rounded-2xl transition-all active:scale-95"
                  disabled={isAdding}
                >
                  Not Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 transition-colors relative overflow-hidden">
        {/* Dot Grid Background (consistent with Inbox) */}
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

        {/* Background Blobs (consistent with Inbox) */}
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

        {/* Syncing Indicator */}
        {isSyncing && (
          <div className="mx-6 mt-6 bg-primary-500 text-white px-5 py-3 rounded-2xl shadow-xl shadow-primary-500/20 flex items-center justify-center gap-3 animate-in slide-in-from-top-4 duration-500 z-50">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
            <span className="text-xs font-black uppercase tracking-widest">Bridging New Peer...</span>
          </div>
        )}

        {/* Tabs - Elite Glassy Pills (Sticky at the top) */}
        <div className="sticky top-0 z-40 w-full flex items-center justify-center border-b border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-3xl overflow-x-auto no-scrollbar scrollbar-hide px-3 sm:px-6">
          <div className="flex items-center gap-1 sm:gap-6">
            {(['all', 'contacts', 'community', 'personal'] as const).map((tab) => {
              const isActive = activeTab === tab;
              const config = {
                all: { icon: LayoutGrid, label: 'All', count: contacts.length + chatOnlyContacts.length, color: 'indigo' },
                contacts: { icon: Users, label: 'Contacts', count: contacts.length, color: 'indigo' },
                community: { icon: Globe, label: 'Community', count: chatOnlyContacts.length, color: 'emerald' },
                personal: { icon: UserCheck, label: 'Personal', count: personalContacts.length, color: 'violet' }
              }[tab];

              const Icon = config.icon;
              const colors = {
                indigo: "text-indigo-500 bg-indigo-500 shadow-indigo-500/50",
                emerald: "text-emerald-500 bg-emerald-500 shadow-emerald-500/50",
                violet: "text-violet-500 bg-violet-500 shadow-violet-500/50",
              }[config.color] || "text-primary-500 bg-primary-500 shadow-primary-500/50";

              const colorClass = colors.split(" ")[0];
              const bgClass = colors.split(" ")[1];
              const glowClass = colors.split(" ")[2];

              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`relative px-4 py-4 sm:py-5 flex items-center gap-2.5 transition-all duration-300 group flex-shrink-0 ${
                    isActive ? colorClass : "text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  <div className={`transition-all duration-500 ${isActive ? "scale-110" : "group-hover:scale-110"}`}>
                    <Icon size={16} strokeWidth={isActive ? 3 : 2.5} />
                  </div>
                  <span className="hidden sm:inline text-[11px] font-black tracking-widest uppercase">
                    {config.label}
                  </span>
                  <span className="opacity-60 text-[10px] font-bold">({config.count})</span>

                  {/* Underline Indicator */}
                  {isActive && (
                    <div className={`absolute bottom-0 left-0 right-0 h-1 rounded-full ${bgClass} shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${glowClass} animate-in fade-in zoom-in duration-500`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Community Hint Banner - Modernized */}
        {showCommunityHint && (
          <div className="px-4 pt-4">
            <div className="relative overflow-hidden bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 rounded-2xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-4 duration-500 shadow-xl shadow-black/5">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none"></div>
              <div className="relative z-10 bg-blue-100 dark:bg-blue-800/30 rounded-xl p-2.5 flex-shrink-0 text-blue-600 dark:text-blue-400 shadow-sm">
                <Users size={20} strokeWidth={2.5} />
              </div>
              <div className="flex-1 min-w-0 pr-6 relative z-10">
                <h4 className="text-[15px] font-black text-gray-900 dark:text-white mb-0.5 tracking-tight">
                  Looking for more people?
                </h4>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-snug mb-2 font-medium">
                  Connect with the global network in the global Community section.
                </p>
                <button
                  onClick={() => navigate({ to: '/discovery' })}
                  className="text-[13px] font-black text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 inline-flex items-center gap-1 group transition-all"
                >
                  Go to Community
                  <ChevronRight size={14} className="transform group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
              <button
                className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-all z-20"
                onClick={handleDismissHint}
                title="Dismiss hint"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Contacts List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide no-scrollbar pb-24">
          {(() => {
            // Filter contacts based on active tab
            let displayedContacts: Contact[] = [];

            if (activeTab === 'personal') {
              displayedContacts = contacts.filter(c => c.publickey && personalContacts.includes(c.publickey));
            } else if (activeTab === 'community') {
              displayedContacts = chatOnlyContacts;
            } else if (activeTab === 'contacts') {
              displayedContacts = contacts;
            } else {
              displayedContacts = [...contacts, ...chatOnlyContacts];
            }

            return displayedContacts.length === 0 ? (
              <EmptyState
                icon={
                  activeTab === 'personal'
                    ? UserCheck
                    : activeTab === 'community'
                      ? Globe
                      : activeTab === 'contacts'
                        ? Users
                        : BookUser
                }
                title={
                  activeTab === 'personal'
                    ? "No personal contacts"
                    : activeTab === 'community'
                      ? "Community silent"
                      : "Looking for more people?"
                }
                description={
                  activeTab === 'personal'
                    ? "Mark contacts as personal for quick and prioritized access."
                    : activeTab === 'community'
                      ? "Discover other MetaChain users in the community section."
                      : (
                        <span>
                          Add your first contact to start communicating privately or{" "}
                          <button
                            onClick={() => navigate({ to: "/discovery" })}
                            className="text-primary-500 hover:underline font-black"
                          >
                            browse the Community
                          </button>{" "}
                          to find people you know.
                        </span>
                      )
                }
                action={
                  activeTab === 'community'
                    ? {
                        label: "Go to Community",
                        onClick: () => navigate({ to: '/discovery' }),
                      }
                    : activeTab === 'personal'
                      ? {
                          label: "Browse All",
                          onClick: () => setActiveTab('all'),
                        }
                      : {
                          label: "Add Contact",
                          onClick: () => setShowAddContactDialog(true),
                        }
                }
                secondaryAction={
                  activeTab !== 'community'
                    ? {
                        label: "Browse Community",
                        onClick: () => navigate({ to: '/discovery' }),
                      }
                    : undefined
                }
                className="h-full"
              />
            ) : (
              displayedContacts.map((contact, index) => (
                <div
                  key={index}
                  className={`group relative p-6 transition-all duration-500 animate-in fade-in slide-in-from-bottom-4 rounded-[2.5rem] ${
                    timeAgo(contact.lastseen || 0) === "online"
                      ? "bg-primary-500/15 dark:bg-primary-500/20 shadow-xl shadow-primary-500/10 border border-primary-500/30"
                      : "bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 shadow-lg shadow-black/5"
                  } hover:scale-[1.02] active:scale-95 hover:shadow-2xl hover:z-20`}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center gap-5">
                    <div className="relative flex-shrink-0">
                      <img
                        src={getAvatar(contact)}
                        alt={contact.extradata?.name || "Unknown"}
                        className="w-16 h-16 rounded-[1.5rem] object-cover bg-gray-100 dark:bg-gray-800 shadow-2xl transition-transform duration-500 group-hover:scale-110 pointer-events-none"
                        onError={(e: any) => {
                          e.target.src = defaultAvatar;
                        }}
                      />
                      {contact.publickey && personalContacts.includes(contact.publickey) && (
                        <div className="absolute -top-1.5 -right-1.5 bg-primary-500 rounded-[0.75rem] p-1.5 shadow-2xl shadow-primary-500/50 ring-2 ring-white dark:ring-gray-900 animate-in zoom-in duration-500">
                          <UserCheck size={12} className="text-white" strokeWidth={4} />
                        </div>
                      )}
                      {timeAgo(contact.lastseen || 0) === 'online' && (
                        <div className="absolute -bottom-1 -left-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-900 shadow-glow shadow-green-500/50 animate-pulse"></div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-1.5">
                        <h3 className="font-black text-gray-900 dark:text-white truncate text-base flex items-center gap-2 leading-tight uppercase tracking-tight">
                          {contact.extradata?.name || "Anonymous Peer"}
                          {contact.muted && (
                            <VolumeX size={12} strokeWidth={3} className="text-red-500 opacity-60" />
                          )}
                        </h3>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 font-black uppercase tracking-widest bg-black/5 dark:bg-white/5 px-2 py-1 rounded-lg">
                          {timeAgo(contact.lastseen || 0)}
                        </span>
                      </div>
                      <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate font-bold">
                        {contact.publickey ? `PK: ${contact.publickey.substring(0, 10)}...` : "Address only contact"}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 ml-2 transition-all">
                      <button
                        onClick={() => navigate({
                          to: '/contact-info/$address',
                          params: { address: contact.publickey || contact.currentaddress }
                        })}
                        className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 text-primary-500 dark:text-primary-400 hover:bg-primary-500 hover:text-white flex items-center justify-center transition-all shadow-sm"
                        title="View Profile"
                      >
                        <Info size={14} strokeWidth={3} />
                      </button>
                      <button
                        onClick={() => navigate({
                          to: '/chat/$address',
                          params: { address: contact.publickey || contact.currentaddress }
                        })}
                        className="w-8 h-8 rounded-lg bg-primary-500 text-white flex items-center justify-center transition-all shadow-lg shadow-primary-500/20 active:scale-90"
                        title="Open Chat"
                      >
                        <MessageCircle size={14} strokeWidth={3} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            );
          })()}
        </div>

        {/* FAB Menu Actions - Consistent with Inbox */}
        {fabMenuOpen && (
          <div className="fixed bottom-24 right-6 flex flex-col items-end gap-4 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
            <button
              onClick={() => {
                setFabMenuOpen(false);
                navigate({ to: "/discovery" });
              }}
              className="flex items-center gap-3 px-5 py-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl text-gray-700 dark:text-gray-200 hover:scale-105 active:scale-95 transition-all border border-white/20 dark:border-white/5 active:bg-primary-500/10"
            >
              <span className="font-bold text-sm text-gray-600 dark:text-gray-300">Find in Community</span>
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-sm border border-blue-500/10">
                <Globe size={20} strokeWidth={3} />
              </div>
            </button>
            <button
              onClick={() => {
                setFabMenuOpen(false);
                setShowAddContactDialog(true);
              }}
              className="flex items-center gap-3 px-5 py-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl text-gray-700 dark:text-gray-200 hover:scale-105 active:scale-95 transition-all border border-white/20 dark:border-white/5 active:bg-primary-500/10"
            >
              <span className="font-bold text-sm text-gray-600 dark:text-gray-300">Add via Address</span>
              <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-500 shadow-sm border border-primary-500/10">
                <UserPlus size={20} strokeWidth={3} />
              </div>
            </button>
          </div>
        )}

        {/* Global Transparent Click-Overlay for FAB Menu */}
        {fabMenuOpen && (
          <div 
            className="fixed inset-0 z-40 bg-black/5 dark:bg-black/20 backdrop-blur-[2px] transition-all"
            onClick={() => setFabMenuOpen(false)}
          />
        )}

        {/* FAB Main Button - Consistent with Inbox */}
        <div className="fixed bottom-32 md:bottom-10 right-6 z-50">
          <button
            onClick={() => setFabMenuOpen(!fabMenuOpen)}
            className={`w-16 h-16 rounded-2xl shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 group relative overflow-hidden ${
              fabMenuOpen
                ? "bg-gray-900 text-white"
                : "bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-primary-500/30"
            }`}
            title="Manage Contacts"
          >
            <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div className={`transition-transform duration-300 ${fabMenuOpen ? "rotate-45 scale-110" : "rotate-0"}`}>
              <Plus size={32} strokeWidth={3} className="relative z-10" />
            </div>
          </button>
        </div>
      </div>
    </>
  );
}
