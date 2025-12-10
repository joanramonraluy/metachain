// src/components/init/CheckContacts.tsx

import { useContext, useEffect, useState } from "react";
import { appContext } from "../../AppContext";
import { MDS } from "@minima-global/mds";
import { useNavigate } from "@tanstack/react-router";
import { Plus, VolumeX } from "lucide-react";
import { minimaService } from "../../services/minima.service";

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddContactDialog, setShowAddContactDialog] = useState(false);
  const [contactAddress, setContactAddress] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const navigate = useNavigate();

  const fetchContacts = async () => {
    try {
      const res: any = await MDS.cmd.maxcontacts();
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
          const isMuted = await minimaService.isContactMuted(c.publickey);
          return { ...c, muted: isMuted };
        }
        return c;
      }));

      setContacts(enrichedList);
    } catch (err: any) {
      console.error("🚨 Error fetching contacts:", err);
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loaded) return;
    fetchContacts();
  }, [loaded]);

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
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
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
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none min-h-[100px] font-mono text-sm"
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
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isAdding}
              >
                {isAdding ? "Adding..." : "Add Contact"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="h-screen flex flex-col bg-gray-50">
        {/* Syncing Indicator */}
        {isSyncing && (
          <div className="bg-blue-500 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
            Loading new contact...
          </div>
        )}


        {/* Contacts List */}
        <div className="flex-1 overflow-y-auto p-3">
          {contacts.length > 0 ? (
            <div className="space-y-2">
              {contacts.map((c, i) => (
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
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 hover:shadow-md cursor-pointer transition-shadow active:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                      <img
                        src={getAvatar(c)}
                        alt={c.extradata?.name || "Unknown"}
                        className="w-12 h-12 rounded-full object-cover bg-gray-200"
                        onError={(e: any) => {
                          e.target.src = defaultAvatar;
                        }}
                      />
                      {c.samechain && (
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
                      )}
                      {c.muted && (
                        <div className="absolute -top-1 -right-1 bg-orange-100 rounded-full p-0.5 border border-white shadow-sm">
                          <VolumeX size={12} className="text-orange-500" />
                        </div>
                      )}
                    </div>

                    {/* Contact Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="font-semibold text-gray-900 truncate">
                          {c.extradata?.name || "Unknown"}
                        </h3>
                        <span className="text-xs text-gray-500 flex-shrink-0">
                          {timeAgo(c.lastseen)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {c.publickey?.slice(0, 16)}...
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8 text-center">
              <div className="bg-gray-100 p-4 rounded-full mb-4">
                <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">No contacts found</h3>
              <p className="text-sm">Click the + button to add your first contact.</p>
            </div>
          )}
        </div>

        {/* Floating Action Button */}
        <button
          onClick={() => setShowAddContactDialog(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-30"
          title="Add Contact"
        >
          <Plus size={24} />
        </button>
      </div>
    </>
  );
}
