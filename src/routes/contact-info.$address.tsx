import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MDS } from "@minima-global/mds";
import { ArrowLeft, Copy, Check, RefreshCw, UserPlus, Globe, MapPin } from "lucide-react";
import { minimaService } from "../services/minima.service";
import { DiscoveryService, UserProfile } from "../services/discovery.service";

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
    const [contact, setContact] = useState<Contact | null>(null);
    const [discoveryProfile, setDiscoveryProfile] = useState<UserProfile | null>(null);
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [appStatus, setAppStatus] = useState<'unknown' | 'checking' | 'installed' | 'not_found'>('unknown');

    const [isContact, setIsContact] = useState(false);
    const [addingContact, setAddingContact] = useState(false);

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

    useEffect(() => {
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
                    console.log("[ContactInfo] Contact found:", c);
                    setContact(c);
                    setIsContact(true);
                }

                // Always check Community Discovery to get extended info
                console.log("[ContactInfo] Checking Community Discovery...");
                const profiles = await DiscoveryService.getProfiles();
                let profile = profiles.find(
                    (p) => p.maxAddress === address || p.pubkey === address || (c && p.pubkey === c.publickey)
                );

                // Check local DB for extended profile data
                const pubkeyToCheck = profile?.pubkey || c?.publickey;
                if (pubkeyToCheck) {
                    console.log("[ContactInfo] Checking local DB for extended data...");
                    const localData = await new Promise<any>((resolve) => {
                        MDS.sql(`SELECT * FROM PROFILES WHERE pubkey = '${pubkeyToCheck}'`, (sqlRes: any) => {
                            if (sqlRes.status && sqlRes.rows && sqlRes.rows.length > 0) {
                                console.log("[ContactInfo] ✅ Found extended data in local DB");
                                resolve(sqlRes.rows[0]);
                            } else {
                                resolve(null);
                            }
                        });
                    });

                    if (localData) {
                        if (profile) {
                            // Merge local data with Discovery profile
                            profile = {
                                ...profile,
                                extraData: {
                                    location: localData.LOCATION || profile.extraData?.location,
                                    website: localData.WEBSITE || profile.extraData?.website,
                                    bio: localData.BIO || profile.extraData?.bio
                                }
                            };
                        } else if (c) {
                            // Create profile from contact + local data
                            profile = {
                                username: c.extradata?.name || 'Unknown',
                                pubkey: c.publickey,
                                description: c.extradata?.description || '',
                                timestamp: 0,
                                lastSeen: c.lastseen || 0,
                                isMyProfile: false,
                                extraData: {
                                    location: localData.LOCATION,
                                    website: localData.WEBSITE,
                                    bio: localData.BIO
                                }
                            };
                        }
                    }
                }


                if (profile) {
                    console.log("[ContactInfo] ✅ Found in Community Discovery:", profile);
                    setDiscoveryProfile(profile);
                    // If we didn't find it in contacts but found it here, update isContact
                    if (!c) setIsContact(false);
                } else {
                    console.log("[ContactInfo] ❌ Not found in Community Discovery");
                    if (!c) console.log("[ContactInfo] ❌ Not found anywhere");
                }
            } catch (err) {
                console.error("[Contact] Error loading contact:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchContact();
    }, [address]);



    // Check app status when contact is loaded
    useEffect(() => {
        const pubkey = contact?.publickey || discoveryProfile?.pubkey;
        if (!pubkey) return;

        const checkAppStatus = () => {
            console.log("🔄 [ContactInfo] Checking app status...");
            setAppStatus('checking');
            minimaService.sendPing(pubkey).catch(console.error);

            // Timeout for check
            setTimeout(() => {
                setAppStatus((prev) => prev === 'checking' ? 'not_found' : prev);
            }, 5000);
        };

        const handleNewMessage = (payload: any) => {
            if (payload.type === 'pong') {
                console.log("✅ [ContactInfo] Pong received - app is installed");
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
    }, [contact, discoveryProfile]);

    const copyToClipboard = (text: string, fieldId: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(fieldId);
        setTimeout(() => setCopiedField(null), 2000);
    };



    const handleAddContact = async () => {
        if (!discoveryProfile) return;
        setAddingContact(true);
        try {
            await new Promise((resolve, reject) => {
                MDS.cmd.maxcontacts({
                    params: {
                        action: "add",
                        contact: discoveryProfile.maxAddress || discoveryProfile.pubkey
                    } as any
                }, (res: any) => {
                    if (res.status) resolve(res);
                    else reject(res.error);
                });
            });

            // Refresh contact status
            setIsContact(true);
            // Re-fetch to get the contact object
            const res = await MDS.cmd.maxcontacts();
            const list: Contact[] = (res as any)?.response?.contacts || [];
            const c = list.find(x => x.publickey === discoveryProfile.pubkey);
            if (c) setContact(c);

            console.log("✅ Contact added successfully");
        } catch (err) {
            console.error("❌ Failed to add contact:", err);
            alert("Failed to add contact. Please try again.");
        } finally {
            setAddingContact(false);
        }
    };





    if (loading) {
        return (
            <div className="h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    if (!contact && !discoveryProfile) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
                <p className="text-gray-500 mb-4">Profile not found</p>
                <button
                    onClick={() => navigate({ to: "/discovery" })}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg"
                >
                    Go to Discovery
                </button>
            </div>
        );
    }

    // Get display data from either contact or discovery profile
    const displayName = contact?.extradata?.name || discoveryProfile?.username || "Unknown";
    const displayPubkey = contact?.publickey || discoveryProfile?.pubkey || "";
    const displayLastSeen = contact?.lastseen || (discoveryProfile ? Number(discoveryProfile.lastSeen) * 1000 : undefined);

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
                            <p className="text-gray-500 text-sm mt-1">
                                {discoveryProfile?.isMyProfile ? "You" : "Minima User"}
                                {!isContact && !discoveryProfile?.isMyProfile && (
                                    <span className="ml-2 text-blue-600 text-xs font-medium">• From Community</span>
                                )}
                            </p>
                        </div>
                    </div>

                    {/* Network Status - Now shows App Status */}
                    <div className="p-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-500">CharmChain Status</span>
                            {appStatus === 'not_found' && (
                                <button
                                    onClick={() => {
                                        const pubkey = contact?.publickey || discoveryProfile?.pubkey;
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
                                    <span className="text-sm font-medium">CharmChain Verified</span>
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

                {/* About Section - Only show if description exists */}
                {(contact?.extradata?.description || discoveryProfile?.description) && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">About</h3>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-gray-700 leading-relaxed">
                                {contact?.extradata?.description || discoveryProfile?.description}
                            </p>
                        </div>
                    </div>
                )}

                {/* Extended Profile Info (Location, Website, Bio) */}
                {discoveryProfile?.extraData && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Extended Profile</h3>
                        </div>
                        <div className="divide-y divide-gray-100">
                            {discoveryProfile.extraData.location && (
                                <div className="p-4 flex items-start gap-3">
                                    <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
                                    <div>
                                        <span className="text-xs font-medium text-gray-500 block mb-0.5">Location</span>
                                        <span className="text-sm text-gray-800">{discoveryProfile.extraData.location}</span>
                                    </div>
                                </div>
                            )}
                            {discoveryProfile.extraData.website && (
                                <div className="p-4 flex items-start gap-3">
                                    <Globe className="w-5 h-5 text-gray-400 mt-0.5" />
                                    <div>
                                        <span className="text-xs font-medium text-gray-500 block mb-0.5">Website</span>
                                        <a
                                            href={discoveryProfile.extraData.website.startsWith('http') ? discoveryProfile.extraData.website : `https://${discoveryProfile.extraData.website}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm text-blue-600 hover:underline break-all"
                                        >
                                            {discoveryProfile.extraData.website}
                                        </a>
                                    </div>
                                </div>
                            )}
                            {discoveryProfile.extraData.bio && (
                                <div className="p-4">
                                    <span className="text-xs font-medium text-gray-500 block mb-2">Bio</span>
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{discoveryProfile.extraData.bio}</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Info Section */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Details</h3>
                    </div>

                    <div className="divide-y divide-gray-100">
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
                </div>

                {/* Actions Section */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Actions</h3>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {/* Add Contact Button - Only if not a contact and not my profile */}
                        {!isContact && !discoveryProfile?.isMyProfile && (
                            <button
                                onClick={handleAddContact}
                                disabled={addingContact}
                                className="w-full p-4 text-left flex items-center gap-3 text-blue-600 hover:bg-blue-50 transition-colors"
                            >
                                {addingContact ? (
                                    <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <UserPlus size={20} />
                                )}
                                <span className="font-medium">Add to Contacts</span>
                            </button>
                        )}




                    </div>
                </div>

            </div>


        </div>
    );
}
