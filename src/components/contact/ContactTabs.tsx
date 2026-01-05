import { User, Settings, Database } from 'lucide-react';

export type ContactTab = 'profile' | 'settings' | 'tech';

interface ContactTabsProps {
    activeTab: ContactTab;
    onTabChange: (tab: ContactTab) => void;
}

export function ContactTabs({ activeTab, onTabChange }: ContactTabsProps) {
    const tabs = [
        { id: 'profile' as ContactTab, label: 'Profile', icon: User },
        { id: 'settings' as ContactTab, label: 'Actions', icon: Settings },
        { id: 'tech' as ContactTab, label: 'Tech Data', icon: Database },
    ];

    return (
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10 mb-6">
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
                                        ? 'border-blue-600 text-blue-600 bg-blue-50/30'
                                        : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300 hover:bg-gray-50'
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
