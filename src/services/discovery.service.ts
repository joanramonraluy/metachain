import { MDS } from '@minima-global/mds';
import { maximaDiscoveryService } from './maxima-discovery.service';

// The Registry Script: Simple ownership check.
// Only the owner (defined by Public Key in STATE(2)) can spend/update the profile.
export const REGISTRY_SCRIPT = 'RETURN SIGNEDBY(STATE(2)) /* v2_track */';

// We need a fixed address for the registry. 
// In a real deployment, we would calculate this once and hardcode it to ensure everyone uses the same one.
// For this implementation, we will dynamically derive it or use a known constant if possible.
// However, since 'newaddress' might track it in the wallet, we should be careful.
// A "clean" address that is just the hash of the script is what we want.
// For now, we will use a helper to get/ensure the address exists.

export interface UserProfile {
    username: string;
    pubkey: string;
    description: string;
    timestamp: number;
    lastSeen: number;
    isMyProfile: boolean;
    maxAddress?: string; // MAX# permanent address from STATE[4]
    visible?: boolean;   // Visibility flag from STATE[5]
    coinid?: string;     // UTXO reference
    extraData?: {        // Extended profile data from STATE[6]
        location?: string;
        website?: string;
        bio?: string;
    };
}

// Cache the registry address to avoid calling newscript multiple times
let cachedRegistryAddress: string | null = null;

// Marker for profile coins - versioned for future upgrades
const PROFILE_MARKER = 'CHARM_PROFILE_V1';

