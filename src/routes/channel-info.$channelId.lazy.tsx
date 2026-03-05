// src/routes/channel-info.$channelId.lazy.tsx
import { useEffect, useState, useContext } from "react";
import { useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { appContext } from "../AppContext";
import { channelService, ChannelSubscriber } from "../services/channel.service";
import { chatService } from "../services/chat.service";
import { ArrowLeft, Radio, UserPlus, UserX, Search } from "lucide-react";
import { MDS } from "@minima-global/mds";

export const Route = createLazyFileRoute("/channel-info/$channelId")({
    component: ChannelInfoPage,
});

const defaultAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

interface Person {
    publickey: string;
    currentaddress: string;
    type: "contact" | "community";
    extradata?: { name?: string; icon?: string };
}

function ChannelInfoPage() {
    const { channelId } = Route.useParams();
    const navigate = useNavigate();
    const { myPublicKey, userName } = useContext(appContext);

    const [channelName, setChannelName] = useState("");
    const [description, setDescription] = useState("");
    const [isAdmin, setIsAdmin] = useState(false);
    const [subscribers, setSubscribers] = useState<ChannelSubscriber[]>([]);
    const [loading, setLoading] = useState(true);

    // Invite modal state
    const [showInvite, setShowInvite] = useState(false);
    const [people, setPeople] = useState<Person[]>([]);
    const [inviting, setInviting] = useState<string | null>(null);
    const [inviteSearch, setInviteSearch] = useState("");
    const [inviteTab, setInviteTab] = useState<"all" | "contacts" | "community">("all");

    // -------------------------------------------------------------------------
    // Load channel data
    // -------------------------------------------------------------------------
    const loadData = async () => {
        if (!myPublicKey) return;
        const info = await channelService.getChannelInfo(channelId);
        if (info) {
            setChannelName((info as any).NAME || (info as any).name || "Channel");
            setDescription((info as any).DESCRIPTION || (info as any).description || "");
        }
        const admin = await channelService.isAdmin(channelId, myPublicKey);
        setIsAdmin(admin);
        const subs = await channelService.getChannelSubscribers(channelId);
        setSubscribers(subs);
        setLoading(false);
    };

    useEffect(() => {
        loadData();
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
        if (!confirm("Remove this subscriber?")) return;
        try {
            await channelService.removeSubscriber(channelId, pubkey, myPublicKey, userName);
            await loadData();
        } catch (err) {
            console.error("❌ [CHANNEL-INFO] Remove failed:", err);
        }
    };

    const filteredPeople = people.filter((p) => {
        const matchesSearch = (p.extradata?.name || p.currentaddress)
            .toLowerCase()
            .includes(inviteSearch.toLowerCase());
        if (!matchesSearch) return false;
        if (inviteTab === "contacts") return p.type === "contact";
        if (inviteTab === "community") return p.type === "community";
        return true;
    });

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

            <div className="flex-1 overflow-y-auto p-4 pb-10">
                <div className="max-w-2xl mx-auto space-y-4">
                    {/* Channel identity */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 flex flex-col items-center gap-3">
                        <div className="w-20 h-20 rounded-full bg-sky-500 flex items-center justify-center shadow-md">
                            <Radio size={36} className="text-white" />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white text-center">{channelName}</h2>
                        {description && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{description}</p>
                        )}
                        <span className="text-xs text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/20 px-3 py-1 rounded-full border border-sky-200 dark:border-sky-800">
                            {isAdmin ? "📢 You are the admin" : "👁️ Subscriber (read-only)"}
                        </span>
                    </div>

                    {/* Subscribers section */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm">
                        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                            <h3 className="font-semibold text-gray-900 dark:text-white">
                                Subscribers ({subscribers.length})
                            </h3>
                            {isAdmin && (
                                <button
                                    onClick={handleOpenInvite}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
                                >
                                    <UserPlus size={14} />
                                    Invite
                                </button>
                            )}
                        </div>

                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                            {subscribers.map((sub: any) => {
                                const pk = sub.PUBLICKEY || sub.publickey;
                                const name = sub.RESOLVED_NAME || sub.resolved_name || sub.USERNAME || sub.username || "Unknown";
                                const role = (sub.ROLE || sub.role || "subscriber").toLowerCase();
                                const isSelf = pk === myPublicKey;

                                return (
                                    <div key={pk} className="flex items-center gap-3 px-4 py-3">
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
                                        {isAdmin && !isSelf && role !== "admin" && (
                                            <button
                                                onClick={() => handleRemove(pk)}
                                                className="p-1.5 text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors rounded-full hover:bg-red-50 dark:hover:bg-red-900/20"
                                                title="Remove subscriber"
                                            >
                                                <UserX size={16} />
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Invite Modal */}
            {showInvite && (
                <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95 fade-in duration-200">
                        {/* Modal header */}
                        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                            <h3 className="font-bold text-gray-900 dark:text-white text-lg">Invite subscriber</h3>
                            <button
                                onClick={() => setShowInvite(false)}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="flex gap-2 px-4 pt-3 border-b border-gray-100 dark:border-gray-700">
                            {(["all", "contacts", "community"] as const).map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setInviteTab(tab)}
                                    className={`pb-2 px-2 text-sm font-medium capitalize transition-colors relative ${inviteTab === tab
                                        ? "text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 dark:border-sky-400 -mb-px"
                                        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                        }`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        {/* Search */}
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                            <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    value={inviteSearch}
                                    onChange={(e) => setInviteSearch(e.target.value)}
                                    placeholder="Search..."
                                    className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
                                />
                            </div>
                        </div>

                        {/* People list */}
                        <div className="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-gray-700">
                            {filteredPeople.length === 0 ? (
                                <p className="text-center text-gray-500 dark:text-gray-400 py-10 text-sm">
                                    {people.length === 0
                                        ? "All contacts are already subscribers."
                                        : "No results found."}
                                </p>
                            ) : (
                                filteredPeople.map((person) => {
                                    const name = person.extradata?.name || person.currentaddress || person.publickey;
                                    const avatar = person.extradata?.icon
                                        ? decodeURIComponent(person.extradata.icon)
                                        : defaultAvatar;

                                    return (
                                        <div key={person.publickey} className="flex items-center gap-3 px-4 py-3">
                                            <img
                                                src={avatar.startsWith("data:image") ? avatar : defaultAvatar}
                                                alt={name}
                                                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                                onError={(e: any) => { e.target.src = defaultAvatar; }}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-gray-900 dark:text-white truncate">{name}</p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{person.type}</p>
                                            </div>
                                            <button
                                                onClick={() => handleInvite(person)}
                                                disabled={inviting === person.publickey}
                                                className="px-3 py-1.5 bg-sky-600 text-white text-sm rounded-lg hover:bg-sky-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium flex-shrink-0"
                                            >
                                                {inviting === person.publickey ? "Inviting..." : "Invite"}
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
