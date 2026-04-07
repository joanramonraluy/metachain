import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState, useRef, useMemo } from 'react';
import { MDS } from '@minima-global/mds';
import { useAppContext } from '../../AppContext';
import { User, Globe, Loader2, Edit2, ChevronDown, ChevronUp, Copy, Check, Shield, X, Zap, Network, Twitter, Github, Linkedin } from 'lucide-react';
import { sendBeacon } from '../../hooks/useBeaconSender';
import { invalidateMessagingCache } from '../../services/messaging.service';

export const Route = createFileRoute('/settings/profile')({
  component: RouteComponent,
});

type VisibilityLevel = 'public' | 'contacts' | 'personal';

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

// Languages list
const LANGUAGES = [
  "Arabic", "Basque (Euskera)", "Bengali", "Catalan (Català)", "Chinese (Mandarin)", "Chinese (Cantonese)",
  "Czech", "Danish", "Dutch", "English", "Finnish", "French", "German", "Greek", "Hebrew", "Hindi",
  "Hungarian", "Indonesian", "Italian", "Japanese", "Korean", "Malay", "Norwegian", "Persian (Farsi)",
  "Polish", "Portuguese", "Romanian", "Russian", "Scots", "Scots Gaelic (Gàidhlig)", "Serbian", "Slovak",
  "Spanish (Español)", "Swahili", "Swedish", "Tagalog", "Tamil", "Thai", "Turkish", "Ukrainian",
  "Urdu", "Vietnamese", "Welsh (Cymraeg)"
].sort();


interface SocialLinks {
  twitter: string;
  linkedin: string;
  github: string;
}

