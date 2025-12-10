import { MDS } from '@minima-global/mds';
import { ExtendedProfile, CommunityProfileService } from './community-profile.service';

const COMMUNITY_TOPIC = 'charmchain_community_v1';

// Message types for community protocol
export type CommunityMessage =
    | { type: 'COMMUNITY_PING', requestId: string, from: string }
    | { type: 'COMMUNITY_PONG', requestId: string, to: string }
    | { type: 'PROFILE_REQUEST', requestId: string, from: string }
    | { type: 'PROFILE_RESPONSE', requestId: string, to: string, profile: ExtendedProfile };

type PingCallback = (publickey: string) => void;
type ProfileCallback = (publickey: string, profile: ExtendedProfile) => void;

class MaximaCommunityProtocolService {
    private pingCallbacks: Map<string, PingCallback> = new Map();
    private profileCallbacks: Map<string, ProfileCallback> = new Map();
    private isInitialized = false;

    /**
     * Initialize the Maxima message listener for community protocol
     */
    initialize(): void {
        if (this.isInitialized) return;

        window.addEventListener('MDS_MAXIMA_EVENT', ((event: CustomEvent) => {
            const data = event.detail;

            // Check if it's our community application
            if (data.application !== COMMUNITY_TOPIC) {
                return;
            }

            try {
                const message: CommunityMessage = JSON.parse(data.data);
                this.handleIncomingMessage(message, data.from);
            } catch (e) {
                console.error('[CommunityProtocol] Error processing message:', e);
            }
        }) as EventListener);

        this.isInitialized = true;
        console.log('✅ [CommunityProtocol] Initialized');
    }

    /**
     * Handle incoming Maxima messages
     */
    private handleIncomingMessage(message: CommunityMessage, from: string): void {
        switch (message.type) {
            case 'COMMUNITY_PING':
                this.handlePing(message, from);
                break;
            case 'COMMUNITY_PONG':
                this.handlePong(message);
                break;
            case 'PROFILE_REQUEST':
                this.handleProfileRequest(message, from);
                break;
            case 'PROFILE_RESPONSE':
                this.handleProfileResponse(message);
                break;
        }
    }

    /**
     * Handle incoming ping - respond with pong
     */
    private async handlePing(message: { type: 'COMMUNITY_PING', requestId: string, from: string }, senderAddress: string): Promise<void> {
        console.log(`📡 [CommunityProtocol] Received PING from ${message.from}, responding...`);

        const response: CommunityMessage = {
            type: 'COMMUNITY_PONG',
            requestId: message.requestId,
            to: message.from
        };

        await this.sendMessage(senderAddress, response);
    }

    /**
     * Handle incoming pong - trigger callback
     */
    private handlePong(message: { type: 'COMMUNITY_PONG', requestId: string, to: string }): void {
        const callback = this.pingCallbacks.get(message.requestId);
        if (callback) {
            callback(message.to);
            this.pingCallbacks.delete(message.requestId);
        }
    }

    /**
     * Handle incoming profile request - send my profile
     */
    private async handleProfileRequest(message: { type: 'PROFILE_REQUEST', requestId: string, from: string }, senderAddress: string): Promise<void> {
        console.log(`📡 [CommunityProtocol] Received PROFILE_REQUEST from ${message.from}`);

        try {
            const myProfile = await CommunityProfileService.getMyProfile();

            if (!myProfile) {
                console.warn('[CommunityProtocol] No profile to send');
                return;
            }

            const response: CommunityMessage = {
                type: 'PROFILE_RESPONSE',
                requestId: message.requestId,
                to: message.from,
                profile: myProfile
            };

            await this.sendMessage(senderAddress, response);
        } catch (e) {
            console.error('[CommunityProtocol] Error sending profile:', e);
        }
    }

    /**
     * Handle incoming profile response - trigger callback
     */
    private handleProfileResponse(message: { type: 'PROFILE_RESPONSE', requestId: string, to: string, profile: ExtendedProfile }): void {
        const callback = this.profileCallbacks.get(message.requestId);
        if (callback) {
            callback(message.to, message.profile);
            this.profileCallbacks.delete(message.requestId);
        }
    }

    /**
     * Send a ping to a MAX# address and wait for pong
     */
    async pingProfile(maxAddress: string, timeout: number = 3000): Promise<boolean> {
        this.initialize();

        return new Promise((resolve) => {
            const requestId = this.generateRequestId();
            let timeoutHandle: NodeJS.Timeout;

            // Setup callback for pong
            this.pingCallbacks.set(requestId, (publickey: string) => {
                clearTimeout(timeoutHandle);
                console.log(`✅ [CommunityProtocol] PONG received from ${publickey}`);
                resolve(true);
            });

            // Setup timeout
            timeoutHandle = setTimeout(() => {
                this.pingCallbacks.delete(requestId);
                console.log(`⏱️ [CommunityProtocol] PING timeout for ${maxAddress}`);
                resolve(false);
            }, timeout);

            // Get my public key to include in ping
            MDS.cmd.maxima((res: any) => {
                const myPubkey = res.response?.publickey || 'unknown';

                const message: CommunityMessage = {
                    type: 'COMMUNITY_PING',
                    requestId,
                    from: myPubkey
                };

                this.sendMessage(maxAddress, message).catch(() => {
                    clearTimeout(timeoutHandle);
                    this.pingCallbacks.delete(requestId);
                    resolve(false);
                });
            });
        });
    }

    /**
     * Request full profile from a MAX# address
     */
    async requestProfile(maxAddress: string, publickey: string, timeout: number = 5000): Promise<ExtendedProfile | null> {
        this.initialize();

        return new Promise((resolve) => {
            const requestId = this.generateRequestId();
            let timeoutHandle: NodeJS.Timeout;

            // Setup callback for profile response
            this.profileCallbacks.set(requestId, (receivedPubkey: string, profile: ExtendedProfile) => {
                clearTimeout(timeoutHandle);
                console.log(`✅ [CommunityProtocol] PROFILE received from ${receivedPubkey}`);

                // Cache the profile
                CommunityProfileService.cacheProfile(receivedPubkey, profile, 'online').catch(console.error);

                resolve(profile);
            });

            // Setup timeout
            timeoutHandle = setTimeout(() => {
                this.profileCallbacks.delete(requestId);
                console.log(`⏱️ [CommunityProtocol] PROFILE_REQUEST timeout for ${publickey}`);
                resolve(null);
            }, timeout);

            // Get my public key
            MDS.cmd.maxima((res: any) => {
                const myPubkey = res.response?.publickey || 'unknown';

                const message: CommunityMessage = {
                    type: 'PROFILE_REQUEST',
                    requestId,
                    from: myPubkey
                };

                this.sendMessage(maxAddress, message).catch(() => {
                    clearTimeout(timeoutHandle);
                    this.profileCallbacks.delete(requestId);
                    resolve(null);
                });
            });
        });
    }

    /**
     * Send a message via Maxima
     */
    private sendMessage(to: string, message: CommunityMessage): Promise<void> {
        return new Promise((resolve, reject) => {
            const messageStr = JSON.stringify(message);
            const cmd = `maxima action:send to:${to} application:${COMMUNITY_TOPIC} data:${messageStr}`;

            MDS.executeRaw(cmd, (res: any) => {
                if (res.status) {
                    resolve();
                } else {
                    reject(new Error(res.error || 'Failed to send message'));
                }
            });
        });
    }

    /**
     * Generate a unique request ID
     */
    private generateRequestId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    }
}

export const maximaCommunityProtocolService = new MaximaCommunityProtocolService();
