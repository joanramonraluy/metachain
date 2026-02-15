import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MDS } from "@minima-global/mds";
import { useAppContext } from "../../AppContext";
import { Globe, Info, Check, ChevronUp, ChevronDown, RefreshCw, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/settings/discovery")({
  component: DiscoverySettings,
});

function DiscoverySettings() {
  const { loaded } = useAppContext();

  const [discoveryInterval, setDiscoveryInterval] = useState(60);
  const [discoveryLimit, setDiscoveryLimit] = useState(5);
  const [staticMLSServer, setStaticMLSServer] = useState("");
  const [inputMLSServer, setInputMLSServer] = useState("");
  const [hasStaticMLS, setHasStaticMLS] = useState(false);
  const [p2pIdentity, setP2pIdentity] = useState("");
  const [expandedAddress, setExpandedAddress] = useState<string | null>('staticMLS');
  const [enablingPermanent, setEnablingPermanent] = useState(false);

  useEffect(() => {
    if (!loaded) return;

    const fetchDiscoverySettings = async () => {
      try {
        const intervalRes = await MDS.keypair.get('discovery_interval');
        const limitRes = await MDS.keypair.get('discovery_limit');
        if (intervalRes?.status && intervalRes.value) setDiscoveryInterval(parseInt(intervalRes.value) || 60);
        if (limitRes?.status && limitRes.value) setDiscoveryLimit(parseInt(limitRes.value) || 5);


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
            console.log("ℹ️ [Discovery] No Static MLS configured. Auto-connecting to Community Node...");
            // Auto-connect to Community Node
            const communityNode = "MxG18HGG6FJ038614Y8CW46US6G20810K0070CD00Z83282G60G1CZAEPFTCRYUNCPYTUMZ267P1W92V6RBK39NBWJNG9N5D3R58K4UA426QQGC8YBB2MJS3320QQ0NNCG7KPEU7BVKYSAD1HGRBNBE78R1W87C1TPG8NFHV5W0YMKV90CCC6AMMSP0KCB7GN5A1M6VJFT4T43K3E44DT50V0U9S4Q9FBRP3U19T70PKF3GU9B7G6857E2BBRJ5WK10608004DRUR4W@185.132.90.98:9001";
            try {
              // @ts-ignore
              await MDS.cmd.maxextra({ params: { action: "staticmls", host: communityNode } });
              setStaticMLSServer(communityNode); // Use hardcoded initially, will refresh on next load or manual refresh
              setHasStaticMLS(true);
              console.log("✅ [Discovery] Auto-connected to Community Node");
            } catch (autoErr) {
              console.warn("⚠️ [Discovery] Failed to auto-connect:", autoErr);
              setStaticMLSServer("");
              setHasStaticMLS(false);
            }
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
      const res = await MDS.cmd.maxextra({ params: { action: "staticmls", host: inputMLSServer.trim() } });
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
    const communityNode = "MxG18HGG6FJ038614Y8CW46US6G20810K0070CD00Z83282G60G1CZAEPFTCRYUNCPYTUMZ267P1W92V6RBK39NBWJNG9N5D3R58K4UA426QQGC8YBB2MJS3320QQ0NNCG7KPEU7BVKYSAD1HGRBNBE78R1W87C1TPG8NFHV5W0YMKV90CCC6AMMSP0KCB7GN5A1M6VJFT4T43K3E44DT50V0U9S4Q9FBRP3U19T70PKF3GU9B7G6857E2BBRJ5WK10608004DRUR4W@185.132.90.98:9001";
    try {
      // @ts-ignore
      const res = await MDS.cmd.maxextra({ params: { action: "staticmls", host: communityNode } });
      if (res.status) {
        setStaticMLSServer(communityNode);
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
      const res = await MDS.cmd.maxextra({ params: { action: "staticmls", host: p2pIdentity } });
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
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden transition-colors">
        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
          <Globe className="text-primary-500" />
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Community & Discovery</h2>
        </div>

        <div className="p-6 space-y-6">
          {/* Discovery Configuration */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Discovery Settings</h4>
              <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">Advanced</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Gossip Frequency (Seconds)</label>
                <div className="relative">
                  <input
                    type="number"
                    min="30"
                    step="10"
                    placeholder="60"
                    value={discoveryInterval}
                    onChange={(e) => setDiscoveryInterval(parseInt(e.target.value) || 0)}
                    id="discoveryIntervalInput"
                    className="w-full p-2 pl-3 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none"
                    onBlur={(e) => {
                      const val = parseInt(e.target.value) || 60;
                      const safeVal = val < 30 ? 30 : val;
                      setDiscoveryInterval(safeVal);
                      MDS.keypair.set('discovery_interval', String(safeVal));
                    }}
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <span className="text-gray-400 text-xs">sec</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">Minimum 30s. Lower = faster updates.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Gossip Peer Limit</label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="50"
                    placeholder="5"
                    value={discoveryLimit}
                    onChange={(e) => setDiscoveryLimit(parseInt(e.target.value) || 0)}
                    id="discoveryLimitInput"
                    className="w-full p-2 pl-3 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:outline-none"
                    onBlur={(e) => {
                      const val = parseInt(e.target.value) || 5;
                      const safeVal = val < 1 ? 1 : (val > 50 ? 50 : val);
                      setDiscoveryLimit(safeVal);
                      MDS.keypair.set('discovery_limit', String(safeVal));
                    }}
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <span className="text-gray-400 text-xs">nodes</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">Peers per gossip. Recommended: 5</p>
              </div>
            </div>
          </div>

          {/* CLIENT MODE: Connect to Network */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="text-primary-600 dark:text-primary-400" size={20} />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Client Mode</h3>
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Recommended</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              To be discoverable by other users and receive offline messages, you should register with an always-online Discovery Server (MLS).
            </p>

            {hasStaticMLS ? (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="text-green-600 dark:text-green-400" size={20} />
                  <span className="font-semibold text-green-800 dark:text-green-200">Connected to Discovery Network</span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 font-mono break-all mt-2">
                  {staticMLSServer}
                </p>
              </div>
            ) : (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  You are not currently connected to a Discovery Server.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <button
                onClick={handleUseCommunityNode}
                disabled={enablingPermanent}
                className="w-full bg-primary-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {enablingPermanent ? <RefreshCw size={16} className="animate-spin" /> : <Globe size={16} />}
                Use Recommended Community Node
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white dark:bg-gray-800 text-gray-500">Or enter custom address</span>
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Custom MAX#..."
                  value={inputMLSServer}
                  onChange={(e) => setInputMLSServer(e.target.value)}
                  className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                />
                <button
                  onClick={handleSetMLSServer}
                  disabled={enablingPermanent || !inputMLSServer.trim()}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition disabled:opacity-50"
                >
                  Set
                </button>
              </div>
            </div>
          </div>

          {/* SERVER MODE */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleAddress('serverMode')}
              className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <Info className="text-gray-500" />
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Server Mode (Advanced)</h3>
              </div>
              {expandedAddress === 'serverMode' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
            </button>

            {expandedAddress === 'serverMode' && (
              <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3 rounded mb-4">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium flex items-center gap-2">
                    <AlertTriangle size={16} /> Only for Always-On Devices
                  </p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                    Do NOT use this on a mobile device. Only use if this node is running on a VPS or server with a public IP.
                  </p>
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                  If this node is a server, you can configure it to act as its own Discovery Service.
                </p>

                {p2pIdentity ? (
                  <>
                    <div className="bg-gray-100 dark:bg-gray-900 rounded p-3 mb-3">
                      <p className="text-xs text-gray-500 mb-1 font-semibold">This Node's P2P Identity:</p>
                      <p className="text-xs font-mono text-gray-800 dark:text-gray-200 break-all">{p2pIdentity}</p>
                    </div>

                    <button
                      onClick={handleUseMyNodeAsServer}
                      disabled={enablingPermanent}
                      className="w-full border border-primary-600 text-primary-600 dark:text-primary-400 py-2 px-4 rounded-lg font-medium hover:bg-primary-50 dark:hover:bg-primary-900/20 transition disabled:opacity-50"
                    >
                      Use This Node as Discovery Server
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">Loading identity...</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
