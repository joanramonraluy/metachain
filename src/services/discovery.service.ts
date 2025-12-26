import { MDS } from '@minima-global/mds';


// The Registry Script: Uses a generic pattern matching Public Object Architecture.
// Filter Comment: /* METACHAIN_PROFILE */
// This allows fast filtering by address AND script content.
// Only the owner (defined by Public Key in STATE(2)) can spend/update the profile.
export const REGISTRY_SCRIPT = 'RETURN SIGNEDBY(STATE(2)) /* METACHAIN_PROFILE */';

/* --------------------------------------------------------------------------
   PUBLIC OBJECT CONSTANTS
   -------------------------------------------------------------------------- */
const STATE_INDEX_OWNER = 2; // Public Key
const STATE_INDEX_TIMESTAMP = 3;
const STATE_INDEX_STATIC_MLS = 4;
const STATE_INDEX_VISIBLE = 5;
const STATE_INDEX_MAXIMA_KEY = 6;
const STATE_INDEX_PROFILE_ID = 10; // New: Stable Identity ID
const STATE_INDEX_VERSION = 11;    // New: Sequence Number
const STATE_INDEX_PROFILE_HASH = 12; // New: Integrity Hash

const STATE_INDEX_TYPE = 98;
const STATE_INDEX_SCHEMA_VERSION = 99;


const TYPE_PROFILE = "METACHAIN_PROFILE";
const VERSION_1 = "1";

// We need a fixed address for the registry. 
// In a real deployment, we would calculate this once and hardcode it to ensure everyone uses the same one.
// For this implementation, we will dynamically derive it or use a known constant if possible.
// However, since 'newaddress' might track it in the wallet, we should be careful.
// A "clean" address that is just the hash of the script is what we want.
// For now, we will use a helper to get/ensure the address exists.

export interface UserProfile {
    // Identity
    profileId: string;   // Stable Identity ID
    pubkey: string;      // Current Owner Key (rotatable in theory, but currently bound)

    // Metadata
    version: number;     // Sequence number (higher is newer)
    updatedAt: number;   // Timestamp of update

    // Content
    username: string;
    description: string;

    // Discovery
    staticMLS?: string;  // Static MLS address from STATE[4]
    visible?: boolean;   // Visibility flag from STATE[5]
    maximaPublicKey?: string; // Maxima Public Key from STATE[6]

    // System
    coinid?: string;     // UTXO reference
    isMyProfile: boolean;
    lastSeen?: number;   // Timestamp when this profile was last seen/fetched

    extraData?: {        // Extended profile data from STATE[6]
        location?: string;
        website?: string;
        bio?: string;
    };
}

// Cache the registry address to avoid calling newscript multiple times
let cachedRegistryAddress: string | null = null;

