import {
  createFileRoute,
  Outlet,
  useLocation,
  Link,
} from "@tanstack/react-router";
import { SettingsTabs } from "../components/SettingsTabs";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: RouteComponent,
});

function RouteComponent() {
  const location = useLocation();
  const isSettingsRoot =
    location.pathname === "/settings" || location.pathname === "/settings/";

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 transition-colors overflow-x-hidden">
      {/* Mobile Back Button - Only show when NOT on root settings page */}
      {!isSettingsRoot && (
        <div className="md:hidden p-4 pb-0">
          <Link
            to="/settings"
            className="inline-flex items-center text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
          >
            <ArrowLeft size={16} className="mr-1" />
            Back to Settings
          </Link>
        </div>
      )}

      <div className="flex-none p-4 md:p-8 pb-0 hidden md:block">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Settings
        </h1>
        <SettingsTabs />
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
