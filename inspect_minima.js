MDS.init((msg) => {
    if(msg.event === "inited") {
        MDS.cmd("history action:list", (res) => {
            MDS.log("HISTORY_DEBUG: " + JSON.stringify(res));
            MDS.cmd("mempool", (res2) => {
                MDS.log("MEMPOOL_DEBUG: " + JSON.stringify(res2));
                 MDS.cmd("getaddress", (res3) => {
                    MDS.log("GETADDRESS_1: " + JSON.stringify(res3));
                    MDS.cmd("getaddress", (res4) => {
                        MDS.log("GETADDRESS_2: " + JSON.stringify(res4));
                    });
                });
            });
        });
    }
});
