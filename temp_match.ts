// 2. Fetch Discovered Peers (Might fail if offline, but usually local DB)
try {
    // Wrapper for MDS.sql which is callback based usually, but here we want to await it safely
    // or just fire and forget. The original code used MDS.sql(..., callback).
    // MDS.sql is fast (local). Converting to promise for safety.
    const peersPromise = new Promise((resolve, reject) => {
        MDS.sql("SELECT publickey, alias FROM DISCOVERED_PEERS", (res: any) => {
            if (res.status) resolve(res);
            else reject(new Error(res.error));
        });
    });

    const res: any = await withTimeout(peersPromise, 2000);

    if (res.status && res.rows) {
        const pMap = new Map<string, string>();
        res.rows.forEach((row: any) => {
            if (row.PUBLICKEY && row.ALIAS) {
                pMap.set(row.PUBLICKEY, row.ALIAS);
            }
        });
        setPeerNames(pMap);
    }
} catch (err) {
    // Non-critical
    console.warn("⚠️ [ChatsAndGroups] Peer fetch warning:", err);
}
