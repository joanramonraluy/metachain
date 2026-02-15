// src/main.tsx

import { MDS } from "@minima-global/mds"
import { Capacitor, CapacitorHttp } from '@capacitor/core';
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


// SUPER DEBUG: Log Environment immediately
console.log("🚀 [Main] STARTUP ENV CHECK:");
console.log("🚀 [Main] URL:", window.location.href);
console.log("🚀 [Main] Hostname:", window.location.hostname);
console.log("🚀 [Main] Protocol:", window.location.protocol);
console.log("🚀 [Main] Native:", Capacitor.isNativePlatform());

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
if (Capacitor.isNativePlatform()) {
  console.log("🚀 [GlobalPatch] CAPACITOR APK DETECTED - Locking Connection");
  const anyMDS = (MDS as any);

  // FORCE 127.0.0.1 for all Native connections to bypass unreachable Emulator IPs.
  // We dynamic detection protocol (HTTP vs HTTPS) but lock the target to loopback.
  const storedMds = localStorage.getItem('minima_mds_host') || "";
  const detectedProtocol = (urlMds?.startsWith('https') || storedMds.startsWith('https')) ? "https:" : "http:";

  let lockedHost = `${detectedProtocol}//127.0.0.1:9003/`;

  if (Capacitor.isNativePlatform()) {
    console.log(`🚀 [GlobalPatch] Syncing Protocol (${detectedProtocol}) -> Locked Host: ${lockedHost}`);
    localStorage.setItem('minima_mds_host', lockedHost);
  }

  const lockedMain = lockedHost + "mdscommand_/";

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

  anyMDS.DEBUG_PROTOCOL = detectedProtocol;

  // 3. XHR PROXY: Intercept MDS requests and route via Native HTTP (Bypasses CORS/SSL/Network Restrictions)
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL) {
    (this as any)._method = method;
    (this as any)._url = url.toString();
    return originalOpen.apply(this, arguments as any);
  };

  XMLHttpRequest.prototype.send = function (body: any) {
    const urlStr = (this as any)._url;
    // Intercept ONLY MDS requests (Port 9003 or mdscommand)
    if (urlStr && (urlStr.includes('9003') || urlStr.includes('mdscommand_'))) {
      console.log(`🚀 [NativeProxy] Intercepting XHR -> CapacitorHttp: ${urlStr}`);
      console.log(`🚀 [NativeProxy] Body:`, body);

      const options = {
        url: urlStr,
        method: (this as any)._method || 'GET',
        data: body,
        headers: {
          'Connection': 'close',
          'Accept': '*/*',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      };

      // Execute via Native Bridge
      CapacitorHttp.request(options).then((response) => {
        // Map Native Response to XHR properties
        Object.defineProperty(this, 'status', { value: response.status, writable: true });
        Object.defineProperty(this, 'statusText', { value: (response.status === 200 ? 'OK' : 'ERROR'), writable: true });
        Object.defineProperty(this, 'responseText', { value: (typeof response.data === 'string' ? response.data : JSON.stringify(response.data)), writable: true });
        Object.defineProperty(this, 'response', { value: this.responseText, writable: true });
        Object.defineProperty(this, 'readyState', { value: 4, writable: true });

        // Trigger XHR events manually to satisfy mds.js
        if (this.onreadystatechange) this.onreadystatechange(new Event('readystatechange'));
        if (this.onload) this.onload(new ProgressEvent('load'));

        console.log(`🚀 [NativeProxy] Success: ${urlStr} (${response.status})`);
      }).catch((err) => {
        console.error(`❌ [NativeProxy] Failed: ${urlStr}`, err);
        Object.defineProperty(this, 'status', { value: 0, writable: true });
        if (this.onerror) this.onerror(new ProgressEvent('error'));
      });

      return; // STOP execution of original XHR
    }

    // Fallback for non-MDS requests (assets, etc.)
    return originalSend.apply(this, arguments as any);
  };

  // 4. Hijack init for UID handling
  const originalInit = anyMDS.init;
  anyMDS.init = function (callback: any) {
    // Final check for UID (should be in localStorage by now)
    if (!anyMDS.minidappuid) {
      const stored = localStorage.getItem('minima_uid');
      if (stored) {
        console.log(`🚀 [GlobalPatch] Injecting Stored UID: ${stored}`);
        anyMDS.minidappuid = stored;
      } else {
        console.warn("⚠️ [GlobalPatch] No UID found in Storage - defaulting to 0x00");
        anyMDS.minidappuid = "0x00";
      }
    } else {
      console.log(`🚀 [GlobalPatch] MDS already has UID: ${anyMDS.minidappuid}`);
    }

    console.log("🚀 [GlobalPatch] MDS Init Hijacked. Context fixed. UID:", anyMDS.minidappuid);
    console.log("🚀 [GlobalPatch] Target Hosts:", anyMDS.filehost, anyMDS.mainhost);

    // FIX: Context Binding - Use .call(this) to ensure 'this' refers to MDS object
    return originalInit.call(anyMDS, callback);
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
