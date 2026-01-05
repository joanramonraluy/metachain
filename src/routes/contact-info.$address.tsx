import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import ContactActions from "../components/contact/ContactActions";
import ContactPrivacy from "../components/contact/ContactPrivacy";
import { ContactTabs, ContactTab } from "../components/contact/ContactTabs";
import { MDS } from "@minima-global/mds";
import { ArrowLeft, Copy, Check, MapPin, Globe, Mail, Phone, Twitter, Linkedin, Github, UserCheck } from "lucide-react";
import { minimaService } from "../services/minima.service";
import { requestProfile, ExtendedProfile } from "../services/profile.service";
import { personalContactsService } from "../services/personal-contacts.service";
import { appContext } from "../AppContext";

import { safeUrl } from "../utils/sanitization";

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

    // const [appStatus, setAppStatus] = useState<'unknown' | 'checking' | 'installed' | 'not_found'>('unknown'); // Unused in new design

    // Extended profile state
    const [extendedProfile, setExtendedProfile] = useState<ExtendedProfile | null>(null);
    const [profileLoaded, setProfileLoaded] = useState(false); // Track if profile has been loaded at least once
    const [profileError, setProfileError] = useState<string | null>(null);

    // UI state


    // Chat permission state
    const [userAllowsNonContactChats, setUserAllowsNonContactChats] = useState(true); // Default: assume open

    // Personal contact state
    const [isPersonalContact, setIsPersonalContact] = useState(false);
    const [togglingPersonal, setTogglingPersonal] = useState(false);

    // Contact source state
    const [isMaximaContact, setIsMaximaContact] = useState(false);
    const [removingContact, setRemovingContact] = useState(false);

    // Tab State
    const [activeTab, setActiveTab] = useState<ContactTab>('profile');
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

                // ALSO fetch bio from DISCOVERED_PEERS for P2P bio data
                try {
                    const bioSql = `SELECT bio FROM DISCOVERED_PEERS WHERE publickey='${c.publickey}'`;
                    const bioRes = await MDS.sql(bioSql);
                    if (bioRes.status && bioRes.rows && bioRes.rows.length > 0 && bioRes.rows[0].BIO) {
                        console.log("✅ [CONTACT] Found P2P bio:", bioRes.rows[0].BIO);
                        // Merge bio into contact extradata
                        setContact(prev => ({
                            ...prev!,
                            extradata: {
                                ...prev?.extradata,
                                description: bioRes.rows[0].BIO
                            }
                        }));
                    } else {
                        console.log("ℹ️ [CONTACT] No P2P bio found");
                    }
                } catch (bioErr) {
                    console.warn("⚠️ [CONTACT] Error fetching bio:", bioErr);
                }
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

    // Check Maxima pending request when contact loads
    useEffect(() => {
        if (contact?.publickey) {
            checkMaximaPendingRequest();
        }
    }, [contact]);

    // Check for pending outgoing Maxima contact request
    const checkMaximaPendingRequest = async () => {
        if (!contact?.publickey) return;

        try {
            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myPublicKey = (myInfo.response as any).publickey;
            const escapeSql = (str: string) => str.replace(/'/g, "''");

            const sql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS WHERE from_publickey='${escapeSql(myPublicKey)}' AND to_publickey='${escapeSql(contact.publickey)}' AND status='pending'`;
            const result = await minimaService.runSQL(sql);

            setMaximaRequestPending(result.rows && result.rows.length > 0);
        } catch (err) {
            console.error('[Maxima Request] Error checking pending:', err);
        }
    };

    // Load personal contact status
    useEffect(() => {
        const loadPersonalStatus = async () => {
            if (!contact?.publickey) return;
            const isPersonal = await personalContactsService.isPersonalContact(contact.publickey);
            setIsPersonalContact(isPersonal);
        };
        loadPersonalStatus();
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
            console.log("🔍 [UI] Profile received, checking fields:", {
                email: profile.email || 'NOT PRESENT',
                phone: profile.phone || 'NOT PRESENT',
                location: profile.location || 'NOT PRESENT',
                website: profile.website || 'NOT PRESENT'
            });
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

            // Graceful handling for non-contacts / timeouts
            // If it times out or fails, it likely means they aren't sharing info or we aren't a contact.
            // Don't show a scary error, just assume empty/restricted profile.
            console.log("⚠️ [PROFILE] Assuming restricted access or offline. Continuing with basic info.");

            setProfileLoaded(true); // Mark as "loaded" (even if empty) so UI unlocks
            setProfileError(null);  // Don't show error to user
        }
    };

    // Add contact state
    const [addingContact, setAddingContact] = useState(false);
    const [requestStatus, setRequestStatus] = useState<'none' | 'pending' | 'accepted'>('none');
    const [hasChatHistory, setHasChatHistory] = useState(false);

    // Maxima contact request state (MAXIMA_CONTACT_REQUESTS)
    const [maximaRequestPending, setMaximaRequestPending] = useState(false);
    const [maximaIncomingRequest, setMaximaIncomingRequest] = useState(false);
    const [sendingMaximaRequest, setSendingMaximaRequest] = useState(false);

    // Check for existing requests and chat history on load and on message updates
    const checkStatus = useCallback(async () => {
        if (!contact?.publickey) return;

        try {
            console.log("🔍 [CONTACT] Checking request status and history...");

            // 1. Check for request status (sent, accepted, declined, cancelled)
            // Fix: Check both publickey AND address (in case message was saved with Mx address)
            const safeAddr = contact.currentaddress ? contact.currentaddress.replace(/'/g, "''") : '';
            const requestSql = `SELECT * FROM CHAT_MESSAGES 
                                WHERE (publickey='${contact.publickey}' ${safeAddr ? `OR publickey='${safeAddr}'` : ''}) 
                                AND (message='Contact request sent' OR message='Chat request sent' 
                                  OR message='Contact request accepted' OR message='Chat request accepted' 
                                  OR message='Contact request declined' OR message='Chat request declined' 
                                  OR message='Contact request cancelled' OR message='Chat request cancelled') 
                                ORDER BY date DESC LIMIT 1`;
            const requestRes = await minimaService.runSQL(requestSql);

            if (requestRes && requestRes.rows && requestRes.rows.length > 0) {
                const msg = requestRes.rows[0].MESSAGE;
                console.log(`🔍 [CONTACT DEBUG] Found status message in DB: "${msg}"`, requestRes.rows[0]);

                if (msg === 'Contact request accepted' || msg === 'Chat request accepted') {
                    // Fix: Chat acceptance is NOW decoupled from Maxima Contact list.
                    // We trust the message history.
                    setRequestStatus('accepted');
                } else if (msg === 'Contact request sent' || msg === 'Chat request sent') {
                    setRequestStatus('pending');
                } else if (msg === 'Contact request declined' || msg === 'Chat request declined') {
                    setRequestStatus('none'); // Reset to none so user can try again
                } else if (msg === 'Contact request cancelled' || msg === 'Chat request cancelled') {
                    setRequestStatus('none'); // Reset to none after cancellation
                }
            } else {
                setRequestStatus('none');
            }

            // 2. Check for REAL chat history (exclude system messages, read receipts, delivery reports)
            // This prevents "Solicitor can send messages" just because a request/decline message exists
            const historySql = `SELECT * FROM CHAT_MESSAGES 
                                WHERE publickey='${contact.publickey}' 
                                AND type NOT IN ('system', 'read', 'delivery') 
                                AND message NOT LIKE 'Contact request%' AND message NOT LIKE 'Chat request%' 
                                LIMIT 1`;
            const historyRes = await minimaService.runSQL(historySql);

            if (historyRes && historyRes.rows && historyRes.rows.length > 0) {
                setHasChatHistory(true);
            } else {
                setHasChatHistory(false);
            }

        } catch (err) {
            console.error("❌ [CONTACT] Error checking status:", err);
        }

        // 3. Check for Pending Maxima Contact Request (Decoupled from Chat)
        try {
            console.log("🔍 [CONTACT] Checking Maxima Contact Request status...");
            // Check both directions:
            // 1. Outgoing: I sent request TO contact.publickey
            // 2. Incoming: Contact locally saved request FROM contact.publickey (if we eventually show that here)
            // Ideally we need my own key to differentiate, but for 'pending' visualization on this page, 
            // knowing a request exists involving this peer is usually enough.
            // For now, let's strictly check OUTGOING requests from ME to THEM, 
            // since this page is "I am viewing THEM".

            // Note: service.js saves incoming requests. minima.service saves outgoing.
            // We need to check both to cover all states.

            // Get my public key to differentiate incoming vs outgoing
            const myInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
            const myPublicKey = (myInfo.response as any).publickey;

            // Check for OUTGOING requests (I sent to them)
            const maxOutgoingSql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS 
                                    WHERE from_publickey='${myPublicKey}' 
                                    AND to_publickey='${contact.publickey}' 
                                    AND status='pending'`;
            const maxOutgoingRes = await minimaService.runSQL(maxOutgoingSql);

            if (maxOutgoingRes && maxOutgoingRes.rows && maxOutgoingRes.rows.length > 0) {
                console.log("✅ [CONTACT] Found pending OUTGOING Maxima request:", maxOutgoingRes.rows[0]);
                setMaximaRequestPending(true);
            } else {
                setMaximaRequestPending(false);
            }

            // Check for INCOMING requests (they sent to me)
            const maxIncomingSql = `SELECT * FROM MAXIMA_CONTACT_REQUESTS 
                                    WHERE from_publickey='${contact.publickey}' 
                                    AND to_publickey='${myPublicKey}' 
                                    AND status='pending'`;

            console.log("🔍 [CONTACT DEBUG] Checking Incoming SQL:", maxIncomingSql);
            console.log("🔍 [CONTACT DEBUG] Contact PK:", contact.publickey);
            console.log("🔍 [CONTACT DEBUG] My PK:", myPublicKey);

            const maxIncomingRes = await minimaService.runSQL(maxIncomingSql);
            console.log("🔍 [CONTACT DEBUG] Incoming Result:", maxIncomingRes);

            if (maxIncomingRes && maxIncomingRes.rows && maxIncomingRes.rows.length > 0) {
                console.log("✅ [CONTACT] Found pending INCOMING Maxima request:", maxIncomingRes.rows[0]);
                setMaximaIncomingRequest(true);
            } else {
                setMaximaIncomingRequest(false);
            }

        } catch (err) {
            console.error("❌ [CONTACT] Error checking Maxima requests:", err);
        }
    }, [contact]);

    // Initial check and listener for updates
    useEffect(() => {
        checkStatus();

        // Listen for new messages (declines, accepts) to update UI in real-time
        const handleNewMessage = (msg: any) => {
            if (msg.type === 'contact_declined' || msg.type === 'contact_accepted') {
                console.log(`🔔 [CONTACT] Received ${msg.type}, refreshing status...`);
                // Wait a moment for DB insert
                setTimeout(checkStatus, 500);
            }
        };

        minimaService.onNewMessage(handleNewMessage);

        return () => {
            minimaService.removeNewMessageCallback(handleNewMessage);
        };
    }, [checkStatus]);

    const handleSendContactRequest = async () => {
        if (!contact?.currentaddress) {
            alert("Cannot send request: No Maxima address available");
            return;
        }
        setAddingContact(true);
        try {
            await minimaService.sendChatRequest(contact.currentaddress, userName || "Unknown", userAvatar || "");
            setRequestStatus('pending'); // Optimistic update

            // Navigate to chat
            navigate({
                to: "/chat/$address",
                params: { address: contact.publickey },
                search: { requestPending: true }
            });
        } catch (err: any) {
            console.error("❌ [CONTACT] Exception sending request:", err);
            alert(`Error sending chat request: ${err.message || err}`);
        } finally {
            setAddingContact(false);
        }
    };

    const handleCancelRequest = async () => {
        console.log("🖱️ [UI DEBUG] Cancel Request Clicked. Contact:", contact);
        if (!contact?.publickey) {
            console.error("❌ [UI DEBUG] Cannot cancel: No public key found on contact object");
            return;
        }

        // const confirmed = confirm("Are you sure you want to cancel this chat request?");
        // if (!confirmed) return;
        console.log("⚠️ [UI DEBUG] Skipped confirm dialog (debugging)");

        console.log(`🚀 [UI DEBUG] Calling minimaService.cancelChatRequest with pk: ${contact.publickey}`);
        setAddingContact(true); // Reuse state for loading indicator
        try {
            await minimaService.cancelChatRequest(contact.publickey);
            setRequestStatus('none'); // Clear pending status
            console.log("✅ [CONTACT] Request cancelled");
        } catch (err: any) {
            console.error("❌ [CONTACT] Error cancelling request:", err);
            alert(`Error cancelling request: ${err.message || err}`);
        } finally {
            setAddingContact(false);
        }
    };

    const handleSendMaximaRequest = async () => {
        console.log("🖱️ [UI DEBUG] Send Maxima Request Clicked. Contact:", contact);
        if (!contact?.currentaddress) {
            console.error("❌ [UI DEBUG] Cannot send request: No currentaddress found on contact");
            alert("Error: Cannot find user's Maxima address.");
            return;
        }

        setSendingMaximaRequest(true);
        try {
            await minimaService.sendMaximaContactRequest(contact.currentaddress, contact.publickey);
            setMaximaRequestPending(true);
            console.log("✅ [Maxima Contact] Request sent");
        } catch (err: any) {
            console.error("❌ [Maxima Contact] Error sending request:", err);
            alert(`Error sending Maxima contact request: ${err.message || err}`);
        } finally {
            setSendingMaximaRequest(false);
        }
    };

    const handleCancelMaximaRequest = async () => {
        console.log("🖱️ [UI DEBUG] Cancel Maxima Request Clicked. Contact:", contact);
        if (!contact?.publickey) {
            console.error("❌ [UI DEBUG] Cannot cancel: No public key found");
            return;
        }

        // const confirmed = confirm("Are you sure you want to cancel this Maxima contact request?");
        // if (!confirmed) return;
        console.log("⚠️ [UI DEBUG] Skipped confirm dialog (debugging)");

        console.log(`🚀 [UI DEBUG] Calling minimaService.cancelMaximaContactRequest with pk: ${contact.publickey}`);
        setSendingMaximaRequest(true);
        try {
            await minimaService.cancelMaximaContactRequest(contact.publickey);
            setMaximaRequestPending(false);
            console.log("✅ [Maxima Contact] Request cancelled");
        } catch (err: any) {
            console.error("❌ [Maxima Contact] Error cancelling request:", err);
            alert(`Error cancelling request: ${err.message || err}`);
        } finally {
            setSendingMaximaRequest(false);
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

                // Optimistic UI update - Immediate feedback
                setIsMaximaContact(false);
                setExtendedProfile(null);
                setProfileError(null);
                setRequestStatus('none');
                setIsPersonalContact(false);


                // Don't fetch immediately - let optimistic UI stay
                // The contact will be removed from maxcontacts once the Maxima message is processed

                // Stay on page so user sees it's now a non-contact
                // navigate({ to: "/" }); 
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
    const contactName = contact?.extradata?.name || "Unknown";
    const displayPubkey = contact?.publickey || "";
    const displayLastSeen = contact?.lastseen;
    const avatarUrl = getAvatar(contact);
    const p2pBio = contact?.extradata?.description || "";

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

            {/* Tab Navigation */}
            <ContactTabs activeTab={activeTab} onTabChange={setActiveTab} />

            <div className="max-w-4xl mx-auto px-4 pb-20">
                {/* 
                 * TAB 1: PROFILE (Overview)
                 * Contains Connection Status + User Profile Info
                 */}
                {activeTab === 'profile' && (
                    <div className="space-y-6">
                        {/* Profile Loading Error */}
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


                        {/* Basic Profile Info */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center text-center">
                            <div className="relative mb-4">
                                <img
                                    src={avatarUrl}
                                    alt={contactName}
                                    className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-md bg-gray-50"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = defaultAvatar;
                                    }}
                                />
                                {isMaximaContact && (
                                    <div className="absolute bottom-0 right-0 bg-green-500 border-2 border-white rounded-full p-1 shadow-sm" title="Maxima Contact">
                                        <Check size={12} className="text-white" strokeWidth={3} />
                                    </div>
                                )}
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-1 px-4 break-words w-full text-center">{contactName}</h2>

                            {displayLastSeen && (
                                <div className="text-xs text-gray-400 mb-4 flex items-center gap-1 bg-gray-50 px-2 py-1 rounded">
                                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                                    Last seen: {new Date(displayLastSeen).toLocaleString()}
                                </div>
                            )}

                            <p className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full font-mono mb-6 truncate max-w-xs cursor-pointer hover:bg-gray-200 transition-colors"
                                onClick={() => copyToClipboard(contact?.publickey || "", "pk-main")}
                                title="Click to copy public key"
                            >
                                {contact?.publickey ? `${contact.publickey.substring(0, 10)}...${contact.publickey.substring(contact.publickey.length - 8)}` : "Loading..."}
                            </p>

                            {/* Extended Profile Details */}
                            {profileLoaded && (
                                <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 text-left border-t border-gray-100 pt-6 mt-2">

                                    {/* Level 2 Privacy Warning */}
                                    {extendedProfile?.privacy_l2 === 'hidden' && (
                                        <div className="md:col-span-2 bg-purple-50 p-2 rounded-lg text-center text-xs text-purple-700 font-medium">
                                            Level 2 details hidden by user
                                        </div>
                                    )}

                                    {/* Bio */}
                                    {(contact?.extradata?.description || p2pBio) && (
                                        <div className="bg-gray-50 p-3 rounded-lg flex items-start gap-3 md:col-span-2">
                                            <div className="bg-white p-2 rounded-md shadow-sm text-purple-500 mt-0.5">
                                                <UserCheck size={18} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-0.5">Bio</span>
                                                <p className="text-sm text-gray-700 italic break-words whitespace-pre-wrap">
                                                    "{contact?.extradata?.description || p2pBio}"
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Location */}
                                    {(extendedProfile?.country || extendedProfile?.location) && (
                                        <div className="bg-gray-50 p-3 rounded-lg flex items-start gap-3">
                                            <div className="bg-white p-2 rounded-md shadow-sm text-blue-500 mt-0.5">
                                                <MapPin size={18} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-0.5">Location</span>
                                                <span className="font-medium text-gray-900 break-words block">
                                                    {[extendedProfile?.location, extendedProfile?.country].filter(Boolean).join(", ")}
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Languages */}
                                    {extendedProfile?.languages && extendedProfile.languages.length > 0 && (
                                        <div className="bg-gray-50 p-3 rounded-lg flex items-start gap-3">
                                            <div className="bg-white p-2 rounded-md shadow-sm text-green-500 mt-0.5">
                                                <Globe size={18} />
                                            </div>
                                            <div>
                                                <span className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-0.5">Languages</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {extendedProfile.languages.map((lang: string, idx: number) => (
                                                        <span key={idx} className="text-xs bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-700 font-medium">
                                                            {lang}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Website */}
                                    {extendedProfile?.website && safeUrl(extendedProfile.website) && (
                                        <div className="bg-gray-50 p-3 rounded-lg flex items-start gap-3">
                                            <div className="bg-white p-2 rounded-md shadow-sm text-blue-500 mt-0.5">
                                                <Globe size={18} />
                                            </div>
                                            <div className="flex-1 min-w-0 overflow-hidden">
                                                <span className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-0.5">Website</span>
                                                <a href={safeUrl(extendedProfile.website)} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline truncate block">
                                                    {extendedProfile.website}
                                                </a>
                                            </div>
                                        </div>
                                    )}

                                    {/* Social Links */}
                                    {extendedProfile?.social && Object.keys(extendedProfile.social).length > 0 && (
                                        <div className="bg-gray-50 p-3 rounded-lg flex items-start gap-3">
                                            <div className="bg-white p-2 rounded-md shadow-sm text-indigo-500 mt-0.5">
                                                <UserCheck size={18} />
                                            </div>
                                            <div className="flex-1 min-w-0 overflow-hidden">
                                                <span className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-0.5">Social</span>
                                                <div className="flex flex-col gap-1">
                                                    {extendedProfile.social.twitter && (
                                                        <a href={`https://twitter.com/${extendedProfile.social.twitter}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-blue-500 truncate max-w-full">
                                                            <Twitter size={14} className="flex-shrink-0" /> <span className="truncate">@{extendedProfile.social.twitter}</span>
                                                        </a>
                                                    )}
                                                    {extendedProfile.social.linkedin && (
                                                        <a href={`https://linkedin.com/in/${extendedProfile.social.linkedin}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-blue-700 truncate max-w-full">
                                                            <Linkedin size={14} className="flex-shrink-0" /> <span className="truncate">/in/{extendedProfile.social.linkedin}</span>
                                                        </a>
                                                    )}
                                                    {extendedProfile.social.github && (
                                                        <a href={`https://github.com/${extendedProfile.social.github}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 truncate max-w-full">
                                                            <Github size={14} className="flex-shrink-0" /> <span className="truncate">{extendedProfile.social.github}</span>
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}


                                    {/* Level 3 Privacy Warning */}
                                    {isPersonalContact && extendedProfile?.privacy_l3 === 'hidden' && (
                                        <div className="md:col-span-2 bg-amber-50 p-2 rounded-lg text-center text-xs text-amber-700 font-medium">
                                            Level 3 details hidden by user
                                        </div>
                                    )}

                                    {/* Contact Details (Level 3) */}
                                    {isPersonalContact && (
                                        <>
                                            {extendedProfile?.email && (
                                                <div className="bg-gray-50 p-3 rounded-lg flex items-start gap-3">
                                                    <div className="bg-white p-2 rounded-md shadow-sm text-red-500 mt-0.5">
                                                        <Mail size={18} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <span className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-0.5">Email</span>
                                                        <a href={`mailto:${extendedProfile.email}`} className="font-medium text-blue-600 hover:underline break-all block">
                                                            {extendedProfile.email}
                                                        </a>
                                                    </div>
                                                </div>
                                            )}
                                            {extendedProfile?.phone && (
                                                <div className="bg-gray-50 p-3 rounded-lg flex items-start gap-3">
                                                    <div className="bg-white p-2 rounded-md shadow-sm text-gray-500 mt-0.5">
                                                        <Phone size={18} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <span className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-0.5">Phone</span>
                                                        <a href={`tel:${extendedProfile.phone}`} className="font-medium text-blue-600 hover:underline break-all block">
                                                            {extendedProfile.phone}
                                                        </a>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                    </div>
                )}

                {/* 
                 * TAB 2: SETTINGS (Privacy)
                 * Contains Privacy Controls + Remove Button
                 */}
                {activeTab === 'settings' && (
                    <div className="space-y-6">
                        {/* Connection Status */}
                        {contact?.publickey && (
                            <ContactActions
                                isMaximaContact={isMaximaContact}
                                userAllowsNonContactChats={userAllowsNonContactChats}
                                maximaIncomingRequest={maximaIncomingRequest}
                                requestStatus={requestStatus}
                                hasChatHistory={hasChatHistory}
                                maximaRequestPending={maximaRequestPending}
                                sendingMaximaRequest={sendingMaximaRequest}
                                addingContact={addingContact}
                                onNavigateChat={() => {
                                    if (!contact?.publickey) return;
                                    navigate({ to: "/chat/$address", params: { address: contact.publickey } });
                                }}
                                onCancelRequest={handleCancelRequest}
                                onSendContactRequest={handleSendContactRequest}
                                onCancelMaximaRequest={handleCancelMaximaRequest}
                                onSendMaximaRequest={handleSendMaximaRequest}
                            />
                        )}

                        {isMaximaContact ? (
                            <>
                                <ContactPrivacy
                                    isPersonalContact={isPersonalContact}
                                    togglingPersonal={togglingPersonal}
                                    onTogglePersonal={async () => {
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
                                />

                                <div className="bg-white rounded-xl shadow-sm border border-red-100 overflow-hidden">
                                    <div className="p-4 border-b border-red-50 bg-red-50/30">
                                        <h3 className="text-sm font-semibold text-red-700 uppercase tracking-wider">Danger Zone</h3>
                                    </div>
                                    <div className="p-4">
                                        <p className="text-sm text-gray-600 mb-4">
                                            Removing a contact will delete them from your Maxima contacts list. Chat history will be preserved.
                                        </p>
                                        <button
                                            onClick={handleRemoveContact}
                                            disabled={removingContact}
                                            className="w-full px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:bg-red-50 disabled:text-red-300 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                                        >
                                            {removingContact ? "Removing..." : "Remove Contact"}
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="bg-gray-50 rounded-xl p-8 text-center border border-dashed border-gray-300">
                                <p className="text-gray-500">
                                    Only available for Maxima contacts.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* 
                 * TAB 3: TECH DATA
                 * Contains Raw JSON Data
                 */}
                {activeTab === 'tech' && (
                    <div className="space-y-6">
                        {/* Public Key & Address */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                            {/* Public Key */}
                            {displayPubkey && (
                                <div className="p-4 hover:bg-gray-50 transition-colors group border-b border-gray-100">
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
                )}
            </div>

            {/* Custom Confirmation Modal */}
            {
                showConfirmDelete && contact && (
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
                )
            }

        </div >
    );
}
