// src/routes/channel-info.$channelId.lazy.tsx
import { useEffect, useState, useContext, useRef } from "react";
import { useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { appContext } from "../AppContext";
import { channelService, ChannelSubscriber } from "../services/channel.service";
import { chatService } from "../services/chat.service";
import { ArrowLeft, UserPlus, UserX, Search, ShieldCheck, ShieldAlert, MessageSquare, Info, Users, X, Edit2, Check, Camera, Copy, Database, History, Trash2 } from "lucide-react";
import { MDS } from "@minima-global/mds";
import { ChannelTabs, ChannelTab } from "../components/channel/ChannelTabs";

export const Route = createLazyFileRoute("/channel-info/$channelId")({
    component: ChannelInfoPage,
});



interface Person {
    publickey: string;
    currentaddress: string;
    type: "contact" | "community";
    extradata?: { name?: string; icon?: string };
}

const shortenKey = (key: string) => {
    if (!key) return "";
    return `${key.substring(0, 8)}...${key.substring(key.length - 8)}`;
};

function ChannelInfoPage() {
    const { channelId } = Route.useParams();
    const search: any = Route.useSearch();
    const navigate = useNavigate();
    const { myPublicKey, userName } = useContext(appContext);

    const [activeTab, setActiveTab] = useState<ChannelTab>(search.tab === "settings" ? "settings" : "profile");
    const [channelName, setChannelName] = useState("");
    const [description, setDescription] = useState("");
    const [isAdmin, setIsAdmin] = useState(false);
    const [creatorPublicKey, setCreatorPublicKey] = useState("");
    const [subscribers, setSubscribers] = useState<ChannelSubscriber[]>([]);
    const [loading, setLoading] = useState(true);

    const [isEditingName, setIsEditingName] = useState(false);
    const [newName, setNewName] = useState("");
    const [savingName, setSavingName] = useState(false);

    const [isEditingDesc, setIsEditingDesc] = useState(false);
    const [newDesc, setNewDesc] = useState("");
    const [savingDesc, setSavingDesc] = useState(false);
    const [avatar, setAvatar] = useState<string | null>(null);
    const [savingAvatar, setSavingAvatar] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [inviteLink, setInviteLink] = useState<string | null>(null);
    const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
    const [generatingLink, setGeneratingLink] = useState(false);

    // Invite modal state
    const [showInvite, setShowInvite] = useState(false);
    const [people, setPeople] = useState<Person[]>([]);
    const [inviting, setInviting] = useState<string | null>(null);
    const [inviteSearch, setInviteSearch] = useState("");
    const [inviteTab, setInviteTab] = useState<"all" | "contacts" | "community">("all");

    // -------------------------------------------------------------------------
    // Load channel data
    // -------------------------------------------------------------------------
    const [stats, setStats] = useState({ total: 0, mine: 0, firstDate: 0 });
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);


    const loadData = async () => {
        if (!myPublicKey) return;
        const info = await channelService.getChannelInfo(channelId);
        if (info) {
            setChannelName((info as any).NAME || (info as any).name || "Channel");
            setDescription((info as any).DESCRIPTION || (info as any).description || "");
            setAvatar((info as any).AVATAR || (info as any).avatar || null);
            setCreatorPublicKey((info as any).ADMIN_PUBLICKEY || (info as any).admin_publickey || "");
        }
        const admin = await channelService.isAdmin(channelId, myPublicKey);
        setIsAdmin(admin);
        const rawSubs = await channelService.getChannelSubscribers(channelId);

        // Fetch messages for statistics
        const msgs = await channelService.getChannelMessages(channelId);
        const mine = msgs.filter((m: any) => {
            const sender = (m.SENDER_PUBLICKEY || m.sender_publickey || "").toLowerCase();
            const me = (myPublicKey || "").toLowerCase();
            return sender === me;
        }).length;
        setStats({
            total: msgs.length,
            mine,
            firstDate: msgs.length > 0 ? Number((msgs[0] as any).DATE || msgs[0].date) : Number((info as any).CREATED_DATE || (info as any).created_date || 0)
        });

        const mappedSubs = rawSubs.map((s: any) => {
            const pk = s.PUBLICKEY || s.publickey;
            // Use same logic as groups for resolving name
            const name = s.RESOLVED_NAME || s.resolved_name || s.USERNAME || s.username || "Unknown Member";
            const role = (s.ROLE || s.role || "subscriber").toLowerCase();
            const isMe = (pk || "").toLowerCase() === (myPublicKey || "").toLowerCase();

            return {
                publickey: pk,
                username: name,
                isMe: isMe,
                role: role as 'admin' | 'subscriber'
            };
        });

        // Sort: Admin > Subscriber
        mappedSubs.sort((a, b) => {
            const rolePriority: any = { 'admin': 0, 'subscriber': 1 };
            const pA = rolePriority[a.role] ?? 1;
            const pB = rolePriority[b.role] ?? 1;

            if (pA !== pB) return pA - pB;
            // Secondary sort: Alphabetical
            return a.username.localeCompare(b.username);
        });

        setSubscribers(mappedSubs as any);
        setLoading(false);
    };

    useEffect(() => {
        loadData();

        const handleUpdate = () => {
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
            await channelService.removeSubscriber(channelId, myPublicKey || "", myPublicKey || "", userName || "Unknown");
            navigate({ to: '/' });
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
                subscribers.map((s: any) => (s.PUBLICKEY || s.publickey) as string)
            );

            // 1. Maxima contacts
            const res = await MDS.cmd.maxcontacts();
            const rawContacts = (res as any)?.response?.contacts || [];
            const contactsList: Person[] = rawContacts
                .filter((c: any) => !subKeys.has(c.publickey))
                .map((c: any) => ({ ...c, type: "contact" as const }));

            // 2. Recent chats (community / non-contacts)
            const chats = await chatService.getRecentChats();
            const contactKeys = new Set(contactsList.map((c) => c.publickey));
            const communityPeople: Person[] = chats
                .filter(
                    (chat) =>
                        chat.publickey &&
                        !subKeys.has(chat.publickey) &&
                        !contactKeys.has(chat.publickey)
                )
                .map((chat) => ({
                    publickey: chat.publickey,
                    currentaddress: chat.currentaddress || chat.publickey,
                    type: "community" as const,
                    extradata: { name: chat.roomname, icon: chat.avatar },
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
            await channelService.inviteSubscriber(channelId, person.publickey, name, myPublicKey, userName);
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
            await channelService.removeSubscriber(channelId, pubkey, myPublicKey, userName);
            await loadData();
        } catch (err) {
            console.error("❌ [CHANNEL-INFO] Remove failed:", err);
        }
    };

    const handleUpdateRole = async (pubkey: string, newRole: "admin" | "subscriber") => {
        if (!myPublicKey) return;
        try {
            await channelService.updateSubscriberRole(channelId, pubkey, newRole, myPublicKey);
            await loadData();
        } catch (err) {
            console.error("❌ [CHANNEL-INFO] Role update failed:", err);
            alert("Failed to update role.");
        }
    };

    const handleSaveName = async () => {
        if (!newName.trim() || newName.trim() === channelName) {
            setIsEditingName(false);
            return;
        }

        setSavingName(true);
        try {
            await channelService.updateChannelDetails(channelId, newName.trim(), null, null, myPublicKey || "");
            setChannelName(newName.trim());
            setIsEditingName(false);
        } catch (err) {
            console.error("Failed to rename channel:", err);
            setNewName(channelName);
        } finally {
            setSavingName(false);
        }
    };

    const handleSaveDesc = async () => {
        if (newDesc.trim() === description) {
            setIsEditingDesc(false);
            return;
        }

        setSavingDesc(true);
        try {
            await channelService.updateChannelDetails(channelId, null, newDesc.trim(), null, myPublicKey || "");
            setDescription(newDesc.trim());
            setIsEditingDesc(false);
        } catch (err) {
            console.error("Failed to update description:", err);
            setNewDesc(description);
        } finally {
            setSavingDesc(false);
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
            await channelService.updateChannelDetails(channelId, null, null, base64, myPublicKey || "");
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
            const link = await channelService.generateInviteCode(channelId, channelName);
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
        <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
            {/* HEADER */}
            <div className="sticky top-0 z-10 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-3">
                <button
                    onClick={() => {
                        if (search.returnTo) {
                            navigate({ to: search.returnTo });
                        } else {
                            navigate({ to: `/channels/${channelId}` });
                        }
                    }}
                    className="p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors text-gray-700 dark:text-gray-200"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="flex flex-col min-w-0">
                    <h1 className="text-lg font-semibold text-gray-800 dark:text-white truncate leading-tight">
                        {channelName}
                    </h1>
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        Channel Info
                    </span>
                </div>
            </div>

            {/* Tab Navigation */}
            <ChannelTabs activeTab={activeTab} onTabChange={setActiveTab} />

            <div className="flex-1 overflow-y-auto p-4 pb-10">
                <div className="max-w-2xl mx-auto space-y-6">
                    {activeTab === 'profile' && (
                        <div className="space-y-6">
                            {/* CHANNEL IDENTITY CARD */}
                            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center relative">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleAvatarFileSelect}
                                />
                                <div className="relative group/avatar mb-4">
                                    <div className={`w-24 h-24 rounded-full flex items-center justify-center text-white text-4xl font-bold shadow-lg overflow-hidden ${!avatar ? 'bg-primary-500 shadow-primary-500/30' : 'bg-gray-200 dark:bg-gray-700'}`}>
                                        {avatar ? (
                                            <img src={avatar} alt={channelName} className="w-full h-full object-cover" />
                                        ) : (
                                            channelName.charAt(0).toUpperCase()
                                        )}
                                    </div>

                                    {isAdmin && (
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={savingAvatar}
                                            className="absolute inset-0 flex items-center justify-center bg-black/40 text-white rounded-full opacity-0 group-hover/avatar:opacity-100 transition-opacity"
                                        >
                                            {savingAvatar ? (
                                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                                            ) : (
                                                <Camera size={24} />
                                            )}
                                        </button>
                                    )}
                                </div>
                                {isEditingName ? (
                                    <div className="flex items-center gap-2 mb-2 w-full max-w-xs">
                                        <input
                                            type="text"
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            autoFocus
                                            onBlur={handleSaveName}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveName();
                                                if (e.key === 'Escape') { setNewName(channelName); setIsEditingName(false); }
                                            }}
                                            className="flex-1 bg-gray-50 dark:bg-gray-900 border border-primary-500 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white text-center font-semibold focus:outline-none"
                                            disabled={savingName}
                                        />
                                        <button
                                            onClick={handleSaveName}
                                            disabled={savingName}
                                            className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
                                        >
                                            <Check size={18} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center gap-2 mb-1 w-full relative group/name">
                                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center break-all px-8">{channelName}</h1>
                                        {isAdmin && (
                                            <button
                                                onClick={() => { setNewName(channelName); setIsEditingName(true); }}
                                                className="absolute right-0 p-1.5 text-gray-400 opacity-0 group-hover/name:opacity-100 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-full transition-all"
                                                title="Rename Channel"
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                )}

                                {isEditingDesc ? (
                                    <div className="w-full mt-3 mb-4 flex flex-col items-end gap-2">
                                        <div className="relative w-full">
                                            <textarea
                                                value={newDesc}
                                                onChange={(e) => {
                                                    if (e.target.value.length <= 255) {
                                                        setNewDesc(e.target.value);
                                                    }
                                                }}
                                                autoFocus
                                                onBlur={handleSaveDesc}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Escape') { setNewDesc(description); setIsEditingDesc(false); }
                                                }}
                                                className="w-full bg-gray-50 dark:bg-gray-900 border border-primary-500 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 focus:outline-none resize-none pr-12"
                                                rows={3}
                                                placeholder="Add a channel description..."
                                                disabled={savingDesc}
                                            />
                                            <span className={`absolute bottom-2 right-2 text-[10px] font-medium ${newDesc.length >= 240 ? 'text-red-500' : 'text-gray-400'}`}>
                                                {newDesc.length}/255
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className={`mt-3 mb-4 w-full relative group/desc flex items-start ${description ? "justify-center text-center" : "justify-center"}`}>
                                        {description ? (
                                            <p className="text-gray-600 dark:text-gray-300 text-sm italic px-8 whitespace-pre-wrap text-center max-w-sm break-words">
                                                {description}
                                            </p>
                                        ) : isAdmin ? (
                                            <p className="text-gray-400 dark:text-gray-500 text-sm italic cursor-pointer hover:text-primary-500 transition-colors"
                                                onClick={() => { setNewDesc(description); setIsEditingDesc(true); }}>
                                                Add a description...
                                            </p>
                                        ) : null}

                                        {description && isAdmin && (
                                            <button
                                                onClick={() => { setNewDesc(description); setIsEditingDesc(true); }}
                                                className="absolute right-0 top-0 p-1.5 text-gray-400 opacity-0 group-hover/desc:opacity-100 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-full transition-all"
                                                title="Edit Description"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* CHAT STATISTICS */}
                            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Info size={18} className="text-primary-500" />
                                    <h3 className="font-semibold text-gray-900 dark:text-white">Chat Statistics</h3>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl">
                                        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400">
                                            <MessageSquare size={20} />
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Messages</p>
                                            <p className="text-sm font-bold text-gray-900 dark:text-white">{stats.total} total ({stats.mine} mine)</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl">
                                        <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center text-orange-600 dark:text-orange-400" >
                                            <History size={20} />
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">History</p>
                                            <p className="text-sm font-bold text-gray-900 dark:text-white">
                                                Since {stats.firstDate ? new Date(stats.firstDate).toLocaleDateString() : 'N/A'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* TECHNICAL DATA */}
                            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Database size={18} className="text-primary-500" />
                                    <h3 className="font-semibold text-gray-900 dark:text-white">Technical Data</h3>
                                </div>

                                <div className="space-y-3">
                                    <div className="group relative">
                                        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">Channel ID (Public Key)</p>
                                        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-transparent hover:border-primary-200 dark:hover:border-primary-900/50 transition-all">
                                            <p className="text-xs font-mono text-gray-800 dark:text-gray-200 break-all pr-8">{channelId}</p>
                                            <button
                                                onClick={() => copyToClipboard(channelId || "", 'channelid')}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg text-gray-400 hover:text-primary-500 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                                            >
                                                {copiedField === 'channelid' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">My Role</p>
                                        <div className="inline-flex items-center px-3 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-xs font-mono font-bold uppercase tracking-wider">
                                            {myPublicKey && creatorPublicKey && myPublicKey.toLowerCase() === creatorPublicKey.toLowerCase() ? 'creator' : isAdmin ? 'admin' : 'subscriber'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="space-y-6">
                            {/* SUBSCRIBERS LIST */}
                            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                                <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Users size={18} className="text-gray-500" />
                                        <span className="font-semibold text-gray-900 dark:text-white">Subscribers</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isAdmin && (
                                            <button
                                                onClick={handleOpenInvite}
                                                className="flex items-center gap-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 hover:bg-primary-100 dark:hover:bg-primary-900/50 px-3 py-1.5 rounded-full transition-colors"
                                            >
                                                <UserPlus size={13} />
                                                Add
                                            </button>
                                        )}
                                        <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full">
                                            {subscribers.length}
                                        </span>
                                    </div>
                                </div>

                                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                                    {subscribers.length === 0 ? (
                                        <div className="p-8 text-center text-gray-500">No subscribers found.</div>
                                    ) : (
                                        subscribers.map((sub: any, i) => {
                                            const pk = sub.publickey;
                                            const name = sub.username;
                                            const role = sub.role;
                                            const isMe = pk && myPublicKey && pk.toLowerCase() === myPublicKey.toLowerCase();

                                            return (
                                                <div key={pk || i} className={`relative flex items-center z-0 ${isMe ? 'bg-primary-50/50 dark:bg-primary-900/10' : 'hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}>
                                                    <button
                                                        onClick={() => {
                                                            if (!isMe) {
                                                                navigate({
                                                                    to: `/contact-info/${pk}`,
                                                                    search: { returnTo: `/channel-info/${channelId}` }
                                                                });
                                                            }
                                                        }}
                                                        className={`flex-1 p-4 flex items-center gap-3 transition-all text-left group min-w-0
                                                                  ${isMe
                                                                ? 'cursor-default'
                                                                : 'cursor-pointer active:scale-[0.99]'
                                                            }`}
                                                    >
                                                        <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0 flex items-center justify-center text-gray-600 dark:text-gray-300 font-medium text-sm group-hover:bg-gray-300 dark:group-hover:bg-gray-600 transition-colors">
                                                            {isMe ? 'You' : (name && name !== "Unknown Member" && name !== "Unknown" ? name.charAt(0).toUpperCase() : '?')}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div>
                                                                <p className="text-sm font-medium text-gray-900 dark:text-white truncate flex items-center gap-2">
                                                                    {isMe ? 'You' : (name && name !== "Unknown Member" && name !== "Unknown" ? name : shortenKey(pk))}
                                                                    {pk && creatorPublicKey && pk.toLowerCase() === creatorPublicKey.toLowerCase() ? (
                                                                        <span className="text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400 px-1.5 py-0.5 rounded-md uppercase tracking-wide flex-shrink-0">Creator</span>
                                                                    ) : role === 'admin' ? (
                                                                        <span className="text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400 px-1.5 py-0.5 rounded-md uppercase tracking-wide flex-shrink-0">Admin</span>
                                                                    ) : null}
                                                                </p>
                                                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate font-mono">
                                                                    {shortenKey(pk)}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </button>

                                                    {isAdmin && !isMe && (
                                                        <div className="flex items-center gap-1 pr-3 flex-shrink-0">
                                                            {role === "subscriber" ? (
                                                                <button
                                                                    onClick={() => handleUpdateRole(pk, "admin")}
                                                                    className="p-1.5 text-sky-600 hover:text-sky-700 dark:hover:text-sky-400 transition-colors rounded-full hover:bg-sky-50 dark:hover:bg-sky-900/20"
                                                                    title="Promote to admin"
                                                                >
                                                                    <ShieldCheck size={18} />
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleUpdateRole(pk, "subscriber")}
                                                                    className="p-1.5 text-amber-600 hover:text-amber-700 dark:hover:text-amber-400 transition-colors rounded-full hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                                                    title="Demote to subscriber"
                                                                >
                                                                    <ShieldAlert size={18} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => handleRemove(pk)}
                                                                className="p-1.5 text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors rounded-full hover:bg-red-50 dark:hover:bg-red-900/20"
                                                                title="Remove subscriber"
                                                            >
                                                                <UserX size={18} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* GENERATE INVITE LINK */}
                            {isAdmin && (
                                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
                                    <div className="mb-3 flex items-center gap-2">
                                        <Users size={18} className="text-primary-500" />
                                        <span className="font-semibold text-gray-900 dark:text-white">Invite Link</span>
                                    </div>

                                    {inviteLink ? (
                                        <div className="space-y-3">
                                            <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-600 break-all text-sm font-mono text-gray-600 dark:text-gray-300 relative group/link">
                                                {inviteLink}
                                                <button
                                                    onClick={handleCopyLink}
                                                    className="absolute right-2 top-2 p-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md text-gray-500 hover:text-primary-500 transition-colors shadow-sm"
                                                    title="Copy Invite Link"
                                                >
                                                    {inviteLinkCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                                </button>
                                            </div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                Share this link carefully. Anyone with this link can request to join the channel.
                                            </p>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={handleGenerateInvite}
                                            disabled={generatingLink}
                                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors disabled:opacity-50"
                                        >
                                            {generatingLink ? (
                                                "Generating..."
                                            ) : (
                                                <>
                                                    <Copy size={16} />
                                                    Generate Invite Link
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* EXIT CHANNEL BUTTON */}
                            <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-700">
                                <button
                                    onClick={() => setShowDeleteConfirm(true)}
                                    className="w-full flex items-center gap-3 p-4 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left font-medium"
                                >
                                    <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                                        <Trash2 size={20} />
                                    </div>
                                    Exit Channel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* EXIT CONFIRMATION DIALOG */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 fade-in duration-200 border border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Exit Channel?</h3>
                        <p className="text-gray-600 dark:text-gray-300 mb-6">
                            Are you sure you want to exit this channel? You will no longer receive new messages.
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
                                    handleExitChannel();
                                }}
                                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                            >
                                Exit
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Invite Modal */}
            {showInvite && (
                <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 overflow-hidden">
                        {/* Modal header */}
                        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                            <h3 className="font-bold text-gray-900 dark:text-white text-lg">Invite Subscriber</h3>
                            <button
                                onClick={() => setShowInvite(false)}
                                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Search */}
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                            <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    value={inviteSearch}
                                    onChange={(e) => setInviteSearch(e.target.value)}
                                    placeholder="Search people..."
                                    className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
                                />
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex gap-2 px-4 pt-1 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
                            {(["all", "contacts", "community"] as const).map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setInviteTab(tab)}
                                    className={`pb-2 pt-2 px-2 text-xs font-bold capitalize transition-colors relative ${inviteTab === tab
                                        ? "text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 dark:border-sky-400 -mb-px"
                                        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                        }`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        {/* People list */}
                        <div className="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-gray-700">
                            {people.filter(p => {
                                const name = p.extradata?.name || p.currentaddress || p.publickey;
                                const matchesSearch = name.toLowerCase().includes(inviteSearch.toLowerCase());
                                if (!matchesSearch) return false;
                                if (inviteTab === "contacts") return p.type === "contact";
                                if (inviteTab === "community") return p.type === "community";
                                return true;
                            }).length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                                    <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400 mb-3">
                                        <Users size={24} />
                                    </div>
                                    <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">No results found.</p>
                                    <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">Try a different search term or category.</p>
                                </div>
                            ) : (
                                people.filter(p => {
                                    const name = p.extradata?.name || p.currentaddress || p.publickey;
                                    const matchesSearch = name.toLowerCase().includes(inviteSearch.toLowerCase());
                                    if (!matchesSearch) return false;
                                    if (inviteTab === "contacts") return p.type === "contact";
                                    if (inviteTab === "community") return p.type === "community";
                                    return true;
                                }).map((person) => {
                                    const name = person.extradata?.name || person.currentaddress || person.publickey;
                                    return (
                                        <div key={person.publickey} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                                            <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-bold flex-shrink-0 shadow-sm">
                                                {name.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-gray-900 dark:text-white truncate text-sm">
                                                    {name}
                                                </p>
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400 capitalize font-medium">
                                                    {person.type}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handleInvite(person)}
                                                disabled={inviting === person.publickey}
                                                className="px-4 py-1.5 bg-sky-600 text-white text-xs font-bold rounded-full hover:bg-sky-700 active:bg-sky-800 transition-all disabled:opacity-50 shadow-sm shadow-sky-500/10"
                                            >
                                                {inviting === person.publickey ? "..." : "Invite"}
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
