import { User, SlidersHorizontal, Database } from 'lucide-react';

export type ContactTab = 'profile' | 'settings' | 'tech';

interface ContactTabsProps {
    activeTab: ContactTab;
    onTabChange: (tab: ContactTab) => void;
}

export function ContactTabs({ activeTab, onTabChange }: ContactTabsProps) {
    const tabs = [
        { id: 'profile' as ContactTab, label: 'Profile', icon: User, color: 'primary' },
        { id: 'settings' as ContactTab, label: 'Security', icon: SlidersHorizontal, color: 'emerald' },
        { id: 'tech' as ContactTab, label: 'Network', icon: Database, color: 'sky' },
    ];

    return (
        <nav className="sticky top-0 z-40 w-full flex items-center justify-center border-b border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-3xl overflow-x-auto no-scrollbar scrollbar-hide px-3 sm:px-6">
            <div className="flex items-center gap-1 sm:gap-6">
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;
                    
                    const colors = {
                        primary: "text-primary-500 bg-primary-500 shadow-primary-500/50",
                        emerald: "text-emerald-500 bg-emerald-500 shadow-emerald-500/50",
                        sky: "text-sky-500 bg-sky-500 shadow-sky-500/50",
                    }[tab.color] || "text-primary-500 bg-primary-500 shadow-primary-500/50";

                    const colorClass = colors.split(" ")[0];
                    const bgClass = colors.split(" ")[1];
                    const glowClass = colors.split(" ")[2];

                    return (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                            className={`relative px-4 py-4 sm:py-5 flex items-center gap-2.5 transition-all duration-300 group flex-shrink-0 ${
                                isActive ? colorClass : "text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <div className={`transition-all duration-500 ${isActive ? "scale-110" : "group-hover:scale-110"}`}>
                                <Icon size={16} strokeWidth={isActive ? 3 : 2.5} />
                            </div>
                            <span className="hidden sm:inline text-[11px] font-black tracking-widest uppercase">
                                {tab.label}
                            </span>

                            {/* Underline Indicator */}
                            {isActive && (
                                <div className={`absolute bottom-0 left-0 right-0 h-1 rounded-full ${bgClass} shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${glowClass} animate-in fade-in zoom-in duration-500`} />
                            )}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
