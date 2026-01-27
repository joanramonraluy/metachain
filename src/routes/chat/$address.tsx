// src/routes/chat/$address.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/chat/$address")({
  pendingComponent: () => (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header placeholder */}
      <div className="h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"></div>
      {/* Content area with spinner */}
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    </div>
  ),
});