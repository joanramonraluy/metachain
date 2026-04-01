/**
 * Database Service - Core database utilities and initialization
 * Handles: SQL wrapper, hex/utf8 conversion, table initialization
 */

import { MDS } from "@minima-global/mds";

// Queue map: publicKey -> Promise chain to strictly serialize execution
const seqQueues: { [key: string]: Promise<void> } = {};

/**
 * Run SQL query with Promise wrapper
 */
export function runSQL(sql: string): Promise<any> {
  return new Promise((resolve, reject) => {
    MDS.sql(sql, (res: any) => {
      if (res.status) {
        resolve(res);
      } else {
        console.error(`❌ [SQL] Error: ${sql} ->`, res.error);
        reject(res.error);
      }
    });
  });
}

/**
 * Convert HEX string to UTF-8 string
 * Properly handles multi-byte UTF-8 sequences (accents, emojis, etc.)
 */
export function hexToUtf8(hexStr: string): string {
  // Remove whitespace and 0x prefix
  hexStr = hexStr.replace(/\s+/g, "").replace(/^0x/i, "");

  // Convert hex pairs to bytes
  const bytes: number[] = [];
  for (let i = 0; i < hexStr.length; i += 2) {
    bytes.push(parseInt(hexStr.substr(i, 2), 16));
  }

  // Decode UTF-8 byte sequence
  let str = "";
  let i = 0;
  while (i < bytes.length) {
    const byte1 = bytes[i++];

    if (byte1 < 0x80) {
      // 1-byte character (ASCII)
      str += String.fromCharCode(byte1);
    } else if (byte1 >= 0xc0 && byte1 < 0xe0) {
      // 2-byte character (català, español, etc.)
      const byte2 = bytes[i++];
      const codePoint = ((byte1 & 0x1f) << 6) | (byte2 & 0x3f);
      str += String.fromCharCode(codePoint);
    } else if (byte1 >= 0xe0 && byte1 < 0xf0) {
      // 3-byte character (Chinese, Japanese, etc.)
      const byte2 = bytes[i++];
      const byte3 = bytes[i++];
      const codePoint =
        ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
      str += String.fromCharCode(codePoint);
    } else if (byte1 >= 0xf0 && byte1 < 0xf8) {
      // 4-byte character (emojis, etc.)
      const byte2 = bytes[i++];
      const byte3 = bytes[i++];
      const byte4 = bytes[i++];
      let codePoint =
        ((byte1 & 0x07) << 18) |
        ((byte2 & 0x3f) << 12) |
        ((byte3 & 0x3f) << 6) |
        (byte4 & 0x3f);
      // Convert to surrogate pair
      codePoint -= 0x10000;
      str += String.fromCharCode(0xd800 + (codePoint >> 10));
      str += String.fromCharCode(0xdc00 + (codePoint & 0x3ff));
    }
  }

  return str;
}

/**
 * Convert UTF-8 string to HEX string
 */
export function utf8ToHex(s: string): string {
  const encoder = new TextEncoder();
  let r = "";
  for (const b of encoder.encode(s)) r += ("0" + b.toString(16)).slice(-2);
  return r;
}

/**
 * Escape single quotes for SQL safety
 */
