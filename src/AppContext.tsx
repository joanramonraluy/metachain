import { Block, MDS, MinimaEvents } from "@minima-global/mds"
import { createContext, useCallback, useEffect, useRef, useState } from "react"
import { minimaService } from "./services/minima.service"


const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

export const appContext = createContext<{
  loaded: boolean
  synced: boolean
  block: Block | null
  userName: string
  userAvatar: string
  writeMode: boolean
  myPublicKey: string
  updateUserProfile: (name: string, avatar: string) => void
  refreshWriteMode: () => Promise<void>
}>({
  loaded: false,
  synced: false,
  block: null,
  userName: "User",
  userAvatar: defaultAvatar,
  writeMode: false,
  myPublicKey: "",
  updateUserProfile: () => { },
  refreshWriteMode: async () => { }
})

const AppProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const initialised = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [synced, setSynced] = useState(false)
  const [block, setBlock] = useState<Block | null>(null)
  const [userName, setUserName] = useState("User")
  const [userAvatar, setUserAvatar] = useState(defaultAvatar)
  const [writeMode, setWriteMode] = useState(false)
  const [myPublicKey, setMyPublicKey] = useState("")

  // Fetch user profile from Maxima
  const fetchUserProfile = async () => {
    try {
      const res = await MDS.cmd.maxima({ params: { action: "info" } })
      const info = (res.response as any) || {}

      if (info) {
        const name = info.name || "User"
        const icon = info.icon ? decodeURIComponent(info.icon) : defaultAvatar
        const pubkey = info.publickey || ""

        setUserName(name)
        setMyPublicKey(pubkey)
        // Check if it's a valid data URL, and not a URL ending in /0x00 (no photo)
        if (icon.startsWith("data:image") && !icon.includes("/0x00")) {
          setUserAvatar(icon)
        } else {
          setUserAvatar(defaultAvatar)
        }
      }
    } catch (err) {
      console.error("[AppContext] Error fetching user profile:", err)
    }
  }

  // Function to update user profile (called from Settings)
  const updateUserProfile = (name: string, avatar: string) => {
    setUserName(name)
    setUserAvatar(avatar)
  }

  // Function to refresh write mode using checkmode command (doesn't create pending)
  const refreshWriteMode = useCallback(async (): Promise<void> => {
    return new Promise((resolve) => {
      console.log("🔄 [AppContext] Refreshing write mode with checkmode...");
      (MDS as any).executeRaw("checkmode", (res: any) => {
        console.log("📝 [AppContext] 'checkmode' command response:", res);
        if (res.status && res.response) {
          const mode = res.response.mode;
          console.log(`📝 [AppContext] Detected mode: ${mode}`);

          if (mode === "WRITE") {
            setWriteMode(true);
            console.log("✅ [AppContext] Write Mode ENABLED");
          } else {
            setWriteMode(false);
            console.log("⚠️ [AppContext] Read Mode ACTIVE");
          }
        } else {
          console.log("📝 [AppContext] Could not detect mode - keeping current state");
        }
        resolve();
      });
    });
  }, []);



  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true

      minimaService.init()

      MDS.init(async (msg) => {
        // RAW DEBUG LOG: See everything coming from Minima
        if (msg.event === "MAXIMA") {
          console.log("🔥 [AppContext] RAW MAXIMA EVENT:", msg);
        }

        // Pass event to service for processing (e.g. Maxima messages)
        minimaService.processEvent(msg)

        if (msg.event === MinimaEvents.INITED) {
          setLoaded(true)
          console.log("MDS initialised and ready! 🚀")

          // Check Write Mode using checkmode command (doesn't create pending)
          console.log("🔄 [AppContext] Checking Write Mode with 'checkmode'...");
          (MDS as any).executeRaw("checkmode", (res: any) => {
            console.log("📝 [AppContext] 'checkmode' command response:", res);
            if (res.status && res.response) {
              const mode = res.response.mode;
              console.log(`📝 [AppContext] Detected mode: ${mode}`);

              if (mode === "WRITE") {
                setWriteMode(true);
                console.log("✅ [AppContext] Write Mode ENABLED");
              } else {
                setWriteMode(false);
                console.log("⚠️ [AppContext] Read Mode ACTIVE");
              }
            } else {
              console.log("📝 [AppContext] Could not detect mode - defaulting to Read Mode");
              setWriteMode(false);
            }
          });

          // Initialize database after MDS is ready
          // We await this to ensure tables exist before running cleanup
          minimaService.initDB().then(() => {
            // Initialize profile (publish address for token receiving)
            minimaService.initProfile()

            // Cleanup orphaned pending transactions on app start
            // This syncs the DB with the actual node state (handling offline approvals/denials)
            console.log("🧹 [AppContext] Running initial transaction cleanup...");
            minimaService.cleanupOrphanedPendingTransactions();
          });

          // Start transaction polling service - DISABLED (replaced by MDS_PENDING event)
          // console.log("🔄 [AppContext] Starting transaction polling service");
          // transactionPollingService.start();

          // Fetch user profile
          fetchUserProfile()

          const command = await MDS.cmd.block()
          setBlock(command.response)
        }

        // Listen for NEWBLOCK events to detect synchronization
        if (msg.event === MinimaEvents.NEWBLOCK) {
          // When we receive a new block, the node is synced
          setSynced(true)
          const command = await MDS.cmd.block()
          setBlock(command.response)
        }
      })
    }
  }, [])

  const context = {
    loaded,
    synced,
    block,
    userName,
    userAvatar,
    writeMode,
    myPublicKey,
    updateUserProfile,
    refreshWriteMode,
  }

  return <appContext.Provider value={context}>{children}</appContext.Provider>
}

export default AppProvider