function RouteComponent() {
  const { userName, userAvatar, myPublicKey, refreshProfile } = useAppContext();
  const [name, setName] = useState(userName);
  const [avatar, setAvatar] = useState(userAvatar);
  const [bio, setBio] = useState('');

  // UI State for Dialogs/Accordions

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [expandedAddress, setExpandedAddress] = useState<'maxima' | 'minima' | null>(null);
  const [copiedField, setCopiedField] = useState<'maxima' | 'minima' | null>(null);
  const [minimaAddress, setMinimaAddress] = useState(""); // Needed for L3 accordion

  // Extended Profile State - Level 2 (Semi-Private)
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [website, setWebsite] = useState("");
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({ twitter: '', linkedin: '', github: '' });
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Extended Profile State - Level 3 (Private)
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Visibility Levels
  const [level2Visibility, setLevel2Visibility] = useState<VisibilityLevel>('public');
  const [level3Visibility, setLevel3Visibility] = useState<VisibilityLevel>('personal');

  const [isSaving, setIsSaving] = useState(false);

  // Initial Load
  useEffect(() => {
    setName(userName);
    setAvatar(userAvatar);

    // Fetch Minima Address for Accordion
    MDS.cmd.getaddress((res: any) => {
      if (res.status && res.response && res.response.miniaddress) {
        setMinimaAddress(res.response.miniaddress);
      }
    });

    const loadProfile = async () => {
      // P2P Bio
      MDS.keypair.get('p2p_bio', (res: any) => {
        if (res.status && res.value) setBio(res.value);
      });

      // Extended Profile
      const locationRes = await MDS.keypair.get('profile_location');
      if (locationRes?.status && locationRes.value) setLocation(locationRes.value);

      const countryRes = await MDS.keypair.get('profile_country');
      if (countryRes?.status && countryRes.value) setCountry(countryRes.value);

      const languagesRes = await MDS.keypair.get('profile_languages');
      if (languagesRes?.status && languagesRes.value) {
        try { setLanguages(JSON.parse(languagesRes.value)); } catch (e) { }
      }

      const websiteRes = await MDS.keypair.get('profile_website');
      if (websiteRes?.status && websiteRes.value) setWebsite(websiteRes.value);

      const socialLinksRes = await MDS.keypair.get('profile_social_links');
      if (socialLinksRes?.status && socialLinksRes.value) {
        try { setSocialLinks(JSON.parse(socialLinksRes.value)); } catch (e) { }
      }

      // Level 3
      const emailRes = await MDS.keypair.get('profile_email');
      if (emailRes?.status && emailRes.value) setEmail(emailRes.value);

      const phoneRes = await MDS.keypair.get('profile_phone');
      if (phoneRes?.status && phoneRes.value) setPhone(phoneRes.value);

      // Privacy Levels
      const l2Res = await MDS.keypair.get('profile_privacy_level_2');
      if (l2Res?.status && l2Res.value) setLevel2Visibility(l2Res.value as VisibilityLevel);

      const l3Res = await MDS.keypair.get('profile_privacy_level_3');
      if (l3Res?.status && l3Res.value) setLevel3Visibility(l3Res.value as VisibilityLevel);
    };
    loadProfile();

  }, [userName, userAvatar]);


  // --- Handlers ---

  // 1. Save Maxima Name Inline
  const handleSaveName = async () => {
    if (!name.trim() || name === userName) {
      // Revert if empty or unchanged
      if (!name.trim()) setName(userName);
      return;
    }

    try {
      console.log("💾 [Profile] Saving name...");
      await MDS.cmd.maxima({ params: { action: 'setname', name: name.trim() } } as any);

      // Update SELF in DISCOVERED_PEERS for immediate local feedback
      const maximaInfo = await MDS.cmd.maxima({ params: { action: 'info' } as any });
      if (maximaInfo.status && maximaInfo.response) {
        const pubkey = (maximaInfo.response as any).publickey;
        const escapedName = name.trim().replace(/'/g, "''");
        const updateSelfSql = `UPDATE DISCOVERED_PEERS SET alias='${escapedName}' WHERE UPPER(publickey)=UPPER('${pubkey}') AND source='SELF'`;
        // @ts-ignore
        MDS.sql(updateSelfSql);
      }

      await refreshProfile();
      sendBeacon().catch(console.error);
      invalidateMessagingCache(); // Invalidate session cache so next message uses fresh avatar/address
      // setName(name.trim()); // Optimistic update handled by state, context refresh follows
      console.log("✅ [Profile] Name saved & Beacon sent & DB updated");
    } catch (error) {
      console.error("❌ [Profile] Failed to save name:", error);
      setName(userName); // Revert on error
    }
  };

  // 2. Save Avatar via Dialog
  const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveAvatar = async () => {
    if (!avatarUrl) {
      return;
    }

    setIsSaving(true);
    try {
      console.log("💾 [Profile] Saving avatar...");
      const encodedIcon = encodeURIComponent(avatarUrl);
      await MDS.cmd.maxima({ params: { action: 'seticon', icon: encodedIcon } } as any);

      const updateSql = `UPDATE MY_PROFILE SET AVATAR = '${avatarUrl.replace(/'/g, "''")}', LAST_UPDATED = ${Date.now()} WHERE id = 1`;
      // @ts-ignore
      MDS.sql(updateSql);

      await refreshProfile();
      setAvatar(avatarUrl);
      invalidateMessagingCache(); // Invalidate session cache so next message uses fresh avatar
      console.log("✅ [Profile] Avatar saved");
    } catch (error) {
      console.error("❌ [Profile] Failed to save avatar:", error);
    } finally {
      setIsSaving(false);
    }
  };

  // 3. Save Bio (Auto-save)
  const handleSaveP2pBio = async () => {
    try {
      await MDS.keypair.set('p2p_bio', bio);
      // Update SELF in DISCOVERED_PEERS
      const maximaInfo = await MDS.cmd.maxima({ params: { action: 'info' } as any });
      if (maximaInfo.status && maximaInfo.response) {
        const pubkey = (maximaInfo.response as any).publickey;
        const escapedBio = bio.trim().replace(/'/g, "''");
        const updateSelfSql = `UPDATE DISCOVERED_PEERS SET bio='${escapedBio}' WHERE UPPER(publickey)=UPPER('${pubkey}') AND source='SELF'`;
        // @ts-ignore
        MDS.sql(updateSelfSql);
      }
      sendBeacon().catch(console.error);
      invalidateMessagingCache(); // Invalidate session cache for fresh data
    } catch (error) {
      console.error("❌ [Profile] Failed to save bio:", error);
    }
  };

  // 4. Save Extended Profile (Auto-save)
  const handleSaveExtendedProfile = async (overrides?: any) => {
    const currentData = {
      location, country, languages, website, socialLinks, email, phone,
      level2Visibility, level3Visibility,
      ...overrides
    };

    try {
      if (overrides?.level2Visibility) setLevel2Visibility(overrides.level2Visibility);
      if (overrides?.level3Visibility) setLevel3Visibility(overrides.level3Visibility);

      await MDS.keypair.set('profile_location', currentData.location.trim());
      await MDS.keypair.set('profile_country', currentData.country.trim());
      await MDS.keypair.set('profile_languages', JSON.stringify(currentData.languages));
      await MDS.keypair.set('profile_website', currentData.website.trim());
      await MDS.keypair.set('profile_social_links', JSON.stringify(currentData.socialLinks));
      await MDS.keypair.set('profile_email', currentData.email.trim());
      await MDS.keypair.set('profile_phone', currentData.phone.trim());

      // Save Visibility Levels
      await MDS.keypair.set('profile_privacy_level_2', currentData.level2Visibility);
      await MDS.keypair.set('profile_privacy_level_3', currentData.level3Visibility);

      // Sync to MY_PROFILE for Service Worker
      const updateProfileSql = `
                UPDATE MY_PROFILE SET
                  LOCATION = '${encodeURIComponent(currentData.location.trim())}',
                  COUNTRY = '${encodeURIComponent(currentData.country.trim())}',
                  LANGUAGES = '${encodeURIComponent(JSON.stringify(currentData.languages))}',
                  WEBSITE = '${encodeURIComponent(currentData.website.trim())}',
                  SOCIAL_LINKS = '${encodeURIComponent(JSON.stringify(currentData.socialLinks))}',
                  EMAIL = '${encodeURIComponent(currentData.email.trim())}',
                  PHONE = '${encodeURIComponent(currentData.phone.trim())}',
                  PRIVACY_L2 = '${currentData.level2Visibility}',
                  PRIVACY_L3 = '${currentData.level3Visibility}',
                  LAST_UPDATED = ${Date.now()}
                WHERE id = 1
            `;
      // @ts-ignore
      MDS.sql(updateProfileSql);
      sendBeacon().catch(console.error);
      invalidateMessagingCache(); // Invalidate session cache for fresh data

    } catch (error) {
      console.error("❌ [Profile] Failed to save extended profile:", error);
    }
  };

  const toggleAddress = (type: 'maxima' | 'minima') => {
    setExpandedAddress(expandedAddress === type ? null : type);
  };

  const copyToClipboard = (text: string, type: 'maxima' | 'minima') => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(type);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const SearchableDropdown = ({ 
    options, 
    value, 
    onChange, 
    id,
    activeId,
    onToggle,
    placeholder = "Select option...",
    emptyMessage = "No results found"
  }: { 
    options: string[], 
    value: string, 
    onChange: (val: string) => void,
    id: string,
    activeId: string | null,
    onToggle: (isOpen: boolean) => void,
    placeholder?: string,
    emptyMessage?: string
  }) => {
    const isOpen = activeId === id;
    const [searchTerm, setSearchTerm] = useState("");
    const dropdownRef = useRef<HTMLDivElement>(null);

    const filteredOptions = useMemo(() => {
      if (!searchTerm) return options;
      return options.filter(opt => opt.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [options, searchTerm]);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (isOpen && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          onToggle(false);
        }
      };
      if (isOpen) {
        document.addEventListener('mousedown', handleClickOutside);
      }
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onToggle]);

    // Reset search when opening
    useEffect(() => {
      if (isOpen) setSearchTerm("");
    }, [isOpen]);

    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => onToggle(!isOpen)}
          className={`w-full flex items-center justify-between p-4 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all outline-none border border-transparent ${
            isOpen 
              ? 'bg-white dark:bg-gray-900 border-primary-500/50 shadow-xl' 
              : 'bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-gray-900 dark:text-white'
          }`}
        >
          <span className={!value ? "text-gray-400" : ""}>{value || placeholder}</span>
          <ChevronDown size={14} strokeWidth={3} className={`transition-transform duration-300 ${isOpen ? 'rotate-180 text-primary-500' : 'text-gray-400'}`} />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 dark:bg-gray-900/95 backdrop-blur-2xl border border-black/5 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden z-[110] animate-in fade-in zoom-in-95 duration-200 origin-top">
            <div className="p-3 border-b border-black/5 dark:border-white/5">
              <input
                autoFocus
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Type to search..."
                className="w-full bg-black/5 dark:bg-white/5 rounded-xl px-4 py-2.5 text-[11px] font-black uppercase tracking-widest outline-none placeholder:text-gray-400 text-gray-900 dark:text-white border border-transparent focus:border-primary-500/20"
              />
            </div>
            
            <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
                  <button
                    key={option}
                    onClick={() => {
                      onChange(option);
                      onToggle(false);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
                      value === option 
                        ? 'bg-primary-500 text-white' 
                        : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {option}
                  </button>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {emptyMessage}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const VisibilityDropdown = ({ 
    value, 
    onChange,
    id,
    activeId,
    onToggle
  }: { 
    value: VisibilityLevel, 
    onChange: (val: VisibilityLevel) => void,
    id: string,
    activeId: string | null,
    onToggle: (isOpen: boolean) => void
  }) => {
    const isOpen = activeId === id;
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (isOpen && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          onToggle(false);
        }
      };
      if (isOpen) {
        document.addEventListener('mousedown', handleClickOutside);
      }
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onToggle]);

    const options: { value: VisibilityLevel; label: string; description: string }[] = [
      { value: 'personal', label: 'Personal', description: 'Only visible to you' },
      { value: 'contacts', label: 'Community', description: 'Visible to your contacts' },
      { value: 'public', label: 'Global', description: 'Visible via discovery beacons' }
    ];

    const currentOption = options.find(o => o.value === value) || options[0];

    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => onToggle(!isOpen)}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
            isOpen 
              ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20' 
              : 'bg-black/5 dark:bg-white/5 text-gray-500 hover:text-primary-500 hover:bg-primary-500/10'
          }`}
        >
          {currentOption.label}
          <ChevronDown size={12} strokeWidth={3} className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute top-full right-0 mt-2 w-56 bg-white/90 dark:bg-gray-900/90 backdrop-blur-2xl border border-black/5 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden z-[100] animate-in fade-in zoom-in-95 duration-200 origin-top-right">
            <div className="p-2 space-y-1">
              {options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    onToggle(false);
                  }}
                  className={`w-full flex flex-col items-start gap-0.5 p-3 rounded-xl transition-all text-left group/option ${
                    value === option.value 
                      ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20' 
                      : 'hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase tracking-widest leading-none">
                    {option.label}
                  </span>
                  <span className={`text-[9px] font-medium leading-none ${
                    value === option.value ? 'text-white/70' : 'text-gray-400'
                  }`}>
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };


  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700">
      
      {/* 1. Header & Live Preview Section */}
      <div className="space-y-8">
        <div className="flex flex-col items-center gap-4 text-center">
           <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
              <User className="text-white" size={32} strokeWidth={2.5} />
           </div>
           <div className="space-y-1">
              <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tighter uppercase">Identity</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-black uppercase tracking-widest opacity-60">Manage your decentralized presence</p>
           </div>
        </div>

        {/* COMMUNITY CARD PREVIEW */}
        <div className="relative group">
           <div className="absolute -inset-1 bg-gradient-to-r from-primary-500 to-indigo-600 rounded-[3rem] blur opacity-10 group-hover:opacity-20 transition duration-1000"></div>
           <div className="relative bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 p-10 rounded-[3rem] shadow-lg shadow-black/5 overflow-hidden">
              <div className="absolute top-0 inset-x-0 flex justify-center p-4">
                 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-500 bg-primary-500/10 px-4 py-1.5 rounded-full ring-1 ring-primary-500/20">Public Preview</span>
              </div>
              
              <div className="flex flex-col items-center gap-10 pt-8">
                 {/* INTEGRATED AVATAR UPLOADER */}
                 <div className="relative flex-shrink-0 group/avatar">
                    <div className="absolute -inset-2 bg-gradient-to-br from-primary-500 to-primary-600 rounded-[2.5rem] blur opacity-0 group-hover/avatar:opacity-20 transition-opacity duration-500"></div>
                    <div className="relative w-32 h-32 md:w-40 md:h-40 rounded-[2.5rem] overflow-hidden border-4 border-white dark:border-gray-800 shadow-2xl transition-transform duration-500 group-hover/avatar:scale-[1.02]">
                       {avatar ? (
                          <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                       ) : (
                          <div className="w-full h-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400 font-black text-4xl">
                             {(name || "A").charAt(0).toUpperCase()}
                          </div>
                       )}
                       
                       {/* Glass Overlay on Hover */}
                       <label className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center cursor-pointer opacity-0 group-hover/avatar:opacity-100 transition-all duration-300">
                          <Edit2 className="text-white mb-2" size={24} />
                          <span className="text-[10px] text-white font-black uppercase tracking-widest">Change Photo</span>
                          <input type="file" accept="image/*" onChange={handleAvatarFileSelect} className="hidden" />
                       </label>
                    </div>
                    {isSaving && (
                       <div className="absolute inset-0 bg-white/80 dark:bg-black/80 backdrop-blur-md flex items-center justify-center rounded-[2.5rem] z-10">
                          <Loader2 className="text-primary-500 animate-spin" size={32} />
                       </div>
                    )}
                    {avatarUrl && avatarUrl !== avatar && !isSaving && (
                       <button 
                         onClick={handleSaveAvatar}
                         className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-6 py-2 bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-lg shadow-emerald-500/20 animate-in zoom-in"
                       >
                         Apply Changes
                       </button>
                    )}
                 </div>

                 <div className="flex-1 space-y-4 text-center  min-w-0">
                    <div className="space-y-1">
                       <h3 className="text-3xl md:text-4xl font-black text-gray-900 dark:text-white tracking-tighter truncate leading-none">
                          {name || "Nomad User"}
                       </h3>
                       <div className="flex items-center justify-center justify-center gap-2">
                          <Globe size={14} className="text-primary-500" />
                          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                             {country || "Unspecified Region"}
                          </span>
                       </div>
                    </div>
                    
                    <p className="text-base md:text-lg text-gray-500 dark:text-gray-400 font-medium leading-relaxed italic line-clamp-2 italic max-w-lg">
                       "{bio || "Decentralized MetaChain Member"}"
                    </p>

                    <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                        {(socialLinks.twitter || socialLinks.github || socialLinks.linkedin) && (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-primary-500/10 border border-primary-500/20 rounded-full transition-all hover:scale-105 shadow-sm">
                             {socialLinks.twitter && <Twitter size={11} className="text-primary-500" />}
                             {socialLinks.github && <Github size={11} className="text-primary-500" />}
                             {socialLinks.linkedin && <Linkedin size={11} className="text-primary-500" />}
                             <span className="text-[9px] font-black uppercase tracking-widest text-primary-600 ml-1">Social</span>
                          </div>
                        )}
                       {languages.length > 0 ? (
                         languages.slice(0, 3).map(l => (
                           <span key={l} className="px-3 py-1 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-300">
                              {l}
                           </span>
                         ))
                       ) : (
                         <span className="px-3 py-1 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full text-[10px] font-black uppercase tracking-widest text-gray-400">
                            Discovery Enabled
                         </span>
                       )}
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>

      {/* 2. Form Sections - Stacked Vertically */}
      <div className="space-y-16">
         
          {/* Level 1: Public (P2P Discovery) */}
          <section className={`space-y-8 ${['country', 'languages'].includes(activeDropdown!) ? 'relative z-[1000]' : 'z-auto'}`}>
             <div className="flex items-center gap-3 px-2">
                <div className="w-8 h-8 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-500">
                   <Edit2 size={16} />
                </div>
                <h3 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.3em]">Level 1 - Public Identity</h3>
             </div>
             
             <p className="text-[11px] text-gray-400 font-medium px-2">
               This information is shared publicly via P2P discovery beacons. It helps other users find and connect with you.
             </p>

             <div className="space-y-4">
                {/* Name Input */}
                <div className="group bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 p-8 rounded-[2.5rem] shadow-lg shadow-black/5 hover:scale-[1.01] hover:border-primary-500/30 transition-all">
                   <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 ml-1">Alias / Name</label>
                   <input
                     type="text"
                     value={name}
                     onChange={(e) => setName(e.target.value)}
                     onBlur={handleSaveName}
                     className="w-full bg-transparent text-xl font-black text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-gray-700 uppercase tracking-tighter"
                     placeholder="Enter your name"
                   />
                   <p className="mt-2 text-[9px] font-black uppercase tracking-widest text-primary-500/60 ml-1">Visible to your contacts and discovered peers</p>
                </div>

                {/* Bio Area */}
                <div className="group bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 p-8 rounded-[2.5rem] shadow-lg shadow-black/5 hover:scale-[1.01] hover:border-primary-500/30 transition-all">
                   <div className="flex justify-between items-center mb-3 ml-1">
                      <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Biography</label>
                      <span className={`text-[10px] font-black ${bio.length > 250 ? 'text-rose-500' : 'text-gray-400'}`}>{bio.length}/280</span>
                   </div>
                   <textarea
                     value={bio}
                     onChange={(e) => setBio(e.target.value)}
                     onBlur={handleSaveP2pBio}
                     rows={4}
                     maxLength={280}
                     className="w-full bg-transparent text-base font-medium text-gray-700 dark:text-gray-300 outline-none resize-none placeholder:text-gray-300 dark:placeholder:text-gray-700 leading-relaxed italic"
                     placeholder="Tell others about yourself..."
                   />
                   <p className="mt-2 text-[9px] font-black uppercase tracking-widest text-gray-500/60 ml-1">Shared with all discovered peers • Auto-saves</p>
                </div>

                {/* Region Selection */}
                <div className={`group bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 p-8 rounded-[2.5rem] shadow-lg shadow-black/5 hover:scale-[1.01] hover:border-primary-500/30 transition-all ${activeDropdown === 'country' ? 'relative z-[1200] ring-2 ring-primary-500/20' : 'z-auto'}`}>
                   <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 ml-1">Country / Region</label>
                   
                   <SearchableDropdown 
                     id="country"
                     activeId={activeDropdown}
                     onToggle={(open) => setActiveDropdown(open ? 'country' : null)}
                     options={COUNTRIES}
                     value={country}
                     onChange={(val) => {
                       setCountry(val);
                       handleSaveExtendedProfile({ country: val });
                     }}
                     placeholder="Select a country..."
                   />
                   
                   <p className="mt-3 text-[9px] font-black uppercase tracking-widest text-gray-500/60 ml-1">Shared with all discovered peers • Auto-saves</p>
                </div>

                {/* Languages Selector */}
                <div className={`group bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 p-8 rounded-[2.5rem] shadow-lg shadow-black/5 hover:scale-[1.01] hover:border-primary-500/30 transition-all ${activeDropdown === 'languages' ? 'relative z-[1200] ring-2 ring-primary-500/20' : 'z-auto'}`}>
                   <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 ml-1">Preferred Languages</label>
                   <div className="flex flex-wrap gap-2 mb-4">
                      {languages.map((lang) => (
                        <span key={lang} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-lg shadow-primary-500/20">
                          {lang}
                          <button onClick={() => {
                             const newLangs = languages.filter(l => l !== lang);
                             setLanguages(newLangs);
                             handleSaveExtendedProfile({ languages: newLangs });
                          }} className="hover:scale-125 transition-transform"><X size={12} strokeWidth={3} /></button>
                        </span>
                      ))}
                      {languages.length === 0 && <span className="text-[10px] font-black uppercase text-gray-400 py-1.5">No selection</span>}
                   </div>
                   <SearchableDropdown 
                     id="languages"
                     activeId={activeDropdown}
                     onToggle={(open) => setActiveDropdown(open ? 'languages' : null)}
                     options={LANGUAGES.filter(l => !languages.includes(l))}
                     value=""
                     onChange={(lang) => {
                        const newLangs = [...languages, lang];
                        setLanguages(newLangs);
                        handleSaveExtendedProfile({ languages: newLangs });
                     }}
                     placeholder="Add Language..."
                     emptyMessage="All languages selected"
                   />
                   
                   <p className="mt-3 text-[9px] font-black uppercase tracking-widest text-gray-500/60 ml-1">Shared with all discovered peers • Auto-saves</p>
                </div>
             </div>
          </section>

      {/* Level 2: Semi-Private + Level 3: Private Column */}
      <div className={`space-y-12 ${['level2', 'level3'].includes(activeDropdown!) ? 'relative z-[1000]' : 'z-auto'}`}>
        
        {/* Level 2: Additional Information */}
        <section className={`space-y-8 ${activeDropdown === 'level2' ? 'relative z-[1100]' : 'z-auto'}`}>
          <div className="flex items-center justify-between px-2">
             <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                   <Globe size={16} />
                </div>
                <h3 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.3em]">Level 2 - Semi-Private Info</h3>
                <Link 
                  to="/settings/privacy" 
                  className="ml-2 px-3 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase tracking-widest rounded-full hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
                >
                  Manage Privacy
                </Link>
             </div>
             <VisibilityDropdown 
                id="level2"
                activeId={activeDropdown}
                onToggle={(open) => setActiveDropdown(open ? 'level2' : null)}
                value={level2Visibility} 
                onChange={(v) => handleSaveExtendedProfile({ level2Visibility: v })} 
              />
          </div>


        <p className="text-[11px] text-gray-400 font-medium px-2 pb-2">
          You can control who sees this information in the Privacy tab.
        </p>

        <div className={`space-y-6 ${activeDropdown === 'level2' ? 'relative z-[1200]' : 'z-auto'}`}>
           {/* City / Region */}
           <div className="group bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 p-8 rounded-[2.5rem] shadow-lg shadow-black/5 hover:scale-[1.01] hover:border-primary-500/30 transition-all">
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 ml-1">City / Region</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onBlur={() => handleSaveExtendedProfile()}
                className="w-full bg-transparent text-sm font-black text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-gray-700"
                placeholder="Barcelona, New York, etc."
              />
           </div>

           {/* Website */}
           <div className="group bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 p-8 rounded-[2.5rem] shadow-lg shadow-black/5 hover:scale-[1.01] hover:border-primary-500/30 transition-all">
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 ml-1">Website</label>
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                onBlur={() => handleSaveExtendedProfile()}
                className="w-full bg-transparent text-sm font-black text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-gray-700"
                placeholder="https://example.com"
              />
           </div>

           {/* Social Group Bubble */}
           <div className="group bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 p-8 rounded-[2.5rem] shadow-lg shadow-black/5 hover:border-primary-500/30 transition-all space-y-6">
              <div className="flex items-center gap-3 mb-2 ml-1">
                 <div className="w-8 h-8 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-500">
                    <Twitter size={16} />
                 </div>
                 <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Social Connections</h4>
              </div>

              <div className="space-y-6">
                 {/* Twitter */}
                 <div className="space-y-1.5 px-1">
                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 ml-1">Twitter / X</label>
                    <input
                      type="text"
                      value={socialLinks.twitter}
                      onChange={(e) => setSocialLinks({...socialLinks, twitter: e.target.value})}
                      onBlur={() => handleSaveExtendedProfile()}
                      className="w-full bg-black/5 dark:bg-white/5 px-4 py-3 rounded-2xl text-sm font-black text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-gray-700 border border-transparent focus:border-primary-500/20 transition-all"
                      placeholder="@username"
                    />
                 </div>

                 {/* LinkedIn */}
                 <div className="space-y-1.5 px-1">
                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 ml-1">LinkedIn</label>
                    <input
                      type="text"
                      value={socialLinks.linkedin}
                      onChange={(e) => setSocialLinks({...socialLinks, linkedin: e.target.value})}
                      onBlur={() => handleSaveExtendedProfile()}
                      className="w-full bg-black/5 dark:bg-white/5 px-4 py-3 rounded-2xl text-sm font-black text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-gray-700 border border-transparent focus:border-primary-500/20 transition-all"
                      placeholder="profile URL or ID"
                    />
                 </div>

                 {/* GitHub */}
                 <div className="space-y-1.5 px-1">
                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 ml-1">GitHub</label>
                    <input
                      type="text"
                      value={socialLinks.github}
                      onChange={(e) => setSocialLinks({...socialLinks, github: e.target.value})}
                      onBlur={() => handleSaveExtendedProfile()}
                      className="w-full bg-black/5 dark:bg-white/5 px-4 py-3 rounded-2xl text-sm font-black text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-gray-700 border border-transparent focus:border-primary-500/20 transition-all"
                      placeholder="github-username"
                    />
                 </div>
              </div>
           </div>
        </div>
      </section>

      {/* Level 3: Private Contact Information */}
      <section className={`space-y-8 ${activeDropdown === 'level3' ? 'relative z-[1100]' : 'z-auto'}`}>
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                <Shield size={16} />
             </div>
             <h3 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.3em]">Level 3 - Private Details</h3>
             <Link 
                to="/settings/privacy" 
                className="ml-2 px-3 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px] font-black uppercase tracking-widest rounded-full hover:bg-amber-500 hover:text-white transition-all shadow-sm"
              >
                Manage Privacy
              </Link>
          </div>
          <VisibilityDropdown 
            id="level3"
            activeId={activeDropdown}
            onToggle={(open) => setActiveDropdown(open ? 'level3' : null)}
            value={level3Visibility} 
            onChange={(v) => handleSaveExtendedProfile({ level3Visibility: v })} 
          />
        </div>

        <p className="text-[11px] text-gray-400 font-medium px-2 pb-2">
          You can control who sees this information in the Privacy tab.
        </p>

        <div className={`space-y-6 ${activeDropdown === 'level3' ? 'relative z-[1200]' : 'z-auto'}`}>
           {/* Email */}
           <div className="group bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 p-8 rounded-[2.5rem] shadow-lg shadow-black/5 hover:scale-[1.01] hover:border-primary-500/30 transition-all">
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-2 ml-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => handleSaveExtendedProfile()}
                className="w-full bg-transparent text-sm font-black text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-gray-700"
                placeholder="your@email.com"
              />
           </div>

           {/* Phone */}
           <div className="group bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 p-8 rounded-[2.5rem] shadow-lg shadow-black/5 hover:scale-[1.01] hover:border-primary-500/30 transition-all">
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-2 ml-1">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => handleSaveExtendedProfile()}
                className="w-full bg-transparent text-sm font-black text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-gray-700"
                placeholder="+1 234 567 8900"
              />
           </div>
        </div>

        {/* Addresses Accordions */}
        <div className="space-y-2">
           {/* Maxima */}
           <div className={`bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 rounded-[2.5rem] transition-all overflow-hidden shadow-lg shadow-black/5 ${expandedAddress === 'maxima' ? 'ring-2 ring-indigo-500/20' : ''}`}>
              <button onClick={() => toggleAddress('maxima')} className="w-full flex items-center justify-between p-6 hover:bg-black/5 transition-colors text-left">
                 <div className="flex items-center gap-3">
                    <Zap size={18} className="text-indigo-500" />
                    <span className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">Maxima Address</span>
                 </div>
                 {expandedAddress === 'maxima' ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
              {expandedAddress === 'maxima' && (
                 <div className="px-6 pb-6 animate-in slide-in-from-top-2">
                    <div className="bg-black/5 dark:bg-white/5 p-4 rounded-2xl border border-black/5 mb-4 group/addr">
                       <p className="text-[10px] font-mono text-gray-500 break-all leading-relaxed group-hover/addr:text-indigo-500 transition-colors">
                          {myPublicKey || "Unresolved"}
                       </p>
                    </div>
                    <button onClick={() => copyToClipboard(myPublicKey, 'maxima')} className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${copiedField === 'maxima' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500 hover:text-white shadow-lg shadow-indigo-500/10'}`}>
                       {copiedField === 'maxima' ? <Check size={16} /> : <Copy size={16} />}
                       {copiedField === 'maxima' ? 'Copied' : 'Copy Public Key'}
                    </button>
                 </div>
              )}
           </div>

           {/* Minima */}
           <div className={`bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 rounded-[2.5rem] transition-all overflow-hidden shadow-lg shadow-black/5 ${expandedAddress === 'minima' ? 'ring-2 ring-amber-500/20' : ''}`}>
              <button onClick={() => toggleAddress('minima')} className="w-full flex items-center justify-between p-6 hover:bg-black/5 transition-colors text-left">
                 <div className="flex items-center gap-3">
                    <Network size={18} className="text-amber-500" />
                    <span className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">Minima L3 Address</span>
                 </div>
                 {expandedAddress === 'minima' ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
              {expandedAddress === 'minima' && (
                 <div className="px-6 pb-6 animate-in slide-in-from-top-2">
                    <div className="bg-black/5 dark:bg-white/5 p-4 rounded-2xl border border-black/5 mb-4 group/addr">
                       <p className="text-[10px] font-mono text-gray-500 break-all leading-relaxed group-hover/addr:text-amber-500 transition-colors">
                          {minimaAddress || "Unresolved"}
                       </p>
                    </div>
                    <button onClick={() => copyToClipboard(minimaAddress, 'minima')} className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${copiedField === 'minima' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-amber-500/10 text-amber-600 hover:bg-amber-500 hover:text-white shadow-lg shadow-amber-500/10'}`}>
                       {copiedField === 'minima' ? <Check size={16} /> : <Copy size={16} />}
                       {copiedField === 'minima' ? 'Copied' : 'Copy Address'}
                    </button>
                 </div>
              )}
           </div>
         </div>
       </section>
      </div>
    </div>

      <div className="flex flex-col items-center justify-center gap-4 pt-10 border-t border-black/5 dark:border-white/5">
         <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-gray-400">
            <Shield size={14} className="text-emerald-500" />
            End-to-End Encrypted Identity
         </div>
         <p className="text-[9px] text-gray-400 text-center max-w-xs font-medium">MetaChain profiles are decentralized and stored on your Minima node. Beacons update your neighbors every 30 seconds.</p>
      </div>
    </div>
  );
}