export function escapeSql(str: string): string {
  if (!str) return str;
  return str.replace(/'/g, "''");
}

/**
 * Initialize all database tables
 */
export async function initDB(): Promise<void> {
  return new Promise((resolve) => {
    const createMessagesTable = `
            CREATE TABLE IF NOT EXISTS CHAT_MESSAGES (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                roomname VARCHAR(255) NOT NULL,
                publickey VARCHAR(512) NOT NULL,
                username VARCHAR(255) NOT NULL,
                type VARCHAR(32) NOT NULL,
                message TEXT,
                filedata TEXT,
                state VARCHAR(32) DEFAULT 'delivered',
                amount DECIMAL(30,8) DEFAULT 0,
                date BIGINT NOT NULL,
                txpowid VARCHAR(256),
                customid VARCHAR(512)
            )`;

    MDS.sql(createMessagesTable, (res: any) => {
      if (!res.status) {
        console.error(
          "❌ [DB] Failed to create CHAT_MESSAGES table:",
          res.error,
        );
      } else {

        // Migration: Add txpowid column if not exists (for receiver-side confirmation)
        const alterSql =
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS txpowid VARCHAR(256)";
        MDS.sql(alterSql, (alterRes: any) => {
          if (alterRes.status)
            console.log(
              "📂 [DB] txpowid column added/verified in CHAT_MESSAGES",
            );
        });

        // Migration: Add sender_seq column for sequence tracking
        const alterSql2 =
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS sender_seq INT DEFAULT 0";
        MDS.sql(alterSql2, (alterRes: any) => {
          if (alterRes.status)
            console.log(
              "📂 [DB] sender_seq column added/verified in CHAT_MESSAGES",
            );
        });

        // Migration: Add original_timestamp column for cross-peer sorting
        const alterSql3 =
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS original_timestamp BIGINT DEFAULT 0";
        MDS.sql(alterSql3, (alterRes: any) => {
          if (alterRes.status)
            console.log(
              "📂 [DB] original_timestamp column added/verified in CHAT_MESSAGES",
            );
        });

        // Migration: Add customid column for deduplication
        const alterSql4 =
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS customid VARCHAR(512)";
        MDS.sql(alterSql4, (alterRes: any) => {
          if (alterRes.status)
            console.log(
              "📂 [DB] customid column added/verified in CHAT_MESSAGES",
            );
            // Force upgrade length if already exists
            MDS.sql(
              "ALTER TABLE CHAT_MESSAGES ALTER COLUMN customid SET DATA TYPE VARCHAR(512)",
              () => {},
            );
        });

        // Migration: Add virtual column for case-insensitive publickey lookup
        const alterSql5 =
          "ALTER TABLE CHAT_MESSAGES ADD COLUMN IF NOT EXISTS publickey_upper VARCHAR(512) AS UPPER(publickey)";
        MDS.sql(alterSql5, () => {
          console.log(
            "📂 [DB] virtual publickey_upper column added to CHAT_MESSAGES",
          );
        });
      }
    });

    const createStatusTable = `
            CREATE TABLE IF NOT EXISTS CHAT_STATUS (
                publickey VARCHAR(512) PRIMARY KEY,
                last_read BIGINT DEFAULT 0,
                unread_count INT DEFAULT 0,
                app_installed BOOLEAN DEFAULT FALSE,
                archived BOOLEAN DEFAULT FALSE,
                archived_date BIGINT,
                last_opened BIGINT,
                muted BOOLEAN DEFAULT FALSE,
                favorite BOOLEAN DEFAULT FALSE
            )`;

    MDS.sql(createStatusTable, (res: any) => {
      if (!res.status) {
      } else {
        // Add columns if they don't exist (migration for existing databases)
        const alterSql1 =
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS app_installed BOOLEAN DEFAULT FALSE";
        const alterSql2 =
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE";
        const alterSql3 =
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS archived_date BIGINT";
        const alterSql4 =
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS last_opened BIGINT";
        const alterSql5 =
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS muted BOOLEAN DEFAULT FALSE";
        const alterSql6 =
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE";
        const alterSql7 =
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE";
        const alterSql8 =
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked_by_them BOOLEAN DEFAULT FALSE";

        MDS.sql(alterSql1, () => {});
        MDS.sql(alterSql2, () => {});
        MDS.sql(alterSql3, () => {});
        MDS.sql(alterSql4, () => {});
        MDS.sql(alterSql5, () => {});
        MDS.sql(alterSql6, () => {});
        MDS.sql(alterSql7, () => {});
        MDS.sql(alterSql8, () => {});

        // Migration: Add virtual column for case-insensitive publickey lookup
        const alterSql9 =
          "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS publickey_upper VARCHAR(512) AS UPPER(publickey)";
        MDS.sql(alterSql9, () => {
          console.log(
            "📂 [DB] virtual publickey_upper column added to CHAT_STATUS",
          );
        });
      }
    });

    // Create TRANSACTIONS table for tracking transaction status
    const createTransactionsTable = `
            CREATE TABLE IF NOT EXISTS TRANSACTIONS (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                txpowid VARCHAR(256) UNIQUE,
                type VARCHAR(32) NOT NULL,
                publickey VARCHAR(512) NOT NULL,
                message_timestamp BIGINT NOT NULL,
                status VARCHAR(32) NOT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                metadata TEXT,
                pendinguid VARCHAR(512)
            )`;

    MDS.sql(createTransactionsTable, (res: any) => {
      if (!res.status) {
        console.error(
          "❌ [DB] Failed to create TRANSACTIONS table:",
          res.error,
        );
        resolve();
      } else {

        // Migration 1: Add pendinguid column if it doesn't exist
        const alterSql1 =
          "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS pendinguid VARCHAR(512)";
        MDS.sql(alterSql1, (alterRes: any) => {
          if (alterRes.status) {
          }

          // Migration: Add virtual column for case-insensitive publickey lookup
          const alterSql2 =
            "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS publickey_upper VARCHAR(512) AS UPPER(publickey)";
          MDS.sql(alterSql2, () => {
            console.log(
              "📂 [DB] virtual publickey_upper column added to TRANSACTIONS",
            );
          });

          // Create PROFILES table for local storage of extended profile data
          const createProfilesTable = `
                        CREATE TABLE IF NOT EXISTS PROFILES (
                            pubkey VARCHAR(512) PRIMARY KEY,
                            username VARCHAR(255),
                            location VARCHAR(255),
                            website VARCHAR(255),
                            bio TEXT,
                            last_seen BIGINT
                        )`;

          MDS.sql(createProfilesTable, (res: any) => {
            if (!res.status) {
              console.error(
                "❌ [DB] Failed to create PROFILES table:",
                res.error,
              );
            } else {
            }

            // Create MY_PROFILE table (Mirroring Service Worker for safety)
            const createMyProfileTable = `
                            CREATE TABLE IF NOT EXISTS MY_PROFILE (
                                id INT PRIMARY KEY,
                                avatar TEXT,
                                tags TEXT,
                                bio_extended TEXT,
                                social_links TEXT,
                                location TEXT,
                                country TEXT,
                                languages TEXT,
                                website TEXT,
                                email TEXT,
                                phone TEXT,
                                allow_non_contact_chats BOOLEAN DEFAULT TRUE,
                                privacy_l2 VARCHAR(20) DEFAULT 'public',
                                privacy_l3 VARCHAR(20) DEFAULT 'personal',
                                last_updated BIGINT
                            )`;

            MDS.sql(createMyProfileTable, (res: any) => {
              if (res.status) {
                MDS.sql("INSERT IGNORE INTO MY_PROFILE (id) VALUES (1)");
                // Migrations for existing tables
                MDS.sql(
                  "ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l2 VARCHAR(20) DEFAULT 'public'",
                );
                MDS.sql(
                  "ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l3 VARCHAR(20) DEFAULT 'personal'",
                );
                MDS.sql(
                  "ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE",
                );
              }
            });

            // Create GROUPS table for group chat functionality
            const createGroupsTable = `
                            CREATE TABLE IF NOT EXISTS GROUPS (
                                group_id VARCHAR(256) PRIMARY KEY,
                                name VARCHAR(255) NOT NULL,
                                creator_publickey VARCHAR(512) NOT NULL,
                                created_date BIGINT NOT NULL,
                                avatar TEXT,
                                description TEXT,
                                archived BOOLEAN DEFAULT FALSE,
                                archived_date BIGINT,
                                favorite BOOLEAN DEFAULT FALSE,
                                auto_approve BOOLEAN DEFAULT FALSE,
                                is_public BOOLEAN DEFAULT FALSE
                            )`;

            MDS.sql(createGroupsTable, (res: any) => {
              if (!res.status) {
                console.error(
                  "❌ [DB] Failed to create GROUPS table:",
                  res.error,
                );
              } else {
                MDS.sql(
                  "ALTER TABLE GROUPS ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE",
                  () => {},
                );
                MDS.sql(
                  "ALTER TABLE GROUPS ADD COLUMN IF NOT EXISTS archived_date BIGINT",
                  () => {},
                );
                MDS.sql(
                  "ALTER TABLE GROUPS ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE",
                  () => {},
                );
                MDS.sql(
                  "ALTER TABLE GROUPS ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE",
                  () => {},
                );
                MDS.sql(
                  "ALTER TABLE GROUPS ADD COLUMN IF NOT EXISTS auto_approve BOOLEAN DEFAULT FALSE",
                  () => {},
                );
              }

              // Create GROUP_MEMBERS table
              const createGroupMembersTable = `
                                CREATE TABLE IF NOT EXISTS GROUP_MEMBERS (
                                    group_id VARCHAR(256) NOT NULL,
                                    publickey VARCHAR(512) NOT NULL,
                                    username VARCHAR(255) NOT NULL,
                                    joined_date BIGINT NOT NULL,
                                    role VARCHAR(32) DEFAULT 'member',
                                    PRIMARY KEY (group_id, publickey)
                                )`;

              MDS.sql(createGroupMembersTable, (res: any) => {
                if (!res.status) {
                  console.error(
                    "❌ [DB] Failed to create GROUP_MEMBERS table:",
                    res.error,
                  );
                } else {
                }

                // Create GROUP_MESSAGES table
                const createGroupMessagesTable = `
                                    CREATE TABLE IF NOT EXISTS GROUP_MESSAGES (
                                        id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                        group_id VARCHAR(256) NOT NULL,
                                        sender_publickey VARCHAR(512) NOT NULL,
                                        sender_username VARCHAR(255) NOT NULL,
                                        type VARCHAR(32) NOT NULL,
                                        message TEXT,
                                        filedata TEXT,
                                        date BIGINT NOT NULL,
                                        read INTEGER DEFAULT 0,
                                        propagated INTEGER DEFAULT 0
                                    )`;

                MDS.sql(createGroupMessagesTable, (res: any) => {
                  if (!res.status) {
                    console.error(
                      "❌ [DB] Failed to create GROUP_MESSAGES table:",
                      res.error,
                    );
                  } else {

                    // Migration: Add propagated column if it doesn't exist
                    const alterSql =
                      "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS propagated INTEGER DEFAULT 0";
                    MDS.sql(alterSql, (alterRes: any) => {
                      if (alterRes.status)
                        console.log(
                          "📂 [DB] propagated column added/verified in GROUP_MESSAGES",
                        );
                    });

                    // Migration: Add sender_seq column for gap detection
                    const alterSeqSql =
                      "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS sender_seq INTEGER DEFAULT 0";
                    MDS.sql(alterSeqSql, (seqRes: any) => {
                      if (seqRes.status)
                        console.log(
                          "📂 [DB] sender_seq column added/verified in GROUP_MESSAGES",
                        );
                    });

                    // Migration: Add customid column for deduplication (same as CHAT_MESSAGES)
                    const alterCustomIdSql =
                      "ALTER TABLE GROUP_MESSAGES ADD COLUMN IF NOT EXISTS customid VARCHAR(512)";
                    MDS.sql(alterCustomIdSql, (customRes: any) => {
                      if (customRes.status)
                        console.log(
                          "📂 [DB] customid column added/verified in GROUP_MESSAGES",
                        );
                      // Force upgrade length if already exists
                      MDS.sql(
                        "ALTER TABLE GROUP_MESSAGES ALTER COLUMN customid SET DATA TYPE VARCHAR(512)",
                        () => {},
                      );
                    });

                    // Create GROUP_MSG_COUNTERS table for per-sender sequence tracking
                    const createCountersTable = `
                      CREATE TABLE IF NOT EXISTS GROUP_MSG_COUNTERS (
                        group_id VARCHAR(256) NOT NULL,
                        sender_publickey VARCHAR(512) NOT NULL,
                        last_seen_seq INTEGER DEFAULT 0,
                        my_next_seq INTEGER DEFAULT 1,
                        PRIMARY KEY (group_id, sender_publickey)
                      )`;
                    MDS.sql(createCountersTable, (cRes: any) => {
                      if (cRes.status)
                        console.log(
                          "📂 [DB] GROUP_MSG_COUNTERS table initialized",
                        );
                    });
                  }

                  // Create GROUP_BANS table
                  const createGroupBansTable = `
                                    CREATE TABLE IF NOT EXISTS GROUP_BANS (
                                        group_id VARCHAR(256) NOT NULL,
                                        publickey VARCHAR(512) NOT NULL,
                                        username VARCHAR(255) DEFAULT 'Unknown',
                                        banned_by VARCHAR(512) NOT NULL,
                                        banned_at BIGINT NOT NULL,
                                        PRIMARY KEY (group_id, publickey)
                                    )`;

                  MDS.sql(createGroupBansTable, (res: any) => {
                    if (!res.status) {
                      console.error(
                        "❌ [DB] Failed to create GROUP_BANS table:",
                        res.error,
                      );
                    } else {
                      // Migration
                      MDS.sql(
                        "ALTER TABLE GROUP_BANS ADD COLUMN IF NOT EXISTS username VARCHAR(255) DEFAULT 'Unknown'",
                        () => {},
                      );
                    }
                  });

                  // Create CONTACT_REQUESTS table for bidirectional contact requests
                  const createContactRequestsTable = `
                                        CREATE TABLE IF NOT EXISTS CONTACT_REQUESTS (
                                            id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                            from_publickey VARCHAR(512) NOT NULL,
                                            from_name VARCHAR(255),
                                            from_avatar TEXT,
                                            from_address VARCHAR(1024),
                                            to_publickey VARCHAR(512) NOT NULL,
                                            status VARCHAR(32) DEFAULT 'pending',
                                            created_at BIGINT NOT NULL,
                                            updated_at BIGINT
                                        )`;

                  MDS.sql(createContactRequestsTable, (res: any) => {
                    if (!res.status) {
                      console.error(
                        "❌ [DB] Failed to create CONTACT_REQUESTS table:",
                        res.error,
                      );
                    } else {
                    }

                    // Migration: Add virtual column for case-insensitive publickey lookup
                    const vCol1 =
                      "ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_publickey_upper VARCHAR(512) AS UPPER(from_publickey)";
                    const vCol2 =
                      "ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS to_publickey_upper VARCHAR(512) AS UPPER(to_publickey)";
                    MDS.sql(vCol1, () => {});
                    MDS.sql(vCol2, () => {});

                    // Add from_address column if it doesn't exist (for existing tables)
                    const addFromAddressColumn = `ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_address VARCHAR(1024)`;
                    MDS.sql(addFromAddressColumn, (res: any) => {
                      if (!res.status) {
                        console.log(
                          "ℹ️ [DB] from_address column already exists or error:",
                          res.error,
                        );
                      } else {
                        console.log(
                          "📂 [DB] from_address column added/verified",
                        );
                      }

                      // Migration: Add virtual column for case-insensitive publickey lookup
                      const vCol1 =
                        "ALTER TABLE METACHAIN_USERS ADD COLUMN IF NOT EXISTS publickey_upper VARCHAR(512) AS UPPER(publickey)";
                      MDS.sql(vCol1, () => {
                        console.log(
                          "📂 [DB] virtual publickey_upper column added to METACHAIN_USERS",
                        );
                      });
                    });

                    // Create table for Maxima contact requests
                    const createMaximaContactRequestsTable = `
                                            CREATE TABLE IF NOT EXISTS MAXIMA_CONTACT_REQUESTS (
                                                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                                from_publickey VARCHAR(512) NOT NULL,
                                                from_name VARCHAR(255),
                                                to_publickey VARCHAR(512) NOT NULL,
                                                status VARCHAR(32) DEFAULT 'pending',
                                                created_at BIGINT NOT NULL,
                                                updated_at BIGINT
                                            )`;

                    MDS.sql(createMaximaContactRequestsTable, (res: any) => {
                      if (!res.status) {
                        console.error(
                          "❌ [DB] Failed to create MAXIMA_CONTACT_REQUESTS table:",
                          res.error,
                        );
                      } else {
                        console.log(
                          "📂 [DB] MAXIMA_CONTACT_REQUESTS table initialized",
                        );

                        // Migration: Add virtual column for case-insensitive publickey lookup
                        const vCol1 =
                          "ALTER TABLE MAXIMA_CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_publickey_upper VARCHAR(512) AS UPPER(from_publickey)";
                        const vCol2 =
                          "ALTER TABLE MAXIMA_CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS to_publickey_upper VARCHAR(512) AS UPPER(to_publickey)";
                        MDS.sql(vCol1, () => {});
                        MDS.sql(vCol2, () => {});

                        // Ensure DISCOVERED_PEERS has allow_non_contact_chats (Crucial for contact info perm detection)
                        // This is also done in SW, but we must ensure it exists here too if SW hasn't run.
                        const alterDiscoverySql =
                          "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE";
                        MDS.sql(alterDiscoverySql, (alterRes: any) => {
                          if (alterRes.status)
                            console.log(
                              "📂 [DB] Verified DISCOVERED_PEERS allow_non_contact_chats column",
                            );
                        });
                      }
                      // Create CHANNELS table
                      const createChannelsTable = `
                        CREATE TABLE IF NOT EXISTS CHANNELS (
                          channel_id VARCHAR(256) PRIMARY KEY,
                          name VARCHAR(255) NOT NULL,
                          description TEXT,
                          admin_publickey VARCHAR(512) NOT NULL,
                          created_date BIGINT NOT NULL,
                          avatar TEXT,
                          archived BOOLEAN DEFAULT FALSE,
                          archived_date BIGINT,
                          favorite BOOLEAN DEFAULT FALSE,
                          is_public BOOLEAN DEFAULT FALSE
                        )`;

                      MDS.sql(createChannelsTable, (cRes: any) => {
                        if (!cRes.status) {
                          console.error(
                            "❌ [DB] Failed to create CHANNELS table:",
                            cRes.error,
                          );
                        } else {

                          // Migration: Add columns
                          MDS.sql(
                            "ALTER TABLE CHANNELS ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE",
                            () => {},
                          );
                          MDS.sql(
                            "ALTER TABLE CHANNELS ADD COLUMN IF NOT EXISTS archived_date BIGINT",
                            () => {},
                          );
                          MDS.sql(
                            "ALTER TABLE CHANNELS ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE",
                            () => {},
                          );
                          MDS.sql(
                            "ALTER TABLE CHANNELS ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE",
                            () => {},
                          );

                          // Create CHANNEL_SUBSCRIBERS
                          const createChannelSubscribersTable = `
                            CREATE TABLE IF NOT EXISTS CHANNEL_SUBSCRIBERS (
                              channel_id VARCHAR(256) NOT NULL,
                              publickey VARCHAR(512) NOT NULL,
                              username VARCHAR(255) NOT NULL,
                              joined_date BIGINT NOT NULL,
                              role VARCHAR(32) DEFAULT 'subscriber',
                              PRIMARY KEY (channel_id, publickey)
                            )`;
                          MDS.sql(
                            createChannelSubscribersTable,
                            (csRes: any) => {
                              if (!csRes.status) {
                                console.error(
                                  "❌ [DB] Failed to create CHANNEL_SUBSCRIBERS table:",
                                  csRes.error,
                                );
                              } else {
                                console.log(
                                  "📂 [DB] CHANNEL_SUBSCRIBERS table initialized",
                                );
                              }
                            },
                          );

                          // Create CHANNEL_MESSAGES if not exists (redundant but safe)
                          const createChannelMessagesTable = `
                            CREATE TABLE IF NOT EXISTS CHANNEL_MESSAGES (
                              id BIGINT AUTO_INCREMENT PRIMARY KEY,
                              channel_id VARCHAR(256) NOT NULL,
                              sender_publickey VARCHAR(512) NOT NULL,
                              sender_username VARCHAR(255) NOT NULL,
                              type VARCHAR(32) NOT NULL,
                              message TEXT,
                              filedata TEXT,
                              date BIGINT NOT NULL,
                              read INTEGER DEFAULT 0,
                              sender_seq INT DEFAULT 0
                            )`;
                          MDS.sql(createChannelMessagesTable, (cmRes: any) => {
                            if (cmRes.status) {
                              MDS.sql(
                                "ALTER TABLE CHANNEL_MESSAGES ADD COLUMN IF NOT EXISTS sender_seq INT DEFAULT 0",
                                () => {},
                              );
                            }
                          });

                          // Create CHANNEL_MSG_COUNTERS
                          const createChannelCountersTable = `
                            CREATE TABLE IF NOT EXISTS CHANNEL_MSG_COUNTERS (
                              channel_id VARCHAR(256) NOT NULL,
                              sender_publickey VARCHAR(512) NOT NULL,
                              last_seen_seq INT NOT NULL DEFAULT 0,
                              my_next_seq INT NOT NULL DEFAULT 1,
                              PRIMARY KEY (channel_id, sender_publickey)
                            )`;
                          MDS.sql(createChannelCountersTable, (ccRes: any) => {
                            if (ccRes.status) {
                              console.log(
                                "📂 [DB] CHANNEL_MSG_COUNTERS table initialized",
                              );
                            }
                          });
                        }
                        resolve();
                      });
                    });
                  });
                });
              });
            });

            // Create MESSAGE_COUNTERS table for sequence tracking
            const createMessageCountersTable = `
                            CREATE TABLE IF NOT EXISTS MESSAGE_COUNTERS (
                                publickey VARCHAR(512) PRIMARY KEY,
                                next_seq INT NOT NULL DEFAULT 1
                            )`;

            MDS.sql(createMessageCountersTable, (res: any) => {
              if (!res.status) {
                console.error(
                  "❌ [DB] Failed to create MESSAGE_COUNTERS table:",
                  res.error,
                );
              } else {
              }

              // Create DISCOVERED_PEERS table
              const createDiscoveredPeersTable = `
                                CREATE TABLE IF NOT EXISTS DISCOVERED_PEERS (
                                    publickey VARCHAR(512) PRIMARY KEY,
                                    address VARCHAR(1024),
                                    alias VARCHAR(255),
                                    avatar TEXT,
                                    last_seen BIGINT,
                                    allow_non_contact_chats BOOLEAN DEFAULT TRUE,
                                    source VARCHAR(20) DEFAULT 'P2P'
                                )`;

              MDS.sql(createDiscoveredPeersTable, (res: any) => {
                if (!res.status) {
                  console.error(
                    "❌ [DB] Failed to create DISCOVERED_PEERS table:",
                    res.error,
                  );
                } else {

                  // Ensure source column exists (migration)
                  MDS.sql(
                    "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'P2P'",
                    (alterRes: any) => {
                      if (alterRes.status)
                        console.log(
                          "📂 [DB] Verified DISCOVERED_PEERS source column",
                        );
                    },
                  );

                  // Migration: Add virtual column for case-insensitive publickey lookup
                  const vCol1 =
                    "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS publickey_upper VARCHAR(512) AS UPPER(publickey)";
                  MDS.sql(vCol1, () => {
                    console.log(
                      "📂 [DB] virtual publickey_upper column added to DISCOVERED_PEERS",
                    );
                  });
                }

                // Create METACHAIN_USERS table
                const createMetachainUsersTable = `
                                    CREATE TABLE IF NOT EXISTS METACHAIN_USERS (
                                        publickey VARCHAR(512) PRIMARY KEY,
                                        alias VARCHAR(255),
                                        avatar TEXT,
                                        last_seen BIGINT
                                    )`;

                MDS.sql(createMetachainUsersTable, (res: any) => {
                  if (!res.status) {
                    console.error(
                      "❌ [DB] Failed to create METACHAIN_USERS table:",
                      res.error,
                    );
                  } else {
                    // Schema parity with Service Worker variant
                    MDS.sql(
                      "ALTER TABLE METACHAIN_USERS ADD COLUMN IF NOT EXISTS user_id VARCHAR(512)",
                      () => {},
                    );
                    MDS.sql(
                      "ALTER TABLE METACHAIN_USERS ADD COLUMN IF NOT EXISTS address VARCHAR(512)",
                      () => {},
                    );
                    MDS.sql(
                      "ALTER TABLE METACHAIN_USERS ADD COLUMN IF NOT EXISTS first_seen BIGINT",
                      () => {},
                    );
                    MDS.sql(
                      "ALTER TABLE METACHAIN_USERS ADD COLUMN IF NOT EXISTS last_updated BIGINT",
                      () => {},
                    );
                  }

                  // Create DISCOVERED_LISTINGS table
                  const createDiscoveredListingsTable = `
                                        CREATE TABLE IF NOT EXISTS DISCOVERED_LISTINGS (
                                            owner_publickey VARCHAR(512) PRIMARY KEY,
                                            listings CLOB,
                                            timestamp BIGINT,
                                            last_seen BIGINT
                                        )`;

                  MDS.sql(createDiscoveredListingsTable, (listRes: any) => {
                    if (!listRes.status) {
                      console.error(
                        "❌ [DB] Failed to create DISCOVERED_LISTINGS table:",
                        listRes.error,
                      );
                    } else {
                      console.log(
                        "📂 [DB] DISCOVERED_LISTINGS table initialized",
                      );
                      MDS.sql(
                        "ALTER TABLE DISCOVERED_LISTINGS ADD COLUMN IF NOT EXISTS listings CLOB",
                        () => {},
                      );
                      MDS.sql(
                        "ALTER TABLE DISCOVERED_LISTINGS ADD COLUMN IF NOT EXISTS timestamp BIGINT",
                        () => {},
                      );
                      MDS.sql(
                        "ALTER TABLE DISCOVERED_LISTINGS ADD COLUMN IF NOT EXISTS last_seen BIGINT",
                        () => {},
                      );
                    }
                  });

                  // Create SESSION_UID table for APK logic
                  const createSessionUidTable = `
                                        CREATE TABLE IF NOT EXISTS SESSION_UID (
                                            id INT PRIMARY KEY,
                                            session_uid VARCHAR(1024) NOT NULL,
                                            updated_at BIGINT NOT NULL
                                        )`;

                  MDS.sql(createSessionUidTable, (res: any) => {
                    if (!res.status) {
                      console.error(
                        "❌ [DB] Failed to create SESSION_UID table:",
                        res.error,
                      );
                    }
                  });
                });
              });
            });
          });
        });
      }
    });
  });
}

/**
 * Helper to resolve a public key (0x...) to a Maxima Address (Mx...) using DISCOVERED_PEERS
 */
export async function resolveMaximaAddress(
  publicKey: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const safePubkey = escapeSql(publicKey);
    const sql = `SELECT address FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${safePubkey}')`;

    MDS.sql(sql, (res: any) => {
      if (res.status && res.rows && res.rows.length > 0) {
        const address = res.rows[0].ADDRESS;
        console.log(
          `📍 [RESOLVE] Found Maxima Address for ${publicKey.substring(0, 15)}...: ${address}`,
        );
        resolve(address);
      } else {
        console.log(
          `📍 [RESOLVE] No Maxima Address found for ${publicKey.substring(0, 15)}...`,
        );
        resolve(null);
      }
    });
  });
}

