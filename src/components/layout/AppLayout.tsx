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
    <div className="flex bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 h-full w-full overflow-hidden transition-colors">
      <SideMenu isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      <div className="flex-1 flex flex-col relative min-h-0 min-w-0">
        {/* Only show global header on pages that don't have their own */}
        {!hasCustomHeader && (
          <Header onToggleMenu={() => setSidebarOpen(!sidebarOpen)} />
        )}

        {/* Main content area */}
        <main className="flex-1 flex flex-col relative min-h-0 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
