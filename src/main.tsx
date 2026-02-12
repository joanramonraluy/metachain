// src/main.tsx

import { MDS } from "@minima-global/mds"
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import React from "react"
import ReactDOM from "react-dom/client"
import AppProvider from "./AppContext.tsx"
import { ThemeProvider } from "./context/ThemeContext.tsx"
import "./index.css"
// Debug check removed to prevent race conditions with MDS initialization

import { routeTree } from "./routeTree.gen"



// Check if we need to restore a route after reload (e.g. from Settings check permissions)
const lastRoute = localStorage.getItem("lastRoute");
if (lastRoute) {
  localStorage.removeItem("lastRoute");
}

const memoryHistory = createMemoryHistory({
  initialEntries: [lastRoute || "/"],
})

const router = createRouter({ routeTree, history: memoryHistory })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

if (import.meta.env.DEV) {
  MDS.DEBUG_HOST = import.meta.env.VITE_DEBUG_HOST
  MDS.DEBUG_PORT = Number(import.meta.env.VITE_DEBUG_MDS_PORT)
  MDS.DEBUG_MINIDAPPID = import.meta.env.VITE_DEBUG_SESSION_ID
}

// ============================================================================
// AUTOMATIC UID INGESTION (Ingest & Reload Pattern)
// If we catch a UID in the URL (Discovery) or via Deep Link, we save it 
// to localStorage and RELOAD the page without the parameter.
// This mimics the "Connect & Reload" manual flow from settings.
// ============================================================================
const catchAndIngest = (incomingUid: string | null, incomingMds: string | null, incomingRpcUid: string | null, source: string) => {
  let changed = false;

  if (incomingUid) {
    const storedUid = localStorage.getItem('minima_uid');
    if (incomingUid !== storedUid) {
      console.log(`🚀 [Main] NEW UID detected via ${source}, saving...`);
      localStorage.setItem('minima_uid', incomingUid);
      changed = true;
    }
  }

  if (incomingRpcUid) {
    const storedRpcUid = localStorage.getItem('minima_rpc_uid');
    if (incomingRpcUid !== storedRpcUid) {
      console.log(`🚀 [Main] NEW RPC-Discovery UID detected via ${source}: ${incomingRpcUid}, saving...`);
      localStorage.setItem('minima_rpc_uid', incomingRpcUid);
      changed = true;
    }
  }

  if (incomingMds) {
    // Only force HTTP for local loopback addresses (127.0.0.1/localhost)
    // to avoid SSL handshake issues in Capacitor WebViews for those hosts.
    // For other hosts (PC/External), trust the reported protocol.
    let cleanMds = incomingMds;
    if (incomingMds.includes('127.0.0.1') || incomingMds.includes('localhost')) {
      cleanMds = incomingMds.replace('https://', 'http://');
    }

    if (!cleanMds.endsWith('/')) {
      cleanMds += '/';
    }

    const storedMds = localStorage.getItem('minima_mds_host');
    if (cleanMds !== storedMds) {
      console.log(`🚀 [Main] NEW MDS Host detected via ${source}: ${cleanMds}, saving...`);
      localStorage.setItem('minima_mds_host', cleanMds);
      changed = true;
    }

    // Also store as RPC-discovered host for settings to use
    localStorage.setItem('minima_rpc_mds_host', cleanMds);
  }

  if (changed) {
    // ONLY reload if in Capacitor (Standalone APK)
    // MiniDapps running inside Minima NEED the URL parameters (uid) to initialize mds.js
    if ((window as any).Capacitor) {
      console.log("🚀 [Main] Ingestion complete (Capacitor), reloading for clean state...");
      const cleanUrl = window.location.origin + window.location.pathname;
      window.location.replace(cleanUrl);
      return true;
    } else {
      console.log("🚀 [Main] Ingestion complete (MiniDapp), NOT reloading to preserve URL parameters.");
    }
  }
  return false;
};

// 1. Check URL Parameters immediately (Discovery flow)
const urlParams = new URLSearchParams(window.location.search);
const urlUid = urlParams.get('uid') || urlParams.get('sessionuid') || urlParams.get('minima_uid');
const urlMds = urlParams.get('mds_host');
const urlRpcUid = urlParams.get('rpc_uid');
if (catchAndIngest(urlUid, urlMds, urlRpcUid, 'URL')) {
  throw new Error("Reloading for UID/MDS ingestion...");
}