/**
 * ATOMIC: Get the next sequence number AND increment it in one operation
 * This uses an in-memory Mutex (Promise chaining) to ensure multiple rapid calls
 * for the same user are strictly serialized, preventing race conditions even if
 * the underlying SQL operations are asynchronous/interleaved.
 */
export function getAndIncrementSequenceNumber(
  publicKey: string,
): Promise<number> {
  // 1. Get the current tail of the promise chain (or start new)
  const previousTask = seqQueues[publicKey] || Promise.resolve();

  // 2. Chain our new task to run AFTER the previous one finishes
  const myTask = previousTask.then(() => {
    return new Promise<number>((resolve, reject) => {
      const safePubkey = escapeSql(publicKey);

      // Step 1: Check if counter exists
      const checkSql = `SELECT next_seq FROM MESSAGE_COUNTERS WHERE UPPER(publickey)=UPPER('${safePubkey}')`;

      MDS.sql(checkSql, (res: any) => {
        if (res.status && res.rows && res.rows.length > 0) {
          // Counter exists - get current value
          const currentSeq = parseInt(res.rows[0].NEXT_SEQ);

          // Step 2: Increment atomically
          const updateSql = `UPDATE MESSAGE_COUNTERS SET next_seq = next_seq + 1 WHERE UPPER(publickey)=UPPER('${safePubkey}')`;

          MDS.sql(updateSql, (updateRes: any) => {
            if (updateRes.status) {
              console.log(
                `📊 [SEQ-MUTEX] Got seq ${currentSeq}, incremented to ${currentSeq + 1} for ${safePubkey.substring(0, 20)}...`,
              );
              resolve(currentSeq);
            } else {
              console.error(
                `❌ [SEQ-MUTEX] Failed to increment: ${updateRes.error}`,
              );
              reject(updateRes.error);
            }
          });
        } else {
          // Counter doesn't exist - create it starting at 2 (we'll return 1)
          const insertSql = `INSERT INTO MESSAGE_COUNTERS (publickey, next_seq) VALUES ('${safePubkey}', 2)`;

          MDS.sql(insertSql, (insertRes: any) => {
            if (insertRes.status) {
              console.log(
                `📊 [SEQ-MUTEX] Created counter for ${safePubkey.substring(0, 20)}..., returning 1`,
              );
              resolve(1);
            } else {
              console.error(
                `❌ [SEQ-MUTEX] Failed to create counter: ${insertRes.error}`,
              );
              reject(insertRes.error);
            }
          });
        }
      });
    });
  });

  // 3. Update the queue tail so the next request waits for US
  // catch() ensures failures don't block the queue forever
  seqQueues[publicKey] = myTask
    .then(() => {})
    .catch((err) => {
      console.warn(`⚠️ [SEQ-MUTEX] Task failed, queue continuing:`, err);
    });

  // 4. Return our result
  return myTask;
}

