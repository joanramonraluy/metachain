
MDS.init((msg) => {
    if (msg.event === 'inited') {
        MDS.sql("SELECT * FROM GROUPS", (res) => {
            console.log("GROUPS Rows:", JSON.stringify(res.rows || []));
            if (res.rows && res.rows.length > 0) {
                const groupId = res.rows[0].GROUP_ID || res.rows[0].group_id;
                console.log("Found groupId:", groupId);

                // Test the update statement exactly as in the service
                MDS.sql(`UPDATE GROUPS SET favorite = 1 WHERE UPPER(group_id) = UPPER('${groupId}')`, (updateRes) => {
                    console.log("UPDATE result:", JSON.stringify(updateRes));

                    // Verify the update
                    MDS.sql(`SELECT favorite, FAVORITE FROM GROUPS WHERE UPPER(group_id) = UPPER('${groupId}')`, (checkRes) => {
                        console.log("Check after update:", JSON.stringify(checkRes.rows));
                    });
                });
            }
        });

        MDS.sql("SELECT * FROM CHANNELS", (res) => {
            console.log("CHANNELS Rows:", JSON.stringify(res.rows || []));
            if (res.rows && res.rows.length > 0) {
                const channelId = res.rows[0].CHANNEL_ID || res.rows[0].channel_id;
                console.log("Found channelId:", channelId);

                // Test the update statement exactly as in the service
                MDS.sql(`UPDATE CHANNELS SET favorite = 1 WHERE UPPER(channel_id) = UPPER('${channelId}')`, (updateRes) => {
                    console.log("UPDATE result CHANNELS:", JSON.stringify(updateRes));

                    // Verify the update
                    MDS.sql(`SELECT favorite, FAVORITE FROM CHANNELS WHERE UPPER(channel_id) = UPPER('${channelId}')`, (checkRes) => {
                        console.log("Check after update CHANNELS:", JSON.stringify(checkRes.rows));
                    });
                });
            }
        });
    }
});
