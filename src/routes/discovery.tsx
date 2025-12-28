import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getUsersWithStatus, UserWithStatus } from '../services/discovery.service'
import useBeaconSender from '../hooks/useBeaconSender'
import { Search, Globe } from 'lucide-react'

export const Route = createFileRoute('/discovery')({
    component: DiscoveryPage,
})

function DiscoveryPage() {
    // Start sending beacons
    useBeaconSender();

    const navigate = useNavigate()
    const [users, setUsers] = useState<UserWithStatus[]>([])
    const [loading, setLoading] = useState(true)
    const [previousCount, setPreviousCount] = useState(0)
    const [showNotification, setShowNotification] = useState(false)
    const [notificationMessage, setNotificationMessage] = useState('')
    const [totalFound, setTotalFound] = useState(0)

    useEffect(() => {
        loadData()

        // Refresh data every 30 seconds to show updated online/offline status
        const intervalId = setInterval(loadData, 30000)

        return () => clearInterval(intervalId)
    }, [])



    const loadData = async () => {
        setLoading(true)
        try {
            // Fetch users with online/offline status from two-layer system
            const fetchedUsers = await getUsersWithStatus()
            setTotalFound(fetchedUsers.length)
            const onlineCount = fetchedUsers.filter(u => u.is_online).length
            console.log(`📡 [Discovery] Found ${fetchedUsers.length} users (${onlineCount} online)`)

            // Show users immediately
            setUsers(fetchedUsers)
            setLoading(false)

            console.log(`⚡ [Discovery] Showing ${fetchedUsers.length} users`)

            // Check if new users appeared
            if (previousCount > 0 && fetchedUsers.length > previousCount) {
                const newCount = fetchedUsers.length - previousCount
                setNotificationMessage(`🎉 ${newCount} new user${newCount > 1 ? 's' : ''} found!`)
                setShowNotification(true)
                setTimeout(() => setShowNotification(false), 3000)
            }
            setPreviousCount(fetchedUsers.length)
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }



    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <Globe className="text-blue-600" />
                    P2P Discovery
                </h1>
                <p className="text-gray-500 text-sm mt-1">Find and connect with other MetaChain users</p>
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
