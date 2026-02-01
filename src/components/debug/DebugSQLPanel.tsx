import { useState, useEffect } from 'react';
import { X, Play, Copy, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { MDS } from '@minima-global/mds';

interface QueryResult {
    sql: string;
    status: boolean;
    results: boolean;
    count?: number;
    rows?: any[];
    error?: string;
}

interface PredefinedQuery {
    name: string;
    description: string;
    sql: string;
    category: string;
}

const PREDEFINED_QUERIES: PredefinedQuery[] = [
    {
        name: 'All Chat Messages',
        description: 'View all messages for current chat',
        category: 'Messages',
        sql: `SELECT id, message, type, state, sender_seq, original_timestamp, publickey 
FROM CHAT_MESSAGES 
WHERE publickey = '{CONTACT_PUBKEY}' 
ORDER BY sender_seq ASC`,
    },
    {
        name: 'Pending Messages',
        description: 'Messages waiting to be sent',
        category: 'Messages',
        sql: `SELECT id, message, state, sender_seq, original_timestamp 
FROM CHAT_MESSAGES 
WHERE state = 'pending' 
ORDER BY original_timestamp DESC`,
    },
    {
        name: 'Offline Queue',
        description: 'Messages in offline queue',
        category: 'Queue',
        sql: `SELECT * FROM OFFLINE_QUEUE ORDER BY created_at ASC`,
    },
    {
        name: 'Message Counters',
        description: 'Sequence counters per contact',
        category: 'Sync',
        sql: `SELECT * FROM MESSAGE_COUNTERS ORDER BY publickey`,
    },
    {
        name: 'Chat Status',
        description: 'Status of all chats',
        category: 'Chats',
        sql: `SELECT * FROM CHAT_STATUS ORDER BY LAST_OPENED DESC`,
    },
    {
        name: 'Discovered Peers',
        description: 'All discovered peers',
        category: 'Contacts',
        sql: `SELECT publickey, name, minimaaddress, allow_non_contact_chats 
FROM DISCOVERED_PEERS 
ORDER BY name`,
    },
    {
        name: 'Contact Requests',
        description: 'All contact requests',
        category: 'Contacts',
        sql: `SELECT * FROM CONTACT_REQUESTS ORDER BY created_at DESC`,
    },
    {
        name: 'My Profile',
        description: 'Current user profile',
        category: 'Profile',
        sql: `SELECT * FROM MY_PROFILE`,
    },
];

export function DebugSQLPanel({ onClose, contactPubkey, mdsLoaded = false }: { onClose: () => void; contactPubkey?: string; mdsLoaded?: boolean }) {
    const [query, setQuery] = useState('');
    const [result, setResult] = useState<QueryResult | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [history, setHistory] = useState<string[]>([]);
    const [showPredefined, setShowPredefined] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState<string>('All');

    const categories = ['All', ...Array.from(new Set(PREDEFINED_QUERIES.map(q => q.category)))];

    const filteredQueries = selectedCategory === 'All'
        ? PREDEFINED_QUERIES
        : PREDEFINED_QUERIES.filter(q => q.category === selectedCategory);

    const executeQuery = async (sqlQuery: string) => {
        if (!sqlQuery.trim()) return;

        setIsExecuting(true);
        try {
            // Replace placeholder with actual contact pubkey
            const finalQuery = sqlQuery.replace('{CONTACT_PUBKEY}', contactPubkey || '');

            const response = await MDS.sql(finalQuery);

            // Check if response is valid
            if (!response || typeof response !== 'object') {
                setResult({
                    sql: finalQuery,
                    status: false,
                    results: false,
                    error: 'Node is offline or not responding. Please check your connection.',
                });
                setIsExecuting(false);
                return;
            }

            setResult(response);

            // Add to history (avoid duplicates)
            if (!history.includes(finalQuery)) {
                setHistory(prev => [finalQuery, ...prev].slice(0, 10));
            }
        } catch (error: any) {
            setResult({
                sql: sqlQuery,
                status: false,
                results: false,
                error: error?.message || 'Unknown error occurred',
            });
        } finally {
            setIsExecuting(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const copyResults = () => {
        if (!result?.rows || result.rows.length === 0) return;

        // Create TSV format (tab-separated values)
        const headers = Object.keys(result.rows[0]).join('\t');
        const rows = result.rows.map(row =>
            Object.values(row).map(val => val === null ? 'null' : String(val)).join('\t')
        ).join('\n');

        const tsv = `${headers}\n${rows}`;
        navigator.clipboard.writeText(tsv);
    };

    const downloadResults = () => {
        if (!result?.rows) return;

        const json = JSON.stringify(result.rows, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `query-results-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Keyboard shortcut: Ctrl+Enter to execute
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                executeQuery(query);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [query]);

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <div>
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">SQL Debug Console</h2>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${mdsLoaded
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                }`}>
                                {mdsLoaded ? '● Online' : '● Offline'}
                            </span>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Execute SQL queries on the local database</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex">
                    {/* Sidebar - Predefined Queries */}
                    <div className="w-80 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
                        <div className="p-4">
                            <button
                                onClick={() => setShowPredefined(!showPredefined)}
                                className="flex items-center justify-between w-full text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
                            >
                                <span>Predefined Queries</span>
                                {showPredefined ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>

                            {showPredefined && (
                                <>
                                    {/* Category Filter */}
                                    <div className="flex gap-1 mb-3 flex-wrap">
                                        {categories.map(cat => (
                                            <button
                                                key={cat}
                                                onClick={() => setSelectedCategory(cat)}
                                                className={`px-2 py-1 text-xs rounded ${selectedCategory === cat
                                                    ? 'bg-blue-500 text-white'
                                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                                                    }`}
                                            >
                                                {cat}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Query List */}
                                    <div className="space-y-2">
                                        {filteredQueries.map((pq, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => setQuery(pq.sql)}
                                                className="w-full text-left p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                            >
                                                <div className="font-medium text-sm text-gray-900 dark:text-white">{pq.name}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{pq.description}</div>
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}

                            {/* History */}
                            {history.length > 0 && (
                                <div className="mt-4">
                                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Recent Queries</h3>
                                    <div className="space-y-1">
                                        {history.map((h, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => setQuery(h)}
                                                className="w-full text-left p-2 rounded text-xs bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors truncate"
                                                title={h}
                                            >
                                                {h}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Query Editor */}
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">SQL Query</label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => copyToClipboard(query)}
                                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                                        title="Copy query"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            <textarea
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                className="w-full h-32 p-3 font-mono text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="Enter SQL query... (Ctrl+Enter to execute)"
                            />
                            <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Tip: Use {'{CONTACT_PUBKEY}'} as placeholder for current contact
                                </span>
                                <button
                                    onClick={() => executeQuery(query)}
                                    disabled={isExecuting || !query.trim()}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Play className="w-4 h-4" />
                                    {isExecuting ? 'Executing...' : 'Execute'}
                                </button>
                            </div>
                        </div>

                        {/* Results */}
                        <div className="flex-1 overflow-auto p-4">
                            {result && (
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-3">
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${result.status ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                                }`}>
                                                {result.status ? 'Success' : 'Error'}
                                            </span>
                                            {result.count !== undefined && (
                                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                                    {result.count} row{result.count !== 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>
                                        {result.rows && result.rows.length > 0 && (
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={copyResults}
                                                    className="flex items-center gap-2 px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                                                >
                                                    <Copy className="w-4 h-4" />
                                                    Copy Table
                                                </button>
                                                <button
                                                    onClick={downloadResults}
                                                    className="flex items-center gap-2 px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                                                >
                                                    <Download className="w-4 h-4" />
                                                    Download JSON
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {result.error && (
                                        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                                            <p className="text-sm text-red-800 dark:text-red-200 font-mono">{result.error}</p>
                                        </div>
                                    )}

                                    {result.rows && result.rows.length > 0 && (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm border-collapse">
                                                <thead>
                                                    <tr className="bg-gray-50 dark:bg-gray-700">
                                                        {Object.keys(result.rows[0]).map((key) => (
                                                            <th key={key} className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">
                                                                {key}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {result.rows.map((row, idx) => (
                                                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                            {Object.values(row).map((value: any, vidx) => (
                                                                <td key={vidx} className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 font-mono text-xs">
                                                                    {value === null ? (
                                                                        <span className="text-gray-400 italic">null</span>
                                                                    ) : typeof value === 'object' ? (
                                                                        JSON.stringify(value)
                                                                    ) : (
                                                                        String(value)
                                                                    )}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {result.rows && result.rows.length === 0 && !result.error && (
                                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                            Query executed successfully but returned no rows
                                        </div>
                                    )}
                                </div>
                            )}

                            {!result && (
                                <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
                                    <div className="text-center">
                                        <p className="text-lg font-medium mb-2">No query executed yet</p>
                                        <p className="text-sm">Select a predefined query or write your own</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
