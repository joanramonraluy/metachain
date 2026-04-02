import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import {
  HelpCircle,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Users,
  Shield,
  Globe,
  Zap,
  Settings,
  Radio,
  Share2,
  Server,
  Smartphone,
  Repeat,
} from "lucide-react"

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
      color: "sky",
      content: (
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">
            Welcome to MetaChain! Follow these steps to join the decentralized
            network:
          </p>
          <ol className="list-decimal list-inside space-y-3 text-gray-700 dark:text-gray-300">
            <li>
              <strong className="text-gray-900 dark:text-white">
                Profile Setup
              </strong>{" "}
              - Go to{" "}
              <span className="font-semibold px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">
                Settings → Profile
              </span>{" "}
              to set your identity (alias, bio, avatar).
            </li>
            <li>
              <strong className="text-gray-900 dark:text-white">
                Enable P2P Discovery
              </strong>{" "}
              - Your node will broadcast an encrypted "beacon" to nearby peers,
              making you visible in their{" "}
              <span className="font-semibold text-primary-600">Community</span>{" "}
              tab.
            </li>
            <li>
              <strong className="text-gray-900 dark:text-white">
                Find People
              </strong>{" "}
              - Browse the{" "}
              <span className="font-semibold text-primary-600">Discovery</span>{" "}
              section to find other users, groups, and channels.
            </li>
            <li>
              <strong className="text-gray-900 dark:text-white">
                Start Communicating
              </strong>{" "}
              - Send messages, share tokens, or join public spaces.
            </li>
          </ol>
        </div>
      ),
    },
    {
      id: "community-discovery",
      title: "Community & Discovery",
      icon: Globe,
      color: "indigo",
      content: (
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Share2 size={16} className="text-indigo-500" />
              P2P Beacons & Gossip
            </h4>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              MetaChain uses a reactive multi-hop relay. When you discover a
              peer, you automatically exchange catalogs of known users. This
              "Gossip" protocol helps everyone find each other without a central
              server.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Server size={16} className="text-indigo-500" />
              MLS (Reachability)
            </h4>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              The <strong>Mobile Lookup Service</strong> acts as a discovery
              hub. If you are in a sparse network, configuring a Static MLS in{" "}
              <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">
                Settings → Discovery
              </span>{" "}
              ensures you stay reachable even when you don't share direct P2P
              neighbors with your contacts.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Radio size={16} className="text-indigo-500" />
              Public Listings
            </h4>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Want to grow your community? Toggle <strong>"Public Listing"</strong>{" "}
              when creating a group or channel. It will be advertised via your
              beacon and appear in the <strong>Community</strong> tab of all
              discovered peers.
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "messaging",
      title: "Advanced Messaging",
      icon: MessageCircle,
      color: "emerald",
      content: (
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Repeat size={16} className="text-emerald-500" />
              Reply to Message
            </h4>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Long-press or swipe on a message to reply. This creates a visual
              thread, making complex conversations easier to follow.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Smartphone size={16} className="text-emerald-500" />
              Automatic Synchronization
            </h4>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              MetaChain automatically detects missing messages (gaps) in your
              history using sequence numbers. Background sync workers ensure
              your chat history is consistent across all your Minima nodes.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              Token & Charm Interactions
            </h4>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Send Minima <strong>Tokens</strong> 💰 or <strong>Charms</strong>{" "}
              ✨ directly in chat. These are real blockchain transactions
              embedded within your communication flow.
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "groups-channels",
      title: "Groups & Channels",
      icon: Users,
      color: "violet",
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800 rounded-xl">
              <h5 className="font-bold text-violet-900 dark:text-violet-200 text-sm mb-1">
                Groups
              </h5>
              <p className="text-xs text-violet-700 dark:text-violet-300">
                Collaborative spaces for up to 50 members. Everyone can chat and
                share.
              </p>
            </div>
            <div className="p-3 bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800 rounded-xl">
              <h5 className="font-bold text-sky-900 dark:text-sky-200 text-sm mb-1">
                Channels
              </h5>
              <p className="text-xs text-sky-700 dark:text-sky-300">
                Broadcast spaces. Only admins can post; subscribers can read and
                react.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              Auto-Approve Joiners
            </h4>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Groups can be configured to <strong>Auto-Approve</strong> join
              requests. If enabled, anyone with the invite link or who finds the
              group in "Community" can join instantly. Otherwise, the admin must
              manually approve their request.
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "privacy",
      title: "Privacy Levels",
      icon: Shield,
      color: "amber",
      content: (
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">
            Your data is yours. MetaChain uses a three-level privacy system:
          </p>

          <div className="space-y-3">
            <div className="flex gap-4 p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 shrink-0">
                <span className="font-bold">L1</span>
              </div>
              <div>
                <h5 className="font-bold text-gray-900 dark:text-white">
                  Discovery Profile
                </h5>
                <p className="text-xs text-gray-500">
                  Shared with everyone. Includes: Alias, Bio.
                </p>
              </div>
            </div>

            <div className="flex gap-4 p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 shrink-0">
                <span className="font-bold">L2</span>
              </div>
              <div>
                <h5 className="font-bold text-gray-900 dark:text-white">
                  Additional Info
                </h5>
                <p className="text-xs text-gray-500">
                  Shared with contacts or public. Includes: Socials, Bio detail.
                </p>
              </div>
            </div>

            <div className="flex gap-4 p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 shrink-0">
                <span className="font-bold">L3</span>
              </div>
              <div>
                <h5 className="font-bold text-gray-900 dark:text-white">
                  Private Contact
                </h5>
                <p className="text-xs text-gray-500">
                  Only for personal contacts. Includes: Email, Phone.
                </p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      icon: Settings,
      color: "rose",
      content: (
        <div className="space-y-5">
          <div className="space-y-2">
            <h5 className="font-bold text-gray-900 dark:text-white text-sm">
              Can't see discovered users?
            </h5>
            <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-400 space-y-1">
              <li>
                Ensure <strong>Discovery</strong> is enabled in Settings.
              </li>
              <li>Wait 30-60 seconds for beacons to propagate.</li>
              <li>
                Check your P2P connectivity in the Minima node status.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h5 className="font-bold text-gray-900 dark:text-white text-sm">
              Messages not sending via Public Key?
            </h5>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              If a contact is offline, MetaChain tries to resolve their{" "}
              <strong>Maxima Address</strong>. Ensure you have high discovery
              quality or manually set an MLS server to improve unicast delivery.
            </p>
          </div>

          <div className="space-y-2">
            <h5 className="font-bold text-gray-900 dark:text-white text-sm">
              Slow performance or high battery usage?
            </h5>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Reduce the <strong>Gossip Peer Limit</strong> in Discovery
              settings. We recommend 5-10 peers for a stable experience.
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "faq",
      title: "FAQ",
      icon: HelpCircle,
      color: "gray",
      content: (
        <div className="space-y-4">
          <div>
            <h5 className="font-medium text-gray-900 dark:text-white">
              What is MetaChain?
            </h5>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              MetaChain is a decentralized messaging app built on the Minima
              blockchain, offering secure, private communication with built-in
              token transfers.
            </p>
          </div>

          <div>
            <h5 className="font-medium text-gray-900 dark:text-white">
              Is my data private?
            </h5>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              Yes! All messages are end-to-end encrypted. Your profile data is
              only shared according to your privacy settings.
            </p>
          </div>

          <div>
            <h5 className="font-medium text-gray-900 dark:text-white">
              What are Charms?
            </h5>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              Charms are special tokens you can send to show appreciation,
              similar to reactions or likes, but as blockchain tokens.
            </p>
          </div>

          <div>
            <h5 className="font-medium text-gray-900 dark:text-white">
              How does Discovery work?
            </h5>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              MetaChain uses P2P beacons to broadcast your profile to nearby
              peers. You can control what information is shared in Privacy
              settings.
            </p>
          </div>

          <div>
            <h5 className="font-medium text-gray-900 dark:text-white">
              What is the recommended Gossip Peer Limit?
            </h5>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              We recommend 5 peers for optimal performance. This balances
              network discovery with data usage.
            </p>
          </div>
        </div>
      ),
    },
  ]

  const colorStyles: Record<string, string> = {
    sky: "bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400",
    indigo: "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400",
    emerald: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
    violet: "bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400",
    amber: "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400",
    rose: "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400",
    gray: "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
  }

  const activeColorStyles: Record<string, string> = {
    sky: "bg-sky-500 shadow-sky-500/30",
    indigo: "bg-indigo-500 shadow-indigo-500/30",
    emerald: "bg-emerald-500 shadow-emerald-500/30",
    violet: "bg-violet-500 shadow-violet-500/30",
    amber: "bg-amber-500 shadow-amber-500/30",
    rose: "bg-rose-500 shadow-rose-500/30",
    gray: "bg-gray-600 shadow-gray-600/30",
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-950 transition-colors">
      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-down {
          animation: fadeInDown 0.3s ease-out forwards;
        }
      `}</style>
      <div className="max-w-4xl mx-auto p-4 sm:p-8 space-y-8">
        {/* Premium Header */}
        <div className="relative bg-white dark:bg-gray-900 rounded-[2.5rem] shadow-xl shadow-primary-500/5 border border-gray-100 dark:border-gray-800 p-8 sm:p-12 text-center overflow-hidden transition-all group">
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-primary-500/10 rounded-full blur-3xl group-hover:scale-110 transition-transform duration-700"></div>
          <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl group-hover:scale-110 transition-transform duration-700 delay-100"></div>

          <div className="relative z-10">
            <div className="w-20 h-20 bg-gradient-to-br from-primary-500 to-indigo-600 rounded-3xl mx-auto flex items-center justify-center mb-6 shadow-lg shadow-primary-500/20 transform group-hover:rotate-6 transition-transform duration-500">
              <HelpCircle size={40} className="text-white" />
            </div>
            <h1 className="text-4xl sm:text-5xl font-black text-gray-900 dark:text-white mb-4 tracking-tight">
              Help Center
            </h1>
            <p className="max-w-md mx-auto text-gray-600 dark:text-gray-400 text-lg leading-relaxed">
              Master the decentralized world of MetaChain. Everything you need
              to know, in one place.
            </p>
          </div>
        </div>

        {/* FAQ Area with a bit of grid for desktop */}
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2 px-2">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Knowledge Base
            </h2>
            <div className="h-px flex-1 mx-4 bg-gray-200 dark:bg-gray-800"></div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {sections.map((section) => {
              const Icon = section.icon
              const isOpen = openSection === section.id

              return (
                <div
                  key={section.id}
                  className={`bg-white dark:bg-gray-900 rounded-[1.5rem] shadow-sm border transition-all duration-300 ${
                    isOpen
                      ? "border-primary-500/30 ring-4 ring-primary-500/5 shadow-md shadow-primary-500/10"
                      : "border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700"
                  }`}
                >
                  <button
                    onClick={() => toggleSection(section.id)}
                    className="w-full px-6 py-5 flex items-center justify-between group/btn text-left"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                          isOpen
                            ? `${activeColorStyles[section.color]} text-white shadow-lg`
                            : `${colorStyles[section.color]} group-hover/btn:scale-105`
                        }`}
                      >
                        <Icon size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 dark:text-white text-lg tracking-tight group-hover/btn:text-primary-600 dark:group-hover/btn:text-primary-400 transition-colors">
                          {section.title}
                        </h3>
                        {!isOpen && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">
                            Click to expand details
                          </p>
                        )}
                      </div>
                    </div>
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                        isOpen
                          ? "bg-primary-100 dark:bg-primary-900/40 text-primary-600"
                          : "bg-gray-50 dark:bg-gray-800 text-gray-400"
                      }`}
                    >
                      {isOpen ? (
                        <ChevronUp size={18} />
                      ) : (
                        <ChevronDown size={18} />
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-6 pb-6 pt-2 animate-fade-in-down">
                      <div className="h-px w-full bg-gray-100 dark:bg-gray-800 mb-6 mx-auto"></div>
                      <div className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 leading-relaxed">
                        {section.content}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Premium Footer */}
        <div className="relative mt-8 p-10 bg-gradient-to-br from-gray-900 to-black rounded-[2.5rem] overflow-hidden text-center shadow-2xl">
          <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:20px_20px]"></div>
          <p className="relative z-10 text-white font-medium mb-4">
            Still have questions?
          </p>
          <div className="relative z-10 flex flex-wrap justify-center gap-4">
            <a
              href="/about"
              className="px-8 py-3 bg-white text-gray-900 rounded-2xl font-bold text-sm hover:bg-gray-100 transition-all shadow-xl hover:shadow-white/10 active:scale-95"
            >
              System Status
            </a>
            <button
              className="px-8 py-3 bg-transparent border-2 border-white/20 text-white rounded-2xl font-bold text-sm hover:bg-white/10 transition-all active:scale-95"
              onClick={() => window.open("https://minima.global", "_blank")}
            >
              Minima Docs
            </button>
          </div>
          <p className="relative z-10 text-[10px] text-gray-500 mt-8 uppercase tracking-[0.2em]">
            MetaChain v0.9 • Powered by Minima P2P
          </p>
        </div>
      </div>
    </div>
  )
}
