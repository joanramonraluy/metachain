import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useContext, useEffect, useState, useRef } from "react";
import { MDS } from "@minima-global/mds";
import { ArrowLeft, Copy, Check, RefreshCw, MapPin, Globe, Mail, Phone, Twitter, Linkedin, Github, UserCheck, UserPlus } from "lucide-react";
import { minimaService } from "../services/minima.service";
import { requestProfile, ExtendedProfile } from "../services/profile.service";
import { personalContactsService } from "../services/personal-contacts.service";
import { appContext } from "../AppContext";

// Define search params validation
interface ContactInfoSearch {
    returnTo?: string;
}

export const Route = createFileRoute("/contact-info/$address")({
    validateSearch: (search: Record<string, unknown>): ContactInfoSearch => {
        return {
            returnTo: search.returnTo as string | undefined,
        };
    },
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
    const [appStatus, setAppStatus] = useState<'unknown' | 'checking' | 'installed' | 'not_found'>('unknown');

    // Extended profile state
    const [extendedProfile, setExtendedProfile] = useState<ExtendedProfile | null>(null);
    const [profileLoaded, setProfileLoaded] = useState(false); // Track if profile has been loaded at least once
    const [profileError, setProfileError] = useState<string | null>(null);

    // UI state
    const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

    // Chat permission state
    const [userAllowsNonContactChats, setUserAllowsNonContactChats] = useState(true); // Default: assume open

    // Personal contact state
    const [isPersonalContact, setIsPersonalContact] = useState(false);
    const [togglingPersonal, setTogglingPersonal] = useState(false);

    // Contact source state
    const [isMaximaContact, setIsMaximaContact] = useState(false);

    // Remove contact state
    const [removingContact, setRemovingContact] = useState(false);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);


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
                console.warn("⚠️ [AVATAR] Error decoding:", err);
            }
        }
        return defaultAvatar;
    };

    const fetchContact = async () => {
        try {
            // First, try to find in contacts
            const res = await MDS.cmd.maxcontacts();
            const list: Contact[] = (res as any)?.response?.contacts || [];
            const c = list.find(
                (x) =>
                    x.publickey === address ||
                    x.currentaddress === address ||
                    x.extradata?.minimaaddress === address
            );

            if (c) {
                console.log("✅ [CONTACT] Found in Maxima:", c);
                setContact(c);
                setIsMaximaContact(true);
            } else {
                console.log("🔍 [CONTACT] Not in Maxima, checking Discovery...");

                // Try to find in discovered peers (P2P Discovery)
                // Note: Column names are lowercase in database schema
                const sql = `SELECT * FROM DISCOVERED_PEERS WHERE publickey='${address}'`;
                const discoveryRes = await MDS.sql(sql);

                if (discoveryRes.status && discoveryRes.rows && discoveryRes.rows.length > 0) {
                    const peer = discoveryRes.rows[0];
                    console.log("✅ [CONTACT] Found in Discovery:", peer);

                    // Convert discovered peer to Contact format
                    // H2 database returns column names in UPPERCASE
                    const discoveredContact: Contact = {
                        publickey: peer.PUBLICKEY,
                        currentaddress: peer.ADDRESS,  // Use Maxima address, not publickey
                        extradata: {
                            name: peer.ALIAS || "Unknown",
                            description: peer.BIO || "",
                            icon: "" // Avatar not stored in DISCOVERED_PEERS yet
                        },
                        lastseen: peer.LAST_SEEN ? Number(peer.LAST_SEEN) : undefined
                    };

                    setContact(discoveredContact);
                    setIsMaximaContact(false);
                } else {
                    console.warn("⚠️ [CONTACT] Not found in Discovery either");
                }
            }
        } catch (err) {
            console.error("❌ [CONTACT] Error loading:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchContact();
    }, [address]);

    // Load personal contact status
    useEffect(() => {
        const loadPersonalStatus = async () => {
            if (!contact?.publickey) return;
            const isPersonal = await personalContactsService.isPersonalContact(contact.publickey);
            setIsPersonalContact(isPersonal);
        };
        loadPersonalStatus();
    }, [contact]);



    // Check app status when contact is loaded
    useEffect(() => {
        const pubkey = contact?.publickey;
        if (!pubkey) return;

        const checkAppStatus = () => {
            console.log("🔄 [PING] Checking app status...");
            setAppStatus('checking');
            minimaService.sendPing(pubkey).catch(console.error);

            // Timeout for check
            setTimeout(() => {
                setAppStatus((prev) => prev === 'checking' ? 'not_found' : prev);
            }, 5000);
        };

        const handleNewMessage = (payload: any) => {
            if (payload.type === 'pong') {
                console.log("✅ [PONG] Received - app installed");
                setAppStatus('installed');
                minimaService.setAppInstalled(pubkey);
            }
        };

        // Initial check
        checkAppStatus();

        // Listen for pong responses
        minimaService.onNewMessage(handleNewMessage);

        return () => {
            minimaService.removeNewMessageCallback(handleNewMessage);
        };
    }, [contact]);

    // Ref to track if profile request has been initiated
    const profileRequestedRef = useRef(false);

    // Reset state when address changes
    useEffect(() => {
        setExtendedProfile(null);
        setProfileLoaded(false);
        setProfileError(null);
        profileRequestedRef.current = false;
        // User allows non-contact chats probably needs reset too if it depends on profile
        // setUserAllowsNonContactChats(false); // Or undef/default - wait, this is state?
    }, [address]);

    // Auto-request extended profile when contact loads
    useEffect(() => {
        if (!contact?.currentaddress || !contact?.publickey) return;

        // Don't request if already loaded or already requested (for THIS contact)
        if (extendedProfile || profileRequestedRef.current) return;

        // Mark as requested
        profileRequestedRef.current = true;

        // Auto-request profile
        handleRequestProfile();
    }, [contact, address]); // Added address dependency to be safe

    const copyToClipboard = (text: string, fieldId: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(fieldId);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const handleRequestProfile = async () => {
        if (!contact?.currentaddress || !contact?.publickey) {
            setProfileError('Contact address or publickey not available');
            return;
        }

        setProfileError(null);

        try {
            console.log("🔄 [PROFILE] Requesting extended profile...");
            // Use Maxima address for sending, publickey for response matching
            const profile = await requestProfile(contact.currentaddress, contact.publickey);
            setExtendedProfile(profile);

            // Extract chat permission setting
            if (profile.allowNonContactChats !== undefined) {
                setUserAllowsNonContactChats(profile.allowNonContactChats);
                console.log("ℹ️ [PROFILE] Chat permission:", profile.allowNonContactChats);
            }

            setProfileLoaded(true); // Mark profile as loaded
            console.log("✅ [PROFILE] Extended profile received:", profile);
        } catch (err) {
            console.error("❌ [PROFILE] Failed to request:", err);
            setProfileError(err instanceof Error ? err.message : 'Failed to load profile');
            // On error, enable buttons via timeout
        }
    };

    // Add contact state
    const [addingContact, setAddingContact] = useState(false);
    const [requestStatus, setRequestStatus] = useState<'none' | 'pending' | 'accepted'>('none');
    const [hasChatHistory, setHasChatHistory] = useState(false);

    // Check for existing requests and chat history on load
    useEffect(() => {
        if (!contact?.publickey) return;

        const checkStatus = async () => {
            try {
                // 1. Check for request status
                const requestSql = `SELECT * FROM CHAT_MESSAGES WHERE publickey='${contact.publickey}' AND (message='Contact request sent' OR message='Contact request accepted') ORDER BY date DESC LIMIT 1`;
                const requestRes = await minimaService.runSQL(requestSql);
                if (requestRes && requestRes.rows && requestRes.rows.length > 0) {
                    const msg = requestRes.rows[0].MESSAGE;
                    if (msg === 'Contact request accepted') {
                        setRequestStatus('accepted');
                    } else if (msg === 'Contact request sent') {
                        setRequestStatus('pending');
                    }
                }

                // 2. Check for ANY chat history (to enable chat if we already talked)
                const historySql = `SELECT * FROM CHAT_MESSAGES WHERE publickey='${contact.publickey}' LIMIT 1`;
                const historyRes = await minimaService.runSQL(historySql);
                if (historyRes && historyRes.rows && historyRes.rows.length > 0) {
                    setHasChatHistory(true);
                }

            } catch (err) {
                console.error("❌ [CONTACT] Error checking status:", err);
            }
        };

        checkStatus();
    }, [contact]);

    const handleSendContactRequest = async () => {
        if (!contact?.currentaddress) {
            alert("Cannot send request: No Maxima address available");
            return;
        }
        setAddingContact(true);
        try {
            await minimaService.sendContactRequest(contact.currentaddress, userName || "Unknown", userAvatar || "");
            setRequestStatus('pending'); // Optimistic update

            // Navigate to chat
            navigate({
                to: "/chat/$address",
                params: { address: contact.publickey },
                search: { requestPending: true }
            });
        } catch (err: any) {
            console.error("❌ [CONTACT] Exception sending request:", err);
            alert(`Error sending contact request: ${err.message || err}`);
        } finally {
            setAddingContact(false);
        }
    };

    const handleRemoveContact = () => {
        if (!contact?.publickey) return;
        setShowConfirmDelete(true);
    };

    const executeRemoveContact = async () => {
        if (!contact?.publickey) return;

        setShowConfirmDelete(false);
        setRemovingContact(true);
        console.log("🗑️ [CONTACT] Starting removal...");

        try {
            console.log("🗑️ [CONTACT] Calling Maxima remove...");

            // Call Maxima to remove contact
            // Prefer ID if available, otherwise try publickey as contact
            const params: any = {
                action: "remove"
            };

            if (contact.id) {
                params.id = contact.id;
            } else {
                params.publickey = contact.publickey;
            }

            const response = await MDS.cmd.maxcontacts(params);

            console.log("🗑️ [CONTACT] Response received:", response);

            if (response.status) {
                console.log("✅ [CONTACT] Removed successfully");
                // Navigate back to contacts list
                navigate({ to: "/" });
            } else {
                console.error("❌ [CONTACT] Failed to remove:", response.error);
                alert(`Failed to remove contact: ${response.error || 'Unknown error'}`);
            }
        } catch (err) {
            console.error("❌ [CONTACT] Error removing:", err);
            alert(`Error removing contact: ${err}`);
        } finally {
            setRemovingContact(false);
            console.log("🗑️ [CONTACT] Removal finished");
        }
    };

    if (loading) {
        return (
            <div className="h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    if (!contact) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
                <p className="text-gray-500 mb-4">Contact not found</p>
                <button
                    onClick={() => navigate({ to: "/" })}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg"
                >
                    Go Back
                </button>

                {/* Custom Confirmation Modal removed from here */}
            </div>
        );
    }

    // Get display data from contact
    const displayName = contact?.extradata?.name || "Unknown";
    const displayPubkey = contact?.publickey || "";
    const displayLastSeen = contact?.lastseen;

    return (
        <div className="h-full overflow-y-auto bg-gray-50">
            {/* Header */}
            <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm sticky top-0 z-10">
                <button
                    onClick={() => {
                        if (search.returnTo) {
                            navigate({ to: search.returnTo });
                        } else {
                            navigate({ to: '/' });
                        }
                    }}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600"
                >
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-lg font-semibold text-gray-800">Contact Info</h1>
            </div>

            <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">

                {/* Profile Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="h-32 bg-gradient-to-r from-blue-400 to-blue-600"></div>
                    <div className="px-6 pb-6 relative">
                        <div className="absolute -top-16 left-6">
                            <img
                                src={getAvatar(contact)}
                                alt="Avatar"
                                className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-md bg-white"
                            />
                        </div>
                        <div className="pt-20">
                            <h2 className="text-2xl font-bold text-gray-900">{displayName}</h2>
                            <p className="text-gray-500 text-sm mt-1">Minima User</p>
                        </div>
                    </div>

                    {/* Network Status - Now shows App Status */}
                    <div className="p-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-500">MetaChain Status</span>
                            {appStatus === 'not_found' && (
                                <button
                                    onClick={() => {
                                        const pubkey = contact?.publickey;
                                        setAppStatus('checking');
                                        if (pubkey) {
                                            minimaService.sendPing(pubkey).catch(console.error);
                                            setTimeout(() => {
                                                setAppStatus((prev) => prev === 'checking' ? 'not_found' : prev);
                                            }, 5000);
                                        }
                                    }}
                                    className="text-blue-600 hover:text-blue-700 transition-colors p-1"
                                    title="Retry"
                                >
                                    <RefreshCw size={16} />
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                            {appStatus === 'installed' ? (
                                <div className="flex items-center gap-2 text-green-600">
                                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                    <span className="text-sm font-medium">MetaChain Verified</span>
                                </div>
                            ) : appStatus === 'checking' ? (
                                <div className="flex items-center gap-2 text-blue-600">
                                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-600 border-t-transparent"></div>
                                    <span className="text-sm font-medium">Checking status...</span>
                                </div>
                            ) : appStatus === 'not_found' ? (
                                <div className="flex items-center gap-2 text-red-600">
                                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                                    <span className="text-sm font-medium">App not detected</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-gray-400">
                                    <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                                    <span className="text-sm font-medium">Unknown</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Last Seen */}
                    {displayLastSeen && (
                        <div className="p-4 hover:bg-gray-50 transition-colors group">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-500">Last Seen</span>
                            </div>
                            <p className="text-sm text-gray-800">{new Date(displayLastSeen).toLocaleString()}</p>
                        </div>
                    )}
                </div>

                {/* Extended Profile Section - MOVED UP for priority */}
                {/* Profile is requested automatically - just show loading/error/data */}

                {!profileLoaded && !profileError && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
                        <p className="text-gray-600">Requesting profile...</p>
                    </div>
                )}

                {profileError && (
                    <div className="bg-white rounded-xl shadow-sm border border-red-100 p-6 text-center">
                        <p className="text-red-600 mb-3">{profileError}</p>
                        <button
                            onClick={handleRequestProfile}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {extendedProfile && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Extended Profile</h3>
                        </div>

                        <div className="divide-y divide-gray-100">
                            {/* Bio */}
                            {extendedProfile.bio && (
                                <div className="p-4">
                                    <span className="text-sm font-medium text-gray-500">Bio</span>
                                    <p className="text-sm text-gray-800 mt-1">{extendedProfile.bio}</p>
                                </div>
                            )}

                            {/* Level 2 - Semi-Private */}
                            {(extendedProfile.location || extendedProfile.website || extendedProfile.social) && (
                                <>
                                    <div className="p-4 bg-purple-50/50">
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full">Level 2</span>
                                            <span className="text-xs text-purple-600">Semi-Private Information</span>
                                        </div>
                                    </div>

                                    {extendedProfile.location && (
                                        <div className="p-4 hover:bg-gray-50 transition-colors">
                                            <div className="flex items-center gap-2 mb-1">
                                                <MapPin size={16} className="text-gray-400" />
                                                <span className="text-sm font-medium text-gray-500">Location</span>
                                            </div>
                                            <p className="text-sm text-gray-800">{extendedProfile.location}</p>
                                        </div>
                                    )}

                                    {extendedProfile.website && (
                                        <div className="p-4 hover:bg-gray-50 transition-colors">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Globe size={16} className="text-gray-400" />
                                                <span className="text-sm font-medium text-gray-500">Website</span>
                                            </div>
                                            <a
                                                href={extendedProfile.website}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-sm text-blue-600 hover:underline"
                                            >
                                                {extendedProfile.website}
                                            </a>
                                        </div>
                                    )}

                                    {extendedProfile.social && (
                                        <div className="p-4 hover:bg-gray-50 transition-colors">
                                            <span className="text-sm font-medium text-gray-500 block mb-2">Social Links</span>
                                            <div className="space-y-2">
                                                {extendedProfile.social.twitter && (
                                                    <a
                                                        href={`https://twitter.com/${extendedProfile.social.twitter}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                                                    >
                                                        <Twitter size={16} />
                                                        @{extendedProfile.social.twitter}
                                                    </a>
                                                )}
                                                {extendedProfile.social.linkedin && (
                                                    <a
                                                        href={`https://linkedin.com/in/${extendedProfile.social.linkedin}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                                                    >
                                                        <Linkedin size={16} />
                                                        {extendedProfile.social.linkedin}
                                                    </a>
                                                )}
                                                {extendedProfile.social.github && (
                                                    <a
                                                        href={`https://github.com/${extendedProfile.social.github}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                                                    >
                                                        <Github size={16} />
                                                        {extendedProfile.social.github}
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Level 3 - Private */}
                            {(extendedProfile.email || extendedProfile.phone) && (
                                <>
                                    <div className="p-4 bg-amber-50/50">
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">Level 3</span>
                                            <span className="text-xs text-amber-600">Private Information</span>
                                        </div>
                                    </div>

                                    {extendedProfile.email && (
                                        <div className="p-4 hover:bg-gray-50 transition-colors">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Mail size={16} className="text-gray-400" />
                                                <span className="text-sm font-medium text-gray-500">Email</span>
                                            </div>
                                            <a href={`mailto:${extendedProfile.email}`} className="text-sm text-blue-600 hover:underline">
                                                {extendedProfile.email}
                                            </a>
                                        </div>
                                    )}

                                    {extendedProfile.phone && (
                                        <div className="p-4 hover:bg-gray-50 transition-colors">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Phone size={16} className="text-gray-400" />
                                                <span className="text-sm font-medium text-gray-500">Phone</span>
                                            </div>
                                            <a href={`tel:${extendedProfile.phone}`} className="text-sm text-blue-600 hover:underline">
                                                {extendedProfile.phone}
                                            </a>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Contact Actions / Settings */}
                {/* Only show if we have public key AND profile is loaded */}
                {/* Contact Actions / Settings */}
                {/* Only show if we have public key AND profile is loaded */}
                {contact?.publickey && profileLoaded && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Contact Settings</h3>
                        </div>
                        <div className="p-4">
                            {!isMaximaContact ? (
                                /* Show different actions based on user's chat permissions */
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <UserPlus size={18} className="text-blue-600" />
                                        <span className="text-sm font-medium text-gray-900">Actions</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mb-3">
                                        {userAllowsNonContactChats
                                            ? "This user accepts messages from anyone."
                                            : "This user only accepts chats from contacts. Send a contact request first."}
                                    </p>

                                    {/* Consolidated Action Logic */}
                                    {(userAllowsNonContactChats || requestStatus === 'accepted' || hasChatHistory) ? (
                                        /* Case 1: Chat is Enabled (Open or Accepted or History) */
                                        <>
                                            <button
                                                onClick={() => {
                                                    if (!contact?.publickey) return;
                                                    navigate({ to: "/chat/$address", params: { address: contact.publickey } });
                                                }}
                                                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2"
                                            >
                                                <span className="transform rotate-[-45deg]">➤</span>
                                                Send Message
                                            </button>

                                            {/* Secondary Status / Actions */}
                                            {requestStatus === 'accepted' ? (
                                                <button
                                                    disabled={true}
                                                    className="w-full px-4 py-2 bg-green-50 text-green-600 border border-green-200 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                                >
                                                    <UserCheck size={18} />
                                                    Request Accepted
                                                </button>
                                            ) : requestStatus === 'pending' ? (
                                                <button
                                                    disabled={true}
                                                    className="w-full px-4 py-2 bg-yellow-50 text-yellow-600 border border-yellow-200 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                                >
                                                    <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                                    Request Pending
                                                </button>
                                            ) : (
                                                /* If open to chats but not a contact/request, show Add option if not already added */
                                                <button
                                                    onClick={handleSendContactRequest}
                                                    disabled={addingContact} // Enabled on error
                                                    className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium flex items-center justify-center gap-2"
                                                >
                                                    <UserPlus size={18} />
                                                    {addingContact ? "Sending..." : "Add to Contacts"}
                                                </button>
                                            )}
                                        </>
                                    ) : (
                                        /* Case 2: Chat is Closed/Restricted AND No History/Acceptance */
                                        <>
                                            {requestStatus === 'pending' ? (
                                                <button
                                                    disabled={true}
                                                    className="w-full px-4 py-2 bg-yellow-50 text-yellow-600 border border-yellow-200 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                                >
                                                    <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                                    Request Pending
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={handleSendContactRequest}
                                                        disabled={addingContact} // Enabled on error
                                                        className={`w-full px-4 py-2 rounded-lg transition-colors font-medium flex items-center justify-center gap-2 ${addingContact
                                                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                            : 'bg-blue-600 text-white hover:bg-blue-700'
                                                            }`}
                                                    >
                                                        <UserPlus size={18} />
                                                        {addingContact ? "Sending..." : "Send Contact Request"}
                                                    </button>
                                                </>
                                            )}

                                            {/* Disabled Message Indicator */}
                                            <button
                                                disabled={true}
                                                className="w-full px-4 py-2 mt-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors bg-gray-200 text-gray-400 cursor-not-allowed"
                                                title="This user only accepts chats from contacts"
                                            >
                                                <span className="transform rotate-[-45deg]">➤</span>
                                                Send Message (Disabled)
                                            </button>
                                        </>
                                    )}
                                </div>
                            ) : (
                                /* Show Personal Contact toggle and Remove button for Maxima contacts */
                                <>
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <UserCheck size={18} className="text-blue-600" />
                                                <span className="text-sm font-medium text-gray-900">Personal Contact</span>
                                            </div>
                                            <p className="text-xs text-gray-500">
                                                Personal contacts can see your private information (Level 3)
                                            </p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                if (!contact?.publickey) return;
                                                setTogglingPersonal(true);
                                                try {
                                                    const success = await personalContactsService.togglePersonalContact(contact.publickey);
                                                    if (success) {
                                                        setIsPersonalContact(!isPersonalContact);
                                                    }
                                                } catch (err) {
                                                    console.error('[ContactInfo] Error toggling personal contact:', err);
                                                } finally {
                                                    setTogglingPersonal(false);
                                                }
                                            }}
                                            disabled={togglingPersonal}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${isPersonalContact ? 'bg-blue-600' : 'bg-gray-200'
                                                }`}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isPersonalContact ? 'translate-x-6' : 'translate-x-1'
                                                    }`}
                                            />
                                        </button>
                                    </div>

                                    {/* Remove Contact Button */}
                                    <div className="mt-4 pt-4 border-t border-gray-100">
                                        <button
                                            onClick={handleRemoveContact}
                                            disabled={removingContact}
                                            className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed transition-colors font-medium"
                                        >
                                            {removingContact ? "Removing..." : "Remove Contact"}
                                        </button>
                                        <p className="text-xs text-gray-500 mt-2 text-center">
                                            Chat history will be preserved
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Technical Details - Collapsible section at the end */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <button
                        onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Technical Details</h3>
                        <span className="text-gray-400">{showTechnicalDetails ? '▼' : '▶'}</span>
                    </button>

                    {showTechnicalDetails && (
                        <div className="divide-y divide-gray-100 border-t border-gray-100">
                            {/* Public Key */}
                            {displayPubkey && (
                                <div className="p-4 hover:bg-gray-50 transition-colors group">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-medium text-gray-500">Public Key</span>
                                        <button
                                            onClick={() => copyToClipboard(displayPubkey, 'pubkey')}
                                            className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-blue-50 rounded"
                                            title="Copy"
                                        >
                                            {copiedField === 'pubkey' ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                    </div>
                                    <p className="text-sm font-mono text-gray-800 break-all">{displayPubkey}</p>
                                </div>
                            )}

                            {/* Minima Address */}
                            {contact?.extradata?.minimaaddress && (
                                <div className="p-4 hover:bg-gray-50 transition-colors group">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-medium text-gray-500">Minima Address</span>
                                        <button
                                            onClick={() => copyToClipboard(contact.extradata?.minimaaddress || "", 'minima')}
                                            className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-blue-50 rounded"
                                            title="Copy"
                                        >
                                            {copiedField === 'minima' ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                    </div>
                                    <p className="text-sm font-mono text-gray-800 break-all">{contact.extradata.minimaaddress}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

            </div>

            {/* Custom Confirmation Modal */}
            {showConfirmDelete && contact && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
                        <h3 className="text-xl font-bold text-gray-900 mb-4">Remove Contact?</h3>
                        <p className="text-gray-600 mb-6">
                            Are you sure you want to remove <span className="font-semibold">{contact.extradata?.name || 'this contact'}</span>?
                            <br /><br />
                            The chat history will be preserved, but they will be removed from your contact list.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowConfirmDelete(false)}
                                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeRemoveContact}
                                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg font-medium transition-colors flex items-center gap-2"
                            >
                                {removingContact ? (
                                    <>
                                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Removing...
                                    </>
                                ) : (
                                    "Yes, Remove"
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div >
    );
}