/**
 * ATOMIC: Get the next sequence number for a CHANNEL AND increment it
 */
export function getAndIncrementChannelSequenceNumber(
  channelId: string,
  publicKey: string,
): Promise<number> {
  const queueKey = `CHANNEL_${channelId}_${publicKey}`;
  const previousTask = seqQueues[queueKey] || Promise.resolve();

  const myTask = previousTask.then(() => {
    return new Promise<number>((resolve, reject) => {
      const safeChannelId = escapeSql(channelId);
      const safePubkey = escapeSql(publicKey);

      const checkSql = `SELECT my_next_seq FROM CHANNEL_MSG_COUNTERS WHERE channel_id='${safeChannelId}' AND UPPER(sender_publickey)=UPPER('${safePubkey}')`;

      MDS.sql(checkSql, (res: any) => {
        if (res.status && res.rows && res.rows.length > 0) {
          const currentSeq = parseInt(res.rows[0].MY_NEXT_SEQ);
          const updateSql = `UPDATE CHANNEL_MSG_COUNTERS SET my_next_seq = my_next_seq + 1 WHERE channel_id='${safeChannelId}' AND UPPER(sender_publickey)=UPPER('${safePubkey}')`;

          MDS.sql(updateSql, (updateRes: any) => {
            if (updateRes.status) {
              resolve(currentSeq);
            } else {
              reject(updateRes.error);
            }
          });
        } else {
          const insertSql = `INSERT INTO CHANNEL_MSG_COUNTERS (channel_id, sender_publickey, my_next_seq) VALUES ('${safeChannelId}', '${safePubkey}', 2)`;
          MDS.sql(insertSql, (insertRes: any) => {
            if (insertRes.status) {
              resolve(1);
            } else {
              reject(insertRes.error);
            }
          });
        }
      });
    });
  });

  seqQueues[queueKey] = myTask.then(() => {}).catch(() => {});
  return myTask;
}

