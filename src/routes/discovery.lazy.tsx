import { useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  getDiscoveredListings,
  getUsersWithStatus,
  DiscoveredListing,
  UserWithStatus,
} from "../services/discovery.service";
import { Search, RefreshCw, Filter, ChevronRight, Users as UsersIcon, User, Radio, Copy, Check, LayoutGrid, Plus, ArrowRight, ExternalLink, Shield } from "lucide-react";
import { channelService } from "../services/channel.service";
import { groupService } from "../services/group.service";
import { shortenAddress } from "../utils/hex";

export const Route = createLazyFileRoute("/discovery")({
  component: DiscoveryPage,
});

function DiscoveryPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserWithStatus[]>([]);
  const [listings, setListings] = useState<DiscoveredListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [previousCount, setPreviousCount] = useState(0);
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [toastError, setToastError] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showOffline, setShowOffline] = useState(true);
  const [viewMode, setViewMode] = useState<"all" | "users" | "groups" | "channels">("all");
  const [isEnteringManualAddress, setIsEnteringManualAddress] = useState(false);
  const [manualAddress, setManualAddress] = useState("");

  useEffect(() => {
    loadData();
    const t1 = setTimeout(loadData, 2000);
    const t2 = setTimeout(loadData, 5000);
    const intervalId = setInterval(loadData, 10000);

    const handleDiscoveryUpdate = () => loadData();
    window.addEventListener("DISCOVERY_UPDATE", handleDiscoveryUpdate);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") loadData();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(intervalId);
      window.removeEventListener("DISCOVERY_UPDATE", handleDiscoveryUpdate);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const withTimeout = (promise: Promise<any>, ms: number = 5000) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Request timed out")), ms)),
    ]);
  };

  const loadData = async () => {
    const cached = localStorage.getItem("cached_discovery_users");
    const cachedListings = localStorage.getItem("cached_discovery_listings");
    
    if (cached && loading) {
      try {
        const cachedUsers = JSON.parse(cached);
        if (Array.isArray(cachedUsers)) setUsers(cachedUsers);
      } catch (e) {}
    }
    if (cachedListings && loading) {
      try {
        const parsedListings = JSON.parse(cachedListings);
        if (Array.isArray(parsedListings)) setListings(parsedListings);
      } catch (e) {}
    }

    try {
      const [fetchedUsers, fetchedListings] = await Promise.all([
        withTimeout(getUsersWithStatus(), 5000),
        withTimeout(getDiscoveredListings(), 5000),
      ]);

      setUsers(fetchedUsers);
      setListings(fetchedListings);

      if (previousCount > 0 && fetchedUsers.length > previousCount) {
        const newCount = fetchedUsers.length - previousCount;
        showToast(`🎉 ${newCount} new user${newCount > 1 ? "s" : ""} found!`);
      }
      setPreviousCount(fetchedUsers.length);
      localStorage.setItem("cached_discovery_users", JSON.stringify(fetchedUsers));
      localStorage.setItem("cached_discovery_listings", JSON.stringify(fetchedListings));
    } catch (e) {
      console.warn("⚠️ [DISCOVERY] Fetch failed, using cache", e);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, isError = false) => {
    setToastError(isError);
    setNotificationMessage(message);
    setShowNotification(true);
    setTimeout(() => setShowNotification(false), 3000);
  };

  const handleJoinListing = async (listing: DiscoveredListing) => {
    if (!listing.link) return;
    try {
      if (listing.type === "group") {
        await groupService.sendJoinRequest(listing.link);
        showToast("Join request sent.");
      } else {
        await channelService.joinViaInviteLink(listing.link);
        showToast("Joined channel.");
      }
    } catch (err) {
      showToast("Failed to join. Please try again.", true);
    }
  };

  const handleCopyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      showToast("Join link copied.");
    } catch (err) {
      showToast("Failed to copy link.", true);
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch = !searchQuery || 
        (user.alias && user.alias.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (user.bio && user.bio.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (user.address && user.address.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCountry = !selectedCountry || user.country === selectedCountry;
      const matchesLanguage = !selectedLanguage || (user.languages && user.languages.includes(selectedLanguage));
      const matchesOnlineStatus = showOffline || user.is_online;
      return matchesSearch && matchesCountry && matchesLanguage && matchesOnlineStatus;
    });
  }, [users, searchQuery, selectedCountry, selectedLanguage, showOffline]);

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => {
      if (!searchQuery) return true;
      const needle = searchQuery.toLowerCase();
      return (listing.name && listing.name.toLowerCase().includes(needle)) ||
             (listing.description && listing.description.toLowerCase().includes(needle)) ||
             (listing.owner_alias && listing.owner_alias.toLowerCase().includes(needle));
    });
  }, [listings, searchQuery]);

  const uniqueCountries = useMemo(() => {
    const countries = new Set(users.map((u) => u.country).filter(Boolean));
    return Array.from(countries).sort();
  }, [users]);

  const uniqueLanguages = useMemo(() => {
    const langs = new Set<string>();
    users.forEach((u) => { if (u.languages) u.languages.forEach((l) => langs.add(l)); });
    return Array.from(langs).sort();
  }, [users]);

  const filteredGroups = useMemo(() => filteredListings.filter((l) => l.type === "group"), [filteredListings]);
  const filteredChannels = useMemo(() => filteredListings.filter((l) => l.type === "channel"), [filteredListings]);

  const showUsers = viewMode === "all" || viewMode === "users";
  const showGroups = viewMode === "all" || viewMode === "groups";
  const showChannels = viewMode === "all" || viewMode === "channels";
  const visibleTotal = (showUsers ? filteredUsers.length : 0) + (showGroups ? filteredGroups.length : 0) + (showChannels ? filteredChannels.length : 0);

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 transition-colors relative overflow-hidden">
      {/* Dot Grid Background (consistent with Elite System) */}
      <div className="absolute inset-0 z-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        ></div>
      </div>

      {/* Background Blobs (consistent with Elite System) */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-white via-gray-50 to-blue-50/30 dark:from-gray-950 dark:via-gray-950 dark:to-primary-950/20"></div>

        <div
          className="absolute -top-[10%] -left-[10%] w-[60%] h-[60%] rounded-full opacity-40 dark:opacity-20 blur-[120px] animate-pulse"
          style={{
            background: "radial-gradient(circle, var(--color-primary-900) 0%, transparent 70%)",
            animationDuration: "8s",
          }}
        ></div>
        <div
          className="absolute -bottom-[10%] -right-[10%] w-[50%] h-[50%] rounded-full opacity-30 dark:opacity-10 blur-[120px] animate-pulse"
          style={{
            background: "radial-gradient(circle, var(--color-primary-800) 0%, transparent 70%)",
            animationDuration: "12s",
            animationDelay: "2s",
          }}
        ></div>
      </div>

      {/* LAYER 1: Primary Navigation - Elite Centered Sticky Tabs */}
      <nav className="sticky top-0 z-40 w-full flex items-center justify-center border-b border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-3xl overflow-x-auto no-scrollbar scrollbar-hide px-3 sm:px-6">
        <div className="flex items-center gap-1 sm:gap-6">
          {(["all", "users", "groups", "channels"] as const).map((mode) => {
            const isActive = viewMode === mode;
            const config = {
              all: { icon: LayoutGrid, label: "All", color: "indigo" },
              users: { icon: User, label: "Users", color: "primary" },
              groups: { icon: UsersIcon, label: "Groups", color: "emerald" },
              channels: { icon: Radio, label: "Channels", color: "sky" },
            }[mode];
            
            const Icon = config.icon;
            const colors = {
              indigo: "text-indigo-500 bg-indigo-500 shadow-indigo-500/50",
              primary: "text-primary-500 bg-primary-500 shadow-primary-500/50",
              emerald: "text-emerald-500 bg-emerald-500 shadow-emerald-500/50",
              sky: "text-sky-500 bg-sky-500 shadow-sky-500/50",
            }[config.color] || "text-primary-500 bg-primary-500 shadow-primary-500/50";

            const colorClass = colors.split(" ")[0];
            const bgClass = colors.split(" ")[1];
            const glowClass = colors.split(" ")[2];

            return (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`relative px-4 py-4 sm:py-5 flex items-center gap-2.5 transition-all duration-300 group flex-shrink-0 ${
                  isActive ? colorClass : "text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                <div className={`transition-all duration-500 ${isActive ? "scale-110" : "group-hover:scale-110"}`}>
                  <Icon size={16} strokeWidth={isActive ? 3 : 2.5} />
                </div>
                <span className="hidden sm:inline text-[11px] font-black tracking-widest uppercase">
                  {config.label}
                </span>

                {/* Underline Indicator */}
                {isActive && (
                  <div className={`absolute bottom-0 left-0 right-0 h-1 rounded-full ${bgClass} shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${glowClass} animate-in fade-in zoom-in duration-500`} />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* LAYER 2: Utility Row & Advanced Filters */}
      <section className="flex-shrink-0 border-b border-black/5 dark:border-white/5 bg-white/20 dark:bg-black/10 backdrop-blur-md">
        <div className="max-w-[2000px] mx-auto p-4 sm:p-6 space-y-6">
          {/* Main Action Row */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Search Bar - Elite Style */}
            <div className="relative group flex-1 w-full">
              <div className="absolute inset-x-0 -bottom-2 h-10 bg-black/10 dark:bg-white/5 blur-2xl rounded-full opacity-0 group-focus-within:opacity-100 transition-opacity"></div>
              <div className="relative flex items-center bg-white/40 dark:bg-white/5 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-[1.5rem] px-5 h-14 shadow-lg group-focus-within:shadow-2xl group-focus-within:border-primary-500/30 transition-all">
                <Search size={18} className="text-gray-400 mr-4" />
                <input
                  type="text"
                  placeholder="Search community..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 font-bold text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto justify-end">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`p-3.5 rounded-2xl transition-all shadow-xl ${
                  showFilters 
                    ? "bg-primary-500 text-white shadow-primary-500/30 ring-4 ring-primary-500/10" 
                    : "bg-white/40 dark:bg-white/5 backdrop-blur-md text-gray-500 dark:text-gray-400 border border-white/20 dark:border-white/10 hover:bg-white/60 dark:hover:bg-white/10"
                }`}
                title="Filters"
              >
                <Filter size={18} strokeWidth={3} />
              </button>
              
              <button
                onClick={() => { setLoading(true); loadData(); }}
                className="p-3.5 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur-md text-gray-500 dark:text-gray-400 border border-white/20 dark:border-white/10 hover:bg-primary-500 hover:text-white hover:border-primary-500 transition-all shadow-xl active:rotate-180 duration-500"
                title="Refresh Discoveries"
              >
                <RefreshCw size={18} strokeWidth={3} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {/* Quick Info & Manual Trigger */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-1">
             <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 text-center sm:text-left">
               Not finding who you're looking for?
             </p>
             <button 
               onClick={() => setIsEnteringManualAddress(!isEnteringManualAddress)}
               className={`w-full sm:w-auto px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-sm ${
                 isEnteringManualAddress 
                   ? 'bg-rose-500 text-white shadow-rose-500/20' 
                   : 'bg-primary-500/10 text-primary-600 dark:text-primary-400 hover:bg-primary-500 hover:text-white shadow-primary-500/5'
               }`}
             >
                {isEnteringManualAddress ? "Cancel Connection" : "Connect via address"}
                <div className="relative">
                   <Plus size={12} strokeWidth={3} />
                   {!isEnteringManualAddress && <div className="absolute inset-0 bg-current rounded-full animate-ping opacity-20"></div>}
                </div>
             </button>
          </div>

          {/* Manual Connection Card */}
          {isEnteringManualAddress && (
            <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 p-6 rounded-[2.5rem] shadow-lg shadow-black/5 animate-in slide-in-from-top-2 duration-300">
               <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1 relative group">
                     <ExternalLink size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-primary-500/50 group-focus-within:text-primary-500 transition-colors" />
                     <input
                        autoFocus
                        type="text"
                        placeholder="Paste Maxima Address (Mx...)"
                        value={manualAddress}
                        onChange={(e) => setManualAddress(e.target.value)}
                        className="w-full pl-12 pr-4 py-3.5 bg-black/5 dark:bg-white/5 border border-transparent focus:border-primary-500/30 rounded-2xl focus:outline-none transition-all text-[13px] font-mono dark:text-white placeholder:text-gray-400"
                     />
                  </div>
                  <button
                    disabled={!manualAddress.startsWith('Mx')}
                    onClick={() => navigate({ to: "/contact-info/$address", params: { address: manualAddress }, search: { returnTo: "/discovery" } })}
                    className="px-8 py-3.5 bg-primary-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-primary-500/20 disabled:opacity-30 disabled:grayscale"
                  >
                    Connect Peer
                    <ArrowRight size={16} strokeWidth={3} />
                  </button>
               </div>
            </div>
          )}

          {/* Filters Panel */}
          {showFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
              <select
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                className="w-full px-4 py-3 bg-black/5 dark:bg-white/5 border border-white/10 rounded-2xl text-[13px] font-black uppercase tracking-wider dark:text-white outline-none cursor-pointer hover:bg-black/10 transition-colors"
              >
                <option value="">All Regions</option>
                {uniqueCountries.map((c) => <option key={String(c)} value={String(c)}>{String(c)}</option>)}
              </select>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="w-full px-4 py-3 bg-black/5 dark:bg-white/5 border border-white/10 rounded-2xl text-[13px] font-black uppercase tracking-wider dark:text-white outline-none cursor-pointer hover:bg-black/10 transition-colors"
              >
                <option value="">All Languages</option>
                {uniqueLanguages.map((l) => <option key={String(l)} value={String(l)}>{String(l)}</option>)}
              </select>
              <div className="flex items-center gap-3 px-4 py-3 bg-black/5 dark:bg-white/5 rounded-2xl border border-transparent">
                <input
                  type="checkbox"
                  id="showOffline"
                  checked={showOffline}
                  onChange={(e) => setShowOffline(e.target.checked)}
                  className="w-5 h-5 rounded-lg border-gray-300 dark:border-gray-700 text-primary-500 focus:ring-primary-500/20"
                />
                <label htmlFor="showOffline" className="text-[11px] font-black uppercase tracking-widest text-gray-400 cursor-pointer select-none">
                  Online Only
                </label>
              </div>
              <button 
                onClick={() => { setSelectedCountry(""); setSelectedLanguage(""); setShowOffline(true); }}
                className="w-full px-4 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-rose-500 hover:bg-rose-500/10 rounded-2xl transition-all"
              >
                Reset Filters
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 scrollbar-hide no-scrollbar pb-24">
        <div className="max-w-[2000px] mx-auto space-y-10">
          
          {loading && !visibleTotal ? (
            <div className="flex flex-col items-center justify-center h-[40vh] space-y-4">
              <div className="w-12 h-12 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin"></div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Gossiping Beacons...</p>
            </div>
          ) : (
            <div className="animate-in fade-in duration-700">
              {/* SINGLE COLUMN VERTICAL STACK */}
              {(showUsers || showGroups || showChannels) && (
                <div className="flex flex-col gap-12">
                  {/* Users Section */}
                  {showUsers && (
                    <section className="space-y-6">
                      <div className="flex items-center gap-4 bg-primary-500/5 dark:bg-primary-500/10 p-4 rounded-[1.5rem] border border-primary-500/10">
                        <User className="text-primary-500" size={20} strokeWidth={3} />
                        <h2 className="text-sm font-black text-primary-500 uppercase tracking-[0.2em]">Community Users ({filteredUsers.length})</h2>
                        <div className="flex-1 h-px bg-primary-500/10"></div>
                      </div>
                      <div className="space-y-3">
                        {filteredUsers.map((user, idx) => (
                           <CompactUserRow 
                             key={user.publickey || user.user_id || `u-${idx}`} 
                             user={user} 
                             onClick={() => {
                               const addr = user.publickey || user.user_id;
                               if (addr) navigate({ to: "/contact-info/$address", params: { address: addr }, search: { returnTo: "/discovery" } });
                             }}
                           />
                        ))}
                        {filteredUsers.length === 0 && (
                          <div className="py-12 flex flex-col items-center justify-center bg-white/40 dark:bg-white/5 rounded-[2.5rem] border border-dashed border-white/20">
                            <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">No users discovered yet</p>
                          </div>
                        )}
                      </div>
                    </section>
                  )}
                  {(showGroups || showChannels) && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                      {/* Groups Section */}
                      {showGroups && (
                        <section className="space-y-6">
                          <div className="flex items-center gap-4 bg-emerald-500/5 dark:bg-emerald-500/10 p-4 rounded-[1.5rem] border border-emerald-500/10">
                            <UsersIcon className="text-emerald-500" size={20} strokeWidth={3} />
                            <h2 className="text-sm font-black text-emerald-500 uppercase tracking-[0.2em]">Public Groups ({filteredGroups.length})</h2>
                            <div className="flex-1 h-px bg-emerald-500/10"></div>
                          </div>
                          
                          <div className="space-y-3">
                            {filteredGroups.map((l) => (
                              <CompactListingRow key={l.id} listing={l} color="emerald" onJoin={handleJoinListing} onCopy={handleCopyLink} />
                            ))}
                            {filteredGroups.length === 0 && (
                              <div className="py-12 flex flex-col items-center justify-center bg-white/40 dark:bg-white/5 rounded-[2.5rem] border border-dashed border-white/20">
                                <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">No public groups found</p>
                              </div>
                            )}
                          </div>
                        </section>
                      )}

                      {/* Channels Section */}
                      {showChannels && (
                        <section className="space-y-6">
                          <div className="flex items-center gap-4 bg-sky-500/5 dark:bg-sky-500/10 p-4 rounded-[1.5rem] border border-sky-500/10">
                            <Radio className="text-sky-500" size={20} strokeWidth={3} />
                            <h2 className="text-sm font-black text-sky-500 uppercase tracking-[0.2em]">Broadcast Channels ({filteredChannels.length})</h2>
                            <div className="flex-1 h-px bg-sky-500/10"></div>
                          </div>

                          <div className="space-y-3">
                            {filteredChannels.map((l) => (
                              <CompactListingRow key={l.id} listing={l} color="sky" onJoin={handleJoinListing} onCopy={handleCopyLink} />
                            ))}
                            {filteredChannels.length === 0 && (
                              <div className="py-12 flex flex-col items-center justify-center bg-white/40 dark:bg-white/5 rounded-[2.5rem] border border-dashed border-white/20">
                                <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">No broadcast channels found</p>
                              </div>
                            )}
                          </div>
                        </section>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Compact Toast */}
      {showNotification && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 ${toastError ? "bg-rose-600 shadow-rose-900/20" : "bg-gray-900 dark:bg-white text-white dark:text-black shadow-lg"} px-6 py-2.5 rounded-full z-50 flex items-center gap-2 animate-in slide-in-from-bottom-5`}>
          <span className="text-[10px] font-black uppercase tracking-widest">{notificationMessage}</span>
        </div>
      )}
    </div>
  );
}

