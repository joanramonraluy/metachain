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
    <div className="max-w-4xl mx-auto p-4 md:p-8 px-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden transition-colors">
        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Paintbrush className="text-primary-500" size={24} />
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">App Theme</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm">Customize the accent color of the application</p>
            </div>
          </div>

          {/* Mode Toggle */}
          <button
            onClick={toggleMode}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            {mode === 'dark' ? (
              <>
                <Sun size={20} className="text-amber-500" />
                <span className="font-medium text-gray-700 dark:text-gray-200">Light Mode</span>
              </>
            ) : (
              <>
                <Moon size={20} className="text-primary-600 dark:text-primary-400" />
                <span className="font-medium text-gray-700 dark:text-gray-200">Dark Mode</span>
              </>
            )}
          </button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {THEME_OPTIONS.map((theme) => (
              <button
                key={theme.id}
                onClick={() => setTheme(theme.id)}
                className={`
                  relative group flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all
                  ${currentTheme === theme.id
                    ? 'border-primary-600 bg-primary-50/50 dark:bg-primary-900/20 dark:border-primary-500'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }
                `}
              >
                <div className={`w-12 h-12 rounded-full shadow-lg ${theme.color} flex items-center justify-center transition-transform group-hover:scale-110`}>
                  {currentTheme === theme.id && (
                    <Check className="text-white w-6 h-6" strokeWidth={3} />
                  )}
                </div>
                <span className={`font-medium ${currentTheme === theme.id ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300'}`}>
                  {theme.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Chat Background Selector */}
        <div className="p-6 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <ImageIcon className="text-primary-500" size={24} />
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Chat Background</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm">Choose a background pattern for your chats</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { id: 'default', label: 'Default', preview: 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700' },
              { id: 'dots', label: 'Polka Dots', preview: 'bg-gray-50 dark:bg-gray-900 bg-[radial-gradient(#cbd5e1_1.5px,transparent_1.5px)] dark:bg-[radial-gradient(#1e293b_1.5px,transparent_1.5px)] [background-size:12px_12px]' },
              { id: 'grid', label: 'Graph Grid', preview: 'bg-gray-50 dark:bg-gray-900 bg-[linear-gradient(to_right,#e5e7eb_1px,transparent_1px),linear-gradient(to_bottom,#e5e7eb_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] [background-size:16px_16px]' },
              { id: 'diagonal', label: 'Diagonal Lines', preview: 'bg-gray-50 dark:bg-gray-900 bg-[repeating-linear-gradient(45deg,#e5e7eb_0px,#e5e7eb_2px,transparent_2px,transparent_10px)] dark:bg-[repeating-linear-gradient(45deg,#1f2937_0px,#1f2937_2px,transparent_2px,transparent_10px)]' }
            ].map((bg) => (
              <button
                key={bg.id}
                onClick={() => setChatBackground(bg.id as any)}
                className={`
                  relative group flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all
                  ${chatBackground === bg.id
                    ? 'border-primary-600 bg-primary-50/50 dark:bg-primary-900/20 dark:border-primary-500'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }
                `}
              >
                <div className={`w-12 h-12 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 ${bg.preview} flex items-center justify-center overflow-hidden`}>
                  {chatBackground === bg.id && (
                    <div className="bg-primary-600 dark:bg-primary-500 rounded-full p-1">
                      <Check className="text-white w-4 h-4" strokeWidth={3} />
                    </div>
                  )}
                </div>
                <span className={`font-medium ${chatBackground === bg.id ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300'}`}>
                  {bg.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
