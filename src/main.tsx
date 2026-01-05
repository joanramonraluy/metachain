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
import "./index.css"

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

// Security: Self-XSS Warning
if (!import.meta.env.DEV) {
  setTimeout(() => {
    console.log("%cSTOP!", "color: red; font-size: 50px; font-weight: bold; text-shadow: 2px 2px 0px black;");
    console.log("%cThis feature is intended for developers. If someone told you to copy-paste something here to enable a feature or 'hack' someone's account, it is a scam and you will lose your account.", "font-size: 16px; color: #444; font-family: sans-serif;");
    console.log("%cDon't paste code you don't understand.", "font-size: 16px; color: red; font-weight: bold; font-family: sans-serif; underline: true;");
  }, 1000);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  </React.StrictMode>
)
