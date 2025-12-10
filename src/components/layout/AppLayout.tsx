import { ReactNode, useEffect, useState } from "react";
import SideMenu from "./SideMenu";
import Header from "./Header";
import { useRouterState } from "@tanstack/react-router";

interface AppLayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouterState();
  const currentPath = router.location.pathname;

  // Pages that handle their own header (chat detail and group chat)
  const hasCustomHeader = currentPath.startsWith("/chat/") || currentPath.startsWith("/groups/");

  useEffect(() => {
    const handleOpenSidebar = () => setSidebarOpen(true);
    window.addEventListener("open-sidebar", handleOpenSidebar);
    return () => window.removeEventListener("open-sidebar", handleOpenSidebar);
  }, []);

  return (
    <div className="flex bg-gray-100 text-gray-900 h-screen overflow-hidden">
      <SideMenu isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
        {/* Only show global header on pages that don't have their own */}
        {!hasCustomHeader && (
          <Header onToggleMenu={() => setSidebarOpen(!sidebarOpen)} />
        )}

        {/* Main content area */}
        <main className="flex-1 overflow-hidden relative">
          {children}
        </main>
      </div>
    </div>
  );
}
