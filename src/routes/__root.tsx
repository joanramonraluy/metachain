import { createRootRoute, Outlet } from "@tanstack/react-router"
import AppLayout from "../components/layout/AppLayout"
import { DebugSQLPanel } from "../components/debug/DebugSQLPanel"
import { useAppContext } from "../AppContext"

export const Route = createRootRoute({
  component: () => {
    const { showDebugPanel, setShowDebugPanel, loaded } = useAppContext()

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
      </AppLayout>
    )
  },
})