function CompactUserRow({ user, onClick }: { user: UserWithStatus, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className="group relative transition-all duration-500 animate-in fade-in slide-in-from-bottom-4 rounded-[2.5rem] bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 shadow-lg shadow-black/5 hover:scale-[1.01] active:scale-95 hover:shadow-2xl hover:z-20 p-5 flex items-center gap-5 cursor-pointer overflow-hidden"
    >
       {/* Resource Count Badge (Top Right) */}
       {user.resource_count && user.resource_count > 0 && (
          <div className="absolute top-4 right-6 flex items-center gap-1.5 px-3 py-1 bg-primary-500/10 dark:bg-primary-500/20 rounded-full border border-primary-500/10">
             <Radio size={10} className="text-primary-500 animate-pulse" />
             <span className="text-[9px] font-black text-primary-600 dark:text-primary-400 uppercase tracking-widest">
                {user.resource_count} {user.resource_count === 1 ? 'Resource' : 'Resources'}
             </span>
          </div>
       )}

       {/* Avatar Section */}
       <div className="relative flex-shrink-0">
          <div className="relative">
             {user.avatar && user.avatar.length > 10 ? (
               <img src={user.avatar} className="w-14 h-14 rounded-2xl object-cover bg-gray-200 dark:bg-gray-700 shadow-inner group-hover:scale-105 transition-transform duration-500" />
             ) : (
               <div className={`w-14 h-14 rounded-2xl bg-primary-500/10 text-primary-600 flex items-center justify-center font-black text-xl border border-white/20 dark:border-white/10 shadow-inner group-hover:scale-105 transition-transform duration-500`}>
                 {(user.alias || "A").charAt(0).toUpperCase()}
               </div>
             )}
             <div className={`absolute -bottom-1 -right-1 w-4.5 h-4.5 rounded-full border-2 border-white dark:border-gray-900 ${user.is_online ? "bg-emerald-500 shadow-glow shadow-emerald-500/50 animate-pulse" : "bg-gray-300"}`}></div>
          </div>
       </div>

       {/* Content Section */}
       <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mb-1.5">
             <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-gray-900 dark:text-white truncate tracking-tight group-hover:text-primary-500 transition-colors uppercase">
                  {user.alias || "Nomad User"}
                </h3>
                {user.minimaaddress && (
                   <div title="Minima Layer 3 Address Active" className="flex items-center justify-center w-5 h-5 rounded-lg bg-emerald-500/10 text-emerald-600 shadow-sm border border-emerald-500/10">
                      <Shield size={10} strokeWidth={3} />
                   </div>
                )}
             </div>

             <div className="flex items-center gap-2">
                <span className="text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest font-mono bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-lg">
                   {shortenAddress(user.publickey)}
                </span>
                {user.country && (
                   <span className="text-[9px] font-black uppercase text-primary-500 tracking-widest px-2 py-0.5 bg-primary-500/5 rounded-lg border border-primary-500/10">
                      {user.country}
                   </span>
                )}
             </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 font-bold truncate opacity-70 mb-2">
             {user.bio || "Decentralized MetaChain Member"}
          </p>

          {/* Languages Section */}
          {user.languages && user.languages.length > 0 && (
             <div className="flex flex-wrap gap-1.5 max-h-12 overflow-hidden">
                {user.languages.map((lang, idx) => (
                   <div 
                      key={`${lang}-${idx}`}
                      className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 bg-black/5 dark:bg-white/10 text-gray-400 dark:text-gray-500 rounded-md border border-black/5 dark:border-white/5"
                   >
                      {lang}
                   </div>
                ))}
             </div>
          )}
       </div>

       <div className="flex items-center text-primary-500 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0 ml-4">
          <ChevronRight size={18} strokeWidth={3} />
       </div>

       {/* Sub-indicator for Source */}
       {user.source === "P2P" && (
          <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none opacity-10">
             <div className="absolute top-2 right-2 transform rotate-45">
                <Radio size={48} className="text-primary-500" />
             </div>
          </div>
       )}
    </div>
  );
}