// Marker for profile coins - versioned for future upgrades

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

    /**
     * Internal helper to run SQL and ignore errors (or log them)
     */
    runSQL: (sql: string): Promise<any> => {
        return new Promise((resolve) => {
            MDS.sql(sql, (res: any) => {
                resolve(res);
            });
        });
    },

    /**
     * Get or Generate the Stable Root Identity
     * This key is NEVER used for transactions, only for ID derivation.
     */
    getOrGenerateProfileId: async (): Promise<{ profileId: string, rootKey: string }> => {
        // 1. Ensure table exists
        await DiscoveryService.runSQL(`
            CREATE TABLE IF NOT EXISTS LOCAL_IDENTITY (
                id INT PRIMARY KEY, 
                root_public_key VARCHAR(255), 
                profile_id VARCHAR(255), 
                created_at BIGINT
            )
        `);

        // 2. Check if identity exists
        const res = await DiscoveryService.runSQL(`SELECT * FROM LOCAL_IDENTITY WHERE id = 1`);

        if (res.status && res.rows && res.rows.length > 0) {
            return {
                profileId: res.rows[0].PROFILE_ID,
                rootKey: res.rows[0].ROOT_PUBLIC_KEY
            };
        }

        console.log("🆔 [Discovery] Generating new Stable Root Identity...");

        // 3. Generate new key 
        // We use 'keys action:new' to generate a fresh key that is part of the wallet
        const keyRes: any = await new Promise((resolve) => MDS.executeRaw("keys action:new", (res) => resolve(res)));
        if (!keyRes.status || !keyRes.response || !keyRes.response.publickey) {
            throw new Error("Failed to generate root key");
        }

        const rootKey = keyRes.response.publickey;

        // 4. Derive Profile ID
        // As per plan and user request, we use the Root Key itself as the ID for uniqueness and simplicity.
        // It satisfies Identity = f(Key).
        const profileId = rootKey;

        // 5. Store permanently
        await DiscoveryService.runSQL(`
            INSERT INTO LOCAL_IDENTITY (id, root_public_key, profile_id, created_at)
            VALUES (1, '${rootKey}', '${profileId}', ${Date.now()})
        `);

        return { profileId, rootKey };
    },

    // Get the Registry Address
    getRegistryAddress: async (): Promise<string> => {
        // Return cached address if available
        if (cachedRegistryAddress) {
            return cachedRegistryAddress;
        }

        return new Promise((resolve, reject) => {
            const cmd = `newscript script:"${REGISTRY_SCRIPT}" trackall:true`;
            console.log("🛠️ [Discovery] Executing newscript (v0.0.6 - trackall:true for discovery):", cmd);


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

    /**
     * Unified Profile Update
     * Updates both L1 Blockchain Profile and Local/Maxima Extended Profile in one go.
     */
    updateProfile: async (
        username: string,
        description: string,
        visible: boolean,
        extraData?: UserProfile['extraData']
    ) => {
        // 1. Validate Static MLS
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

        const staticMLS = maximaInfo.mls;
        const maximaPublicKey = maximaInfo.publickey;

        // 2. Get/Generate Stable Identity
        const { profileId } = await DiscoveryService.getOrGenerateProfileId();

        // 3. Get Public Key (Ownership for this specific UTXO)
        // We use a fresh address/key for the coin itself, OR we can reuse one.
        // Reusing 'getaddress' key is fine for MVP.
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
            throw new Error("Invalid public key");
        }

        // 3. Prepare L1 Transaction
        const address = await DiscoveryService.getRegistryAddress();

        // Find existing profile to get next version
        const profiles = await DiscoveryService.getProfiles();
        const myExistingProfile = profiles.find(p => p.profileId === profileId);
        // Note: isMyProfile might not be enough if we just generated the ID, so matching by ID is safer if available
        // But for now, getProfiles logic will set isMyProfile based on KEY ownership. 
        // We should just look for the highest version for this profileId.

        const nextVersion = myExistingProfile ? (myExistingProfile.version + 1) : 1;

        // Encode data to HEX
        const usernameHex = DiscoveryService.utf8ToHex(username);
        const descriptionHex = DiscoveryService.utf8ToHex(description);
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const timestampHex = DiscoveryService.utf8ToHex(timestamp);
        const mlsHex = DiscoveryService.utf8ToHex(staticMLS);
        const visibleValue = visible ? '1' : '0';
        const maximaPubkeyHex = DiscoveryService.utf8ToHex(maximaPublicKey);

        const typeHex = DiscoveryService.utf8ToHex(TYPE_PROFILE);
        const versionHex = DiscoveryService.utf8ToHex(VERSION_1);

        const profileIdHex = DiscoveryService.utf8ToHex(profileId);
        const seqVersionHex = DiscoveryService.utf8ToHex(nextVersion.toString());
        // Simple hash of content for integrity (optional but good)
        const contentHash = username + description + timestamp; // Simplified
        const hashHex = DiscoveryService.utf8ToHex(contentHash);


        // Construct State Vars
        // STATE(0) = Username
        // STATE(1) = Description
        // STATE(2) = Public Key (Ownership)
        // STATE(3) = Timestamp (unix seconds)
        // STATE(4) = Static MLS (without @host:port)
        // STATE(5) = Visible (0 or 1)
        // STATE(6) = Maxima Public Key
        // STATE(10) = Profile ID (Stable)
        // STATE(11) = Version (Sequence)
        // STATE(12) = Hash
        // STATE(98) = TYPE: "METACHAIN_PROFILE"
        // STATE(99) = VERSION: "1"

        let cmd = `send amount:0.00000001 address:${address} state:{` +
            `"0":"${usernameHex}",` +
            `"1":"${descriptionHex}",` +
            `"2":"${pubkey}",` +
            `"3":"${timestampHex}",` +
            `"4":"${mlsHex}",` +
            `"5":"${visibleValue}",` +
            `"6":"${maximaPubkeyHex}",` +
            `"${STATE_INDEX_PROFILE_ID}":"${profileIdHex}",` +
            `"${STATE_INDEX_VERSION}":"${seqVersionHex}",` +
            `"${STATE_INDEX_PROFILE_HASH}":"${hashHex}",` +
            `"${STATE_INDEX_TYPE}":"${typeHex}",` +
            `"${STATE_INDEX_SCHEMA_VERSION}":"${versionHex}"` +
            `}`;

        // Note: Old profile coins will remain on the blockchain but will be filtered out by deduplication logic
        // This is acceptable as they don't consume significant resources and ensure atomicity isn't needed
        if (myExistingProfile && myExistingProfile.coinid) {
            console.log(`ℹ️ [Discovery] Previous profile found (Version ${myExistingProfile.version}). Will be superseded by new version.`);
        }
        // 4. Send L1 Transaction
        let txPoWID = "";
        const txnResult = await new Promise<any>((resolve, reject) => {
            console.log(`📤 [Discovery] Sending unified registration transaction (v${nextVersion})...`);

            // Timeout to prevent infinite hanging
            const timer = setTimeout(() => {
                console.error("❌ [Discovery] Transaction request timed out (10s)");
                reject("Transaction request timed out");
            }, 10000);

            MDS.executeRaw(cmd, (res: any) => {
                clearTimeout(timer);
                console.log("📥 [Discovery] Transaction Response:", JSON.stringify(res));

                if (res.status) {
                    console.log("✅ [Discovery] L1 Transaction sent successfully");
                    txPoWID = res.response ? res.response.txpowid : "";
                    resolve(res.response);
                } else if (res.pending) {
                    console.log("⏸️ [Discovery] Transaction pending approval (flag).");
                    resolve({ pending: true });
                } else if (res.error && (res.error.includes("pending") || res.error.includes("confirmed"))) {
                    // Catch explicit error strings that indicate pending state
                    console.log("⏸️ [Discovery] Transaction pending approval (error message).");
                    resolve({ pending: true });
                } else {
                    console.error("❌ [Discovery] L1 Transaction failed:", res.error);
                    reject(res.error || "Registration failed");
                }
            });
        });

        // 5. Check for Pending Status
        if (txnResult && txnResult.pending) {
            console.log("⏸️ [Discovery] Profile update is pending confirmation. Skipping propagation check.");
            return;
        }

        // 6. Transaction sent successfully
        console.log(`✅ [Discovery] Profile update transaction sent (v${nextVersion}). Transaction will propagate naturally.`);
        if (txPoWID) {
            console.log(`🔗 [Discovery] TxPoW ID: ${txPoWID}`);
        }

        // 7. Save Extended Data to SQL (if provided)
        if (extraData) {
            // We store extended data keyed by Profile ID now? 
            // The existing schema uses 'pubkey'. 
            // For backward compatibility and simplicity, we'll continue using 'pubkey' 
            // BUT we should really shift to profileId eventually.
            // For this task, we'll stick to 'pubkey' as the primary join key since L1 still has it in State 2.

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
    },


    // Helper function to deduplicate profiles by ProfileID
    deduplicateProfiles: (profiles: UserProfile[]): UserProfile[] => {
        // Group by ProfileID
        const seen = new Map<string, UserProfile>();

        for (const p of profiles) {
            if (!p.profileId) continue; // Skip malformed profiles

            const existing = seen.get(p.profileId);

            if (!existing) {
                seen.set(p.profileId, p);
            } else {
                // Keep the one with Higher Version
                if (p.version > existing.version) {
                    seen.set(p.profileId, p);
                } else if (p.version === existing.version) {
                    // Tie-break: Newest Timestamp
                    if (p.updatedAt > existing.updatedAt) {
                        seen.set(p.profileId, p);
                    }
                }
            }
        }

        return Array.from(seen.values());
    },

    getProfiles: async (_options: { sync?: boolean } = { sync: true }): Promise<UserProfile[]> => {
        const address = await DiscoveryService.getRegistryAddress();
        if (!address) {
            return [];
        }

        // Pre-calculate HEX values for filtering
        const typeHex = DiscoveryService.utf8ToHex(TYPE_PROFILE).toUpperCase();

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

        // Also get our Stable Profile ID if it exists
        const myIdentity = await DiscoveryService.getOrGenerateProfileId().catch(() => null);
        const myProfileId = myIdentity?.profileId;


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

                const rawProfiles: UserProfile[] = [];

                coins.forEach((c: any) => {
                    // 0. FILTER: Ignore spent coins (important for mempool updates)
                    if (c.spent) return;

                    // 1. FILTER: Check for Schema Type (State 98)
                    const state98 = c.state?.find((s: any) => s.port === STATE_INDEX_TYPE);
                    if (!state98 || state98.data.toUpperCase() !== typeHex) {
                        // console.log("Skipping coin (wrong type):", c.coinid);
                        return;
                    }

                    // 2. EXTRACT CORE DATA
                    // const state2 = c.state?.find((s: any) => s.port === STATE_INDEX_OWNER);
                    const state0 = c.state?.find((s: any) => s.port === 0);
                    const state1 = c.state?.find((s: any) => s.port === 1);
                    const state2 = c.state?.find((s: any) => s.port === STATE_INDEX_OWNER); // Pubkey
                    const state3 = c.state?.find((s: any) => s.port === STATE_INDEX_TIMESTAMP);
                    const state4 = c.state?.find((s: any) => s.port === STATE_INDEX_STATIC_MLS);
                    const state5 = c.state?.find((s: any) => s.port === STATE_INDEX_VISIBLE);
                    const state6 = c.state?.find((s: any) => s.port === STATE_INDEX_MAXIMA_KEY);

                    const state10 = c.state?.find((s: any) => s.port === STATE_INDEX_PROFILE_ID);
                    const state11 = c.state?.find((s: any) => s.port === STATE_INDEX_VERSION);

                    const ownerKey = state2?.data || '';
                    const profileId = state10 ? DiscoveryService.hexToUtf8(state10.data) : ownerKey; // Fallback to key if no ID

                    const timestampStr = state3 ? DiscoveryService.hexToUtf8(state3.data) : '0';
                    const timestamp = parseInt(timestampStr) || 0;

                    const versionStr = state11 ? DiscoveryService.hexToUtf8(state11.data) : '1';
                    const version = parseInt(versionStr) || 1;

                    const isVisible = state5?.data === '1' || state5?.data === '0x01';

                    // Is Mine? Check if I own the key OR if the profile ID matches my root ID
                    const isMine = myPublicKeys.has(ownerKey) || (myProfileId && profileId === myProfileId);

                    if (isVisible || isMine) {
                        // Merge with local extended data
                        const localData = localProfilesMap.get(ownerKey);
                        const extraData = localData ? {
                            location: localData.location,
                            website: localData.website,
                            bio: localData.bio
                        } : undefined;

                        const username = state0 ? DiscoveryService.hexToUtf8(state0.data) : 'Unknown';

                        console.log(`✅ [Discovery] Included Profile: ${username} (IsMine: ${isMine}, Visible: ${isVisible}, Version: ${version})`);

                        rawProfiles.push({
                            profileId: profileId,
                            pubkey: ownerKey,

                            version: version,
                            updatedAt: timestamp,

                            username: username,
                            description: state1 ? DiscoveryService.hexToUtf8(state1.data) : '',

                            staticMLS: state4 ? DiscoveryService.hexToUtf8(state4.data) : undefined,
                            visible: isVisible,
                            maximaPublicKey: state6 ? DiscoveryService.hexToUtf8(state6.data) : undefined,

                            coinid: c.coinid,
                            isMyProfile: !!isMine,

                            extraData
                        });
                    } else {
                        const username = state0 ? DiscoveryService.hexToUtf8(state0.data) : 'Unknown';
                        console.log(`🚫 [Discovery] Filtered out Profile: ${username} (IsMine: ${isMine}, Visible: ${isVisible}, Version: ${version})`);
                    }
                });

                resolve(rawProfiles);
            });
        });

        // Deduplicate Logic
        const uniqueProfiles = DiscoveryService.deduplicateProfiles(currentProfiles);

        // DEBUG LOG
        const myFinal = uniqueProfiles.find(p => p.isMyProfile);
        if (myFinal) {
            console.log(`✅ [Discovery] Selected final profile for Me: Version ${myFinal.version}, CoinID: ${myFinal.coinid}`);
        } else {
            console.log(`⚠️ [Discovery] No final profile selected for Me.`);
        }

        // Sort by recency
        uniqueProfiles.sort((a, b) => b.updatedAt - a.updatedAt);

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

        // Re-register with new visibility (and increment version automatically via updateProfile)
        // Pass existing data
        await DiscoveryService.updateProfile(
            myProfile.username,
            myProfile.description,
            visible,
            myProfile.extraData
        );

        console.log(`✅ [Discovery] Profile visibility updated to: ${visible}`);
    }
};

/**
 * Ensure coinnotify is set up for the profile registry
 * This is idempotent and safe to call multiple times
 * Should be called on app startup to handle dapp updates without node restart
 */
export const ensureCoinnotifySetup = async (): Promise<void> => {
    try {
        const registryAddress = await DiscoveryService.getRegistryAddress();

        console.log('[Discovery] Ensuring coinnotify setup for:', registryAddress);

        // Add coinnotify (idempotent - safe to call multiple times)
        const cmd = `coinnotify action:add address:${registryAddress}`;
        await new Promise<void>((resolve) => {
            MDS.executeRaw(cmd, (res: any) => {
                if (res.status) {
                    console.log('✅ [Discovery] coinnotify setup verified');
                    resolve();
                } else {
                    console.warn('⚠️ [Discovery] coinnotify setup warning:', res.error);
                    resolve(); // Don't reject - Service Worker might have it set up
                }
            });
        });
    } catch (error) {
        console.error('❌ [Discovery] Failed to setup coinnotify:', error);
        // Don't throw - this is not critical, Service Worker might have it set up
    }
};

