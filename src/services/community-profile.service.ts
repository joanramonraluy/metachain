import { MDS } from '@minima-global/mds';

export interface ExtendedProfile {
    avatar?: string;           // Base64 image data or URL
    tags?: string[];          // Array of tags (e.g., ["developer", "crypto"])
    bioExtended?: string;     // Extended bio/description
    socialLinks?: {
        twitter?: string;
        github?: string;
        website?: string;
    };
    location?: string;
    lastUpdated?: number;
}

export interface CachedProfile extends ExtendedProfile {
    publickey: string;
    onlineStatus?: 'online' | 'offline' | 'unknown';
    lastPing?: number;
    lastPong?: number;
    fetchedAt?: number;
}

export const CommunityProfileService = {
    /**
     * Get the current user's extended profile
     */
    getMyProfile(): Promise<ExtendedProfile | null> {
        return new Promise((resolve) => {
            const sql = `SELECT * FROM MY_PROFILE WHERE id = 1`;

            MDS.sql(sql, (res: any) => {
                if (!res.status || !res.rows || res.rows.length === 0) {
                    resolve(null);
                    return;
                }

                const row = res.rows[0];
                const profile: ExtendedProfile = {
                    avatar: row.AVATAR,
                    tags: row.TAGS ? JSON.parse(row.TAGS) : [],
                    bioExtended: row.BIO_EXTENDED,
                    socialLinks: row.SOCIAL_LINKS ? JSON.parse(row.SOCIAL_LINKS) : {},
                    location: row.LOCATION,
                    lastUpdated: row.LAST_UPDATED ? Number(row.LAST_UPDATED) : undefined
                };

                resolve(profile);
            });
        });
    },

    /**
     * Update the current user's extended profile
     */
    updateMyProfile(profile: ExtendedProfile): Promise<void> {
        return new Promise((resolve, reject) => {
            const sql = `
                MERGE INTO MY_PROFILE (id, avatar, tags, bio_extended, social_links, location, last_updated)
                KEY (id)
                VALUES (
                    1,
                    '${profile.avatar || ''}',
                    '${JSON.stringify(profile.tags || [])}',
                    '${profile.bioExtended || ''}',
                    '${JSON.stringify(profile.socialLinks || {})}',
                    '${profile.location || ''}',
                    ${Date.now()}
                )
            `;

            MDS.sql(sql, (res: any) => {
                if (!res.status) {
                    console.error('❌ [CommunityProfile] Failed to update profile:', res.error);
                    reject(new Error(res.error));
                } else {
                    console.log('✅ [CommunityProfile] Profile updated successfully');
                    resolve();
                }
            });
        });
    },

    /**
     * Get a cached profile for a specific user
     */
    getCachedProfile(publickey: string): Promise<CachedProfile | null> {
        return new Promise((resolve) => {
            const sql = `SELECT * FROM PROFILE_CACHE WHERE publickey='${publickey}'`;

            MDS.sql(sql, (res: any) => {
                if (!res.status || !res.rows || res.rows.length === 0) {
                    resolve(null);
                    return;
                }

                const row = res.rows[0];
                const profile: CachedProfile = {
                    publickey: row.PUBLICKEY,
                    onlineStatus: row.ONLINE_STATUS as 'online' | 'offline' | 'unknown',
                    lastPing: row.LAST_PING ? Number(row.LAST_PING) : undefined,
                    lastPong: row.LAST_PONG ? Number(row.LAST_PONG) : undefined,
                    avatar: row.AVATAR,
                    tags: row.TAGS ? JSON.parse(row.TAGS) : [],
                    bioExtended: row.BIO_EXTENDED,
                    socialLinks: row.SOCIAL_LINKS ? JSON.parse(row.SOCIAL_LINKS) : {},
                    location: row.LOCATION,
                    fetchedAt: row.FETCHED_AT ? Number(row.FETCHED_AT) : undefined
                };

                resolve(profile);
            });
        });
    },

    /**
     * Cache a profile for a specific user
     */
    cacheProfile(publickey: string, profile: ExtendedProfile, onlineStatus?: 'online' | 'offline'): Promise<void> {
        return new Promise((resolve, reject) => {
            const now = Date.now();
            const sql = `
                MERGE INTO PROFILE_CACHE (
                    publickey, online_status, last_pong, avatar, tags, 
                    bio_extended, social_links, location, fetched_at
                )
                KEY (publickey)
                VALUES (
                    '${publickey}',
                    '${onlineStatus || 'unknown'}',
                    ${onlineStatus === 'online' ? now : 'NULL'},
                    '${profile.avatar || ''}',
                    '${JSON.stringify(profile.tags || [])}',
                    '${profile.bioExtended || ''}',
                    '${JSON.stringify(profile.socialLinks || {})}',
                    '${profile.location || ''}',
                    ${now}
                )
            `;

            MDS.sql(sql, (res: any) => {
                if (!res.status) {
                    console.error('❌ [CommunityProfile] Failed to cache profile:', res.error);
                    reject(new Error(res.error));
                } else {
                    console.log('✅ [CommunityProfile] Profile cached successfully');
                    resolve();
                }
            });
        });
    },

    /**
     * Update ping status for a user
     */
    updatePingStatus(publickey: string, status: 'online' | 'offline'): Promise<void> {
        return new Promise((resolve, reject) => {
            const now = Date.now();
            const sql = `
                MERGE INTO PROFILE_CACHE (publickey, online_status, last_ping, last_pong)
                KEY (publickey)
                VALUES (
                    '${publickey}',
                    '${status}',
                    ${now},
                    ${status === 'online' ? now : 'NULL'}
                )
            `;

            MDS.sql(sql, (res: any) => {
                if (!res.status) {
                    console.error('❌ [CommunityProfile] Failed to update ping status:', res.error);
                    reject(new Error(res.error));
                } else {
                    resolve();
                }
            });
        });
    },

    /**
     * Invalidate (delete) cached profile for a user
     */
    invalidateCache(publickey: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM PROFILE_CACHE WHERE publickey='${publickey}'`;

            MDS.sql(sql, (res: any) => {
                if (!res.status) {
                    console.error('❌ [CommunityProfile] Failed to invalidate cache:', res.error);
                    reject(new Error(res.error));
                } else {
                    console.log('✅ [CommunityProfile] Cache invalidated for:', publickey);
                    resolve();
                }
            });
        });
    },

    /**
     * Clear all cached profiles
     */
    clearAllCache(): Promise<void> {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM PROFILE_CACHE`;

            MDS.sql(sql, (res: any) => {
                if (!res.status) {
                    console.error('❌ [CommunityProfile] Failed to clear cache:', res.error);
                    reject(new Error(res.error));
                } else {
                    console.log('✅ [CommunityProfile] All cache cleared');
                    resolve();
                }
            });
        });
    }
};
