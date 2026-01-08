import { createFileRoute, Outlet } from '@tanstack/react-router'
import { SettingsTabs } from '../components/SettingsTabs'

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 transition-colors">
      <div className="flex-none p-4 md:p-8 pb-0">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Settings</h1>
        <SettingsTabs />
      </div>
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
