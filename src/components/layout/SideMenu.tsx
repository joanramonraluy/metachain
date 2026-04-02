// SideMenu.tsx
import { useEffect, useRef, useContext, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Settings,
  Info,
  Users,
  X,
  MessageSquare,
  Globe,
  HelpCircle,
  ChevronRight,
  Zap,
} from "lucide-react";
import { appContext } from "../../AppContext";
import { minimaService } from "../../services/minima.service";
import { transactionService } from "../../services/transaction.service";
import { BalanceAmount } from "../common/BalanceAmount";

const defaultAvatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

interface SideMenuProps {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
}

export default function SideMenu({ isOpen, setIsOpen }: SideMenuProps) {
  const { userName, userAvatar, loaded } = useContext(appContext);
  const [minimaBalance, setMinimaBalance] = useState<{
    sendable: string;
    unconfirmed: string;
  } | null>(null);

  const [optimisticBlink, setOptimisticBlink] = useState(false);
  const [hasPendingTx, setHasPendingTx] = useState(false);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!loaded) return;
      try {
        const balance = await minimaService.getBalance();
        const minima = balance.find((t: any) => t.tokenid === "0x00");
        if (minima) {
          setMinimaBalance({
            sendable: minima.sendable,
            unconfirmed: minima.unconfirmed || "0",
          });
          if (minima.unconfirmed && parseFloat(minima.unconfirmed) > 0) {
            setOptimisticBlink(false);
          }
        }
        const pendingCount = await transactionService.getPendingTransactionsCount();
        setHasPendingTx(pendingCount > 0);
      } catch (err) {
        console.error("Error fetching balance in SideMenu:", err);
      }
    };

    fetchBalance();
    const removeListener = minimaService.onBalanceUpdate(fetchBalance);
    window.addEventListener("minima_balance_update", fetchBalance);
    const startBlinkHandler = () => {
      setOptimisticBlink(true);
      setTimeout(() => setOptimisticBlink(false), 15000);
    };
    window.addEventListener("minima_balance_update_start", startBlinkHandler);

    let timeoutId: NodeJS.Timeout;
    let isActive = true;
    const pollBalance = async () => {
      if (!isActive) return;
      await fetchBalance();
      if (isActive) timeoutId = setTimeout(pollBalance, 5000);
    };
    pollBalance();

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
      removeListener();
      window.removeEventListener("minima_balance_update", fetchBalance);
      window.removeEventListener("minima_balance_update_start", startBlinkHandler);
    };
  }, [loaded]);

  const router = useRouterState();
  const currentPath = router.location.pathname;
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, setIsOpen]);

  const menuItems = [
    { to: "/", icon: <MessageSquare size={22} />, label: "Chats", color: "sky" },
    { to: "/contacts", icon: <Users size={22} />, label: "Contacts", color: "indigo" },
    { to: "/discovery", icon: <Globe size={22} />, label: "Community", color: "emerald" },
    { to: "/settings", icon: <Settings size={22} />, label: "Settings", color: "amber" },
    { to: "/about", icon: <Info size={22} />, label: "About", color: "violet" },
    { to: "/help", icon: <HelpCircle size={22} />, label: "Help", color: "rose" },
  ];

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-md transition-all duration-300 animate-in fade-in"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div
        ref={menuRef}
        className={`fixed top-0 left-0 h-full bg-gray-950 text-white flex flex-col shadow-2xl z-50 transition-all duration-500 ease-in-out pt-[env(safe-area-inset-top)] border-r border-gray-800/50
          ${isOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"}
          md:relative md:translate-x-0 md:opacity-100 md:w-72 w-[85vw] max-w-sm`}
      >
        {/* User Profile Card Header */}
        <div className="p-6 relative group">
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary-500/10 to-transparent -z-10 group-hover:from-primary-500/15 transition-all duration-500"></div>
          
          <div className="flex items-center justify-between mb-6">
            <Link
              to="/settings"
              onClick={() => setIsOpen(false)}
              className="relative group/avatar"
            >
              <div className="absolute -inset-1 bg-gradient-to-tr from-primary-500 to-indigo-600 rounded-2xl blur opacity-25 group-hover/avatar:opacity-50 transition-opacity duration-300"></div>
              <img
                src={userAvatar}
                alt="User"
                className="relative w-14 h-14 rounded-2xl object-cover border-2 border-white/10 shadow-lg group-hover/avatar:scale-105 transition-transform duration-300"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = defaultAvatar;
                }}
              />
            </Link>
            <button
              className="md:hidden p-2 text-gray-500 hover:text-white transition-colors hover:bg-white/5 rounded-xl"
              onClick={() => setIsOpen(false)}
            >
              <X size={24} />
            </button>
          </div>

          <div className="space-y-1">
            <h1
              className="text-xl font-black tracking-tight truncate pr-4 text-white hover:text-primary-400 transition-colors cursor-default"
              title={userName}
            >
              {userName}
            </h1>
            {minimaBalance && (
              <div className="flex items-center gap-2 group/balance py-1 px-3 bg-white/5 rounded-xl border border-white/5 w-fit hover:bg-white/10 transition-colors">
                <span className="w-2 h-2 bg-primary-500 rounded-full animate-pulse shadow-glow shadow-primary-500/50"></span>
                <BalanceAmount
                  amount={parseFloat(minimaBalance.sendable).toFixed(2)}
                  unconfirmed={minimaBalance.unconfirmed}
                  forceActive={optimisticBlink || hasPendingTx}
                  className="font-bold text-white text-[14px]"
                />
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1 opacity-50">Minima</span>
              </div>
            )}
          </div>
        </div>

        {/* Separator */}
        <div className="mx-6 h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent"></div>

        {/* Navigation Menu Items */}
        <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto scrollbar-hide">
          {menuItems.map((item) => (
            <MenuItem
              key={item.to}
              {...item}
              active={currentPath === item.to}
              onClick={() => setIsOpen(false)}
            />
          ))}
        </nav>

        {/* Premium Footer */}
        <div className="p-6 border-t border-gray-800/30">
          <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-2xl border border-white/5 group hover:border-white/10 transition-all">
             <div className="flex flex-col">
               <span className="text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] mb-0.5">Application</span>
               <span className="text-xs font-bold text-gray-400">MetaChain v0.9</span>
             </div>
             <div className="w-8 h-8 rounded-xl bg-gray-800 flex items-center justify-center text-gray-500 group-hover:bg-primary-500 group-hover:text-white transition-all">
                <Zap size={14} />
             </div>
          </div>
          <p className="text-center text-[10px] text-gray-750 font-medium mt-4 uppercase tracking-[0.3em] opacity-40">Powered by Minima</p>
        </div>
      </div>
    </>
  );
}

