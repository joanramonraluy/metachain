// src/routes/chat/$address.tsx
import { useEffect, useRef, useState, useContext } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MDS } from "@minima-global/mds";
import { appContext } from "../../AppContext";
import CharmSelector from "../../components/chat/CharmSelector";
import { Paperclip, Trash2, Info, BarChart, Archive, Star } from "lucide-react";
import MessageBubble from "../../components/chat/MessageBubble";
import TokenSelector from "../../components/chat/TokenSelector";
import { minimaService } from "../../services/minima.service";
import InviteDialog from "../../components/chat/InviteDialog";

export const Route = createFileRoute("/chat/$address")({
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
  const { address } = Route.useParams();
  const [contact, setContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [input, setInput] = useState("");
  const [showCharmSelector, setShowCharmSelector] = useState(false);
  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);


  const [showReadModeWarning, setShowReadModeWarning] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteSending, setInviteSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { writeMode, userName } = useContext(appContext);
  const isLoadingMessages = useRef(false); // Flag to prevent simultaneous loads

  const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

  const getAvatar = (c: Contact | null) => {
    if (!c) return defaultAvatar;

    if (c.extradata?.icon) {
      try {
        const decoded = decodeURIComponent(c.extradata.icon);
        // Check if it's a valid data URL, and not a URL ending in /0x00 (no photo)
        if (decoded.startsWith("data:image") && !decoded.includes("/0x00")) {
          return decoded;
        }
      } catch (err) {
        console.warn("[Avatar] Error decoding icon:", err);
      }
    }
    return defaultAvatar;
  };



  /* ----------------------------------------------------------------------------
      GET CONTACT INFO
  ---------------------------------------------------------------------------- */
  useEffect(() => {
    const fetchContact = async () => {
      try {
        const res = await MDS.cmd.maxcontacts();
        const list: Contact[] = (res as any)?.response?.contacts || [];
        const c = list.find(
          (x) =>
            x.publickey === address ||
            x.currentaddress === address ||
            x.extradata?.minimaaddress === address
        );
        setContact(c || null);
      } catch (err) {
        console.error("[Contact] Error loading contact:", err);
      }
    };

    fetchContact();
  }, [address]);

  // Check chat status (archived and favorite)
  const checkChatStatus = async () => {
    if (!contact?.publickey) return;
    try {
      const status = await minimaService.getChatStatus(contact.publickey);
      setIsArchived(status.archived);
      setIsFavorite(status.favorite);
    } catch (err) {
      console.error("Error checking chat status:", err);
    }
  };

  useEffect(() => {
    if (contact?.publickey) {
      checkChatStatus();
    }
  }, [contact]);

  // Listen for archive and favorite status changes
  useEffect(() => {
    const handleStatusChange = () => {
      checkChatStatus();
    };

    minimaService.onArchiveStatusChange(handleStatusChange);
    minimaService.onFavoriteStatusChange(handleStatusChange);

    return () => {
      minimaService.removeArchiveStatusCallback(handleStatusChange);
      minimaService.removeFavoriteStatusCallback(handleStatusChange);
    };
  }, [contact]);

  /* ----------------------------------------------------------------------------
      LOAD MESSAGES FROM DB
  ---------------------------------------------------------------------------- */
  // Helper to load messages from DB - reusable for initial load and after sending
  const loadMessagesFromDB = async () => {
    if (!contact?.publickey) return;

    // Prevent simultaneous loads
    if (isLoadingMessages.current) {
      console.log("⏭️ [Chat] Skipping load - already loading messages");
      return;
    }

    isLoadingMessages.current = true;

    try {
      const rawMessages = await minimaService.getMessages(contact.publickey);

      if (Array.isArray(rawMessages)) {
        const parsedMessages = rawMessages.map((row: any) => {
          const isCharm = row.TYPE === "charm";
          const isToken = row.TYPE === "token";
          const charmObj = isCharm ? { id: row.MESSAGE } : null;

          let tokenAmount: { amount: string; tokenName: string } | undefined;
          let displayText: string | null = null;

          if (isToken) {
            try {
              const tokenData = JSON.parse(decodeURIComponent(row.MESSAGE || "{}"));
              tokenAmount = { amount: tokenData.amount, tokenName: tokenData.tokenName };
              displayText = `I sent you ${tokenData.amount} ${tokenData.tokenName} `;
            } catch (err) {
              console.error("[DB] Error parsing token data:", err);
              displayText = decodeURIComponent(row.MESSAGE || "");
            }
          } else if (!isCharm) {
            displayText = decodeURIComponent(row.MESSAGE || "");
          }

          // Safer status parsing - do NOT default to 'sent' blindly
          let parsedStatus: any = row.STATE;
          if (!parsedStatus || parsedStatus === 'null' || parsedStatus === 'undefined') {
            // If state is missing, default based on type AND sender
            const username = row.USERNAME;
            parsedStatus = (isCharm || isToken) && username === "Me" ? 'pending' : 'sent';
          }

          const parsed = {
            text: displayText,
            fromMe: row.USERNAME === "Me",
            charm: charmObj,
            amount: isCharm ? Number(row.AMOUNT || 0) : null,
            timestamp: Number(row.DATE || 0),
            status: parsedStatus,
            tokenAmount,
          };

          return parsed;
        });

        const deduplicatedMessages = deduplicateMessages(parsedMessages);
        setMessages(deduplicatedMessages);
      }
    } catch (err) {
      console.error("Failed to load messages:", err);
    } finally {
      isLoadingMessages.current = false;
    }
  };

  useEffect(() => {
    if (!address || !contact?.publickey) return;

    const initChat = async () => {
      // Initial load
      await loadMessagesFromDB();

      // Mark chat as opened
      minimaService.markChatAsOpened(contact.publickey);

      // Verify pending transactions when entering chat
      minimaService.cleanupOrphanedPendingTransactions().catch(err => {
        console.error("❌ [ChatPage] Error verifying pending transactions:", err);
      });
    };

    initChat();

    // Poll for new messages every 10 seconds
    const interval = setInterval(() => {
      loadMessagesFromDB();
    }, 10000);

    return () => clearInterval(interval);
  }, [address, contact]); // Removed userName - not used in this effect


  const [appStatus, setAppStatus] = useState<'unknown' | 'checking' | 'installed' | 'not_found'>('unknown');

  /* ----------------------------------------------------------------------------
      LISTEN FOR INCOMING MESSAGES
  ---------------------------------------------------------------------------- */
  useEffect(() => {
    if (!contact) return;

    // Always check app status when entering chat
    if (contact.publickey) {
      // console.log("🔄 [Chat] Auto-checking app status...");
      setAppStatus('checking');
      minimaService.sendPing(contact.publickey).catch(console.error);

      // Timeout for auto-check
      setTimeout(() => {
        setAppStatus((prev) => prev === 'checking' ? 'not_found' : prev);
      }, 5000);
    }

    const handleNewMessage = (payload: any) => {
      // Handle Pong response
      if (payload.type === 'pong') {
        setAppStatus('installed');
        // Save that this user has the app installed
        if (contact.publickey) {
          minimaService.setAppInstalled(contact.publickey);
        }
        return;
      }

      // Skip loading for ping, receipts - they don't add messages to DB
      if (payload.type === 'ping' || payload.type === 'read_receipt' || payload.type === 'delivery_receipt') {
        return;
      }

      // Only reload for actual new messages (text, charm, token)
      loadMessagesFromDB().then(() => {
        // Send read receipt for new messages
        if (contact.publickey) {
          minimaService.sendReadReceipt(contact.publickey);
        }
      });
    };

    // Send read receipt immediately when entering the chat
    if (contact.publickey) {
      minimaService.sendReadReceipt(contact.publickey);
    }

    // Subscribe to new messages
    minimaService.onNewMessage(handleNewMessage);

    // Cleanup: remove listener when component unmounts or dependencies change
    return () => {
      minimaService.removeNewMessageCallback(handleNewMessage);
    };
  }, [contact, address]); // Re-run when contact or address changes

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
    if (!contact?.publickey) {
      console.error("[Send] Cannot send: no publickey for contact");
      return;
    }

    const username = contact?.extradata?.name || "Unknown";

    const newMsg: ParsedMessage = { text: input, fromMe: true, charm: null, amount: null, timestamp: Date.now(), status: 'sent' };
    setMessages((prev) => [...prev, newMsg]);

    try {
      await minimaService.sendMessage(contact.publickey, username, input);
    } catch (err) {
      console.error("[Send] Error sending message:", err);
    }

    setInput("");
  };

  /* ----------------------------------------------------------------------------
      SEND CHARM
  ---------------------------------------------------------------------------- */
  const executeSendCharm = async (charmId: string, amount: number) => {
    if (!contact?.publickey || !contact?.extradata?.minimaaddress) return;
    const username = contact?.extradata?.name || "Unknown";

    // Optimistic UI update REMOVED - we will show a separate pending indicator instead
    const tempTimestamp = Date.now();

    try {
      console.log("⏳ [ChatPage] Sending charm (pending indicator will be shown)...");


      const response = await minimaService.sendCharmWithTokens(
        contact.publickey,
        contact.extradata.minimaaddress,
        username,
        charmId,
        amount,
        tempTimestamp // Pass timestamp as stateId for tracking
      );

      // Reload messages from DB to get the inserted message (it will be pending or sent)
      await loadMessagesFromDB();

      // Only update to 'sent' if NOT pending
      if (!response || !response.pending) {
        console.log("✅ [ChatPage] Charm sent successfully (not pending). Updating status to 'sent'.");
        setMessages((prev) =>
          prev.map((m) =>
            m.timestamp === tempTimestamp ? { ...m, status: 'sent' as const } : m
          )
        );
      } else {
        console.log("⚠️ [ChatPage] Charm command is pending (Read Mode). Keeping status as 'pending'.");

        // Pending message tracking is now handled by transaction polling service
      }
    } catch (err) {
      console.error("Failed to send charm:", err);
      // Reload to ensure consistent state
      loadMessagesFromDB();
    }
  };

  const handleSendCharm = async ({ charmId, amount }: { charmId: string; charmLabel?: string; charmAnimation?: any; amount: number }) => {
    if (!charmId || !amount) return;
    if (!contact?.publickey) return;
    if (!contact?.extradata?.minimaaddress) {
      alert("This contact does not have a Minima address in their profile. Cannot send tokens with charm.");
      return;
    }

    setShowCharmSelector(false);

    // Check for Write Mode
    if (!writeMode) {
      setPendingAction(() => () => executeSendCharm(charmId, amount));
      setShowReadModeWarning(true);
      return;
    }

    await executeSendCharm(charmId, amount);
  };

  /* ----------------------------------------------------------------------------
      SEND TOKEN
  ---------------------------------------------------------------------------- */
  const executeSendToken = async (tokenId: string, amount: string, tokenName: string) => {
    if (!contact?.extradata?.minimaaddress || !contact?.publickey) return;

    const tempTimestamp = Date.now();
    const username = contact?.extradata?.name || "Unknown";
    const tokenData = JSON.stringify({ amount, tokenName });

    // Optimistic UI update REMOVED - we will show a separate pending indicator instead
    console.log("⏳ [ChatPage] Sending token (pending indicator will be shown)...");

    try {
      // 1. Send the token via Minima with stateId (timestamp)
      const tokenResponse = await minimaService.sendToken(tokenId, amount, contact.extradata.minimaaddress, tokenName, tempTimestamp);

      // Check if token send is pending
      const isTokenPending = tokenResponse && (tokenResponse.pending || (tokenResponse.error && tokenResponse.error.toString().toLowerCase().includes("pending")));

      // Extract txpowid and pendinguid
      const txpowid = tokenResponse?.txpowid;
      const pendinguid = tokenResponse?.pendinguid;

      if (isTokenPending) {
        console.log("⚠️ [ChatPage] Token send is pending. Keeping status as 'pending' and NOT sending notification message.");

        // Pending message tracking is now handled by transaction polling service

        // Save message locally with 'pending' state so it persists if we send other messages
        await minimaService.insertMessage({
          roomname: username,
          publickey: contact.publickey,
          username: "Me",
          type: "token",
          message: tokenData,
          filedata: "",
          state: "pending",
          amount: Number(amount),
          date: tempTimestamp
        });

        // Store transaction in TRANSACTIONS table if we have a txpowid OR pendinguid
        if (txpowid || pendinguid) {
          await minimaService.insertTransaction(
            txpowid,
            'token',
            contact.publickey,
            tempTimestamp,
            { tokenId, amount, tokenName, username },
            pendinguid
          );
          console.log(`💾[ChatPage] Token transaction tracked: ${txpowid || 'No TXPOWID'} (PendingUID: ${pendinguid || 'None'})`);
        } else {
          console.warn(`⚠️[ChatPage] Could not track token transaction: No txpowid AND no pendinguid`);
        }

        // Reload messages from DB to show the pending message
        await loadMessagesFromDB();

        // Don't send the Maxima message yet, keep it pending
        return;
      }

      // 2. Only send a chat message confirming the transaction if token was sent successfully
      console.log("✅ [ChatPage] Token sent successfully. Now sending notification message via Maxima...");
      const msgResponse = await minimaService.sendMessage(contact.publickey, username, tokenData, 'token');

      // Check if message send is pending (shouldn't happen if token wasn't pending, but just in case)
      const isMsgPending = msgResponse && (msgResponse.pending || (msgResponse.error && msgResponse.error.toString().toLowerCase().includes("pending")));

      // Only update to 'sent' if NOT pending
      if (!isMsgPending) {
        console.log("✅ [ChatPage] Token sent successfully (not pending). Updating status to 'sent'.");
        // Reload messages to show the sent message
        await loadMessagesFromDB();
      } else {
        console.log("⚠️ [ChatPage] Message command is pending (Read Mode). Keeping status as 'pending'.");
        // Reload messages to show the pending message
        await loadMessagesFromDB();
      }

    } catch (err) {
      console.error("Failed to send token:", err);
      // Reload to ensure consistent state
      loadMessagesFromDB();
    }
  };



  const handleSendToken = async (tokenId: string, amount: string, tokenName: string) => {
    if (!contact?.extradata?.minimaaddress) {
      alert("This contact does not have a Minima address in their profile. Cannot send tokens.");
      return;
    }

    setShowTokenSelector(false);

    // Check for Write Mode
    if (!writeMode) {
      setPendingAction(() => () => executeSendToken(tokenId, amount, tokenName));
      setShowReadModeWarning(true);
      return;
    }

    await executeSendToken(tokenId, amount, tokenName);
  };

  /* ----------------------------------------------------------------------------
      DELETE CHAT
  ---------------------------------------------------------------------------- */
  const handleDeleteChat = async () => {
    if (!contact?.publickey) return;

    try {
      await minimaService.deleteAllMessages(contact.publickey);
      console.log("✅ Chat deleted successfully");
      // Navigate back to chat list
      navigate({ to: '/' });
    } catch (err) {
      console.error("❌ Failed to delete chat:", err);
    }
  };

  /* ----------------------------------------------------------------------------
      TOGGLE ARCHIVE
  ---------------------------------------------------------------------------- */
  const handleToggleArchive = async () => {
    if (!contact?.publickey) return;

    try {
      if (isArchived) {
        await minimaService.unarchiveChat(contact.publickey);
        setIsArchived(false);
        console.log("✅ Chat unarchived successfully");
      } else {
        await minimaService.archiveChat(contact.publickey);
        setIsArchived(true);
        console.log("✅ Chat archived successfully");
      }
    } catch (err) {
      console.error("❌ Failed to toggle archive:", err);
    }
  };

  /* ----------------------------------------------------------------------------
      TOGGLE FAVORITE
  ---------------------------------------------------------------------------- */
  const handleToggleFavorite = async () => {
    if (!contact?.publickey) return;

    try {
      if (isFavorite) {
        await minimaService.unmarkChatAsFavorite(contact.publickey);
        setIsFavorite(false);
        console.log("✅ Chat unmarked as favorite");
      } else {
        await minimaService.markChatAsFavorite(contact.publickey);
        setIsFavorite(true);
        console.log("✅ Chat marked as favorite");
      }
    } catch (err) {
      console.error("❌ Failed to toggle favorite:", err);
    }
  };


  /* ----------------------------------------------------------------------------
      SEND INVITATION
  ---------------------------------------------------------------------------- */
  const handleSendInvite = async () => {
    if (!contact?.publickey) return;

    // Extra safety check
    if (appStatus !== 'not_found') {
      console.warn("Cannot send invite: App status is not 'not_found'");
      return;
    }

    setInviteSending(true);
    try {
      const username = userName || "A friend"; // Fallback if userName is not set in context
      await minimaService.sendInvitation(contact.publickey, username);

      // Close dialog
      setShowInviteDialog(false);

      // Optional: Show a toast or feedback? 
      // For now, we just close the dialog. The user will see the message in MaxSolo if they check sent messages, 
      // but here we just want to confirm the action was taken.
      alert("Invitation sent successfully via Maxima!");

    } catch (err) {
      console.error("Failed to send invitation:", err);
      alert("Failed to send invitation. Please try again.");
    } finally {
      setInviteSending(false);
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

        <div
          className={`flex items-center gap-3 flex-1 min-w-0 transition-opacity ${appStatus !== 'checking' && appStatus !== 'not_found'
            ? 'cursor-pointer hover:opacity-90'
            : ''
            }`}
          onClick={() => {
            if (appStatus !== 'checking' && appStatus !== 'not_found') {
              navigate({ to: `/contact-info/${address}` });
            }
          }}
        >
          <img
            src={getAvatar(contact)}
            alt="Avatar"
            className="w-12 h-12 rounded-full object-cover bg-gray-200"
          />
          <div className="flex flex-col leading-tight flex-1 min-w-0">
            <strong className="text-[16px] truncate font-semibold">
              {contact?.extradata?.name || "Unknown"}
            </strong>
            <div className="flex items-center gap-1">
              {appStatus === 'installed' ? (
                <span className="text-xs text-green-200 flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                  CharmChain Verified
                </span>
              ) : appStatus === 'checking' ? (
                <span className="text-xs opacity-80 cursor-default">
                  Checking status...
                </span>
              ) : appStatus === 'not_found' ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-red-200 cursor-default">
                    Dapp not detected
                  </span>
                  <span className="text-xs text-gray-400">•</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowInviteDialog(true);
                    }}
                    className="text-xs text-white font-medium hover:underline transition-colors"
                  >
                    Send Invite
                  </button>
                </div>
              ) : (
                <span className="text-xs opacity-80 truncate block">
                  online
                </span>
              )}
            </div>
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
                  navigate({ to: `/contact-info/${address}` });
                }}
              >
                <Info size={18} />
                <span className="font-medium">Contact Info</span>
              </button>
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-gray-700 md:hover:bg-gray-100 text-gray-300 md:text-gray-700 transition-colors text-left border-t border-gray-700 md:border-gray-200"
                onClick={() => {
                  setShowMenu(false);
                  setShowChatInfo(true);
                }}
              >
                <BarChart size={18} />
                <span className="font-medium">Chat Info</span>
              </button>
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-gray-700 md:hover:bg-gray-100 text-gray-300 md:text-gray-700 transition-colors text-left border-t border-gray-700 md:border-gray-200"
                onClick={() => {
                  setShowMenu(false);
                  handleToggleFavorite();
                }}
              >
                <Star size={18} fill={isFavorite ? "currentColor" : "none"} className={isFavorite ? "text-yellow-500" : ""} />
                <span className="font-medium">{isFavorite ? 'Unfavorite Chat' : 'Favorite Chat'}</span>
              </button>
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-gray-700 md:hover:bg-blue-50 text-gray-300 md:text-[#0088cc] transition-colors text-left border-t border-gray-700 md:border-gray-200"
                onClick={() => {
                  setShowMenu(false);
                  handleToggleArchive();
                }}
              >
                <Archive size={18} />
                <span className="font-medium">{isArchived ? 'Unarchive Chat' : 'Archive Chat'}</span>
              </button>
              <button
                className="flex items-center gap-3 w-full p-3 hover:bg-red-900/50 md:hover:bg-red-50 text-red-400 md:text-red-600 rounded-b-lg transition-colors text-left border-t border-gray-700 md:border-gray-200"
                onClick={() => {
                  setShowMenu(false);
                  setShowDeleteConfirm(true);
                }}
              >
                <Trash2 size={18} />
                <span className="font-medium">Delete Chat</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 md:bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 fade-in duration-200 border border-gray-700 md:border-gray-200">
            <h3 className="text-lg font-bold text-white md:text-gray-900 mb-2">Delete Chat?</h3>
            <p className="text-gray-300 md:text-gray-600 mb-6">
              This will permanently delete all messages in this conversation. This action cannot be undone.
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
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Dialog */}
      <InviteDialog
        isOpen={showInviteDialog}
        onClose={() => setShowInviteDialog(false)}
        onSend={handleSendInvite}
        isSending={inviteSending}
        contactName={contact?.extradata?.name || "this contact"}
      />

      {/* Chat Info Dialog */}
      {showChatInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 md:bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95 fade-in duration-200 border border-gray-700 md:border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white md:text-gray-900">Chat Statistics</h3>
              <button
                onClick={() => setShowChatInfo(false)}
                className="text-gray-400 md:text-gray-500 hover:text-gray-300 md:hover:text-gray-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Total Messages */}
              <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-400 md:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-300 md:text-gray-700">Total Messages</span>
                </div>
                <span className="text-lg font-bold text-white md:text-gray-900">{messages.length}</span>
              </div>

              {/* Charms Sent/Received */}
              <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
                    <span className="text-xl">✨</span>
                  </div>
                  <span className="font-medium text-gray-300 md:text-gray-700">Charms</span>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-400 md:text-gray-500">
                    Sent: {messages.filter(m => m.charm && m.fromMe).length} |
                    Received: {messages.filter(m => m.charm && !m.fromMe).length}
                  </div>
                </div>
              </div>

              {/* Tokens Transferred */}
              <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-400 md:text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <span className="font-medium text-gray-300 md:text-gray-700">Token Transfers</span>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-400 md:text-gray-500">
                    Sent: {messages.filter(m => m.tokenAmount && m.fromMe).length} |
                    Received: {messages.filter(m => m.tokenAmount && !m.fromMe).length}
                  </div>
                </div>
              </div>

              {/* First Message Date */}
              {messages.length > 0 && messages[0].timestamp && (
                <div className="flex items-center justify-between p-3 bg-gray-700/50 md:bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-500/20 rounded-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-orange-400 md:text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <span className="font-medium text-gray-300 md:text-gray-700">First Message</span>
                  </div>
                  <span className="text-sm text-gray-400 md:text-gray-600">
                    {new Date(messages[0].timestamp).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowChatInfo(false)}
              className="w-full mt-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}




      {/* CHAT BODY - Scrollable */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto flex flex-col p-2 sm:p-4 bg-gray-50 relative">
        {/* Custom Background Pattern (Subtle Dot Grid) */}
        <div
          className="absolute inset-0 opacity-[0.4] pointer-events-none"
          style={{
            backgroundImage: `radial - gradient(#cbd5e1 1.5px, transparent 1.5px)`,
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
              Messages are end-to-end encrypted. No one outside of this chat, not even CharmChain, can read or listen to them.
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
              <MessageBubble
                fromMe={msg.fromMe}
                text={msg.text}
                charm={msg.charm}
                amount={msg.amount}
                timestamp={msg.timestamp}
                status={msg.status}
                tokenAmount={msg.tokenAmount}
              />
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* INPUT BAR - Fixed at bottom */}
      <div className="p-2 bg-[#F0F2F5] flex gap-2 items-center flex-shrink-0 z-10 relative">
        {/* Attachment Menu Popover */}
        {showAttachments && (
          <div className="absolute bottom-16 left-2 bg-white rounded-xl shadow-xl border border-gray-100 p-2 flex flex-col gap-1 min-w-[160px] animate-in slide-in-from-bottom-2 fade-in duration-200">
            <button
              className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors text-left"
              onClick={() => {
                setShowAttachments(false);
                setShowCharmSelector(true);
              }}
            >
              <span className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center">✨</span>
              <span className="font-medium text-gray-700">Send Charm</span>
            </button>
            <button
              className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors text-left"
              onClick={() => {
                setShowAttachments(false);
                setShowTokenSelector(true);
              }}
            >
              <span className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center">💸</span>
              <span className="font-medium text-gray-700">Send Tokens</span>
            </button>
          </div>
        )}

        <button
          className={`p-3 rounded-full transition-colors ${showAttachments ? 'bg-gray-200 text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setShowAttachments(!showAttachments)}
          title="Attachments"
        >
          <Paperclip className="w-6 h-6" />
        </button>

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

      {showCharmSelector && (
        <CharmSelector
          onSend={handleSendCharm}
          onClose={() => setShowCharmSelector(false)}
        />
      )}

      {showTokenSelector && (
        <TokenSelector
          onSend={handleSendToken}
          onCancel={() => setShowTokenSelector(false)}
        />
      )}

      {/* Read Mode Warning Dialog */}
      {showReadModeWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl animate-in fade-in zoom-in duration-200">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center text-yellow-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900">Read Mode Active</h3>
              <p className="text-gray-600 text-sm leading-relaxed">
                The application is in <strong>Read Mode</strong>. This transaction will appear in <strong>Pending Commands</strong> in Minima.
                <br /><br />
                You will need to approve it there to complete the transfer.
              </p>
              <div className="flex gap-3 w-full mt-2">
                <button
                  onClick={() => {
                    setShowReadModeWarning(false);
                    setPendingAction(null);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowReadModeWarning(false);
                    if (pendingAction) pendingAction();
                    setPendingAction(null);
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
                >
                  Proceed
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}