import { User, Shield, Globe, Network, Paintbrush, ChevronRight } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useAppContext } from '../AppContext';

export const SETTINGS_TABS = [
    {
        to: '/settings/profile',
        label: 'Profile',
        icon: User,
        description: 'Manage your personal identity, avatar, and bio.'
    },
    {
        to: '/settings/appearance',
        label: 'Appearance',
        icon: Paintbrush,
        description: 'Customize the look and feel of the application.'
    },
    {
        to: '/settings/privacy',
        label: 'Privacy',
        icon: Shield,
        description: 'Control who can see your profile and contact information.'
    },
    {
        to: '/settings/discovery',
        label: 'Discovery',
        icon: Globe,
        description: 'Manage peer discovery and network visibility settings.'
    },
    {
        to: '/settings/network',
        label: 'Network',
        icon: Network,
        description: 'View connection status and network diagnostics.'
    },
    {
        to: '/settings/connect',
        label: 'Connect App',
        icon: User, // Reusing User or maybe another icon ideally, but let's stick to simple
        description: 'Manually connect to your Minima node (APK).'
    },
];

interface SettingsTabsProps {
    vertical?: boolean;
}

export function SettingsTabs({ vertical }: SettingsTabsProps) {
    const { sessionExpired } = useAppContext();

    // If vertical (mobile menu mode)
    if (vertical) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {SETTINGS_TABS.map((tab) => {
                    const Icon = tab.icon;
                    // Disable if session expired, UNLESS it's Connect or Network
                    const isDisabled = sessionExpired && tab.to !== '/settings/connect' && tab.to !== '/settings/network';

                    return (
                        <Link
                            key={tab.to}
                            to={tab.to}
                            disabled={isDisabled}
                            className={`flex items-center p-4 transition-colors group ${isDisabled ? 'opacity-50 pointer-events-none grayscale' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                        >
                            <div className="w-10 h-10 rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 flex items-center justify-center mr-4 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/40 transition-colors">
                                <Icon size={20} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-0.5">
                                    {tab.label}
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                    {tab.description}
                                </p>
                            </div>
                            <ChevronRight size={18} className="text-gray-400 dark:text-gray-500 ml-2" />
                        </Link>
                    );
                })}
            </div>
        );
    }

    // Default Horizontal Tabs (Desktop)
    return (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 transition-colors">
            <div className="max-w-4xl mx-auto">
                <nav className="flex overflow-x-auto scrollbar-hide -mb-px">
                    {SETTINGS_TABS.map((tab) => {
                        const Icon = tab.icon;
                        // Disable if session expired, UNLESS it's Connect or Network
                        const isDisabled = sessionExpired && tab.to !== '/settings/connect' && tab.to !== '/settings/network';

                        return (
                            <Link
                                key={tab.to}
                                to={tab.to}
                                disabled={isDisabled}
                                className={`flex items-center justify-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-3 sm:py-4 font-medium text-xs sm:text-sm whitespace-nowrap border-b-2 transition-colors flex-1 sm:flex-none min-w-0 border-transparent text-gray-600 dark:text-gray-400 
                                    ${isDisabled
                                        ? 'opacity-50 pointer-events-none cursor-not-allowed'
                                        : 'hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                    }`}
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
