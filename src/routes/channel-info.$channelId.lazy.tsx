// src/routes/channel-info.$channelId.lazy.tsx
import { useEffect, useState, useContext, useRef } from "react";
import { useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { appContext } from "../AppContext";
import { channelService, ChannelSubscriber } from "../services/channel.service";
import { chatService } from "../services/chat.service";
import { ArrowLeft, Radio, UserPlus, UserX, Search, ShieldCheck, ShieldAlert, MessageSquare, Info, Users, X, Edit2, Check, Camera, Link, Copy, CheckCheck } from "lucide-react";
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

function ChannelInfoPage() {
    const { channelId } = Route.useParams();
    const search: any = Route.useSearch();
    const navigate = useNavigate();
    const { myPublicKey, userName } = useContext(appContext);

    const [activeTab, setActiveTab] = useState<ChannelTab>(search.tab === "settings" ? "settings" : "profile");
    const [channelName, setChannelName] = useState("");
    const [description, setDescription] = useState("");
    const [isAdmin, setIsAdmin] = useState(false);
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
    const [stats, setStats] = useState({ total: 0, mine: 0 });

    const loadData = async () => {
        if (!myPublicKey) return;
        const info = await channelService.getChannelInfo(channelId);
        if (info) {
            setChannelName((info as any).NAME || (info as any).name || "Channel");
            setDescription((info as any).DESCRIPTION || (info as any).description || "");
            setAvatar((info as any).AVATAR || (info as any).avatar || null);
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
        setStats({ total: msgs.length, mine });

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
            {/* Header */}
            <div className="bg-primary-600 dark:bg-gray-800 text-white p-4 flex items-center gap-3 shadow-sm border-b dark:border-gray-700">
                <button
                    onClick={() => navigate({ to: "/channels/$channelId", params: { channelId } })}
                    className="p-2 hover:bg-white/10 dark:hover:bg-gray-700 rounded-full transition-colors"
                >
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-xl font-bold">Channel Info</h1>
            </div>

            {/* Tab Navigation */}
            <ChannelTabs activeTab={activeTab} onTabChange={setActiveTab} />

            <div className="flex-1 overflow-y-auto p-4 pb-10">
                <div className="max-w-2xl mx-auto space-y-6">
                    {activeTab === 'profile' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            {/* Channel identity */}
                            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 flex flex-col items-center gap-3 border border-gray-100 dark:border-gray-700">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleAvatarFileSelect}
                                />
                                <div className="relative group/avatar">
                                    <div className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg overflow-hidden ${!avatar ? 'bg-sky-500 shadow-sky-500/20' : 'bg-gray-200 dark:bg-gray-700'}`}>
                                        {avatar ? (
                                            <img src={avatar} alt={channelName} className="w-full h-full object-cover" />
                                        ) : (
                                            <Radio size={36} className="text-white" />
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
                                                <Camera size={20} />
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
                                        <h2 className="text-xl font-bold text-gray-900 dark:text-white text-center break-all px-8">{channelName}</h2>
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
                                    <div className="w-full mt-1 mb-2 flex flex-col items-end gap-2">
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
                                                rows={2}
                                                placeholder="Add a channel description..."
                                                disabled={savingDesc}
                                            />
                                            <span className={`absolute bottom-2 right-2 text-[10px] font-medium ${newDesc.length >= 240 ? 'text-red-500' : 'text-gray-400'}`}>
                                                {newDesc.length}/255
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className={`mt-1 mb-2 w-full relative group/desc flex items-start ${description ? "justify-center text-center" : "justify-center"}`}>
                                        {description ? (
                                            <p className="text-sm text-gray-500 dark:text-gray-400 text-center italic px-8 whitespace-pre-wrap max-w-sm break-words">
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
                                <span className="text-xs font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/30 px-3 py-1 rounded-full border border-sky-100 dark:border-sky-800 uppercase tracking-wide">
                                    {isAdmin ? "📢 Admin" : "👁️ Subscriber"}
                                </span>

                                {/* INVITE LINK — admin only */}
                                {isAdmin && (
                                    <div className="w-full mt-4 border-t border-gray-100 dark:border-gray-700 pt-4">
                                        <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <Link size={12} />
                                            Invite Link
                                        </p>
                                        {inviteLink ? (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        readOnly
                                                        value={inviteLink}
                                                        className="flex-1 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-500 dark:text-gray-400 truncate focus:outline-none"
                                                    />
                                                    <button
                                                        onClick={handleCopyLink}
                                                        className="p-2 rounded-lg bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors flex-shrink-0"
                                                        title="Copy link"
                                                    >
                                                        {inviteLinkCopied ? <CheckCheck size={16} /> : <Copy size={16} />}
                                                    </button>
                                                </div>
                                                <button
                                                    onClick={handleGenerateInvite}
                                                    disabled={generatingLink}
                                                    className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors py-1"
                                                >
                                                    🔄 Regenerate link
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={handleGenerateInvite}
                                                disabled={generatingLink}
                                                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400 rounded-xl border border-sky-100 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-colors text-sm font-semibold disabled:opacity-50"
                                            >
                                                {generatingLink ? (
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-sky-600" />
                                                ) : (
                                                    <Link size={15} />
                                                )}
                                                {generatingLink ? "Generating..." : "Generate Invite Link"}
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* STATISTICS */}
                                <div className="w-full grid grid-cols-2 gap-3 mt-4">
                                    <div className="flex flex-col items-center p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl">
                                        <MessageSquare size={18} className="text-primary-500 mb-1" />
                                        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Total</p>
                                        <p className="text-sm font-bold text-gray-900 dark:text-white">{stats.total}</p>
                                    </div>
                                    <div className="flex flex-col items-center p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl">
                                        <Info size={18} className="text-primary-500 mb-1" />
                                        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Mine</p>
                                        <p className="text-sm font-bold text-gray-900 dark:text-white">{stats.mine}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            {/* SUBSCRIBERS LIST */}
                            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                                <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
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
                                                Add Member
                                            </button>
                                        )}
                                        <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-full font-bold">
                                            {subscribers.length}
                                        </span>
                                    </div>
                                </div>

                                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                                    {subscribers.length === 0 ? (
                                        <div className="p-10 text-center">
                                            <p className="text-gray-500 dark:text-gray-400 text-sm italic">No subscribers found.</p>
                                        </div>
                                    ) : (
                                        subscribers.map((sub: any) => {
                                            const pk = sub.publickey;
                                            const name = sub.username;
                                            const role = sub.role;
                                            const isSelf = pk && myPublicKey && pk.toLowerCase() === myPublicKey.toLowerCase();

                                            return (
                                                <div key={pk} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                                                    <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-bold flex-shrink-0">
                                                        {name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium text-gray-900 dark:text-white truncate">
                                                            {name} {isSelf ? "(you)" : ""}
                                                        </p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                                            {role === "admin" ? "📢 Admin" : "👁️ Subscriber"}
                                                        </p>
                                                    </div>
                                                    {isAdmin && !isSelf && (
                                                        <div className="flex items-center gap-1">
                                                            {role === "subscriber" ? (
                                                                <button
                                                                    onClick={() => handleUpdateRole(pk, "admin")}
                                                                    className="p-1.5 text-sky-600 hover:text-sky-700 dark:hover:text-sky-400 transition-colors rounded-full hover:bg-sky-50 dark:hover:bg-sky-900/20"
                                                                    title="Promote to admin"
                                                                >
                                                                    <ShieldCheck size={16} />
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleUpdateRole(pk, "subscriber")}
                                                                    className="p-1.5 text-amber-600 hover:text-amber-700 dark:hover:text-amber-400 transition-colors rounded-full hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                                                    title="Demote to subscriber"
                                                                >
                                                                    <ShieldAlert size={16} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => handleRemove(pk)}
                                                                className="p-1.5 text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors rounded-full hover:bg-red-50 dark:hover:bg-red-900/20"
                                                                title="Remove subscriber"
                                                            >
                                                                <UserX size={16} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

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
