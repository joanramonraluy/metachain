import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Users, Globe, Settings } from "lucide-react";

export default function BottomNav() {
  const router = useRouterState();
  const currentPath = router.location.pathname;

  const navItems = [
    { label: "Chats", to: "/", icon: MessageCircle },
    { label: "People", to: "/contacts", icon: Users },
    { label: "Community", to: "/discovery", icon: Globe },
    { label: "Settings", to: "/settings", icon: Settings },
  ];

  return (
    <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-sm md:hidden">
      <div className="bg-white/40 dark:bg-gray-950/40 backdrop-blur-2xl border border-white/20 dark:border-white/5 rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.3)] p-2 flex items-center justify-between">
        {navItems.map((item) => {
          const isActive = currentPath === item.to || (item.to !== "/" && currentPath.startsWith(item.to));
          const Icon = item.icon;

          return (
            <Link
              key={item.to}
              to={item.to}
              className={`relative flex flex-col items-center justify-center py-3 px-1 rounded-2xl transition-all duration-500 flex-1 group ${
                isActive ? "text-primary-500 scale-110" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {isActive && (
                <div className="absolute inset-0 bg-primary-500/10 rounded-2xl blur-lg animate-pulse" />
              )}
              
              <div className="relative">
                <Icon 
                  size={24} 
                  strokeWidth={isActive ? 3 : 2.5} 
                  className={`transition-all duration-500 ${isActive ? "drop-shadow-[0_0_8px_rgba(var(--color-primary-500),0.5)]" : "group-hover:scale-110"}`}
                />
                {isActive && (
                  <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-primary-500 rounded-full shadow-glow shadow-primary-500/50" />
                )}
              </div>
              
              <span className={`text-[10px] font-black uppercase tracking-widest mt-1.5 transition-all duration-500 ${isActive ? "opacity-100" : "opacity-0 scale-75 group-hover:opacity-60"}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
