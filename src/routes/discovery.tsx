import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getUsersWithStatus, UserWithStatus } from '../services/discovery.service'
import { Search, Globe, Info, RefreshCw } from 'lucide-react'


export const Route = createFileRoute('/discovery')({
    component: DiscoveryPage,
})

function DiscoveryPage() {
    const navigate = useNavigate()
    const [users, setUsers] = useState<UserWithStatus[]>([])
    const [loading, setLoading] = useState(true)
    const [previousCount, setPreviousCount] = useState(0)
    const [showNotification, setShowNotification] = useState(false)
    const [notificationMessage, setNotificationMessage] = useState('')
    const [totalFound, setTotalFound] = useState(0)

    useEffect(() => {
        // Initial load
        loadData()

        // FAST POLLING: Check frequently during the first few seconds
        const t1 = setTimeout(loadData, 2000);
        const t2 = setTimeout(loadData, 5000);
        const t3 = setTimeout(loadData, 10000);

        // Regular refresh every 10 seconds (was 30s) - More responsive for P2P
        const intervalId = setInterval(loadData, 10000)

        // React immediately to Gossip events from Frontend
        const handleDiscoveryUpdate = () => {
            console.log('⚡ [UI] Discovery update event received! Reloading data...');
            loadData();
        };
        window.addEventListener('DISCOVERY_UPDATE', handleDiscoveryUpdate);

        // Auto-refresh when tab becomes visible
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log('👀 [UI] Tab visible, refreshing discovery...');
                loadData();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
            clearInterval(intervalId);
            window.removeEventListener('DISCOVERY_UPDATE', handleDiscoveryUpdate);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        }
    }, [])



    const loadData = async () => {
        // setLoading(true) // Don't flicker loading on every refresh
        try {
            console.log("🔄 [DISCOVERY] loadData triggering...");
            // Fetch users with online/offline status from two-layer system
            const fetchedUsers = await getUsersWithStatus()

            console.log(`✅ [DISCOVERY] Received ${fetchedUsers.length} users.`);
            fetchedUsers.forEach((u, i) => {
                console.log(`   [${i}] ${u.alias} - Online: ${u.is_online}`);
            });

            setTotalFound(fetchedUsers.length)
            const onlineCount = fetchedUsers.filter(u => u.is_online).length
            console.log(`📡 [DISCOVERY] Found ${fetchedUsers.length} users (${onlineCount} online)`);

            // Show users immediately
            setUsers(fetchedUsers)
            // setLoading(false)

            console.log(`⚡ [DISCOVERY] State updated.`);

            // Check if new users appeared
            if (previousCount > 0 && fetchedUsers.length > previousCount) {
                const newCount = fetchedUsers.length - previousCount
                setNotificationMessage(`🎉 ${newCount} new user${newCount > 1 ? 's' : ''} found!`)
                setShowNotification(true)
                setTimeout(() => setShowNotification(false), 3000)
            }
            setPreviousCount(fetchedUsers.length)
        } catch (e) {
            console.error("❌ [DISCOVERY] Error:", e)
        } finally {
            setLoading(false)
        }
    }



    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Globe className="text-blue-600" />
                        P2P Discovery
                    </h1>
                </div>
                <button
                    onClick={() => { setLoading(true); loadData(); }}
                    className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                    title="Refresh List"
                >
                    <RefreshCw size={20} />
                </button>
            </div>
            <div className="px-6 pb-2 text-gray-500 text-sm border-b border-gray-200 bg-white">
                Find and connect with other MetaChain users
            </div>
            <div className="px-6 py-2 bg-blue-50 border-b border-blue-100 text-blue-700 text-xs flex items-center gap-2">
                <Info size={14} className="shrink-0" />
                <span>Discovery is decentralized. It may take up to 60 seconds for all peers to appear.</span>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="text-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                            <p className="text-gray-600">Loading discovered peers...</p>
                        </div>
                    </div>
                ) : users.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="bg-blue-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Search className="text-blue-400" size={32} />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900">No profiles found</h3>
                        <p className="text-gray-500 mt-2">Be the first to join the community!</p>
                    </div>
                ) : (
                    <>
                        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                            <p className="text-sm text-gray-600">
                                Showing <span className="font-bold text-blue-600">{totalFound}</span> {totalFound === 1 ? 'profile' : 'profiles'}
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
                            {users.map((user) => (
                                <div
                                    key={user.publickey || user.user_id || Math.random()}
                                    onClick={() => {
                                        if (false) {
                                            // Navigate to settings for own profile
                                            navigate({ to: '/settings', hash: 'community-discovery' })
                                        } else {
                                            // Navigate to contact info page for other profiles
                                            navigate({ to: `/contact-info/${user.publickey || user.user_id}` })
                                        }
                                    }}
                                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-all cursor-pointer hover:border-blue-200"
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-3 flex-1">
                                            <div className="relative">
                                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                                                    {(user.alias || 'A').charAt(0).toUpperCase()}
                                                </div>
                                                {user.is_online && (
                                                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full"></div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-bold text-gray-900 truncate">{user.alias || 'Anonymous'}</h3>
                                                <p className="text-xs text-gray-400 font-mono truncate" title={user.publickey || user.user_id || ''}>
                                                    {(user.publickey || user.user_id || '').substring(0, 12)}...
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {user.bio && (
                                        <p className="text-gray-600 text-sm line-clamp-2 mb-3">
                                            {user.bio}
                                        </p>
                                    )}

                                    <div className="pt-3 border-t border-gray-100 flex justify-between items-center text-xs">
                                        <span className="text-gray-500">
                                            {user.first_seen ? new Date(Number(user.first_seen)).toLocaleDateString() : 'Unknown'}
                                        </span>
                                        {user.is_online ? (
                                            <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">Online</span>
                                        ) : (
                                            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">Offline</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
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
    )
}
