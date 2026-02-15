import { createFileRoute } from '@tanstack/react-router';
import { MDS } from '@minima-global/mds';
import { Globe, RefreshCw, Check, Info } from 'lucide-react';
import { useState, useEffect } from 'react';

export const Route = createFileRoute('/settings/network')({
  component: RouteComponent,
});

function RouteComponent() {
  const [networkStatus, setNetworkStatus] = useState<any>(null);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  const fetchNetworkStatus = () => {
    setNetworkLoading(true);
    // Correct command is 'status' not 'network'
    (MDS.cmd as any).status({ params: {} }, (res: any) => {
      setNetworkLoading(false);
      setLastUpdated(Date.now());
      if (res.status) {
        setNetworkStatus(res.response);
      }
    });
  };

  useEffect(() => {
    fetchNetworkStatus();
    // Poll every 10s
    const interval = setInterval(fetchNetworkStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden transition-colors">

        {/* Header */}
        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="text-green-500" />
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Network</h2>
          </div>
          <button
            onClick={fetchNetworkStatus}
            disabled={networkLoading}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh network status"
          >
            <RefreshCw size={18} className={networkLoading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="p-6">
          {networkLoading && !networkStatus ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={24} className="animate-spin text-gray-400" />
            </div>
          ) : networkStatus ? (
            <>
              {/* Health Status Badge */}
              <div className={`flex items-center gap-3 p-4 rounded-xl mb-6 ${networkStatus.network?.connected > 3
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/50'
                : networkStatus.network?.connected > 0
                  ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-900/50'
                  : 'bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50'
                }`}>
                <div className={`p-2 rounded-full ${networkStatus.network?.connected > 3
                  ? 'bg-green-100 text-green-600'
                  : networkStatus.network?.connected > 0
                    ? 'bg-yellow-100 text-yellow-600'
                    : 'bg-red-100 text-red-600'
                  }`}>
                  <Check size={20} />
                </div>
                <div>
                  <h3 className={`font-semibold ${networkStatus.network?.connected > 3
                    ? 'text-green-800 dark:text-green-400'
                    : networkStatus.network?.connected > 0
                      ? 'text-yellow-800 dark:text-yellow-400'
                      : 'text-red-800 dark:text-red-400'
                    }`}>
                    {networkStatus.network?.connected > 3
                      ? 'Network running smoothly'
                      : networkStatus.network?.connected > 0
                        ? 'Limited connection'
                        : 'No connection'}
                  </h3>
                  <p className={`text-sm ${networkStatus.network?.connected > 3
                    ? 'text-green-600 dark:text-green-300'
                    : networkStatus.network?.connected > 0
                      ? 'text-yellow-600 dark:text-yellow-300'
                      : 'text-red-600 dark:text-red-300'
                    }`}>
                    {networkStatus.network?.connected > 3
                      ? 'Connected to Minima network'
                      : networkStatus.network?.connected > 0
                        ? 'Few active connections'
                        : 'No active connections'}
                  </p>
                </div>
              </div>

              {/* Network Metrics */}
              <div className="space-y-4">
                {/* Connections */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg text-primary-600 dark:text-primary-400">
                      <Globe size={18} />
                    </div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">Connections</span>
                  </div>
                  <span className="text-lg font-bold text-gray-900 dark:text-white">
                    {networkStatus.network?.connected || 0} nodes
                  </span>
                </div>

                {/* Current Block */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400">
                      <span className="text-sm font-bold">⛓️</span>
                    </div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">Current Block</span>
                  </div>
                  <span className="text-lg font-bold text-gray-900 dark:text-white">
                    #{networkStatus.chain?.block?.toLocaleString() || 0}
                  </span>
                </div>

                {/* Last Block Time */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg text-orange-600 dark:text-orange-400">
                      <span className="text-sm font-bold">🕐</span>
                    </div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">Last Update</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    {networkStatus.chain?.time || 'N/A'}
                  </span>
                </div>

                {/* Minima Version */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-200 dark:bg-gray-600 rounded-lg text-gray-600 dark:text-gray-300">
                      <Info size={18} />
                    </div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">Version</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Minima {networkStatus.version || 'N/A'}
                  </span>
                </div>
              </div>

              {/* Last Updated Timestamp */}
              <div className="mt-6 text-center text-xs text-gray-500 dark:text-gray-400">
                Updated {Math.floor((Date.now() - lastUpdated) / 1000)} seconds ago
              </div>
            </>
          ) : (
            <p className="text-gray-500 text-center py-4">Unable to load network data</p>
          )}
        </div>
      </div>
    </div>
  );
}