// ============================================================================
// GLOBAL MDS PATCH (Capacitor Standalone APK Only)
// Forces HTTP protocol and sets host/port for local node connection
// ============================================================================
if ((window as any).Capacitor && window.location.hostname === 'localhost') {
  console.log("🚀 [GlobalPatch] CAPACITOR APK DETECTED - Locking Connection");
  const anyMDS = (MDS as any);

  // 1. Determine Host (from local storage or default)
  const lockedHost = localStorage.getItem('minima_mds_host') || "http://127.0.0.1:9003/";
  const lockedMain = lockedHost + "mdscommand_/";

  console.log("🚀 [GlobalPatch] Using Locked Host:", lockedHost);

  // 2. AGGRESSIVE LOCK: Use getters to prevent the library from overwriting these
  Object.defineProperty(anyMDS, 'filehost', {
    get: () => lockedHost,
    set: () => { /* ignore */ },
    configurable: true
  });
  Object.defineProperty(anyMDS, 'mainhost', {
    get: () => lockedMain,
    set: () => { /* ignore */ },
    configurable: true
  });
  Object.defineProperty(anyMDS, 'testhost', {
    get: () => lockedHost,
    set: () => { /* ignore */ },
    configurable: true
  });

  anyMDS.DEBUG_PROTOCOL = "http:";

  // 3. XHR HIJACK: Log all outgoing MDS requests to see EXACT URLs
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method: string, url: string | URL) {
    const urlStr = url.toString();
    const isMds = urlStr.includes('9003') || urlStr.includes('mds') || urlStr.includes('127.0.0.1');

    if (isMds) {
      console.log(`📡 [XHR] ${method} -> ${urlStr}`);

      this.addEventListener('load', function () {
        console.log(`📡 [XHR] Response ${this.status} from ${urlStr}`);
        console.log(`📡 [XHR] Body (${this.status}): "${this.responseText.substring(0, 300)}${this.responseText.length > 300 ? '...' : ''}"`);
      });

      this.addEventListener('error', function () {
        console.error(`📡 [XHR] Network Error connecting to ${urlStr}`);
      });
    }
    return originalOpen.apply(this, arguments as any);
  };

  // 4. Hijack init for UID handling
  const originalInit = anyMDS.init;
  anyMDS.init = (callback: any) => {
    // Final check for UID (should be in localStorage by now)
    if (!anyMDS.minidappuid) {
      anyMDS.minidappuid = localStorage.getItem('minima_uid') || "0x00";
    }

    console.log("🚀 [GlobalPatch] MDS Init Hijacked. UID:", anyMDS.minidappuid);
    console.log("🚀 [GlobalPatch] Final Hosts:", anyMDS.filehost, anyMDS.mainhost);

    originalInit(callback);
  };
}
// ============================================================================


// Check for Deep Link on startup
import { App } from '@capacitor/app';

const handleDeepLink = (urlStr: string, source: string) => {
  console.log(`App ${source} with URL:`, urlStr);
  localStorage.setItem(`debug_launch_url_${source === 'opened' ? 'open' : 'cold'}`, urlStr);
  try {
    const url = new URL(urlStr);
    if (url.protocol.includes('metachain')) {
      const uid = url.searchParams.get('uid') || url.searchParams.get('sessionuid') || url.searchParams.get('minima_uid');
      const mds = url.searchParams.get('mds_host');
      const rpc = url.searchParams.get('rpc_uid');
      if (catchAndIngest(uid, mds, rpc, `DeepLink (${source})`)) {
        console.log("Reloading after deep link ingestion...");
      }
    }
  } catch (err) {
    console.error(`Error parsing ${source} Deep Link:`, err);
  }
};

App.addListener('appUrlOpen', data => {
  handleDeepLink(data.url, 'opened');
});

// Check for Cold Start Deep Link
App.getLaunchUrl().then(data => {
  if (data && data.url) {
    handleDeepLink(data.url, 'cold');
  }
});

// Handle Android Hardware Back Button
App.addListener('backButton', () => {
  const currentPath = router.state.location.pathname;
  console.log(`[Navigation] Back Button Pressed. Path: ${currentPath}`);

  // Exit app if on root or login screen
  if (currentPath === '/' || currentPath === '/settings/connect') {
    App.exitApp();
  } else {
    // Go back in router history
    router.history.back();
  }
});

// Launcher Mode Logic Removed as per user request (Direct Load)
// Deep Link listeners (App.addListener) above handle native app navigation if triggered externally.

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </AppProvider>
  </React.StrictMode>
)
