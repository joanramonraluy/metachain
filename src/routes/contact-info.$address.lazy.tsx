import { useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useContext } from 'react';
import ContactActions from "../components/contact/ContactActions";
import ContactPrivacy from "../components/contact/ContactPrivacy";
import { ContactTabs, ContactTab } from "../components/contact/ContactTabs";
import { MDS } from "@minima-global/mds";
import { ArrowLeft, Copy, Check, MapPin, Globe, Mail, Twitter, Linkedin, Github, ShieldAlert, Info, ExternalLink, Trash2 } from "lucide-react";
import { minimaService } from "../services/minima.service";
import { chatService } from "../services/chat.service";
import type { ExtendedProfile } from "../services/profile.service";
import { personalContactsService } from "../services/personal-contacts.service";
import { appContext } from "../AppContext";
import { resolveHexFromAddress } from "../services/messaging.service";
import { safeUrl } from "../utils/sanitization";

export const Route = createLazyFileRoute("/contact-info/$address")({
    component: ContactInfoPage,
});

interface Contact {
    id?: number;
    currentaddress: string;
    publickey: string;
    extradata?: {
        minimaaddress?: string;
        name?: string;
        icon?: string;
        description?: string;
    };
    myaddress?: string;
    samechain?: boolean;
    lastseen?: number;
}

