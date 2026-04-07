import React, { createContext, useContext, useEffect, useState } from 'react';
import { MDS } from '@minima-global/mds';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';

// Define available themes
export type ThemeColor = 'sky' | 'cyan' | 'teal' | 'emerald' | 'slate' | 'gray' | 'zinc' | 'neutral' | 'stone';
export type ThemeMode = 'light' | 'dark';
export type ChatBackground = 'default' | 'dots' | 'grid' | 'diagonal' | 'soft-gradient';

interface ThemeContextType {
    currentTheme: ThemeColor;
    mode: ThemeMode;
    chatBackground: ChatBackground;
    setTheme: (theme: ThemeColor) => void;
    toggleMode: () => void;
    setChatBackground: (bg: ChatBackground) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Define color palettes (RGB values for Tailwind compatibility)
const THEMES: Record<ThemeColor, Record<string, string>> = {
    cyan: {
        '50': '236 254 255',
        '100': '207 250 254',
        '200': '165 243 252',
        '300': '103 232 249',
        '400': '34 211 238',
        '500': '6 182 212',
        '600': '8 145 178',
        '700': '14 116 144',
        '800': '21 94 117',
        '900': '22 78 99',
        '950': '8 51 68',
    },
    teal: {
        '50': '240 253 250',
        '100': '204 251 241',
        '200': '153 246 228',
        '300': '94 234 212',
        '400': '45 212 191',
        '500': '20 184 166',
        '600': '13 148 136',
        '700': '15 118 110',
        '800': '17 94 89',
        '900': '19 78 74',
        '950': '4 47 46',
    },
    emerald: {
        '50': '236 253 245',
        '100': '209 250 229',
        '200': '167 243 208',
        '300': '110 231 183',
        '400': '52 211 153',
        '500': '16 185 129',
        '600': '5 150 105',
        '700': '4 120 87',
        '800': '6 95 70',
        '900': '6 78 59',
        '950': '2 44 34',
    },
    slate: {
        '50': '248 250 252',
        '100': '241 245 249',
        '200': '226 232 240',
        '300': '203 213 225',
        '400': '148 163 184',
        '500': '100 116 139',
        '600': '71 85 105',
        '700': '51 65 85',
        '800': '30 41 59',
        '900': '15 23 42',
        '950': '2 6 23',
    },
    gray: {
        '50': '249 250 251',
        '100': '243 244 246',
        '200': '229 231 235',
        '300': '209 213 219',
        '400': '156 163 175',
        '500': '107 114 128',
        '600': '75 85 99',
        '700': '55 65 81',
        '800': '31 41 55',
        '900': '17 24 39',
        '950': '3 7 18',
    },
    zinc: {
        '50': '255 252 250',
        '100': '254 248 244',
        '200': '252 235 225',
        '300': '248 215 195',
        '400': '240 180 150',
        '500': '210 140 100',
        '600': '180 110 70',
        '700': '140 80 50',
        '800': '110 60 40',
        '900': '80 45 30',
        '950': '40 20 15',
    },
    neutral: {
        '50': '250 250 250',
        '100': '245 245 245',
        '200': '229 229 229',
        '300': '212 212 212',
        '400': '163 163 163',
        '500': '115 115 115',
        '600': '82 82 82',
        '700': '64 64 64',
        '800': '38 38 38',
        '900': '23 23 23',
        '950': '10 10 10',
    },
    stone: {
        '50': '250 250 249',
        '100': '245 245 244',
        '200': '231 229 228',
        '300': '214 211 209',
        '400': '168 162 158',
        '500': '120 113 108',
        '600': '87 83 78',
        '700': '68 64 60',
        '800': '41 37 36',
        '900': '28 25 23',
        '950': '12 10 9',
    },
    sky: {
        '50': '240 249 255',
        '100': '224 242 254',
        '200': '186 230 253',
        '300': '125 211 252',
        '400': '56 189 248',
        '500': '14 165 233',
        '600': '2 132 199',
        '700': '3 105 161',
        '800': '7 89 133',
        '900': '12 74 110',
        '950': '8 47 73',
    },
};

import { useAppContext } from '../AppContext';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const { loaded } = useAppContext();
    const [currentTheme, setCurrentThemeState] = useState<ThemeColor>('sky');
    const [chatBackground, setChatBackgroundState] = useState<ChatBackground>('default');
    const [mode, setModeState] = useState<ThemeMode>(() => {
        // 1. Check local storage for immediate restore (fastest)
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem('app_mode');
            if (cached === 'light' || cached === 'dark') {
                // Apply class immediately to prevent flash
                if (cached === 'dark') {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
                return cached;
            }

            // 2. Fallback to system preference
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                document.documentElement.classList.add('dark');
                return 'dark';
            }
        }
        return 'light';
    });

    useEffect(() => {
        if (!loaded) return;

        // Load theme from saving mechanism (Keypair preferred)
        MDS.keypair.get('app_theme', (res: any) => {
            if (res.status && res.value) {
                // Validate that the loaded theme exists in our new map
                if (THEMES[res.value as ThemeColor]) {
                    setTheme(res.value as ThemeColor);
                } else {
                    // Fallback to sky if theme no longer exists (e.g., 'rose')
                    console.log('Migrating legacy theme to Sky Blue');
                    setTheme('sky');
                }
            } else {
                // No saved theme found, enforce default explicitly
                setTheme('sky');
            }
        });

        // Load mode preference (Sync MDS with LocalStorage)
        MDS.keypair.get('app_mode', (res: any) => {
            if (res.status && res.value) {
                const storedMode = res.value as ThemeMode;
                // If MDS has a different value than what we loaded from localStorage, update it
                if (storedMode !== mode) {
                    setMode(storedMode);
                }
            } else {
                // If no saved preference in Keypair, stick with what we initialized (System or Default)
                // But safeguard to ensure class matches state
                if (mode === 'dark') {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
            }
        });


        // Load chat background preference
        MDS.keypair.get('app_chat_bg', (res: any) => {
            if (res.status && res.value) {
                // Migrate legacy 'solid' or 'warm' to 'diagonal'
                const val = res.value as string;
                if (val === 'solid' || val === 'warm') {
                    setChatBackgroundState('diagonal');
                    MDS.keypair.set('app_chat_bg', 'diagonal');
                } else {
                    setChatBackgroundState(res.value as ChatBackground);
                }
            }
        });
    }, [loaded]);


    // Update System Bars (Status Bar & Navigation Bar) when mode changes
    useEffect(() => {
        const updateSystemBars = async () => {
            if (!Capacitor.isNativePlatform()) return;

            const isDark = mode === 'dark';

            try {
                // Status Bar
                await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
                if (typeof (StatusBar as any).setBackgroundColor === 'function') {
                    await StatusBar.setBackgroundColor({ color: '#00000000' });
                }

                // Navigation Bar - Dynamic access to bypass build-time resolution errors
                const NavigationBarPlugin = (Capacitor as any).Plugins?.NavigationBar;
                if (NavigationBarPlugin) {
                    await NavigationBarPlugin.setColor({ color: isDark ? '#111827' : '#ffffff' });
                }


            } catch (e) {
                // Plugins might not be available (web mode), ignore errors
                console.warn('System bar styling failed:', e);
            }
        };

        updateSystemBars();
    }, [mode]);

    const setMode = (newMode: ThemeMode) => {
        console.log(`[ThemeContext] Setting mode to: ${newMode}`);
        setModeState(newMode);
        const root = document.documentElement;

        if (newMode === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }

        // Persist to LocalStorage (Instant)
        localStorage.setItem('app_mode', newMode);

        // Persist to MDS (Permanent)
        if (loaded) {
            MDS.keypair.set('app_mode', newMode);
        }
    };

    const toggleMode = () => {
        console.log('[ThemeContext] Toggling mode...');
        setMode(mode === 'light' ? 'dark' : 'light');
    };

    const setTheme = (theme: ThemeColor) => {
        if (!THEMES[theme]) return;

        setCurrentThemeState(theme);

        // Apply CSS variables to root
        const root = document.documentElement;
        const colors = THEMES[theme];

        Object.entries(colors).forEach(([shade, value]) => {
            root.style.setProperty(`--color-primary-${shade}`, value);
        });

        // Save preference
        if (loaded) {
            MDS.keypair.set('app_theme', theme);
        }
    };

    const setChatBackground = (bg: ChatBackground) => {
        setChatBackgroundState(bg);
        if (loaded) {
            MDS.keypair.set('app_chat_bg', bg);
        }
    };

    return (
        <ThemeContext.Provider value={{ currentTheme, mode, chatBackground, setTheme, toggleMode, setChatBackground }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
