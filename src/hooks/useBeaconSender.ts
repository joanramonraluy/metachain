import { useEffect } from 'react';
import { MDS } from '@minima-global/mds';

// Export sendBeacon function so it can be called manually (e.g., after profile updates)
export const sendBeacon = async () => {
    try {
        console.log('[Discovery] 🚀 Starting beacon send...');
        const maximaInfo = await MDS.cmd.maxima({ params: { action: "info" } });
        console.log('[Discovery] 📋 Raw Maxima Info:', maximaInfo);

        const info = (maximaInfo.response as any) || {};
        console.log('[Discovery] 📦 Parsed info object:', info);

        const pubkey = info.publickey;
        const address = info.contact;

        // Get Maxima name
        const alias = info.name || 'Anonymous';
        console.log('[Discovery] 👤 Retrieved alias:', alias);
        console.log('[Discovery] 🔑 Public key:', pubkey?.substring(0, 20) + '...');
        console.log('[Discovery] 📬 Address:', address?.substring(0, 30) + '...');

        // Get bio using keypair
        const bioRes = await MDS.keypair.get('p2p_bio');
        const bio = (bioRes && bioRes.status && bioRes.value) ? bioRes.value : '';
        console.log('[Discovery] 📝 Bio:', bio || '(empty)');

        const beacon = {
            app: "metachain",
            type: "BEACON",
            v: 1,
            pubkey,
            address,
            alias,
            bio
        };

        console.log('[Discovery] 📡 Complete beacon object:', beacon);

        // Send via P2P (will be captured by MINIMALOG)
        const jsonStr = JSON.stringify(beacon);
        const hexData = "0x" + Array.from(jsonStr)
            .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
            .join('');

        const messageCmd = `message data:${hexData}`;
        await MDS.executeRaw(messageCmd);
        console.log('[Discovery] P2P Beacon sent');

        // Also send to bootstrap server if configured
        const staticMLS = info.mls;
        if (staticMLS && info.staticmls) {
            console.log('[Discovery] 🌐 Sending to Bootstrap MLS:', staticMLS);
            const bootstrapBeacon = {
                app: "metachain",
                type: "register",
                pubkey,
                address,
                alias,
                bio
            };

            console.log('[Discovery] 📡 Bootstrap beacon object:', bootstrapBeacon);
            const cmd = `maxima action:send to:${staticMLS} application:metachain data:${JSON.stringify(bootstrapBeacon)}`;
            await MDS.executeRaw(cmd);
            console.log('[Discovery] ✅ Bootstrap beacon sent');
        } else {
            console.log('[Discovery] ⚠️ No Static MLS configured, skipping bootstrap beacon');
        }
    } catch (error) {
        console.error('[Discovery] Failed to send beacon:', error);
    }
};

export default function useBeaconSender() {
    useEffect(() => {
        let intervalId: NodeJS.Timeout;

        // Send immediately on mount
        sendBeacon();

        // Send every 5-8 minutes with jitter
        const interval = 300000 + Math.random() * 180000; // 5-8 min
        intervalId = setInterval(sendBeacon, interval);

        return () => clearInterval(intervalId);
    }, []);
}
