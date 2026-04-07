import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MDS } from "@minima-global/mds";
import { useAppContext } from "../../AppContext";
import {
  Globe,
  Info,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/settings/discovery")({
  component: DiscoverySettings,
});

const DEFAULT_MLS_HOST =
  "MxG18HGG6FJ038614Y8CW46US6G20810K0070CD00Z83282G60G17D9TPD0R9AC9DS958UHDTTR419GV7JJ7TFN0NY69KD3E5V89PK1A4ANW4D3SBPWRTAUMA3QB3EC0AD3NR3CEKE90UZNV7S68FCN4VD0D5H7FYJAAZPPZYZQHYK25VU8WDZVPUPDBBGSCSA0PZFAQEN329TYQ2VYUB8HMA7CH7C6J8VEHPWBWAM9QBFQ3KBNW8E0FKDUPJRYFS10608004FNW87P@185.132.90.98:9001";

function DiscoverySettings() {
  const { loaded } = useAppContext();

  const [discoveryInterval, setDiscoveryInterval] = useState(60);
  const [discoveryLimit, setDiscoveryLimit] = useState(5);
  const [staticMLSServer, setStaticMLSServer] = useState("");
  const [inputMLSServer, setInputMLSServer] = useState("");
  const [hasStaticMLS, setHasStaticMLS] = useState(false);
  const [p2pIdentity, setP2pIdentity] = useState("");
  const [expandedAddress, setExpandedAddress] = useState<string | null>(null);
  const [enablingPermanent, setEnablingPermanent] = useState(false);

  useEffect(() => {
    if (!loaded) return;

    const fetchDiscoverySettings = async () => {
      try {
        const intervalRes = await MDS.keypair.get("discovery_interval");
        const limitRes = await MDS.keypair.get("discovery_limit");
        if (intervalRes?.status && intervalRes.value)
          setDiscoveryInterval(parseInt(intervalRes.value) || 60);
        if (limitRes?.status && limitRes.value)
          setDiscoveryLimit(parseInt(limitRes.value) || 5);

        // Fetch P2P Identity (My Maxima Info)
        // @ts-ignore
        const maximaInfo = await MDS.cmd.maxima({ params: { action: "info" } });
        // @ts-ignore
        if (maximaInfo.status && maximaInfo.response) {
          // @ts-ignore
          const p2p = maximaInfo.response.p2pidentity;
          if (p2p) {
            setP2pIdentity(p2p);
          }

          // Fetch MLS from the same info response
          // @ts-ignore
          const mls = maximaInfo.response.mls;
          // @ts-ignore
          const isStatic = maximaInfo.response.staticmls;

          if (mls && isStatic) {
            setStaticMLSServer(mls);
            setHasStaticMLS(true);
          } else {
            console.log("ℹ️ [Discovery] No Static MLS configured.");
            setStaticMLSServer("");
            setHasStaticMLS(false);
          }
        }
      } catch (err) {
        console.error("Error fetching discovery settings:", err);
      }
    };

    fetchDiscoverySettings();
  }, [loaded]);

  const toggleAddress = (id: string) => {
    setExpandedAddress(expandedAddress === id ? null : id);
  };

  const handleSetMLSServer = async () => {
    if (!inputMLSServer.trim()) return;
    setEnablingPermanent(true);
    try {
      // @ts-ignore
      const res = await MDS.cmd.maxextra({
        params: { action: "staticmls", host: inputMLSServer.trim() },
      });
      if (res.status) {
        // After setting, we should refresh to get the standard address format from the node
        // @ts-ignore
        const info = await MDS.cmd.maxima({ params: { action: "info" } });
        // @ts-ignore
        if (info.status && info.response && info.response.mls) {
          // @ts-ignore
          setStaticMLSServer(info.response.mls);
        } else {
          setStaticMLSServer(inputMLSServer.trim());
        }
        setHasStaticMLS(true);
        setInputMLSServer("");
      } else {
        alert("Failed to set MLS server: " + res.error);
      }
    } catch (e) {
      console.error("Error setting MLS:", e);
    } finally {
      setEnablingPermanent(false);
    }
  };

  const handleUseCommunityNode = async () => {
    setEnablingPermanent(true);
    try {
      // @ts-ignore
      const res = await MDS.cmd.maxextra({
        params: { action: "staticmls", host: DEFAULT_MLS_HOST },
      });
      if (res.status) {
        setStaticMLSServer(DEFAULT_MLS_HOST);
        setHasStaticMLS(true);
        // Refresh full info
        // @ts-ignore
        const info = await MDS.cmd.maxima({ params: { action: "info" } });
        // @ts-ignore
        if (info.status && info.response && info.response.mls) {
          // @ts-ignore
          setStaticMLSServer(info.response.mls);
        }
      } else {
        alert("Failed to set Community Node: " + res.error);
      }
    } catch (e) {
      console.error("Error setting community node:", e);
    } finally {
      setEnablingPermanent(false);
    }
  };

  const handleUseMyNodeAsServer = async () => {
    setEnablingPermanent(true);
    try {
      // Using local p2p identity as static MLS
      if (!p2pIdentity) {
        alert("P2P Identity not ready yet. Please wait.");
        return;
      }
      // @ts-ignore
      const res = await MDS.cmd.maxextra({
        params: { action: "staticmls", host: p2pIdentity },
      });
      if (res.status) {
        setStaticMLSServer(p2pIdentity);
        setHasStaticMLS(true);
      } else {
        alert("Failed to set local node as server: " + res.error);
      }
    } catch (e) {
      console.error("Error setting local node:", e);
    } finally {
      setEnablingPermanent(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
      
      {/* Unified Header */}
      <div className="flex items-center gap-4">
         <div className="w-12 h-12 rounded-[1.25rem] bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Globe className="text-white" size={24} strokeWidth={2.5} />
         </div>
         <div>
            <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Discovery</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Manage how your node communicates with the network.</p>
         </div>
      </div>

      <div className="grid grid-cols-1 gap-12">
        {/* Discovery Configuration */}
        <section className="bg-white/40 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/10 p-8 rounded-[3rem] shadow-xl space-y-8">
           <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                 <RefreshCw size={16} />
              </div>
              <h3 className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.3em]">GOSSIP PROTOCOL</h3>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Interval */}
              <div className="group bg-white/70 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/10 p-6 rounded-[2.5rem] shadow-sm hover:shadow-xl hover:border-emerald-500/20 transition-all">
                 <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 ml-1">Frequency</label>
                 <div className="flex items-end gap-3 px-1">
                    <input
                      type="number"
                      min="30"
                      step="10"
                      value={discoveryInterval}
                      onChange={(e) => setDiscoveryInterval(parseInt(e.target.value) || 0)}
                      onBlur={(e) => {
                         const val = parseInt(e.target.value) || 60;
                         const safeVal = val < 30 ? 30 : val;
                         setDiscoveryInterval(safeVal);
                         MDS.keypair.set("discovery_interval", String(safeVal));
                      }}
                      className="w-full bg-transparent text-3xl font-black text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-gray-700"
                    />
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-2">SECONDS</span>
                 </div>
                 <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-3 ml-1 italic opacity-70">Updating neighbors every {discoveryInterval} seconds.</p>
              </div>

              {/* Limit */}
              <div className="group bg-white/70 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/10 p-6 rounded-[2.5rem] shadow-sm hover:shadow-xl hover:border-emerald-500/20 transition-all">
                 <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 ml-1">Peer Limit</label>
                 <div className="flex items-end gap-3 px-1">
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={discoveryLimit}
                      onChange={(e) => setDiscoveryLimit(parseInt(e.target.value) || 0)}
                      onBlur={(e) => {
                         const val = parseInt(e.target.value) || 5;
                         const safeVal = val < 1 ? 1 : val > 50 ? 50 : val;
                         setDiscoveryLimit(safeVal);
                         MDS.keypair.set("discovery_limit", String(safeVal));
                      }}
                      className="w-full bg-transparent text-3xl font-black text-gray-900 dark:text-white outline-none placeholder:text-gray-300 dark:placeholder:text-gray-700"
                    />
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-2">NODES</span>
                 </div>
                 <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-3 ml-1 italic opacity-70">Targeting {discoveryLimit} peers per propagation.</p>
              </div>
           </div>
        </section>

        {/* Client Mode Section */}
        <section className="bg-white/40 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/10 p-8 rounded-[3rem] shadow-xl space-y-8">
           <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                 <div className="w-8 h-8 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-500">
                    <Globe size={16} />
                 </div>
                 <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-[0.2em]">Client Mode</h3>
              </div>
              <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                 <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Recommended</span>
              </div>
           </div>

           <div className="space-y-4">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 leading-relaxed max-w-2xl">
                 To be discoverable by other users and receive offline messages, you should register with an always-online Discovery Server (MLS).
              </p>
           </div>

           {hasStaticMLS ? (
              <div className="relative group overflow-hidden bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 p-8 rounded-[2.5rem]">
                 <div className="absolute top-0 right-0 p-4">
                    <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse ring-4 ring-emerald-500/20"></div>
                 </div>
                 <h4 className="text-xl font-black text-emerald-600 dark:text-emerald-400 mb-2">Connected</h4>
                 <p className="text-xs font-black uppercase tracking-widest text-gray-500 mb-6">Discovery Server Active</p>
                 <div className="bg-white/50 dark:bg-black/20 backdrop-blur-md p-4 rounded-2xl border border-white/20 dark:border-white/10">
                    <p className="text-[10px] font-mono text-gray-600 dark:text-gray-300 break-all leading-relaxed">
                       {staticMLSServer}
                    </p>
                 </div>
              </div>
           ) : (
              <div className="bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 p-8 rounded-[2.5rem]">
                 <h4 className="text-xl font-black text-amber-600 dark:text-amber-400 mb-2">Not Connected</h4>
                 <p className="text-sm font-medium text-gray-600 dark:text-gray-400 leading-relaxed">
                    You are not currently connected to a Discovery Server.
                 </p>
              </div>
           )}

           <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <button
                onClick={handleUseCommunityNode}
                disabled={enablingPermanent}
                className="flex items-center justify-center gap-3 p-4 rounded-[2rem] bg-primary-500 text-white font-black text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-primary-500/20 disabled:opacity-50"
              >
                {enablingPermanent ? <RefreshCw size={20} className="animate-spin" /> : <Globe size={20} strokeWidth={2.5} />}
                Use Recommended Community Node
              </button>

              <div className="flex flex-col gap-3">
                 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 ml-1">Or enter custom address</span>
                 <div className="flex gap-2">
                    <div className="flex-1 bg-black/5 dark:bg-white/5 rounded-[2rem] border border-black/5 dark:border-white/10 p-5 flex items-center group focus-within:border-primary-500/30 transition-all">
                       <input
                         type="text"
                         placeholder="Custom MAX#..."
                         value={inputMLSServer}
                         onChange={(e) => setInputMLSServer(e.target.value)}
                         className="w-full bg-transparent text-[11px] font-black text-gray-900 dark:text-white outline-none placeholder:text-gray-400 tracking-tight"
                       />
                    </div>
                    <button
                       onClick={handleSetMLSServer}
                       disabled={enablingPermanent || !inputMLSServer.trim()}
                       className="px-8 bg-black dark:bg-white text-white dark:text-black rounded-[2rem] font-black text-[10px] uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-30"
                    >
                       Set
                    </button>
                 </div>
              </div>
           </div>
        </section>

        {/* Server Mode (Expansion Card) */}
        <section className={`rounded-[3rem] border transition-all overflow-hidden ${expandedAddress === 'serverMode' ? 'bg-white/70 dark:bg-white/10 ring-4 ring-primary-500/10 border-primary-500/20' : 'bg-white/40 dark:bg-white/5 border-white/20 dark:border-white/10'}`}>
           <button 
             onClick={() => toggleAddress('serverMode')}
             className="w-full flex items-center justify-between p-8 hover:bg-black/5 transition-colors"
           >
              <div className="flex items-center gap-4">
                 <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${expandedAddress === 'serverMode' ? 'bg-primary-500 text-white' : 'bg-black/5 dark:bg-white/5 text-gray-500'}`}>
                    <Info size={20} strokeWidth={2.5} />
                 </div>
                 <div className="text-left">
                    <h4 className="text-lg font-black text-gray-900 dark:text-white leading-none mb-1">Server Mode (Advanced)</h4>
                    <p className="text-xs font-black uppercase tracking-widest text-gray-500">Enable Discovery Services</p>
                 </div>
              </div>
              {expandedAddress === 'serverMode' ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
           </button>

           {expandedAddress === 'serverMode' && (
              <div className="p-8 pt-0 space-y-6 animate-in slide-in-from-top-4">
                 <div className="p-6 rounded-[2rem] bg-amber-500/10 border border-amber-500/20 space-y-3">
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                       <AlertTriangle size={18} strokeWidth={3} />
                       <h5 className="text-xs font-black uppercase tracking-widest">Stability Warning</h5>
                    </div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                       This mode is intended for always-on servers (VPS). Providing MLS services from a mobile device will consume battery and data rapidly.
                    </p>
                 </div>

                 {p2pIdentity ? (
                    <div className="space-y-6">
                       <div className="group bg-black/5 dark:bg-white/5 p-6 rounded-[2.5rem] border border-black/5 dark:border-white/10 hover:border-primary-500/20 transition-all">
                          <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 ml-1">Your P2P Identity</label>
                          <p className="text-[10px] font-mono text-gray-600 dark:text-gray-300 break-all leading-relaxed opacity-80 group-hover:opacity-100 transition-opacity">
                             {p2pIdentity}
                          </p>
                       </div>
                       <button
                          onClick={handleUseMyNodeAsServer}
                          disabled={enablingPermanent}
                          className="w-full py-5 rounded-[2rem] border-2 border-primary-500 text-primary-500 font-black text-xs uppercase tracking-widest hover:bg-primary-500 hover:text-white shadow-xl shadow-primary-500/10 transition-all active:scale-95 disabled:opacity-50"
                       >
                          Register This Node as Hub
                       </button>
                    </div>
                 ) : (
                    <div className="flex items-center justify-center p-12">
                       <RefreshCw className="text-gray-400 animate-spin" size={32} />
                    </div>
                 )}
              </div>
           )}
        </section>
      </div>
    </div>
  );
}
