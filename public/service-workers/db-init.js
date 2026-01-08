/**
 * MetaChain Service Worker - Database Initialization
 * Creates all required tables on startup
 */

function initDatabase() {
    MDS.log("🚀 [SW] STARTING UP - v1.4 (MODULAR)");

    // Register for NEWBLOCK events
    MDS.cmd("event on newblock", function (res) { });

    // Get our own Maxima info
    MDS.cmd("maxima action:info", function (maxInfo) {
        if (maxInfo.status) {
            MY_MAXIMA_PK = maxInfo.response.publickey;
            MDS.log("🔑 [SW] My Public Key: " + MY_MAXIMA_PK);
        }
    });

    // CHAT_MESSAGES table
    var chatMessagesSql = "CREATE TABLE IF NOT EXISTS CHAT_MESSAGES ( "
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

    MDS.sql(chatMessagesSql, function (res) {
        MDS.log("💾 [DB] CHAT_MESSAGES initialized");

        // Add columns if missing
        MDS.sql("ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS amount INT NOT NULL DEFAULT 0");

        // CHAT_STATUS table
        var chatStatusSql = "CREATE TABLE IF NOT EXISTS CHAT_STATUS ( "
            + "  publickey VARCHAR(512) PRIMARY KEY, "
            + "  archived BOOLEAN NOT NULL DEFAULT FALSE, "
            + "  archived_date BIGINT, "
            + "  last_opened BIGINT, "
            + "  favorite BOOLEAN NOT NULL DEFAULT FALSE "
            + " )";

        MDS.sql(chatStatusSql, function () {
            MDS.sql("ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE");
        });

        // MY_PROFILE table
        var myProfileSql = "CREATE TABLE IF NOT EXISTS MY_PROFILE ( "
            + "  id INT PRIMARY KEY, "
            + "  avatar TEXT, "
            + "  tags TEXT, "
            + "  bio_extended TEXT, "
            + "  social_links TEXT, "
            + "  location TEXT, "
            + "  last_updated BIGINT "
            + " )";

        MDS.sql(myProfileSql, function () {
            MDS.sql("INSERT IGNORE INTO MY_PROFILE (id) VALUES (1)", function () {
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS phone TEXT");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS email TEXT");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS website TEXT");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS country TEXT");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS languages TEXT");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l2 VARCHAR(20) DEFAULT 'public'");
                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l3 VARCHAR(20) DEFAULT 'contacts'");
            });
        });

        // DISCOVERED_PEERS table
        var discoveryLayerSql = "CREATE TABLE IF NOT EXISTS DISCOVERED_PEERS ( "
            + "  publickey VARCHAR(512) PRIMARY KEY, "
            + "  alias VARCHAR(160) NOT NULL, "
            + "  bio VARCHAR(512), "
            + "  address VARCHAR(512) NOT NULL, "
            + "  last_seen BIGINT NOT NULL, "
            + "  source VARCHAR(20) NOT NULL"
            + " )";

        MDS.sql(discoveryLayerSql, function () {
            MDS.sql("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS bio VARCHAR(512)");
            MDS.sql("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE");
            MDS.sql("ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS extra_data CLOB");
        });

        // CONTACT_REQUESTS table
        var contactRequestsSql = "CREATE TABLE IF NOT EXISTS CONTACT_REQUESTS ( "
            + "  id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            + "  from_publickey VARCHAR(512) NOT NULL, "
            + "  from_name VARCHAR(255), "
            + "  from_avatar TEXT, "
            + "  to_publickey VARCHAR(512) NOT NULL, "
            + "  status VARCHAR(32) DEFAULT 'pending', "
            + "  created_at BIGINT NOT NULL, "
            + "  updated_at BIGINT "
            + " )";

        MDS.sql(contactRequestsSql, function () {
            MDS.sql("ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_address VARCHAR(1024)");
        });

        // PERSONAL_CONTACTS table (Replaces keypair storage)
        var personalContactsSql = "CREATE TABLE IF NOT EXISTS PERSONAL_CONTACTS ( "
            + "  publickey VARCHAR(512) PRIMARY KEY, "
            + "  created_at BIGINT "
            + " )";

        MDS.sql(personalContactsSql, function () {
            MDS.log("💾 [DB] PERSONAL_CONTACTS initialized");
        });

        // MAXIMA_CONTACT_REQUESTS table
        var maximaContactRequestsSql = "CREATE TABLE IF NOT EXISTS MAXIMA_CONTACT_REQUESTS ( "
            + "  id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            + "  from_publickey VARCHAR(512) NOT NULL, "
            + "  from_name VARCHAR(255), "
            + "  to_publickey VARCHAR(512) NOT NULL, "
            + "  status VARCHAR(32) DEFAULT 'pending', "
            + "  created_at BIGINT NOT NULL, "
            + "  updated_at BIGINT "
            + " )";

        MDS.sql(maximaContactRequestsSql);

        // METACHAIN_USERS table
        var userRegistrySql = "CREATE TABLE IF NOT EXISTS METACHAIN_USERS ( "
            + "  user_id VARCHAR(512) PRIMARY KEY, "
            + "  publickey VARCHAR(512) UNIQUE NOT NULL, "
            + "  alias VARCHAR(160) NOT NULL, "
            + "  address VARCHAR(512) NOT NULL, "
            + "  first_seen BIGINT NOT NULL, "
            + "  last_updated BIGINT NOT NULL"
            + " )";

        MDS.sql(userRegistrySql);

        // Enable logs for P2P beacons
        MDS.cmd("logs on", function (logRes) {
            if (logRes.status) {
                MDS.log("✅ [INIT] MINIMALOG listener registered");
            }
        });

        // Send initial beacon
        MDS.log("🚀 [SW] Sending initial beacon...");
        sendBackgroundBeacon();
        startGossip();

        // Register for periodic tasks
        MDS.cmd("event on newblock", function () {
            MDS.log("✅ [INIT] NEWBLOCK listener registered for periodic tasks.");
        });
    });
}
