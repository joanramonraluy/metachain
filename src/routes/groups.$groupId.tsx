// src/routes/groups.$groupId.tsx
import { useEffect, useRef, useState, useContext } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MDS } from "@minima-global/mds";
import { appContext } from "../AppContext";
import { Trash2, Info } from "lucide-react";
import { groupService } from "../services/group.service";
import MessageBubble from "../components/chat/MessageBubble";

export const Route = createFileRoute("/groups/$groupId")({
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
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'zombie';
  tokenAmount?: { amount: string; tokenName: string }; // For token transfer messages
  senderPublicKey?: string;
}



function ChatPage() {
  // Helper to remove duplicate messages (by timestamp + text)
  const deduplicateMessages = (msgs: ParsedMessage[]) => {
    const seen = new Set<string>();
    return msgs.filter((m) => {
      // Create a more unique key including type info
      const typeStr = m.charm ? 'charm' : m.tokenAmount ? 'token' : 'text';
      const key = `${m.timestamp} -${typeStr} -${m.text || ''} `;

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [memberCount, setMemberCount] = useState<number>(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { userName, myPublicKey } = useContext(appContext);
  const isLoadingMessages = useRef(false); // Flag to prevent simultaneous loads



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
        }

        const members = await groupService.getGroupMembers(address);
        setMemberCount(members.length);

        // Sync history
        await groupService.requestGroupHistory(address);
      } catch (err) {
        console.error("[Group] Error loading group:", err);
      }
    };

    fetchGroupData();
  }, [address]);



  /* ----------------------------------------------------------------------------
      LOAD MESSAGES FROM DB
  ---------------------------------------------------------------------------- */
  // Helper to load messages from DB - reusable for initial load and after sending
  const loadMessagesFromDB = async () => {
    if (!address) return;

    // Prevent simultaneous loads
    if (isLoadingMessages.current) {
      console.log("⏭️ [Group] Skipping load - already loading messages");
      return;
    }

    isLoadingMessages.current = true;

    try {
      const rawMessages = await groupService.getGroupMessages(address);

      if (Array.isArray(rawMessages)) {
        const parsedMessages = rawMessages.map((row: any) => {
          const displayText = decodeURIComponent(row.MESSAGE || "");

          const parsed = {
            text: displayText,
            fromMe: row.SENDER_PUBLICKEY === myPublicKey,
            charm: null,
            amount: null,
            timestamp: Number(row.DATE || 0),
            status: 'sent' as const,
            tokenAmount: undefined,
            senderPublicKey: row.SENDER_PUBLICKEY,
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
      console.error("Failed to load group messages:", err);
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

    // Cleanup: remove listener when component unmounts or dependencies change
    return () => {
      groupService.removeGroupMessageCallback(handleNewMessage);
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

    const newMsg: ParsedMessage = { text: input, fromMe: true, charm: null, amount: null, timestamp: Date.now(), status: 'sent' };
    setMessages((prev) => [...prev, newMsg]);

    try {
      await groupService.sendGroupMessage(address, input, "text", myPublicKey, userName);
    } catch (err) {
      console.error("[Group] Error sending message:", err);
    }

    setInput("");
  };

  /* ----------------------------------------------------------------------------
      DELETE GROUP
  ---------------------------------------------------------------------------- */
  const handleDeleteChat = async () => {
    if (!address) return;

    try {
      await groupService.deleteGroup(address);
      console.log("✅ Group deleted successfully");
      // Navigate back to chat list
      navigate({ to: '/' });
    } catch (err) {
      console.error("❌ Failed to delete group:", err);
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
                  console.warn("Failed to decode contact icon", e);
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
      console.error("Failed to fetch contacts:", err);
    }
  };



  /* ----------------------------------------------------------------------------
      RENDER
  ---------------------------------------------------------------------------- */
  return (
    <div className="h-screen flex flex-col bg-[#E5DDD5]">
      {/* HEADER - Fixed at top */}
      <div className="bg-[#0088cc] text-white p-4 px-4 flex items-center gap-3 flex-shrink-0 shadow-sm z-10">
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
          <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
            {contact?.extradata?.name?.charAt(0).toUpperCase() || "G"}
          </div>
          <div className="flex flex-col leading-tight flex-1 min-w-0">
            <strong className="text-[16px] truncate font-semibold">
              {contact?.extradata?.name || "Group"}
            </strong>
            <span className="text-xs opacity-80 truncate block">
              {memberCount} Group members
            </span>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex gap-4 relative">
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
            <div className="absolute top-10 right-0 bg-gray-800 md:bg-white rounded-lg shadow-xl border border-gray-700 md:border-gray-200 min-w-[180px] z-50 animate-in slide-in-from-top-2 fade-in duration-200">
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-gray-700 md:hover:bg-gray-100 text-gray-300 md:text-gray-700 rounded-t-lg transition-colors text-left"
                onClick={() => {
                  setShowMenu(false);
                  // TODO: Navigate to group info page
                  alert("Group Info - Coming soon!");
                }}
              >
                <Info size={18} />
                <span className="font-medium">Group Info</span>
              </button>
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-red-900/50 md:hover:bg-red-50 text-red-400 md:text-red-600 rounded-b-lg transition-colors text-left border-t border-gray-700 md:border-gray-200"
                onClick={() => {
                  setShowMenu(false);
                  setShowDeleteConfirm(true);
                }}
              >
                <Trash2 size={18} />
                <span className="font-medium">Exit Group</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 md:bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 fade-in duration-200 border border-gray-700 md:border-gray-200">
            <h3 className="text-lg font-bold text-white md:text-gray-900 mb-2">Exit Group?</h3>
            <p className="text-gray-300 md:text-gray-600 mb-6">
              Are you sure you want to exit this group? You will no longer receive new messages.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 border border-gray-600 md:border-gray-300 text-gray-300 md:text-gray-700 rounded-lg hover:bg-gray-700 md:hover:bg-gray-50 transition-colors font-medium"
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
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto flex flex-col p-2 sm:p-4 bg-gray-50 relative">
        {/* Custom Background Pattern (Subtle Dot Grid) */}
        <div
          className="absolute inset-0 opacity-[0.4] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(#cbd5e1 1.5px, transparent 1.5px)`,
            backgroundSize: '24px 24px'
          }}
        ></div>

        {/* Pending Transactions Indicator */}
        {messages.filter(m => m.status === 'pending').length > 0 && (
          <div className="sticky top-0 z-20 mb-4 mx-2 mt-2">
            {messages.filter(m => m.status === 'pending').map((msg) => (
              <div key={msg.timestamp} className="bg-yellow-50/95 backdrop-blur-sm border border-yellow-200 rounded-lg shadow-sm p-3 mb-2 flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center shrink-0 border border-yellow-200">
                    <span className="animate-spin text-xl">⏳</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-yellow-800">
                      Sending {msg.tokenAmount ? 'Token' : 'Charm'}
                    </p>
                    <p className="text-xs text-yellow-700 font-medium mt-0.5">
                      {msg.tokenAmount
                        ? `${msg.tokenAmount.amount} ${msg.tokenAmount.tokenName} `
                        : `${msg.amount} MINIMA`}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-yellow-700 font-semibold bg-yellow-100 px-2.5 py-1 rounded-full border border-yellow-200">
                  Waiting Confirmation...
                </div>
              </div>
            ))}
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center z-0">
            <div className="bg-[#FFF5C4] text-gray-800 text-[12.5px] p-3 rounded-lg shadow-sm text-center max-w-xs leading-relaxed select-none">
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
            <div key={`${msg.timestamp} -${msg.text || 'no-text'} -${i} `} className="flex flex-col w-full z-0 relative">
              {showDate && msg.timestamp && (
                <div className="flex justify-center my-3 sticky top-2 z-10">
                  <span className="text-xs text-gray-600 font-medium bg-[#E1F3FB] border border-white/50 px-3 py-1.5 rounded-lg shadow-sm uppercase tracking-wide backdrop-blur-sm">
                    {new Date(msg.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                  </span>
                </div>
              )}
              {/* Message Bubble with Sender Info */}
              <div className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'} mb-2`}>
                <MessageBubble
                  fromMe={msg.fromMe}
                  text={msg.text}
                  charm={msg.charm}
                  amount={msg.amount}
                  timestamp={msg.timestamp}
                  status={msg.status}
                  tokenAmount={msg.tokenAmount}
                  senderName={!msg.fromMe && msg.senderPublicKey ? (contactsMap[msg.senderPublicKey]?.name || msg.senderPublicKey.substring(0, 6)) : undefined}
                  senderImage={!msg.fromMe && msg.senderPublicKey ? contactsMap[msg.senderPublicKey]?.icon : undefined}
                  onAvatarClick={!msg.fromMe && msg.senderPublicKey ? () => navigate({ to: `/contact-info/${msg.senderPublicKey}`, search: { returnTo: `/groups/${address}` } }) : undefined}
                />
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* INPUT BAR - Fixed at bottom */}
      <div className="p-2 bg-[#F0F2F5] flex gap-2 items-center flex-shrink-0 z-10 relative">
        <div className="flex-1 bg-white rounded-2xl flex items-center border border-gray-200 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent shadow-sm px-4 py-2 transition-all">
          <input
            className="flex-1 bg-transparent outline-none text-gray-900 placeholder-gray-500 text-[15px] max-h-32 py-1"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            placeholder="Type a message"
          />
        </div>

        <button
          className={`p-3 rounded-full transition-all duration-200 shadow-sm
            ${input.trim()
              ? 'bg-[#0088cc] text-white hover:bg-[#0077b5] transform hover:scale-105'
              : 'bg-gray-200 text-gray-400 cursor-default'
            }`}
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