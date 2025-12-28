import { MDS } from '@minima-global/mds';

/* --------------------------------------------------------------------------
   UTILITY FUNCTIONS
   -------------------------------------------------------------------------- */

export const utf8ToHex = (str: string): string => {
    return '0x' + Array.from(str)
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('');
};

export const hexToUtf8 = (hex: string): string => {
    const cleanHex = hex.startsWith('0x') ? hex.substring(2) : hex;
    const bytes = cleanHex.match(/.{1,2}/g) || [];
    return bytes.map(byte => String.fromCharCode(parseInt(byte, 16))).join('');
};

export const runSQL = (sql: string): Promise<any> => {
    return new Promise((resolve) => {
        MDS.sql(sql, (res: any) => {
            resolve(res);
        });
    });
};

/* --------------------------------------------------------------------------
   P2P DISCOVERY FUNCTIONS
   -------------------------------------------------------------------------- */

// Layer 1: Get P2P discovered peers (ephemeral, TTL 1 hour)
export const getDiscoveredPeers = async (): Promise<DiscoveredPeer[]> => {
    const sql = "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC";
    const result = await MDS.sql(sql);
    return result.rows || [];
};

// Layer 2: Get stable user registry (persistent, no TTL)
export const getMetachainUsers = async (): Promise<MetachainUser[]> => {
    const sql = "SELECT * FROM METACHAIN_USERS ORDER BY last_updated DESC";
    const result = await MDS.sql(sql);
    return result.rows || [];
};

// Combined: Get users with online/offline status
export const getUsersWithStatus = async (): Promise<UserWithStatus[]> => {
    // Fetch both layers and merge in JS to ensure full visibility
    const registrySql = "SELECT * FROM METACHAIN_USERS";
    const discoveredSql = "SELECT * FROM DISCOVERED_PEERS";

    // Use runSQL helper to ensure Promise behavior
    const [registryRes, discoveredRes] = await Promise.all([
        runSQL(registrySql),
        runSQL(discoveredSql)
    ]);

    const registryUsers: MetachainUser[] = registryRes.rows || [];
    const discoveredPeers: DiscoveredPeer[] = discoveredRes.rows || [];

    console.log(`🔍 [Discovery] DB Status - Registry: ${registryUsers.length}, Discovered: ${discoveredPeers.length}`);

    // Log detailed peer data (H2 returns uppercase column names)
    if (discoveredPeers.length > 0) {
        console.log('🔍 [Discovery] Raw discovered peers from DB:', discoveredRes.rows);
        console.log('🔍 [Discovery] Discovered Peers Details:', discoveredPeers.map(p => ({
            alias: (p as any).ALIAS || p.alias,
            publickey: ((p as any).PUBLICKEY || p.publickey)?.substring(0, 20) + '...',
            source: (p as any).SOURCE || p.source
        })));
    }

    const userMap = new Map<string, UserWithStatus>();

    // 1. Add Registry Users (Base)
    registryUsers.forEach(user => {
        // H2 returns uppercase column names
        const userId = (user as any).USER_ID || user.user_id;
        const publickey = (user as any).PUBLICKEY || user.publickey;
        const alias = (user as any).ALIAS || user.alias;
        const address = (user as any).ADDRESS || user.address;
        const firstSeen = (user as any).FIRST_SEEN || user.first_seen;
        const lastUpdated = (user as any).LAST_UPDATED || user.last_updated;

        userMap.set(publickey, {
            user_id: userId,
            publickey: publickey,
            alias: alias,
            bio: undefined,
            address: address,
            first_seen: firstSeen,
            last_updated: lastUpdated,
            is_online: false // Default to offline until confirmed by discovery
        });
    });

    // 2. Add/Update with Discovered Peers (Online)
    discoveredPeers.forEach(peer => {
        // H2 returns uppercase column names
        const publickey = (peer as any).PUBLICKEY || peer.publickey;
        const alias = (peer as any).ALIAS || peer.alias;
        const bio = (peer as any).BIO || peer.bio;
        const address = (peer as any).ADDRESS || peer.address;
        const lastSeen = (peer as any).LAST_SEEN || peer.last_seen;
        const source = (peer as any).SOURCE || peer.source;

        const existing = userMap.get(publickey);
        if (existing) {
            // Update existing user with online status and latest address
            userMap.set(publickey, {
                ...existing,
                bio: bio, // Update bio from latest beacon
                address: address, // Prefer most recent address from beacon
                is_online: true,
                source: source as 'P2P' | 'BOOTSTRAP',
                last_updated: Math.max(existing.last_updated, lastSeen)
            });
        } else {
            // Add new ephemeral peer not in registry yet
            userMap.set(publickey, {
                user_id: publickey,
                publickey: publickey,
                alias: alias,
                bio: bio,
                address: address,
                first_seen: lastSeen,
                last_updated: lastSeen,
                is_online: true,
                source: source as 'P2P' | 'BOOTSTRAP'
            });
        }
    });

    // Convert map to array and sort
    return Array.from(userMap.values()).sort((a, b) => {
        // Sort by Online status first, then recency
        if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
        return b.last_updated - a.last_updated;
    });
};

