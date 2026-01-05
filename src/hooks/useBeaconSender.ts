import { useEffect } from 'react';
import { MDS } from '@minima-global/mds';

// Export sendBeacon function so it can be called manually (e.g., after profile updates)
export const sendBeacon = async () => {
    // Wait for initial delay to ensure MDS is ready
    // REMOVED: isMDSInitialized check which was blocking execution in packaged app

    try {
        console.log("🚀 [BEACON] Starting send...");
        const maximaInfo = await MDS.cmd.maxima({ params: { action: "info" } });
        console.log("📋 [BEACON] Raw Maxima Info:", maximaInfo);

        const info = (maximaInfo.response as any) || {};
        console.log("📦 [BEACON] Parsed info:", info);

        const pubkey = info.publickey;
        const address = info.contact;

        // Get Maxima name
        const alias = info.name || 'Anonymous';
        console.log("👤 [BEACON] Retrieved alias:", alias);
        console.log("🔑 [BEACON] Pubkey:", pubkey?.substring(0, 20) + "...");
        console.log("📬 [BEACON] Address:", address?.substring(0, 30) + "...");

        // Get bio using keypair
        const bioRes = await MDS.keypair.get('p2p_bio');
        const bio = (bioRes && bioRes.status && bioRes.value) ? bioRes.value : '';
        console.log("📝 [BEACON] Bio:", bio || "(empty)");

        // Get allow_noncontact_chats setting - Check DB First
        let allowNonContactChats = true;
        try {
            const sql = "SELECT allow_non_contact_chats FROM MY_PROFILE WHERE id=1 LIMIT 1";
            const res = await new Promise<any>((resolve) => {
                (MDS as any).sql(sql, (r: any) => resolve(r));
            });

            if (res && res.rows && res.rows.length > 0) {
                const rawValue = res.rows[0].ALLOW_NON_CONTACT_CHATS ?? res.rows[0].allow_non_contact_chats;
                allowNonContactChats = (rawValue === 1 || rawValue === "1" || rawValue === true || rawValue === "true");
                console.log("🔐 [BEACON] Retrieved permission from DB:", allowNonContactChats);
            } else {
                // Fallback to Keypair
                const chatPermRes = await MDS.keypair.get('allow_noncontact_chats');
                allowNonContactChats = (chatPermRes && chatPermRes.status && chatPermRes.value !== undefined)
                    ? (chatPermRes.value === 'true')
                    : true; // Default to true
                console.log("🔐 [BEACON] Retrieved permission from Keypair:", allowNonContactChats);
            }
        } catch (e) {
            console.error("❌ [BEACON] Error getting permissions:", e);
        }

        const beacon = {
            app: "metachain",
            type: "BEACON",
            v: 1,
            pubkey,
            address,
            alias,
            bio,
            allowNonContactChats,
            timestamp: Date.now()
        };

        console.log("📡 [BEACON] Payload:", beacon);

        // Send via P2P (will be captured by MINIMALOG)
        const jsonStr = JSON.stringify(beacon);
        const hexData = "0x" + Array.from(jsonStr)
            .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
            .join('');

        console.log(`📤 [BEACON] Sending HEX: ${hexData.substring(0, 50)}... (${hexData.length} chars)`);

        const messageCmd = `message data:${hexData}`;

        // Reverting to executeRaw (imported MDS) but wrapped in Promise as it uses callback style
        await new Promise((resolve, reject) => {
            (MDS as any).executeRaw(messageCmd, (res: any) => {
                if (res.status) resolve(res);
                else reject(new Error(res.error || 'Command failed'));
            });
        });
        console.log("✅ [BEACON] P2P Command executed");

        // Also send to bootstrap server if configured
        const staticMLS = info.mls;
        if (staticMLS && info.staticmls) {
            console.log("🌐 [BEACON] Sending to Bootstrap:", staticMLS);
            const bootstrapBeacon = {
                app: "metachain",
                type: "register",
                pubkey,
                address,
                alias,
                bio,
                allowNonContactChats,
                timestamp: Date.now()
            };

            console.log("📡 [BEACON] Bootstrap payload:", bootstrapBeacon);
            const cmd = `maxima action:send to:${staticMLS} application:metachain data:${JSON.stringify(bootstrapBeacon)}`;

            await new Promise((resolve, reject) => {
                (MDS as any).executeRaw(cmd, (res: any) => {
                    if (res.status) resolve(res);
                    else reject(new Error(res.error || 'Bootstrap command failed'));
                });
            });
            console.log("✅ [BEACON] Bootstrap sent");
        } else {
            console.log("ℹ️ [BEACON] No Static MLS, skipping bootstrap");
        }
    } catch (error) {
        console.error("❌ [BEACON] Send failed:", error);
    }
};

export default function useBeaconSender(enabled: boolean = true) {
    // Note: Beacon is now managed by the background Service Worker (service.js)
    // using NEWBLOCK events as a heartbeat.
    // This hook is kept blank to satisfy component usage, or for future on-demand logic.
    useEffect(() => {
        if (enabled) {
            console.log("ℹ️ [BEACON] Sending initial beacon (Frontend)...");
            sendBeacon();
        }
    }, [enabled]);
}
