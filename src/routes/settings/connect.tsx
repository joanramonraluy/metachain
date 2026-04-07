import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { Link as LinkIcon, Smartphone, Check, Copy, Zap, RefreshCw, AlertTriangle } from 'lucide-react'
import { MDS } from '@minima-global/mds'
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
                setTestResult({ success: false, message: log });
                return;
            }

            log += `2. MDS AUTH TEST... `;
            // @ts-ignore
            const cmdRes: any = await new Promise((resolve) => {
                MDS.cmd.block((res: any) => resolve(res));
            });

            if (cmdRes.status) {
                log += `✅ OK (Block: ${cmdRes.response.block})\n`;
                log += `\n>> CONNECTION HEALTHY <<`;
                setTestResult({ success: true, message: log });
            } else {
                log += `❌ FAILED\n   Response: ${JSON.stringify(cmdRes)}\n`;
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
        setTimeout(() => {
            localStorage.setItem('minima_uid', rpcUid.trim())
            const rpcMdsHost = localStorage.getItem('minima_rpc_mds_host');
            if (rpcMdsHost) {
                localStorage.setItem('minima_mds_host', rpcMdsHost);
            }
            window.location.reload()
        }, 500);
    }

    useEffect(() => {
        if (sessionExpired) {
            setShowManual(true);
        }
    }, [sessionExpired]);

    useEffect(() => {
        const checkUid = () => {
            const mdsUid = MDS.minidappuid;
            const urlParams = new URLSearchParams(window.location.search);
            const urlUid = urlParams.get('uid');
            const finalUid = localStorage.getItem('minima_uid') || mdsUid || urlUid || MDS.DEBUG_MINIDAPPID || '';
            if (finalUid) {
                setCurrentUid(finalUid);
            }
        };
        checkUid();
        const interval = setInterval(checkUid, 500);
        const timeout = setTimeout(() => clearInterval(interval), 5000);
        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [])

    const handleConnect = () => {
        if (!uid.trim()) return
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
        <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
            
            {/* Unified Header */}
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-[1.25rem] bg-gradient-to-br from-blue-400 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
                    <Smartphone className="text-white" size={24} strokeWidth={2.5} />
                </div>
                <div>
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Connectivity</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Link your device to the decentralized network.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-12">
                {/* Connection Status Spotlight Card */}
                <section className="bg-white/40 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/10 p-10 rounded-[3.5rem] shadow-2xl space-y-8 relative overflow-hidden">
                    {/* Visual Pulse for active connection */}
                    {currentUid && !sessionExpired && (
                        <div className="absolute top-0 right-0 p-6">
                            <div className="w-4 h-4 rounded-full bg-emerald-500 animate-pulse ring-8 ring-emerald-500/20"></div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <h3 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.3em]">SESSION IDENTITY</h3>
                        <p className="text-xl font-black text-gray-900 dark:text-white">Active Session UID</p>
                    </div>

                    <div className="group relative bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 p-6 rounded-[2.5rem] transition-all hover:bg-black/10 dark:hover:bg-white/10">
                        <div className="flex items-center gap-4">
                            <div className={`p-4 rounded-2xl flex items-center justify-center shrink-0 ${currentUid && !sessionExpired ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                                <Check size={28} strokeWidth={3} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <code className="text-sm font-black font-mono text-gray-800 dark:text-gray-200 block truncate">
                                    {currentUid || "Not Connected"}
                                </code>
                                {currentUid && rpcUid === currentUid && (
                                    <span className="text-[10px] font-black uppercase tracking-widest text-primary-500 mt-1">Verified via RPC</span>
                                )}
                            </div>
                            {currentUid && (
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(currentUid);
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 2000);
                                    }}
                                    className="p-4 rounded-2xl bg-white/50 dark:bg-black/20 hover:scale-110 active:scale-95 transition-all shadow-sm"
                                >
                                    {copied ? <Check size={20} className="text-emerald-500" strokeWidth={3} /> : <Copy size={20} className="text-gray-500" />}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* RPC Discovery Banner */}
                    {rpcUid && (sessionExpired || rpcUid !== currentUid) && (
                        <div className="p-8 rounded-[2.5rem] bg-primary-500/10 border border-primary-500/20 space-y-6 animate-in slide-in-from-top-4">
                            <div className="flex items-center gap-3">
                                <LinkIcon size={18} className="text-primary-500" />
                                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-primary-600 dark:text-primary-400">Discovery Alert</h4>
                            </div>
                            <div className="space-y-4">
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    A valid MiniDapp session was detected via RPC. You can use it to reconnect instantly.
                                </p>
                                <button
                                    onClick={handleUseRpcUid}
                                    className="w-full py-4 rounded-2xl bg-primary-500 text-white font-black text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-primary-500/20"
                                >
                                    Use Auto-Discovered UID
                                </button>
                            </div>
                        </div>
                    )}

                    {sessionExpired && (
                        <div className="p-8 rounded-[2.5rem] bg-amber-500/10 border border-amber-500/20 space-y-6 animate-pulse">
                            <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
                                <AlertTriangle size={20} strokeWidth={3} />
                                <h4 className="text-sm font-black uppercase tracking-widest">Session Expired</h4>
                            </div>
                            <div className="space-y-4">
                                <p className="text-sm font-medium text-amber-800 dark:text-amber-300 leading-relaxed">
                                    The Minima Node restarted or stopped, so the UID changed. Please follow these steps to reconnect:
                                </p>
                                <div className="grid grid-cols-1 gap-3">
                                    {[
                                        "Open the Minima App.",
                                        "Find MetaChain in your Dapps.",
                                        "Tap the Menu (☰) > Settings > Connect App.",
                                        "Copy the UID.",
                                        "Return to this App and paste it below."
                                    ].map((step, i) => (
                                        <div key={i} className="flex items-start gap-3 bg-white/20 dark:bg-black/20 p-3 rounded-xl border border-white/10">
                                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center">{i + 1}</span>
                                            <span className="text-xs font-bold text-amber-900 dark:text-amber-100">{step}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </section>

                {/* Configuration Console */}
                <section className="bg-white/40 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/10 p-8 rounded-[3rem] shadow-xl space-y-8">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-gray-500/10 flex items-center justify-center text-gray-500">
                                <Smartphone size={16} />
                            </div>
                            <h3 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.3em]">MANUAL CONSOLE</h3>
                        </div>
                        <button 
                            onClick={() => setShowManual(!showManual)}
                            className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-500 hover:text-primary-600"
                        >
                            {showManual ? "Hide Controls" : "Show Controls"}
                        </button>
                    </div>

                    {showManual && (
                        <div className="space-y-8 animate-in slide-in-from-top-4">
                            {!sessionExpired && (
                                <div className="p-6 rounded-[2rem] bg-gray-500/5 border border-gray-500/10 space-y-4">
                                    <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">Retrieval Instructions</h4>
                                    <div className="grid grid-cols-1 gap-2">
                                        {[
                                            "Open Minima App > MetaChain > Menu (☰)",
                                            "Settings > Connect App > Copy UID",
                                            "Paste the UID in the field below"
                                        ].map((step, i) => (
                                            <div key={i} className="flex items-center gap-3">
                                                <div className="w-1 h-1 rounded-full bg-primary-500"></div>
                                                <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">{step}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="group bg-black/5 dark:bg-white/5 p-6 rounded-[2.5rem] border border-black/5 dark:border-white/10 hover:border-primary-500/20 transition-all focus-within:ring-4 focus-within:ring-primary-500/10">
                                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 ml-1">Manual UID Entry</label>
                                <input
                                    type="text"
                                    value={uid}
                                    onChange={(e) => setUid(e.target.value)}
                                    placeholder="Enter Session UID..."
                                    className="w-full bg-transparent text-xl font-black font-mono text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-gray-700"
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <button
                                    onClick={handleConnect}
                                    disabled={!uid.trim()}
                                    className="py-5 rounded-[2rem] bg-black dark:bg-white text-white dark:text-black font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-xl disabled:opacity-30"
                                >
                                    Verify & Reload
                                </button>
                                {currentUid && (
                                    <button
                                        onClick={handleClear}
                                        className="py-5 rounded-[2rem] border-2 border-red-500/20 text-red-500 font-black text-xs uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all shadow-xl active:scale-95 shadow-red-500/10"
                                    >
                                        Disconnect App
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </section>

                {/* Diagnostics Suite */}
                <section className="bg-white/40 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/10 p-8 rounded-[3rem] shadow-xl space-y-6">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500">
                            <Zap size={16} />
                        </div>
                        <h3 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.3em]">DIAGNOSTICS SUITE</h3>
                    </div>

                    <button
                        onClick={runDiagnostics}
                        disabled={testing}
                        className="w-full py-6 rounded-[2rem] bg-gray-500/5 hover:bg-gray-500/10 dark:bg-white/5 dark:hover:bg-white/10 border border-gray-500/10 font-black text-xs uppercase tracking-[0.2em] text-gray-600 dark:text-gray-400 transition-all flex items-center justify-center gap-3"
                    >
                        {testing ? (
                            <RefreshCw size={18} className="animate-spin" />
                        ) : (
                            <Zap size={18} />
                        )}
                        Run Connection Audit
                    </button>

                    {testResult && (
                        <div className={`p-8 rounded-[2rem] border-2 font-mono text-[10px] whitespace-pre-wrap leading-relaxed animate-in zoom-in-95 ${testResult.success ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-800 dark:text-emerald-400' : 'bg-red-500/5 border-red-500/20 text-red-800 dark:text-red-400'}`}>
                            {testResult.message}
                        </div>
                    )}
                </section>
            </div>
        </div>
    )
}