function CompactListingRow({ listing, color, onJoin, onCopy }: { listing: DiscoveredListing, color: string, onJoin: any, onCopy: any }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="group relative transition-all duration-500 animate-in fade-in slide-in-from-bottom-4 rounded-[2.5rem] bg-white/70 dark:bg-gray-900/40 backdrop-blur-md border border-white/20 dark:border-white/5 shadow-lg shadow-black/5 hover:scale-[1.02] active:scale-95 hover:shadow-2xl hover:z-20 p-5 flex items-center gap-5">
       <div className={`w-12 h-12 rounded-2xl ${color === 'emerald' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-sky-500/10 text-sky-600'} flex items-center justify-center flex-shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-500`}>
          {listing.type === 'group' ? <UsersIcon size={22} strokeWidth={2.5} /> : <Radio size={22} strokeWidth={2.5} />}
       </div>

       <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
             <h3 className="text-base font-black text-gray-900 dark:text-white truncate tracking-tight group-hover:text-primary-500 transition-colors">{listing.name}</h3>
             <div className="h-4 w-px bg-black/5 dark:bg-white/10 hidden sm:block"></div>
             <span className="text-[10px] font-black uppercase text-gray-400 truncate tracking-widest hidden sm:block">
                by {listing.owner_alias || "MetaChain"}
             </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">
             {listing.description || "Public decentralized resource."}
          </p>
       </div>

       <div className="flex items-center gap-2 pl-4 border-l border-black/5 dark:border-white/10">
          <button
            onClick={() => onJoin(listing)}
            className="px-6 py-2 bg-gradient-to-br from-primary-400 to-primary-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-primary-500/20 hover:scale-105 hover:shadow-primary-500/40 active:scale-95 flex-shrink-0"
          >
            Join
          </button>
          <button
            onClick={() => { onCopy(listing.link || ""); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="p-2.5 rounded-xl bg-black/5 dark:bg-white/5 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-white/10 transition-all shadow-sm active:scale-90"
            title="Copy Join Link"
          >
            {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
          </button>
       </div>
    </div>
  );
}
