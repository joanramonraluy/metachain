import { User, Shield, Globe, Network, Paintbrush } from 'lucide-react';

export type SettingsTab = 'profile' | 'appearance' | 'privacy' | 'discovery' | 'network';

interface SettingsTabsProps {
    activeTab: SettingsTab;
    onTabChange: (tab: SettingsTab) => void;
}

export function SettingsTabs({ activeTab, onTabChange }: SettingsTabsProps) {
    const tabs = [
        { id: 'profile' as SettingsTab, label: 'Profile', icon: User },
        { id: 'appearance' as SettingsTab, label: 'Appearance', icon: Paintbrush },
        { id: 'privacy' as SettingsTab, label: 'Privacy', icon: Shield },
        { id: 'discovery' as SettingsTab, label: 'Discovery', icon: Globe },
        { id: 'network' as SettingsTab, label: 'Network', icon: Network },
    ];

    return (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 transition-colors">
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
                  flex items-center justify-center gap-1.5 sm:gap-2 
                  px-4 sm:px-6 py-3 sm:py-4 
                  font-medium text-xs sm:text-sm whitespace-nowrap
                  border-b-2 transition-colors flex-1 sm:flex-none min-w-0
                  ${isActive
                                        ? 'border-primary-600 text-primary-600 dark:text-primary-400 bg-primary-50/30 dark:bg-primary-900/10'
                                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                    }
                `}
                            >
                                <Icon size={16} className="flex-shrink-0 sm:w-[18px] sm:h-[18px]" />
                                <span className="truncate">{tab.label}</span>
                            </button>
                        );
                    })}
                </nav>
            </div>
        </div>
    );
}
