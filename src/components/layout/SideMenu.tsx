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
  Eye,
  EyeOff,
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
  const [isBalanceHidden, setIsBalanceHidden] = useState<boolean>(() => {
    return localStorage.getItem("metachain_hide_balance") === "true";
  });

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
    { to: "/contacts", icon: <Users size={22} />, label: "People", color: "sky" },
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
        className={`fixed top-0 left-0 h-full bg-gray-950/90 text-white flex flex-col shadow-[20px_0_50px_rgba(0,0,0,0.5)] z-50 transition-all duration-700 ease-out pt-[env(safe-area-inset-top)] border-r border-white/5 backdrop-blur-2xl
          ${isOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"}
          md:relative md:translate-x-0 md:opacity-100 md:w-80 w-[85vw] max-w-sm`}
      >
        {/* User Profile Card Header */}
        <div className="p-8 relative group">
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary-500/20 to-transparent -z-10 group-hover:from-primary-500/30 transition-all duration-700"></div>
          
          <div className="flex items-center justify-between mb-8">
            <Link
              to="/settings"
              onClick={() => setIsOpen(false)}
              className="relative group/avatar"
            >
              <div className="absolute -inset-1.5 bg-gradient-to-tr from-primary-500 to-indigo-600 rounded-[1.5rem] blur opacity-30 group-hover/avatar:opacity-60 transition-opacity duration-500"></div>
              <img
                src={userAvatar}
                alt="User"
                className="relative w-16 h-16 rounded-[1.5rem] object-cover border-2 border-white/20 shadow-2xl transition-all duration-500 group-hover/avatar:scale-105 active:group-hover/avatar:scale-95"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = defaultAvatar;
                }}
              />
            </Link>
            <button
              className="md:hidden p-3 text-gray-400 hover:text-white transition-all hover:bg-white/10 rounded-[1.25rem] active:scale-90"
              onClick={() => setIsOpen(false)}
            >
              <X size={26} strokeWidth={3} />
            </button>
          </div>

          <div className="space-y-1.5">
            <h1
              className="text-2xl font-black tracking-tighter truncate pr-4 text-white hover:text-primary-400 transition-colors cursor-default uppercase"
              title={userName}
            >
              {userName}
            </h1>
            {minimaBalance && (
              <div className="flex items-center gap-2.5 group/balance py-2 px-4 bg-white/10 rounded-2xl border border-white/10 w-fit hover:bg-white/15 transition-all">
                <span className="w-2.5 h-2.5 bg-primary-500 rounded-full animate-pulse shadow-glow shadow-primary-500/50"></span>
                <BalanceAmount
                  amount={parseFloat(minimaBalance.sendable).toFixed(2)}
                  unconfirmed={minimaBalance.unconfirmed}
                  forceActive={optimisticBlink || hasPendingTx}
                  hidden={isBalanceHidden}
                  className="font-black text-white text-[15px]"
                />
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1 opacity-60">Minima</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const newState = !isBalanceHidden;
                    setIsBalanceHidden(newState);
                    localStorage.setItem("metachain_hide_balance", newState.toString());
                  }}
                  className="ml-2 p-1.5 hover:bg-white/10 rounded-lg text-gray-500 hover:text-white transition-all active:scale-90"
                  title={isBalanceHidden ? "Show Balance" : "Hide Balance"}
                >
                  {isBalanceHidden ? <Eye size={14} strokeWidth={3} /> : <EyeOff size={14} strokeWidth={3} />}
                </button>
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
        <div className="p-8 border-t border-white/5">
          <div className="flex items-center justify-between p-5 bg-white/5 rounded-3xl border border-white/5 group hover:border-white/10 transition-all cursor-default">
             <div className="flex flex-col">
               <span className="text-[10px] font-black text-gray-600 uppercase tracking-[0.3em] mb-1">Application</span>
               <span className="text-xs font-black text-gray-400 uppercase tracking-tight">MetaChain v0.9</span>
             </div>
             <div className="w-10 h-10 rounded-[1.25rem] bg-white/5 flex items-center justify-center text-gray-500 group-hover:bg-primary-500 group-hover:text-white transition-all shadow-lg group-hover:shadow-primary-500/20">
                <Zap size={18} strokeWidth={2.5} />
             </div>
          </div>
          <p className="text-center text-[10px] text-gray-600 font-black mt-6 uppercase tracking-[0.4em] opacity-30">Powered by Minima</p>
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
      className={`relative flex items-center justify-between group px-5 py-4 rounded-3xl transition-all duration-500 ${
        active
          ? "bg-white/10 text-white shadow-2xl ring-1 ring-white/10"
          : "text-gray-500 hover:bg-white/5 hover:text-white"
      }`}
    >
      <div className="flex items-center gap-5 relative z-10">
        <div
          className={`transition-all duration-500 ${
            active 
            ? `${colorStyles[color]} scale-110 drop-shadow-[0_0_12px_rgba(59,130,246,0.6)]` 
            : "text-gray-600 group-hover:scale-110 group-hover:text-gray-300"
          }`}
        >
          {icon}
        </div>
        <span className={`text-base font-black transition-all duration-500 uppercase tracking-tight ${active ? "opacity-100" : "opacity-60 group-hover:opacity-100 group-hover:translate-x-1"}`}>
          {label}
        </span>
      </div>

      {active ? (
        <div className="relative z-10">
           <ChevronRight size={18} strokeWidth={3} className="text-white opacity-40" />
        </div>
      ) : (
        <ChevronRight size={18} strokeWidth={3} className="text-white opacity-0 group-hover:opacity-20 group-hover:translate-x-0 transition-all duration-500 -translate-x-2" />
      )}

      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-primary-500 rounded-r-full shadow-glow shadow-primary-500/50 animate-in slide-in-from-left-full duration-700"></div>
      )}
    </Link>
  );
}
