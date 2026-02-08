import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { SettingsTabs } from '../../components/SettingsTabs';
import { useEffect } from 'react';
import { useAppContext } from '@/AppContext';

export const Route = createFileRoute('/settings/')({
    component: SettingsIndex
});

function SettingsIndex() {
    const navigate = useNavigate();
    const { sessionExpired } = useAppContext();

    useEffect(() => {
        // Only redirect on Desktop (> 768px)
        // On Mobile, we want to show the menu so they can choose Network or Connect
        if (window.innerWidth >= 768) {
            if (sessionExpired) {
                navigate({ to: '/settings/connect', replace: true });
            } else {
                navigate({ to: '/settings/profile', replace: true });
            }
        }
    }, [navigate, sessionExpired]);

    return (
        <div className="p-4 md:hidden">
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-4 px-1">Menu</h2>
            <SettingsTabs vertical />
        </div>
    );
}