function ContactInfoPage() {
    const { address } = Route.useParams();
    const search = Route.useSearch();
    const navigate = useNavigate();
    const { userName, userAvatar } = useContext(appContext);
    const [contact, setContact] = useState<Contact | null>(null);
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const [extendedProfile, setExtendedProfile] = useState<ExtendedProfile | null>(null);
    const [userAllowsNonContactChats, setUserAllowsNonContactChats] = useState(true);
    const [isPersonalContact, setIsPersonalContact] = useState(false);
    const [togglingPersonal, setTogglingPersonal] = useState(false);
    const [isMaximaContact, setIsMaximaContact] = useState(false);
    const [removingContact, setRemovingContact] = useState(false);
    const [activeTab, setActiveTab] = useState<ContactTab>('profile');
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);
    const [isCheckingProfile, setIsCheckingProfile] = useState(true);
    const [isBlocked, setIsBlocked] = useState(false);
    const [maximaRequestPending, setMaximaRequestPending] = useState(false);
    const [maximaIncomingRequest, setMaximaIncomingRequest] = useState(false);
    const [sendingMaximaRequest] = useState(false);
    const [addingContact] = useState(false);
    const [requestStatus, setRequestStatus] = useState<'none' | 'pending' | 'accepted' | 'declined'>('none');
    const [hasChatHistory] = useState(false);

    useEffect(() => {
        if (search.tab) setActiveTab(search.tab as ContactTab);
    }, [search.tab]);

    useEffect(() => {
        if (address.startsWith("Mx") || address.startsWith("MX")) {
            resolveHexFromAddress(address).then((hex) => {
                if (hex) navigate({ to: "/contact-info/$address", params: { address: hex }, replace: true });
            });
        }
    }, [address, navigate]);

    const handleToggleBlock = async () => {
        if (!contact?.publickey) return;
        try {
            const sendSystemNotification = async (type: string, msg: string) => {
                const target = contact.currentaddress || contact.publickey;
                if (!target) return;
                const payload = { type, message: msg, timestamp: Date.now() };
                const hexData = "0x" + Array.from(new TextEncoder().encode(JSON.stringify(payload))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
                await MDS.cmd.maxima({ params: { action: "send", to: target, application: "metachain", data: hexData, poll: false } as any });
            };

            if (isBlocked) {
                await sendSystemNotification("contact_unblocked", "User has unblocked you");
                await minimaService.unblockContact(contact.publickey);
                setIsBlocked(false);
                await minimaService.insertMessage({ roomname: contact.extradata?.name || "Unknown", publickey: contact.publickey, username: "Me", type: "system", message: "You unblocked this user", date: Date.now() });
            } else {
                await sendSystemNotification("contact_blocked", "User has blocked you");
                await minimaService.blockContact(contact.publickey);
                setIsBlocked(true);
                await minimaService.insertMessage({ roomname: contact.extradata?.name || "Unknown", publickey: contact.publickey, username: "Me", type: "system", message: "You blocked this user", date: Date.now() });
            }
        } catch (err) {
            console.error("❌ Error toggling block:", err);
        }
    };

    const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";
    const getAvatar = (c: Contact | null) => {
        if (c?.extradata?.icon) {
            try {
                const decoded = decodeURIComponent(c.extradata.icon);
                if (decoded.startsWith("data:image") && !decoded.includes("/0x00")) return decoded;
            } catch (err) {}
        }
        return defaultAvatar;
    };

    const fetchContact = async () => {
        try {
            const res = await MDS.cmd.maxcontacts();
            const list: Contact[] = (res as any)?.response?.contacts || [];
            const addrUpper = address.toUpperCase();
            const c = list.find(x => x.publickey?.toUpperCase() === addrUpper || x.currentaddress?.toUpperCase() === addrUpper || x.extradata?.minimaaddress?.toUpperCase() === addrUpper);

            if (c) {
                setContact(c);
                setIsMaximaContact(true);
                const pkSql = `SELECT bio, last_seen FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${c.publickey}')`;
                const bioRes = await MDS.sql(pkSql);
                if (bioRes.status && bioRes.rows?.length > 0) {
                    const row = bioRes.rows[0];
                    setContact(prev => ({
                        ...prev!,
                        lastseen: row.LAST_SEEN ? Number(row.LAST_SEEN) : prev?.lastseen,
                        extradata: { ...prev?.extradata, description: row.BIO || prev?.extradata?.description }
                    }));
                }
            } else {
                const sql = `SELECT * FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${address}')`;
                const discoveryRes = await MDS.sql(sql);
                if (discoveryRes.status && discoveryRes.rows?.length > 0) {
                    const peer = discoveryRes.rows[0];
                    let avatar = "", country = "", languages: string[] = [];
                    if (peer.EXTRA_DATA) {
                        try {
                            const extraObj = JSON.parse(peer.EXTRA_DATA);
                            avatar = extraObj.avatar || "";
                            country = extraObj.country || "";
                            languages = Array.isArray(extraObj.languages) ? extraObj.languages : (typeof extraObj.languages === 'string' ? JSON.parse(extraObj.languages) : []);
                        } catch {}
                    }
                    if (peer.ALLOW_NON_CONTACT_CHATS !== undefined) {
                        setUserAllowsNonContactChats(peer.ALLOW_NON_CONTACT_CHATS === 1 || peer.ALLOW_NON_CONTACT_CHATS === "1" || peer.ALLOW_NON_CONTACT_CHATS === true);
                    }
                    setContact({ publickey: peer.PUBLICKEY, currentaddress: peer.ADDRESS, extradata: { name: peer.ALIAS || "Unknown", description: peer.BIO || "", icon: avatar }, lastseen: peer.LAST_SEEN ? Number(peer.LAST_SEEN) : undefined });
                    // Check if this peer is actually a Maxima contact (even if not found in maxcontacts list above)
                    const maximaContactCheck = await MDS.cmd.maxcontacts();
                    const maximaList: Contact[] = (maximaContactCheck as any)?.response?.contacts || [];
                    const isAlreadyMaxima = maximaList.some(x => x.publickey === peer.PUBLICKEY);
                    setIsMaximaContact(isAlreadyMaxima);
                    if (country || languages.length > 0 || avatar) {
                        setExtendedProfile({ name: peer.ALIAS || "Unknown", bio: peer.BIO || "", avatar, country, languages, allowNonContactChats: true, privacy_l2: 'visible', privacy_l3: 'visible' });
                    }
                }
            }
        } catch (err) {} finally { setLoading(false); }
    };

    useEffect(() => { fetchContact(); }, [address]);

    const checkStatus = useCallback(async () => {
        if (!contact?.publickey) return;
        try {
            // 1. requestStatus via CHAT_MESSAGES (source of truth — matches SYNCGIT reference)
            const safeAddr = contact.currentaddress ? contact.currentaddress.replace(/'/g, "''") : '';
            const requestSql = `SELECT * FROM CHAT_MESSAGES
                                WHERE (UPPER(publickey)=UPPER('${contact.publickey}') ${safeAddr ? `OR UPPER(publickey)=UPPER('${safeAddr}')` : ''})
                                AND (message='Contact request sent' OR message='Chat request sent'
                                  OR message='Chat request accepted' OR message='Contact accepted' OR message='User chat accepted'
                                  OR message='Contact request declined' OR message='Chat request declined'
                                  OR message='Contact request cancelled' OR message='Chat request cancelled')
                                ORDER BY date DESC LIMIT 1`;
            const requestRes = await minimaService.runSQL(requestSql);
            if (requestRes?.rows?.length > 0) {
                const msg = requestRes.rows[0].MESSAGE;
                if (msg === 'Chat request accepted' || msg === 'User chat accepted' || msg === 'Contact accepted') {
                    setRequestStatus('accepted');
                } else if (msg === 'Contact request sent' || msg === 'Chat request sent') {
                    setRequestStatus('pending');
                } else if (msg === 'Contact request declined' || msg === 'Chat request declined') {
                    setRequestStatus('declined');
                } else if (msg === 'Contact request cancelled' || msg === 'Chat request cancelled') {
                    setRequestStatus('none');
                }
            } else {
                setRequestStatus('none');
            }

            // 2. Block status
            const status = await minimaService.getChatStatus(contact.publickey);
            setIsBlocked(!!status.blocked);

            // 3. Maxima contact requests
            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myPk = (myInfo.response as any).publickey;

            const maxOutgoingSql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('${myPk}') AND UPPER(to_publickey)=UPPER('${contact.publickey}') AND status='pending'`;
            const maxOutgoingRes = await minimaService.runSQL(maxOutgoingSql);
            setMaximaRequestPending(maxOutgoingRes?.rows?.length > 0);

            const maxAcceptedSql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS WHERE ((UPPER(from_publickey)=UPPER('${myPk}') AND UPPER(to_publickey)=UPPER('${contact.publickey}')) OR (UPPER(from_publickey)=UPPER('${contact.publickey}') AND UPPER(to_publickey)=UPPER('${myPk}'))) AND status='accepted' LIMIT 1`;
            const maxAcceptedRes = await minimaService.runSQL(maxAcceptedSql);
            if (maxAcceptedRes?.rows?.length > 0) setIsMaximaContact(true);

            const maxIncomingSql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS WHERE UPPER(from_publickey)=UPPER('${contact.publickey}') AND UPPER(to_publickey)=UPPER('${myPk}') AND status='pending'`;
            const maxIncomingRes = await minimaService.runSQL(maxIncomingSql);
            setMaximaIncomingRequest(maxIncomingRes?.rows?.length > 0);
        } catch (err) {}
    }, [contact]);

    useEffect(() => { checkStatus(); }, [checkStatus]);

    useEffect(() => {
        chatService.onChatListUpdate(checkStatus);
        return () => { chatService.removeChatListUpdateCallback(checkStatus); };
    }, [checkStatus]);

    const handleRequestProfile = async () => {
        if (!contact?.currentaddress || !contact?.publickey) return;
        setIsCheckingProfile(true);
        try {
            const { requestProfile } = await import("../services/profile.service");
            const profile = await requestProfile(contact.currentaddress, contact.publickey, 30000, true);
            setExtendedProfile(profile);
            if (profile.allowNonContactChats !== undefined) setUserAllowsNonContactChats(profile.allowNonContactChats);
        } catch (err) {
            // Error handled by UI state
        } finally { setIsCheckingProfile(false); }
    };

    useEffect(() => { if (contact?.currentaddress) handleRequestProfile(); }, [contact]);

    const copyToClipboard = (text: string, fieldId: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(fieldId);
        setTimeout(() => setCopiedField(null), 2000);
    };

    if (loading) return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-10 h-10 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin"></div>
      </div>
    );

    if (!contact) return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 p-8 text-center space-y-6">
        <div className="w-20 h-20 bg-gray-100 dark:bg-white/5 rounded-3xl flex items-center justify-center text-gray-300">
          <Info size={40} />
        </div>
        <div className="space-y-2">
            <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Identity not found</h1>
            <p className="text-sm text-gray-500 font-bold max-w-xs">We couldn't resolve this node in your local discovery cache or contacts.</p>
        </div>
        <button onClick={() => navigate({ to: "/" })} className="px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-black rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95">Go to Community</button>
      </div>
    );

    const contactActionsProps = {
        isMaximaContact,
        userAllowsNonContactChats,
        maximaIncomingRequest,
        requestStatus,
        hasChatHistory,
        maximaRequestPending,
        sendingMaximaRequest,
        addingContact,
        onNavigateChat: () => navigate({ to: "/chat/$address", params: { address: contact.publickey } }),
        onCancelRequest: async () => { await minimaService.cancelChatRequest(contact.publickey); checkStatus(); },
        onSendContactRequest: async () => { 
            try {
                // Navigate immediately to the chat page to provide instant feedback
                navigate({ 
                    to: "/chat/$address", 
                    params: { address: contact.publickey },
                    search: { requestPending: true }
                });
                // Then send the request in the background
                await minimaService.sendChatRequest(contact.currentaddress, userName || "Unknown", userAvatar || "", contact.publickey); 
                setRequestStatus('pending');
            } catch (err) {
                console.error("Failed to send chat request:", err);
            }
        },
        onCancelMaximaRequest: async () => { await minimaService.cancelMaximaContactRequest(contact.publickey); setMaximaRequestPending(false); },
        onSendMaximaRequest: async () => { 
            try {
                // Navigate immediately to provide instant feedback
                navigate({ 
                    to: "/chat/$address", 
                    params: { address: contact.publickey },
                    search: { requestPending: true }
                });
                // Send request in background
                await minimaService.sendMaximaContactRequest(contact.currentaddress, contact.publickey); 
                setMaximaRequestPending(true); 
            } catch (err) {
                console.error("Failed to send maxima request:", err);
            }
        },
        isBlocked,
        onToggleBlock: handleToggleBlock,
        removingContact,
        isCheckingProfile,
        onPing: isMaximaContact ? async () => {
            if (!contact?.publickey) return;
            try {
                await minimaService.sendPing(contact.publickey);
                // Optional: show a toast or feedback
            } catch (err) {
                console.error("❌ Error sending ping:", err);
            }
        } : undefined
    };

    const contactName = contact?.extradata?.name || "Nomad User";
    const avatarUrl = getAvatar(contact);
    const isOnline = !!contact.lastseen && (Date.now() - contact.lastseen < 300000);

    return (
        <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 overflow-hidden">
            <style>{`
                @keyframes profileFade {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .profile-animate {
                    animation: profileFade 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
                .glow-emerald {
                    box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
                }
            `}</style>

            {/* ELITE STICKY HEADER */}
            <header className="sticky top-0 z-50 bg-white/70 dark:bg-gray-950/70 backdrop-blur-2xl border-b border-white/20 dark:border-white/5 px-6 py-4 flex items-center justify-between">
                <button
                    onClick={() => search.returnTo ? navigate({ to: search.returnTo }) : navigate({ to: '/' })}
                    className="p-3 bg-gray-100 dark:bg-white/5 rounded-2xl hover:scale-110 active:scale-95 transition-all text-gray-900 dark:text-white group"
                >
                    <ArrowLeft size={20} className="stroke-[3] group-hover:-translate-x-1 transition-transform" />
                </button>
                <div className="flex-1 text-center px-4">
                   <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400 opacity-60">Identity Profile</span>
                </div>
                <div className="w-12 h-12 flex items-center justify-center">
                    <Info size={18} className="text-gray-300 opacity-20" />
                </div>
            </header>

            <div className="flex-1 overflow-y-auto l-scrollbar">
                {/* HERO HEADER - BALANCED ELITE */}
                <div className="relative pt-16 pb-12 px-6 sm:px-12 bg-white dark:bg-gray-950">
                    <div className="absolute inset-0 bg-gradient-to-b from-primary-500/5 to-transparent pointer-events-none"></div>
                    <div className="max-w-screen-xl mx-auto flex flex-col items-center text-center space-y-8">
                        <div className="relative profile-animate">
                            <div className="absolute -inset-6 bg-primary-500/10 rounded-full blur-3xl opacity-50"></div>
                            <div className="relative group/avatar">
                                <div className="absolute -inset-1.5 bg-gradient-to-tr from-primary-500 to-indigo-600 rounded-[3rem] blur opacity-20 group-hover/avatar:opacity-40 transition-opacity duration-700"></div>
                                <img
                                    src={avatarUrl}
                                    className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-[2.75rem] object-cover border-2 border-white/20 dark:border-white/10 shadow-2xl transition-all duration-700 group-hover/avatar:scale-[1.02]"
                                    onError={(e) => { (e.target as HTMLImageElement).src = defaultAvatar; }}
                                />
                                <div className={`absolute -bottom-2 -right-2 w-9 h-9 rounded-full border-4 border-white dark:border-gray-950 transition-all shadow-xl ${isOnline ? "bg-emerald-500 glow-emerald" : "bg-gray-300"}`}>
                                    {isOnline && <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-30"></div>}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4 profile-animate" style={{ animationDelay: '100ms' }}>
                            <h1 className="text-4xl sm:text-5xl font-black text-gray-900 dark:text-white tracking-tighter leading-none uppercase">{contactName}</h1>
                            
                            <div className="flex flex-wrap items-center justify-center gap-3">
                                <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border shadow-sm ${
                                    isMaximaContact 
                                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" 
                                        : maximaRequestPending
                                            ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 animate-pulse"
                                            : maximaIncomingRequest
                                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 animate-pulse"
                                                : "bg-gray-100 dark:bg-white/5 text-gray-400 border-gray-200 dark:border-white/5"
                                }`}>
                                    {isMaximaContact ? "Maxima Established" : maximaRequestPending ? "Sync Pending" : maximaIncomingRequest ? "Incoming Sync" : "No Maxima Link"}
                                </div>
                                {isOnline && (
                                    <div className="px-4 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-black uppercase tracking-[0.2em]">
                                        Peer Online
                                    </div>
                                )}
                                {isPersonalContact && (
                                    <div className="px-4 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-black uppercase tracking-[0.2em]">
                                        Trusted Status
                                    </div>
                                )}
                            </div>
                        </div>

                        <p className="max-w-xl text-sm sm:text-base text-gray-500 dark:text-gray-400 font-medium leading-relaxed profile-animate" style={{ animationDelay: '200ms' }}>
                            {contact?.extradata?.description || "Decentralized identity without a public biography. Connect to learn more about this network node."}
                        </p>

                        <div className="flex flex-wrap justify-center gap-3 profile-animate" style={{ animationDelay: '300ms' }}>
                             <div className="px-5 py-2.5 bg-gray-100 dark:bg-white/5 rounded-2xl flex items-center gap-3 border border-white/5 transition-all group cursor-pointer hover:bg-white dark:hover:bg-white/10 shadow-sm" onClick={() => contact && copyToClipboard(contact.publickey, 'pk')}>
                                <span className="text-[10px] font-black text-gray-400 group-hover:text-primary-500 transition-colors uppercase tracking-widest">PK: {contact?.publickey?.substring(0, 12)}...</span>
                                {copiedField === 'pk' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} className="text-gray-400 group-hover:text-primary-500" />}
                             </div>
                        </div>
                    </div>
                </div>

                {/* TABS NAVIGATION - CENTERED ELITE */}
                <div className="flex justify-center -mt-4 relative z-10">
                    <ContactTabs activeTab={activeTab} onTabChange={setActiveTab} />
                </div>

                {/* TAB CONTENT - WRAPPER */}
                <div className="max-w-3xl mx-auto px-6 py-12 sm:px-12 pb-32">
                    {activeTab === "profile" && (
                      <div className="space-y-12 profile-animate">
                        <div className="space-y-12">
                          <section className="space-y-8 text-center">
                            <div className="flex items-center gap-6">
                              <div className="flex-1 h-px bg-gradient-to-r from-transparent to-gray-200 dark:to-gray-800"></div>
                              <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-400 font-black shrink-0 opacity-60">
                                Profile Ledger
                              </h2>
                              <div className="flex-1 h-px bg-gradient-to-l from-transparent to-gray-200 dark:to-gray-800"></div>
                            </div>
                                   
                             <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <ProfileAttribute icon={MapPin} label="Origin" value={extendedProfile?.country || 'P2P Network'} color="primary" />
                                <ProfileAttribute icon={Globe} label="Languages" value={extendedProfile?.languages?.join(', ') || 'Global Protocol'} color="emerald" />
                                {extendedProfile?.website && (
                                    <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md p-8 rounded-[2.75rem] border border-white/20 dark:border-white/5 flex flex-col gap-3 shadow-lg shadow-black/5 items-center text-center group hover:border-primary-500/20 transition-all">
                                        <div className="w-12 h-12 rounded-2xl bg-primary-500/10 flex items-center justify-center text-primary-500 group-hover:scale-110 transition-transform">
                                           <Globe size={22} />
                                        </div>
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 opacity-60">Node Website</span>
                                        <a href={safeUrl(extendedProfile.website)} target="_blank" className="text-sm font-black text-gray-900 dark:text-white flex items-center gap-2 hover:text-primary-500 transition-colors uppercase tracking-tight">
                                          {extendedProfile.website.length > 25 ? extendedProfile.website.substring(0, 25) + '...' : extendedProfile.website} <ExternalLink size={14} />
                                        </a>
                                    </div>
                                )}
                                {extendedProfile?.email && (
                                    <ProfileAttribute icon={Mail} label="Secure Mail" value={extendedProfile.email} color="rose" />
                                )}
                             </div>
                          </section>

                          {extendedProfile?.social && Object.keys(extendedProfile.social).length > 0 && (
                              <section className="space-y-8 text-center">
                                 <div className="flex items-center gap-6">
                                    <div className="flex-1 h-px bg-gradient-to-r from-transparent to-gray-200 dark:to-gray-800"></div>
                                    <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-400 opacity-60">Identity Links</h2>
                                    <div className="flex-1 h-px bg-gradient-to-l from-transparent to-gray-200 dark:to-gray-800"></div>
                                 </div>
                                 <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] border border-white/20 dark:border-white/5 p-8 shadow-lg shadow-black/5 flex flex-wrap justify-center gap-4">
                                    {extendedProfile.social.twitter && <SocialPill icon={Twitter} label="Twitter" value={`@${extendedProfile.social.twitter}`} url={`https://twitter.com/${extendedProfile.social.twitter}`} />}
                                    {extendedProfile.social.github && <SocialPill icon={Github} label="GitHub" value={extendedProfile.social.github} url={`https://github.com/${extendedProfile.social.github}`} />}
                                    {extendedProfile.social.linkedin && <SocialPill icon={Linkedin} label="LinkedIn" value="Profile" url={`https://linkedin.com/in/${extendedProfile.social.linkedin}`} />}
                                 </div>
                              </section>
                          )}

                          <div className="space-y-8 px-2">
                              <ContactActions {...contactActionsProps} mode="connection" />
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="max-w-2xl mx-auto space-y-8 profile-animate">
                            <ContactActions {...contactActionsProps} mode="privacy" />

                            {isMaximaContact && (
                                <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] border border-white/20 dark:border-white/5 p-10 shadow-lg shadow-black/5">
                                    <div className="flex items-center gap-4 mb-8">
                                        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center text-rose-500">
                                            <Trash2 size={22} />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-0.5">Maxima Link</span>
                                            <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Remove Contact</h3>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-500 font-medium mb-8 px-1 leading-relaxed opacity-70">
                                        Removing this identity will halt automatic folder synchronization. Conversation history is preserved locally.
                                    </p>
                                    <button
                                        onClick={() => setShowConfirmDelete(true)}
                                        disabled={removingContact}
                                        className="w-full px-6 py-5 rounded-[1.5rem] font-black text-[10px] sm:text-[11px] uppercase tracking-[0.1em] bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white border border-rose-500/20 flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50"
                                    >
                                        <Trash2 size={16} strokeWidth={3} />
                                        {removingContact ? "Removing..." : "Remove Maxima Contact"}
                                    </button>
                                </div>
                            )}

                            {isMaximaContact ? (
                                <ContactPrivacy
                                    isPersonalContact={isPersonalContact}
                                    togglingPersonal={togglingPersonal}
                                    onTogglePersonal={async () => {
                                        setTogglingPersonal(true);
                                        try {
                                            const success = await personalContactsService.togglePersonalContact(contact.publickey);
                                            if (success) setIsPersonalContact(!isPersonalContact);
                                        } finally { setTogglingPersonal(false); }
                                    }}
                                />
                            ) : (
                                <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[2.5rem] border border-dashed border-white/20 dark:border-white/5 p-10 text-center space-y-4 shadow-lg shadow-black/5">
                                    <div className="w-16 h-16 bg-gray-100 dark:bg-white/5 rounded-[1.75rem] flex items-center justify-center mx-auto text-gray-300">
                                       <Info size={30} />
                                    </div>
                                    <div className="space-y-2">
                                        <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400">Personal Status Locked</h4>
                                        <p className="text-xs font-medium text-gray-500 leading-relaxed px-8 opacity-70">
                                            Trusted Status (Level 3) requires an active Maxima contact relationship to enable automatic folder synchronization.
                                        </p>
                                    </div>
                                </div>
                            )}
                            
                            <div className="p-10 bg-amber-500/5 border border-amber-500/10 rounded-[2.75rem] space-y-6 shadow-xl shadow-amber-500/5">
                                <div className="flex items-center gap-4 text-amber-500">
                                   <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center">
                                      <ShieldAlert size={24} />
                                   </div>
                                   <h3 className="font-black uppercase tracking-widest text-sm">Security Advisory</h3>
                                </div>
                                <p className="text-sm font-medium text-amber-700/70 dark:text-amber-300/60 leading-relaxed">
                                   Established contacts via Maxima can track your base folder address changes automatically. Use "Personal Status" only for entities you've verified through out-of-band communication.
                                </p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'tech' && (
                        <div className="max-w-4xl mx-auto space-y-8 profile-animate">
                            <section className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] border border-white/20 dark:border-white/5 overflow-hidden shadow-lg shadow-black/5">
                                <div className="px-10 py-8 border-b border-white/10 dark:border-white/5 bg-black/5">
                                   <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-400 opacity-60 text-center">Protocol Identity Ledger</h3>
                                </div>
                                <div className="divide-y divide-gray-50 dark:divide-gray-800">
                                   <TechRow label="P2P Public Key" value={contact.publickey} onCopy={() => copyToClipboard(contact.publickey, 'tk1')} copied={copiedField === 'tk1'} />
                                   <TechRow label="Maxima Address" value={contact.currentaddress} onCopy={() => copyToClipboard(contact.currentaddress, 'tk2')} copied={copiedField === 'tk2'} />
                                   {contact.extradata?.minimaaddress && <TechRow label="Smart Address" value={contact.extradata.minimaaddress} onCopy={() => copyToClipboard(contact.extradata!.minimaaddress!, 'tk3')} copied={copiedField === 'tk3'} />}
                                   <TechRow label="Identity Beat" value={contact.lastseen ? new Date(contact.lastseen).toLocaleString() : 'Protocol Heartbeat Missing'} />
                                   <TechRow label="Chain State" value={contact.samechain ? 'Coherent Sync' : 'Divergent Sequence'} />
                                </div>
                            </section>

                            <div className="text-center opacity-40">
                               <p className="text-[9px] font-black uppercase tracking-[0.5em] text-gray-500">Immutable Cryptographic Identity</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ELITE DELETE MODAL */}
            {showConfirmDelete && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-gray-950/80 backdrop-blur-2xl animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-gray-900 rounded-[3rem] p-10 max-w-sm w-full shadow-[0_50px_100px_rgba(0,0,0,0.5)] border border-gray-100 dark:border-white/5 text-center space-y-8 animate-in zoom-in-95 curve-spring">
                        <div className="w-20 h-20 bg-rose-500 rounded-[2rem] text-white flex items-center justify-center mx-auto shadow-2xl shadow-rose-500/30 rotate-6 group-hover:rotate-0 transition-transform">
                            <Trash2 size={40} strokeWidth={2.5} />
                        </div>
                        <div className="space-y-3">
                             <h3 className="text-2xl font-black text-gray-900 dark:text-white tracking-tighter uppercase leading-none">Sever Connection?</h3>
                             <p className="text-xs font-medium text-gray-500 leading-relaxed px-4 opacity-70">
                                Removing this identity from your contacts will halt automatic synchronization. Conversation history is preserved locally.
                             </p>
                        </div>
                        <div className="flex flex-col gap-3">
                            <button onClick={async () => { setRemovingContact(true); await minimaService.runSQL(`DELETE FROM MAXIMA_CONTACT_REQUESTS WHERE (UPPER(from_publickey)=UPPER('${contact.publickey}') OR UPPER(to_publickey)=UPPER('${contact.publickey}'))`); setShowConfirmDelete(false); setRemovingContact(false); setIsMaximaContact(false); }} className="w-full py-5 bg-rose-500 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-xl shadow-rose-500/30 active:scale-95 transition-all">Confirm Removal</button>
                            <button onClick={() => setShowConfirmDelete(false)} className="w-full py-5 bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest active:scale-95 transition-all">Keep Identity</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

function ProfileAttribute({ icon: Icon, label, value, color }: any) {
  const colors: any = {
    primary: "text-primary-500 bg-primary-500/10",
    emerald: "text-emerald-500 bg-emerald-500/10",
    rose: "text-rose-500 bg-rose-500/10",
  };
  return (
    <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md p-6 rounded-[2.5rem] border border-white/20 dark:border-white/5 flex flex-col gap-3 group hover:border-primary-500/20 transition-all shadow-lg shadow-black/5">
      <div
        className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 ${colors[color]}`}
      >
        <Icon size={20} />
      </div>
      <div>
        <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-0.5">
          {label}
        </span>
        <span className="text-sm font-black text-gray-900 dark:text-gray-100 truncate block uppercase tracking-tight">
          {value}
        </span>
      </div>
    </div>
  );
}

function SocialPill({ icon: Icon, label, value, url }: any) {
    return (
        <a href={url} target="_blank" className="flex items-center gap-3 px-5 py-2.5 bg-gray-100 dark:bg-white/5 rounded-full border border-transparent hover:border-primary-500/20 hover:bg-white dark:hover:bg-gray-900 transition-all group">
            <Icon size={14} className="text-gray-500 group-hover:text-primary-500 transition-colors" />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors">{label}</span>
            <span className="text-[10px] font-mono text-gray-400/60">{value}</span>
        </a>
    );
}

function TechRow({ label, value, onCopy, copied }: any) {
    return (
        <div className="px-8 py-5 flex items-center justify-between group hover:bg-gray-50 dark:hover:bg-white/5 transition-all">
            <div className="min-w-0 pr-4">
                <span className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">{label}</span>
                <p className="text-[10px] font-mono text-gray-900 dark:text-gray-100 truncate break-all opacity-80">{value}</p>
            </div>
            {onCopy && (
                <button onClick={onCopy} className="p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-400 hover:text-primary-500 hover:border-primary-500/30 transition-all opacity-0 group-hover:opacity-100">
                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
            )}
        </div>
    );
}

export default ContactInfoPage;
