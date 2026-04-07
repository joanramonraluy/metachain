import {
  createFileRoute,
  Outlet,
} from "@tanstack/react-router";
import { SettingsTabs } from "../components/SettingsTabs";

export const Route = createFileRoute("/settings")({
  component: RouteComponent,
});

function RouteComponent() {

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 transition-colors relative overflow-hidden">
      {/* Dot Grid Background (consistent with Elite System) */}
      <div className="absolute inset-0 z-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        ></div>
      </div>

      {/* Background Blobs (consistent with Elite System) */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-white via-gray-50 to-blue-50/30 dark:from-gray-950 dark:via-gray-950 dark:to-primary-950/20"></div>

        <div
          className="absolute top-[20%] right-[10%] w-[50%] h-[50%] rounded-full opacity-40 dark:opacity-20 blur-[120px] animate-pulse"
          style={{
            background: "radial-gradient(circle, var(--color-primary-900) 0%, transparent 70%)",
            animationDuration: "10s",
          }}
        ></div>
        <div
          className="absolute -bottom-[10%] -left-[10%] w-[40%] h-[40%] rounded-full opacity-30 dark:opacity-10 blur-[120px] animate-pulse"
          style={{
            background: "radial-gradient(circle, var(--color-primary-800) 0%, transparent 70%)",
            animationDuration: "15s",
            animationDelay: "3s",
          }}
        ></div>
      </div>

      {/* LAYER 1: Primary Navigation - Elite Centered Sticky Tabs */}
      <nav className="sticky top-0 z-40 w-full flex-shrink-0">
        <SettingsTabs />
      </nav>

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 relative z-10 px-4 sm:px-6 py-4">
        <div className="max-w-[2000px] mx-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
