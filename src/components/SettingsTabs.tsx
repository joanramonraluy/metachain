import { User, Shield, Globe, Settings } from 'lucide-react';

export type SettingsTab = 'profile' | 'privacy' | 'discovery' | 'advanced';

interface SettingsTabsProps {
    activeTab: SettingsTab;
    onTabChange: (tab: SettingsTab) => void;
}

export function SettingsTabs({ activeTab, onTabChange }: SettingsTabsProps) {
    const tabs = [
        { id: 'profile' as SettingsTab, label: 'Profile', icon: User },
        { id: 'privacy' as SettingsTab, label: 'Privacy', icon: Shield },
        { id: 'discovery' as SettingsTab, label: 'Discovery', icon: Globe },
        { id: 'advanced' as SettingsTab, label: 'Advanced', icon: Settings },
    ];

    return (
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
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
                                        ? 'border-blue-600 text-blue-600 bg-blue-50/30'
                                        : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300 hover:bg-gray-50'
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
