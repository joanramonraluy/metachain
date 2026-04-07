import { createFileRoute } from "@tanstack/react-router";
import { useTheme, ThemeColor } from "../../context/ThemeContext";
import { Check, Paintbrush, Moon, Sun, Image as ImageIcon } from "lucide-react";

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceSettings,
});

// Theme options constant
const THEME_OPTIONS: { id: ThemeColor; label: string; color: string }[] = [
  { id: 'sky', label: 'Sky Blue', color: 'bg-sky-500' },
  { id: 'cyan', label: 'Cyan Blue', color: 'bg-cyan-500' },
  { id: 'teal', label: 'Modern Teal', color: 'bg-teal-600' },
  { id: 'emerald', label: 'Calm Green', color: 'bg-emerald-600' },
  { id: 'slate', label: 'Cool Slate', color: 'bg-slate-500' },
  { id: 'gray', label: 'Mist Gray', color: 'bg-gray-500' },
  { id: 'zinc', label: 'Copper Zinc', color: 'bg-[rgb(210,140,100)]' },
  { id: 'neutral', label: 'Pure Neutral', color: 'bg-neutral-500' },
  { id: 'stone', label: 'Warm Stone', color: 'bg-stone-500' },
];

function AppearanceSettings() {
  const { currentTheme, setTheme, mode, toggleMode, chatBackground, setChatBackground } = useTheme();

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
      
      {/* Unified Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
           <div className="w-12 h-12 rounded-[1.25rem] bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
              <Paintbrush className="text-white" size={24} strokeWidth={2.5} />
           </div>
           <div>
              <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Appearance</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Personalize your MetaChain experience.</p>
           </div>
        </div>

        {/* Mode Toggle Button */}
        <button
          onClick={toggleMode}
          className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white/70 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/10 shadow-sm hover:scale-[1.02] active:scale-95 transition-all group"
        >
          {mode === 'dark' ? (
            <>
              <Sun size={20} className="text-amber-500 group-hover:rotate-45 transition-transform duration-500" />
              <span className="text-[13px] font-black uppercase tracking-widest text-gray-900 dark:text-white">Light Mode</span>
            </>
          ) : (
            <>
              <Moon size={20} className="text-primary-600 dark:text-primary-400 group-hover:-rotate-12 transition-transform duration-500" />
              <span className="text-[13px] font-black uppercase tracking-widest text-gray-900 dark:text-white">Dark Mode</span>
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Accent Color Section */}
        <section className="bg-white/40 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/10 p-8 rounded-[3rem] shadow-xl space-y-8">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-500">
                <Paintbrush size={16} />
             </div>
             <h3 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.3em]">ACCENT COLOR</h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {THEME_OPTIONS.map((theme) => (
              <button
                key={theme.id}
                onClick={() => setTheme(theme.id)}
                className={`
                  relative group flex flex-col items-center gap-3 p-5 rounded-[2rem] border-2 transition-all
                  ${currentTheme === theme.id
                    ? 'border-primary-500 bg-primary-500/5 dark:bg-primary-500/10 shadow-lg shadow-primary-500/10'
                    : 'border-transparent bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10'
                  }
                `}
              >
                <div className={`w-14 h-14 rounded-full shadow-2xl ${theme.color} flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-active:scale-90 group-hover:rotate-12`}>
                  {currentTheme === theme.id && (
                    <Check className="text-white w-7 h-7" strokeWidth={3.5} />
                  )}
                </div>
                <span className={`text-[11px] font-black uppercase tracking-widest ${currentTheme === theme.id ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}>
                  {theme.label}
                </span>
                {currentTheme === theme.id && (
                  <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary-500 animate-pulse"></div>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* Chat Background Section */}
        <section className="bg-white/40 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/10 p-8 rounded-[3rem] shadow-xl space-y-8">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-500">
                <ImageIcon size={16} />
             </div>
             <h3 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.3em]">CHAT WALLPAPER</h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { id: 'default', label: 'Classic', preview: 'bg-white dark:bg-gray-950 border-black/5 dark:border-white/5' },
              { id: 'dots', label: 'Polka Dots', preview: 'bg-white dark:bg-gray-950 bg-[radial-gradient(#cbd5e1_1.5px,transparent_1.5px)] dark:bg-[radial-gradient(#1e293b_1.5px,transparent_1.5px)] [background-size:12px_12px]' },
              { id: 'grid', label: 'Blueprint', preview: 'bg-white dark:bg-gray-950 bg-[linear-gradient(to_right,#e5e7eb_1px,transparent_1px),linear-gradient(to_bottom,#e5e7eb_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] [background-size:16px_16px]' },
              { id: 'diagonal', label: 'Tech Lines', preview: 'bg-white dark:bg-gray-950 bg-[repeating-linear-gradient(45deg,#e5e7eb_0px,#e5e7eb_2px,transparent_2px,transparent_10px)] dark:bg-[repeating-linear-gradient(45deg,#1f2937_0px,#1f2937_2px,transparent_2px,transparent_10px)]' }
            ].map((bg) => (
              <button
                key={bg.id}
                onClick={() => setChatBackground(bg.id as any)}
                className={`
                  relative group flex flex-col items-center gap-3 p-5 rounded-[2rem] border-2 transition-all
                  ${chatBackground === bg.id
                    ? 'border-primary-500 bg-primary-500/5 dark:bg-primary-500/10 shadow-lg shadow-primary-500/10'
                    : 'border-transparent bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10'
                  }
                `}
              >
                <div className={`w-14 h-14 rounded-2xl shadow-inner border border-black/5 dark:border-white/10 ${bg.preview} flex items-center justify-center overflow-hidden transition-all duration-500 group-hover:scale-110 group-hover:-rotate-3`}>
                  {chatBackground === bg.id && (
                    <div className="bg-primary-500 rounded-full p-1.5 shadow-lg shadow-primary-500/50">
                      <Check className="text-white w-4 h-4" strokeWidth={4} />
                    </div>
                  )}
                </div>
                <span className={`text-[11px] font-black uppercase tracking-widest ${chatBackground === bg.id ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}>
                  {bg.label}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
