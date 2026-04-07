import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect, useRef } from 'react';
import { MDS } from '@minima-global/mds';
import { useAppContext } from '../../AppContext';
import { Shield, Globe, Edit2, ChevronDown, Zap, Lock, Info } from 'lucide-react';

export const Route = createFileRoute('/settings/privacy')({
  component: RouteComponent,
});

type VisibilityLevel = 'public' | 'contacts' | 'personal';

function RouteComponent() {
  const { writeMode } = useAppContext();
  const [level2Visibility, setLevel2Visibility] = useState<VisibilityLevel>('public');
  const [level3Visibility, setLevel3Visibility] = useState<VisibilityLevel>('personal');
  const [allowNonContactChats, setAllowNonContactChats] = useState(true);
  const [_loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      try {
        const l2 = await MDS.keypair.get('profile_privacy_level_2');
        if (l2 && l2.status && l2.value) setLevel2Visibility(l2.value as VisibilityLevel);

        const l3 = await MDS.keypair.get('profile_privacy_level_3');
        if (l3 && l3.status && l3.value) setLevel3Visibility(l3.value as VisibilityLevel);

        const chats = await MDS.keypair.get('allow_noncontact_chats');
        if (chats && chats.status && chats.value !== "") {
          setAllowNonContactChats(chats.value === "true");
        }
      } catch (e) {
        console.error("Failed to load privacy settings", e);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleSavePrivacySettings = async (l2?: VisibilityLevel, l3?: VisibilityLevel) => {
    setSaving(true);
    try {
      if (l2) {
        await MDS.keypair.set('profile_privacy_level_2', l2);
        // @ts-ignore
        MDS.sql(`UPDATE MY_PROFILE SET privacy_l2 = '${l2}' WHERE id = 1`);
      }
      if (l3) {
        await MDS.keypair.set('profile_privacy_level_3', l3);
        // @ts-ignore
        MDS.sql(`UPDATE MY_PROFILE SET privacy_l3 = '${l3}' WHERE id = 1`);
      }
    } catch (e) {
      console.error("Failed to save privacy settings", e);
    } finally {
      setSaving(false);
    }
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
              : 'bg-black/5 dark:bg-white/5 text-gray-500 hover:text-primary-500 hover:bg-primary-500/10 shadow-sm'
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

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const handleToggleChatPermission = async () => {
    const newValue = !allowNonContactChats;
    setAllowNonContactChats(newValue);
    setSaving(true);
    try {
      await MDS.keypair.set('allow_noncontact_chats', newValue ? "true" : "false");
      // @ts-ignore
      await MDS.sql(`UPDATE MY_PROFILE SET allow_non_contact_chats = ${newValue} WHERE id = 1`);
    } catch (e) {
      console.error("Failed to save chat permission", e);
      setAllowNonContactChats(!newValue);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
      
      {/* Unified Header */}
      <div className="flex items-center gap-4">
         <div className="w-12 h-12 rounded-[1.25rem] bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Shield className="text-white" size={24} strokeWidth={2.5} />
         </div>
         <div>
            <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Privacy</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Control who can access your decentralized data.</p>
         </div>
      </div>

      <div className="grid grid-cols-1 gap-12">
        {/* DM Permissions Section */}
        <section className="bg-white/40 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/10 p-8 rounded-[3rem] shadow-xl space-y-6">
           <div className="flex items-center justify-between">
              <div className="space-y-1">
                 <h3 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.3em]">CHATS & MESSAGING</h3>
                 <p className="text-xl font-black text-gray-900 dark:text-white">Allow Direct Messages</p>
              </div>
              <button
                onClick={handleToggleChatPermission}
                disabled={saving}
                className={`relative w-16 h-8 rounded-full transition-all duration-300 ${allowNonContactChats ? 'bg-primary-500 shadow-lg shadow-primary-500/40' : 'bg-gray-200 dark:bg-gray-800'}`}
              >
                <div className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow-sm transition-all duration-300 ${allowNonContactChats ? 'translate-x-8' : 'translate-x-0'}`}>
                   {saving && <div className="absolute inset-0 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>}
                </div>
              </button>
           </div>
           <div className="p-5 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 leading-relaxed">
                 {allowNonContactChats 
                   ? "Anyone in the decentralized network can start a chat with you. You'll receive messages directly in your inbox." 
                   : "Only your confirmed contacts can send you messages. Strangers must send a request first."
                 }
              </p>
           </div>
        </section>

        {/* Visibility Tiers Zone */}
        <section className={`space-y-8 ${['level2', 'level3'].includes(activeDropdown!) ? 'relative z-[1000]' : 'z-auto'}`}>
           <div className="flex items-center gap-4 px-2">
              <div className="w-12 h-12 rounded-[1.25rem] bg-emerald-500/10 flex items-center justify-center text-emerald-500 shadow-lg shadow-emerald-500/5">
                 <Globe size={24} strokeWidth={2.5} />
              </div>
              <div>
                 <h2 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">Visibility Tiers</h2>
                 <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Control the visibility of your profile information.</p>
              </div>
           </div>

           {/* Tier Overview Card */}
           <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-[3rem] blur opacity-10 group-hover:opacity-20 transition duration-1000"></div>
              <div className="relative bg-white/40 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/10 p-8 rounded-[3rem] overflow-hidden space-y-6">
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Level 1 Overview */}
                    <div className="space-y-3">
                       <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-primary-500/10 flex items-center justify-center text-primary-500">
                             <Edit2 size={12} strokeWidth={3} />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-500">Public - L1</span>
                       </div>
                       <p className="text-[11px] font-black uppercase tracking-widest text-gray-900 dark:text-white">Discovery Data</p>
                       <div className="flex flex-wrap gap-1">
                          {['Alias', 'Bio', 'Region', 'Languages'].map(tag => (
                             <span key={tag} className="px-2 py-0.5 bg-black/5 dark:bg-white/5 rounded-md text-[9px] font-black uppercase text-gray-400">{tag}</span>
                          ))}
                       </div>
                    </div>

                    {/* Level 2 Overview */}
                    <div className="space-y-3">
                       <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                             <Globe size={12} strokeWidth={3} />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500">Semi-Private - L2</span>
                       </div>
                       <p className="text-[11px] font-black uppercase tracking-widest text-gray-900 dark:text-white">Extended Info</p>
                       <div className="flex flex-wrap gap-1">
                          {['City', 'Website', 'Socials'].map(tag => (
                             <span key={tag} className="px-2 py-0.5 bg-black/5 dark:bg-white/5 rounded-md text-[9px] font-black uppercase text-gray-400">{tag}</span>
                          ))}
                       </div>
                    </div>

                    {/* Level 3 Overview */}
                    <div className="space-y-3">
                       <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500">
                             <Shield size={12} strokeWidth={3} />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">Private - L3</span>
                       </div>
                       <p className="text-[11px] font-black uppercase tracking-widest text-gray-900 dark:text-white">Sensitive Data</p>
                       <div className="flex flex-wrap gap-1">
                          {['Email', 'Phone', 'Addresses'].map(tag => (
                             <span key={tag} className="px-2 py-0.5 bg-black/5 dark:bg-white/5 rounded-md text-[9px] font-black uppercase text-gray-400">{tag}</span>
                          ))}
                       </div>
                    </div>
                 </div>
              </div>
           </div>

           {/* Tier Controls Zone */}
           <div className={`space-y-4 ${['level2', 'level3'].includes(activeDropdown!) ? 'relative z-[1100]' : 'z-auto'}`}>
              {/* Level 2 Control Card */}
              <div className={`bg-white/70 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/10 p-6 rounded-[2.5rem] shadow-sm flex items-center justify-between hover:shadow-xl hover:border-emerald-500/20 transition-all ${activeDropdown === 'level2' ? 'relative z-[1200] ring-2 ring-emerald-500/20' : 'z-auto'}`}>
                 <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                       <Globe size={20} strokeWidth={2.5} />
                    </div>
                    <div>
                       <h4 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider mb-0.5">Semi-Private Visibility</h4>
                       <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 leading-none">Who can see City, Website and Socials</p>
                    </div>
                 </div>
                 <VisibilityDropdown 
                   id="level2"
                   activeId={activeDropdown}
                   onToggle={(open) => setActiveDropdown(open ? 'level2' : null)}
                   value={level2Visibility} 
                   onChange={(val) => { setLevel2Visibility(val); handleSavePrivacySettings(val, undefined); }} 
                 />
              </div>

              {/* Level 3 Control Card */}
              <div className={`bg-white/70 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/10 p-6 rounded-[2.5rem] shadow-sm flex items-center justify-between hover:shadow-xl hover:border-amber-500/20 transition-all ${activeDropdown === 'level3' ? 'relative z-[1200] ring-2 ring-amber-500/20' : 'z-auto'}`}>
                 <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                       <Shield size={20} strokeWidth={2.5} />
                    </div>
                    <div>
                       <h4 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider mb-0.5">Private Visibility</h4>
                       <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 leading-none">Who can see Email, Phone and Addresses</p>
                    </div>
                 </div>
                 <VisibilityDropdown 
                   id="level3"
                   activeId={activeDropdown}
                   onToggle={(open) => setActiveDropdown(open ? 'level3' : null)}
                   value={level3Visibility} 
                   onChange={(val) => { setLevel3Visibility(val); handleSavePrivacySettings(undefined, val); }} 
                 />
              </div>
           </div>
         </section>
      </div>

      {/* Permissions & Mode Status */}
      <div className="pt-4">
         <div className="bg-white/40 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/10 p-8 rounded-[3rem] space-y-6">
            {/* Application Mode Section */}
            <div className="flex items-start gap-4">
               <div className="w-12 h-12 rounded-2xl bg-primary-500/10 flex items-center justify-center text-primary-500 shadow-inner shrink-0 text-primary-600 dark:text-primary-400">
                  <Zap size={22} strokeWidth={2.5} />
               </div>
               <div className="space-y-1">
                  <div className="flex items-center gap-2">
                     <h4 className="text-base font-black text-gray-900 dark:text-white leading-tight">Application Mode</h4>
                     <span className="px-2 py-0.5 bg-primary-500/10 text-primary-600 dark:text-primary-400 text-[8px] font-black uppercase rounded-md tracking-widest border border-primary-500/10">Active</span>
                  </div>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400 leading-relaxed">
                     MiniDapp permissions for transactions are correctly configured for decentralized interactions.
                  </p>
               </div>
            </div>

            <div className="h-px bg-black/5 dark:bg-white/5 w-full"></div>

            {/* Read/Write Status Section */}
            {!writeMode ? (
              <div className="flex items-start gap-4 animate-in fade-in slide-in-from-left-4 duration-500">
                 <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center text-amber-500 shadow-inner shrink-0">
                    <Lock size={22} strokeWidth={2.5} />
                 </div>
                 <div className="space-y-1">
                    <h4 className="text-base font-black text-amber-700 dark:text-amber-200 leading-tight">Read Only Mode</h4>
                    <p className="text-sm font-medium text-amber-600/80 dark:text-amber-400/60 leading-relaxed max-w-xl">
                       This MiniDapp is in Read Only mode. You cannot perform write operations or update your profile.
                    </p>
                 </div>
              </div>
            ) : (
              <div className="flex items-start gap-4 animate-in fade-in slide-in-from-left-4 duration-500">
                 <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center text-emerald-500 shadow-inner shrink-0">
                    <Info size={22} strokeWidth={2.5} />
                 </div>
                 <div className="space-y-1 text-emerald-700 dark:text-emerald-300">
                    <h4 className="text-base font-black leading-tight">Interactive Mode</h4>
                    <p className="text-sm font-medium text-emerald-600/80 dark:text-emerald-400/60 leading-relaxed max-w-xl">
                       Full write permissions active. You can update your profile, send messages and interact with all services.
                    </p>
                 </div>
              </div>
            )}
         </div>
      </div>
    </div>
  );
}
