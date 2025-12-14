import { MDS } from '@minima-global/mds';
import { UserProfile } from './discovery.service';

const MAXIMA_TOPIC = 'metachain_profiles_v1';

export type MaximaMessageType = 'charm_profile_v1' | 'get_profiles' | 'profile_list';

export interface ProfileBroadcast {
    type: MaximaMessageType;
    username?: string;
    pubkey?: string;
    description?: string;
    timestamp?: number;
    extraData?: UserProfile['extraData'];
    profiles?: UserProfile[]; // For bulk response
    sig?: string;
    replyAddress?: string; // Address to reply to (Mx...)
}

type ProfileCallback = (profile: UserProfile) => void;

class MaximaDiscoveryService {
    private callbacks: Set<ProfileCallback> = new Set();
    private isSubscribed = false;

    /**
     * Broadcast a profile to all connected Maxima peers
     */
    async broadcastProfile(profile: Omit<UserProfile, 'lastSeen' | 'isMyProfile' | 'coinid'>): Promise<void> {
        // Create message payload
        const message: Omit<ProfileBroadcast, 'sig'> = {
            type: 'charm_profile_v1',
            username: profile.username,
            pubkey: profile.pubkey,
            description: profile.description,
            timestamp: profile.updatedAt, // Map updatedAt to timestamp for wire compatibility
            extraData: profile.extraData
        };

        // Sign the message
        const messageStr = JSON.stringify(message);
        const sig = await this.signMessage(messageStr);

        const signedMessage: ProfileBroadcast = {
            ...message,
            sig
        };

        // Publish to Maxima
        return new Promise((resolve, reject) => {
            const cmd = `maxima action:sendall application:${MAXIMA_TOPIC} data:${JSON.stringify(signedMessage)}`;

            MDS.executeRaw(cmd, (res: any) => {
                if (res.status) {
                    resolve();
                } else {
                    reject(res.error || 'Failed to broadcast profile');
                }
            });
        });
    }

    /**
     * Request all profiles from the Static MLS server
     */
    async requestProfiles(staticMLS: string): Promise<void> {
        console.log(`📡 [Sync] Requesting profiles from Static MLS: ${staticMLS}`);

        // Get our own Maxima address for the reply
        const myAddress = await new Promise<string>((resolve) => {
            MDS.cmd.maxima((res: any) => {
                if (res.status && res.response && res.response.contact) {
                    resolve(res.response.contact);
                } else {
                    resolve('');
                }
            });
        });

        const message: ProfileBroadcast = {
            type: 'get_profiles',
            replyAddress: myAddress
        };

        const cmd = `maxima action:send to:${staticMLS} application:${MAXIMA_TOPIC} data:${JSON.stringify(message)}`;

        return new Promise((resolve, reject) => {
            MDS.executeRaw(cmd, (res: any) => {
                if (res.status) {
                    console.log(`✅ [Sync] Request sent to ${staticMLS}`);
                    resolve();
                } else {
                    console.error(`❌ [Sync] Failed to send request: ${res.error}`);
                    reject(res.error || 'Failed to send profile request');
                }
            });
        });
    }

    /**
     * Subscribe to profile broadcasts from other nodes
     */
    subscribeToProfiles(callback: ProfileCallback): () => void {
        this.callbacks.add(callback);

        // Initialize Maxima subscription if not already done
        if (!this.isSubscribed) {
            this.initializeSubscription();
            this.isSubscribed = true;
        }

        // Return unsubscribe function
        return () => {
            this.callbacks.delete(callback);
        };
    }