function MenuItem({
  to,
  icon,
  label,
  active,
  onClick,
  color,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  color: string;
}) {
  const colorStyles: Record<string, string> = {
    sky: "text-sky-400",
    indigo: "text-indigo-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    violet: "text-violet-400",
    rose: "text-rose-400",
  }

  return (
    <Link
      to={to}
      onClick={onClick}
      className={`relative flex items-center justify-between group px-4 py-3 rounded-2xl transition-all duration-300 ${
        active
          ? "bg-primary-500/10 text-white shadow-sm ring-1 ring-primary-500/20"
          : "text-gray-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      <div className="flex items-center gap-4 relative z-10">
        <div
          className={`transition-all duration-300 ${
            active 
            ? `${colorStyles[color]} scale-110 drop-shadow-[0_0_8px_rgba(var(--color-primary-500),0.5)]` 
            : "text-gray-500 group-hover:scale-110 group-hover:text-gray-300"
          }`}
        >
          {icon}
        </div>
        <span className={`text-[15px] font-bold transition-all duration-300 ${active ? "tracking-tight" : "group-hover:translate-x-1"}`}>
          {label}
        </span>
      </div>

      {active ? (
        <div className="relative z-10">
           <ChevronRight size={16} className="text-primary-500/50" />
        </div>
      ) : (
        <ChevronRight size={16} className="text-gray-800 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 -translate-x-2" />
      )}

      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-primary-500 rounded-r-full shadow-lg shadow-primary-500/50 animate-in slide-in-from-left-full duration-500"></div>
      )}
    </Link>
  );
}
