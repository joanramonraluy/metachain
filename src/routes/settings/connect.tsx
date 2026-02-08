import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { Link as LinkIcon, Smartphone, Check, Copy } from 'lucide-react'
import { MDS } from '@minima-global/mds' // Ensure MDS is imported if used directly
import { useAppContext } from '@/AppContext'

export const Route = createFileRoute('/settings/connect')({
    component: ConnectSettings,
})

function ConnectSettings() {
    const { sessionExpired } = useAppContext()
    const [uid, setUid] = useState('')
    const [currentUid, setCurrentUid] = useState('')
    const [copied, setCopied] = useState(false)
    const [showManual, setShowManual] = useState(false)

    // Auto-open manual entry if session is expired
    useEffect(() => {
        if (sessionExpired) {
            setShowManual(true);
        }
    }, [sessionExpired]);

    useEffect(() => {
        const checkUid = () => {
            // Priority:
            // 1. LocalStorage (Manual Override)
            // 2. MDS.minidappuid (Injected by Minima)
            // 3. URL Parameter (Fallback)
            // 4. Debug ID (Vite/Dev)

            const mdsUid = (window as any).MDS?.minidappuid;
            const urlParams = new URLSearchParams(window.location.search);
            const urlUid = urlParams.get('uid');

            const finalUid = localStorage.getItem('minima_uid') || mdsUid || urlUid || MDS.DEBUG_MINIDAPPID || '';

            if (finalUid) {
                setCurrentUid(finalUid);
            }
        };

        // Check immediately
        checkUid();

        // Retry a few times in case MDS/URL is slow to settle
        const interval = setInterval(checkUid, 500);

        // Stop checking after 5 seconds to avoid infinite work
        const timeout = setTimeout(() => clearInterval(interval), 5000);

        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [])

    const handleConnect = () => {
        if (!uid.trim()) return

        // Save and Reload
        localStorage.setItem('minima_uid', uid.trim())
        alert("UID Saved! restarts app...")
        window.location.reload()
    }

    const handleClear = () => {
        if (confirm("Are you sure? This will disconnect the app.")) {
            localStorage.removeItem('minima_uid')
            localStorage.removeItem('MDS_ID') // Clear just in case
            window.location.reload()
        }
    }



    return (
        <div className="max-w-4xl mx-auto p-4 md:p-8">
            <div className="mb-8">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center">
                    <Smartphone className="mr-2 text-primary-500" />
                    Connect App
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                    Connection status and Session UID.
                </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-100 dark:border-gray-700 p-6 max-w-lg">

                <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Current Status
                    </label>
                    <div className="flex items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700">
                        <div className={`w-3 h-3 rounded-full mr-3 ${currentUid && !sessionExpired ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <code className="text-sm font-mono text-gray-600 dark:text-gray-400 break-all flex-1">
                            {currentUid ? currentUid : 'Not Connected'}
                        </code>
                        {currentUid && (
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(currentUid);
                                    setCopied(true);
                                    setTimeout(() => setCopied(false), 2000);
                                }}
                                className="ml-2 p-2 text-gray-500 hover:text-green-600 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-md transition-colors"
                                title="Copy UID"
                            >
                                {copied ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                        )}
                    </div>
                    {/* HELP TEXT FOR EXPIRY */}
                    <div className="mt-3 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-md border border-amber-200 dark:border-amber-800/50">
                        <strong>Session Expired?</strong> The Minima Node restarted or stopped, so the UID changed.
                        <ul className="list-decimal pl-5 mt-2 space-y-1">
                            <li>Open the <strong>Minima App</strong>.</li>
                            <li>Find <strong>MetaChain</strong> in your Dapps.</li>
                            <li>Tap the <strong>Menu (☰)</strong> {'>'} <strong>Settings</strong> {'>'} <strong>Connect App</strong>.</li>
                            <li>Copy the <strong>UID</strong>.</li>
                            <li>Return to <strong>this App</strong> and paste it below.</li>
                        </ul>
                    </div>
                </div>

                {!showManual ? (
                    <button
                        onClick={() => setShowManual(true)}
                        className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium"
                    >
                        Show Manual Connection Config
                    </button>
                ) : (
                    <div className="mt-6 border-t pt-6 dark:border-gray-700">
                        <div className="mb-6">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Enter New UID (Manual)
                            </label>
                            <input
                                type="text"
                                value={uid}
                                onChange={(e) => setUid(e.target.value)}
                                placeholder="Ex: 0x54..."
                                className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                            />
                            <p className="mt-2 text-xs text-gray-500">
                                Enter a valid Minima Session UID to connect.
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <button
                                onClick={handleConnect}
                                disabled={!uid.trim()}
                                className="flex-1 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md font-medium transition-colors flex items-center justify-center"
                            >
                                <LinkIcon size={18} className="mr-2" />
                                Connect & Reload
                            </button>

                            {currentUid && (
                                <button
                                    onClick={handleClear}
                                    className="px-4 py-2 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md font-medium transition-colors"
                                >
                                    Disconnect
                                </button>
                            )}
                        </div>
                    </div>
                )}

            </div>
        </div>
    )
}
