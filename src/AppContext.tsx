import { Block, MDS, MinimaEvents } from "@minima-global/mds";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { minimaService } from "./services/minima.service";
import { chatService } from "./services/chat.service";
import useBeaconSender from "./hooks/useBeaconSender";

const defaultAvatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

export const appContext = createContext<{
  loaded: boolean;
  dbReady: boolean;
  synced: boolean;
  block: Block | null;
  userName: string;
  userAvatar: string;
  writeMode: boolean;
  myPublicKey: string;
  updateUserProfile: (name: string, avatar: string) => void;
  refreshWriteMode: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  showDebugPanel: boolean;
  setShowDebugPanel: (show: boolean) => void;
  sessionExpired: boolean;
}>({
  loaded: false,
  dbReady: false,
  synced: false,
  block: null,
  userName: "User",
  userAvatar: defaultAvatar,
  writeMode: false,
  myPublicKey: "",
  updateUserProfile: () => {},
  refreshWriteMode: async () => {},
  refreshProfile: async () => {},
  showDebugPanel: false,
  setShowDebugPanel: () => {},
  sessionExpired: false,
});

const AppProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const initialised = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [synced, setSynced] = useState(false);
  const [block, setBlock] = useState<Block | null>(null);
  const [userName, setUserName] = useState("User");
  const [userAvatar, setUserAvatar] = useState(defaultAvatar);
  const [writeMode, setWriteMode] = useState(false);
  const [myPublicKey, setMyPublicKey] = useState("");
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const syncedRef = useRef(synced);

  useEffect(() => {
    syncedRef.current = synced;
  }, [synced]);

  // New state for setup

  // Enable periodic beacon sending globally (only when MDS is loaded)
  useBeaconSender(loaded);

  // Keyboard shortcut for debug panel: Ctrl+Shift+D
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setShowDebugPanel((prev) => !prev);
        console.log("🐛 [DEBUG] SQL Panel toggled");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch user profile from Maxima
  const fetchUserProfile = async () => {
    try {
      console.log(
        "🔄 [AppContext] Fetching latest user profile from Maxima...",
      );
      const res = await MDS.cmd.maxima({ params: { action: "info" } });
      const info = (res.response as any) || {};

      if (info) {
        const name = info.name || "User";
        const icon = info.icon ? decodeURIComponent(info.icon) : defaultAvatar;
        const pubkey = info.publickey || "";

        console.log(`✅ [AppContext] Profile fetched: Name=${name}`);
        console.log(`🖼️ [AppContext] Profile Icon: "${icon}"`);

        setUserName(name);
        setMyPublicKey(pubkey);
        // Check if it's a valid data URL, and not a URL ending in /0x00 (no photo)
        if (icon.startsWith("data:image") && !icon.includes("/0x00")) {
          setUserAvatar(icon);
        } else {
          setUserAvatar(defaultAvatar);
        }
      }
    } catch (err) {
      console.error("[AppContext] Error fetching user profile:", err);
    }
  };

  // Function to update user profile (called from Settings)
  // DEPRECATED INTENT: Consumers should prefer refreshProfile() to get the true state.
  // Keeping this for optimistic updates or partial updates if needed.
  const updateUserProfile = (name: string, avatar: string) => {
    if (name) setUserName(name);
    if (avatar) setUserAvatar(avatar);
  };

  // Function to force a refresh of the profile from the backend
  const refreshProfile = useCallback(async (): Promise<void> => {
    await fetchUserProfile();
  }, []);

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
          console.log(
            "📝 [AppContext] Could not detect mode - keeping current state",
          );
        }
        resolve();
      });
    });
  }, []);

  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true;

      // NOTE: MDS patching (for Capacitor HTTP) is now handled globally in main.tsx
      // to ensure it happens before any other service initialization.

      // Check for Stored UID (Standalone Mode or Native)
      const storedUid = localStorage.getItem("minima_uid");

      if (storedUid) {
        console.log("Using Stored UID for connection:", storedUid);
        MDS.DEBUG_MINIDAPPID = storedUid;
      }

      minimaService.init();

      MDS.init(async (msg) => {
        // RAW DEBUG LOG: See everything coming from Minima
        if (msg.event === "MAXIMA") {
          console.log("🔥 [AppContext] RAW MAXIMA EVENT:", msg);

          // Dispatch event to window so MaximaDiscoveryService can pick it up
          window.dispatchEvent(
            new CustomEvent("MDS_MAXIMA_EVENT", {
              detail: msg.data, // Pass the inner data object { application, data, from, ... }
            }),
          );
        }

        // Pass event to service for processing (e.g. Maxima messages)
        minimaService.processEvent(msg);

        if (msg.event === MinimaEvents.INITED) {
          console.log(
            "MDS initialised! 🚀 Starting serialized initialization sequence...",
          );

          // Avoid fixed startup delay; waitForNode() below already handles
          // backoff/retries only when the node is not ready yet.

          try {
            // STEP 1: Check Write Mode (with RETRY for node startup)
            console.log(
              "1️⃣ [AppContext] Checking Write Mode (Waiting for node)...",
            );

            const waitForNode = async (retries = 10): Promise<boolean> => {
              for (let i = 1; i <= retries; i++) {
                try {
                  const res: any = await new Promise((resolve) => {
                    (MDS as any).executeRaw("checkmode", resolve);
                  });

                  if (res && res.status) {
                    const mode = res.response.mode;
                    console.log(
                      `✅ [AppContext] Node ready! Mode: ${mode} (Attempt ${i})`,
                    );
                    if (mode === "WRITE") setWriteMode(true);
                    return true;
                  }

                  console.warn(
                    `⏳ [AppContext] Node not ready (Attempt ${i}/${retries})...`,
                  );
                } catch (e) {
                  console.warn(
                    `⏳ [AppContext] Connection error (Attempt ${i}/${retries}):`,
                    e,
                  );
                }
                await new Promise((r) => setTimeout(r, 2000));
              }
              return false;
            };

            const nodeReady = await waitForNode();
            if (!nodeReady) {
              console.error(
                "❌ [AppContext] Node failed to respond after retries.",
              );
              // Proceed anyway to allow manual connection screen to show if needed
            }

            // STEP 2: Initialize Database (Async)
            console.log("2️⃣ [AppContext] Initializing Database...");
            await minimaService.initDB();
            setDbReady(true);
            console.log("✅ [AppContext] Database ready");

            // STEP 2b: Post-DB Actions (Synchronous/Fast)
            // Even though these might be fast, we MUST await them to prevent request stacking
            // on slower nodes or if data exists (Update scenario).
            await minimaService.initProfile();
            console.log("🧹 [AppContext] Running legacy chat migration...");
            await minimaService.migrateLegacyChats();
            console.log("🧹 [AppContext] Normalizing identities...");
            await minimaService.normalizeIdentities();

            // NOTE: Confirmation Checker is DELAYED until final step to avoid traffic

            // STEP 3: Fetch User Profile (Async)
            console.log("3️⃣ [AppContext] Fetching User Profile...");
            await fetchUserProfile();

            // STEP 4: Initial Block Check (Async)
            console.log("4️⃣ [AppContext] Verifying Block Status...");
            const command = await MDS.cmd.block();
            setBlock(command.response);

            // FINAL STEP: Set Loaded & Start Background Services
            // This triggers useBeaconSender, SideMenu balance check, etc.
            console.log(
              "✅ [AppContext] Initialization Complete! Setting loaded = true",
            );
            setLoaded(true);

            // Start polling services NOW, after the main load is done
            console.log(
              "⏰ [AppContext] Starting transaction confirmation checker...",
            );
            minimaService.startConfirmationChecker();

            // Start offline queue
            minimaService.startOfflineQueue();
          } catch (err) {
            console.error(
              "❌ [AppContext] Initialization Sequence Failed:",
              err,
            );
            setLoaded(true);
          }
        }

        // Listen for NEWBLOCK events to detect synchronization
        if (msg.event === MinimaEvents.NEWBLOCK) {
          // When we receive a new block, the node is synced
          setSynced(true);
          const command = await MDS.cmd.block();
          setBlock(command.response);
        }

        // Handle Disconnection / MDS Failure
        if ((msg.event as any) === "MDSFAIL") {
          console.warn(
            "⚠️ [AppContext] MDSFAIL received - Minima connection lost!",
          );
          setSynced(false);
        }
      });
    }

    // Add browser-level offline/online listeners
    const handleOffline = () => {
      console.warn("⚠️ [AppContext] Browser went offline");
      setSynced(false);
    };

    const handleOnline = () => {
      console.log(
        "✅ [AppContext] Browser back online - waiting for Minima...",
      );
      // We don't immediately set synced=true here; we wait for the next NEWBLOCK or success cmd
      // But we could trigger a check
      MDS.cmd.block().then((res) => {
        if (res.status) {
          console.log(
            "✅ [AppContext] Minima verified online after reconnection",
          );
          setSynced(true);
        }
      });
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  // Heartbeat to check Minima connection status periodically
  // Serialized Heartbeat to check Minima connection status
  // Uses recursive setTimeout instead of setInterval to prevent request stacking
  useEffect(() => {
    if (!loaded) return;

    const HEARTBEAT_INTERVAL_MS = 5000;
    const HEARTBEAT_TIMEOUT_MS = 5000;
    const HEARTBEAT_FAILURE_THRESHOLD = 3;

    let timeoutId: NodeJS.Timeout;
    let isActive = true; // Flag to prevent state updates after unmount
    let inFlight = false;
    let consecutiveFailures = 0;

    const checkHeartbeat = async () => {
      // If we unmounted, stop
      if (!isActive) return;
      if (inFlight) return;
      inFlight = true;

      try {
        // Create a timeout promise that rejects after 5 seconds (prevent hanging requests)
        let timeoutHandle: NodeJS.Timeout;
        const timeout = new Promise<any>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error("Timeout")),
            HEARTBEAT_TIMEOUT_MS,
          );
        });

        // Race the block check against the timeout
        const res = await Promise.race([MDS.cmd.block(), timeout]);
        clearTimeout(timeoutHandle!);

        if (isActive) {
          if (res.status) {
            consecutiveFailures = 0;
            if (!syncedRef.current) {
              console.log("✅ [AppContext] Heartbeat - Minima is BACK ONLINE");
              setSynced(true);
            }
          } else {
            consecutiveFailures += 1;
            console.warn(
              `⚠️ [AppContext] Heartbeat - Minima returned failure status (${consecutiveFailures}/${HEARTBEAT_FAILURE_THRESHOLD})`,
            );
            if (
              syncedRef.current &&
              consecutiveFailures >= HEARTBEAT_FAILURE_THRESHOLD
            ) {
              setSynced(false);
            }
          }
        }
      } catch (err) {
        if (isActive) {
          consecutiveFailures += 1;
          console.warn(
            `⚠️ [AppContext] Heartbeat - Request Failed or Timed Out (${consecutiveFailures}/${HEARTBEAT_FAILURE_THRESHOLD}):`,
            err,
          );
          if (
            syncedRef.current &&
            consecutiveFailures >= HEARTBEAT_FAILURE_THRESHOLD
          ) {
            setSynced(false);
          }
        }
      } finally {
        inFlight = false;
        // Schedule next check ONLY after this one completes (approx 5s delay)
        if (isActive) {
          timeoutId = setTimeout(checkHeartbeat, HEARTBEAT_INTERVAL_MS);
        }
      }
    };

    // Start the loop
    checkHeartbeat();

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [loaded]);

  // Session Expiry Detection (Startup & Resume)
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      // Run check regardless of storage source to catch all invalid states
      console.log("🕵️‍♂️ [AppContext] Checking Session Validity...");

      try {
        // TIMEOUT ENFORCEMENT: MDS.cmd can hang on 500 errors (invalid UID)
        // We race against a 15s timeout (increased from 10s for slow node startups/wakeups)
        const timeout = new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error("Session Check Timeout")), 15000),
        );

        const res = await Promise.race([MDS.cmd.block(), timeout]);

        console.log("🕵️‍♂️ [AppContext] Session Check Result:", res);

        // STRICT CHECK: Only flag as expired if the node EXPLICITLY rejects the UID.
        // If it's a network error, timeout, or 500 without specific message, it might just be offline/busy.
        if (
          !res.status &&
          typeof res.error === "string" &&
          (res.error.includes("Incorrect Minima Dapp UID") ||
            res.error.includes("Not allowed"))
        ) {
          console.warn(
            "🚨 [AppContext] Session Expired - Invalid UID detected by Node!",
          );
          setSessionExpired(true);
        } else if (res.status) {
          // Recover if it starts working again
          if (sessionExpired) {
            console.log("✅ [AppContext] Session recovered!");
            setSessionExpired(false);
          }
        } else {
          // Generic failure (Timeout, Network Error, etc.)
          console.warn(
            "⚠️ [AppContext] Session Check Failed (Network/Timeout) - Keeping session active.",
          );
          // We DO NOT set sessionExpired=true here. We let checkHeartbeat handle the 'synced' state.
        }
      } catch (err) {
        console.error(
          "❌ [AppContext] Session check exception (Network/Timeout):",
          err,
        );
        // Do NOT treat network errors/timeouts as expired permissions
        // setSessionExpired(true); // <--- REMOVED
      }
    };

    // Run on mount (Startup)
    checkSession();

    // Run on Resume
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log(
          "👀 [AppContext] App resumed - checking session validity...",
        );
        checkSession();
        // Sync badge count / notifications on resume (in case messages arrived in background)
        chatService.updateUnreadNotification();
        // Also clear notifications on resume if desired, but user suggested clearing when opening app
        chatService.clearNotifications();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Request notification permissions on app load (Android 13+)
  useEffect(() => {
    if (loaded) {
      chatService.requestNotificationPermission();
    }
  }, [loaded]);

  const context = {
    loaded,
    dbReady,
    synced,
    block,
    userName,
    userAvatar,
    writeMode,
    myPublicKey,
    updateUserProfile,
    refreshWriteMode,
    refreshProfile,
    showDebugPanel,
    setShowDebugPanel,
    sessionExpired, // Exported for UI components to react
  };

  return <appContext.Provider value={context}>{children}</appContext.Provider>;
};

export const useAppContext = () => useContext(appContext);
export default AppProvider;
