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
    // @ts-ignore
    MDS.cmd.status({ params: {} }, (res: any) => {
      setNetworkLoading(false);
      setLastUpdated(Date.now());
      if (res.status) {
        setNetworkStatus(res.response);
      }
    });
  };

  useEffect(() => {
    fetchNetworkStatus();
    const interval = setInterval(fetchNetworkStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
      
      {/* Unified Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
           <div className="w-12 h-12 rounded-[1.25rem] bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Globe className="text-white" size={24} strokeWidth={2.5} />
           </div>
           <div>
              <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Network</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Real-time status of your decentralized node.</p>
           </div>
        </div>
        <button
          onClick={fetchNetworkStatus}
          disabled={networkLoading}
          className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white/70 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/10 hover:scale-110 active:scale-95 transition-all shadow-sm hover:shadow-xl disabled:opacity-50 group"
          title="Refresh network status"
        >
          <RefreshCw size={20} className={`${networkLoading ? "animate-spin" : "group-hover:rotate-180"} transition-transform duration-700 text-gray-600 dark:text-gray-400`} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {networkLoading && !networkStatus ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-4">
             <div className="relative">
                <div className="w-16 h-16 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                   <Globe className="text-primary-500/50" size={20} />
                </div>
             </div>
             <p className="text-xs font-black uppercase tracking-[0.3em] text-gray-400">Syncing Node Status</p>
          </div>
        ) : networkStatus ? (
          <>
            {/* Primary Health Status Card */}
            <section className={`relative overflow-hidden bg-white/40 dark:bg-gray-900/40 backdrop-blur-md border p-10 rounded-[3.5rem] shadow-2xl transition-all duration-500 ${
              networkStatus.network?.connected > 3 ? 'border-emerald-500/20 shadow-emerald-500/10' :
              networkStatus.network?.connected > 0 ? 'border-amber-500/20 shadow-amber-500/10' :
              'border-red-500/20 shadow-red-500/10'
            }`}>
               {/* Decorative Background Elements */}
               <div className={`absolute -top-24 -right-24 w-64 h-64 blur-[100px] rounded-full opacity-20 ${
                 networkStatus.network?.connected > 3 ? 'bg-emerald-500' :
                 networkStatus.network?.connected > 0 ? 'bg-amber-500' :
                 'bg-red-500'
               }`}></div>

               <div className="relative flex flex-col md:flex-row items-center gap-8">
                  <div className="relative">
                     <div className={`w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-inner ${
                       networkStatus.network?.connected > 3 ? 'bg-emerald-500 text-white' :
                       networkStatus.network?.connected > 0 ? 'bg-amber-500 text-white' :
                       'bg-red-500 text-white'
                     }`}>
                        <Check size={40} strokeWidth={3} />
                     </div>
                     <div className={`absolute -bottom-1 -right-1 w-8 h-8 rounded-full border-4 border-white dark:border-gray-900 flex items-center justify-center ${
                       networkStatus.network?.connected > 3 ? 'bg-emerald-500' :
                       networkStatus.network?.connected > 0 ? 'bg-amber-500' :
                       'bg-red-500'
                     }`}>
                        <div className="w-2 h-2 rounded-full bg-white animate-pulse"></div>
                     </div>
                  </div>

                  <div className="text-center md:text-left space-y-2">
                     <h3 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
                       {networkStatus.network?.connected > 3
                         ? 'Network Healthy'
                         : networkStatus.network?.connected > 0
                           ? 'Limited Connectivity'
                           : 'Connection Lost'}
                     </h3>
                     <p className="text-sm font-medium text-gray-500 dark:text-gray-400 max-w-sm">
                       {networkStatus.network?.connected > 3
                         ? 'Your node is fully synchronized and communicating with the decentralized web.'
                         : networkStatus.network?.connected > 0
                           ? 'Only a few peers are currently reachable. Communication might be delayed.'
                           : 'Unable to detect active peers. Check your internet connection or P2P settings.'}
                     </p>
                  </div>
               </div>
            </section>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
               <MetricCard 
                 icon={<Globe size={20} />} 
                 label="Peers" 
                 value={networkStatus.network?.connected || 0} 
                 unit="Connected"
                 color="text-primary-500"
                 bgColor="bg-primary-500/10"
               />
               <MetricCard 
                 icon={<span className="text-lg">⛓️</span>} 
                 label="Block Height" 
                 value={networkStatus.chain?.block?.toLocaleString() || 0} 
                 unit={`#${Math.floor(networkStatus.chain?.block / 1000)}K`}
                 color="text-purple-500"
                 bgColor="bg-purple-500/10"
               />
               <MetricCard 
                 icon={<span className="text-lg">🕐</span>} 
                 label="Latency" 
                 value={networkStatus.chain?.time?.split(' ')[0] || '1s'} 
                 unit="Avg Response"
                 color="text-orange-500"
                 bgColor="bg-orange-500/10"
               />
               <MetricCard 
                 icon={<Info size={20} />} 
                 label="Protocol" 
                 value={networkStatus.version || '1.0'} 
                 unit="Minima Core"
                 color="text-gray-500"
                 bgColor="bg-gray-500/10"
               />
            </div>

            {/* Last Updated Footer */}
            <div className="flex items-center justify-center gap-2 pt-4">
               <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
               <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                  Last verified {Math.floor((Date.now() - lastUpdated) / 1000)}s ago
               </span>
            </div>
          </>
        ) : (
          <div className="bg-red-500/10 border border-red-500/20 p-8 rounded-[2.5rem] text-center">
             <p className="text-red-600 dark:text-red-400 font-black text-sm uppercase tracking-widest">Initialization Failed</p>
             <p className="text-sm text-gray-500 mt-2">Could not establish communication with the Minima RPC service.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, unit, color, bgColor }: { icon: any, label: string, value: string | number, unit: string, color: string, bgColor: string }) {
  return (
    <div className="bg-white/70 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/10 p-7 rounded-[2.5rem] shadow-sm hover:shadow-xl hover:scale-105 transition-all group">
       <div className={`w-10 h-10 rounded-xl ${bgColor} ${color} flex items-center justify-center mb-6 group-hover:rotate-12 transition-transform`}>
          {icon}
       </div>
       <div className="space-y-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">{label}</p>
          <p className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">{value}</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 opacity-80">{unit}</p>
       </div>
    </div>
  );
}
