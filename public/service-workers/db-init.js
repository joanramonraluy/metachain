/**
 * MetaChain Service Worker - Database Initialization
 * Creates all required tables on startup using Sequential Promise Pattern
 */

function initDatabase() {
  MDS.log("🚀 [SW] STARTING UP - v2.6 REPAIR");

  // Helper to run SQL as Promise
  function runSQL(query) {
    return new Promise(function (resolve, reject) {
      MDS.sql(query, function (res) {
        if (res.status) resolve(res);
        else resolve({ status: false, error: res.error }); // Resolve even on error to keep chain moving
      });
    });
  }

  // Register for NEWBLOCK events
  MDS.cmd("event on newblock", function (res) { });

  // Get our own Maxima info
  MDS.cmd("maxima action:info", function (maxInfo) {
    if (maxInfo.status) {
      MY_MAXIMA_PK = maxInfo.response.publickey;
      MDS.log("🔑 [SW] My Public Key: " + MY_MAXIMA_PK);
    }
  });

  // START SEQUENTIAL INIT
  var chain = Promise.resolve();

  // 1. TRANSACTIONS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS TRANSACTIONS ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  txpowid VARCHAR(128) NOT NULL, " +
      "  date BIGINT NOT NULL, " +
      "  amount VARCHAR(64) NOT NULL, " +
      "  tokenid VARCHAR(128) NOT NULL, " +
      "  message VARCHAR(255), " +
      "  status VARCHAR(32) DEFAULT 'pending' " +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] TRANSACTIONS table checked/init"
          : "❌ [DB] TRANSACTIONS init failed: " + res.error,
      );
      // REPAIR: Always run these ALTERs
      return Promise.all([
        runSQL(
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS type VARCHAR(32)",
        ),
        runSQL(
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS publickey VARCHAR(512)",
        ),
        runSQL(
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS message_timestamp BIGINT",
        ),
        runSQL(
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS metadata CLOB",
        ),
        runSQL(
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS pendinguid VARCHAR(128)",
        ),
        // FORCE ADD DATE COLUMN IF MISSING (Fix for 'Column DATE not found')
        runSQL("ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS date BIGINT"),
        runSQL("ALTER TABLE TRANSACTIONS ALTER COLUMN date SET NOT NULL"), // Enforce not null if possible, or ignore
      ]);
    });
  });

  // 2. CHAT_MESSAGES
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS CHAT_MESSAGES ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  roomname varchar(160) NOT NULL, " +
      "  publickey varchar(512) NOT NULL, " +
      "  username varchar(160) NOT NULL, " +
      "  type varchar(64) NOT NULL, " +
      "  message varchar(512) NOT NULL, " +
      "  filedata clob(256K) NOT NULL, " +
      "  customid varchar(128) NOT NULL DEFAULT '0x00', " +
      "  state varchar(128) NOT NULL DEFAULT '', " +
      "  read int NOT NULL DEFAULT 0, " +
      "  amount int NOT NULL DEFAULT 0, " +
      "  date bigint NOT NULL " +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "💾 [DB] CHAT_MESSAGES checked/init"
          : "❌ [DB] CHAT_MESSAGES init failed",
      );
      return Promise.all([
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS amount INT NOT NULL DEFAULT 0",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS original_timestamp BIGINT",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS txpowid VARCHAR(128)",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS sender_seq INT DEFAULT 0",
        ),
        runSQL(
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS customid VARCHAR(128)",
        ),
      ]);
    });
  });

  // 3. CHAT_STATUS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS CHAT_STATUS ( " +
      "  publickey VARCHAR(512) PRIMARY KEY, " +
      "  archived BOOLEAN NOT NULL DEFAULT FALSE, " +
      "  archived_date BIGINT, " +
      "  last_opened BIGINT, " +
      "  favorite BOOLEAN NOT NULL DEFAULT FALSE, " +
      "  blocked BOOLEAN NOT NULL DEFAULT FALSE, " +
      "  blocked_by_them BOOLEAN NOT NULL DEFAULT FALSE " +
      " )";
    return runSQL(sql).then(function () {
      return Promise.all([
        runSQL(
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE",
        ),
        runSQL(
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE",
        ),
        runSQL(
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked_by_them BOOLEAN NOT NULL DEFAULT FALSE",
        ),
      ]);
    });
  });

  // 3.5 GROUPS (schema parity with frontend)
  chain = chain.then(function () {
    var groupsSql =
      "CREATE TABLE IF NOT EXISTS GROUPS ( " +
      "  group_id VARCHAR(256) PRIMARY KEY, " +
      "  name VARCHAR(255) NOT NULL, " +
      "  creator_publickey VARCHAR(512) NOT NULL, " +
      "  created_date BIGINT NOT NULL, " +
      "  avatar TEXT, " +
      "  description TEXT " +
      " )";

    return runSQL(groupsSql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] GROUPS checked/init"
          : "❌ [DB] GROUPS init failed: " + res.error,
      );
    });
  });

  // 3.6 GROUP_MEMBERS
  chain = chain.then(function () {
    var membersSql =
      "CREATE TABLE IF NOT EXISTS GROUP_MEMBERS ( " +
      "  group_id VARCHAR(256) NOT NULL, " +
      "  publickey VARCHAR(512) NOT NULL, " +
      "  username VARCHAR(255) NOT NULL, " +
      "  joined_date BIGINT NOT NULL, " +
      "  role VARCHAR(32) DEFAULT 'member', " +
      "  PRIMARY KEY (group_id, publickey) " +
      " )";

    return runSQL(membersSql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] GROUP_MEMBERS checked/init"
          : "❌ [DB] GROUP_MEMBERS init failed: " + res.error,
      );
    });
  });

  // 3.7 GROUP_MESSAGES
  chain = chain.then(function () {
    var messagesSql =
      "CREATE TABLE IF NOT EXISTS GROUP_MESSAGES ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  group_id VARCHAR(256) NOT NULL, " +
      "  sender_publickey VARCHAR(512) NOT NULL, " +
      "  sender_username VARCHAR(255) NOT NULL, " +
      "  type VARCHAR(32) NOT NULL, " +
      "  message TEXT, " +
      "  filedata TEXT, " +
      "  date BIGINT NOT NULL, " +
      "  read INTEGER DEFAULT 0, " +
      "  propagated INTEGER DEFAULT 0 " +
      " )";

    return runSQL(messagesSql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] GROUP_MESSAGES checked/init"
          : "❌ [DB] GROUP_MESSAGES init failed: " + res.error,
      );

      return runSQL(
        "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS propagated INTEGER DEFAULT 0",
      );
    });
  });

  // 3.8 GROUP_BANS
  chain = chain.then(function () {
    var bansSql =
      "CREATE TABLE IF NOT EXISTS GROUP_BANS ( " +
      "  group_id VARCHAR(256) NOT NULL, " +
      "  publickey VARCHAR(512) NOT NULL, " +
      "  username VARCHAR(255) DEFAULT 'Unknown', " +
      "  banned_by VARCHAR(512) NOT NULL, " +
      "  banned_at BIGINT NOT NULL, " +
      "  PRIMARY KEY (group_id, publickey) " +
      " )";

    return runSQL(bansSql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] GROUP_BANS checked/init"
          : "❌ [DB] GROUP_BANS init failed: " + res.error,
      );

      return runSQL(
        "ALTER TABLE GROUP_BANS ADD COLUMN IF NOT EXISTS username VARCHAR(255) DEFAULT 'Unknown'",
      );
    });
  });

  // 3.9 GROUP_JOIN_REQUESTS
  chain = chain.then(function () {
    var requestsSql =
      "CREATE TABLE IF NOT EXISTS GROUP_JOIN_REQUESTS ( " +
      "  id BIGINT AUTO_INCREMENT, " +
      "  group_id VARCHAR(256) NOT NULL, " +
      "  publickey VARCHAR(512) NOT NULL, " +
      "  username VARCHAR(255) DEFAULT 'Unknown', " +
      "  address VARCHAR(512) NOT NULL, " +
      "  status VARCHAR(32) DEFAULT 'pending', " +
      "  timestamp BIGINT NOT NULL, " +
      "  PRIMARY KEY (group_id, publickey) " +
      " )";

    return runSQL(requestsSql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] GROUP_JOIN_REQUESTS checked/init"
          : "❌ [DB] GROUP_JOIN_REQUESTS init failed: " + res.error,
      );
    });
  });

  // 4. MESSAGE_COUNTERS (for sequence tracking)
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS MESSAGE_COUNTERS ( " +
      "  publickey VARCHAR(512) PRIMARY KEY, " +
      "  next_seq INT NOT NULL DEFAULT 1 " +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📊 [DB] MESSAGE_COUNTERS checked/init"
          : "❌ [DB] MESSAGE_COUNTERS init failed",
      );
    });
  });

  // 5. MY_PROFILE
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS MY_PROFILE ( " +
      "  id INT PRIMARY KEY, " +
      "  avatar TEXT, " +
      "  tags TEXT, " +
      "  bio_extended TEXT, " +
      "  social_links TEXT, " +
      "  location TEXT, " +
      "  last_updated BIGINT " +
      " )";
    return runSQL(sql).then(function () {
      runSQL("INSERT IGNORE INTO MY_PROFILE (id) VALUES (1)");
      return Promise.all([
        runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS phone TEXT"),
        runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS email TEXT"),
        runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS website TEXT"),
        runSQL("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS country TEXT"),
        runSQL(
          "ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS languages TEXT",
        ),
        runSQL(
          "ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE",
        ),
        runSQL(
          "ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l2 VARCHAR(20) DEFAULT 'public'",
        ),
        runSQL(
          "ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l3 VARCHAR(20) DEFAULT 'contacts'",
        ),
        runSQL(
          "ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS minimaaddress TEXT",
        ),
      ]);
    });
  });

  // 5. CONTACT_REQUESTS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS CONTACT_REQUESTS ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  from_publickey VARCHAR(512) NOT NULL, " +
      "  from_name VARCHAR(255), " +
      "  from_avatar TEXT, " +
      "  to_publickey VARCHAR(512) NOT NULL, " +
      "  status VARCHAR(32) DEFAULT 'pending', " +
      "  created_at BIGINT NOT NULL, " +
      "  updated_at BIGINT " +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] CONTACT_REQUESTS checked/init"
          : "❌ [DB] CONTACT_REQUESTS init failed",
      );
      return runSQL(
        "ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_address VARCHAR(1024)",
      );
    });
  });

  // 6. DISCOVERED_PEERS (Explicit sequence)
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS DISCOVERED_PEERS ( " +
      "  publickey VARCHAR(512) PRIMARY KEY, " +
      "  alias VARCHAR(160) NOT NULL, " +
      "  bio VARCHAR(512), " +
      "  address VARCHAR(512) NOT NULL, " +
      "  last_seen BIGINT NOT NULL, " +
      "  source VARCHAR(20) NOT NULL" +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] DISCOVERED_PEERS checked/init"
          : "❌ [DB] DISCOVERED_PEERS init failed: " + res.error,
      );
      return Promise.all([
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS bio VARCHAR(512)",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS extra_data CLOB",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS avatar TEXT",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS minimaaddress VARCHAR(512)",
        ),
        runSQL(
          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'P2P'",
        ),
      ]);
    });
  });

  // 7. PERSONAL_CONTACTS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS PERSONAL_CONTACTS ( publickey VARCHAR(512) PRIMARY KEY, created_at BIGINT )";
    return runSQL(sql);
  });

  // 8. MAXIMA_CONTACT_REQUESTS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS MAXIMA_CONTACT_REQUESTS ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  from_publickey VARCHAR(512) NOT NULL, " +
      "  from_name VARCHAR(255), " +
      "  to_publickey VARCHAR(512) NOT NULL, " +
      "  status VARCHAR(32) DEFAULT 'pending', " +
      "  created_at BIGINT NOT NULL, " +
      "  updated_at BIGINT " +
      " )";
    return runSQL(sql);
  });

  // 9. METACHAIN_USERS
  chain = chain.then(function () {
    var sql =
      "CREATE TABLE IF NOT EXISTS METACHAIN_USERS ( " +
      "  user_id VARCHAR(512) PRIMARY KEY, " +
      "  publickey VARCHAR(512) UNIQUE NOT NULL, " +
      "  alias VARCHAR(160) NOT NULL, " +
      "  address VARCHAR(512) NOT NULL, " +
      "  first_seen BIGINT NOT NULL, " +
      "  last_updated BIGINT NOT NULL" +
      " )";
    return runSQL(sql).then(function (res) {
      MDS.log(
        res.status
          ? "📂 [DB] METACHAIN_USERS checked/init"
          : "❌ [DB] METACHAIN_USERS init failed",
      );
      return Promise.all([
        // Schema parity with Frontend variant
        runSQL(
          "ALTER TABLE METACHAIN_USERS ADD COLUMN IF NOT EXISTS avatar TEXT",
        ),
        runSQL(
          "ALTER TABLE METACHAIN_USERS ADD COLUMN IF NOT EXISTS last_seen BIGINT",
        ),
      ]);
    });
  });

  // 10. CHANNELS
  chain = chain.then(function () {
    var channelsSql =
      "CREATE TABLE IF NOT EXISTS CHANNELS ( " +
      "  channel_id VARCHAR(256) PRIMARY KEY, " +
      "  name VARCHAR(255) NOT NULL, " +
      "  description TEXT, " +
      "  admin_publickey VARCHAR(512) NOT NULL, " +
      "  created_date BIGINT NOT NULL, " +
      "  avatar TEXT " +
      " )";
    return runSQL(channelsSql).then(function (res) {
      MDS.log(
        res.status
          ? "📢 [DB] CHANNELS checked/init"
          : "❌ [DB] CHANNELS init failed: " + res.error,
      );
    });
  });

  // 10.1 CHANNEL_SUBSCRIBERS
  chain = chain.then(function () {
    var subsSql =
      "CREATE TABLE IF NOT EXISTS CHANNEL_SUBSCRIBERS ( " +
      "  channel_id VARCHAR(256) NOT NULL, " +
      "  publickey VARCHAR(512) NOT NULL, " +
      "  username VARCHAR(255) NOT NULL, " +
      "  joined_date BIGINT NOT NULL, " +
      "  role VARCHAR(32) DEFAULT 'subscriber', " +
      "  PRIMARY KEY (channel_id, publickey) " +
      " )";
    return runSQL(subsSql).then(function (res) {
      MDS.log(
        res.status
          ? "📢 [DB] CHANNEL_SUBSCRIBERS checked/init"
          : "❌ [DB] CHANNEL_SUBSCRIBERS init failed: " + res.error,
      );
    });
  });

  // 10.2 CHANNEL_MESSAGES
  chain = chain.then(function () {
    var cMsgSql =
      "CREATE TABLE IF NOT EXISTS CHANNEL_MESSAGES ( " +
      "  id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
      "  channel_id VARCHAR(256) NOT NULL, " +
      "  sender_publickey VARCHAR(512) NOT NULL, " +
      "  sender_username VARCHAR(255) NOT NULL, " +
      "  type VARCHAR(32) NOT NULL, " +
      "  message TEXT, " +
      "  filedata TEXT, " +
      "  date BIGINT NOT NULL, " +
      "  read INTEGER DEFAULT 0 " +
      " )";
    return runSQL(cMsgSql).then(function (res) {
      MDS.log(
        res.status
          ? "📢 [DB] CHANNEL_MESSAGES checked/init"
          : "❌ [DB] CHANNEL_MESSAGES init failed: " + res.error,
      );
    });
  });

  // FINAL: Start Services
  chain.then(function () {
    MDS.log("✅ [INIT] Database sequence complete. Starting Services...");
    DB_READY = true;

    // Enable logs for P2P beacons
    MDS.cmd("logs on", function (logRes) {
      if (logRes.status) MDS.log("✅ [INIT] MINIMALOG listener registered");
    });

    // Send initial beacon
    sendBackgroundBeacon();
    startGossip();

    // Register for periodic tasks
    MDS.cmd("event on newblock", function () {
      MDS.log("✅ [INIT] NEWBLOCK listener registered for periodic tasks.");
    });

    // Trigger history sync to update message counters and chat list
    // Uses timestamp optimization to only fetch new messages
    if (typeof requestHistoryFromRecentContacts === "function") {
      requestHistoryFromRecentContacts();
    } else {
      MDS.log(
        "⚠️ [INIT] requestHistoryFromRecentContacts not loaded yet. Handlers might be missing.",
      );
    }

    // Set flag to run coin discovery on first NEWBLOCK (when node is fully synced)
    COIN_DISCOVERY_PENDING = true;
    MDS.log("📦 [INIT] Coin discovery scheduled for first NEWBLOCK event");
  });
}