// Update local profile (for beacon generation)
export const updateLocalProfile = async (alias: string): Promise<void> => {
    await MDS.keypair.set('username', alias);
    console.log(`✅ [Discovery] Local profile updated: ${alias}`);
};

// Register with Static MLS bootstrap server
export const registerWithBootstrap = async (): Promise<void> => {
    const maximaInfo = await MDS.cmd.maxima();
    const staticMLS = maximaInfo.response.mls;

    if (!staticMLS || !maximaInfo.response.staticmls) {
        throw new Error("Static MLS not configured");
    }

    const publickey = maximaInfo.response.publickey;
    const address = maximaInfo.response.contact;
    const alias = await MDS.keypair.get('username') || 'Anonymous';

    const msgData = {
        app: "metachain",
        type: "register",
        pubkey: publickey,
        address,
        alias
    };

    const cmd = `maxima action:send to:${staticMLS} application:metachain data:${JSON.stringify(msgData)}`;
    await MDS.executeRaw(cmd);
    console.log(`✅ [Discovery] Registered with bootstrap server`);
};

// Request peers from Static MLS bootstrap server
export const requestBootstrapPeers = async (): Promise<void> => {
    const maximaInfo = await MDS.cmd.maxima();
    const staticMLS = maximaInfo.response.mls;

    if (!staticMLS || !maximaInfo.response.staticmls) {
        throw new Error("Static MLS not configured");
    }

    const msgData = {
        app: "metachain",
        type: "get_peers"
    };

    const cmd = `maxima action:send to:${staticMLS} application:metachain data:${JSON.stringify(msgData)}`;
    await MDS.executeRaw(cmd);
    console.log(`✅ [Discovery] Requested peers from bootstrap`);
};

/* --------------------------------------------------------------------------
   TYPE DEFINITIONS FOR P2P DISCOVERY
   -------------------------------------------------------------------------- */

export interface DiscoveredPeer {
    publickey: string;
    alias: string;
    bio?: string;
    address: string;
    last_seen: number;
    source: 'P2P' | 'BOOTSTRAP';
}

export interface MetachainUser {
    user_id: string;
    publickey: string;
    alias: string;
    bio?: string;
    address: string;
    first_seen: number;
    last_updated: number;
}

export interface UserWithStatus extends MetachainUser {
    is_online: boolean;
    source?: 'P2P' | 'BOOTSTRAP';
}

/* --------------------------------------------------------------------------
   DISCOVERY SERVICE EXPORT
   -------------------------------------------------------------------------- */

export const DiscoveryService = {
    // Utility functions
    utf8ToHex,
    hexToUtf8,
    runSQL,

    // P2P Discovery functions
    getDiscoveredPeers,
    getMetachainUsers,
    getUsersWithStatus,
    updateLocalProfile,
    registerWithBootstrap,
    requestBootstrapPeers
};
