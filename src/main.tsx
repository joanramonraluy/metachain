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



// Check for Deep Link on startup
import { App } from '@capacitor/app';

const handleDeepLink = (urlStr: string, source: string) => {
  console.log(`App ${source} with URL:`, urlStr);
  localStorage.setItem(`debug_launch_url_${source === 'opened' ? 'open' : 'cold'}`, urlStr);
  try {
    const url = new URL(urlStr);
    if (url.protocol.includes('metachain')) {
      // Check for various possible parameter names
      const uid = url.searchParams.get('uid') || url.searchParams.get('sessionuid') || url.searchParams.get('minima_uid');
      if (uid) {
        localStorage.setItem('minima_uid', uid);
        console.log(`UID Received via ${source} Deep Link:`, uid);
        // Only alert/reload if we are capture a NEW uid
        if (source === 'opened') {
          alert(`MetaChain Connected!\nUID: ${uid.substring(0, 10)}...`);
          window.location.reload();
        } else {
          window.location.reload();
        }
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
