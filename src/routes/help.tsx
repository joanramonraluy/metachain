import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { HelpCircle, ChevronDown, ChevronUp, MessageCircle, Users, Shield, Globe, Zap, Settings } from "lucide-react"

export const Route = createFileRoute("/help")({
  component: Help,
})

function Help() {
  const [openSection, setOpenSection] = useState<string | null>("getting-started")

  const toggleSection = (section: string) => {
    setOpenSection(openSection === section ? null : section)
  }

  const sections = [
    {
      id: "getting-started",
      title: "Getting Started",
      icon: Zap,
      color: "blue",
      content: (
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">Welcome to MetaChain! Here's how to get started:</p>
          <ol className="list-decimal list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li><strong>Set up your profile</strong> - Go to Settings → Profile to add your name, bio, and avatar</li>
            <li><strong>Enable Discovery</strong> - Your profile will be shared with other MetaChain users via P2P</li>
            <li><strong>Find contacts</strong> - Navigate to Discovery to see other users on the network</li>
            <li><strong>Start chatting</strong> - Send messages, charms, or tokens to your contacts</li>
          </ol>
        </div>
      )
    },
    {
      id: "profiles",
      title: "Profiles & Discovery",
      icon: Globe,
      color: "purple",
      content: (
        <div className="space-y-4">
          <h4 className="font-semibold text-gray-900 dark:text-white">Profile Setup</h4>
          <p className="text-gray-700 dark:text-gray-300">Your profile has three levels of information:</p>
          <ul className="space-y-3 text-gray-700 dark:text-gray-300">
            <li><strong className="text-primary-600 dark:text-primary-400">Level 1 (Discovery Profile)</strong> - Name and Bio visible to all discovered peers via P2P</li>
            <li><strong className="text-purple-600 dark:text-purple-400">Level 2 (Additional Information)</strong> - Location, languages, website, and social links</li>
            <li><strong className="text-amber-600 dark:text-amber-400">Level 3 (Private Contact)</strong> - Email and phone number for close contacts only</li>
          </ul>

          <h4 className="font-semibold text-gray-900 dark:text-white mt-6">Discovery</h4>
          <p className="text-gray-700 dark:text-gray-300">MetaChain uses P2P beacons to discover other users:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li>Your profile is broadcast periodically to nearby peers</li>
            <li>Discovered users appear in the Discovery tab</li>
            <li>You can control visibility in Settings → Privacy</li>
          </ul>
        </div>
      )
    },
    {
      id: "messaging",
      title: "Messaging",
      icon: MessageCircle,
      color: "green",
      content: (
        <div className="space-y-4">
          <h4 className="font-semibold text-gray-900 dark:text-white">Sending Messages</h4>
          <p className="text-gray-700 dark:text-gray-300">MetaChain supports three types of messages:</p>
          <ul className="space-y-3 text-gray-700 dark:text-gray-300">
            <li><strong>Text Messages</strong> - Standard encrypted messages</li>
            <li><strong>Charms ✨</strong> - Special tokens to show appreciation (like reactions)</li>
            <li><strong>Token Transfers 💰</strong> - Send Minima tokens directly in chat</li>
          </ul>

          <h4 className="font-semibold text-gray-900 dark:text-white mt-6">Chat Permissions</h4>
          <p className="text-gray-700 dark:text-gray-300">Control who can message you:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li><strong>Allow chats from non-contacts</strong> - Anyone can message you</li>
            <li><strong>Contacts only</strong> - Only approved contacts can send messages</li>
          </ul>
        </div>
      )
    },
    {
      id: "groups",
      title: "Groups",
      icon: Users,
      color: "indigo",
      content: (
        <div className="space-y-4">
          <h4 className="font-semibold text-gray-900 dark:text-white">Creating Groups</h4>
          <ol className="list-decimal list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li>Go to Chats → Groups tab</li>
            <li>Click the "+" button</li>
            <li>Add group name, description, and avatar</li>
            <li>Select members from your contacts</li>
            <li>Click "Create Group"</li>
          </ol>

          <h4 className="font-semibold text-gray-900 dark:text-white mt-6">Managing Groups</h4>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li>Only the creator can add/remove members</li>
            <li>All members can send messages</li>
            <li>Group messages are encrypted for all participants</li>
          </ul>
        </div>
      )
    },
    {
      id: "privacy",
      title: "Privacy Levels",
      icon: Shield,
      color: "amber",
      content: (
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">MetaChain uses a three-level privacy system:</p>

          <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg p-4">
            <h5 className="font-semibold text-primary-900 dark:text-primary-200 mb-2">Level 1 - Discovery Profile</h5>
            <p className="text-sm text-primary-700 dark:text-primary-300">Visible to: <strong>All discovered peers</strong></p>
            <p className="text-sm text-primary-700 dark:text-primary-300 mt-1">Includes: Name, Bio</p>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
            <h5 className="font-semibold text-purple-900 dark:text-purple-200 mb-2">Level 2 - Additional Information</h5>
            <p className="text-sm text-purple-700 dark:text-purple-300">Visible to: <strong>Contacts or Everyone</strong> (your choice)</p>
            <p className="text-sm text-purple-700 dark:text-purple-300 mt-1">Includes: Location, Languages, Website, Social Links</p>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <h5 className="font-semibold text-amber-900 dark:text-amber-200 mb-2">Level 3 - Private Contact</h5>
            <p className="text-sm text-amber-700 dark:text-amber-300">Visible to: <strong>Personal Contacts only</strong></p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">Includes: Email, Phone</p>
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-400 mt-4">Configure visibility in Settings → Privacy</p>
        </div>
      )
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      icon: Settings,
      color: "red",
      content: (
        <div className="space-y-4">
          <h4 className="font-semibold text-gray-900 dark:text-white">Common Issues</h4>

          <div className="space-y-4">
            <div>
              <h5 className="font-medium text-gray-900 dark:text-white">Can't see discovered users</h5>
              <ul className="list-disc list-inside text-sm text-gray-700 dark:text-gray-300 mt-1">
                <li>Check your network connection</li>
                <li>Ensure Discovery is enabled in Settings</li>
                <li>Wait a few minutes for P2P beacons to propagate</li>
              </ul>
            </div>

            <div>
              <h5 className="font-medium text-gray-900 dark:text-white">Messages not sending</h5>
              <ul className="list-disc list-inside text-sm text-gray-700 dark:text-gray-300 mt-1">
                <li>Check if recipient allows non-contact chats</li>
                <li>Verify your Minima node is running</li>
                <li>Check Application Mode in Settings → Privacy</li>
              </ul>
            </div>

            <div>
              <h5 className="font-medium text-gray-900 dark:text-white">Profile not updating</h5>
              <ul className="list-disc list-inside text-sm text-gray-700 dark:text-gray-300 mt-1">
                <li>Changes auto-save after a short delay</li>
                <li>Check for error messages in the UI</li>
                <li>Refresh the page if needed</li>
              </ul>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "faq",
      title: "FAQ",
      icon: HelpCircle,
      color: "gray",
      content: (
        <div className="space-y-4">
          <div>
            <h5 className="font-medium text-gray-900 dark:text-white">What is MetaChain?</h5>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">MetaChain is a decentralized messaging app built on the Minima blockchain, offering secure, private communication with built-in token transfers.</p>
          </div>

          <div>
            <h5 className="font-medium text-gray-900 dark:text-white">Is my data private?</h5>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">Yes! All messages are end-to-end encrypted. Your profile data is only shared according to your privacy settings.</p>
          </div>

          <div>
            <h5 className="font-medium text-gray-900 dark:text-white">What are Charms?</h5>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">Charms are special tokens you can send to show appreciation, similar to reactions or likes, but as blockchain tokens.</p>
          </div>

          <div>
            <h5 className="font-medium text-gray-900 dark:text-white">How does Discovery work?</h5>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">MetaChain uses P2P beacons to broadcast your profile to nearby peers. You can control what information is shared in Privacy settings.</p>
          </div>

          <div>
            <h5 className="font-medium text-gray-900 dark:text-white">What is the recommended Gossip Peer Limit?</h5>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">We recommend 5 peers for optimal performance. This balances network discovery with data usage.</p>
          </div>
        </div>
      )
    }
  ]

  return (
    <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900 transition-colors">
      <div className="max-w-4xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8 text-center transition-colors">
          <div className="w-16 h-16 bg-primary-50 dark:bg-primary-900/20 rounded-2xl mx-auto flex items-center justify-center mb-4">
            <HelpCircle size={32} className="text-primary-500" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Help Center</h1>
          <p className="text-gray-600 dark:text-gray-400">Everything you need to know about using MetaChain</p>
        </div>

        {/* Accordion Sections */}
        <div className="space-y-3">
          {sections.map((section) => {
            const Icon = section.icon
            const isOpen = openSection === section.id

            return (
              <div key={section.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden transition-colors">
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 bg-${section.color}-100 dark:bg-${section.color}-900/30 rounded-lg flex items-center justify-center text-${section.color}-600 dark:text-${section.color}-400`}>
                      <Icon size={20} />
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white text-left">{section.title}</h3>
                  </div>
                  {isOpen ? (
                    <ChevronUp size={20} className="text-gray-400" />
                  ) : (
                    <ChevronDown size={20} className="text-gray-400" />
                  )}
                </button>

                {isOpen && (
                  <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50 text-gray-700 dark:text-gray-300">
                    {section.content}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="text-center pt-4 pb-8">
          <p className="text-sm text-gray-500">
            Still need help? Check the <a href="/about" className="text-primary-600 dark:text-primary-400 hover:underline">About page</a> for more resources.
          </p>
        </div>

      </div>
    </div>
  )
}
