import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { appContext } from "../AppContext";
import { groupService } from "../services/group.service";
import { chatService } from "../services/chat.service";
import { MDS } from "@minima-global/mds";
import { ArrowLeft, Check, Camera, Users } from "lucide-react";
import { compressImage } from "../utils/image";
import {
  getPublicListingsCount,
  LISTINGS_PUBLIC_LIMIT,
} from "../services/listings.service";

export const Route = createFileRoute("/create-group")({
  component: CreateGroupPage,
});

interface Contact {
  publickey: string;
  currentaddress: string;
  type: "contact" | "community";
  extradata?: {
    name?: string;
    icon?: string;
  };
}

function CreateGroupPage() {
  const { myPublicKey, userName } = useContext(appContext);
  const [groupName, setGroupName] = useState("");
  const [description, setDescription] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(
    new Set(),
  );
  const [creating, setCreating] = useState(false);
  const [avatar, setAvatar] = useState("");
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "contacts" | "community">(
    "all",
  );
  const [isPublic, setIsPublic] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [publicCount, setPublicCount] = useState(0);
  const [publicError, setPublicError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const loadContacts = async () => {
      try {
        // 1. Fetch Maxima contacts
        const res = await MDS.cmd.maxcontacts();
        const rawContacts = (res as any)?.response?.contacts || [];
        const contactsList: Contact[] = rawContacts.map((c: any) => ({
          ...c,
          type: "contact",
        }));

        // 2. Fetch Recent Chats (for non-contacts)
        const chats = await chatService.getRecentChats();

        // 3. Create a set of existing contact public keys for fast lookup
        const contactKeys = new Set(contactsList.map((c) => c.publickey));

        // 4. Filter chats to find people NOT in contacts
        const chatContacts: Contact[] = chats
          .filter(
            (chat) =>
              chat.publickey &&
              !contactKeys.has(chat.publickey) &&
              !chat.roomname.startsWith("Group: "), // Optional: Exclude groups if needed
          )
          .map((chat) => ({
            publickey: chat.publickey,
            currentaddress: chat.currentaddress || chat.publickey, // Use Maxima address if found (from Discovery), else fallback to pubkey
            type: "community",
            extradata: {
              name: chat.roomname,
              icon: chat.avatar,
            },
          }));

        // 5. Merge lists
        setContacts([...contactsList, ...chatContacts]);
      } catch (err) {
        console.error("❌ [CreateGroup] Error loading contacts:", err);
      }
    };

    loadContacts();
  }, []);

  useEffect(() => {
    const loadPublicCount = async () => {
      const count = await getPublicListingsCount();
      setPublicCount(count);
    };
    loadPublicCount();
  }, []);

  const toggleContact = (publickey: string) => {
    const newSelected = new Set(selectedContacts);
    if (newSelected.has(publickey)) {
      newSelected.delete(publickey);
    } else {
      newSelected.add(publickey);
    }
    setSelectedContacts(newSelected);
  };

  const handleCreateGroup = async () => {
    if (
      !groupName.trim() ||
      selectedContacts.size === 0 ||
      !myPublicKey ||
      !userName
    ) {
      alert("Please enter a group name and select at least one member");
      return;
    }

    setCreating(true);
    try {
      const latestCount = await getPublicListingsCount();
      if (isPublic && latestCount >= LISTINGS_PUBLIC_LIMIT) {
        setPublicError(
          `You already have ${LISTINGS_PUBLIC_LIMIT} public listings. Remove one before adding another.`,
        );
        setCreating(false);
        return;
      }

      const groupId = await groupService.createGroup(
        groupName,
        description,
        avatar,
        Array.from(selectedContacts),
        myPublicKey,
        userName,
        isPublic,
        autoApprove,
      );

      console.log("✅ [CreateGroup] Group created:", groupId);
      navigate({ to: "/" });
    } catch (err) {
      console.error("❌ [CreateGroup] Error creating group:", err);
      alert("Failed to create group. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const filteredContacts = contacts.filter((c) => {
    const matchesSearch = (c.extradata?.name || c.currentaddress)
      .toLowerCase()
      .includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (activeTab === "contacts") return c.type === "contact";
    if (activeTab === "community") return c.type === "community";
    return true;
  });

  const defaultAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

  const handleAvatarFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (!file.type.startsWith("image/")) {
      alert("Please select a valid image.");
      return;
    }

    try {
      setProcessingAvatar(true);
      const compressedBase64 = await compressImage(file, 600, 600, 0.75);
      setAvatar(compressedBase64);
    } catch (err) {
      console.error("❌ [CreateGroup] Avatar processing failed:", err);
      alert("Failed to process the image. Please try another one.");
    } finally {
      setProcessingAvatar(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 relative overflow-x-hidden">
      {/* Background design accents */}
      <div className="fixed -top-24 -right-24 w-96 h-96 bg-primary-500/10 blur-[100px] rounded-full pointer-events-none" />
      <div className="fixed -bottom-24 -left-24 w-96 h-96 bg-blue-500/10 blur-[100px] rounded-full pointer-events-none" />

      {/* Sticky Header */}
      <div className="absolute top-0 inset-x-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-white/20 dark:border-white/5 p-4 flex items-center gap-3 shadow-lg shadow-black/5 transition-all">
        <div className="max-w-2xl mx-auto w-full flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/" })}
            className="w-10 h-10 flex items-center justify-center bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-xl transition-all active:scale-90"
          >
            <ArrowLeft size={20} strokeWidth={2.5} className="text-gray-700 dark:text-gray-300" />
          </button>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
            Create Group
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pt-24 pb-32 px-4 relative z-10">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Info banner */}
          <div className="bg-primary-500/10 dark:bg-primary-500/20 backdrop-blur-md border border-primary-500/20 rounded-[2rem] p-6 text-sm text-primary-700 dark:text-primary-300 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h4 className="font-black text-lg mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500" />
              What is a Group?
            </h4>
            <p className="font-medium leading-relaxed opacity-80">
              Groups are collaborative shared spaces. Unlike public channels, all members can read
              and publish messages, making them ideal for teamwork and community discussions.
            </p>
          </div>

          <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[2.5rem] border border-white/20 dark:border-white/5 shadow-2xl p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col items-center gap-6">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleAvatarFileSelect}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={processingAvatar}
                className="relative group/avatar"
              >
                <div className="w-32 h-32 rounded-[2.5rem] overflow-hidden bg-gray-100 dark:bg-gray-700/50 shadow-2xl flex items-center justify-center border-4 border-white/50 dark:border-gray-800/50 transition-all group-hover/avatar:scale-105 group-active/avatar:scale-95 group-hover/avatar:shadow-primary-500/20">
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={groupName || "Group avatar"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-4xl font-black text-primary-600 dark:text-primary-400">
                      {groupName.trim() ? groupName.trim().charAt(0).toUpperCase() : "G"}
                    </span>
                  )}
                </div>
                <div className="absolute inset-0 rounded-[2.5rem] bg-black/40 text-white flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-all backdrop-blur-[2px]">
                  {processingAvatar ? (
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                  ) : (
                    <Camera size={28} strokeWidth={2.5} />
                  )}
                </div>
              </button>

              <div className="text-center">
                <h3 className="text-lg font-black text-gray-900 dark:text-white">
                  Group Profile Picture
                </h3>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-[13px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3 px-1">
                  Group Name *
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Enter a creative name"
                  className="w-full px-6 py-4 border-0 rounded-2xl bg-black/5 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:bg-white/50 dark:focus:bg-gray-800/50 transition-all font-bold placeholder:text-gray-400 dark:placeholder:text-gray-600"
                  maxLength={50}
                />
              </div>

              <div>
                <label className="block text-[13px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3 px-1">
                  Description
                </label>
                <div className="relative">
                  <textarea
                    value={description}
                    onChange={(e) => {
                      if (e.target.value.length <= 255) {
                        setDescription(e.target.value);
                      }
                    }}
                    placeholder="Briefly describe your group's purpose..."
                    className="w-full px-6 py-4 border-0 rounded-2xl bg-black/5 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:bg-white/50 dark:focus:bg-gray-800/50 transition-all font-bold placeholder:text-gray-400 dark:placeholder:text-gray-600 resize-none min-h-[120px]"
                    maxLength={255}
                  />
                  <span
                    className={`absolute bottom-4 right-4 text-[10px] font-black tracking-widest ${description.length >= 240 ? "text-red-500" : "text-gray-400"}`}
                  >
                    {description.length}/255
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-5 bg-black/5 dark:bg-white/5 rounded-3xl border border-white/10 dark:border-white/5 transition-all hover:bg-black/10 dark:hover:bg-white/10">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-black text-gray-900 dark:text-white">
                    Public Discovery
                  </span>
                  <span className="text-[11px] text-gray-400 font-bold uppercase tracking-tight">
                    Show in community gossip
                  </span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!isPublic) {
                      const count = await getPublicListingsCount();
                      setPublicCount(count);
                      if (count >= LISTINGS_PUBLIC_LIMIT) {
                        setPublicError(
                          `Limit reached (max ${LISTINGS_PUBLIC_LIMIT})`,
                        );
                        return;
                      }
                    }
                    setPublicError("");
                    setIsPublic(!isPublic);
                  }}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 focus:outline-none ${
                    isPublic ? "bg-primary-500 shadow-lg shadow-primary-500/30" : "bg-gray-300 dark:bg-gray-700"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${
                      isPublic ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-5 bg-black/5 dark:bg-white/5 rounded-3xl border border-white/10 dark:border-white/5 transition-all hover:bg-black/10 dark:hover:bg-white/10">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-black text-gray-900 dark:text-white">
                    Auto-Approve
                  </span>
                  <span className="text-[11px] text-gray-400 font-bold uppercase tracking-tight">
                    Instant join via link
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoApprove(!autoApprove)}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 focus:outline-none ${
                    autoApprove
                      ? "bg-primary-500 shadow-lg shadow-primary-500/30"
                      : "bg-gray-300 dark:bg-gray-700"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${
                      autoApprove ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
            
            {publicError && (
              <div className="text-xs text-red-500 font-bold text-center px-4 animate-in slide-in-from-top-1">
                ⚠️ {publicError}
              </div>
            )}
            
            <div className="text-center">
               <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em]">
                Public Listings: {publicCount} / {LISTINGS_PUBLIC_LIMIT}
              </span>
            </div>
          </div>

          {/* Creation State Card - Refined Style */}
          <div className="flex justify-center animate-in fade-in slide-in-from-bottom-5 duration-600">
            <button
              onClick={handleCreateGroup}
              disabled={!groupName.trim() || selectedContacts.size === 0 || creating}
              className={`px-10 py-3.5 rounded-2xl font-extrabold text-base uppercase tracking-wider transition-all duration-300 shadow-xl flex items-center justify-center gap-3 ${
                !groupName.trim() || selectedContacts.size === 0
                  ? "bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed grayscale"
                  : "bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-primary-500/20 hover:shadow-primary-500/40 hover:scale-[1.02] active:scale-95"
              }`}
            >
              {creating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Creating Group...</span>
                </>
              ) : selectedContacts.size > 0 ? (
                <>
                  <span>Create Group</span>
                  <div className="bg-white/20 px-3 py-1 rounded-full text-sm">
                    {selectedContacts.size}
                  </div>
                </>
              ) : (
                "Select members to continue"
              )}
            </button>
          </div>

          {/* Member Selection Section */}
          <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[2.5rem] border border-white/20 dark:border-white/5 shadow-2xl p-8 space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-2 leading-tight">
              Add Members
              <span className="ml-3 text-sm font-black text-primary-500 bg-primary-500/10 px-3 py-1 rounded-full align-middle">
                {selectedContacts.size}
              </span>
            </h2>

            {/* Floating-style Pill Tab Bar */}
            <div className="flex p-1 bg-black/5 dark:bg-white/5 rounded-2xl border border-white/10 dark:border-white/5 backdrop-blur-sm shadow-inner group">
              {(["all", "contacts", "community"] as const).map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-3 text-[13px] font-black uppercase tracking-wider rounded-xl transition-all duration-300 relative z-10 ${
                      isActive
                        ? "text-white shadow-xl translate-y-[-1px]"
                        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white"
                    }`}
                  >
                    {isActive && (
                      <div className="absolute inset-0 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl -z-10 shadow-lg shadow-primary-500/20 animate-in zoom-in-95 duration-200"></div>
                    )}
                    <span className="relative z-20">{tab}</span>
                  </button>
                );
              })}
            </div>

            <div className="relative group">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search potential members..."
                className="w-full px-6 py-4 border-0 rounded-2xl bg-black/5 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:bg-white/50 dark:focus:bg-gray-800/50 transition-all font-bold placeholder:text-gray-400 dark:placeholder:text-gray-600 pl-12"
              />
              <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-600 group-focus-within:text-primary-500 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
              {filteredContacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400 mb-4">
                    <Users size={32} />
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 font-bold">
                    No matching members
                  </p>
                </div>
              ) : (
                filteredContacts.map((contact) => {
                  const isSelected = selectedContacts.has(contact.publickey);
                  const displayAvatar = contact.extradata?.icon
                    ? decodeURIComponent(contact.extradata.icon)
                    : defaultAvatar;

                  return (
                    <div
                      key={contact.publickey}
                      onClick={() => toggleContact(contact.publickey)}
                      className={`flex items-center gap-4 p-4 rounded-3xl cursor-pointer transition-all duration-300 relative group overflow-hidden ${
                        isSelected
                          ? "bg-primary-500/10 border-2 border-primary-500 shadow-lg shadow-primary-500/5"
                          : "bg-black/5 dark:bg-white/5 border-2 border-transparent hover:bg-black/[0.08] dark:hover:bg-white/[0.08]"
                      } hover:scale-[1.01] active:scale-[0.98]`}
                    >
                      {isSelected && (
                         <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-primary-400 to-primary-600 animate-in slide-in-from-left-full duration-500" />
                      )}

                      <img
                        src={displayAvatar.startsWith("data:image") ? displayAvatar : defaultAvatar}
                        alt={contact.extradata?.name || "Contact"}
                        className="w-12 h-12 rounded-[1.25rem] object-cover ring-2 ring-white/20 dark:ring-gray-800/20"
                        onError={(e: any) => {
                          e.target.src = defaultAvatar;
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900 dark:text-white truncate text-[15px]">
                          {contact.extradata?.name || contact.currentaddress}
                        </p>
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-tighter truncate opacity-70">
                          {contact.type === "contact" ? "Verified Contact" : "From Recent Chats"}
                        </p>
                      </div>
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${
                        isSelected 
                          ? "bg-primary-500 text-white shadow-lg shadow-primary-500/40 rotate-0" 
                          : "bg-black/5 dark:bg-white/5 text-gray-300 dark:text-gray-700 rotate-45"
                      }`}>
                        <Check size={20} strokeWidth={4} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
