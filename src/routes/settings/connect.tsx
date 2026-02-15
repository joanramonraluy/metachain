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

    const [rpcUid, setRpcUid] = useState('')

    // Diagnostics State
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

    const runDiagnostics = async () => {
        setTesting(true);
        setTestResult(null);

        let mdsHost = localStorage.getItem('minima_mds_host') || "http://127.0.0.1:9003/";
        if (mdsHost.includes(':9003') || mdsHost.includes('127.0.0.1') || mdsHost.includes('localhost')) {
            mdsHost = mdsHost.replace('https://', 'http://');
        }
        const currentUid = localStorage.getItem('minima_uid') || "";

        let log = `--- Connection Diagnostics ---\n\n`;
        log += `TARGET HOST: ${mdsHost}\n`;
        log += `UID: ${currentUid ? currentUid.substring(0, 10) + "..." : "NONE"}\n\n`;

        try {
            // STEP 1: PING (Network Reachability)
            log += `1. PING TEST (${mdsHost})... `;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            try {
                const res = await fetch(mdsHost, {
                    method: 'GET',
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                log += `✅ OK (Status: ${res.status})\n`;
            } catch (err: any) {
                clearTimeout(timeoutId);
                log += `❌ FAILED\n   Error: ${err.name}: ${err.message}\n`;
                if (err.name === 'AbortError') {
                    log += `   -> TIMEOUT: Node is offline or blocked by Android Battery Saver.\n`;
                } else if (err.message.includes("Failed to fetch")) {
                    log += `   -> CONNECTION REFUSED: Node is not listening on this port.\n`;
                }
                setTestResult({ success: false, message: log });
                setTesting(false);
                return;
            }

            // STEP 2: MDS COMMAND (Authentication)
            log += `2. MDS AUTH TEST... `;
            const cmdRes: any = await new Promise((resolve) => {
                MDS.cmd.block((res: any) => resolve(res));
            });

            if (cmdRes.status) {
                log += `✅ OK (Block: ${cmdRes.response.block})\n`;
                log += `\n>> CONNECTION HEALTHY <<`;
                setTestResult({ success: true, message: log });
            } else {
                log += `❌ FAILED\n   Response: ${JSON.stringify(cmdRes)}\n`;
                if (cmdRes.error && (cmdRes.error.includes("Incorrect Minima Dapp UID") || cmdRes.error.includes("Not allowed"))) {
                    log += `   -> INVALID UID: You must re-connect from Minima app.\n`;
                }
                setTestResult({ success: false, message: log });
            }

        } catch (e: any) {
            log += `\n❌ UNEXPECTED ERROR: ${e.message}`;
            setTestResult({ success: false, message: log });
        } finally {
            setTesting(false);
        }
    };

    useEffect(() => {
        const discovered = localStorage.getItem('minima_rpc_uid');
        if (discovered) {
            setRpcUid(discovered);
        }
    }, [])

    const handleUseRpcUid = () => {
        if (!rpcUid) return;
        setUid(rpcUid);
        setShowManual(true);
        // We'll give the user a chance to see it filled, OR we could auto-click.
        // The user asked to "simular que premem el botó", so let's do it after a tiny delay
        setTimeout(() => {
            localStorage.setItem('minima_uid', rpcUid.trim())

            // Also apply the discovered MDS host if we have it
            const rpcMdsHost = localStorage.getItem('minima_rpc_mds_host');
            if (rpcMdsHost) {
                console.log("🚀 [Settings] Applying discovered MDS Host:", rpcMdsHost);
                localStorage.setItem('minima_mds_host', rpcMdsHost);
            }

            window.location.reload()
        }, 500);
    }

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
        window.location.reload()
    }

    const handleClear = () => {
        if (confirm("Are you sure? This will disconnect the app.")) {
            localStorage.removeItem('minima_uid')
            localStorage.removeItem('minima_rpc_uid')
            localStorage.removeItem('MDS_ID')
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
                        {currentUid && rpcUid === currentUid && (
                            <span className="mx-2 px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 text-[10px] font-bold rounded uppercase tracking-wider">
                                RPC
                            </span>
                        )}
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

                    {/* RPC Discovery Section (Shown if different OR if session expired) */}
                    {rpcUid && (sessionExpired || rpcUid !== currentUid) && (
                        <div className="mt-4 p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-xs font-semibold text-primary-700 dark:text-primary-300 uppercase tracking-wider">
                                    Discovered via RPC
                                </label>
                                {rpcUid === currentUid && (
                                    <span className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">
                                        Matches Current
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <code className="text-xs font-mono text-primary-600 dark:text-primary-400 break-all flex-1 bg-white dark:bg-black/20 p-2 rounded">
                                    {rpcUid}
                                </code>
                                <button
                                    onClick={handleUseRpcUid}
                                    className="px-3 py-2 bg-primary-600 text-white text-xs font-medium rounded hover:bg-primary-700 transition-colors shrink-0"
                                >
                                    Use this UID
                                </button>
                            </div>
                            <p className="mt-2 text-[10px] text-primary-500">
                                {rpcUid === currentUid
                                    ? "This matches your current UID. Use the button to force a clean reconnect if it's not working."
                                    : "This UID was found by looking at your installed MiniDapps."}
                            </p>
                        </div>
                    )}

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

                {/* DIAGNOSTICS TOOL */}
                <div className="mt-8 border-t pt-6 dark:border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Connection Diagnostics</h3>
                    <p className="text-xs text-gray-500 mb-4">
                        If you are experiencing issues, run this test to identify if it's a network timeout (Node offline) or an authentication error (Invalid UID).
                    </p>

                    <button
                        onClick={runDiagnostics}
                        disabled={testing}
                        className="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-4 py-3 rounded-md font-medium transition-colors flex items-center justify-center border border-gray-200 dark:border-gray-600"
                    >
                        {testing ? (
                            <span className="flex items-center">
                                <span className="animate-spin h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full mr-2"></span>
                                Running Tests...
                            </span>
                        ) : (
                            "Run Connection Diagnostics"
                        )}
                    </button>

                    {testResult && (
                        <div className={`mt-4 p-4 rounded-md border text-xs font-mono whitespace-pre-wrap ${testResult.success ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300' : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300'}`}>
                            {testResult.message}
                        </div>
                    )}
                </div>

            </div >
        </div >
    )
}
