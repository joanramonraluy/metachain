import { useContext } from "react";
import { Wifi, Menu } from "lucide-react";
import { appContext } from "../../AppContext";
import { useNavigate } from "@tanstack/react-router";
import logo from "../../assets/logo.png";

const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

interface HeaderProps {
  onToggleMenu: () => void;
}

export default function Header({ onToggleMenu }: HeaderProps) {
  const { synced, userAvatar } = useContext(appContext);
  const navigate = useNavigate();

  const pageTitle = "MetaChain";

  return (
    <header className="sticky top-0 w-full z-40 flex-shrink-0 transition-all duration-300 pt-[env(safe-area-inset-top)] bg-white/40 dark:bg-gray-950/40 backdrop-blur-xl border-b border-primary-500/20 dark:border-primary-500/20 shadow-2xl shadow-black/5">
      {/* Top/Bottom Accent Lines */}
      <div className="absolute top-0 left-0 w-full h-[4px] bg-gradient-to-r from-transparent via-primary-500/80 to-transparent z-[80]" />
      <div className="absolute bottom-0 left-0 w-full h-[1.5px] bg-gradient-to-r from-transparent via-primary-500/50 to-transparent z-[80]" />
      
      {/* Subtle Background Tint */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary-500/20 via-transparent to-transparent pointer-events-none" />
      <div className="max-w-[2000px] mx-auto flex justify-between items-center px-6 h-20 lg:px-12">
        
        {/* Left Section: Menu & Brand */}
        <div className="flex items-center gap-4 sm:gap-6">
          <button
            onClick={onToggleMenu}
            className="md:hidden p-2.5 -ml-2 rounded-[1.25rem] bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-all active:scale-90 text-gray-700 dark:text-gray-200"
            aria-label="Toggle Navigation"
          >
            <Menu size={26} strokeWidth={3} />
          </button>

          <div 
            onClick={() => navigate({ to: "/" })}
            className="flex items-center gap-4 group cursor-pointer"
          >
            <div className="relative">
              <div className="absolute -inset-1.5 bg-primary-500/30 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
              <img src={logo} alt="MetaChain" className="relative w-10 min-w-[2.5rem] h-10 rounded-2xl shadow-2xl shadow-primary-500/20 group-hover:scale-110 transition-transform duration-700 ease-out" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tighter text-gray-900 dark:text-white leading-none uppercase">
                {pageTitle}
              </h1>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse shadow-glow shadow-primary-500/50"></span>
                <span className="text-[9px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.3em] opacity-80">Decentralized</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Section: Status & Profile */}
        <div className="flex items-center gap-3 sm:gap-5">
          
          {/* Network Status Button */}
          <button
            onClick={() => {
              navigate({ to: "/settings" });
              setTimeout(() => {
                const networkSection = document.getElementById("network");
                if (networkSection) networkSection.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 100);
            }}
            className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl transition-all duration-500 group active:scale-95 border ${
              synced 
              ? "bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20" 
              : "bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20"
            }`}
            title="Network Status"
          >
            <div className="relative">
              <Wifi
                size={20}
                className={`${synced ? "text-emerald-500" : "text-rose-500"} transition-colors duration-500`}
                strokeWidth={3}
              />
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-gray-950 ${synced ? "bg-emerald-500 shadow-glow shadow-emerald-500/50" : "bg-rose-500 animate-ping"}`}></span>
            </div>
            <span className={`hidden sm:inline text-[10px] font-black uppercase tracking-widest ${synced ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {synced ? "Synced" : "Offline"}
            </span>
          </button>

          {/* Quick Profile (Mobile Only) */}
          <div
            onClick={() => navigate({ to: "/settings" })}
            className="relative cursor-pointer transition-all hover:scale-110 active:scale-95 md:hidden group"
          >
            <div className="absolute -inset-0.5 bg-gradient-to-tr from-primary-500 to-indigo-600 rounded-full blur opacity-0 group-hover:opacity-40 transition-opacity duration-300"></div>
            <img
              src={userAvatar || defaultAvatar}
              alt="Profile"
              className="relative w-10 h-10 rounded-full border-2 border-white dark:border-gray-800 object-cover shadow-md"
              onError={(e) => {
                (e.target as HTMLImageElement).src = defaultAvatar;
              }}
            />
          </div>
        </div>
      </div>
    </header>

  );
}
