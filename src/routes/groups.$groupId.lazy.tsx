// src/routes/groups.$groupId.tsx
import { useEffect, useRef, useState, useContext, useCallback, lazy, Suspense } from "react";
import { useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { appContext } from "../AppContext";
import { Settings, Trash2, Star, Archive, Info } from 'lucide-react';
import { groupService } from "../services/group.service";
import MessageBubble from "../components/chat/MessageBubble";
import { useTheme } from "../context/ThemeContext";
import { EmojiClickData } from "emoji-picker-react";

// Lazy load EmojiPicker to reduce initial bundle size (~60KB)
const EmojiPicker = lazy(() => import("emoji-picker-react"));

export const Route = createLazyFileRoute("/groups/$groupId")({
  component: ChatPage,
});

// charms array removed as it is unused

interface Contact {
  currentaddress: string;
  publickey: string;  // Added: needed to send messages
  extradata?: {
    minimaaddress?: string;
    name?: string;
    icon?: string;
  };
  myaddress?: string;
}

interface ParsedMessage {
  text: string | null;
  fromMe: boolean;
  charm: { id: string } | null;
  amount: number | null;
  timestamp?: number;
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'zombie' | 'confirmed';
  tokenAmount?: { amount: string; tokenName: string }; // For token transfer messages
  senderPublicKey?: string;
  senderUsername?: string; // Added to store original username
  type?: string;
}



function ChatPage() {
  // Helper to remove duplicate messages (by timestamp + text)
  const deduplicateMessages = (msgs: ParsedMessage[]) => {
    const seen = new Set<string>();
    return msgs.filter((m) => {
      // Create a more unique key including type info
      const typeStr = m.charm ? 'charm' : m.tokenAmount ? 'token' : 'text';
      const key = `${m.timestamp}-${typeStr}-${m.text || ''}`;

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const { groupId: address } = Route.useParams();
  const navigate = useNavigate();
  const [contact, setContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [contactsMap, setContactsMap] = useState<Record<string, { name: string; icon?: string }>>({});
  const [input, setInput] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [memberCount, setMemberCount] = useState<number>(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const cursorPositionRef = useRef<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { userName, userAvatar, myPublicKey } = useContext(appContext);
  const isLoadingMessages = useRef(false); // Flag to prevent simultaneous loads
  const { chatBackground, mode } = useTheme();



  /* ----------------------------------------------------------------------------
      GET GROUP INFO
  ---------------------------------------------------------------------------- */
  useEffect(() => {
    const fetchGroupData = async () => {
      try {
        const info = await groupService.getGroupInfo(address);
        // Store group info in contact state for now (we'll use the same structure)
        if (info) {
          setContact({
            currentaddress: address,
            publickey: address,
            extradata: {
              name: (info as any).NAME,
              minimaaddress: address,
            }
          } as any);
          setIsFavorite(!!info.favorite);
          setIsArchived(!!info.archived);
        }

        const members = await groupService.getGroupMembers(address);
        setMemberCount(members.length);

        // Sync history
        await groupService.requestGroupHistory(address);
      } catch (err) {
        console.error("❌ [GROUP-MGMT] Error loading group:", err);
      }
    };

    fetchGroupData();
  }, [address]);

  // Handle click outside menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMenu]);

  // Handle click outside emoji picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showEmojiPicker &&
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmojiPicker]);

  const onEmojiClick = useCallback((data: EmojiClickData) => {
    setInput((prev) => {
      const currentPos = cursorPositionRef.current ?? prev.length;
      const safePos = Math.min(Math.max(0, currentPos), prev.length);
      const textBefore = prev.substring(0, safePos);
      const textAfter = prev.substring(safePos);
      cursorPositionRef.current = safePos + data.emoji.length;
      return textBefore + data.emoji + textAfter;
    });
  }, []);



  /* ----------------------------------------------------------------------------
      LOAD MESSAGES FROM DB
  ---------------------------------------------------------------------------- */
  // Helper to load messages from DB - reusable for initial load and after sending
  const loadMessagesFromDB = async () => {
    if (!address) return;

    // Prevent simultaneous loads
    if (isLoadingMessages.current) {
      console.log("⏭️ [GROUP-CHAT] Skipping load (active).");
      return;
    }

    isLoadingMessages.current = true;

    try {
      const rawMessages = await groupService.getGroupMessages(address);

      if (Array.isArray(rawMessages)) {
        const parsedMessages = rawMessages.map((row: any) => {
          const displayText = row.MESSAGE || "";

          const parsed: ParsedMessage = {
            text: displayText,
            fromMe: (row.SENDER_PUBLICKEY || "").toLowerCase() === (myPublicKey || "").toLowerCase(),
            charm: null,
            amount: null,
            timestamp: Number(row.DATE || 0),
            status: 'sent' as const,
            tokenAmount: undefined,
            senderPublicKey: row.SENDER_PUBLICKEY,
            senderUsername: row.SENDER_USERNAME, // Map sender username
            type: row.TYPE,
          };

          return parsed;
        });

        const deduplicatedMessages = deduplicateMessages(parsedMessages);
        setMessages(deduplicatedMessages);

        // Extract unique sender public keys (excluding self)
        const uniqueSenders = Array.from(new Set(deduplicatedMessages
          .filter(m => !m.fromMe && (m as any).senderPublicKey)
          .map(m => (m as any).senderPublicKey as string)
        ));

        // Fetch missing contacts
        if (uniqueSenders.length > 0) {
          fetchContactsForKeys(uniqueSenders);
        }
      }
    } catch (err) {
      console.error("❌ [GROUP-CHAT] Message load error:", err);
    } finally {
      isLoadingMessages.current = false;
    }
  };

  useEffect(() => {
    if (!address) return;

    const initChat = async () => {
      // Initial load
      await loadMessagesFromDB();

      // Mark messages as read
      await groupService.markGroupMessagesAsRead(address);
    };

    initChat();

    // Poll for new messages every 10 seconds
    const interval = setInterval(() => {
      loadMessagesFromDB();
    }, 10000);

    return () => clearInterval(interval);
  }, [address]);


  /* ----------------------------------------------------------------------------
      LISTEN FOR INCOMING MESSAGES
  ---------------------------------------------------------------------------- */
  useEffect(() => {
    if (!address) return;

    const handleNewMessage = (payload: any) => {
      if (payload.groupId === address) {
        loadMessagesFromDB();
      }
    };

    // Subscribe to new group messages
    groupService.onGroupMessage(handleNewMessage);

    // Subscribe to group data updates (like name changes)
    const handleGroupUpdate = async (e: any) => {
      if (!e.detail || e.detail.groupId !== address) return;

      // Check if the group still exists (we may have been kicked)
      try {
        const group = await groupService.getGroupInfo(address);
        if (!group) {
          // Group was deleted — we were kicked. Navigate away.
          console.log("🚫 [GROUP-CHAT] Group no longer exists, navigating away.");
          navigate({ to: "/" });
          return;
        }
      } catch {
        navigate({ to: "/" });
        return;
      }

      // Group still exists — update name and status
      if (e.detail.name) {
        setContact(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            extradata: {
              ...prev.extradata,
              name: e.detail.name
            }
          };
        });
      }
      if (e.detail.favorite !== undefined) {
        setIsFavorite(!!e.detail.favorite);
      }
      if (e.detail.archived !== undefined) {
        setIsArchived(!!e.detail.archived);
      }
    };
    window.addEventListener("GROUP_UPDATE", handleGroupUpdate);

    // Cleanup: remove listener when component unmounts or dependencies change
    return () => {
      groupService.removeGroupMessageCallback(handleNewMessage);
      window.removeEventListener("GROUP_UPDATE", handleGroupUpdate);
    };
  }, [address]);


  /* ----------------------------------------------------------------------------
      AUTOSCROLL
  ---------------------------------------------------------------------------- */
  const isInitialLoad = useRef(true);

  // Reset initial load state when address changes
  useEffect(() => {
    isInitialLoad.current = true;
  }, [address]);

  const scrollToBottom = () => {
    if (isInitialLoad.current) {
      // Use requestAnimationFrame to ensure DOM is updated before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          }
        });
      });
      isInitialLoad.current = false;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };
  useEffect(scrollToBottom, [messages]);

  /* ----------------------------------------------------------------------------
      SEND TEXT MESSAGE
  ---------------------------------------------------------------------------- */
  const handleSendMessage = async () => {
    if (!input.trim()) return;
    if (!address || !userName || !myPublicKey) return;

    const newMsg: ParsedMessage = { text: input, fromMe: true, charm: null, amount: null, timestamp: Date.now(), status: 'sent', senderUsername: userName };
    setMessages((prev) => [...prev, newMsg]);

    try {
      await groupService.sendGroupMessage(address, input, "text", myPublicKey, userName);
    } catch (err) {
      console.error("❌ [GROUP-CHAT] Send error:", err);
    }

    setInput("");
  };

  /* ----------------------------------------------------------------------------
      DELETE GROUP
  ---------------------------------------------------------------------------- */
  const handleToggleArchive = async () => {
    if (!address) return;
    try {
      if (isArchived) {
        await groupService.unarchiveGroup(address);
      } else {
        await groupService.archiveGroup(address);
      }
      setIsArchived(!isArchived);
    } catch (err) {
      console.error("❌ [GROUP] Toggle archive error:", err);
    }
  };

  const handleToggleFavorite = async () => {
    if (!address) return;
    try {
      if (isFavorite) {
        await groupService.unfavoriteGroup(address);
      } else {
        await groupService.favoriteGroup(address);
      }
      setIsFavorite(!isFavorite);
    } catch (err) {
      console.error("❌ [GROUP] Toggle favorite error:", err);
    }
  };

  const handleDeleteChat = async () => {
    if (!address) return;

    try {
      await groupService.deleteGroup(address);
      console.log("✅ [GROUP-MGMT] Group deleted.");
      // Navigate back to chat list
      navigate({ to: '/' });
    } catch (err) {
      console.error("❌ [GROUP-MGMT] Delete failed:", err);
    }
  };

  /* ----------------------------------------------------------------------------
      FETCH CONTACTS HELPER
  ---------------------------------------------------------------------------- */
  const fetchContactsForKeys = async (publicKeys: string[]) => {
    // Filter out keys we already have
    const missingKeys = publicKeys.filter(key => !contactsMap[key]);
    if (missingKeys.length === 0) return;

    try {
      // Get all contacts from MAXIMA
      MDS.cmd.maxcontacts((res: any) => {
        if (res.status && res.response && res.response.contacts) {
          const newContacts: Record<string, { name: string; icon?: string }> = {};

          res.response.contacts.forEach((c: any) => {
            if (missingKeys.includes(c.publickey)) {
              let icon = c.extradata?.icon;
              let validIcon: string | undefined = undefined;

              if (icon && typeof icon === 'string') {
                try {
                  // Handle both encoded (data%3A) and regular strings
                  const decoded = icon.startsWith('data%3A') ? decodeURIComponent(icon) : icon;
                  // Validate it's a real image data URI and not 0x00
                  if (decoded.startsWith("data:image") && !decoded.includes("0x00")) {
                    validIcon = decoded;
                  }
                } catch (e) {
                  console.warn("⚠️ [AVATAR] Decode warning:", e);
                }
              }

              newContacts[c.publickey] = {
                name: c.extradata?.name || c.currentaddress || "Unknown",
                icon: validIcon
              };
            }
          });

          setContactsMap(prev => ({ ...prev, ...newContacts }));
        }
      });
    } catch (err) {
      console.error("❌ [CONTACTS] Fetch error:", err);
    }
  };



  /* ----------------------------------------------------------------------------
      RENDER
  ---------------------------------------------------------------------------- */
  return (
    <div className="flex-1 w-full flex flex-col bg-[#E5DDD5] dark:bg-gray-900 min-h-0">
      {/* HEADER - Fixed at top */}
      <div className="bg-primary-600 dark:bg-gray-800 text-white p-4 pt-[calc(1rem+env(safe-area-inset-top))] px-4 flex items-center gap-3 flex-shrink-0 shadow-sm z-30 transition-colors border-b border-primary-700 dark:border-gray-700">
        {/* Back button */}
        <button
          onClick={() => navigate({ to: '/' })}
          className="p-2 hover:bg-white/10 rounded-full transition-colors"
          title="Back"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>

        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-12 h-12 rounded-full bg-primary-500 flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
            {contact?.extradata?.name?.charAt(0).toUpperCase() || "G"}
          </div>
          <div className="flex flex-col leading-tight flex-1 min-w-0">
            <strong className="text-[16px] truncate font-semibold flex items-center gap-1.5">
              {contact?.extradata?.name || "Group"}
              {isFavorite && (
                <Star
                  size={14}
                  fill="#fbbf24"
                  stroke="#f59e0b"
                  className="flex-shrink-0"
                />
              )}
            </strong>
            <span className="text-xs opacity-80 truncate block">
              {memberCount} Group members
            </span>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex gap-4 relative" ref={menuRef}>
          <button
            className="opacity-80 hover:opacity-100"
            onClick={() => setShowMenu(!showMenu)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>

          {/* Dropdown Menu */}
          {showMenu && (
            <div className="absolute top-10 right-0 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 min-w-[200px] z-50 animate-in slide-in-from-top-2 fade-in duration-200">
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 rounded-t-lg transition-colors text-left"
                onClick={() => {
                  setShowMenu(false);
                  navigate({
                    to: '/group-info/$groupId',
                    params: { groupId: address },
                    search: { returnTo: `/groups/${address}`, tab: "settings" },
                  });
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
                  navigate({
                    to: '/group-info/$groupId',
                    params: { groupId: address },
                    search: { returnTo: `/groups/${address}` },
                  });
                }}
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Info size={16} />
                </div>
                <span className="font-medium">Group Info</span>
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
                  {isArchived ? "Unarchive Group" : "Archive Group"}
                </span>
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
                  {isFavorite ? "Unfavorite Group" : "Favorite Group"}
                </span>
              </button>
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded-b-lg transition-colors text-left border-t border-gray-100 dark:border-gray-700"
                onClick={() => {
                  setShowMenu(false);
                  setShowDeleteConfirm(true);
                }}
              >
                <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">
                  <Trash2 size={16} />
                </div>
                <span className="font-medium">Exit Group</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chat Info Dialog */}
      {showChatInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 md:bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95 fade-in duration-200 border border-gray-700 md:border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white md:text-gray-900 dark:text-white">
                Chat Statistics
              </h3>
              <button
                onClick={() => setShowChatInfo(false)}
                className="text-gray-400 md:text-gray-500 hover:text-gray-300 md:hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Total Messages */}
              <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-primary-400 md:text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-300 md:text-gray-700 dark:text-gray-300">Total Messages</span>
                </div>
                <span className="text-lg font-bold text-white md:text-gray-900 dark:text-white">{messages.length}</span>
              </div>

              {/* Charms Sent/Received */}
              <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
                    <span className="text-xl">✨</span>
                  </div>
                  <span className="font-medium text-gray-300 md:text-gray-700 dark:text-gray-300">Charms</span>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-400 md:text-gray-500 dark:text-gray-400">
                    Sent: {messages.filter(m => m.charm && m.fromMe).length} | Received: {messages.filter(m => m.charm && !m.fromMe).length}
                  </div>
                </div>
              </div>

              {/* Tokens Transferred */}
              <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-400 md:text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-300 md:text-gray-700 dark:text-gray-300">Token Transfers</span>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-400 md:text-gray-500 dark:text-gray-400">
                    Sent: {messages.filter(m => m.tokenAmount && m.fromMe).length} | Received: {messages.filter(m => m.tokenAmount && !m.fromMe).length}
                  </div>
                </div>
              </div>

              {/* First Message Date */}
              {messages.length > 0 && messages[0].timestamp && (
                <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-500/20 rounded-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-orange-400 md:text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <span className="font-medium text-gray-300 md:text-gray-700 dark:text-gray-300">First Message</span>
                  </div>
                  <span className="text-sm text-gray-400 md:text-gray-600 dark:text-gray-400">
                    {new Date(messages[0].timestamp).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowChatInfo(false)}
              className="w-full mt-6 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 fade-in duration-200 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Exit Group?</h3>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Are you sure you want to exit this group? You will no longer receive new messages.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  handleDeleteChat();
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHAT BODY - Scrollable */}
      <div
        ref={scrollContainerRef}
        className={`flex-1 overflow-y-auto flex flex-col p-2 sm:p-4 relative transition-colors
          ${chatBackground === 'diagonal' ? 'bg-gray-50 dark:bg-gray-900' :
            chatBackground === 'default' ? 'bg-gray-50 dark:bg-gray-900' :
              'bg-gray-50 dark:bg-gray-900' /* Base for patterns */}
        `}
      >
        {/* Pattern Overlays - Fixed positioning ensures they cover full screen even with scroll */}
        {chatBackground === 'dots' && (
          <div
            className="fixed inset-0 opacity-[0.05] dark:opacity-[0.1] pointer-events-none z-0"
            style={{
              backgroundImage: `radial-gradient(#0f172a 1.5px, transparent 1.5px)`,
              backgroundSize: '24px 24px'
            }}
          />
        )}
        {chatBackground === 'grid' && (
          <div
            className="fixed inset-0 opacity-[0.4] dark:opacity-[0.05] pointer-events-none z-0"
            style={{
              backgroundImage: `linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(to right, #cbd5e1 1px, transparent 1px)`,
              backgroundSize: '20px 20px'
            }}
          />
        )}
        {chatBackground === 'diagonal' && (
          <div
            className="fixed inset-0 opacity-[0.4] dark:opacity-[0.1] pointer-events-none z-0"
            style={{
              backgroundImage: `repeating-linear-gradient(45deg, #e2e8f0 0px, #e2e8f0 2px, transparent 2px, transparent 12px)`
            }}
          />
        )}

        {/* Pending Transactions Indicator */}
        {messages.filter(m => m.status === 'pending').length > 0 && (
          <div className="sticky top-0 z-20 mb-4 mx-2 mt-2">
            {messages.filter(m => m.status === 'pending').map((msg) => (
              <div key={msg.timestamp} className="bg-primary-50/95 dark:bg-primary-900/40 backdrop-blur-sm border border-primary-200 dark:border-primary-700 rounded-lg shadow-sm p-4 mb-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 bg-primary-100 dark:bg-primary-800 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-primary-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                      Sending {msg.tokenAmount ? 'Token' : 'Charm'}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {msg.tokenAmount
                        ? `${msg.tokenAmount.amount} ${msg.tokenAmount.tokenName} `
                        : `${msg.amount} MINIMA`}
                      {' · '}
                      <span className="text-primary-600 dark:text-primary-400 font-medium">Waiting for confirmation...</span>
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center z-0">
            <div className="bg-[#FFF5C4] dark:bg-yellow-900/30 text-gray-800 dark:text-yellow-100 text-[12.5px] p-3 rounded-lg shadow-sm text-center max-w-xs leading-relaxed select-none border border-yellow-200 dark:border-yellow-800">
              <span className="text-yellow-600 mr-1">🔒</span>
              Messages are end-to-end encrypted. No one outside of this chat, not even MetaChain, can read or listen to them.
            </div>
          </div>
        )}

        {messages.filter(m => m.status !== 'pending' && m.status !== 'zombie').map((msg, i, arr) => {
          const currentDate = new Date(msg.timestamp || 0).toDateString();
          const prevDate = i > 0 ? new Date(arr[i - 1].timestamp || 0).toDateString() : null;
          const showDate = currentDate !== prevDate;

          return (
            <div key={`${msg.timestamp}-${msg.text || 'no-text'}-${i}`} className="flex flex-col w-full z-0 relative">
              {showDate && msg.timestamp && (
                <div className="flex justify-center my-3 sticky top-2 z-10">
                  <span className="text-xs text-gray-600 dark:text-gray-300 font-medium bg-[#E1F3FB] dark:bg-gray-800 border border-white/50 dark:border-gray-700 px-3 py-1.5 rounded-lg shadow-sm uppercase tracking-wide backdrop-blur-sm">
                    {new Date(msg.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                  </span>
                </div>
              )}
              {msg.type === 'system' ? (
                <div className="flex justify-center my-4 z-10 w-full">
                  <span className="text-xs text-center text-gray-500 bg-gray-100/80 dark:bg-gray-800/80 dark:text-gray-400 px-4 py-2 rounded-xl backdrop-blur-sm max-w-[80%] mx-auto">
                    {msg.text}
                  </span>
                </div>
              ) : (
                <MessageBubble
                  fromMe={msg.fromMe}
                  text={msg.text}
                  charm={msg.charm}
                  amount={msg.amount}
                  timestamp={msg.timestamp}
                  status={msg.status}
                  tokenAmount={msg.tokenAmount}
                  senderName={msg.fromMe ? (userName || "You") : (msg.senderPublicKey ? (contactsMap[msg.senderPublicKey]?.name || msg.senderUsername || msg.senderPublicKey.substring(0, 6)) : (msg.senderUsername || "Unknown"))}
                  senderImage={msg.fromMe ? userAvatar : (msg.senderPublicKey ? contactsMap[msg.senderPublicKey]?.icon : undefined)}
                  onAvatarClick={!msg.fromMe && msg.senderPublicKey ? () => navigate({ to: `/contact-info/${msg.senderPublicKey}`, search: { returnTo: `/groups/${address}` } }) : undefined}
                />
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* INPUT BAR - Fixed at bottom */}
      <div className="p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] bg-white dark:bg-gray-800 flex gap-1 items-center flex-shrink-0 z-10 relative border-t border-gray-200 dark:border-gray-700">
        <div className="flex-1 min-w-0 bg-white dark:bg-gray-700 rounded-2xl flex items-center border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent shadow-sm px-3 py-2 transition-all cursor-text relative">
          {/* EMOJI PICKER CONTAINER */}
          <div
            ref={emojiPickerRef}
            className={`absolute bottom-full mb-2 left-0 z-50 transition-all duration-200 shadow-2xl rounded-xl border border-gray-100 dark:border-gray-700 ${!showEmojiPicker ? "opacity-0 scale-95 pointer-events-none invisible" : "opacity-100 scale-100 visible"}`}
          >
            <Suspense
              fallback={
                <div className="h-[350px] w-[300px] bg-white dark:bg-gray-800 animate-pulse rounded-xl" />
              }
            >
              <EmojiPicker
                onEmojiClick={onEmojiClick}
                theme={mode === "dark" ? ("dark" as any) : ("light" as any)}
                width={320}
                height={400}
                searchDisabled={true}
                skinTonesDisabled
                previewConfig={{ showPreview: false }}
              />
            </Suspense>
          </div>

          <button
            className={`p-1 mr-1 rounded-full transition-colors flex-shrink-0 ${showEmojiPicker ? "text-primary-500" : "text-gray-400 hover:text-gray-600"}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowEmojiPicker(!showEmojiPicker);
            }}
            title="Emoji"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>

          <input
            onFocus={() => setShowEmojiPicker(false)}
            onKeyUp={(e) => {
              cursorPositionRef.current = e.currentTarget.selectionStart;
            }}
            onClick={(e) => {
              cursorPositionRef.current = e.currentTarget.selectionStart;
            }}
            onSelect={(e) => {
              cursorPositionRef.current = e.currentTarget.selectionStart;
            }}
            className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-[15px] max-h-32 py-1"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            placeholder="Type a message"
          />
        </div>

        <button
          className={`p-2 rounded-full transition-all duration-200 shadow-sm
            ${input.trim() ? 'bg-primary-600 text-white hover:bg-primary-700 transform hover:scale-105' : 'bg-gray-200 text-gray-400 cursor-default'}`}
          onClick={handleSendMessage}
          disabled={!input.trim()}
        >
          <svg className="w-5 h-5 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
          </svg>
        </button>
      </div>
    </div>
  );
}