import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router"
import AppLayout from "../components/layout/AppLayout"
import { DebugSQLPanel } from "../components/debug/DebugSQLPanel"
import { useAppContext } from "../AppContext"

export const Route = createRootRoute({
  component: () => {
    const { showDebugPanel, setShowDebugPanel, loaded, sessionExpired } = useAppContext()
    const location = useLocation()

    // Hide banner on the Connect page so it doesn't obscure the input
    const isConnectPage = location.pathname === '/settings/connect'
    const showBanner = sessionExpired && !isConnectPage

    return (
      <AppLayout>
        <Outlet />
        {showDebugPanel && (
          <DebugSQLPanel
            onClose={() => setShowDebugPanel(false)}
            contactPubkey={undefined} // Will be auto-detected by panel
            mdsLoaded={loaded}
          />
        )}

        {/* Global Session Expired Banner */}
        {showBanner && (
          <div className="fixed bottom-0 left-0 right-0 bg-red-600 text-white p-4 shadow-lg z-50 flex items-center justify-between animate-in fade-in slide-in-from-bottom duration-300">
            <div className="flex items-center mr-4">
              <span className="text-2xl mr-3">⚠️</span>
              <div>
                <p className="font-bold">Session Expired</p>
                <p className="text-sm opacity-90">Your Minima connection is invalid (Node restarted or stopped?).</p>
              </div>
            </div>
            <button
              onClick={() => {
                // MemoryRouter workaround: Save intent and reload logic in main.tsx handles the rest
                localStorage.setItem("lastRoute", "/settings/connect");
                window.location.reload();
              }}
              className="bg-white text-red-600 px-4 py-2 rounded-md font-bold text-sm hover:bg-gray-100 transition-colors"
            >
              UPDATE UID
            </button>
          </div>
        )}
      </AppLayout>
    )
  },
})
