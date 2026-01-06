import { createFileRoute } from "@tanstack/react-router"
import { Info as InfoIcon, Shield, Zap, Heart, Github, Globe, ExternalLink } from "lucide-react"

export const Route = createFileRoute("/about")({
  component: About,
})

function About() {
  const appVersion = "0.0.1"; // You might want to pull this from package.json or config

  return (
    <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900 transition-colors">
      <div className="max-w-3xl mx-auto p-6 space-y-8">

        {/* Hero Section */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8 text-center relative overflow-hidden transition-colors">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-primary-500 via-purple-500 to-pink-500"></div>

          <div className="w-20 h-20 bg-primary-50 rounded-2xl mx-auto flex items-center justify-center mb-4 text-primary-600 shadow-sm">
            <Zap size={40} fill="currentColor" className="text-primary-500" />
          </div>

          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">MetaChain</h1>
          <p className="text-gray-500 dark:text-gray-400 font-medium mb-6">v{appVersion}</p>

          <p className="text-gray-600 dark:text-gray-300 leading-relaxed max-w-lg mx-auto">
            Experience the future of decentralized messaging. Send messages, share Charms, and transfer tokens securely on the Minima network.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center text-green-600 dark:text-green-400 mb-4">
              <Shield size={20} />
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Secure & Private</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              End-to-end encrypted messaging powered by the Minima blockchain. Your data stays yours.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center text-purple-600 dark:text-purple-400 mb-4">
              <Heart size={20} />
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Expressive</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Send unique "Charms" to your friends to show appreciation or just say hello in style.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center text-orange-600 dark:text-orange-400 mb-4">
              <Zap size={20} />
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Fast & Free</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Instant peer-to-peer transactions with no middleman and minimal fees.
            </p>
          </div>
        </div>

        {/* Resources Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden transition-colors">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <InfoIcon size={18} className="text-primary-500" />
              Resources
            </h3>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            <a
              href="https://minima.global"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Globe size={20} className="text-gray-400 group-hover:text-primary-500 transition-colors" />
                <span className="text-gray-700 dark:text-gray-300 font-medium">Minima Website</span>
              </div>
              <ExternalLink size={16} className="text-gray-400" />
            </a>

            <a
              href="https://github.com/minima-global"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Github size={20} className="text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white transition-colors" />
                <span className="text-gray-700 dark:text-gray-300 font-medium">Source Code</span>
              </div>
              <ExternalLink size={16} className="text-gray-400" />
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-4 pb-8">
          <p className="text-sm text-gray-400 flex items-center justify-center gap-1">
            Powered by <span className="font-bold text-gray-500">Minima</span>
          </p>
        </div>

      </div>
    </div>
  )
}
