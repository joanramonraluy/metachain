import { MDS } from '@minima-global/mds';
import { UserProfile } from './discovery.service';

const MAXIMA_TOPIC = 'charmchain_profiles_v1';

export interface ProfileBroadcast {
    type: 'charm_profile_v1';
    username: string;
    pubkey: string;
    description: string;
    timestamp: number;
    extraData?: UserProfile['extraData'];
    sig: string;
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
            timestamp: profile.timestamp,
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
                const message: ProfileBroadcast = JSON.parse(data.data);

                // Verify message format
                if (message.type !== 'charm_profile_v1') {
                    return;
                }

                // Verify signature
                if (!this.verifySignature(message)) {
                    console.warn('Invalid signature for profile broadcast');
                    return;
                }

                // Convert to UserProfile
                const profile: UserProfile = {
                    username: message.username,
                    pubkey: message.pubkey,
                    description: message.description,
                    timestamp: message.timestamp,
                    lastSeen: Date.now() / 1000, // Current time
                    isMyProfile: false, // Will be determined by the receiver
                    extraData: message.extraData
                };

                // Save extended profile data to local DB
                if (message.extraData) {
                    const extraData = message.extraData;
                    const location = extraData.location ? `'${extraData.location.replace(/'/g, "''")}'` : 'NULL';
                    const website = extraData.website ? `'${extraData.website.replace(/'/g, "''")}'` : 'NULL';
                    const bio = extraData.bio ? `'${extraData.bio.replace(/'/g, "''")}'` : 'NULL';

                    const sql = `
                        MERGE INTO PROFILES (pubkey, username, location, website, bio, last_seen)
                        KEY (pubkey)
                        VALUES ('${message.pubkey}', '${message.username.replace(/'/g, "''")}', ${location}, ${website}, ${bio}, ${Date.now()})
                    `;

                    MDS.sql(sql, (res: any) => {
                        if (res.status) {
                            console.log(`✅ [Maxima] Saved extended profile for ${message.username} to local DB`);
                        } else {
                            console.error("❌ [Maxima] Failed to save extended profile:", res.error);
                        }
                    });
                }

                // Notify all callbacks
                this.callbacks.forEach(cb => cb(profile));
            } catch (e) {
                console.error('Error processing Maxima profile broadcast:', e);
            }
        }) as EventListener);
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

        if (message.timestamp > now + 60) {
            // Message from future (allow 1 min clock skew)
            return false;
        }

        if (message.timestamp < now - maxAge) {
            // Message too old
            return false;
        }

        // TODO: Implement proper signature verification with pubkey
        // This would require using Minima's verify command or a crypto library

        return true;
    }
}

export const maximaDiscoveryService = new MaximaDiscoveryService();
