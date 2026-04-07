import React from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';

interface ContactPrivacyProps {
    isPersonalContact: boolean;
    togglingPersonal: boolean;
    onTogglePersonal: () => void;
}

const ContactPrivacy: React.FC<ContactPrivacyProps> = ({
    isPersonalContact,
    togglingPersonal,
    onTogglePersonal,
}) => {
    return (
        <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[2.5rem] border border-white/20 dark:border-white/5 overflow-hidden shadow-lg shadow-black/5 p-8">
            <div className="flex items-center gap-3 mb-6">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${isPersonalContact ? 'bg-emerald-500/10 text-emerald-500' : 'bg-gray-100 dark:bg-white/5 text-gray-400'}`}>
                  <ShieldCheck size={18} />
                </div>
                <h3 className="text-xs font-black text-gray-900 dark:text-white uppercase tracking-widest leading-none">Privacy Permissions</h3>
            </div>

            <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                        <span className={`text-xs font-black uppercase tracking-tight transition-colors ${isPersonalContact ? 'text-emerald-500' : 'text-gray-900 dark:text-gray-100'}`}>
                          Personal Status
                        </span>
                    </div>
                    <p className="text-[10px] text-gray-500 font-bold leading-relaxed px-0.5">
                        {isPersonalContact 
                          ? "This node is marked as trusted. They can view your Level 3 private profile data." 
                          : "This node only has access to your public decentralized identity (Level 1 & 2)."}
                    </p>
                </div>
                
                <button
                    onClick={onTogglePersonal}
                    disabled={togglingPersonal}
                    className={`
                        relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300
                        focus:outline-none focus:ring-4 focus:ring-emerald-500/10 disabled:opacity-50
                        ${isPersonalContact ? 'bg-emerald-500 shadow-lg shadow-emerald-500/20' : 'bg-gray-200 dark:bg-gray-800'}
                    `}
                >
                    <span
                        className={`
                            inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300
                            ${isPersonalContact ? 'translate-x-6' : 'translate-x-1'}
                        `}
                    />
                </button>
            </div>
            
            {!isPersonalContact && (
              <div className="mt-6 p-3 bg-primary-500/5 border border-primary-500/10 rounded-xl flex items-start gap-3">
                 <ShieldAlert size={14} className="text-primary-500 mt-0.5 flex-shrink-0" />
                 <p className="text-[9px] font-black uppercase tracking-widest text-primary-600/80 leading-normal">
                   Promote to Personal Contact to share private details like phone or physical location.
                 </p>
              </div>
            )}
        </div>
    );
};

export default ContactPrivacy;
