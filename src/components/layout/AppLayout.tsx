import { ReactNode, useEffect, useRef, useState } from "react";
import SideMenu from "./SideMenu";
import Header from "./Header";
import BottomNav from "./BottomNav";
import { useRouterState } from "@tanstack/react-router";

interface AppLayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const adsSlotRef = useRef<HTMLDivElement>(null);

  // Pages that handle their own header
  const customHeaderRoutes = [
    "/chat/",
    "/groups/",
    "/channels/",
    "/channel-info/",
    "/group-info/",
    "/contact-info/",
    "/create-channel",
    "/create-group",
  ];
  const hasCustomHeader = customHeaderRoutes.some((route) => currentPath.startsWith(route));

  useEffect(() => {
    const handleOpenSidebar = () => setSidebarOpen(true);
    window.addEventListener("open-sidebar", handleOpenSidebar);
    return () => window.removeEventListener("open-sidebar", handleOpenSidebar);
  }, []);

  // Track the ad banner height and expose it as a CSS variable on :root so
  // that all fixed elements (FABs, BottomNav) can shift up automatically
  // without overlapping the ad space.
  useEffect(() => {
    const slot = adsSlotRef.current;
    if (!slot) return;

    const updateHeight = () => {
      const h = slot.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--ads-banner-height", `${h}px`);
    };

    // Initial read
    updateHeight();

    // Watch for size changes (e.g. when MinimaAds injects / removes the banner)
    const ro = new ResizeObserver(updateHeight);
    ro.observe(slot);

    return () => {
      ro.disconnect();
      // Reset when unmounted (safety)
      document.documentElement.style.setProperty("--ads-banner-height", "0px");
    };
  }, []);

  const showAdsRoutes = ["/", "/contacts", "/discovery"];
  const shouldShowAd = showAdsRoutes.includes(currentPath);
  console.log("MA-DEBUG:", { currentPath, shouldShowAd });

  return (
    <div className="flex bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 h-full w-full overflow-hidden transition-colors">
      <SideMenu isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      <div className="flex-1 flex flex-col relative min-h-0 min-w-0">
        {/* Only show global header on pages that don't have their own */}
        {!hasCustomHeader && (
          <Header onToggleMenu={() => setSidebarOpen(!sidebarOpen)} />
        )}

        {/* Main content area */}
        <main className={`flex-1 flex flex-col relative min-h-0 min-w-0 ${!hasCustomHeader ? "pb-32 md:pb-0" : ""}`}>
          {children}
        </main>

        <div
          id="minimaads-slot"
          ref={adsSlotRef}
          className={shouldShowAd ? "empty:hidden px-3 pt-2 pb-1" : "hidden"}
        />
        {!hasCustomHeader && <BottomNav />}

      </div>
    </div>
  );
}
