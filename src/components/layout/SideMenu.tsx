// SideMenu.tsx
import { useEffect, useRef, useContext } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Settings, Info, Users, X, MessageSquare, Globe } from "lucide-react";
import { appContext } from "../../AppContext";

const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

interface SideMenuProps {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
}

export default function SideMenu({ isOpen, setIsOpen }: SideMenuProps) {
  const { userName, userAvatar } = useContext(appContext);
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside (mobile only)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        isOpen
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, setIsOpen]);

  const menuItems = [
    { to: "/", icon: <MessageSquare />, label: "Chats" },
    { to: "/contacts", icon: <Users />, label: "Contacts" },
    { to: "/discovery", icon: <Globe />, label: "Community" },
    { to: "/settings", icon: <Settings />, label: "Settings" },
    { to: "/info", icon: <Info />, label: "Info" },
  ];

  return (
    <>
      {/* Backdrop for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        ref={menuRef}
        className={`fixed top-0 left-0 h-full bg-[#1c242f] text-white flex flex-col shadow-2xl z-50 transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "-translate-x-full"} 
          md:relative md:translate-x-0 md:w-64 md:shadow-none md:border-r md:border-gray-800 w-72`}
      >
        {/* Header */}
        <div className="p-6 flex items-center justify-between border-b border-gray-700">
          <div className="flex items-center gap-3 overflow-hidden">
            <Link
              to="/settings"
              onClick={() => setIsOpen(false)}
              className="flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
            >
              <img
                src={userAvatar}
                alt="User"
                className="w-10 h-10 rounded-full object-cover border-4 border-white"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = defaultAvatar;
                }}
              />
            </Link>
            <h1 className="text-lg font-bold tracking-tight truncate max-w-[140px]" title={userName}>
              {userName}
            </h1>
          </div>
          <button
            className="md:hidden text-gray-400 hover:text-white transition-colors"
            onClick={() => setIsOpen(false)}
          >
            <X size={24} />
          </button>
        </div>

        {/* Menu Items */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {menuItems.map((item) => (
            <MenuItem
              key={item.to}
              {...item}
              active={currentPath === item.to}
              onClick={() => setIsOpen(false)}
            />
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 text-xs text-gray-500 text-center">
          <p>v1.0.0 • CharmChain</p>
          <p>Minima Network</p>
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
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${active
        ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20"
        : "text-gray-400 hover:bg-gray-800 hover:text-white"
        }`}
    >
      <div className={`transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-110"}`}>
        {icon}
      </div>
      <span className="font-medium">{label}</span>
    </Link>
  );
}