/**
 * Get the next sequence number for a contact (read-only, for display purposes)
 */
export function getNextSequenceNumber(publicKey: string): Promise<number> {
  return new Promise((resolve) => {
    const safePubkey = escapeSql(publicKey);
    const sql = `SELECT next_seq FROM MESSAGE_COUNTERS WHERE UPPER(publickey)=UPPER('${safePubkey}')`;

    MDS.sql(sql, (res: any) => {
      if (res.status && res.rows && res.rows.length > 0) {
        const seq = parseInt(res.rows[0].NEXT_SEQ);
        resolve(seq);
      } else {
        // If no counter exists, start at 1
        resolve(1);
      }
    });
  });
}

/**
 * Increment the sequence number for a contact
 * NOTE: Prefer getAndIncrementSequenceNumber() to avoid race conditions
 */
export function incrementSequenceNumber(publicKey: string): Promise<void> {
  return new Promise((resolve) => {
    const safePubkey = escapeSql(publicKey);

    // Try to update existing first
    const checkSql = `SELECT next_seq FROM MESSAGE_COUNTERS WHERE UPPER(publickey)=UPPER('${safePubkey}')`;

    MDS.sql(checkSql, (res: any) => {
      if (res.status && res.rows && res.rows.length > 0) {
        // Update
        const updateSql = `UPDATE MESSAGE_COUNTERS SET next_seq = next_seq + 1 WHERE UPPER(publickey)=UPPER('${safePubkey}')`;
        MDS.sql(updateSql, () => resolve());
      } else {
        // Insert (start at 2, since we just used 1)
        const insertSql = `INSERT INTO MESSAGE_COUNTERS (publickey, next_seq) VALUES ('${safePubkey}', 2)`;
        MDS.sql(insertSql, () => resolve());
      }
    });
  });
}
