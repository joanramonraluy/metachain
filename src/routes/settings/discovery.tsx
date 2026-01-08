import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MDS } from "@minima-global/mds";
import { useAppContext } from "../../AppContext";
import { Globe, Info, Copy, Check, ChevronUp, ChevronDown, RefreshCw, AlertTriangle } from "lucide-react";

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

  const [copiedField, setCopiedField] = useState<string | null>(null);
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
        const maximaInfo = await MDS.cmd.maxima({ params: { action: "info" } });
        // @ts-ignore
        if (maximaInfo.status && maximaInfo.response) {
          // @ts-ignore
          const pubkey = maximaInfo.response.publickey;
          // @ts-ignore
          const address = maximaInfo.response.contact;
          // @ts-ignore
          const checkRes = await MDS.cmd.maxima({ params: { action: "check" } });

          // @ts-ignore
          if (checkRes.status && checkRes.response && checkRes.response.connected) {
            // Construct Identity String for others to use
            setP2pIdentity(`${address}`);
          }
        }

        // Fetch MLS
        // @ts-ignore
        const mlsRes = await MDS.cmd.maxima({ params: { action: "getmls" } });
        // @ts-ignore
        if (mlsRes.status && mlsRes.response && mlsRes.response.value) {
          // @ts-ignore
          setStaticMLSServer(mlsRes.response.value);
          setHasStaticMLS(true);
        } else {
          setStaticMLSServer("");
          setHasStaticMLS(false);
        }

      } catch (err) {
        console.error("Error fetching discovery settings:", err);
      }
    };

    fetchDiscoverySettings();
  }, [loaded]);

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const toggleAddress = (id: string) => {
    setExpandedAddress(expandedAddress === id ? null : id);
  };

  const handleSetMLSServer = async () => {
    if (!inputMLSServer.trim()) return;
    setEnablingPermanent(true);
    try {
      // @ts-ignore
      const res = await MDS.cmd.maxima({ params: { action: "setmls", host: inputMLSServer.trim() } });
      if (res.status) {
        setStaticMLSServer(inputMLSServer.trim());
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

  const handleForceReRegister = async () => {
    setEnablingPermanent(true);
    try {
      // Just re-set the existing one to force logic if needed, or clear and set
      // For now, implementing simple re-set
      // @ts-ignore
      const res = await MDS.cmd.maxima({ params: { action: "setmls", host: staticMLSServer } });
      if (res.status) {
        console.log("Forced re-register success");
      }
    } catch (e) { console.error(e); }
    finally { setEnablingPermanent(false); }
  }


  return (
    <div className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
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

          {/* Use This Node as MLS */}
          <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800/50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Info className="text-primary-600 dark:text-primary-400" size={20} />
              <h3 className="text-lg font-semibold text-primary-900 dark:text-primary-100">Use This Node as MLS Server</h3>
            </div>
            <p className="text-sm text-primary-800 dark:text-primary-200 mb-3">
              For development/testing, other nodes can use this node as their Static MLS server.
            </p>

            {p2pIdentity ? (
              <>
                <div className="bg-white dark:bg-gray-900 rounded border border-primary-200 dark:border-primary-800 p-3 mb-3">
                  <p className="text-xs text-primary-600 dark:text-primary-400 mb-1 font-semibold">Your P2P Identity:</p>
                  <p className="text-xs font-mono text-gray-800 dark:text-gray-200 break-all">{p2pIdentity}</p>
                </div>
                <button
                  onClick={() => copyToClipboard(p2pIdentity, 'p2p')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copiedField === 'p2p' ? 'bg-green-100 text-green-700' : 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-900/60 border border-primary-300 dark:border-primary-700'}`}
                >
                  {copiedField === 'p2p' ? <Check size={16} /> : <Copy size={16} />}
                  {copiedField === 'p2p' ? 'Copied!' : 'Copy P2P Identity'}
                </button>
              </>
            ) : (
              <p className="text-sm text-primary-700">Loading P2P identity...</p>
            )}
          </div>

          {/* Static MLS Configuration */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleAddress('staticMLS')}
              className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Static MLS Server</h3>
                {hasStaticMLS && <Check className="text-green-500" size={20} />}
              </div>
              {expandedAddress === 'staticMLS' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
            </button>

            {expandedAddress === 'staticMLS' && (
              <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                  Configure a permanent Maxima Lookup Service to enable a permanent MAX# address for P2P Discovery.
                </p>

                {hasStaticMLS ? (
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Check className="text-green-600 dark:text-green-400" size={20} />
                      <span className="font-semibold text-green-800 dark:text-green-200">Static MLS Configured</span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-300 font-mono break-all mt-2">
                      {staticMLSServer}
                    </p>
                    <div className="mt-2 pt-2 border-t border-green-200 dark:border-green-800">
                      <button
                        onClick={handleForceReRegister}
                        disabled={enablingPermanent}
                        className="text-xs flex items-center gap-2 text-green-700 dark:text-green-300 hover:text-green-800 dark:hover:text-green-200 underline"
                      >
                        {enablingPermanent ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        Force Re-register Permanent Address
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="text-yellow-600 dark:text-yellow-400" size={20} />
                        <span className="font-semibold text-yellow-800 dark:text-yellow-200">Static MLS Not Configured</span>
                      </div>
                      <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-2">
                        Enter your Static MLS server address below to enable P2P Discovery.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <input
                        type="text"
                        placeholder="MAX#..."
                        value={inputMLSServer}
                        onChange={(e) => setInputMLSServer(e.target.value)}
                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                      <button
                        onClick={handleSetMLSServer}
                        disabled={enablingPermanent || !inputMLSServer.trim()}
                        className="w-full bg-primary-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {enablingPermanent && <RefreshCw size={16} className="animate-spin" />}
                        Set Static MLS Server
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
