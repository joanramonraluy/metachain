import { Users, SlidersHorizontal } from 'lucide-react';

export type ChannelTab = 'profile' | 'settings';

interface ChannelTabsProps {
    activeTab: ChannelTab;
    onTabChange: (tab: ChannelTab) => void;
}

export function ChannelTabs({ activeTab, onTabChange }: ChannelTabsProps) {
    const tabs = [
        { id: 'profile' as ChannelTab, label: 'Info', icon: Users },
        { id: 'settings' as ChannelTab, label: 'Actions', icon: SlidersHorizontal },
    ];

    return (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-16 z-10 mb-6 transition-colors">
            <div className="max-w-4xl mx-auto">
                <nav className="flex overflow-x-auto scrollbar-hide -mb-px">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;

                        return (
                            <button
                                key={tab.id}
                                onClick={() => onTabChange(tab.id)}
                                className={`
                  flex items-center justify-center gap-2 
                  px-6 py-4 
                  font-medium text-sm whitespace-nowrap
                  border-b-2 transition-colors flex-1 sm:flex-none
                  ${isActive
                                        ? 'border-primary-600 text-primary-600 bg-primary-50/30 dark:bg-primary-900/20 dark:text-primary-400 dark:border-primary-400'
                                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                                    }
                `}
                            >
                                <Icon size={18} className="flex-shrink-0" />
                                <span className="truncate">{tab.label}</span>
                            </button>
                        );
                    })}
                </nav>
            </div>
        </div>
    );
}
