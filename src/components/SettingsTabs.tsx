import {
  User,
  Shield,
  Globe,
  Network,
  Paintbrush,
  ChevronRight,
  Zap,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAppContext } from "../AppContext";

export const SETTINGS_TABS = [
  {
    to: "/settings/profile",
    label: "Profile",
    icon: User,
    color: "indigo",
    description: "Manage your personal identity, avatar, and bio.",
  },
  {
    to: "/settings/appearance",
    label: "Appearance",
    icon: Paintbrush,
    color: "violet",
    description: "Customize the look and feel of the application.",
  },
  {
    to: "/settings/privacy",
    label: "Privacy",
    icon: Shield,
    color: "sky",
    description: "Control who can see your profile and contact information.",
  },
  {
    to: "/settings/discovery",
    label: "Discovery",
    icon: Globe,
    color: "emerald",
    description: "Manage peer discovery and network visibility settings.",
  },
  {
    to: "/settings/network",
    label: "Network",
    icon: Network,
    color: "amber",
    description: "View connection status and network diagnostics.",
  },
  {
    to: "/settings/connect",
    label: "Connect App",
    icon: Zap,
    color: "rose",
    description: "Manually connect to your Minima node (APK).",
  },
];

interface SettingsTabsProps {
  vertical?: boolean;
}

const COLOR_MAP: Record<string, string> = {
  indigo: "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10",
  violet: "text-violet-600 dark:text-violet-400 bg-violet-500/10",
  sky: "text-sky-600 dark:text-sky-400 bg-sky-500/10",
  emerald: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
  amber: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  rose: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
};

export function SettingsTabs({ vertical }: SettingsTabsProps) {
  const { sessionExpired } = useAppContext();
  const router = useRouterState();
  const currentPath = router.location.pathname;

  // Horizontal Tab Bar (Desktop/Subgroup) - Minimalist Underline Tabs
  if (!vertical) {
    return (
      <div className="w-full flex items-center justify-center border-b border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-3xl overflow-x-auto no-scrollbar scrollbar-hide px-4">
        <div className="flex items-center gap-1 sm:gap-6">
          {SETTINGS_TABS.map((tab) => {
            const isActive = currentPath === tab.to;
            const Icon = tab.icon;
            const colors = {
              indigo: "text-indigo-500 bg-indigo-500 shadow-indigo-500/50",
              violet: "text-violet-500 bg-violet-500 shadow-violet-500/50",
              sky: "text-sky-500 bg-sky-500 shadow-sky-500/50",
              emerald: "text-emerald-500 bg-emerald-500 shadow-emerald-500/50",
              amber: "text-amber-500 bg-amber-500 shadow-amber-500/50",
              rose: "text-rose-500 bg-rose-500 shadow-rose-500/50",
            }[tab.color] || "text-primary-500 bg-primary-500 shadow-primary-500/50";
            
            const colorClass = colors.split(" ")[0];
            const bgClass = colors.split(" ")[1];
            const glowClass = colors.split(" ")[2];

            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`relative px-4 py-4 sm:py-5 flex items-center gap-2.5 transition-all duration-300 group ${
                  isActive ? colorClass : "text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                <div className={`transition-all duration-500 ${isActive ? "scale-110" : "group-hover:scale-110"}`}>
                  <Icon size={16} strokeWidth={isActive ? 3 : 2.5} />
                </div>
                <span className="hidden sm:inline text-[11px] font-black tracking-widest uppercase truncate max-w-[120px] sm:max-w-none">
                  {tab.label}
                </span>

                {/* Underline Indicator */}
                {isActive && (
                  <div className={`absolute bottom-0 left-0 right-0 h-1 rounded-full ${bgClass} shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${glowClass} animate-in fade-in zoom-in duration-500`} />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  // Vertical List (Main Settings Root)
  return (
    <div className="space-y-4 w-full animate-in fade-in slide-in-from-bottom-6 duration-700">
      {SETTINGS_TABS.map((tab, idx) => {
        const Icon = tab.icon;
        const colorClasses = COLOR_MAP[tab.color] || "text-primary-600 bg-primary-500/10";
        const isDisabled =
          sessionExpired &&
          tab.to !== "/settings/connect" &&
          tab.to !== "/settings/network";

        return (
          <Link
            key={tab.to}
            to={tab.to}
            disabled={isDisabled}
            className={`flex items-center p-6 rounded-[2.5rem] bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 shadow-lg shadow-black/5 transition-all group overflow-hidden ${
              isDisabled ? "opacity-40 pointer-events-none grayscale" : "hover:scale-[1.02] active:scale-95 hover:shadow-2xl hover:shadow-primary-500/10"
            }`}
            style={{ animationDelay: `${idx * 60}ms` }}
          >
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mr-6 flex-shrink-0 group-hover:scale-110 transition-transform duration-500 shadow-2xl ${colorClasses}`}>
              <Icon size={26} strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-black text-gray-900 dark:text-white leading-tight mb-1 uppercase tracking-tight">
                {tab.label}
              </h3>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 font-bold line-clamp-1 truncate opacity-80">
                {tab.description}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-black/5 dark:bg-white/5 flex items-center justify-center text-gray-400 group-hover:text-primary-500 group-hover:translate-x-2 transition-all">
              <ChevronRight size={22} strokeWidth={3} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
