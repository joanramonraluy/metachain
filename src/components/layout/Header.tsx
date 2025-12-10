import { useContext } from "react";
import { Wifi, Menu } from "lucide-react";
import { appContext } from "../../AppContext";
import { useRouterState, useNavigate } from "@tanstack/react-router";

const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

interface HeaderProps {
  onToggleMenu: () => void;
}

const menuLabels = [
  { to: "/", label: "Chats" },
  { to: "/contacts", label: "Contacts" },
  { to: "/settings", label: "Settings" },
  { to: "/info", label: "Info" },
];

export default function Header({ onToggleMenu }: HeaderProps) {
  const { synced, userAvatar } = useContext(appContext);
  const navigate = useNavigate();

  const router = useRouterState();
  const currentPath = router.location.pathname;

  const currentItem = menuLabels.find((item) => item.to === currentPath);
  // If path is root "/", show "CharmChain" instead of "Chats"
  const pageTitle = currentPath === "/" ? "CharmChain" : (currentItem?.label || "CharmChain");

  return (
    <header className="w-full bg-[#0088cc] text-white shadow-md z-30 flex-shrink-0">
      <div className="flex justify-between items-center px-4 py-4">
        <div className="flex items-center gap-3">

          {/* Hamburger menu button for desktop */}
          <button
            onClick={onToggleMenu}
            className="p-2 -ml-2 rounded-full hover:bg-white/10 transition md:hidden"
            aria-label="Menu"
          >
            <Menu size={24} />
          </button>

          <div className="flex items-center gap-2">
            <img src="icon.png" alt="Logo" className="w-8 h-8 rounded-lg shadow-sm" />
            <h1 className="text-xl font-bold tracking-wide">{pageTitle}</h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              navigate({ to: "/settings" });
              // Scroll to network section after navigation
              setTimeout(() => {
                const networkSection = document.getElementById("network");
                if (networkSection) {
                  networkSection.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }, 100);
            }}
            className="p-2 hover:bg-white/10 rounded-full transition-all cursor-pointer"
            title="Network Status"
          >
            <Wifi
              size={20}
              className={`${synced ? "text-green-300" : "text-red-300 animate-pulse"} transition-colors`}
            />
          </button>
          <div
            onClick={() => navigate({ to: "/settings" })}
            className="cursor-pointer transition-transform hover:scale-105 active:scale-95 md:hidden"
          >
            <img
              src={userAvatar}
              alt="User avatar"
              className="w-10 h-10 rounded-full border-4 border-white object-cover bg-white/20"
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
