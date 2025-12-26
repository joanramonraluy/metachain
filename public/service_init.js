MDS.init(function (msg) {

    // Do initialisation
    if (msg.event == "inited") {
        MDS.log("[ServiceWorker] STARTING UP - Version 0.0.1");

        // Create the DB if not exists (using same schema as main app)
        var initsql = "CREATE TABLE IF NOT EXISTS CHAT_MESSAGES ( "
            + "  id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            + "  roomname varchar(160) NOT NULL, "
            + "  publickey varchar(512) NOT NULL, "
            + "  username varchar(160) NOT NULL, "
            + "  type varchar(64) NOT NULL, "
            + "  message varchar(512) NOT NULL, "
            + "  filedata clob(256K) NOT NULL, "
            + "  customid varchar(128) NOT NULL DEFAULT '0x00', "
            + "  state varchar(128) NOT NULL DEFAULT '', "
            + "  read int NOT NULL DEFAULT 0, "
            + "  amount int NOT NULL DEFAULT 0, "
            + "  date bigint NOT NULL "
            + " )";

        // Run this
        MDS.sql(initsql, function (res) {
            MDS.log("[ServiceWorker] MetaChain DB initialized: " + JSON.stringify(res));
            // Add amount column to existing tables if it doesn't exist
            var alterSql = "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS amount INT NOT NULL DEFAULT 0";
            MDS.sql(alterSql, function (alterRes) {
                MDS.log("[ServiceWorker] Amount column added/verified: " + JSON.stringify(alterRes));
            });

            // Create CHAT_STATUS table for managing archived chats, last opened time, and favorites
            var chatStatusSql = "CREATE TABLE IF NOT EXISTS CHAT_STATUS ( "
                + "  publickey VARCHAR(512) PRIMARY KEY, "
                + "  archived BOOLEAN NOT NULL DEFAULT FALSE, "
                + "  archived_date BIGINT, "
                + "  last_opened BIGINT, "
                + "  favorite BOOLEAN NOT NULL DEFAULT FALSE "
                + " )";

            MDS.sql(chatStatusSql, function (statusRes) {
                MDS.log("[ServiceWorker] CHAT_STATUS table initialized: " + JSON.stringify(statusRes));

                // Add favorite column to existing tables if it doesn't exist
                var alterFavoriteSql = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE";
                MDS.sql(alterFavoriteSql, function (alterRes) {
                    MDS.log("[ServiceWorker] Favorite column added/verified: " + JSON.stringify(alterRes));
                });
            });

            // Create MY_PROFILE table for extended community profile
            var myProfileSql = "CREATE TABLE IF NOT EXISTS MY_PROFILE ( "
                + "  id INT PRIMARY KEY DEFAULT 1, "
                + "  avatar TEXT, "
                + "  tags TEXT, "
                + "  bio_extended TEXT, "
                + "  social_links TEXT, "
                + "  location TEXT, "
                + "  last_updated BIGINT "
                + " )";

            MDS.sql(myProfileSql, function (profileRes) {
                MDS.log("[ServiceWorker] MY_PROFILE table initialized: " + JSON.stringify(profileRes));
            });

            // Create PROFILE_CACHE table for caching other users' profiles
            var profileCacheSql = "CREATE TABLE IF NOT EXISTS PROFILE_CACHE ( "
                + "  publickey VARCHAR(512) PRIMARY KEY, "
                + "  online_status VARCHAR(20), "
                + "  last_ping BIGINT, "
                + "  last_pong BIGINT, "
                + "  avatar TEXT, "
                + "  tags TEXT, "
                + "  bio_extended TEXT, "
                + "  social_links TEXT, "
                + "  location TEXT, "
                + "  fetched_at BIGINT "
                + " )";

            MDS.sql(profileCacheSql, function (cacheRes) {
                MDS.log("[ServiceWorker] PROFILE_CACHE table initialized: " + JSON.stringify(cacheRes));

                // Setup coinnotify for profile registry (based on Soko pattern)
                // This allows us to receive notifications without polluting the wallet
                var REGISTRY_SCRIPT = 'RETURN SIGNEDBY(STATE(2)) /* METACHAIN_PROFILE */';

                MDS.cmd("newscript script:\"" + REGISTRY_SCRIPT + "\"", function (scriptRes) {
                    if (scriptRes.status) {
                        var registryAddress = scriptRes.response.address;
                        MDS.log("[ServiceWorker] Registry address: " + registryAddress);

                        // Add coinnotify listener (like Soko does for NFT marketplace)
                        MDS.cmd("coinnotify action:add address:" + registryAddress, function (notifyRes) {
                            if (notifyRes.status) {
                                MDS.log("[ServiceWorker] coinnotify setup complete for profile registry");
                            } else {
                                MDS.log("[ServiceWorker] coinnotify setup failed: " + notifyRes.error);
                            }
                        });
                    } else {
                        MDS.log("[ServiceWorker] Failed to create registry script: " + scriptRes.error);
                    }
                });
            });
        });

        // Handle NOTIFYCOIN events (like Soko does for NFT marketplace)
    } else if (msg.event === "NOTIFYCOIN") {
        var coin = msg.data.coin;
        var REGISTRY_SCRIPT_COMMENT = '/* METACHAIN_PROFILE */';

        // Check if this is a profile coin by looking at the script
        if (coin.script && coin.script.indexOf(REGISTRY_SCRIPT_COMMENT) !== -1) {
            MDS.log("[Discovery] New profile detected! CoinID: " + coin.coinid);
            MDS.log("[Discovery] Profile data: " + JSON.stringify(coin.state));

            // The profile data is in the coin's state variables
            // STATE(0) = profileId
            // STATE(1) = alias
            // STATE(2) = publickey (owner)
            // STATE(3) = version
            // STATE(4) = visible
            // STATE(5) = profileHash
            // STATE(6) = schemaVersion

            // You can process the profile here if needed
            // For now, we just log it. The main app will query via getProfiles()
        }
    }
});

MDS.log("[ServiceWorker] Initialized with coinnotify for profile registry");
