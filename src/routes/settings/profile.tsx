import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { MDS } from '@minima-global/mds';
import { useAppContext } from '../../AppContext';
import { User, Globe, Loader2, Info, Edit2, ChevronDown, ChevronUp, Copy, Check, Shield, X } from 'lucide-react';
import { sendBeacon } from '../../hooks/useBeaconSender';

export const Route = createFileRoute('/settings/profile')({
  component: RouteComponent,
});

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

function RouteComponent() {
  const { userName, userAvatar, myPublicKey, refreshProfile } = useAppContext();
  const [name, setName] = useState(userName);
  const [avatar, setAvatar] = useState(userAvatar);
  const [bio, setBio] = useState('');

  // UI State for Dialogs/Accordions

  const [showAvatarDialog, setShowAvatarDialog] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [expandedAddress, setExpandedAddress] = useState<'maxima' | 'minima' | null>(null);
  const [copiedField, setCopiedField] = useState<'maxima' | 'minima' | null>(null);
  const [minimaAddress, setMinimaAddress] = useState(""); // Needed for L3 accordion

  // Extended Profile State - Level 2 (Semi-Private)
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [website, setWebsite] = useState("");
  const [socialLinks, setSocialLinks] = useState({ twitter: "", linkedin: "", github: "" });

  // Extended Profile State - Level 3 (Private)
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

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
        const updateSelfSql = `UPDATE DISCOVERED_PEERS SET alias='${escapedName}' WHERE publickey='${pubkey}' AND source='SELF'`;
        // @ts-ignore
        MDS.sql(updateSelfSql);
      }

      await refreshProfile();
      sendBeacon().catch(console.error);
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
      setShowAvatarDialog(false);
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
      console.log("✅ [Profile] Avatar saved");
    } catch (error) {
      console.error("❌ [Profile] Failed to save avatar:", error);
    } finally {
      setIsSaving(false);
      setShowAvatarDialog(false);
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
        const updateSelfSql = `UPDATE DISCOVERED_PEERS SET bio='${escapedBio}' WHERE publickey='${pubkey}' AND source='SELF'`;
        // @ts-ignore
        MDS.sql(updateSelfSql);
      }
      sendBeacon().catch(console.error);
    } catch (error) {
      console.error("❌ [Profile] Failed to save bio:", error);
    }
  };

  // 4. Save Extended Profile (Auto-save)
  const handleSaveExtendedProfile = async (overrides?: any) => {
    const currentData = {
      location, country, languages, website, socialLinks, email, phone,
      ...overrides
    };

    try {
      await MDS.keypair.set('profile_location', currentData.location.trim());
      await MDS.keypair.set('profile_country', currentData.country.trim());
      await MDS.keypair.set('profile_languages', JSON.stringify(currentData.languages));
      await MDS.keypair.set('profile_website', currentData.website.trim());
      await MDS.keypair.set('profile_social_links', JSON.stringify(currentData.socialLinks));
      await MDS.keypair.set('profile_email', currentData.email.trim());
      await MDS.keypair.set('profile_phone', currentData.phone.trim());

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
                  LAST_UPDATED = ${Date.now()}
                WHERE id = 1
            `;
      // @ts-ignore
      MDS.sql(updateProfileSql);
      sendBeacon().catch(console.error);

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


  return (
    <div className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">



      {/* Edit Avatar Dialog */}
      {showAvatarDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-96 max-w-full mx-4">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Edit Avatar</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Image</label>
              <input type="file" accept="image/*" onChange={handleAvatarFileSelect} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            {avatarUrl && (
              <div className="mb-4 flex justify-center">
                <img src={avatarUrl} alt="Preview" className="w-24 h-24 rounded-full object-cover border-2 border-gray-200 dark:border-gray-600" />
              </div>
            )}
            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowAvatarDialog(false)} className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors">Cancel</button>
              <button onClick={handleSaveAvatar} disabled={isSaving} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-md transition-colors font-medium flex items-center gap-2">
                {isSaving && <Loader2 size={16} className="animate-spin" />} Save
              </button>
            </div>
          </div>
        </div>
      )}


      <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
        <div className="px-4 py-5 sm:p-6 space-y-8">

          {/* Header */}
          <div className="border-b border-gray-200 dark:border-gray-700 pb-4 flex items-center gap-3">
            <User className="text-primary-500" />
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Profile</h2>
          </div>

          {/* Level 1: Public Discovery Profile */}
          <div className="p-6 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Globe className="text-primary-500" size={20} />
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Discovery Profile (P2P)</h3>
              </div>
              <span className="px-3 py-1 bg-primary-100 text-primary-700 text-xs font-semibold rounded-full">Level 1 - Public</span>
            </div>

            <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800/50 rounded-lg p-3 text-sm text-primary-800 dark:text-primary-200 flex items-start gap-2 mb-6">
              <Info size={16} className="mt-0.5 flex-shrink-0" />
              <p>This information is shared publicly via P2P discovery beacons. It helps other users find and connect with you.</p>
            </div>

            <div className="space-y-6">
              {/* Identity Row */}
              <div className="flex items-center gap-4">
                <div className="relative">
                  <img
                    src={avatar}
                    alt="Avatar"
                    className="w-16 h-16 rounded-full object-cover border-4 border-gray-100 dark:border-gray-700"
                  />
                  <button
                    onClick={() => { setAvatarUrl(avatar); setShowAvatarDialog(true); }}
                    className="absolute -bottom-1 -right-1 p-1.5 bg-primary-600 text-white rounded-full hover:bg-primary-700 transition-colors shadow-lg"
                    title="Change Avatar"
                  >
                    <Edit2 size={12} />
                  </button>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Maxima Name</label>
                  <div className="relative group">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={handleSaveName}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') {
                          setName(userName);
                          e.currentTarget.blur();
                        }
                      }}
                      className="w-full text-lg font-bold text-gray-900 dark:text-white bg-transparent border border-transparent rounded px-1 -ml-1 hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all outline-none"
                      placeholder="Enter your name"
                    />
                    <Edit2 size={14} className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-gray-400 pointer-events-none transition-opacity" />
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Visible to your contacts and discovered peers</p>
                </div>
              </div>

              {/* Bio */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Bio</label>
                  <span className={`text-xs font-medium ${bio.length > 280 ? 'text-red-500' : 'text-gray-400'}`}>{bio.length}/280</span>
                </div>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  onBlur={handleSaveP2pBio}
                  placeholder="Tell others about yourself..."
                  rows={3}
                  maxLength={280}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white dark:bg-gray-700 text-gray-700 dark:text-white resize-none"
                />
                <p className="text-xs text-gray-500 mt-1">Shared with all discovered peers • Auto-saves</p>
              </div>

              {/* Country */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Country/Region</label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  onBlur={() => handleSaveExtendedProfile()}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-700 dark:text-white"
                >
                  <option value="">Select a country...</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">Shared with all discovered peers • Auto-saves</p>
              </div>

              {/* Languages */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Languages</label>
                <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-3 bg-white dark:bg-gray-700 max-h-48 overflow-y-auto">
                  <div className="grid grid-cols-2 gap-2">
                    {LANGUAGES.map((lang) => (
                      <label key={lang} className="flex items-center gap-2 cursor-pointer hover:bg-primary-50 dark:hover:bg-primary-900/10 p-1 rounded transition-colors">
                        <input
                          type="checkbox"
                          checked={languages.includes(lang)}
                          onChange={(e) => {
                            let newLangs;
                            if (e.target.checked) newLangs = [...languages, lang];
                            else newLangs = languages.filter(l => l !== lang);
                            setLanguages(newLangs);
                            handleSaveExtendedProfile({ languages: newLangs });
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-200">{lang}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {languages.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {languages.map((lang) => (
                      <span key={lang} className="inline-flex items-center gap-1 px-2 py-1 bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs rounded-full">
                        {lang}
                        <button
                          onClick={() => {
                            const newLangs = languages.filter(l => l !== lang);
                            setLanguages(newLangs);
                            handleSaveExtendedProfile({ languages: newLangs });
                          }}
                          className="hover:bg-primary-200 dark:hover:bg-primary-800 rounded-full p-0.5"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-1">Shared with all discovered peers • Auto-saves</p>
              </div>
            </div>
          </div>


          {/* Level 2: Semi-Private Information */}
          <div className="p-6 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <User className="text-purple-500" size={20} />
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Additional Information</h3>
              </div>
              <span className="px-3 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full">Level 2 - Semi-Private</span>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/50 rounded-lg p-3 text-sm text-purple-800 dark:text-purple-200 flex items-start gap-2 mb-4">
              <Info size={16} className="mt-0.5 flex-shrink-0" />
              <p>You can control who sees this information in the <strong>Privacy</strong> tab.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">City/Region</label>
                <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} onBlur={() => handleSaveExtendedProfile()} placeholder="Barcelona, New York, etc." className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white dark:bg-gray-700 text-gray-700 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Website</label>
                <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} onBlur={() => handleSaveExtendedProfile()} placeholder="https://example.com" className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white dark:bg-gray-700 text-gray-700 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Social Links</label>
                <div className="space-y-2">
                  <input type="text" value={socialLinks.twitter} onChange={(e) => setSocialLinks({ ...socialLinks, twitter: e.target.value })} onBlur={() => handleSaveExtendedProfile()} placeholder="Twitter/X username" className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white dark:bg-gray-700 text-gray-700 dark:text-white" />
                  <input type="text" value={socialLinks.linkedin} onChange={(e) => setSocialLinks({ ...socialLinks, linkedin: e.target.value })} onBlur={() => handleSaveExtendedProfile()} placeholder="LinkedIn profile URL" className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white dark:bg-gray-700 text-gray-700 dark:text-white" />
                  <input type="text" value={socialLinks.github} onChange={(e) => setSocialLinks({ ...socialLinks, github: e.target.value })} onBlur={() => handleSaveExtendedProfile()} placeholder="GitHub username" className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white dark:bg-gray-700 text-gray-700 dark:text-white" />
                </div>
              </div>
            </div>
          </div>


          {/* Level 3: Private Contact Information */}
          <div className="p-6 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield className="text-amber-600" size={20} />
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Private Contact Information</h3>
              </div>
              <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">Level 3 - Private</span>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg p-3 mb-4">
              <p className="text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <Info size={16} className="mt-0.5 flex-shrink-0" />
                <span>You can control who sees this information in the <strong>Privacy</strong> tab.</span>
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => handleSaveExtendedProfile()} placeholder="your@email.com" className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-amber-500 bg-white dark:bg-gray-700 text-gray-700 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Phone</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => handleSaveExtendedProfile()} placeholder="+1 234 567 8900" className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-amber-500 bg-white dark:bg-gray-700 text-gray-700 dark:text-white" />
              </div>
            </div>
          </div>


          {/* Maxima Address Accordion */}
          <div className="border-b border-gray-100 dark:border-gray-700">
            <button onClick={() => toggleAddress('maxima')} className="w-full flex items-center justify-between p-6 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left">
              <span className="font-medium text-gray-700 dark:text-gray-200">My Maxima Address</span>
              {expandedAddress === 'maxima' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
            </button>
            {expandedAddress === 'maxima' && (
              <div className="px-6 pb-6 pt-0">
                <p className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all mb-3 bg-gray-50 dark:bg-gray-900 p-3 rounded border border-gray-100 dark:border-gray-700">
                  {myPublicKey || "Loading..."}
                </p>
                <button onClick={() => copyToClipboard(myPublicKey, 'maxima')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copiedField === 'maxima' ? 'bg-green-100 text-green-700' : 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/40'}`}>
                  {copiedField === 'maxima' ? <Check size={16} /> : <Copy size={16} />}
                  {copiedField === 'maxima' ? 'Copied!' : 'Copy Address'}
                </button>
              </div>
            )}
          </div>

          {/* Minima Address Accordion */}
          <div>
            <button onClick={() => toggleAddress('minima')} className="w-full flex items-center justify-between p-6 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left">
              <span className="font-medium text-gray-700 dark:text-gray-200">My Minima Address</span>
              {expandedAddress === 'minima' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
            </button>
            {expandedAddress === 'minima' && (
              <div className="px-6 pb-6 pt-0">
                <p className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all mb-3 bg-gray-50 dark:bg-gray-900 p-3 rounded border border-gray-100 dark:border-gray-700">
                  {minimaAddress || "Loading..."}
                </p>
                <button onClick={() => copyToClipboard(minimaAddress, 'minima')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copiedField === 'minima' ? 'bg-green-100 text-green-700' : 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/40'}`}>
                  {copiedField === 'minima' ? <Check size={16} /> : <Copy size={16} />}
                  {copiedField === 'minima' ? 'Copied!' : 'Copy Address'}
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
