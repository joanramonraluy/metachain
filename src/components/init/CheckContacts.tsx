// src/components/init/CheckContacts.tsx

import { useContext, useEffect, useState } from "react";
import { appContext } from "../../AppContext";
import { MDS } from "@minima-global/mds";
import { useNavigate } from "@tanstack/react-router";
import { Plus, VolumeX, UserCheck, LayoutGrid, X, MessageCircle, Users } from "lucide-react";
import { minimaService } from "../../services/minima.service";
import { personalContactsService } from "../../services/personal-contacts.service";
import { chatService } from "../../services/chat.service";

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
      const contactPublicKeys = new Set(enrichedList.map(c => c.publickey).filter(Boolean));

      const chatOnlyList: Contact[] = chats
        .filter(chat =>
          chat.publickey &&
          !contactPublicKeys.has(chat.publickey) &&
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
      {/* Add Contact Dialog */}
      {showAddContactDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-96 max-w-full mx-4">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Add Contact</h3>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Maxima Address
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Enter the Maxima contact address of the person you want to add
              </p>
              <textarea
                value={contactAddress}
                onChange={(e) => setContactAddress(e.target.value)}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:outline-none min-h-[100px] font-mono text-sm"
                placeholder="Paste Maxima address here..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) handleAddContact();
                  if (e.key === 'Escape') setShowAddContactDialog(false);
                }}
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowAddContactDialog(false);
                  setContactAddress("");
                }}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
                disabled={isAdding}
              >
                Cancel
              </button>
              <button
                onClick={handleAddContact}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-md transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isAdding}
              >
                {isAdding ? "Adding..." : "Add Contact"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 transition-colors">
        {/* Syncing Indicator */}
        {isSyncing && (
          <div className="bg-primary-500 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
            Loading new contact...
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white dark:bg-gray-800 flex-shrink-0 px-4 py-3 shadow-sm transition-colors">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">

            <button
              onClick={() => setActiveTab('all')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${activeTab === 'all'
                ? 'bg-primary-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              <LayoutGrid size={16} className="flex-shrink-0" />
              <span className="hidden md:inline">All</span> ({contacts.length + chatOnlyContacts.length})
            </button>

            <button
              onClick={() => setActiveTab('contacts')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${activeTab === 'contacts'
                ? 'bg-primary-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              <Users size={16} className="flex-shrink-0" />
              <span className="hidden md:inline">Contacts</span> ({contacts.length})
            </button>

            <button
              onClick={() => setActiveTab('community')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${activeTab === 'community'
                ? 'bg-primary-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              <MessageCircle size={16} className="flex-shrink-0" />
              <span className="hidden md:inline">Community</span> ({chatOnlyContacts.length})
            </button>

            <button
              onClick={() => setActiveTab('personal')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center justify-center gap-1.5 ${activeTab === 'personal'
                ? 'bg-primary-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              <UserCheck size={16} className="flex-shrink-0" />
              <span className="hidden md:inline">Personal</span> ({personalContacts.length})
            </button>
          </div>
        </div>

        {/* Community Hint Banner */}
        {showCommunityHint && (
          <div className="px-4 pt-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-4 flex items-start gap-3 relative animate-in fade-in slide-in-from-top-2">
              <div className="bg-blue-100 dark:bg-blue-800 rounded-full p-2 flex-shrink-0 text-blue-600 dark:text-blue-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0 pr-6">
                <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-1">
                  Looking for more people?
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-2">
                  You can find and connect with other users in the global Community section.
                </p>
                <button
                  onClick={() => navigate({ to: '/discovery' })}
                  className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 inline-flex items-center gap-1 group"
                >
                  Go to Community
                  <svg className="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </button>
              </div>
              <button
                className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                onClick={handleDismissHint}
                title="Dismiss hint"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Contacts List */}
        <div className="flex-1 overflow-y-auto p-3">
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
              // All
              displayedContacts = [...contacts, ...chatOnlyContacts];
              // Optional: Sort by last seen? For now just keep order.
            }

            return displayedContacts.length > 0 ? (
              <div className="space-y-2">
                {displayedContacts.map((c, i) => (
                  <div
                    key={i}
                    onClick={() =>
                      navigate({
                        to: "/chat/$address",
                        params: {
                          address: c.publickey || c.currentaddress || c.extradata?.minimaaddress || "",
                        },
                      })
                    }
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 hover:shadow-md cursor-pointer transition-all active:bg-gray-50 dark:active:bg-gray-750"
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className="relative flex-shrink-0">
                        <img
                          src={getAvatar(c)}
                          alt={c.extradata?.name || "Unknown"}
                          className="w-12 h-12 rounded-full object-cover bg-gray-200 dark:bg-gray-700"
                          onError={(e: any) => {
                            e.target.src = defaultAvatar;
                          }}
                        />
                        {c.samechain && (
                          <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
                        )}
                        {c.muted && (
                          <div className="absolute -top-1 -right-1 bg-orange-100 dark:bg-orange-900 rounded-full p-0.5 border border-white dark:border-gray-800 shadow-sm">
                            <VolumeX size={12} className="text-orange-500" />
                          </div>
                        )}
                        {c.publickey && personalContacts.includes(c.publickey) && (
                          <div className="absolute -top-1 -left-1 bg-primary-100 dark:bg-primary-900 rounded-full p-0.5 border border-white dark:border-gray-800 shadow-sm">
                            <UserCheck size={12} className="text-primary-600 dark:text-primary-400" />
                          </div>
                        )}
                      </div>

                      {/* Contact Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                            {c.extradata?.name || "Unknown"}
                          </h3>
                        </div>
                        <p className={`text-xs truncate mt-0.5 ${timeAgo(c.lastseen) === 'online'
                          ? 'text-green-600 dark:text-green-400 font-medium'
                          : 'text-gray-500 dark:text-gray-400'
                          }`}>
                          {timeAgo(c.lastseen)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 p-8 text-center">
                <div className="bg-primary-50 dark:bg-primary-900/20 p-4 rounded-full mb-4">
                  {activeTab === 'personal' ? (
                    <UserCheck className="w-12 h-12 text-primary-600" />
                  ) : activeTab === 'community' ? (
                    <MessageCircle className="w-12 h-12 text-primary-600" />
                  ) : (
                    <svg className="w-12 h-12 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  )}
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
                  {activeTab === 'personal'
                    ? 'No personal contacts yet'
                    : activeTab === 'community'
                      ? 'No non-contact chats found'
                      : activeTab === 'contacts'
                        ? 'No contacts yet'
                        : 'No contacts or community chats yet'}
                </h3>
                <p className="text-sm mb-6">
                  {activeTab === 'personal'
                    ? 'Mark contacts as personal from their contact info page.'
                    : activeTab === 'community'
                      ? 'As you chat with users they will appear here.'
                      : activeTab === 'contacts'
                        ? 'Add your first contact to start chatting.'
                        : 'Add your first contact or chat with someone to see them here.'}
                </p>
                {(activeTab === 'all' || activeTab === 'contacts') && (
                  <button
                    onClick={() => setShowAddContactDialog(true)}
                    className="px-6 py-2 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors shadow-sm"
                  >
                    Add Contact
                  </button>
                )}
              </div>
            );
          })()}
        </div>

        {/* Floating Action Button */}
        <button
          onClick={() => setShowAddContactDialog(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-primary-600 hover:bg-primary-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-30"
          title="Add Contact"
        >
          <Plus size={24} />
        </button>
      </div>
    </>
  );
}
