import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { MDS } from '@minima-global/mds'
import { useEffect, useState } from 'react'
import { DiscoveryService, UserProfile } from '../services/discovery.service'
import { maximaDiscoveryService } from '../services/maxima-discovery.service'
import { UserPlus, Search, Globe, RefreshCw, Edit } from 'lucide-react'

export const Route = createFileRoute('/discovery')({
    component: DiscoveryPage,
})

function DiscoveryPage() {
    const navigate = useNavigate()
    const [profiles, setProfiles] = useState<UserProfile[]>([])
    const [loading, setLoading] = useState(true)
    const [previousCount, setPreviousCount] = useState(0)
    const [showNotification, setShowNotification] = useState(false)
    const [notificationMessage, setNotificationMessage] = useState('')
    const [totalFound, setTotalFound] = useState(0)
    const [checkingMLS, setCheckingMLS] = useState(false)
    const [hasStaticMLS, setHasStaticMLS] = useState(false)
    const [isRegistering, setIsRegistering] = useState(false)

    useEffect(() => {
        loadData()
        checkStaticMLSConfig() // Check MLS configuration on mount

        // Subscribe to Maxima profile broadcasts
        const unsubscribe = maximaDiscoveryService.subscribeToProfiles((newProfile) => {
            setProfiles(prev => {
                const updated = [...prev, newProfile];
                return DiscoveryService.deduplicateProfiles(updated) as UserProfile[];
            });

            // Show notification
            setNotificationMessage(`🎉 New profile discovered: ${newProfile.username}`);
            setShowNotification(true);
            setTimeout(() => setShowNotification(false), 3000);
        });

        return () => unsubscribe();
    }, [])

    const checkStaticMLSConfig = async () => {
        setCheckingMLS(true)
        try {
            const maximaInfo = await MDS.cmd.maxima()
            const info = (maximaInfo.response as any) || {}

            console.log('🔍 [Discovery] Checking Static MLS configuration:', info)

            const hasStatic = !!(info.staticmls && info.mls);
            setHasStaticMLS(hasStatic);

            if (hasStatic) {
                console.log('✅ [Discovery] Static MLS configured:', info.mls)
            } else {
                console.log('⚠️ [Discovery] Static MLS NOT configured')
            }
        } catch (err) {
            console.error('❌ [Discovery] Error checking Static MLS:', err)
        } finally {
            setCheckingMLS(false)
        }
    }

    const handleQuickRegister = async () => {
        setIsRegistering(true);
        try {
            const maximaInfo = await MDS.cmd.maxima();
            const publickey = (maximaInfo.response as any)?.publickey;
            const staticMLS = (maximaInfo.response as any)?.mls;

            if (!publickey || !staticMLS) throw new Error("Missing public key or MLS info");

            console.log(`📤 [Discovery] Sending registration request to MLS...`);
            const msgData = {
                type: "mls_register_permanent",
                publickey: publickey
            };

            const mkcmd = `maxima action:send to:${staticMLS} application:metachain data:${JSON.stringify(msgData)}`;
            await new Promise<any>((resolve, reject) => {
                MDS.executeRaw(mkcmd, (res: any) => {
                    if (res.status) resolve(res);
                    else reject(new Error(res.error || 'Failed to send registration'));
                });
            });

            setNotificationMessage("✅ Registration request sent! Please wait a moment.");
            setShowNotification(true);
            setTimeout(() => setShowNotification(false), 5000);

            // Reload data after a delay to check if it worked
            setTimeout(loadData, 3000);

        } catch (err) {
            console.error("❌ [Discovery] Registration failed:", err);
            alert("Registration failed: " + (err as Error).message);
        } finally {
            setIsRegistering(false);
        }
    };

    const loadData = async () => {
        setLoading(true)
        try {
            // Fetch all profiles from blockchain (only visible ones)
            const fetchedProfiles = await DiscoveryService.getProfiles()
            setTotalFound(fetchedProfiles.length)
            console.log(`📡 [Discovery] Found ${fetchedProfiles.length} profiles on blockchain`)

            // Show profiles immediately
            setProfiles(fetchedProfiles)
            setLoading(false)

            console.log(`⚡ [Discovery] Showing ${fetchedProfiles.length} profiles`)

            // Check if new profiles appeared
            if (previousCount > 0 && fetchedProfiles.length > previousCount) {
                const newCount = fetchedProfiles.length - previousCount
                setNotificationMessage(`🎉 ${newCount} new profile${newCount > 1 ? 's' : ''} found!`)
                setShowNotification(true)
                setTimeout(() => setShowNotification(false), 3000)
            }
            setPreviousCount(fetchedProfiles.length)
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }



    const isRegistered = profiles.some(p => p.isMyProfile)

    const handleEdit = () => {
        // Navigate to settings Community & Discovery section
        navigate({ to: '/settings' }).then(() => {
            window.location.hash = 'community-discovery'
        })
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-sm">
                <div className="flex items-center gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Globe className="text-blue-600" />
                            Community Discovery
                        </h1>
                        <p className="text-gray-500 text-sm mt-1">Find and connect with other MetaChain users</p>
                    </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors disabled:opacity-50"
                        title="Refresh profiles"
                    >
                        <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                    </button>

                    {!isRegistered ? (
                        <button
                            onClick={async () => {
                                // Re-check Static MLS configuration before opening modal
                                await checkStaticMLSConfig()

                                // If we have static MLS newly detected/confirmed
                                const maximaInfo = await MDS.cmd.maxima()
                                const info = (maximaInfo.response as any) || {}

                                if (!info.staticmls) {
                                    // Navigate to settings
                                    navigate({ to: '/settings' }).then(() => {
                                        window.location.hash = 'community-discovery'
                                    })
                                    return
                                }

                                // If Static MLS is configured, also navigate to Settings to register
                                navigate({ to: '/settings' }).then(() => {
                                    window.location.hash = 'community-discovery'
                                })
                            }}
                            disabled={checkingMLS}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-70 disabled:cursor-wait"
                        >
                            {checkingMLS ? (
                                <RefreshCw size={18} className="animate-spin" />
                            ) : (
                                <UserPlus size={18} />
                            )}
                            <span className="hidden sm:inline">{checkingMLS ? 'Checking...' : 'Join Community'}</span>
                            <span className="sm:hidden">{checkingMLS ? '...' : 'Join'}</span>
                        </button>
                    ) : (
                        <button
                            onClick={handleEdit}
                            className="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                        >
                            <Edit size={18} />
                            <span className="hidden sm:inline">Edit Profile</span>
                            <span className="sm:hidden">Edit</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Visibility Warning Banner */}
            {hasStaticMLS && !isRegistered && !loading && (
                <div className="bg-yellow-50 border-b border-yellow-200 px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in">
                    <div className="flex items-center gap-3">
                        <div className="bg-yellow-100 p-2 rounded-full">
                            <UserPlus size={18} className="text-yellow-700" />
                        </div>
                        <div>
                            <p className="text-yellow-800 font-medium">You are not visible in the community.</p>
                            <p className="text-yellow-600 text-sm">Static MLS is configured, but your profile is not registered.</p>
                        </div>
                    </div>
                    <button
                        onClick={handleQuickRegister}
                        disabled={isRegistering}
                        className="whitespace-nowrap bg-yellow-100 hover:bg-yellow-200 text-yellow-800 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        {isRegistering ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        Fix Visibility
                    </button>
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="text-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                            <p className="text-gray-600">Loading profiles from blockchain...</p>
                        </div>
                    </div>
                ) : profiles.length === 0 ? (
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
                            {profiles.map((profile) => (
                                <div
                                    key={profile.pubkey}
                                    onClick={() => {
                                        if (profile.isMyProfile) {
                                            // Navigate to settings for own profile
                                            navigate({ to: '/settings', hash: 'community-discovery' })
                                        } else {
                                            // Navigate to contact info page for other profiles
                                            navigate({ to: `/contact-info/${profile.pubkey}` })
                                        }
                                    }}
                                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow cursor-pointer"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="relative">
                                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
                                                    {profile.username.charAt(0).toUpperCase()}
                                                </div>
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-gray-900">{profile.username}</h3>
                                                <p className="text-xs text-gray-400 font-mono truncate w-32" title={profile.pubkey}>
                                                    {profile.pubkey.substring(0, 10)}...
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {profile.description && (
                                        <p className="mt-4 text-gray-600 text-sm line-clamp-2">
                                            {profile.description}
                                        </p>
                                    )}

                                    <div className="mt-4 pt-4 border-t border-gray-50 flex justify-between items-center text-xs text-gray-400">
                                        <span>Joined: {new Date(Number(profile.lastSeen) * 1000).toLocaleDateString()}</span>
                                        {profile.isMyProfile && (
                                            <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">You</span>
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
