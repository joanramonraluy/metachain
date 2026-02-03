import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { SettingsTabs } from '../../components/SettingsTabs';
import { useEffect } from 'react';

export const Route = createFileRoute('/settings/')({
    component: SettingsIndex
});

function SettingsIndex() {
    const navigate = useNavigate();

    useEffect(() => {
        // Simple check for desktop width (> 768px for md breakpoint)
        // If desktop, redirect to profile as we want the split view
        if (window.innerWidth >= 768) {
            navigate({ to: '/settings/profile', replace: true });
        }
    }, [navigate]);

    return (
        <div className="p-4 md:hidden">
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-4 px-1">Menu</h2>
            <SettingsTabs vertical />
        </div>
    );
}
