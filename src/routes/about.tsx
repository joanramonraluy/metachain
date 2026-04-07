import { createFileRoute } from "@tanstack/react-router"
import {
  Shield,
  Zap,
  Globe,
  Github,
  ExternalLink,
  Cpu,
  Lock,
  Network,
  CheckCircle2,
  ChevronRight
} from "lucide-react"

export const Route = createFileRoute("/about")({
  component: About,
})

function About() {
  const appVersion = "0.9"

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 transition-colors relative overflow-hidden overflow-y-auto l-scrollbar">
      {/* Dot Grid Background (consistent with Elite System) */}
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

      {/* Background Blobs (consistent with Elite System) */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-white via-gray-50 to-blue-50/30 dark:from-gray-950 dark:via-gray-950 dark:to-primary-950/20"></div>

        <div
          className="absolute top-0 left-0 w-[70%] h-[70%] rounded-full opacity-40 dark:opacity-20 blur-[120px] animate-pulse"
          style={{
            background: "radial-gradient(circle, var(--color-primary-900) 0%, transparent 70%)",
            animationDuration: "12s",
          }}
        ></div>
        <div
          className="absolute bottom-0 right-0 w-[60%] h-[60%] rounded-full opacity-30 dark:opacity-10 blur-[120px] animate-pulse"
          style={{
            background: "radial-gradient(circle, var(--color-primary-800) 0%, transparent 70%)",
            animationDuration: "18s",
            animationDelay: "4s",
          }}
        ></div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto py-16 px-4 sm:px-10 space-y-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        {/* Premium Hero Section - Large Elite Glassy Card */}
        <div className="relative bg-white/40 dark:bg-white/5 backdrop-blur-3xl rounded-[3rem] sm:rounded-[4rem] shadow-2xl border border-white/20 dark:border-white/10 p-8 sm:p-24 text-center overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-primary-500 via-indigo-500 to-violet-500 opacity-60"></div>

          <div className="relative z-10">
            <div className="w-24 h-24 sm:w-32 sm:h-32 bg-gradient-to-br from-primary-500 to-indigo-600 rounded-[2.5rem] mx-auto flex items-center justify-center mb-8 sm:mb-12 shadow-[0_20px_50px_rgba(var(--color-primary-500),0.3)] transform group-hover:rotate-12 transition-all duration-700">
              <Zap size={64} strokeWidth={2.5} className="text-white fill-white/20 w-16 h-16 sm:w-20 sm:h-20" />
            </div>

            <h1 className="text-4xl sm:text-5xl font-black text-gray-900 dark:text-white mb-4 sm:mb-6 tracking-tighter uppercase leading-none">
              MetaChain
            </h1>
            <div className="inline-flex items-center gap-3 px-5 py-1.5 bg-black/5 dark:bg-white/10 rounded-full mb-8 sm:mb-10 border border-white/10">
              <span className="w-2 h-2 bg-emerald-500 rounded-full shadow-lg shadow-emerald-500/50"></span>
              <span className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                Version {appVersion} • Stable Release
              </span>
            </div>

            <p className="text-lg sm:text-2xl text-gray-600 dark:text-gray-300 leading-relaxed max-w-3xl mx-auto font-medium tracking-tight opacity-90">
              The full-power decentralized messaging layer. Secure,
              private, and unstoppable communication on the Minima network.
            </p>
          </div>
        </div>

        {/* The Technical Pillars - Elite Grid */}
        <div className="space-y-12">
          <div className="flex items-center gap-6 px-4">
            <h2 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.4em]">
              Technical Pillars
            </h2>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800/50"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: Lock, label: "Quantum Secure", color: "blue", desc: "Built on Minima's post-quantum algorithms, ensuring your conversations remain private even against future computing power." },
              { icon: Network, label: "NIO P2P", color: "indigo", desc: "Direct peer-to-peer communication via Minima's Network In-Out layer. Truly serverless, reactive, and censorship-resistant." },
              { icon: Cpu, label: "Full-Node Hub", color: "emerald", desc: "Runs entirely on your device. No central cloud, no data mining, no hidden tracking. Your node is your sovereign gateway." }
            ].map((pillar, idx) => {
              const Icon = pillar.icon;
              return (
                <div key={idx} className="group bg-white/70 dark:bg-gray-900/40 backdrop-blur-md p-10 rounded-[3rem] border border-white/20 dark:border-white/5 shadow-lg shadow-black/5 hover:scale-[1.05] hover:shadow-2xl hover:border-primary-500/30 transition-all duration-700">
                  <div className={`w-20 h-20 bg-${pillar.color}-500/10 rounded-2xl flex items-center justify-center text-${pillar.color}-600 dark:text-${pillar.color}-400 mb-8 group-hover:scale-110 group-hover:rotate-12 transition-all shadow-inner`}>
                    <Icon size={36} strokeWidth={2.5} />
                  </div>
                  <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-4 uppercase tracking-tighter leading-none">
                    {pillar.label}
                  </h3>
                  <p className="text-sm font-bold text-gray-500 dark:text-gray-400 leading-relaxed opacity-70">
                    {pillar.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Resources & Engineering Card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          {/* Network Health / Engineering Status */}
          <div className="bg-gradient-to-br from-gray-900 to-black rounded-[3rem] sm:rounded-[4rem] p-10 sm:p-12 text-white shadow-2xl overflow-hidden relative group border border-white/10 transition-all hover:scale-[1.02]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500/10 rounded-full -mr-32 -mt-32 blur-[80px] group-hover:scale-150 transition-transform duration-1000"></div>
            
            <h3 className="text-3xl font-black mb-10 flex items-center gap-4 uppercase tracking-tighter">
              <Shield className="text-primary-400" size={32} />
              Engineering
            </h3>
            
            <ul className="space-y-6 mb-12">
              {[
                { label: "Base Protocol", value: "Minima v1.0+" },
                { label: "Runtime", value: "React 19 + SW" },
                { label: "Network", value: "NIO Beacons" },
                { label: "Persistence", value: "Embedded SQLite" }
              ].map((item, idx) => (
                <li key={idx} className="flex items-center gap-4 text-gray-300">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-black uppercase tracking-widest text-gray-500">{item.label}</span>
                    <span className="text-sm font-bold text-white">{item.value}</span>
                  </div>
                </li>
              ))}
            </ul>

            <button 
              className="w-full py-5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-[2rem] text-xs font-black uppercase tracking-widest transition-all active:scale-[0.98] shadow-xl"
              onClick={() => window.open('https://minima.global', '_blank')}
            >
              Explore Protocol Docs
            </button>
          </div>

          {/* Resources List */}
          <div className="bg-white/40 dark:bg-white/5 backdrop-blur-3xl rounded-[3rem] sm:rounded-[4rem] p-10 sm:p-12 border border-white/20 dark:border-white/10 shadow-xl flex flex-col justify-between group transition-all hover:scale-[1.02]">
            <div>
              <h3 className="text-3xl font-black text-gray-900 dark:text-white mb-10 tracking-tighter uppercase leading-none">
                Official <br /> Resources
              </h3>
              <div className="grid grid-cols-1 gap-4">
                {[
                  { label: "Website", url: "https://minima.global", icon: Globe },
                  { label: "GitHub", url: "https://github.com/minima-global", icon: Github },
                  { label: "Discord", url: "https://discord.gg/minima", icon: ExternalLink }
                ].map((link, idx) => {
                  const Icon = link.icon;
                  return (
                    <a
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-5 rounded-[2rem] bg-black/5 dark:bg-white/5 border border-transparent hover:border-primary-500/30 hover:bg-white dark:hover:bg-white/10 transition-all group/link shadow-sm"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-500 group-hover/link:scale-110 transition-transform">
                          <Icon size={20} strokeWidth={2.5} />
                        </div>
                        <span className="text-sm font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">{link.label}</span>
                      </div>
                      <ChevronRight size={18} className="text-gray-400 group-hover/link:translate-x-1 transition-transform" />
                    </a>
                  );
                })}
              </div>
            </div>

            <p className="mt-12 text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-center">
              Made with <span className="text-rose-500 animate-pulse">❤️</span> by the MetaChain Community
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