export const DiscoveryService = {
    utf8ToHex: (s: string): string => {
        const encoder = new TextEncoder();
        let r = "";
        for (const b of encoder.encode(s)) r += ("0" + b.toString(16)).slice(-2);
        return "0x" + r;
    },

    hexToUtf8: (s: string): string => {
        if (!s) return "";
        const hex = s.startsWith("0x") ? s.substring(2) : s;
        try {
            const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
            return new TextDecoder().decode(bytes);
        } catch (e) {
            console.error("Error decoding hex:", e);
            return s;
        }
    },

    // Get the Registry Address (and ensure it's tracked/imported if needed? 
    // Actually for a public registry we might just need the address string to search coins).
    getRegistryAddress: async (): Promise<string> => {
        // Return cached address if available
        if (cachedRegistryAddress) {
            return cachedRegistryAddress;
        }

        return new Promise((resolve, reject) => {
            const cmd = `newscript script:"${REGISTRY_SCRIPT}" trackall:true`;

            MDS.executeRaw(cmd, (res: any) => {
                if (res.status && res.response?.address) {
                    cachedRegistryAddress = res.response.address;
                    console.log(`🏛️ [Discovery] Registry Address (0x): ${res.response.address}`);
                    resolve(res.response.address);
                } else {
                    reject(res.error || "No address in response");
                }
            });
        });
    },

    updateL1Profile: async (username: string, description: string, visible: boolean = true) => {
        // Validate that user has Static MLS configured
        const maximaInfo = await new Promise<any>((resolve, reject) => {
            MDS.cmd.maxima((res: any) => {
                if (res.status) {
                    resolve(res.response);
                } else {
                    reject('Failed to get Maxima info');
                }
            });
        });

        if (!maximaInfo.staticmls) {
            throw new Error('Static MLS required. Please configure a Static MLS server before registering.');
        }

        // Get permanent MAX# address
        const myPubkey = maximaInfo.publickey;
        const staticMLS = maximaInfo.mls;
        const maxAddress = `MAX#${myPubkey}#${staticMLS}`;

        console.log('📍 [Discovery] Registering with MAX# address:', maxAddress);
        const address = await DiscoveryService.getRegistryAddress();

        // Get our public key using getaddress
        const pubkey = await new Promise<string>((resolve, reject) => {
            MDS.executeRaw('getaddress', (res: any) => {
                if (res.status && res.response?.publickey) {
                    resolve(res.response.publickey);
                } else {
                    reject('No public key found');
                }
            });
        });

        if (!pubkey || pubkey === 'undefined') {
            throw new Error("Invalid public key: " + pubkey);
        }

        // Encode data to HEX
        const markerHex = DiscoveryService.utf8ToHex(PROFILE_MARKER);
        const usernameHex = DiscoveryService.utf8ToHex(username);
        const descriptionHex = DiscoveryService.utf8ToHex(description);
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const timestampHex = DiscoveryService.utf8ToHex(timestamp);

        // Pubkey is already HEX (0x...)

        // Encode MAX# address and visibility
        const maxAddressHex = DiscoveryService.utf8ToHex(maxAddress);
        const visibleValue = visible ? '1' : '0';

        // Send transaction
        // STATE(0) = Username
        // STATE(1) = Description
        // STATE(2) = Public Key (Ownership)
        // STATE(3) = Timestamp (unix seconds)
        // STATE(4) = MAX# Permanent Address
        // STATE(5) = Visible (0 or 1)
        // STATE(6) = REMOVED (was Extra Data)
        // STATE(99) = "CHARM_PROFILE_V1" (Marker)
        const cmd = `send amount:0.01 address:${address} state:{"0":"${usernameHex}","1":"${descriptionHex}","2":"${pubkey}","3":"${timestampHex}","4":"${maxAddressHex}","5":"${visibleValue}","99":"${markerHex}"}`;

        // Send blockchain transaction
        await new Promise((resolve, reject) => {
            console.log(`📤 [Discovery] Sending registration transaction to ${address}...`);
            MDS.executeRaw(cmd, (res: any) => {
                console.log('📄 [Discovery] Send response:', JSON.stringify(res, null, 2));

                // Accept both status:true OR pending:true as success
                if (res.status || res.pending) {
                    resolve(res.response);
                } else {
                    reject(res.error || "Registration failed");
                }
            });
        });
    },

    updateExtendedProfile: async (extraData: UserProfile['extraData']) => {
        // Get current L1 profile to include core data in broadcast
        const profiles = await DiscoveryService.getProfiles();
        const myProfile = profiles.find(p => p.isMyProfile);

        if (!myProfile) {
            throw new Error('No L1 profile found. Please create an L1 profile first.');
        }

        const pubkey = myProfile.pubkey;
        const username = myProfile.username;

        // Save extended profile data to local DB
        if (extraData) {
            const location = extraData.location ? `'${extraData.location.replace(/'/g, "''")}'` : 'NULL';
            const website = extraData.website ? `'${extraData.website.replace(/'/g, "''")}'` : 'NULL';
            const bio = extraData.bio ? `'${extraData.bio.replace(/'/g, "''")}'` : 'NULL';

            const sql = `
                MERGE INTO PROFILES (pubkey, username, location, website, bio, last_seen)
                KEY (pubkey)
                VALUES ('${pubkey}', '${username.replace(/'/g, "''")}', ${location}, ${website}, ${bio}, ${Date.now()})
            `;

            await new Promise<void>((resolve) => {
                MDS.sql(sql, (res: any) => {
                    if (res.status) {
                        console.log("✅ [Discovery] Saved extended profile to local DB");
                    } else {
                        console.error("❌ [Discovery] Failed to save extended profile:", res.error);
                    }
                    resolve();
                });
            });
        }

        // Broadcast via Maxima for instant cross-node discovery
        try {
            await maximaDiscoveryService.broadcastProfile({
                username,
                pubkey,
                description: myProfile.description,
                timestamp: Math.floor(Date.now() / 1000),
                extraData // Include in broadcast
            });
        } catch (e) {
            console.warn('Maxima broadcast failed:', e);
        }
    },

    // Helper function to deduplicate profiles by Maxima Address (Identity + Host)
    deduplicateProfiles: (profiles: UserProfile[]): UserProfile[] => {
        // Sort by timestamp desc (newest first)
        profiles.sort((a, b) => b.timestamp - a.timestamp);

        // Keep only first (newest) per MaxAddress
        const seen = new Map<string, UserProfile>();
        for (const p of profiles) {
            // Use maxAddress as unique identifier if available (handles multi-device)
            // Fallback to pubkey, then username
            let key = p.maxAddress;
            if (!key) {
                key = p.pubkey ? p.pubkey : p.username.toLowerCase();
            }

            if (!seen.has(key)) {
                seen.set(key, p);
            }
        }

        return Array.from(seen.values());
    },

    getProfiles: async (): Promise<UserProfile[]> => {
        const address = await DiscoveryService.getRegistryAddress();
        if (!address) {
            return [];
        }

        const markerHex = DiscoveryService.utf8ToHex(PROFILE_MARKER);

        // Get our coin IDs to determine ownership


        // Get all our public keys to check ownership accurately
        const myPublicKeys = await new Promise<Set<string>>((resolve) => {
            MDS.cmd.keys((res: any) => {
                const keys = new Set<string>();
                if (res.status && res.response && Array.isArray(res.response.keys)) {
                    res.response.keys.forEach((k: any) => {
                        keys.add(k.publickey);
                    });
                } else {
                    console.warn("⚠️ [Discovery] Unexpected response from 'keys':", JSON.stringify(res.response, null, 2));
                }
                resolve(keys);
            });
        });

        // Fetch local extended profiles
        const localProfilesMap = await new Promise<Map<string, any>>((resolve) => {
            MDS.sql("SELECT * FROM PROFILES", (res: any) => {
                const map = new Map<string, any>();
                if (res.status && res.rows) {
                    res.rows.forEach((row: any) => {
                        map.set(row.PUBKEY, {
                            location: row.LOCATION,
                            website: row.WEBSITE,
                            bio: row.BIO
                        });
                    });
                }
                resolve(map);
            });
        });

        // Fetch current UTXOs at registry
        const currentProfiles = await new Promise<UserProfile[]>((resolve) => {
            const coinsCmd = `coins address:${address}`;
            console.log(`🔍 [Discovery] Fetching profiles from registry: ${address}`);

            MDS.executeRaw(coinsCmd, (res: any) => {
                if (!res.status) {
                    console.error('❌ [Discovery] Failed to fetch coins:', res.error);
                    resolve([]);
                    return;
                }

                const coins = res.response || [];
                console.log(`📦 [Discovery] Found ${coins.length} coins at registry address`);

                const profiles = coins
                    .filter((c: any) => {
                        const state99 = c.state?.find((s: any) => s.port === 99);
                        const state5 = c.state?.find((s: any) => s.port === 5);
                        const state2 = c.state?.find((s: any) => s.port === 2);

                        // Debug filtering
                        const marker = state99?.data;
                        const isProfileCoin = marker?.toUpperCase() === markerHex.toUpperCase();
                        const isVisible = state5?.data === '1' || state5?.data === '0x01';

                        // Check ownership
                        const profilePubkey = state2?.data || '';
                        const isMine = myPublicKeys.has(profilePubkey);

                        if (isProfileCoin && !isVisible && !isMine) {
                            console.log(`👻 [Discovery] Hidden profile found. Pubkey: ${profilePubkey.substring(0, 10)}..., State5: ${state5?.data}`);
                        }

                        // Return if it's a profile coin AND (it's visible OR it's mine)
                        return isProfileCoin && (isVisible || isMine);
                    })
                    .map((c: any) => {
                        const state0 = c.state.find((s: any) => s.port === 0);
                        const state1 = c.state.find((s: any) => s.port === 1);
                        const state2 = c.state.find((s: any) => s.port === 2);
                        const state3 = c.state.find((s: any) => s.port === 3);
                        const state4 = c.state.find((s: any) => s.port === 4);
                        const state5 = c.state.find((s: any) => s.port === 5);
                        // STATE 6 is no longer used for extraData

                        const timestampStr = state3 ? DiscoveryService.hexToUtf8(state3.data) : '0';
                        const timestamp = parseInt(timestampStr) || 0;

                        const profilePubkey = state2?.data || '';
                        // Check ownership by public key match
                        const isMine = myPublicKeys.has(profilePubkey);

                        // Merge with local extended data
                        const localData = localProfilesMap.get(profilePubkey);
                        const extraData = localData ? {
                            location: localData.location,
                            website: localData.website,
                            bio: localData.bio
                        } : undefined;

                        return {
                            username: state0 ? DiscoveryService.hexToUtf8(state0.data) : 'Unknown',
                            pubkey: profilePubkey,
                            description: state1 ? DiscoveryService.hexToUtf8(state1.data) : '',
                            maxAddress: state4 ? DiscoveryService.hexToUtf8(state4.data) : undefined,
                            visible: state5?.data === '1' || state5?.data === '0x01',
                            extraData,
                            timestamp,
                            lastSeen: c.created || 0,
                            isMyProfile: isMine,
                            coinid: c.coinid
                        };
                    });

                console.log(`✅ [Discovery] Parsed ${profiles.length} valid profiles from coins`);
                resolve(profiles);
            });
        });

        // Deduplicate by Public Key (keep newest)
        const uniqueProfiles = DiscoveryService.deduplicateProfiles(currentProfiles);

        return uniqueProfiles;
    },

    /**
     * Update profile visibility (requires spending and recreating the coin)
     */
    updateProfileVisibility: async (visible: boolean) => {
        // Get current profile
        const profiles = await DiscoveryService.getProfiles();
        const myProfile = profiles.find(p => p.isMyProfile);

        if (!myProfile || !myProfile.coinid) {
            throw new Error('No profile found to update');
        }

        // Re-register with new visibility
        await DiscoveryService.updateL1Profile(
            myProfile.username,
            myProfile.description,
            visible
        );

        console.log(`✅ [Discovery] Profile visibility updated to: ${visible}`);
    }
};
