import { useNavigate, createLazyFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  getDiscoveredListings,
  getUsersWithStatus,
  DiscoveredListing,
  UserWithStatus,
} from "../services/discovery.service";
import { Search, Globe, Info, RefreshCw, X, Filter } from "lucide-react";
import { channelService } from "../services/channel.service";
import { groupService } from "../services/group.service";

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
  const [totalFound, setTotalFound] = useState(0);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showOffline, setShowOffline] = useState(true); // Show offline users by default
  const [viewMode, setViewMode] = useState<
    "all" | "users" | "groups" | "channels"
  >("users");

  useEffect(() => {
    // Initial load
    loadData();

    // FAST POLLING: Check frequently during the first few seconds
    const t1 = setTimeout(loadData, 2000);
    const t2 = setTimeout(loadData, 5000);
    const t3 = setTimeout(loadData, 10000);

    // Regular refresh every 10 seconds (was 30s) - More responsive for P2P
    const intervalId = setInterval(loadData, 10000);

    // React immediately to Gossip events from Frontend
    const handleDiscoveryUpdate = () => {
      console.log("⚡ [UI] Discovery update event received! Reloading data...");
      loadData();
    };
    window.addEventListener("DISCOVERY_UPDATE", handleDiscoveryUpdate);

    // Auto-refresh when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("👀 [UI] Tab visible, refreshing discovery...");
        loadData();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearInterval(intervalId);
      window.removeEventListener("DISCOVERY_UPDATE", handleDiscoveryUpdate);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Helper for timeouts
  const withTimeout = (promise: Promise<any>, ms: number = 5000) => {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), ms),
      ),
    ]);
  };

  const loadData = async () => {
    // setLoading(true) // Don't flicker loading on every refresh

    // 1. Load from cache immediately (Optimistic UI)
    const cached = localStorage.getItem("cached_discovery_users");
    const cachedListings = localStorage.getItem("cached_discovery_listings");
    let cachedUsersCount = 0;
    let cachedListingsCount = 0;
    if (cached && loading) {
      // Only load cache on initial load (when loading is true)
      try {
        const cachedUsers = JSON.parse(cached);
        if (Array.isArray(cachedUsers)) {
          setUsers(cachedUsers);
          cachedUsersCount = cachedUsers.length;
          // Don't set loading to false yet, let the fresh fetch attempt run
          // But if strict offline, maybe we should?
          // Let's just update state so user sees something.
          console.log("⚠️ [DISCOVERY] Loaded users from cache");
        }
      } catch (e) {
        console.warn("Error parsing cached discovery users", e);
      }
    }
    if (cachedListings && loading) {
      try {
        const parsedListings = JSON.parse(cachedListings);
        if (Array.isArray(parsedListings)) {
          setListings(parsedListings);
          cachedListingsCount = parsedListings.length;
        }
      } catch (e) {
        console.warn("Error parsing cached discovery listings", e);
      }
    }
    if (loading && (cachedUsersCount > 0 || cachedListingsCount > 0)) {
      setTotalFound(cachedUsersCount + cachedListingsCount);
    }

    try {
      console.log("🔄 [DISCOVERY] loadData triggering...");
      // Fetch users and listings with timeout
      const [fetchedUsers, fetchedListings] = await Promise.all([
        withTimeout(getUsersWithStatus(), 5000),
        withTimeout(getDiscoveredListings(), 5000),
      ]);

      console.log(`✅ [DISCOVERY] Received ${fetchedUsers.length} users.`);
      // fetchedUsers.forEach((u, i) => {
      //     console.log(`   [${i}] ${u.alias} - Online: ${u.is_online}`);
      // });

      setTotalFound(fetchedUsers.length + fetchedListings.length);
      const onlineCount = fetchedUsers.filter((u) => u.is_online).length;
      console.log(
        `📡 [DISCOVERY] Found ${fetchedUsers.length} users (${onlineCount} online)`,
      );

      // Show users immediately
      setUsers(fetchedUsers);
      setListings(fetchedListings);
      // setLoading(false)

      console.log(`⚡ [DISCOVERY] State updated.`);

      // Check if new users appeared
      if (previousCount > 0 && fetchedUsers.length > previousCount) {
        const newCount = fetchedUsers.length - previousCount;
        setNotificationMessage(
          `🎉 ${newCount} new user${newCount > 1 ? "s" : ""} found!`,
        );
        setShowNotification(true);
        setTimeout(() => setShowNotification(false), 3000);
      }
      setPreviousCount(fetchedUsers.length);

      // 3. Update cache
      localStorage.setItem(
        "cached_discovery_users",
        JSON.stringify(fetchedUsers),
      );
      localStorage.setItem(
        "cached_discovery_listings",
        JSON.stringify(fetchedListings),
      );
    } catch (e) {
      // Using cached variable from outer scope of loadData
      if (cached) {
        console.warn("⚠️ [DISCOVERY] Offline/Timeout - keeping cached data", e);
      } else {
        console.error("❌ [DISCOVERY] Error:", e);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleJoinListing = async (listing: DiscoveredListing) => {
    if (!listing.link) {
      alert("No join link available for this listing.");
      return;
    }
    try {
      if (listing.type === "group") {
        await groupService.sendJoinRequest(listing.link);
        alert("Join request sent.");
      } else {
        await channelService.joinViaInviteLink(listing.link);
        alert("Join request sent.");
      }
    } catch (err) {
      console.error("❌ [DISCOVERY] Join failed:", err);
      alert("Failed to join. Please try again.");
    }
  };

  const handleCopyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      alert("Join link copied.");
    } catch (err) {
      console.error("❌ [DISCOVERY] Copy failed:", err);
      alert("Failed to copy link.");
    }
  };

  // Filter Logic
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch =
        !searchQuery ||
        (user.alias &&
          user.alias.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (user.bio &&
          user.bio.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (user.address &&
          user.address.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCountry =
        !selectedCountry || user.country === selectedCountry;

      const matchesLanguage =
        !selectedLanguage ||
        (user.languages && user.languages.includes(selectedLanguage));

      const matchesOnlineStatus = showOffline || user.is_online; // Only filter if showOffline is false

      return (
        matchesSearch &&
        matchesCountry &&
        matchesLanguage &&
        matchesOnlineStatus
      );
    });
  }, [users, searchQuery, selectedCountry, selectedLanguage, showOffline]);

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => {
      if (!searchQuery) return true;
      const needle = searchQuery.toLowerCase();
      return (
        (listing.name && listing.name.toLowerCase().includes(needle)) ||
        (listing.description &&
          listing.description.toLowerCase().includes(needle)) ||
        (listing.owner_alias &&
          listing.owner_alias.toLowerCase().includes(needle))
      );
    });
  }, [listings, searchQuery]);

  // Unique Countries & Languages for Dropdowns
  const uniqueCountries = useMemo(() => {
    const countries = new Set(users.map((u) => u.country).filter(Boolean));
    return Array.from(countries).sort();
  }, [users]);

  const uniqueLanguages = useMemo(() => {
    const langs = new Set<string>();
    users.forEach((u) => {
      if (u.languages && Array.isArray(u.languages)) {
        u.languages.forEach((l) => langs.add(l));
      }
    });
    return Array.from(langs).sort();
  }, [users]);

  const filteredGroups = useMemo(
    () => filteredListings.filter((l) => l.type === "group"),
    [filteredListings],
  );
  const filteredChannels = useMemo(
    () => filteredListings.filter((l) => l.type === "channel"),
    [filteredListings],
  );

  const showUsers = viewMode === "all" || viewMode === "users";
  const showGroups = viewMode === "all" || viewMode === "groups";
  const showChannels = viewMode === "all" || viewMode === "channels";
  const visibleUserCount = showUsers ? filteredUsers.length : 0;
  const visibleGroupCount = showGroups ? filteredGroups.length : 0;
  const visibleChannelCount = showChannels ? filteredChannels.length : 0;
  const visibleTotal =
    visibleUserCount + visibleGroupCount + visibleChannelCount;

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 shadow-sm flex justify-between items-center sticky top-0 z-10 transition-colors">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Globe className="text-primary-600" />
            P2P Discovery
          </h1>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            loadData();
          }}
          className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-full transition-colors"
          title="Refresh List"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 shadow-sm space-y-3 transition-colors">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={18}
            />
            <input
              type="text"
              placeholder="Search users, groups, channels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            )}
          </div>
          {(viewMode === "all" || viewMode === "users") && (
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-lg border transition-colors flex items-center gap-2 px-3 ${showFilters ? "bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800 text-primary-600 dark:text-primary-400" : "bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"}`}
            >
              <Filter size={18} />
              <span className="hidden sm:inline text-sm font-medium">
                Filters
              </span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {(["users", "groups", "channels", "all"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                viewMode === mode
                  ? "bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {mode === "all"
                ? "All"
                : mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Expanded Filters */}
        {showFilters && (viewMode === "all" || viewMode === "users") && (
          <div className="flex flex-wrap gap-3 pt-2 animate-in slide-in-from-top-2 duration-200">
            {/* Country Filter */}
            <div className="flex-1 min-w-[150px]">
              <select
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700"
              >
                <option value="">All Discovered Countries</option>
                {uniqueCountries.map((c) => (
                  <option key={c} value={c as string}>
                    {c as string}
                  </option>
                ))}
              </select>
            </div>

            {/* Language Filter */}
            <div className="flex-1 min-w-[150px]">
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700"
              >
                <option value="">All Discovered Languages</option>
                {uniqueLanguages.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            {/* Show Offline Checkbox */}
            <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg">
              <input
                type="checkbox"
                id="showOffline"
                checked={showOffline}
                onChange={(e) => setShowOffline(e.target.checked)}
                className="w-4 h-4 text-primary-600 bg-gray-100 border-gray-300 rounded focus:ring-primary-500 focus:ring-2"
              />
              <label
                htmlFor="showOffline"
                className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none"
              >
                Show offline users
              </label>
            </div>

            {(selectedCountry || selectedLanguage || !showOffline) && (
              <button
                onClick={() => {
                  setSelectedCountry("");
                  setSelectedLanguage("");
                  setShowOffline(true);
                }}
                className="text-sm text-red-500 hover:text-red-700 font-medium px-2"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-6 py-2 bg-primary-50 dark:bg-primary-900/10 border-b border-primary-100 dark:border-primary-900/50 text-primary-700 dark:text-primary-400 text-xs flex items-center gap-2">
        <Info size={14} className="shrink-0" />
        <span>
          Discovery is decentralized. It may take up to 60 seconds for all peers
          to appear.
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading discovered items...</p>
            </div>
          </div>
        ) : visibleTotal === 0 ? (
          <div className="text-center py-20 px-4">
            <div className="bg-gray-100 dark:bg-gray-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="text-gray-400" size={32} />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              No results found
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mt-2">
              {searchQuery || selectedCountry || selectedLanguage
                ? "Try adjusting your search or filters."
                : "Be the first to join the community!"}
            </p>
            {(searchQuery || selectedCountry || selectedLanguage) && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCountry("");
                  setSelectedLanguage("");
                }}
                className="mt-4 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center transition-colors">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Showing{" "}
                <span className="font-bold text-primary-600 dark:text-primary-400">
                  {visibleTotal}
                </span>{" "}
                of <span className="font-medium">{totalFound}</span> items
              </p>
            </div>

            {showUsers && (
              <>
                <div className="px-6 pt-6 pb-2 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Users
                  </h2>
                  <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full">
                    {filteredUsers.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 px-6 pb-6">
                  {filteredUsers.map((user) => (
                    <div
                      key={user.publickey || user.user_id || Math.random()}
                      onClick={() => {
                        const targetAddress = user.publickey || user.user_id;
                        if (targetAddress) {
                          navigate({
                            to: "/contact-info/$address",
                            params: { address: targetAddress },
                            search: { returnTo: "/discovery" },
                          });
                        }
                      }}
                      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 hover:shadow-md transition-all cursor-pointer hover:border-primary-200 dark:hover:border-primary-700"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="relative">
                            {user.avatar &&
                            user.avatar.length > 10 &&
                            user.avatar !== "0x00" ? (
                              <img
                                src={user.avatar}
                                alt={user.alias}
                                className="w-12 h-12 rounded-full object-cover shadow-sm border border-gray-100"
                                onError={(e) =>
                                  ((
                                    e.target as HTMLImageElement
                                  ).style.display = "none")
                                }
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                                {(user.alias || "A").charAt(0).toUpperCase()}
                              </div>
                            )}
                            {user.is_online && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full"></div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-gray-900 dark:text-white truncate">
                              {user.alias || "Anonymous"}
                            </h3>
                            {user.country && (
                              <p className="text-xs text-primary-600 dark:text-primary-400 font-medium truncate mb-0.5">
                                {user.country}
                              </p>
                            )}
                            <p
                              className="text-xs text-gray-400 font-mono truncate"
                              title={user.publickey || user.user_id || ""}
                            >
                              {(user.publickey || user.user_id || "").substring(0, 4)}
                              ...
                              {(user.publickey || user.user_id || "").slice(-6)}
                            </p>
                          </div>
                        </div>
                      </div>

                      {user.bio && (
                        <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-2 mb-3">
                          {user.bio}
                        </p>
                      )}

                      {/* Languages Tag (if available) */}
                      {user.languages && user.languages.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {user.languages.slice(0, 2).map((lang, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200"
                            >
                              {lang}
                            </span>
                          ))}
                          {user.languages.length > 2 && (
                            <span className="text-[10px] bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600">
                              +{user.languages.length - 2}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center text-xs">
                        <span className="text-gray-500 dark:text-gray-400">
                          {(() => {
                            if (!user.last_updated) return "Unknown";
                            const now = Date.now();
                            const diff = now - Number(user.last_updated);
                            const minutes = Math.floor(diff / 60000);
                            const hours = Math.floor(diff / 3600000);
                            const days = Math.floor(diff / 86400000);

                            if (minutes < 1) return "Just now";
                            if (minutes < 60) return `${minutes}m ago`;
                            if (hours < 24) return `${hours}h ago`;
                            if (days < 7) return `${days}d ago`;
                            return new Date(
                              Number(user.last_updated),
                            ).toLocaleDateString();
                          })()}
                        </span>
                        {user.is_online ? (
                          <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                            Online
                          </span>
                        ) : (
                          <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full font-medium">
                            Offline
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {showGroups && (
              <>
                <div className="px-6 pt-2 pb-2 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Groups
                  </h2>
                  <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full">
                    {filteredGroups.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 px-6 pb-6">
                  {filteredGroups.map((listing) => (
                    <div
                      key={`${listing.owner_publickey}-${listing.id}`}
                      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-bold text-gray-900 dark:text-white truncate">
                            {listing.name}
                          </h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {listing.owner_alias
                              ? `by ${listing.owner_alias}`
                              : "Public group"}
                          </p>
                        </div>
                        <span className="text-[10px] uppercase tracking-wide font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 px-2 py-1 rounded-full">
                          Group
                        </span>
                      </div>
                      {listing.description ? (
                        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
                          {listing.description}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">
                          No description provided.
                        </p>
                      )}
                      <div className="flex gap-2">
                        {listing.link && (
                          <button
                            onClick={() => handleJoinListing(listing)}
                            className="px-3 py-1.5 text-xs font-semibold bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                          >
                            Join
                          </button>
                        )}
                        {listing.link && (
                          <button
                            onClick={() =>
                              handleCopyLink(listing.link as string)
                            }
                            className="px-3 py-1.5 text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                          >
                            Copy Link
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {showChannels && (
              <>
                <div className="px-6 pt-2 pb-2 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Channels
                  </h2>
                  <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full">
                    {filteredChannels.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 px-6 pb-10">
                  {filteredChannels.map((listing) => (
                    <div
                      key={`${listing.owner_publickey}-${listing.id}`}
                      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-bold text-gray-900 dark:text-white truncate">
                            {listing.name}
                          </h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {listing.owner_alias
                              ? `by ${listing.owner_alias}`
                              : "Public channel"}
                          </p>
                        </div>
                        <span className="text-[10px] uppercase tracking-wide font-semibold bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 px-2 py-1 rounded-full">
                          Channel
                        </span>
                      </div>
                      {listing.description ? (
                        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
                          {listing.description}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">
                          No description provided.
                        </p>
                      )}
                      <div className="flex gap-2">
                        {listing.link && (
                          <button
                            onClick={() => handleJoinListing(listing)}
                            className="px-3 py-1.5 text-xs font-semibold bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                          >
                            Join
                          </button>
                        )}
                        {listing.link && (
                          <button
                            onClick={() =>
                              handleCopyLink(listing.link as string)
                            }
                            className="px-3 py-1.5 text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                          >
                            Copy Link
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Toast Notification */}
      {showNotification && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-slide-up z-50">
          <span>{notificationMessage}</span>
        </div>
      )}
    </div>
  );
}
