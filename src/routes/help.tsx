import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import {
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Users,
  Shield,
  Globe,
  Zap,
  Radio,
  Share2,
  Server,
  Smartphone,
  Repeat,
  Activity,
  ArrowRight,
  Database,
  Code2,
} from "lucide-react"

const MA_SNIPPET_KEY = "minimaads_snippet"

function extractJs(snippet: string): string {
  const match = snippet.match(/<script[^>]*>([\s\S]*?)<\/script>/i)
  return match ? match[1].trim() : snippet.trim()
}

export const Route = createFileRoute("/help")({
  component: Help,
})

function MinimaAdsTestPanel() {
  const [snippet, setSnippet] = useState(() => localStorage.getItem(MA_SNIPPET_KEY) || "")
  const isActive = sessionStorage.getItem('minimaads_run') === 'true'
  const hasSaved = Boolean(localStorage.getItem(MA_SNIPPET_KEY))

  const run = () => {
    const trimmed = snippet.trim()
    if (!trimmed) return
    localStorage.setItem(MA_SNIPPET_KEY, extractJs(trimmed))
    sessionStorage.setItem('minimaads_run', 'true')
    window.location.reload()
  }

  const clear = () => {
    localStorage.removeItem(MA_SNIPPET_KEY)
    sessionStorage.removeItem('minimaads_run')
    setSnippet("")
    const slot = document.getElementById('minimaads-slot')
    if (slot) slot.innerHTML = ''
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
        Paste the snippet from <strong>MinimaAds → Frames → Snippet</strong>. The snippet is
        saved for convenience but <strong>never runs automatically</strong> on a new session —
        you control when it activates.
      </p>
      <textarea
        value={snippet}
        onChange={(e) => setSnippet(e.target.value)}
        rows={6}
        placeholder="Paste MinimaAds snippet here…"
        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 font-mono text-xs outline-none focus:border-cyan-500 dark:border-gray-800 dark:bg-gray-950 dark:text-cyan-100"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={run}
          disabled={!snippet.trim()}
          className="px-5 py-3 rounded-2xl bg-cyan-500 text-white text-xs font-black uppercase tracking-widest hover:bg-cyan-600 disabled:opacity-40 transition-colors"
        >
          Run
        </button>
        <button
          type="button"
          onClick={clear}
          className="px-5 py-3 rounded-2xl border border-gray-200 dark:border-gray-800 text-xs font-black uppercase tracking-widest hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
        >
          Clear
        </button>
      </div>
      {isActive && (
        <p className="text-xs font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-300">
          ● Banner active this session
        </p>
      )}
      {!isActive && hasSaved && (
        <p className="text-xs font-black uppercase tracking-widest text-gray-400">
          Snippet saved — not running this session
        </p>
      )}
    </div>
  )
}

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
        <div className="space-y-6">
          <p className="text-gray-700 dark:text-gray-300 font-medium text-lg leading-relaxed">
            Welcome to MetaChain. Your node is now your sovereign gateway to the decentralized messaging ecosystem. Follow these steps to initialize:
          </p>
          <div className="grid grid-cols-1 gap-4">
            {[
              { step: "1", title: "Identity Configuration", desc: "Set your alias, bio, and avatar in Settings. This identity is the 'envelope' for your decentralized communications.", to: "/settings/profile", label: "Configure" },
              { step: "2", title: "Enable Discovery", desc: "MetaChain nodes broadcast P2P 'beacons' to find neighbors. Ensure your node is active to be visible in the community.", to: "/settings/discovery", label: "Check" },
              { step: "3", title: "Find & Connect", desc: "Browse the Discovery section to find other users and send Chat Requests to establish secure sessions.", to: "/discovery", label: "Go" },
            ].map((item, idx) => (
              <div key={idx} className="flex gap-5 p-6 rounded-3xl bg-black/5 dark:bg-white/5 border border-white/10 group/item transition-all hover:bg-white dark:hover:bg-white/10">
                <div className="w-10 h-10 rounded-full bg-primary-500 text-white flex items-center justify-center font-black text-sm shrink-0 shadow-lg">
                  {item.step}
                </div>
                <div className="flex-1">
                  <h4 className="font-black text-gray-900 dark:text-white uppercase tracking-tight mb-1">{item.title}</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium leading-relaxed mb-3">
                    {item.desc}
                  </p>
                  {item.to && (
                    <Link to={item.to} className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-primary-500 hover:gap-3 transition-all">
                      {item.label} <ArrowRight size={14} />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: "minimaads",
      title: "MinimaAds",
      icon: Code2,
      color: "cyan",
      content: <MinimaAdsTestPanel />,
    },
    {
      id: "discovery-mechanics",
      title: "Discovery Mechanics",
      icon: Globe,
      color: "indigo",
      content: (
        <div className="space-y-8">
          <div className="p-8 rounded-[2.5rem] bg-indigo-500/5 border border-indigo-500/10 flex flex-col md:flex-row items-center gap-8">
            <div className="w-20 h-20 rounded-3xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0">
              <Radio size={40} className="animate-pulse" />
            </div>
            <div>
              <h4 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-2 leading-none">P2P Beacons</h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium leading-relaxed">
                Your node sends persistent P2P Beacons to find neighbors. These beacons propagate only between MetaChain nodes that are direct peers in the Minima network, creating a private, resilient discovery layer.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-8 rounded-[2.5rem] bg-black/5 dark:bg-white/5 border border-white/10 space-y-4 group/box transition-all hover:bg-indigo-500/5 hover:border-indigo-500/20">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shadow-inner group-hover/box:scale-110 transition-transform">
                 <Share2 size={24} strokeWidth={2.5} />
              </div>
              <h4 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">The Gossip Chain</h4>
              <p className="text-xs text-gray-600 dark:text-gray-400 font-medium leading-relaxed opacity-80">
                When two MetaChain nodes meet, they automatically exchange catalogs of known users. This 'Multi-hop Gossip' protocol allows you to discover peers who are not your direct neighbors but are visible to your contacts.
              </p>
            </div>

            <div className="p-8 rounded-[2.5rem] bg-black/5 dark:bg-white/5 border border-white/10 space-y-4 group/box transition-all hover:bg-emerald-500/5 hover:border-emerald-500/20">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shadow-inner group-hover/box:scale-110 transition-transform">
                 <Server size={24} strokeWidth={2.5} />
              </div>
              <h4 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">Discovery Hub (MLS)</h4>
              <p className="text-xs text-gray-600 dark:text-gray-400 font-medium leading-relaxed opacity-80">
                In sparse networks, discovery can be difficult. Configuring a **Static MLS Server** in Discovery Settings ensures you stay visible to the global community even if you have no direct MetaChain neighbors.
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "history-sync",
      title: "History & Self-Healing",
      icon: Activity,
      color: "emerald",
      content: (
        <div className="space-y-8">
          <div className="p-10 rounded-[3rem] bg-emerald-500/5 border border-emerald-500/10 relative overflow-hidden group">
            <div className="relative z-10 flex flex-col md:flex-row gap-10 items-center">
              <div className="w-24 h-24 bg-emerald-500 rounded-[2rem] flex items-center justify-center text-white shadow-[0_20px_50px_rgba(16,185,129,0.3)] shrink-0">
                <Repeat size={48} className="animate-spin" style={{ animationDuration: '8s' }} />
              </div>
              <div className="space-y-4">
                <h4 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Intelligent Auto-Repair</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400 font-medium leading-relaxed max-w-2xl">
                  Decentralized networks occasionally drop packets. MetaChain background workers monitor your message sequence counters per-contact. If a gap is detected (e.g., sequence jumps from 4 to 6), the app automatically requests the missing messages (#5) from your peer silently.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Smartphone, title: "Background Sync", desc: "Message recovery runs in a dedicated Service Worker, separate from the UI." },
              { icon: Database, title: "History Merging", desc: "Inbound history responses are merged into your local DB with strict deduplication." },
              { icon: Zap, title: "Pending Queue", desc: "If you are offline, outgoing messages are queued and retried automatically." }
            ].map((item, idx) => (
              <div key={idx} className="p-8 rounded-[2.5rem] bg-white/40 dark:bg-white/5 border border-white/20 dark:border-white/10 shadow-sm transition-all hover:scale-105">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-6">
                  <item.icon size={24} strokeWidth={2.5} />
                </div>
                <h4 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight mb-3 leading-none">{item.title}</h4>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 font-medium leading-relaxed opacity-70">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: "privacy",
      title: "Decentralized Privacy",
      icon: Shield,
      color: "amber",
      content: (
        <div className="space-y-8">
          <p className="text-gray-700 dark:text-gray-300 font-medium text-lg leading-relaxed">
            MetaChain enforces a three-tier permission model. Your data is only shared according to your explicit visibility settings:
          </p>

          <div className="grid grid-cols-1 gap-4">
            {[
              { level: "L1", color: "blue", title: "Public Discovery", desc: "Shared via Beacons with any discovered peer. Contains only non-sensitive data.", items: ["Alias", "Bio Snapshot", "Public Lists"] },
              { level: "L2", color: "purple", title: "Profile Response", desc: "Sent only when you accept a Chat Request. Includes richer identity data.", items: ["Full Bio", "Social Metadata", "Wallet Addr"] },
              { level: "L3", color: "amber", title: "Secure Chat", desc: "The highest protection. End-to-end encrypted messaging via Maxima protocol.", items: ["Messages", "Media", "Transfers"] }
            ].map((item, idx) => (
              <div key={idx} className="flex flex-col sm:flex-row gap-6 p-8 rounded-[2.5rem] bg-white/40 dark:bg-white/5 border border-white/20 dark:border-white/10 shadow-xl shadow-black/5 group/privacy hover:scale-[1.01] transition-all">
                <div className={`w-16 h-16 rounded-[1.5rem] bg-${item.color}-500/10 flex items-center justify-center text-${item.color}-500 shrink-0 font-black text-xl shadow-inner group-hover/privacy:scale-110 transition-transform`}>
                  {item.level}
                </div>
                <div className="flex-1">
                  <h5 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-2 leading-none">{item.title}</h5>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium leading-relaxed mb-4 opacity-70">
                    {item.desc}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {item.items.map((field, i) => (
                      <span key={i} className="px-3 py-1 rounded-full bg-black/5 dark:bg-white/10 text-[10px] font-black uppercase tracking-widest text-gray-400">
                        {field}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
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
        <div className="space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div className="p-10 rounded-[3rem] bg-violet-500/5 border border-violet-500/10 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <h5 className="text-2xl font-black text-violet-900 dark:text-violet-200 uppercase tracking-tight mb-4 leading-none">P2P Groups</h5>
              <p className="text-sm text-violet-700/80 dark:text-violet-300/80 font-medium leading-relaxed mb-6">
                Multi-participant chat rooms. Any member can send messages. Admin roles control invitations, moderation, and public listing status.
              </p>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-violet-500 text-white rounded-full text-xs font-black uppercase tracking-widest">
                Collaborative
              </div>
            </div>
            
            <div className="p-10 rounded-[3rem] bg-sky-500/5 border border-sky-500/10 relative overflow-hidden group">
               <div className="absolute -top-10 -right-10 w-40 h-40 bg-sky-500/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <h5 className="text-2xl font-black text-sky-900 dark:text-sky-200 uppercase tracking-tight mb-4 leading-none">Broadcast Channels</h5>
              <p className="text-sm text-sky-700/80 dark:text-sky-300/80 font-medium leading-relaxed mb-6">
                One-to-many broadcast channels. Only admins can publish; subscribers can read, react, and reply but cannot broadcast to the entire list.
              </p>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-sky-500 text-white rounded-full text-xs font-black uppercase tracking-widest">
                Broadcast Only
              </div>
            </div>
          </div>

          <div className="p-8 rounded-[2.5rem] bg-black/5 dark:bg-white/5 border border-white/10 group transition-all hover:border-violet-500/30">
            <h4 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-3 leading-none">Auto-Approve Strategy</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium leading-relaxed opacity-80">
              Groups can be 'Public'—meaning they are advertised via your Discovery Beacon. If 'Auto-Approve' is enabled, users can join instantly from their community tab. Otherwise, an admin must approve their request in the 'Join Requests' tab.
            </p>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 transition-colors relative overflow-hidden overflow-y-auto l-scrollbar">
      {/* Dot Grid Background */}
      <div className="absolute inset-0 z-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        ></div>
      </div>

      {/* Elite Background Blobs */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-white via-gray-50 to-blue-50/30 dark:from-gray-950 dark:via-gray-950 dark:to-primary-950/20"></div>

        <div
          className="absolute top-[10%] right-[10%] w-[50%] h-[50%] rounded-full opacity-40 dark:opacity-20 blur-[120px] animate-pulse"
          style={{
            background: "radial-gradient(circle, var(--color-primary-900) 0%, transparent 70%)",
            animationDuration: "14s",
          }}
        ></div>
        <div
          className="absolute bottom-[10%] left-[10%] w-[40%] h-[40%] rounded-full opacity-30 dark:opacity-10 blur-[120px] animate-pulse"
          style={{
            background: "radial-gradient(circle, var(--color-primary-800) 0%, transparent 70%)",
            animationDuration: "20s",
            animationDelay: "5s",
          }}
        ></div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto py-16 px-4 sm:px-10 space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <div className="text-center space-y-4 mb-20 px-4">
          <div className="w-20 h-20 bg-primary-500 rounded-[1.75rem] mx-auto flex items-center justify-center text-white mb-10 shadow-[0_15px_40px_rgba(var(--color-primary-500),0.3)] transform rotate-6">
            <HelpCircle size={40} strokeWidth={2.5} />
          </div>
          <h1 className="text-4xl sm:text-5xl font-black text-gray-900 dark:text-white uppercase tracking-tighter leading-none">
             MetaChain Support
          </h1>
          <p className="text-base sm:text-xl text-gray-500 dark:text-gray-400 font-medium tracking-tight opacity-80">
            Official Self-Sovereign Messaging Documentation
          </p>
        </div>

        <div className="space-y-6">
          {sections.map((section, idx) => (
            <div
              key={section.id}
              className={`group overflow-hidden bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[2.5rem] sm:rounded-[3rem] border border-white/20 dark:border-white/5 shadow-lg shadow-black/5 transition-all duration-700 ${
                openSection === section.id ? "ring-2 ring-primary-500/20" : "hover:border-primary-500/20"
              }`}
              style={{ animationDelay: `${idx * 100}ms` }}
            >
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center justify-between p-8 sm:p-10 text-left transition-all hover:bg-white/20 dark:hover:bg-white/5"
              >
                <div className="flex items-center gap-6">
                  <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-${section.color}-500/10 flex items-center justify-center text-${section.color}-500 group-hover:scale-110 transition-transform shadow-inner`}>
                    <section.icon size={28} strokeWidth={2.5} />
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight leading-none">
                    {section.title}
                  </h2>
                </div>
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-black/5 dark:bg-white/10 text-gray-400 group-hover:bg-primary-500 group-hover:text-white transition-all shadow-xl">
                  {openSection === section.id ? (
                    <ChevronUp size={24} strokeWidth={3} />
                  ) : (
                    <ChevronDown size={24} strokeWidth={3} />
                  )}
                </div>
              </button>

              {openSection === section.id && (
                <div className="p-8 sm:p-12 pt-0 border-t border-white/10 animate-in fade-in slide-in-from-top-6 duration-500">
                   {section.content}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-20 p-10 sm:p-14 rounded-[3rem] sm:rounded-[4.5rem] bg-gradient-to-br from-primary-600 to-indigo-700 text-white shadow-2xl text-center relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_120%,rgba(255,255,255,0.2),transparent)] opacity-60"></div>
          <div className="relative z-10 space-y-8">
            <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter leading-none">
              Still Need Help?
            </h2>
            <p className="text-base sm:text-lg text-primary-100 font-medium max-w-2xl mx-auto opacity-90 leading-relaxed">
              Join the official Minima Global community on Discord to ask questions directly to the developers and community guides.
            </p>
            <div className="flex justify-center">
              <button 
                className="px-10 py-5 bg-white text-primary-600 rounded-[2rem] text-xs sm:text-sm font-black uppercase tracking-[0.3em] shadow-2xl hover:scale-105 active:scale-95 transition-all"
                onClick={() => window.open('https://discord.gg/minima', '_blank')}
              >
                Join Discord Server
              </button>
            </div>
          </div>
        </div>

        <p className="text-center py-10 text-xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 opacity-60">
           Manual Version 1.1 • Fully Updated April 2026
        </p>
      </div>
    </div>
  )
}
