import { User, SlidersHorizontal } from 'lucide-react';

export type ChannelTab = 'profile' | 'settings';

interface ChannelTabsProps {
    activeTab: ChannelTab;
    onTabChange: (tab: ChannelTab) => void;
}

export function ChannelTabs({ activeTab, onTabChange }: ChannelTabsProps) {
    const tabs = [
        { id: 'profile' as ChannelTab, label: 'Registry Info', icon: User, color: 'primary' },
        { id: 'settings' as ChannelTab, label: 'Registry Settings', icon: SlidersHorizontal, color: 'sky' },
    ];

    return (
        <nav className="sticky top-0 z-40 w-full flex items-center justify-center border-b border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-3xl overflow-x-auto no-scrollbar scrollbar-hide px-3 sm:px-6">
            <div className="flex items-center gap-1 sm:gap-10">
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;
                    
                    const colors = {
                        primary: "text-primary-500 bg-primary-500 shadow-primary-500/50",
                        sky: "text-sky-500 bg-sky-500 shadow-sky-500/50",
                    }[tab.color] || "text-primary-500 bg-primary-500 shadow-primary-500/50";

                    const colorClass = colors.split(" ")[0];
                    const bgClass = colors.split(" ")[1];
                    const glowClass = colors.split(" ")[2];

                    return (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                            className={`relative px-8 py-5 sm:py-6 flex items-center gap-3 transition-all duration-300 group flex-shrink-0 ${
                                isActive ? colorClass : "text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <div className={`transition-all duration-500 ${isActive ? "scale-110" : "group-hover:scale-110"}`}>
                                <Icon size={18} strokeWidth={isActive ? 3 : 2.5} />
                            </div>
                            <span className="text-[11px] font-black tracking-[0.25em] uppercase">
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
