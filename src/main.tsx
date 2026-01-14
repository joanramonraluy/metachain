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
import { checkMinimaStructure } from "./services/debug_structure";
import "./index.css"

// Debug
setTimeout(() => {
  checkMinimaStructure();
}, 5000);

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



ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </AppProvider>
  </React.StrictMode>
)
