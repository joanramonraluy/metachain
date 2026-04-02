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
} from "lucide-react"

export const Route = createFileRoute("/about")({
  component: About,
})

function About() {
  const appVersion = "0.9"

  return (
    <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-950 transition-colors">
      <div className="max-w-4xl mx-auto p-4 sm:p-8 space-y-12">
        {/* Premium Hero Section */}
        <div className="relative bg-white dark:bg-gray-900 rounded-[2.5rem] shadow-2xl shadow-primary-500/10 border border-gray-100 dark:border-gray-800 p-10 sm:p-16 text-center overflow-hidden transition-all group">
          {/* Animated Background Elements */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary-500 via-indigo-500 to-violet-500"></div>
          <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary-500/10 rounded-full blur-3xl group-hover:scale-125 transition-transform duration-1000"></div>
          <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl group-hover:scale-125 transition-transform duration-1000 delay-200"></div>

          <div className="relative z-10">
            <div className="w-24 h-24 bg-gradient-to-br from-primary-500 to-indigo-600 rounded-[2rem] mx-auto flex items-center justify-center mb-8 shadow-xl shadow-primary-500/20 transform group-hover:rotate-12 transition-transform duration-700">
              <Zap size={48} className="text-white fill-white/20" />
            </div>

            <h1 className="text-5xl sm:text-6xl font-black text-gray-900 dark:text-white mb-4 tracking-tighter">
              MetaChain
            </h1>
            <div className="inline-flex items-center gap-2 px-4 py-1 bg-gray-100 dark:bg-gray-800 rounded-full mb-8">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                Version {appVersion} • Stable
              </span>
            </div>

            <p className="text-xl text-gray-600 dark:text-gray-400 leading-relaxed max-w-2xl mx-auto font-medium">
              The full-power decentralized messaging layer. Secure,
              private, and unstoppable communication on the Minima network.
            </p>
          </div>
        </div>

        {/* The Technical Pillars */}
        <div className="space-y-6">
          <div className="flex items-center justify-between mb-2 px-2">
            <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
              Technical Pillars
            </h2>
            <div className="h-px flex-1 mx-6 bg-gray-200 dark:bg-gray-800"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-gray-900 p-8 rounded-[2rem] border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className="w-14 h-14 bg-blue-50 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center text-blue-600 dark:text-blue-400 mb-6">
                <Lock size={28} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                Quantum Secure
              </h3>
              <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
                Built on Minima's post-quantum algorithms, ensuring your 
                conversations remain private even against future computing power.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 p-8 rounded-[2rem] border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className="w-14 h-14 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6">
                <Network size={28} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                NIO P2P
              </h3>
              <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
                Direct peer-to-peer communication via Minima's Network In-Out 
                layer. Truly serverless, reactive, and censorship-resistant.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 p-8 rounded-[2rem] border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-6">
                <Cpu size={28} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                Full-Node Hub
              </h3>
              <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
                Runs entirely on your device. No central cloud, no data mining, 
                no hidden tracking. Your node is your sovereign gateway.
              </p>
            </div>
          </div>
        </div>

        {/* Resources & Engineering Card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Network Health / Engineering Status */}
          <div className="bg-gradient-to-br from-gray-900 to-black rounded-[2.5rem] p-10 text-white shadow-2xl overflow-hidden relative group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
            
            <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
              <Shield className="text-primary-400" />
              Engineering
            </h3>
            
            <ul className="space-y-4 mb-8">
              <li className="flex items-center gap-3 text-gray-300">
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                <span>Base Protocol: Minima v1.0+</span>
              </li>
              <li className="flex items-center gap-3 text-gray-300">
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                <span>Runtime: React 19 + Service Worker</span>
              </li>
              <li className="flex items-center gap-3 text-gray-300">
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                <span>Network: Encrypted NIO Beacons</span>
              </li>
              <li className="flex items-center gap-3 text-gray-300">
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                <span>Persistence: Embedded SQLite</span>
              </li>
            </ul>

            <button 
              className="w-full py-4 bg-white/10 hover:bg-white/20 border border-white/10 rounded-2xl text-sm font-bold transition-all active:scale-[0.98]"
              onClick={() => window.open('https://minima.global', '_blank')}
            >
              Explore Protocol Docs
            </button>
          </div>

          {/* Resources List */}
          <div className="bg-white dark:bg-gray-900 rounded-[2.5rem] p-10 border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                Official Resources
              </h3>
              <div className="space-y-3">
                <a
                  href="https://minima.global"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-5 bg-gray-50/50 dark:bg-gray-800/50 rounded-2xl hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <Globe size={24} className="text-gray-400 group-hover:text-primary-500 transition-colors" />
                    <div>
                      <h4 className="font-bold text-gray-900 dark:text-white">Minima Network</h4>
                      <p className="text-xs text-gray-500">Official ecosystem portal</p>
                    </div>
                  </div>
                  <ExternalLink size={18} className="text-gray-400 group-hover:text-primary-500 transition-all" />
                </a>

                <a
                  href="https://github.com/minima-global"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-5 bg-gray-50/50 dark:bg-gray-800/50 rounded-2xl hover:bg-gray-900 dark:hover:bg-white transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <Github size={24} className="text-gray-400 group-hover:text-white dark:group-hover:text-gray-900 transition-colors" />
                    <div>
                      <h4 className="font-bold text-gray-900 dark:text-white group-hover:text-white dark:group-hover:text-gray-900">Source Code</h4>
                      <p className="text-xs text-gray-500 group-hover:text-white/60 dark:group-hover:text-gray-900/60">Contribute on GitHub</p>
                    </div>
                  </div>
                  <ExternalLink size={18} className="text-gray-400 group-hover:text-white dark:group-hover:text-gray-900 transition-all" />
                </a>
              </div>
            </div>

            <div className="mt-8 text-center sm:text-left">
               <p className="text-xs text-gray-400 font-medium uppercase tracking-widest">
                 Open-Source • Community Driven
               </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-8 pb-12 border-t border-gray-100 dark:border-gray-800">
          <p className="text-sm text-gray-400 font-medium flex items-center justify-center gap-2">
            Powered by <span className="font-black text-gray-500 hover:text-primary-500 transition-colors">MINIMA</span>
          </p>
          <p className="text-[10px] text-gray-500 mt-2 uppercase tracking-[0.3em]">
            Decentralized Social Intelligence
          </p>
        </div>
      </div>
    </div>
  )
}