    /**
     * Initialize Maxima message listener
     */
    private initializeSubscription(): void {
        // Listen for Maxima messages
        window.addEventListener('MDS_MAXIMA_EVENT', ((event: CustomEvent) => {
            const data = event.detail;

            // Check if it's our application
            if (data.application !== MAXIMA_TOPIC) {
                return;
            }

            try {
                let msgData = data.data;

                // Decode HEX if needed
                if (typeof msgData === 'string' && msgData.startsWith('0x')) {
                    const hex = msgData.substring(2);
                    const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((byte: string) => parseInt(byte, 16)) || []);
                    msgData = new TextDecoder().decode(bytes);
                }

                const message: ProfileBroadcast = JSON.parse(msgData);

                // 1. Handle Profile Broadcast (Single Profile)
                if (message.type === 'charm_profile_v1') {
                    // Verify signature
                    if (!this.verifySignature(message)) {
                        console.warn('Invalid signature for profile broadcast');
                        return;
                    }

                    if (!message.username || !message.pubkey) return;

                    const profile: UserProfile = {
                        profileId: message.pubkey || 'unknown',
                        username: message.username || 'Unknown',
                        pubkey: message.pubkey || '',
                        description: message.description || '',
                        // Map timestamp back to updatedAt for local storage/display
                        updatedAt: message.timestamp || Date.now(),
                        version: 1,
                        lastSeen: Date.now() / 1000,
                        isMyProfile: false,
                        extraData: message.extraData
                    };

                    this.saveExtendedProfile(profile);
                    this.callbacks.forEach(cb => cb(profile));
                }

                // 2. Handle Profile Request (Server Side)
                else if (message.type === 'get_profiles') {
                    console.log(`📥 [Sync] Received profile request from ${data.from}`);
                    this.handleProfileRequest(data.from, message.replyAddress);
                }

                // 3. Handle Profile List Response (Client Side)
                else if (message.type === 'profile_list') {
                    // console.log(`📥 [Sync] Received ${message.profiles?.length || 0} profiles from sync.`);
                    if (message.profiles && Array.isArray(message.profiles)) {
                        message.profiles.forEach(p => {
                            // We treat these as "local" profiles now
                            this.saveExtendedProfile(p);
                            this.callbacks.forEach(cb => cb(p));
                        });
                    }
                }

            } catch (e) {
                console.error('Error processing Maxima profile broadcast:', e);
            }
        }) as EventListener);
    }

    /**
     * Handle incoming request for profiles (Server Role)
     */
    private async handleProfileRequest(requester: string, replyAddress?: string) {
        // Dynamically import DiscoveryService to avoid circular dependency at initialization
        const { DiscoveryService } = await import('./discovery.service');

        // Fetch all known profiles (L1 + SQL Mixed)
        // CRITICAL: Disable sync to prevent infinite loops (Request -> Get -> Sync -> Request...)
        const allProfiles = await DiscoveryService.getProfiles({ sync: false });

        // Send back chunked response? For now, send all (assuming < 64KB limit isn't hit yet)
        // TODO: Implement chunking for large lists

        const response: ProfileBroadcast = {
            type: 'profile_list',
            profiles: allProfiles
        };

        const target = replyAddress || requester;
        if (!replyAddress) {
            console.warn(`⚠️ [Sync] No replyAddress provided, attempting to reply to ${requester} (might fail if it's a pubkey)`);
        }

        const cmd = `maxima action:send to:${target} application:${MAXIMA_TOPIC} data:${JSON.stringify(response)}`;
        MDS.executeRaw(cmd, (res: any) => {
            if (res.status) {
                console.log(`✅ [Sync] Sent ${allProfiles.length} profiles to ${requester}`);
            } else {
                console.error(`❌ [Sync] Failed to send profiles: ${res.error}`);
            }
        });
    }

    private saveExtendedProfile(profile: UserProfile) {
        if (profile.extraData || profile.username) {
            const extraData = profile.extraData || {};
            const location = extraData.location ? `'${extraData.location.replace(/'/g, "''")}'` : 'NULL';
            const website = extraData.website ? `'${extraData.website.replace(/'/g, "''")}'` : 'NULL';
            const bio = extraData.bio ? `'${extraData.bio.replace(/'/g, "''")}'` : 'NULL';

            const sql = `
                MERGE INTO PROFILES (pubkey, username, location, website, bio, last_seen)
                KEY (pubkey)
                VALUES ('${profile.pubkey}', '${profile.username.replace(/'/g, "''")}', ${location}, ${website}, ${bio}, ${Date.now()})
            `;

            MDS.sql(sql, (res: any) => {
                if (res.status) {
                    // console.log(`✅ [Maxima] Saved extended profile for ${profile.username}`);
                }
            });
        }
    }

    /**
     * Sign a message with the current wallet's private key
     */
    private async signMessage(message: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const cmd = `maxsign data:${message}`;

            MDS.executeRaw(cmd, (res: any) => {
                if (res.status && res.response?.signature) {
                    resolve(res.response.signature);
                } else {
                    reject('Failed to sign message');
                }
            });
        });
    }

    /**
     * Verify a message signature
     */
    private verifySignature(message: ProfileBroadcast): boolean {
        const { sig } = message;

        // In a real implementation, we would verify the signature against the pubkey
        // For now, we'll do basic validation

        // Check that signature exists and is not empty
        if (!sig || sig.length === 0) {
            return false;
        }

        // Check timestamp is reasonable (not too old, not in future)
        const now = Date.now() / 1000;
        const maxAge = 24 * 60 * 60; // 24 hours

        if ((message.timestamp || 0) > now + 60) {
            // Message from future (allow 1 min clock skew)
            return false;
        }

        if ((message.timestamp || 0) < now - maxAge) {
            // Message too old
            return false;
        }

        // TODO: Implement proper signature verification with pubkey
        // This would require using Minima's verify command or a crypto library

        return true;
    }
}

export const maximaDiscoveryService = new MaximaDiscoveryService();
