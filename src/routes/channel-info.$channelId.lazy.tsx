// src/routes/channel-info.$channelId.lazy.tsx
import { useEffect, useState, useContext, useRef } from "react";
import { useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { appContext } from "../AppContext";
import { channelService, ChannelSubscriber } from "../services/channel.service";
import { chatService } from "../services/chat.service";
import { shortenAddress } from "../utils/hex";
import {
  ArrowLeft,
  UserPlus,
  User,
  Search,
  ShieldCheck,
  ShieldAlert,
  MessageSquare,
  Users,
  X,
  Edit2,
  Check,
  Camera,
  Copy,
  Database,
  History,
  Trash2,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";
import { MDS } from "@minima-global/mds";
import { ChannelTabs, ChannelTab } from "../components/channel/ChannelTabs";
import {
  getPublicListingsCount,
  LISTINGS_PUBLIC_LIMIT,
} from "../services/listings.service";

export const Route = createLazyFileRoute("/channel-info/$channelId")({
  component: ChannelInfoPage,
});

interface Person {
  publickey: string;
  currentaddress: string;
  type: "contact" | "community";
  extradata?: { name?: string; icon?: string };
}



function ChannelInfoPage() {
  const { channelId } = Route.useParams();
  const search: any = Route.useSearch();
  const navigate = useNavigate();
  const { myPublicKey, userName } = useContext(appContext);

  const [activeTab, setActiveTab] = useState<ChannelTab>(
    search.tab === "settings" ? "settings" : "profile",
  );
  const [channelName, setChannelName] = useState("");
  const [description, setDescription] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [creatorPublicKey, setCreatorPublicKey] = useState("");
  const [subscribers, setSubscribers] = useState<ChannelSubscriber[]>([]);
  const [loading, setLoading] = useState(true);

  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [publicCount, setPublicCount] = useState(0);
  const [publicError, setPublicError] = useState("");

  // Invite modal state
  const [showInvite, setShowInvite] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [inviting, setInviting] = useState<string | null>(null);
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteTab, setInviteTab] = useState<"all" | "contacts" | "community">(
    "all",
  );

  // -------------------------------------------------------------------------
  // Load channel data
  // -------------------------------------------------------------------------
  const [stats, setStats] = useState({ total: 0, mine: 0, firstDate: 0 });
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const decodeStoredAvatar = (avatar?: string | null) => {
    if (!avatar || avatar === "0x00") return "";

    const candidates = [avatar];
    try {
      candidates.unshift(decodeURIComponent(avatar));
    } catch {
      // ignore invalid URI sequences and try raw value
    }

    return (
      candidates.find(
        (candidate) =>
          candidate &&
          candidate.startsWith("data:image") &&
          !candidate.includes("/0x00"),
      ) || ""
    );
  };

  const loadData = async () => {
    if (!myPublicKey) return;
    const info = await channelService.getChannelInfo(channelId);
    if (info) {
      setChannelName((info as any).NAME || (info as any).name || "Channel");
      setDescription(
        (info as any).DESCRIPTION || (info as any).description || "",
      );
      setAvatar((info as any).AVATAR || (info as any).avatar || null);
      setCreatorPublicKey(
        (info as any).ADMIN_PUBLICKEY || (info as any).admin_publickey || "",
      );
      const rawPublic = (info as any).IS_PUBLIC ?? (info as any).is_public;
      setIsPublic(
        rawPublic === true ||
          rawPublic === 1 ||
          String(rawPublic).toUpperCase() === "TRUE" ||
          String(rawPublic) === "1",
      );
    }
    const admin = await channelService.isAdmin(channelId, myPublicKey);
    setIsAdmin(admin);
    const rawSubs = await channelService.getChannelSubscribers(channelId);

    // Fetch messages for statistics
    const msgs = await channelService.getChannelMessages(channelId);
    const mine = msgs.filter((m: any) => {
      const sender = (
        m.SENDER_PUBLICKEY ||
        m.sender_publickey ||
        ""
      ).toLowerCase();
      const me = (myPublicKey || "").toLowerCase();
      return sender === me;
    }).length;
    setStats({
      total: msgs.length,
      mine,
      firstDate:
        msgs.length > 0
          ? Number((msgs[0] as any).DATE || msgs[0].date)
          : Number(
              (info as any).CREATED_DATE || (info as any).created_date || 0,
            ),
    });

    const mappedSubs = rawSubs.map((s: any) => {
      const pk = s.PUBLICKEY || s.publickey;
      // Use same logic as groups for resolving name
      const name =
        s.RESOLVED_NAME ||
        s.resolved_name ||
        s.USERNAME ||
        s.username ||
        "Unknown Member";
      const role = (s.ROLE || s.role || "subscriber").toLowerCase();
      const isMe =
        (pk || "").toLowerCase() === (myPublicKey || "").toLowerCase();

      return {
        publickey: pk,
        username: name,
        isMe: isMe,
        role: role as "admin" | "subscriber",
        avatar: decodeStoredAvatar(s.AVATAR || s.avatar),
      };
    });

    // Sort: Admin > Subscriber
    mappedSubs.sort((a, b) => {
      const rolePriority: any = { admin: 0, subscriber: 1 };
      const pA = rolePriority[a.role] ?? 1;
      const pB = rolePriority[b.role] ?? 1;

      if (pA !== pB) return pA - pB;
      // Secondary sort: Alphabetical
      return a.username.localeCompare(b.username);
    });

    setSubscribers(mappedSubs as any);
    const count = await getPublicListingsCount();
    setPublicCount(count);
    setLoading(false);
  };

  useEffect(() => {
    loadData();

    const handleUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type === "CHANNEL_REMOVED") {
        navigate({ to: "/" });
        return;
      }
      console.log("📢 [CHANNEL-INFO] refreshing data...");
      loadData();
    };
    window.addEventListener("CHANNEL_UPDATE", handleUpdate);
    return () => window.removeEventListener("CHANNEL_UPDATE", handleUpdate);
  }, [channelId, myPublicKey]);

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  const handleExitChannel = async () => {
    try {
      await channelService.removeSubscriber(
        channelId,
        myPublicKey || "",
        myPublicKey || "",
        userName || "Unknown",
      );
      navigate({ to: "/" });
    } catch (err) {
      console.error("Failed to exit channel:", err);
      setTimeout(() => alert("Failed to exit channel"), 100);
    }
  };

  // -------------------------------------------------------------------------
  // Load people for invite modal (contacts + community, excluding current subs)
  // -------------------------------------------------------------------------
  const loadPeople = async () => {
    try {
      const subKeys = new Set(
        subscribers.map((s: any) => (s.PUBLICKEY || s.publickey) as string),
      );

      // 1. Maxima contacts
      const res = await MDS.cmd.maxcontacts();
      const rawContacts = (res as any)?.response?.contacts || [];
      const contactsList: Person[] = rawContacts
        .filter((c: any) => !subKeys.has(c.publickey))
        .map((c: any) => ({
          publickey: c.publickey,
          currentaddress: c.currentaddress || c.publickey,
          type: "contact" as const,
          extradata: {
            name: c.extradata?.name || c.name || c.publickey,
            icon: decodeStoredAvatar(c.extradata?.icon)
          }
        }));

      // 2. Recent chats (community / non-contacts)
      const chats = await chatService.getRecentChats();
      const contactKeys = new Set(contactsList.map((c) => c.publickey));
      const communityPeople: Person[] = chats
        .filter(
          (chat) =>
            chat.publickey &&
            !subKeys.has(chat.publickey) &&
            !contactKeys.has(chat.publickey),
        )
        .map((chat) => ({
          publickey: chat.publickey,
          currentaddress: chat.currentaddress || chat.publickey,
          type: "community" as const,
          extradata: { 
            name: chat.roomname, 
            icon: decodeStoredAvatar(chat.avatar) 
          },
        }));

      setPeople([...contactsList, ...communityPeople]);
    } catch (err) {
      console.error("Error loading people:", err);
    }
  };

  const handleOpenInvite = () => {
    setInviteSearch("");
    setInviteTab("all");
    loadPeople();
    setShowInvite(true);
  };

  const handleInvite = async (person: Person) => {
    if (!myPublicKey || !userName) return;
    setInviting(person.publickey);
    try {
      const name = person.extradata?.name || person.currentaddress || "Unknown";
      await channelService.inviteSubscriber(
        channelId,
        person.publickey,
        name,
        myPublicKey,
        userName,
      );
      await loadData();
      // Remove from people list (already subscribed)
      setPeople((prev) => prev.filter((p) => p.publickey !== person.publickey));
    } catch (err) {
      console.error("❌ [CHANNEL-INFO] Invite failed:", err);
      alert("Failed to invite subscriber.");
    } finally {
      setInviting(null);
    }
  };

  const handleRemove = async (pubkey: string) => {
    if (!myPublicKey || !userName) return;
    try {
      await channelService.removeSubscriber(
        channelId,
        pubkey,
        myPublicKey,
        userName,
      );
      await loadData();
    } catch (err) {
      console.error("❌ [CHANNEL-INFO] Remove failed:", err);
    }
  };

  const handleUpdateRole = async (
    pubkey: string,
    newRole: "admin" | "subscriber",
  ) => {
    if (!myPublicKey) return;
    try {
      await channelService.updateSubscriberRole(
        channelId,
        pubkey,
        newRole,
        myPublicKey,
      );
      await loadData();
    } catch (err) {
      console.error("❌ [CHANNEL-INFO] Role update failed:", err);
      alert("Failed to update role.");
    }
  };

  const handleTogglePublicListing = async () => {
    try {
      const newValue = !isPublic;
      if (newValue) {
        const count = await getPublicListingsCount();
        setPublicCount(count);
        if (count >= LISTINGS_PUBLIC_LIMIT) {
          setPublicError(
            `You already have ${LISTINGS_PUBLIC_LIMIT} public listings. Remove one before adding another.`,
          );
          return;
        }
      }
      await channelService.updateChannelPublic(channelId, newValue, myPublicKey || "");
      setIsPublic(newValue);
      setPublicError("");
    } catch (err) {
      console.error("Failed to update public listing:", err);
      alert("Failed to update public listing");
    }
  };

  const handleSaveName = async () => {
    if (!newName.trim() || newName.trim() === channelName) {
      setIsEditingName(false);
      return;
    }

    try {
      await channelService.updateChannelDetails(
        channelId,
        newName.trim(),
        null,
        null,
        myPublicKey || "",
      );
      setChannelName(newName.trim());
      setIsEditingName(false);
    } catch (err) {
      console.error("Failed to rename channel:", err);
      setNewName(channelName);
    }
  };

  const handleSaveDesc = async () => {
    if (newDesc.trim() === description) {
      setIsEditingDesc(false);
      return;
    }

    try {
      await channelService.updateChannelDetails(
        channelId,
        null,
        newDesc.trim(),
        null,
        myPublicKey || "",
      );
      setDescription(newDesc.trim());
      setIsEditingDesc(false);
    } catch (err) {
      console.error("Failed to update description:", err);
      setNewDesc(description);
    }
  };

  const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        handleSaveAvatar(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveAvatar = async (base64: string) => {
    setSavingAvatar(true);
    try {
      await channelService.updateChannelDetails(
        channelId,
        null,
        null,
        base64,
        myPublicKey || "",
      );
      setAvatar(base64);
    } catch (err) {
      console.error("Failed to update avatar:", err);
      alert("Failed to update avatar");
    } finally {
      setSavingAvatar(false);
    }
  };

  const handleGenerateInvite = async () => {
    setGeneratingLink(true);
    try {
      const link = await channelService.generateInviteCode(
        channelId,
        channelName,
      );
      setInviteLink(link);
    } catch (err) {
      console.error("Failed to generate invite link:", err);
      alert("Failed to generate invite link.");
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleCopyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteLinkCopied(true);
      setTimeout(() => setInviteLinkCopied(false), 2000);
    } catch {
      alert(inviteLink);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-black/95 transition-colors">
      {/* ELITE STICKY HEADER */}
      <div className="sticky top-0 z-50 bg-white/70 dark:bg-black/40 backdrop-blur-3xl border-b border-black/5 dark:border-white/5">
        <div className="max-w-4xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button
              onClick={() => {
                if (search.returnTo) {
                  navigate({ to: search.returnTo });
                } else {
                  navigate({ to: `/channels/${channelId}` });
                }
              }}
              className="w-12 h-12 bg-black/5 dark:bg-white/5 rounded-2xl flex items-center justify-center text-gray-500 hover:text-gray-900 dark:hover:text-white transition-all hover:scale-105 active:scale-95"
            >
              <ArrowLeft size={20} strokeWidth={3} />
            </button>
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-primary-500 uppercase tracking-[0.4em] mb-0.5">Community Registry</span>
              <h1 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Channel Manifest</h1>
            </div>
          </div>
          <div className="p-1 min-w-[3rem] h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500 font-black text-xs">
            LIVE
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* COMMON HERO SECTION */}
        <div className="max-w-4xl mx-auto pt-10 pb-12 px-6">
          <div className="flex flex-col items-center text-center space-y-8">
            {/* Elite Avatar Hub */}
            <div className="relative group/avatar">
              <div className="absolute -inset-4 bg-gradient-to-tr from-primary-500 to-sky-500 rounded-full blur-2xl opacity-0 group-hover/avatar:opacity-20 transition-opacity duration-1000" />
              <div className="relative w-40 h-40 rounded-[3rem] bg-white dark:bg-gray-900 border-4 border-white dark:border-gray-800 shadow-2xl overflow-hidden group-hover/avatar:scale-105 transition-transform duration-500">
                {avatar ? (
                  <img src={avatar} alt={channelName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-white/5 text-5xl font-black text-gray-300 dark:text-gray-700 uppercase tracking-tighter">
                    {channelName.charAt(0)}
                  </div>
                )}

                {isAdmin && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover/avatar:opacity-100 transition-all duration-300"
                  >
                    <Camera size={32} strokeWidth={2.5} className="scale-75 group-hover/avatar:scale-100 transition-transform" />
                  </button>
                )}
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarFileSelect} />
              </div>
              
              {savingAvatar && (
                <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-white dark:bg-gray-800 rounded-2xl shadow-xl flex items-center justify-center border border-black/5 dark:border-white/10 animate-in zoom-in">
                  <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            {/* Name & Manifest Description */}
            <div className="space-y-4 max-w-2xl">
              <div className="relative group/name inline-block">
                {isEditingName ? (
                  <div className="flex items-center gap-4 bg-white/50 dark:bg-white/5 backdrop-blur-xl p-2 rounded-[2rem] border border-primary-500/30 animate-in zoom-in-95">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="bg-transparent border-none text-2xl font-black text-gray-900 dark:text-white text-center focus:ring-0 uppercase tracking-tight px-6"
                      autoFocus
                      onBlur={handleSaveName}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-4">
                    <h2 className="text-3xl font-black text-gray-900 dark:text-white uppercase tracking-tighter leading-none">
                      {channelName}
                    </h2>
                    {isAdmin && (
                      <button
                        onClick={() => { setNewName(channelName); setIsEditingName(true); }}
                        className="w-10 h-10 rounded-xl bg-black/5 dark:bg-white/5 flex items-center justify-center text-gray-400 hover:text-primary-500 transition-all"
                      >
                        <Edit2 size={16} strokeWidth={3} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="relative group/desc">
                {isEditingDesc ? (
                  <div className="bg-white/50 dark:bg-white/5 backdrop-blur-xl p-6 rounded-[2rem] border border-primary-500/30 animate-in zoom-in-95">
                    <textarea
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      className="w-full bg-transparent border-none text-sm font-black text-gray-900 dark:text-white text-center focus:ring-0 uppercase tracking-widest leading-relaxed resize-none"
                      rows={3}
                      autoFocus
                      onBlur={handleSaveDesc}
                    />
                    <p className="text-[9px] font-black text-primary-500 text-right mt-2 uppercase tracking-widest">{newDesc.length}/255</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <p className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] leading-relaxed max-w-lg">
                      {description || "No registry description provided for this decentralized entity."}
                    </p>
                    {isAdmin && (
                      <button
                        onClick={() => { setNewDesc(description); setIsEditingDesc(true); }}
                        className="mt-4 px-4 py-1.5 rounded-full bg-black/5 dark:bg-white/5 text-[9px] font-black text-gray-400 hover:text-primary-500 transition-all uppercase tracking-[0.2em]"
                      >
                        Edit Manifest
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ELITE NAVIGATOR */}
        <ChannelTabs activeTab={activeTab} onTabChange={setActiveTab} />

        <div className="max-w-4xl mx-auto p-6 pb-24">
          {activeTab === "profile" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-10 duration-700">
              {/* CHAT STATISTICS */}
              <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-6 sm:p-10 border border-white/20 dark:border-white/5 shadow-xl shadow-black/5">
                <div className="flex items-center gap-4 mb-10">
                  <div className="w-12 h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500">
                    <MessageSquare size={22} strokeWidth={3} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-0.5">Analytics Hub</span>
                    <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Chat Statistics</h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="group flex items-center gap-6 p-8 bg-gray-50/50 dark:bg-white/5 rounded-[2.5rem] border border-white/5 hover:border-primary-500/20 transition-all">
                    <div className="w-14 h-14 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
                      <MessageSquare size={24} strokeWidth={3} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Messages</p>
                      <p className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">
                        {stats.total} TOTAL <span className="text-primary-500 ml-1">({stats.mine} MINE)</span>
                      </p>
                    </div>
                  </div>

                  <div className="group flex items-center gap-6 p-8 bg-gray-50/50 dark:bg-white/5 rounded-[2.5rem] border border-white/5 hover:border-orange-500/20 transition-all">
                    <div className="w-14 h-14 bg-orange-500/10 rounded-2xl flex items-center justify-center text-orange-500 group-hover:scale-110 transition-transform">
                      <History size={24} strokeWidth={3} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">History Terminal</p>
                      <p className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">
                        EST. {stats.firstDate ? new Date(stats.firstDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : "N/A"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* TECHNICAL DATA */}
              <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-6 sm:p-10 border border-white/20 dark:border-white/5 shadow-xl shadow-black/5">
                <div className="flex items-center gap-4 mb-10">
                  <div className="w-12 h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500">
                    <Database size={20} strokeWidth={3} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-0.5">System Core</span>
                    <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Technical Data</h3>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-2 text-center italic">Channel Identification Hash</p>
                    <div className="relative group/id p-8 bg-gray-50/50 dark:bg-white/10 rounded-[2.5rem] border border-white/10 font-mono text-xs font-black text-primary-500 break-all select-all text-center">
                      {channelId}
                      <button
                        onClick={() => copyToClipboard(channelId || "", "channelid")}
                        className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 bg-white dark:bg-gray-800 rounded-2xl flex items-center justify-center text-gray-400 hover:text-primary-500 transition-all shadow-xl"
                      >
                        {copiedField === "channelid" ? <Check size={18} strokeWidth={3} className="text-green-500" /> : <Copy size={18} strokeWidth={3} />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-8 bg-gray-50/50 dark:bg-white/5 rounded-[2.5rem] border border-white/5">
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Authorization Tier</p>
                      <h4 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">
                        {myPublicKey && creatorPublicKey && myPublicKey.toLowerCase() === creatorPublicKey.toLowerCase() ? "Creator" : isAdmin ? "Administrator" : "Subscriber"}
                      </h4>
                    </div>
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isAdmin ? "bg-primary-500 text-white shadow-lg shadow-primary-500/20" : "bg-gray-100 dark:bg-white/5 text-gray-400"}`}>
                      {isAdmin ? <ShieldCheck size={22} strokeWidth={3} /> : <User size={22} strokeWidth={3} />}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-10 duration-700">
              {/* SUBSCRIBERS REGISTRY */}
              <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-6 sm:p-10 border border-white/20 dark:border-white/5 shadow-xl shadow-black/5">
                <div className="flex items-center justify-between gap-4 mb-10">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-12 h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500 flex-shrink-0">
                      <Users size={22} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col text-left min-w-0">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-0.5 truncate">Community Index</span>
                      <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight truncate">Channel Subscribers</h3>
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={handleOpenInvite}
                      className="flex items-center gap-3 px-6 py-3 bg-primary-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-600 transition-all shadow-lg shadow-primary-500/20 active:scale-95 flex-shrink-0"
                    >
                      <UserPlus size={16} strokeWidth={3} />
                      <span className="hidden sm:inline">Authorize</span>
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {subscribers.length === 0 ? (
                    <div className="py-20 text-center bg-gray-50/50 dark:bg-white/5 rounded-[3rem] border border-dashed border-gray-200 dark:border-white/10">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] italic">No compatible profiles discovered</p>
                    </div>
                  ) : (
                    subscribers.map((sub: any, i) => {
                      const pk = sub.publickey;
                      const name = sub.username;
                      const role = sub.role;
                      const isMe = pk && myPublicKey && pk.toLowerCase() === myPublicKey.toLowerCase();

                      return (
                        <div
                          key={pk || i}
                          className={`group flex items-center p-4 rounded-[2.5rem] border border-transparent transition-all ${
                            isMe ? "bg-primary-500/5 border-primary-500/20" : "hover:bg-white dark:hover:bg-white/10 hover:border-black/5 dark:hover:border-white/10"
                          }`}
                        >
                          <div
                            className="w-14 h-14 rounded-2xl overflow-hidden bg-gray-200 dark:bg-gray-800 border-2 border-white dark:border-gray-700 shadow-sm flex-shrink-0 cursor-pointer group-hover:scale-105 transition-transform"
                            onClick={() => !isMe && navigate({ to: `/contact-info/${pk}`, search: { returnTo: `/channel-info/${channelId}` } })}
                          >
                            {sub.avatar ? (
                              <img src={sub.avatar} className="w-full h-full object-cover" alt="" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xl font-black text-gray-400 dark:text-gray-600 uppercase">
                                {isMe ? "U" : (name && name !== "Unknown Member" ? name.charAt(0) : "?")}
                              </div>
                            )}
                          </div>

                          <div className="ml-5 flex-1 min-w-0 text-left">
                            <p className="text-sm font-black text-gray-900 dark:text-gray-100 uppercase tracking-tight truncate mb-0.5 flex items-center gap-2">
                              {isMe ? "You" : name}
                              {pk && creatorPublicKey && pk.toLowerCase() === creatorPublicKey.toLowerCase() ? (
                                <span className="text-[8px] font-black bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-md uppercase tracking-wider">Founder</span>
                              ) : role === "admin" ? (
                                <span className="text-[8px] font-black bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-md uppercase tracking-wider">Administrator</span>
                              ) : null}
                            </p>
                            <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest font-mono truncate">
                              {shortenAddress(pk)}
                            </p>
                          </div>

                          {isAdmin && !isMe && !(pk && creatorPublicKey && pk.toLowerCase() === creatorPublicKey.toLowerCase()) && (
                            <div className="flex items-center gap-2 ml-4">
                              {role === "subscriber" ? (
                                <button
                                  onClick={() => handleUpdateRole(pk, "admin")}
                                  className="h-10 px-4 bg-sky-500/10 text-sky-500 rounded-xl flex items-center justify-center gap-2 hover:bg-sky-500 hover:text-white transition-all shadow-lg shadow-sky-500/20 group/promote"
                                  title="Promote to Administrator"
                                >
                                  <ShieldCheck size={18} strokeWidth={3} />
                                  <span className="text-[10px] font-black uppercase tracking-widest hidden md:inline">Promote</span>
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleUpdateRole(pk, "subscriber")}
                                  className="h-10 px-4 bg-amber-500/10 text-amber-500 rounded-xl flex items-center justify-center gap-2 hover:bg-amber-500 hover:text-white transition-all shadow-lg shadow-amber-500/20 group/demote"
                                  title="Demote to Subscriber"
                                >
                                  <ShieldAlert size={18} strokeWidth={3} />
                                  <span className="text-[10px] font-black uppercase tracking-widest hidden md:inline">Demote</span>
                                </button>
                              )}
                              <button
                                onClick={() => handleRemove(pk)}
                                className="w-10 h-10 bg-red-500/10 text-red-500 rounded-xl flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-lg shadow-red-500/20"
                              >
                                <Trash2 size={18} strokeWidth={3} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* ACCESS PROTOCOLS */}
              {isAdmin && (
                <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-6 sm:p-10 border border-white/20 dark:border-white/5 shadow-xl shadow-black/5">
                  <div className="flex items-center gap-4 mb-10">
                    <div className="w-12 h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500 flex-shrink-0">
                      <SlidersHorizontal size={22} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col text-left min-w-0">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-0.5 truncate">Control Panel</span>
                      <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight truncate">Access Protocols</h3>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Global Discovery toggle */}
                    <div className="group flex items-center justify-between p-8 bg-white/40 dark:bg-black/5 rounded-[2.5rem] border border-white/10 hover:border-primary-500/20 hover:shadow-xl transition-all duration-500">
                      <div className="flex flex-col min-w-0 pr-6 text-left">
                        <span className="text-[11px] font-black text-gray-900 dark:text-white uppercase tracking-[0.2em] mb-1">Global Discovery</span>
                        <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase leading-relaxed max-w-[200px] opacity-70">Broadcast channel via gossip network</span>
                      </div>
                      <button
                        onClick={handleTogglePublicListing}
                        className={`relative inline-flex h-9 w-16 flex-shrink-0 items-center rounded-2xl transition-all duration-500 ease-in-out border-2 overflow-hidden ${isPublic ? "bg-primary-500 border-primary-400 shadow-[0_0_25px_rgba(59,130,246,0.5)]" : "bg-black/10 dark:bg-white/5 border-white/5"}`}
                      >
                        <div className={`absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity`} />
                        <span className={`inline-block h-6 w-6 transform rounded-xl bg-white shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-500 ease-in-out ${isPublic ? "translate-x-9" : "translate-x-1"}`} />
                      </button>
                    </div>

                    {publicError && <p className="text-[9px] font-black text-red-500 uppercase tracking-widest px-4">{publicError}</p>}
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-4 text-left">Listing Utilization: {publicCount} / {LISTINGS_PUBLIC_LIMIT}</p>

                    <div className="mt-8 pt-8 border-t border-white/5 space-y-6">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-2 text-left">Access Manifest / Invite Token</p>
                      {inviteLink ? (
                        <div className="space-y-4">
                          <div className="relative group/link p-8 bg-gray-50/50 dark:bg-white/10 rounded-[2.5rem] border border-white/10 font-mono text-xs font-black text-primary-500 break-all select-all text-center">
                            {inviteLink}
                            <button
                              onClick={handleCopyLink}
                              className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 bg-white dark:bg-gray-800 rounded-2xl flex items-center justify-center text-gray-400 hover:text-primary-500 transition-all shadow-xl"
                            >
                              {inviteLinkCopied ? <Check size={18} strokeWidth={3} className="text-green-500" /> : <Copy size={18} strokeWidth={3} />}
                            </button>
                          </div>
                          <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest text-center italic">Protocol warning: tokens grant persistent registry access.</p>
                        </div>
                      ) : (
                        <button
                          onClick={handleGenerateInvite}
                          disabled={generatingLink}
                          className="w-full flex items-center justify-center gap-4 py-8 bg-black/5 dark:bg-white/5 text-gray-400 dark:text-gray-500 rounded-[2.5rem] font-black uppercase tracking-[0.3em] hover:bg-primary-500 hover:text-white active:scale-[0.98] transition-all shadow-2xl hover:shadow-primary-500/20 disabled:opacity-50"
                        >
                          {generatingLink ? "Transmitting..." : <><Copy size={20} strokeWidth={3} /> Generate Registry Token</>}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* EXIT TERMINAL */}
              <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-2 border border-red-500/10 shadow-xl overflow-hidden group">
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full h-24 flex items-center justify-between px-10 text-red-500 hover:bg-red-500 hover:text-white transition-all rounded-[2.5rem] group"
                >
                  <div className="flex items-center gap-6 text-left">
                    <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center group-hover:bg-red-400 transition-colors shadow-inner">
                      <Trash2 size={24} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-[0.4em] opacity-60">Session Management</span>
                      <span className="text-sm font-black uppercase tracking-tight">Leave Channel</span>
                    </div>
                  </div>
                  <ChevronRight size={24} strokeWidth={3} className="opacity-0 group-hover:opacity-100 -translate-x-4 group-hover:translate-x-0 transition-all font-black" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ELITE EXIT CONFIRMATION */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100] p-6 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-gray-900 rounded-[3rem] shadow-2xl p-6 sm:p-10 border border-white/20 dark:border-white/10 max-w-sm w-full animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mb-6 mx-auto">
              <Trash2 size={32} strokeWidth={3} />
            </div>
            <h3 className="text-lg font-black text-gray-900 dark:text-white mb-2 text-center uppercase tracking-tight">Leave Channel?</h3>
            <p className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-center mb-8 leading-relaxed">Incoming data streams will be terminated. This action is recorded and permanent.</p>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="py-4 bg-gray-100 dark:bg-white/5 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest rounded-2xl hover:bg-gray-200 dark:hover:bg-white/10 transition-all"
              >
                Abort
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  handleExitChannel();
                }}
                className="py-4 bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ELITE AUTHORIZE MODAL */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[100] p-6 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-gray-900 rounded-t-[3rem] sm:rounded-[4rem] shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-white/20 dark:border-white/10 animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-500 overflow-hidden">
            {/* Modal header */}
            <div className="p-6 sm:p-10 pb-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500">
                  <UserPlus size={22} strokeWidth={3} />
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-0.5">Authorization Flow</span>
                  <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">Expand Registry</h3>
                </div>
              </div>
              <button
                onClick={() => setShowInvite(false)}
                className="w-12 h-12 bg-gray-100 dark:bg-white/5 rounded-2xl flex items-center justify-center text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all hover:rotate-90"
              >
                <X size={20} strokeWidth={3} />
              </button>
            </div>

            {/* Enhanced Search & Filter */}
            <div className="px-10 space-y-6 mb-6">
              <div className="flex gap-2">
                {(["all", "contacts", "community"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setInviteTab(tab)}
                    className={`h-10 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${inviteTab === tab
                        ? "bg-primary-500 text-white shadow-lg shadow-primary-500/20"
                        : "bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-white/10"
                      }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="relative group">
                <Search
                  size={18}
                  strokeWidth={3}
                  className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary-500 transition-colors"
                />
                <input
                  type="text"
                  value={inviteSearch}
                  onChange={(e) => setInviteSearch(e.target.value)}
                  placeholder="Search Global Index..."
                  className="w-full pl-16 pr-6 h-16 bg-gray-50/50 dark:bg-white/5 border border-white/5 rounded-[2rem] text-sm font-black text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-primary-500/50 focus:ring-4 focus:ring-primary-500/10 transition-all uppercase tracking-widest"
                  autoFocus
                />
              </div>
            </div>

            {/* Registry Results list */}
            <div className="overflow-y-auto flex-1 px-10 pb-10 space-y-2 custom-scrollbar">
              {people.filter((p) => {
                const searchStr = (p.extradata?.name || p.currentaddress || p.publickey).toLowerCase();
                const matchesSearch = searchStr.includes(inviteSearch.toLowerCase());
                if (!matchesSearch) return false;
                if (inviteTab === "contacts") return p.type === "contact";
                if (inviteTab === "community") return p.type === "community";
                return true;
              }).length === 0 ? (
                <div className="py-20 text-center bg-gray-50/50 dark:bg-white/5 rounded-[3rem] border border-dashed border-gray-200 dark:border-white/10">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] italic">No compatible profiles discovered</p>
                </div>
              ) : (
                people
                  .filter((p) => {
                    const searchStr = (p.extradata?.name || p.currentaddress || p.publickey).toLowerCase();
                    const matchesSearch = searchStr.includes(inviteSearch.toLowerCase());
                    if (!matchesSearch) return false;
                    if (inviteTab === "contacts") return p.type === "contact";
                    if (inviteTab === "community") return p.type === "community";
                    return true;
                  })
                  .map((person) => (
                    <div
                      key={person.publickey}
                      className="group flex items-center p-4 bg-gray-50/50 dark:bg-white/5 rounded-[2rem] border border-transparent hover:border-primary-500/20 hover:bg-white dark:hover:bg-white/10 transition-all font-black uppercase tracking-widest"
                    >
                      <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gray-200 dark:bg-gray-800 border-2 border-white dark:border-gray-700 shadow-sm flex-shrink-0 group-hover:scale-105 transition-transform">
                        {person.extradata?.icon ? (
                          <img src={person.extradata.icon} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xl font-black text-gray-400 dark:text-gray-600 uppercase">
                            {(person.extradata?.name || person.currentaddress || "?").charAt(0)}
                          </div>
                        )}
                      </div>

                      <div className="ml-5 flex-1 min-w-0 text-left">
                        <p className="text-sm font-black text-gray-900 dark:text-gray-100 uppercase tracking-tight truncate mb-0.5">
                          {person.extradata?.name || person.currentaddress || shortenAddress(person.publickey)}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-black text-primary-500 uppercase tracking-widest">{person.type}</span>
                          <span className="w-1 h-1 bg-gray-300 dark:bg-gray-700 rounded-full" />
                          <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest font-mono truncate">
                            {shortenAddress(person.publickey)}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleInvite(person)}
                        disabled={inviting === person.publickey}
                        className="px-6 py-3 bg-primary-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-primary-600 active:scale-95 transition-all shadow-lg shadow-primary-500/20 disabled:opacity-50"
                      >
                        {inviting === person.publickey ? "..." : "Authorize"}
                      </button>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
