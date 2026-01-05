import { createFileRoute } from "@tanstack/react-router";
import { useContext, useEffect, useState } from "react";
import { MDS } from "@minima-global/mds";
import { appContext } from "../AppContext";
import { User, ChevronDown, ChevronUp, Copy, Check, Edit2, Globe, Shield, AlertTriangle, RefreshCw, Info } from "lucide-react";
import { sendBeacon } from "../hooks/useBeaconSender";
import { SettingsTabs, SettingsTab } from "../components/SettingsTabs";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

// Countries and regions list
const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan",
  "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi",
  "Cambodia", "Cameroon", "Canada", "Cape Verde", "Catalonia", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic",
  "Denmark", "Djibouti", "Dominica", "Dominican Republic",
  "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Euskadi",
  "Fiji", "Finland", "France",
  "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana",
  "Haiti", "Honduras", "Hungary",
  "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
  "Jamaica", "Japan", "Jordan",
  "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan",
  "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg",
  "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar",
  "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway",
  "Oman",
  "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal",
  "Qatar",
  "Romania", "Russia", "Rwanda",
  "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Scotland", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
  "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan",
  "Vanuatu", "Vatican City", "Venezuela", "Vietnam",
  "Yemen",
  "Zambia", "Zimbabwe"
];

// Languages list - most spoken languages + regional languages
const LANGUAGES = [
  "Arabic", "Basque (Euskera)", "Bengali", "Catalan (Català)", "Chinese (Mandarin)", "Chinese (Cantonese)",
  "Czech", "Danish", "Dutch", "English", "Finnish", "French", "German", "Greek", "Hebrew", "Hindi",
  "Hungarian", "Indonesian", "Italian", "Japanese", "Korean", "Malay", "Norwegian", "Persian (Farsi)",
  "Polish", "Portuguese", "Romanian", "Russian", "Scots", "Scots Gaelic (Gàidhlig)", "Serbian", "Slovak",
  "Spanish (Español)", "Swahili", "Swedish", "Tagalog", "Tamil", "Thai", "Turkish", "Ukrainian",
  "Urdu", "Vietnamese", "Welsh (Cymraeg)"
].sort();

