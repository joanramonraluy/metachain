import { User, Shield, Globe, Network, Paintbrush } from 'lucide-react';
import { Link } from '@tanstack/react-router';

export function SettingsTabs() {
    const tabs = [
        { to: '/settings/profile', label: 'Profile', icon: User },
        { to: '/settings/appearance', label: 'Appearance', icon: Paintbrush },
        { to: '/settings/privacy', label: 'Privacy', icon: Shield },
        { to: '/settings/discovery', label: 'Discovery', icon: Globe },
        { to: '/settings/network', label: 'Network', icon: Network },
    ];

    return (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 transition-colors">
            <div className="max-w-4xl mx-auto">
                <nav className="flex overflow-x-auto scrollbar-hide -mb-px">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;

                        return (
                            <Link
                                key={tab.to}
                                to={tab.to}
                                className="flex items-center justify-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-3 sm:py-4 font-medium text-xs sm:text-sm whitespace-nowrap border-b-2 transition-colors flex-1 sm:flex-none min-w-0 border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                                activeProps={{
                                    className: 'border-primary-600 text-primary-600 dark:text-primary-400 bg-primary-50/30 dark:bg-primary-900/10'
                                }}
                            >
                                <Icon size={16} className="flex-shrink-0 sm:w-[18px] sm:h-[18px]" />
                                <span className="truncate">{tab.label}</span>
                            </Link>
                        );
                    })}
                </nav>
            </div>
        </div>
    );
}
