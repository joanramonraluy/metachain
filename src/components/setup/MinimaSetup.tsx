import React, { useState } from 'react';

interface MinimaSetupProps {
    onComplete: (uid: string) => void;
}

export const MinimaSetup: React.FC<MinimaSetupProps> = ({ onComplete }) => {
    const [uid, setUid] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!uid.trim()) {
            setError('Please enter a valid UID');
            return;
        }
        // Basic validation (optional)
        if (uid.length < 10) {
            setError('UID seems too short');
            return;
        }
        onComplete(uid.trim());
    };

    return (
        <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl p-6 w-full max-w-md">
                <h2 className="text-2xl font-bold mb-4 text-slate-800 dark:text-white">Connect to Minima</h2>

                <p className="text-slate-600 dark:text-slate-300 mb-6">
                    To use MetaChain as a standalone app, you need to connect it to your local Minima node.
                </p>

                <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-md mb-6 text-sm text-blue-800 dark:text-blue-200">
                    <strong>Automatic Connection:</strong>
                    <p className="mt-1">
                        Open the <strong>Minima App</strong>, go to this Dapp, and click <strong>"Connect Standalone App"</strong>. This will configure everything automatically.
                    </p>
                    <hr className="my-3 border-blue-200 dark:border-blue-800" />
                    <strong>Manual Connection:</strong>
                    <ol className="list-decimal list-inside mt-2 space-y-1">
                        <li>Open the official <strong>Minima App</strong>.</li>
                        <li>Go to the <strong>Dapps</strong> section.</li>
                        <li>Find <strong>MetaChain</strong>.</li>
                        <li>Tap the three dots (⋮) and select <strong>Copy URL</strong>.</li>
                        <li>Paste the UID from the URL here (or the whole URL).</li>
                    </ol>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="uid" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Minima UID / Session ID
                        </label>
                        <input
                            type="text"
                            id="uid"
                            value={uid}
                            onChange={(e) => {
                                setUid(e.target.value);
                                setError('');
                            }}
                            placeholder="e.g. 0x1234..."
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-white"
                        />
                        {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
                    </div>

                    <button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
                    >
                        Connect
                    </button>

                </form>

                {/* ADVANCED DEBUG: Environment details to diagnose launch issues */}
                <div className="mt-8 p-3 bg-gray-100 dark:bg-gray-900 rounded text-xs font-mono break-all text-gray-500 relative">
                    <p><strong>Environment Debug:</strong></p>
                    <p>MDS Present: {(window as any).MDS ? 'YES' : 'NO'}</p>
                    <p>Capacitor: {(window as any).Capacitor ? 'YES' : 'NO'}</p>
                    <p>Is Native: {(window as any).Capacitor?.isNative ? 'YES' : 'NO'}</p>
                    <p>UA: {navigator.userAgent}</p>
                    <hr className="my-2 border-gray-300 dark:border-gray-700" />
                    <p>Cold URL: {localStorage.getItem('debug_launch_url_cold') || 'None'}</p>
                    <p>Open URL: {localStorage.getItem('debug_launch_url_open') || 'None'}</p>

                    <button
                        type="button"
                        onClick={() => {
                            const debugText = `MDS: ${(window as any).MDS ? 'YES' : 'NO'}\nCapacitor: ${(window as any).Capacitor ? 'YES' : 'NO'}\nNative: ${(window as any).Capacitor?.isNative ? 'YES' : 'NO'}\nUA: ${navigator.userAgent}\nCold: ${localStorage.getItem('debug_launch_url_cold')}\nOpen: ${localStorage.getItem('debug_launch_url_open')}`;
                            navigator.clipboard.writeText(debugText).then(() => alert("Copied!")).catch(e => alert("Copy failed: " + e));
                        }}
                        className="absolute top-2 right-2 bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 px-2 py-1 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                    >
                        Copy
                    </button>
                </div>
            </div>
        </div>
    );
};