function Settings() {
  const { loaded, writeMode, refreshWriteMode, refreshProfile } = useContext(appContext);

  // Tab State
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');

  // Profile State
  const [userName, setUserName] = useState("User");
  const [userAvatar, setUserAvatar] = useState(defaultAvatar);
  const [maximaAddress, setMaximaAddress] = useState("");
  const [minimaAddress, setMinimaAddress] = useState("");
  const [expandedAddress, setExpandedAddress] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [showAvatarDialog, setShowAvatarDialog] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFileSize, setAvatarFileSize] = useState(0);

  // Community & Discovery State
  const [staticMLSServer, setStaticMLSServer] = useState("");
  const [hasStaticMLS, setHasStaticMLS] = useState(false);
  const [hasPermanentAddress, setHasPermanentAddress] = useState(false);
  const [permanentAddress, setPermanentAddress] = useState("");
  const [enablingPermanent, setEnablingPermanent] = useState(false);
  const [p2pIdentity, setP2pIdentity] = useState("");


  // P2P Profile State (Discovery) - Only bio, name comes from Maxima
  const [p2pBio, setP2pBio] = useState("");

  // Discovery Configuration
  const [discoveryInterval, setDiscoveryInterval] = useState(60);
  const [discoveryLimit, setDiscoveryLimit] = useState(5);
  // Removed unused savingP2pProfile state

  // Extended Profile State - Level 2 (Semi-Private)
  const [location, setLocation] = useState(""); // City/Region
  const [country, setCountry] = useState(""); // Country
  const [languages, setLanguages] = useState<string[]>([]); // Languages spoken
  const [website, setWebsite] = useState("");
  const [socialLinks, setSocialLinks] = useState({
    twitter: "",
    linkedin: "",
    github: ""
  });
  const [tags, setTags] = useState<string[]>([]);

  // Extended Profile State - Level 3 (Private)
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // Removed unused savingExtendedProfile state

  // Privacy Settings State
  type VisibilityLevel = 'public' | 'contacts' | 'personal';
  const [level2Visibility, setLevel2Visibility] = useState<VisibilityLevel>('public');
  const [level3Visibility, setLevel3Visibility] = useState<VisibilityLevel>('personal');
  const [personalContacts, setPersonalContacts] = useState<string[]>([]); // Array of Maxima addresses
  const [allowNonContactChats, setAllowNonContactChats] = useState(true); // Allow chats from non-contacts (default: open)
  const [privacyLoading, setPrivacyLoading] = useState(true); // Loading state for privacy settings
  // Removed unused savingPrivacySettings state

  // Network Status State
  const [networkStatus, setNetworkStatus] = useState<any>(null);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  useEffect(() => {
    if (!loaded) return;

    const fetchProfile = async () => {
      try {
        // Fetch Maxima Info (Name, Icon, Maxima Address)
        const infoRes = await MDS.cmd.maxima({ params: { action: "info" } });
        const info = (infoRes.response as any) || {};

        if (info) {
          const name = info.name || "User";
          setUserName(name);
          if (info.icon) {
            const decodedIcon = decodeURIComponent(info.icon);
            // Check if it's a valid data URL, and not a URL ending in /0x00 (no photo)
            if (decodedIcon.startsWith("data:image") && !decodedIcon.includes("/0x00")) {
              setUserAvatar(decodedIcon);
            } else {
              setUserAvatar(defaultAvatar);
            }
          }
          setMaximaAddress(info.contact || "");
        }

        // Fetch Minima Address (for receiving tokens)
        const newAddr = await MDS.cmd.getaddress();
        if ((newAddr.response as any)?.miniaddress) {
          setMinimaAddress((newAddr.response as any).miniaddress);
        }

      } catch (err) {
        console.error("Error fetching profile:", err);
      }
    };

    fetchProfile();

    // Fetch P2P Bio only (name comes from Maxima)
    const fetchP2pProfile = async () => {
      try {
        const bioRes = await MDS.keypair.get('p2p_bio');
        if (bioRes && bioRes.status && bioRes.value) {
          setP2pBio(bioRes.value);
        }
      } catch (err) {
        console.error("Error fetching P2P bio:", err);
      }

      // Fetch Discovery Settings
      try {
        const intervalRes = await MDS.keypair.get('discovery_interval');
        if (intervalRes && intervalRes.status && intervalRes.value) {
          setDiscoveryInterval(parseInt(intervalRes.value));
        }

        const limitRes = await MDS.keypair.get('discovery_limit');
        if (limitRes && limitRes.status && limitRes.value) {
          setDiscoveryLimit(parseInt(limitRes.value));
        }
      } catch (err) {
        console.error("Error fetching discovery settings:", err);
      }


    };

    // Fetch Extended Profile (Level 2 & 3)
    const fetchExtendedProfile = async () => {
      try {
        // Level 2 fields
        const locationRes = await MDS.keypair.get('profile_location');
        if (locationRes?.status && locationRes.value) setLocation(locationRes.value);

        const countryRes = await MDS.keypair.get('profile_country');
        if (countryRes?.status && countryRes.value) setCountry(countryRes.value);

        const languagesRes = await MDS.keypair.get('profile_languages');
        if (languagesRes?.status && languagesRes.value) {
          setLanguages(JSON.parse(languagesRes.value));
        }

        const websiteRes = await MDS.keypair.get('profile_website');
        if (websiteRes?.status && websiteRes.value) setWebsite(websiteRes.value);

        const socialLinksRes = await MDS.keypair.get('profile_social_links');
        if (socialLinksRes?.status && socialLinksRes.value) {
          setSocialLinks(JSON.parse(socialLinksRes.value));
        }

        const tagsRes = await MDS.keypair.get('profile_tags');
        if (tagsRes?.status && tagsRes.value) {
          setTags(JSON.parse(tagsRes.value));
        }

        // Level 3 fields
        const emailRes = await MDS.keypair.get('profile_email');
        if (emailRes?.status && emailRes.value) setEmail(emailRes.value);

        const phoneRes = await MDS.keypair.get('profile_phone');
        if (phoneRes?.status && phoneRes.value) setPhone(phoneRes.value);
      } catch (err) {
        console.error("Error fetching extended profile:", err);
      }
    };

    // Fetch Privacy Settings
    const fetchPrivacySettings = async () => {
      try {
        const level2Res = await MDS.keypair.get('privacy_level2_visibility');
        if (level2Res?.status && level2Res.value) {
          setLevel2Visibility(level2Res.value as VisibilityLevel);
        }

        const level3Res = await MDS.keypair.get('privacy_level3_visibility');
        if (level3Res?.status && level3Res.value) {
          setLevel3Visibility(level3Res.value as VisibilityLevel);
        }

        const personalRes = await MDS.keypair.get('privacy_personal_contacts');
        if (personalRes?.status && personalRes.value) {
          setPersonalContacts(JSON.parse(personalRes.value));
        }

        // Load chat permission setting from MY_PROFILE (source of truth)
        try {
          const sql = "SELECT allow_non_contact_chats FROM MY_PROFILE LIMIT 1";
          const res = await MDS.sql(sql);
          if (res.status && res.rows && res.rows.length > 0) {
            const rawValue = res.rows[0].ALLOW_NON_CONTACT_CHATS ?? res.rows[0].allow_non_contact_chats;
            const value = (rawValue === 1 || rawValue === "1" || rawValue === true || rawValue === "true");
            setAllowNonContactChats(value);
          } else {
            // Default to true if not set
            setAllowNonContactChats(true);
          }
        } catch (err) {
          console.error('[Settings] Error loading chat permission from DB:', err);
          // Fallback to keypair if DB fails
          const chatPermRes = await MDS.keypair.get('allow_noncontact_chats');
          if (chatPermRes?.status && chatPermRes.value !== undefined) {
            setAllowNonContactChats(chatPermRes.value === 'true');
          }
        }
      } catch (err) {
        console.error("Error fetching privacy settings:", err);
      } finally {
        // Add minimum delay so loading state is visible
        console.log('[Settings] Privacy settings loaded, waiting 300ms before enabling...');
        setTimeout(() => {
          setPrivacyLoading(false);
          console.log('[Settings] Privacy controls now enabled');
        }, 300);
      }
    };

    fetchP2pProfile();
    fetchExtendedProfile();
    fetchPrivacySettings();

    // Fetch network status
    fetchNetworkStatus();

    // Fetch community status
    fetchCommunityStatus();

    // Refresh write mode status using checkmode (doesn't create pending)
    console.log("🔄 [Settings] Calling refreshWriteMode...");
    refreshWriteMode();
  }, [loaded, refreshWriteMode]);

  // Handle hash-based scrolling
  useEffect(() => {
    const handleHashChange = async () => {
      const hash = window.location.hash;
      console.log('🔍 [Settings] Hash detected:', hash);

      if (hash === '#community-discovery') {
        // Increased delay to ensure the DOM and state are fully rendered
        setTimeout(async () => {
          console.log('⏰ [Settings] Timeout triggered, checking element...');
          const element = document.querySelector(hash);

          if (element) {
            console.log('✅ [Settings] Element found, scrolling...');
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Check if Static MLS is configured to decide if we should expand the section
            try {
              console.log('🔍 [Settings] Checking Static MLS status...');
              const maximaInfo = await MDS.cmd.maxima();
              const info = (maximaInfo.response as any) || {};

              console.log('📊 [Settings] Static MLS status:', info.staticmls);

              // If no Static MLS configured, expand the section
              if (!info.staticmls) {
                console.log('🔓 [Settings] Expanding Static MLS section...');
                setExpandedAddress('staticMLS');
              } else {
                console.log('✅ [Settings] Static MLS already configured, keeping section collapsed');
              }
            } catch (err) {
              console.error('❌ [Settings] Error checking Static MLS:', err);
              // On error, expand the section to be safe
              console.log('🔓 [Settings] Expanding section due to error...');
              setExpandedAddress('staticMLS');
            }

            // Clear the hash after processing to prevent re-triggering on page refresh
            setTimeout(() => {
              console.log('🧹 [Settings] Clearing hash from URL...');
              window.history.replaceState(null, '', window.location.pathname);
            }, 500);
          } else {
            console.warn('⚠️ [Settings] Element not found for hash:', hash);
          }
        }, 300); // Increased from 100ms to 300ms
      }
    };

    // Check hash on mount
    handleHashChange();

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const fetchCommunityStatus = async () => {
    try {
      const maximaInfo = await MDS.cmd.maxima();
      const info = (maximaInfo.response as any) || {};

      // Store P2P identity for MLS server section
      setP2pIdentity(info.p2pidentity || "");

      // Check if Static MLS is configured
      setHasStaticMLS(info.staticmls || false);

      if (info.staticmls && info.mls) {
        setStaticMLSServer(info.mls);

        // Build permanent MAX# address
        const maxAddress = `MAX#${info.publickey}#${info.mls}`;
        setPermanentAddress(maxAddress);

        // Check if permanent address is enabled (we assume it's enabled if staticmls is true)
        // In a real implementation, you'd verify this with maxextra or another check
        setHasPermanentAddress(true);
      }
    } catch (err) {
      console.error("Error fetching community status:", err);
    }
  };





  const handleEnablePermanentAddress = async (silent = false) => {
    if (!hasStaticMLS) {
      if (!silent) alert("⚠️ Please configure Static MLS first");
      return;
    }

    if (!staticMLSServer) {
      if (!silent) alert("⚠️ Static MLS server address not found");
      return;
    }

    setEnablingPermanent(true);
    try {
      const maximaInfo = await MDS.cmd.maxima();
      const publickey = (maximaInfo.response as any)?.publickey;

      if (!publickey) {
        throw new Error("Unable to get public key");
      }

      console.log(`📤 [Settings] Sending registration request to MLS: ${staticMLSServer}`);

      // Send registration request to the MLS server via Maxima
      // The server (if running MetaChain) will pick this up and run 'maxextra action:addpermanent'
      const msgData = {
        type: "mls_register_permanent",
        publickey: publickey
      };

      const mkcmd = `maxima action:send to:${staticMLSServer} application:metachain data:${JSON.stringify(msgData)}`;

      const response = await new Promise<any>((resolve, reject) => {
        MDS.executeRaw(mkcmd, (res: any) => {
          if (res.status) {
            resolve(res);
          } else {
            reject(new Error(res.error || 'Failed to send registration request'));
          }
        });
      });

      console.log("✅ [Settings] Registration request sent:", response);
      if (!silent) {
        alert("✅ Registration request sent to Static MLS!\n\nPlease wait a few moments for the server to register your permanent address.");
      } else {
        console.log("ℹ️ [Settings] Silent registration request sent successfully.");
      }

      // We don't strictly need to fetch status immediately as it's async on the server, 
      // but we can refresh to see if anything changed locally.
      await fetchCommunityStatus();

    } catch (err) {
      console.error("❌ [Settings] Error enabling permanent address:", err);
      if (!silent) alert("Failed to send registration request: " + (err as Error).message);
    } finally {
      setEnablingPermanent(false);
    }
  };

  const fetchNetworkStatus = async () => {
    try {
      setNetworkLoading(true);
      const statusRes = await MDS.cmd.status();
      setNetworkStatus(statusRes.response);
      setLastUpdated(Date.now());
    } catch (err) {
      console.error("Error fetching network status:", err);
    } finally {
      setNetworkLoading(false);
    }
  };




  const handleSaveName = async () => {
    console.log("[Settings] Saving name:", editNameValue);
    if (editNameValue && editNameValue.trim() !== "") {
      try {
        console.log("[Settings] Attempting to set name to:", editNameValue.trim());

        // Use modern MDS API
        const response = await MDS.cmd.maxima({
          params: {
            action: "setname",
            name: editNameValue.trim()
          } as any
        });

        console.log("[Settings] MDS response:", response);

        if (response && (response as any).status === false) {
          throw new Error((response as any).error || "Failed to set name");
        }

        console.log("[Settings] Name set successfully, updating state");
        setUserName(editNameValue.trim());
        // Update global context by fetching the latest profile data
        await refreshProfile();
        setShowEditDialog(false);

        // Send beacon to propagate name change
        console.log("[Settings] Sending beacon with updated name...");
        await sendBeacon();

      } catch (err) {
        console.error("[Settings] Error setting name:", err);
        alert("Failed to update name: " + (err as Error).message);
      }
    }
  };

  const handleEditAvatar = () => {
    setAvatarUrl(userAvatar);
    setAvatarFileSize(0);
    setShowAvatarDialog(true);
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Resize if too large (max 800x800)
          const maxSize = 800;
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = (height / width) * maxSize;
              width = maxSize;
            } else {
              width = (width / height) * maxSize;
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);

          // Compress to JPEG with quality 0.8
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
          resolve(compressedDataUrl);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSaveAvatar = async () => {
    console.log("[Settings] Saving avatar, file size:", avatarFileSize);

    if (avatarUrl && avatarUrl.trim() !== "") {
      try {
        const encodedIcon = encodeURIComponent(avatarUrl.trim());
        console.log("[Settings] Encoded icon length:", encodedIcon.length);
        console.log("[Settings] Attempting to set avatar...");

        // Use modern MDS API
        const response = await MDS.cmd.maxima({
          params: {
            action: "seticon",
            icon: encodedIcon
          } as any
        });

        console.log("[Settings] MDS full response:", JSON.stringify(response, null, 2));
        console.log("[Settings] Response status:", (response as any)?.status);
        console.log("[Settings] Response error:", (response as any)?.error);

        if (!response || (response as any).status === false) {
          const errorMsg = (response as any)?.error || "Failed to set avatar - no response";
          console.error("[Settings] Error:", errorMsg);
          throw new Error(errorMsg);
        }

        console.log("[Settings] Avatar set successfully, updating state");
        setUserAvatar(avatarUrl.trim());
        // Update global context by fetching the latest profile data
        await refreshProfile();
        setShowAvatarDialog(false);
      } catch (err) {
        console.error("[Settings] Error setting avatar:", err);
        alert("Failed to update avatar: " + (err as Error).message);
      }
    }
  };

  const handleSaveP2pProfile = async () => {
    try {
      // Save bio to Keypair
      await MDS.keypair.set('p2p_bio', p2pBio.trim());

      console.log("✅ [Settings] P2P bio saved to Keypair");

      // CRITICAL: Also save to DB for persistent cache (survives Keypair resets)
      const maximaInfo = await MDS.cmd.maxima({ params: { action: 'info' } });
      if (maximaInfo.status && maximaInfo.response) {
        const pubkey = maximaInfo.response.publickey;
        const escapedBio = p2pBio.trim().replace(/'/g, "''");

        // Update bio in DISCOVERED_PEERS for SELF
        const updateSql = `UPDATE DISCOVERED_PEERS SET bio='${escapedBio}' WHERE publickey='${pubkey}' AND source='SELF'`;
        await MDS.sql(updateSql);

        console.log("✅ [Settings] P2P bio saved to DB cache");
      }

      // Send beacon immediately to propagate bio change
      console.log("[Settings] Sending beacon with updated bio...");
      await sendBeacon();
      console.log("[Settings] Beacon sent successfully");

      // Silent save - no popup needed for auto-save
    } catch (err) {
      console.error("❌ [Settings] Error saving P2P profile:", err);
      alert("Failed to save P2P profile: " + (err as Error).message);
    }
  };

  const handleSaveExtendedProfile = async () => {
    try {
      // Save Level 2 fields to keypair
      await MDS.keypair.set('profile_location', location.trim());
      await MDS.keypair.set('profile_country', country.trim());
      await MDS.keypair.set('profile_languages', JSON.stringify(languages));
      await MDS.keypair.set('profile_website', website.trim());
      await MDS.keypair.set('profile_social_links', JSON.stringify(socialLinks));
      await MDS.keypair.set('profile_tags', JSON.stringify(tags));

      // Save Level 3 fields to keypair
      await MDS.keypair.set('profile_email', email.trim());
      await MDS.keypair.set('profile_phone', phone.trim());

      // Sync to MY_PROFILE table for Service Worker access
      const updateSql = `
        UPDATE MY_PROFILE SET
          LOCATION = '${encodeURIComponent(location.trim())}',
          COUNTRY = '${encodeURIComponent(country.trim())}',
          LANGUAGES = '${encodeURIComponent(JSON.stringify(languages))}',
          WEBSITE = '${encodeURIComponent(website.trim())}',
          SOCIAL_LINKS = '${encodeURIComponent(JSON.stringify(socialLinks))}',
          EMAIL = '${encodeURIComponent(email.trim())}',
          PHONE = '${encodeURIComponent(phone.trim())}',
          LAST_UPDATED = ${Date.now()}
        WHERE id = 1
      `;

      await MDS.sql(updateSql);
      console.log("✅ [Settings] Extended profile saved to keypair and MY_PROFILE");
      // Silent save - no popup needed for auto-save
    } catch (err) {
      console.error("❌ [Settings] Error saving extended profile:", err);
      alert("Failed to save profile: " + (err as Error).message);
    }
  };

  const handleSavePrivacySettings = async (newL2?: VisibilityLevel, newL3?: VisibilityLevel) => {
    try {
      const l2 = newL2 ?? level2Visibility;
      const l3 = newL3 ?? level3Visibility;
      console.log("💾 [Settings] Saving privacy settings - L2:", l2, "L3:", l3);

      // Save to Keypair (for Frontend access)
      await MDS.keypair.set('privacy_level2_visibility', l2);
      await MDS.keypair.set('privacy_level3_visibility', l3);
      await MDS.keypair.set('privacy_personal_contacts', JSON.stringify(personalContacts));

      // Save to DB (for Service Worker access)
      const sql = `UPDATE MY_PROFILE SET privacy_l2='${l2}', privacy_l3='${l3}' WHERE id=1`;
      await new Promise<void>((resolve) => {
        // @ts-ignore
        MDS.sql(sql, (res: any) => {
          if (typeof res === 'object' && !res.status) {
            console.error("❌ [Settings] SQL Update failed:", res);
          }
          resolve();
        });
      });

      console.log("✅ [Settings] Privacy settings saved successfully (Keypair + DB)");
    } catch (err) {
      console.error("❌ [Settings] Error saving privacy settings:", err);
    }
  };

  const handleToggleChatPermission = async () => {
    try {
      const newValue = !allowNonContactChats;

      // Save to keypair storage (for app itself)
      await MDS.keypair.set('allow_noncontact_chats', String(newValue));

      // CRITICAL: Also save to MY_PROFILE table (for Service Worker to read and transmit)
      const updateSql = `UPDATE MY_PROFILE SET allow_non_contact_chats = ${newValue ? 1 : 0} WHERE id = 1`;
      await MDS.sql(updateSql);

      setAllowNonContactChats(newValue);
      console.log('[Settings] Chat permission updated (keypair + MY_PROFILE):', newValue);
    } catch (err) {
      console.error('[Settings] Error saving chat permission:', err);
    }
  };

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const toggleAddress = (id: string) => {
    setExpandedAddress(expandedAddress === id ? null : id);
  };

  return (
    <>
      {/* Global autofill styling - force white background and dark text */}
      <style>{`
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active,
        textarea:-webkit-autofill,
        textarea:-webkit-autofill:hover,
        textarea:-webkit-autofill:focus,
        select:-webkit-autofill,
        select:-webkit-autofill:hover,
        select:-webkit-autofill:focus {
          -webkit-text-fill-color: #374151 !important;
          -webkit-box-shadow: 0 0 0px 1000px #ffffff inset !important;
          box-shadow: 0 0 0px 1000px #ffffff inset !important;
          background-color: #ffffff !important;
          transition: background-color 5000s ease-in-out 0s;
        }
        
        /* Force white background on all checkboxes */
        input[type="checkbox"] {
          background-color: white !important;
          -webkit-appearance: none;
          -moz-appearance: none;
          appearance: none;
          border: 2px solid #d1d5db;
          border-radius: 0.25rem;
          width: 1rem;
          height: 1rem;
          cursor: pointer;
          position: relative;
        }
        
        /* Purple background with white checkmark when checked */
        input[type="checkbox"]:checked {
          background-color: #a855f7 !important;
          border-color: #a855f7 !important;
        }
        
        input[type="checkbox"]:checked::after {
          content: '';
          position: absolute;
          left: 0.25rem;
          top: 0.05rem;
          width: 0.35rem;
          height: 0.6rem;
          border: solid white;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }
      `}</style>
      {/* Edit Name Dialog */}
      {showEditDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-96 max-w-full mx-4">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Edit Display Name</h3>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Display Name</label>
              <input
                type="text"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="Enter your name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setShowEditDialog(false);
                }}
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowEditDialog(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveName}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Avatar Dialog */}
      {showAvatarDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-96 max-w-full mx-4">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Edit Avatar</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Image</label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Choose an image from your device (will be compressed to 800x800)</p>
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setAvatarFileSize(file.size);
                    try {
                      const compressedUrl = await compressImage(file);
                      setAvatarUrl(compressedUrl);
                    } catch (err) {
                      console.error("Error compressing image:", err);
                    }
                  }
                }}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-300"
              />
            </div>

            {avatarUrl && (
              <div className="mb-4 flex justify-center">
                <img src={avatarUrl} alt="Preview" className="w-24 h-24 rounded-full object-cover border-2 border-gray-200 dark:border-gray-600" onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowAvatarDialog(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAvatar}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}



      <div className="h-full flex flex-col bg-gray-50">
        {/* Tabs Navigation */}
        <SettingsTabs activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-4 md:p-8 min-h-full">

            <div className="grid gap-6">

              {/* PROFILE TAB */}
              {activeTab === 'profile' && (
                <>
                  {/* PROFILE SECTION */}
                  <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center gap-3">
                      <User className="text-blue-500" />
                      <h2 className="text-xl font-semibold text-gray-800">Profile</h2>
                    </div>

                    {/* Level 1: Public Discovery Profile */}
                    <div className="p-6 border-b border-gray-100">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Globe className="text-blue-500" size={20} />
                          <h3 className="text-lg font-semibold text-gray-800">Discovery Profile (P2P)</h3>
                        </div>
                        <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">Level 1 - Public</span>
                      </div>

                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 flex items-start gap-2 mb-6">
                        <Info size={16} className="mt-0.5 flex-shrink-0" />
                        <p>Your <strong>Maxima Name</strong> and <strong>Avatar</strong> are used for P2P discovery. Add a bio below to share more about yourself. All information here is public.</p>
                      </div>

                      <div className="space-y-6">
                        {/* Maxima Name & Avatar */}
                        <div className="flex items-center gap-4">
                          <div className="relative">
                            <img
                              src={userAvatar}
                              alt="Avatar"
                              className="w-16 h-16 rounded-full object-cover border-4 border-gray-100"
                              onError={(e) => (e.target as HTMLImageElement).src = defaultAvatar}
                            />
                            <button
                              onClick={handleEditAvatar}
                              className="absolute -bottom-1 -right-1 p-1.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-lg"
                              title="Change Avatar"
                            >
                              <Edit2 size={12} />
                            </button>
                          </div>
                          <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Maxima Name</label>
                            <input
                              type="text"
                              value={userName}
                              onChange={(e) => setUserName(e.target.value)}
                              onBlur={async () => {
                                if (userName.trim()) {
                                  try {
                                    await MDS.cmd.maxima({ params: { action: "setname", name: userName.trim() } });
                                    console.log("✅ [Settings] Maxima name updated");
                                    await refreshProfile();
                                  } catch (err) {
                                    console.error("❌ [Settings] Error updating name:", err);
                                  }
                                }
                              }}
                              className="w-full text-lg font-bold text-gray-900 bg-transparent border-b-2 border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none transition-colors px-1 -mx-1"
                              placeholder="Your name"
                              maxLength={50}
                            />
                            <p className="text-sm text-gray-500 mt-1">Visible to your contacts and discovered peers</p>
                          </div>
                        </div>

                        {/* Bio */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-gray-700">
                              Bio
                            </label>
                            <span className={`text-xs font-medium ${p2pBio.length > 280 ? 'text-red-500' : p2pBio.length > 250 ? 'text-yellow-600' : 'text-gray-400'}`}>
                              {p2pBio.length}/280
                            </span>
                          </div>
                          <textarea
                            value={p2pBio}
                            onChange={(e) => setP2pBio(e.target.value)}
                            onBlur={handleSaveP2pProfile}
                            placeholder="Tell others about yourself..."
                            rows={3}
                            maxLength={280}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all bg-white text-gray-700 resize-none"
                          />
                          <p className="text-xs text-gray-500 mt-1">Shared with all discovered peers • Auto-saves</p>
                        </div>
                      </div>
                    </div>

                    {/* Level 2: Semi-Private Information */}
                    <div className="p-6 border-b border-gray-100">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <User className="text-purple-500" size={20} />
                          <h3 className="text-lg font-semibold text-gray-800">Additional Information</h3>
                        </div>
                        <span className="px-3 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full">Level 2 - Semi-Private</span>
                      </div>

                      <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800 flex items-start gap-2 mb-4">
                        <Info size={16} className="mt-0.5 flex-shrink-0" />
                        <p>You can control who sees this information in the <strong>Privacy</strong> tab.</p>
                      </div>

                      <div className="space-y-4">
                        {/* Location */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">City/Region</label>
                          <input
                            type="text"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            onBlur={handleSaveExtendedProfile}
                            placeholder="Barcelona, New York, etc."
                            maxLength={100}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white text-gray-700 autofill:bg-white autofill:text-gray-900 [&:-webkit-autofill]:!bg-white [&:-webkit-autofill]:!text-gray-900 [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_rgb(255,255,255)]"
                          />
                          <p className="text-xs text-gray-500 mt-1">Visibility controlled in Privacy tab • Auto-saves</p>
                        </div>

                        {/* Country */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Country/Region</label>
                          <select
                            value={country}
                            onChange={(e) => setCountry(e.target.value)}
                            onBlur={handleSaveExtendedProfile}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white text-gray-700"
                          >
                            <option value="">Select a country...</option>
                            {COUNTRIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-500 mt-1">Visibility controlled in Privacy tab • Auto-saves</p>
                        </div>

                        {/* Languages */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Languages</label>
                          <div className="border border-gray-300 rounded-lg p-3 bg-white max-h-48 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-purple-400 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-purple-500">
                            <div className="grid grid-cols-2 gap-2">
                              {LANGUAGES.map((lang) => (
                                <label key={lang} className="flex items-center gap-2 cursor-pointer hover:bg-purple-50 p-1 rounded transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={languages.includes(lang)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setLanguages([...languages, lang]);
                                      } else {
                                        setLanguages(languages.filter(l => l !== lang));
                                      }
                                      // Auto-save after a short delay
                                      setTimeout(handleSaveExtendedProfile, 100);
                                    }}
                                    className="w-4 h-4 rounded border-gray-300 bg-white focus:ring-2 focus:ring-blue-500"
                                    style={{ accentColor: '#a855f7' }}
                                  />
                                  <span className="text-sm text-gray-700">{lang}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          {languages.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {languages.map((lang) => (
                                <span key={lang} className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">
                                  {lang}
                                  <button
                                    onClick={() => {
                                      setLanguages(languages.filter(l => l !== lang));
                                      setTimeout(handleSaveExtendedProfile, 100);
                                    }}
                                    className="hover:text-purple-900"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-gray-500 mt-1">Visibility controlled in Privacy tab • Auto-saves</p>
                        </div>

                        {/* Website */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Website</label>
                          <input
                            type="url"
                            value={website}
                            onChange={(e) => setWebsite(e.target.value)}
                            onBlur={handleSaveExtendedProfile}
                            placeholder="https://example.com"
                            maxLength={200}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white text-gray-700 autofill:bg-white autofill:text-gray-900 [&:-webkit-autofill]:!bg-white [&:-webkit-autofill]:!text-gray-900 [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_rgb(255,255,255)]"
                          />
                          <p className="text-xs text-gray-500 mt-1">Visibility controlled in Privacy tab • Auto-saves</p>
                        </div>

                        {/* Social Links */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Social Links</label>
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={socialLinks.twitter}
                              onChange={(e) => setSocialLinks({ ...socialLinks, twitter: e.target.value })}
                              onBlur={handleSaveExtendedProfile}
                              placeholder="Twitter/X username"
                              maxLength={50}
                              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white text-gray-700 autofill:bg-white autofill:text-gray-900 [&:-webkit-autofill]:!bg-white [&:-webkit-autofill]:!text-gray-900 [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_rgb(255,255,255)]"
                            />
                            <input
                              type="text"
                              value={socialLinks.linkedin}
                              onChange={(e) => setSocialLinks({ ...socialLinks, linkedin: e.target.value })}
                              onBlur={handleSaveExtendedProfile}
                              placeholder="LinkedIn profile URL"
                              maxLength={200}
                              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white text-gray-700 autofill:bg-white autofill:text-gray-900 [&:-webkit-autofill]:!bg-white [&:-webkit-autofill]:!text-gray-900 [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_rgb(255,255,255)]"
                            />
                            <input
                              type="text"
                              value={socialLinks.github}
                              onChange={(e) => setSocialLinks({ ...socialLinks, github: e.target.value })}
                              onBlur={handleSaveExtendedProfile}
                              placeholder="GitHub username"
                              maxLength={50}
                              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white text-gray-700 autofill:bg-white autofill:text-gray-900 [&:-webkit-autofill]:!bg-white [&:-webkit-autofill]:!text-gray-900 [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_rgb(255,255,255)]"
                            />
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Visibility controlled in Privacy tab • Auto-saves</p>
                        </div>
                      </div>
                    </div>

                    {/* Level 3: Private Contact Information */}
                    <div className="p-6 border-b border-gray-100">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Shield className="text-amber-600" size={20} />
                          <h3 className="text-lg font-semibold text-gray-800">Private Contact Information</h3>
                        </div>
                        <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">Level 3 - Private</span>
                      </div>

                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                        <p className="text-sm text-amber-800 flex items-start gap-2">
                          <Info size={16} className="mt-0.5 flex-shrink-0" />
                          <span>You can control who sees this information in the <strong>Privacy</strong> tab.</span>
                        </p>
                      </div>

                      <div className="space-y-4">
                        {/* Email */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onBlur={handleSaveExtendedProfile}
                            placeholder="your@email.com"
                            maxLength={100}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white text-gray-700 autofill:bg-white autofill:text-gray-900 [&:-webkit-autofill]:!bg-white [&:-webkit-autofill]:!text-gray-900 [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_rgb(255,255,255)]"
                          />
                          <p className="text-xs text-gray-500 mt-1">Visibility controlled in Privacy tab • Auto-saves</p>
                        </div>

                        {/* Phone */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                          <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            onBlur={handleSaveExtendedProfile}
                            placeholder="+1 234 567 8900"
                            maxLength={30}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white text-gray-700 autofill:bg-white autofill:text-gray-900 [&:-webkit-autofill]:!bg-white [&:-webkit-autofill]:!text-gray-900 [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_rgb(255,255,255)]"
                          />
                          <p className="text-xs text-gray-500 mt-1">Visibility controlled in Privacy tab • Auto-saves</p>
                        </div>
                      </div>
                    </div>

                    {/* Maxima Address - Full Width */}
                    <div className="border-b border-gray-100">
                      <button
                        onClick={() => toggleAddress('maxima')}
                        className="w-full flex items-center justify-between p-6 hover:bg-gray-50 transition-colors text-left"
                      >
                        <span className="font-medium text-gray-700">My Maxima Address</span>
                        {expandedAddress === 'maxima' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
                      </button>

                      {expandedAddress === 'maxima' && (
                        <div className="px-6 pb-6 pt-0">
                          <p className="text-xs font-mono text-gray-600 break-all mb-3 bg-gray-50 p-3 rounded border border-gray-100">
                            {maximaAddress || "Loading..."}
                          </p>
                          <button
                            onClick={() => copyToClipboard(maximaAddress, 'maxima')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copiedField === 'maxima' ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                          >
                            {copiedField === 'maxima' ? <Check size={16} /> : <Copy size={16} />}
                            {copiedField === 'maxima' ? 'Copied!' : 'Copy Address'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Minima Address - Full Width */}
                    <div>
                      <button
                        onClick={() => toggleAddress('minima')}
                        className="w-full flex items-center justify-between p-6 hover:bg-gray-50 transition-colors text-left"
                      >
                        <span className="font-medium text-gray-700">My Minima Address</span>
                        {expandedAddress === 'minima' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
                      </button>

                      {expandedAddress === 'minima' && (
                        <div className="px-6 pb-6 pt-0">
                          <p className="text-xs font-mono text-gray-600 break-all mb-3 bg-gray-50 p-3 rounded border border-gray-100">
                            {minimaAddress || "Loading..."}
                          </p>
                          <button
                            onClick={() => copyToClipboard(minimaAddress, 'minima')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copiedField === 'minima' ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                          >
                            {copiedField === 'minima' ? <Check size={16} /> : <Copy size={16} />}
                            {copiedField === 'minima' ? 'Copied!' : 'Copy Address'}
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}

              {/* PRIVACY TAB */}
              {activeTab === 'privacy' && (
                <>
                  <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center gap-3">
                      <Shield className="text-purple-500" />
                      <h2 className="text-xl font-semibold text-gray-800">Privacy Settings</h2>
                    </div>

                    <div className="p-6 space-y-8">
                      {/* Introduction */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="text-sm text-blue-800">
                          <strong>Control who can see your information.</strong> Choose visibility settings for each level of your profile data.
                        </p>
                      </div>

                      {/* Level 2 Visibility */}
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-800">Level 2 - Semi-Private</h3>
                            <p className="text-sm text-gray-500">Location, Website, Social Links</p>
                          </div>
                          <span className="px-3 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full">Level 2</span>
                        </div>

                        <div className="space-y-3">
                          <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                            style={{ borderColor: level2Visibility === 'public' ? '#3b82f6' : '#e5e7eb' }}>
                            <input
                              type="radio"
                              name="level2"
                              value="public"
                              checked={level2Visibility === 'public'}
                              onChange={(e) => {
                                const newValue = e.target.value as VisibilityLevel;
                                setLevel2Visibility(newValue);
                                handleSavePrivacySettings(newValue, undefined);
                              }}
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">Public Discovery</div>
                              <div className="text-sm text-gray-500 mt-1">Anyone who discovers you via P2P</div>
                              <div className="text-xs text-gray-400 mt-2 space-y-0.5">
                                <div>✓ Discovered users</div>
                                <div>✓ Chat participants or Maxima contacts</div>
                                <div>✓ Personal contacts</div>
                              </div>
                            </div>
                          </label>

                          <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                            style={{ borderColor: level2Visibility === 'contacts' ? '#3b82f6' : '#e5e7eb' }}>
                            <input
                              type="radio"
                              name="level2"
                              value="contacts"
                              checked={level2Visibility === 'contacts'}
                              onChange={(e) => {
                                const newValue = e.target.value as VisibilityLevel;
                                setLevel2Visibility(newValue);
                                handleSavePrivacySettings(newValue, undefined);
                              }}
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">Chat Access</div>
                              <div className="text-sm text-gray-500 mt-1">Anyone with chat access to you</div>
                              <div className="text-xs text-gray-400 mt-2 space-y-0.5">
                                <div className="text-gray-300">✗ Discovered users</div>
                                <div>✓ Chat participants or Maxima contacts</div>
                                <div>✓ Personal contacts</div>
                              </div>
                            </div>
                          </label>

                          <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                            style={{ borderColor: level2Visibility === 'personal' ? '#3b82f6' : '#e5e7eb' }}>
                            <input
                              type="radio"
                              name="level2"
                              value="personal"
                              checked={level2Visibility === 'personal'}
                              onChange={(e) => {
                                const newValue = e.target.value as VisibilityLevel;
                                setLevel2Visibility(newValue);
                                handleSavePrivacySettings(newValue, undefined);
                              }}
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">Personal Contacts Only</div>
                              <div className="text-sm text-gray-500 mt-1">Only contacts you mark as personal ({personalContacts.length} selected)</div>
                              <div className="text-xs text-gray-400 mt-2 space-y-0.5">
                                <div className="text-gray-300">✗ Discovered users</div>
                                <div className="text-gray-300">✗ Chat participants or Maxima contacts</div>
                                <div>✓ Personal contacts</div>
                              </div>
                            </div>
                          </label>
                        </div>
                      </div>

                      {/* Level 3 Visibility */}
                      <div className="pt-6 border-t border-gray-200">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-800">Level 3 - Private</h3>
                            <p className="text-sm text-gray-500">Email, Phone</p>
                          </div>
                          <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">Level 3</span>
                        </div>

                        <div className="space-y-3">
                          <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                            style={{ borderColor: level3Visibility === 'public' ? '#3b82f6' : '#e5e7eb' }}>
                            <input
                              type="radio"
                              name="level3"
                              value="public"
                              checked={level3Visibility === 'public'}
                              onChange={(e) => {
                                const newValue = e.target.value as VisibilityLevel;
                                setLevel3Visibility(newValue);
                                handleSavePrivacySettings(undefined, newValue);
                              }}
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">Public Discovery</div>
                              <div className="text-sm text-gray-500 mt-1">Anyone who discovers you via P2P</div>
                              <div className="text-xs text-gray-400 mt-2 space-y-0.5">
                                <div>✓ Discovered users</div>
                                <div>✓ Chat participants or Maxima contacts</div>
                                <div>✓ Personal contacts</div>
                              </div>
                            </div>
                          </label>

                          <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                            style={{ borderColor: level3Visibility === 'contacts' ? '#3b82f6' : '#e5e7eb' }}>
                            <input
                              type="radio"
                              name="level3"
                              value="contacts"
                              checked={level3Visibility === 'contacts'}
                              onChange={(e) => {
                                const newValue = e.target.value as VisibilityLevel;
                                setLevel3Visibility(newValue);
                                handleSavePrivacySettings(undefined, newValue);
                              }}
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">Chat Access</div>
                              <div className="text-sm text-gray-500 mt-1">Anyone with chat access to you</div>
                              <div className="text-xs text-gray-400 mt-2 space-y-0.5">
                                <div className="text-gray-300">✗ Discovered users</div>
                                <div>✓ Chat participants or Maxima contacts</div>
                                <div>✓ Personal contacts</div>
                              </div>
                            </div>
                          </label>

                          <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                            style={{ borderColor: level3Visibility === 'personal' ? '#3b82f6' : '#e5e7eb' }}>
                            <input
                              type="radio"
                              name="level3"
                              value="personal"
                              checked={level3Visibility === 'personal'}
                              onChange={(e) => {
                                const newValue = e.target.value as VisibilityLevel;
                                setLevel3Visibility(newValue);
                                handleSavePrivacySettings(undefined, newValue);
                              }}
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">Personal Contacts Only</div>
                              <div className="text-sm text-gray-500 mt-1">Only contacts you mark as personal ({personalContacts.length} selected)</div>
                              <div className="text-xs text-gray-400 mt-2 space-y-0.5">
                                <div className="text-gray-300">✗ Discovered users</div>
                                <div className="text-gray-300">✗ Chat participants or Maxima contacts</div>
                                <div>✓ Personal contacts</div>
                              </div>
                            </div>
                          </label>
                        </div>
                      </div>

                      {/* Personal Contacts Management */}
                      <div className="pt-6 border-t border-gray-200">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-800">Personal Contacts</h3>
                            <p className="text-sm text-gray-500">{personalContacts.length} contact{personalContacts.length !== 1 ? 's' : ''} marked as personal</p>
                          </div>
                        </div>

                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <p className="text-sm text-gray-600">
                            Personal Contacts management coming soon. You'll be able to select specific contacts from your Maxima contact list to mark as "personal" for enhanced privacy control.
                          </p>
                        </div>
                      </div>

                      {/* Chat Permissions */}
                      <div className="pt-6 border-t border-gray-200">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-gray-800">Chat Permissions</h3>
                            <p className="text-sm text-gray-500 mt-1">
                              Control who can start chats with you
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">Allow Direct Messages from Anyone</div>
                            <p className="text-sm text-gray-500 mt-1">
                              {allowNonContactChats
                                ? 'Users can message you immediately without approval'
                                : 'Users must send a request and be approved'}
                            </p>
                          </div>
                          <button
                            onClick={handleToggleChatPermission}
                            disabled={privacyLoading}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${privacyLoading ? 'opacity-50 cursor-not-allowed' : ''
                              } ${allowNonContactChats ? 'bg-blue-600' : 'bg-gray-200'}`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${allowNonContactChats ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                          </button>
                        </div>
                      </div>

                      {/* Application Mode */}
                      <div className="pt-6 border-t border-gray-200">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-800">Application Mode</h3>
                            <p className="text-sm text-gray-500">MiniDapp permissions for transactions</p>
                          </div>
                        </div>

                        <div className={`flex items-center gap-3 p-4 rounded-xl mb-4 ${writeMode ? 'bg-green-50 border border-green-100' : 'bg-yellow-50 border border-yellow-100'}`}>
                          {writeMode ? (
                            <div className="p-2 bg-green-100 rounded-full text-green-600">
                              <Check size={20} />
                            </div>
                          ) : (
                            <div className="p-2 bg-yellow-100 rounded-full text-yellow-600">
                              <AlertTriangle size={20} />
                            </div>
                          )}
                          <div>
                            <h3 className={`font-semibold ${writeMode ? 'text-green-800' : 'text-yellow-800'}`}>
                              {writeMode ? 'Write Mode Active' : 'Read Mode Active'}
                            </h3>
                            <p className={`text-sm ${writeMode ? 'text-green-600' : 'text-yellow-600'}`}>
                              {writeMode
                                ? 'MetaChain has full permission to send messages and tokens.'
                                : 'MetaChain needs your approval for every transaction.'}
                            </p>
                          </div>
                        </div>

                        {!writeMode && (
                          <div className="space-y-4">
                            <p className="text-gray-600 text-sm leading-relaxed">
                              To enable <strong>Write Mode</strong> and avoid repeated approval requests:
                            </p>
                            <ol className="list-decimal list-inside text-sm text-gray-600 space-y-2 pl-2">
                              <li>Go to <strong>Minima</strong> main screen</li>
                              <li>Open <strong>MiniDapps</strong></li>
                              <li>Find <strong>MetaChain</strong></li>
                              <li>Click the <strong>lock icon</strong> / permissions</li>
                              <li>Select <strong>Write Mode</strong></li>
                            </ol>

                            <button
                              onClick={async () => {
                                console.log("🔄 [Settings] Manual refresh button clicked");
                                await refreshWriteMode();
                              }}
                              className="w-full mt-2 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                            >
                              <RefreshCw size={18} />
                              Check Permissions Again
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                </>
              )}

              {/* DISCOVERY TAB */}
              {activeTab === 'discovery' && (
                <>
                  {/* COMMUNITY & DISCOVERY SECTION */}
                  <section id="community-discovery" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden scroll-mt-4">
                    <div className="p-6 border-b border-gray-100 flex items-center gap-3">
                      <Globe className="text-blue-500" />
                      <h2 className="text-xl font-semibold text-gray-800">Community & Discovery</h2>
                    </div>

                    <div className="p-6 space-y-6">
                      {/* Discovery Configuration */}
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-200">Discovery Settings</h4>
                          <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">Advanced</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Gossip Frequency (Seconds)</label>
                            <div className="relative">
                              <input
                                type="number"
                                min="30"
                                step="10"
                                placeholder="60"
                                value={discoveryInterval}
                                onChange={(e) => setDiscoveryInterval(parseInt(e.target.value) || 0)}
                                id="discoveryIntervalInput"
                                className="w-full p-2 pl-3 border border-gray-300 rounded-md bg-white text-gray-900 text-sm"
                                onBlur={(e) => {
                                  const val = parseInt(e.target.value) || 60;
                                  const safeVal = val < 30 ? 30 : val;
                                  setDiscoveryInterval(safeVal);
                                  MDS.keypair.set('discovery_interval', String(safeVal));
                                  console.log("✅ [Settings] Discovery interval saved:", safeVal);
                                }}
                              />
                              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                <span className="text-gray-400 text-xs">sec</span>
                              </div>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">Minimum 30s. Lower = faster updates, more data.</p>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Gossip Peer Limit</label>
                            <div className="relative">
                              <input
                                type="number"
                                min="1"
                                max="50"
                                placeholder="5"
                                value={discoveryLimit}
                                onChange={(e) => setDiscoveryLimit(parseInt(e.target.value) || 0)}
                                id="discoveryLimitInput"
                                className="w-full p-2 pl-3 border border-gray-300 rounded-md bg-white text-gray-900 text-sm"
                                onBlur={(e) => {
                                  const val = parseInt(e.target.value) || 5;
                                  const safeVal = val < 1 ? 1 : (val > 50 ? 50 : val);
                                  setDiscoveryLimit(safeVal);
                                  MDS.keypair.set('discovery_limit', String(safeVal));
                                  console.log("✅ [Settings] Discovery limit saved:", safeVal);
                                }}
                              />
                              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                <span className="text-gray-400 text-xs">nodes</span>
                              </div>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">Peers per gossip. Recommended: 5</p>
                          </div>
                        </div>
                      </div>

                      {/* MLS Server (for Development) */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Info className="text-blue-600" size={20} />
                          <h3 className="text-lg font-semibold text-blue-900">Use This Node as MLS Server</h3>
                        </div>
                        <p className="text-sm text-blue-800 mb-3">
                          For development/testing, other nodes can use this node as their Static MLS server.
                        </p>

                        {p2pIdentity ? (
                          <>
                            <div className="bg-white rounded border border-blue-200 p-3 mb-3">
                              <p className="text-xs text-blue-600 mb-1 font-semibold">Your P2P Identity:</p>
                              <p className="text-xs font-mono text-gray-800 break-all">{p2pIdentity}</p>
                            </div>
                            <button
                              onClick={() => copyToClipboard(p2pIdentity, 'p2p')}
                              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copiedField === 'p2p' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300'}`}
                            >
                              {copiedField === 'p2p' ? <Check size={16} /> : <Copy size={16} />}
                              {copiedField === 'p2p' ? 'Copied!' : 'Copy P2P Identity'}
                            </button>
                            <p className="text-xs text-blue-700 mt-3">
                              💡 <strong>Note:</strong> Other nodes can paste this address in "Static MLS Server" below to use this node as their MLS.
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-blue-700">Loading P2P identity...</p>
                        )}
                      </div>

                      {/* Static MLS Configuration */}
                      {/* Static MLS Configuration */}
                      <div className="border-b border-gray-100">
                        <button
                          onClick={() => toggleAddress('staticMLS')}
                          className="w-full flex items-center justify-between p-6 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold text-gray-800">Static MLS Server</h3>
                            {hasStaticMLS && <Check className="text-green-500" size={20} />}
                          </div>
                          {expandedAddress === 'staticMLS' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
                        </button>

                        {expandedAddress === 'staticMLS' && (
                          <div className="px-6 pb-6 pt-0">
                            <p className="text-sm text-gray-600 mb-4">
                              Configure a permanent Maxima Lookup Service to enable a permanent MAX# address for P2P Discovery.
                            </p>

                            {hasStaticMLS ? (
                              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                                <div className="flex items-center gap-2 mb-2">
                                  <Check className="text-green-600" size={20} />
                                  <span className="font-semibold text-green-800">Static MLS Configured</span>
                                </div>
                                <p className="text-xs text-gray-600 font-mono break-all mt-2">
                                  {staticMLSServer}
                                </p>
                                <div className="mt-2 pt-2 border-t border-green-200">
                                  <button
                                    onClick={() => handleEnablePermanentAddress(false)}
                                    disabled={enablingPermanent}
                                    className="text-xs flex items-center gap-2 text-green-700 hover:text-green-800 underline"
                                  >
                                    {enablingPermanent ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                    Force Re-register Permanent Address
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                                  <div className="flex items-center gap-2">
                                    <AlertTriangle className="text-yellow-600" size={20} />
                                    <span className="font-semibold text-yellow-800">Static MLS Not Configured</span>
                                  </div>
                                  <p className="text-sm text-yellow-700 mt-2">
                                    Enter your Static MLS server address below to enable P2P Discovery.
                                  </p>
                                </div>

                                <div className="space-y-3">
                                  <input
                                    type="text"
                                    value={staticMLSServer}
                                    onChange={(e) => setStaticMLSServer(e.target.value)}
                                    placeholder="MxG...@IP:PORT"
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono text-sm bg-white text-gray-700"
                                  />
                                  <p className="text-xs text-gray-500">Static MLS configuration has been simplified. Enter your MLS address above.</p>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Permanent Address */}
                      {/* Permanent Address */}
                      <div className="border-b border-gray-100">
                        <button
                          onClick={() => toggleAddress('permanentAddress')}
                          className="w-full flex items-center justify-between p-6 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold text-gray-800">Permanent MAX# Address</h3>
                            {hasPermanentAddress && <Check className="text-green-500" size={20} />}
                          </div>
                          {expandedAddress === 'permanentAddress' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
                        </button>

                        {expandedAddress === 'permanentAddress' && (
                          <div className="px-6 pb-6 pt-0">
                            <p className="text-sm text-gray-600 mb-4">
                              Enable a permanent address that never changes, allowing others to contact you even if you're not a contact.
                            </p>

                            {hasPermanentAddress ? (
                              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <Check className="text-green-600" size={20} />
                                  <span className="font-semibold text-green-800">Permanent Address Active</span>
                                </div>
                                <div className="bg-white rounded border border-green-200 p-3">
                                  <p className="text-xs text-gray-500 mb-1">Your MAX# Address:</p>
                                  <p className="text-xs font-mono text-gray-800 break-all">{permanentAddress}</p>
                                </div>
                                <button
                                  onClick={() => copyToClipboard(permanentAddress, 'permanent')}
                                  className={`mt-3 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copiedField === 'permanent' ? 'bg-green-100 text-green-700' : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'}`}
                                >
                                  {copiedField === 'permanent' ? <Check size={16} /> : <Copy size={16} />}
                                  {copiedField === 'permanent' ? 'Copied!' : 'Copy MAX# Address'}
                                </button>

                                <div className="mt-4 pt-4 border-t border-green-200">
                                  <p className="text-xs text-gray-500 mb-2">
                                    If contacts can't find you, your MLS server might need a reminder:
                                  </p>
                                  <button
                                    onClick={() => handleEnablePermanentAddress(false)}
                                    disabled={enablingPermanent}
                                    className="text-xs flex items-center gap-2 px-3 py-1.5 bg-white border border-green-300 text-green-700 rounded hover:bg-green-50 transition-colors"
                                  >
                                    {enablingPermanent ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                    Re-send Registration to MLS
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div>
                                {hasStaticMLS ? (
                                  <button
                                    onClick={() => handleEnablePermanentAddress(false)}
                                    disabled={enablingPermanent}
                                    className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                  >
                                    {enablingPermanent ? (
                                      <>
                                        <RefreshCw size={18} className="animate-spin" />
                                        Enabling...
                                      </>
                                    ) : (
                                      <>
                                        <Check size={18} />
                                        Enable Permanent Address
                                      </>
                                    )}
                                  </button>
                                ) : (
                                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                                    <AlertTriangle className="text-gray-400 mx-auto mb-2" size={24} />
                                    <p className="text-sm text-gray-600">
                                      Configure Static MLS first to enable permanent address
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                </>
              )}

              {/* NETWORK TAB */}
              {activeTab === 'network' && (
                <>
                  {/* NETWORK SECTION */}
                  <section id="network" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Globe className="text-green-500" />
                        <h2 className="text-xl font-semibold text-gray-800">Network</h2>
                      </div>
                      <button
                        onClick={fetchNetworkStatus}
                        disabled={networkLoading}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Refresh network status"
                      >
                        <RefreshCw size={18} className={networkLoading ? "animate-spin" : ""} />
                      </button>
                    </div>
                    <div className="p-6">
                      {networkLoading && !networkStatus ? (
                        <div className="flex items-center justify-center py-8">
                          <RefreshCw size={24} className="animate-spin text-gray-400" />
                        </div>
                      ) : networkStatus ? (
                        <>
                          {/* Health Status Badge */}
                          <div className={`flex items-center gap-3 p-4 rounded-xl mb-6 ${networkStatus.network?.connected > 3
                            ? 'bg-green-50 border border-green-100'
                            : networkStatus.network?.connected > 0
                              ? 'bg-yellow-50 border border-yellow-100'
                              : 'bg-red-50 border border-red-100'
                            }`}>
                            <div className={`p-2 rounded-full ${networkStatus.network?.connected > 3
                              ? 'bg-green-100 text-green-600'
                              : networkStatus.network?.connected > 0
                                ? 'bg-yellow-100 text-yellow-600'
                                : 'bg-red-100 text-red-600'
                              }`}>
                              <Check size={20} />
                            </div>
                            <div>
                              <h3 className={`font-semibold ${networkStatus.network?.connected > 3
                                ? 'text-green-800'
                                : networkStatus.network?.connected > 0
                                  ? 'text-yellow-800'
                                  : 'text-red-800'
                                }`}>
                                {networkStatus.network?.connected > 3
                                  ? 'Network running smoothly'
                                  : networkStatus.network?.connected > 0
                                    ? 'Limited connection'
                                    : 'No connection'}
                              </h3>
                              <p className={`text-sm ${networkStatus.network?.connected > 3
                                ? 'text-green-600'
                                : networkStatus.network?.connected > 0
                                  ? 'text-yellow-600'
                                  : 'text-red-600'
                                }`}>
                                {networkStatus.network?.connected > 3
                                  ? 'Connected to Minima network'
                                  : networkStatus.network?.connected > 0
                                    ? 'Few active connections'
                                    : 'No active connections'}
                              </p>
                            </div>
                          </div>

                          {/* Network Metrics */}
                          <div className="space-y-4">
                            {/* Connections */}
                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                                  <Globe size={18} />
                                </div>
                                <span className="font-medium text-gray-700">Connections</span>
                              </div>
                              <span className="text-lg font-bold text-gray-900">
                                {networkStatus.network?.connected || 0} nodes
                              </span>
                            </div>

                            {/* Current Block */}
                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-purple-100 rounded-lg text-purple-600">
                                  <span className="text-sm font-bold">⛓️</span>
                                </div>
                                <span className="font-medium text-gray-700">Current Block</span>
                              </div>
                              <span className="text-lg font-bold text-gray-900">
                                #{networkStatus.chain?.block?.toLocaleString() || 0}
                              </span>
                            </div>

                            {/* Last Block Time */}
                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-orange-100 rounded-lg text-orange-600">
                                  <span className="text-sm font-bold">🕐</span>
                                </div>
                                <span className="font-medium text-gray-700">Last Update</span>
                              </div>
                              <span className="text-sm font-semibold text-gray-700">
                                {networkStatus.chain?.time || 'N/A'}
                              </span>
                            </div>

                            {/* Minima Version */}
                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-gray-200 rounded-lg text-gray-600">
                                  <Info size={18} />
                                </div>
                                <span className="font-medium text-gray-700">Version</span>
                              </div>
                              <span className="text-sm font-semibold text-gray-700">
                                Minima {networkStatus.version || 'N/A'}
                              </span>
                            </div>
                          </div>

                          {/* Last Updated Timestamp */}
                          <div className="mt-6 text-center text-xs text-gray-500">
                            Updated {Math.floor((Date.now() - lastUpdated) / 1000)} seconds ago
                          </div>
                        </>
                      ) : (
                        <p className="text-gray-500 text-center py-4">Unable to load network data</p>
                      )}
                    </div>
                  </section>
                </>
              )}

            </div>
          </div>
        </div>
      </div >
    </>
  );
}
