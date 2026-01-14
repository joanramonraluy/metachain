
export const checkMinimaStructure = () => {
    // @ts-ignore
    if (typeof MDS === 'undefined') return;

    console.log("🐛 [DEBUG-SCRIPT] Checking Minima Command Structures...");

    // 1. Check History
    // @ts-ignore
    MDS.executeRaw('history action:list', (res) => {
        console.log("🐛 [DEBUG-SCRIPT] History Response Keys:", Object.keys(res.response || {}));
        console.log("🐛 [DEBUG-SCRIPT] History Response Sample:", JSON.stringify(res.response));
    });

    // 2. Check Mempool
    // @ts-ignore
    MDS.executeRaw('mempool', (res) => {
        console.log("🐛 [DEBUG-SCRIPT] Mempool Response Keys:", Object.keys(res.response || {}));
        console.log("🐛 [DEBUG-SCRIPT] Mempool Response Sample:", JSON.stringify(res.response));
    });

    // 3. Check Address
    // @ts-ignore
    MDS.cmd.getaddress((res) => {
        console.log("🐛 [DEBUG-SCRIPT] GetAddress Response:", JSON.stringify(res));
    });
};
