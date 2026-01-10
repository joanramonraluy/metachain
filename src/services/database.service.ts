/**
 * Database Service - Core database utilities and initialization
 * Handles: SQL wrapper, hex/utf8 conversion, table initialization
 */

import { MDS } from "@minima-global/mds";

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
    hexStr = hexStr.replace(/\s+/g, '').replace(/^0x/i, '');

    // Convert hex pairs to bytes
    const bytes: number[] = [];
    for (let i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }

    // Decode UTF-8 byte sequence
    let str = '';
    let i = 0;
    while (i < bytes.length) {
        const byte1 = bytes[i++];

        if (byte1 < 0x80) {
            // 1-byte character (ASCII)
            str += String.fromCharCode(byte1);
        } else if (byte1 >= 0xC0 && byte1 < 0xE0) {
            // 2-byte character (català, español, etc.)
            const byte2 = bytes[i++];
            const codePoint = ((byte1 & 0x1F) << 6) | (byte2 & 0x3F);
            str += String.fromCharCode(codePoint);
        } else if (byte1 >= 0xE0 && byte1 < 0xF0) {
            // 3-byte character (Chinese, Japanese, etc.)
            const byte2 = bytes[i++];
            const byte3 = bytes[i++];
            const codePoint = ((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F);
            str += String.fromCharCode(codePoint);
        } else if (byte1 >= 0xF0 && byte1 < 0xF8) {
            // 4-byte character (emojis, etc.)
            const byte2 = bytes[i++];
            const byte3 = bytes[i++];
            const byte4 = bytes[i++];
            let codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
            // Convert to surrogate pair
            codePoint -= 0x10000;
            str += String.fromCharCode(0xD800 + (codePoint >> 10));
            str += String.fromCharCode(0xDC00 + (codePoint & 0x3FF));
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
                date BIGINT NOT NULL
            )`;

        MDS.sql(createMessagesTable, (res: any) => {
            if (!res.status) {
                console.error("❌ [DB] Failed to create CHAT_MESSAGES table:", res.error);
            } else {
                console.log("📂 [DB] CHAT_MESSAGES table initialized");
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
                console.error("❌ [DB] Failed to create CHAT_STATUS table:", res.error);
            } else {
                console.log("📂 [DB] CHAT_STATUS table initialized");
                // Add columns if they don't exist (migration for existing databases)
                const alterSql1 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS app_installed BOOLEAN DEFAULT FALSE";
                const alterSql2 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE";
                const alterSql3 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS archived_date BIGINT";
                const alterSql4 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS last_opened BIGINT";
                const alterSql5 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS muted BOOLEAN DEFAULT FALSE";
                const alterSql6 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE";
                const alterSql7 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE";
                const alterSql8 = "ALTER TABLE CHAT_STATUS ADD COLUMN IF NOT EXISTS blocked_by_them BOOLEAN DEFAULT FALSE";

                MDS.sql(alterSql1, (alterRes: any) => {
                    if (alterRes.status) console.log("📂 [DB] app_installed column added/verified");
                });
                MDS.sql(alterSql2, (alterRes: any) => {
                    if (alterRes.status) console.log("📂 [DB] archived column added/verified");
                });
                MDS.sql(alterSql3, (alterRes: any) => {
                    if (alterRes.status) console.log("📂 [DB] archived_date column added/verified");
                });
                MDS.sql(alterSql4, (alterRes: any) => {
                    if (alterRes.status) console.log("📂 [DB] last_opened column added/verified");
                });
                MDS.sql(alterSql5, (alterRes: any) => {
                    if (alterRes.status) console.log("📂 [DB] muted column added/verified");
                });
                MDS.sql(alterSql6, (alterRes: any) => {
                    if (alterRes.status) console.log("📂 [DB] favorite column added/verified");
                });
                MDS.sql(alterSql7, (alterRes: any) => {
                    if (alterRes.status) console.log("📂 [DB] blocked column added/verified");
                });
                MDS.sql(alterSql8, (alterRes: any) => {
                    if (alterRes.status) console.log("📂 [DB] blocked_by_them column added/verified");
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
                pendinguid VARCHAR(128)
            )`;

        MDS.sql(createTransactionsTable, (res: any) => {
            if (!res.status) {
                console.error("❌ [DB] Failed to create TRANSACTIONS table:", res.error);
                resolve();
            } else {
                console.log("📂 [DB] TRANSACTIONS table initialized");

                // Migration 1: Add pendinguid column if it doesn't exist
                const alterSql1 = "ALTER TABLE TRANSACTIONS ADD COLUMN IF NOT EXISTS pendinguid VARCHAR(128)";
                MDS.sql(alterSql1, (alterRes: any) => {
                    if (alterRes.status) {
                        console.log("📂 [DB] pendinguid column added/verified");
                    }

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
                            console.error("❌ [DB] Failed to create PROFILES table:", res.error);
                        } else {
                            console.log("📂 [DB] PROFILES table initialized");
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
                                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l2 VARCHAR(20) DEFAULT 'public'");
                                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS privacy_l3 VARCHAR(20) DEFAULT 'personal'");
                                MDS.sql("ALTER TABLE MY_PROFILE ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE");
                                console.log("📂 [DB] MY_PROFILE table checked/initialized");
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
                                description TEXT
                            )`;

                        MDS.sql(createGroupsTable, (res: any) => {
                            if (!res.status) {
                                console.error("❌ [DB] Failed to create GROUPS table:", res.error);
                            } else {
                                console.log("📂 [DB] GROUPS table initialized");
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
                                    console.error("❌ [DB] Failed to create GROUP_MEMBERS table:", res.error);
                                } else {
                                    console.log("📂 [DB] GROUP_MEMBERS table initialized");
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
                                        read INTEGER DEFAULT 0
                                    )`;

                                MDS.sql(createGroupMessagesTable, (res: any) => {
                                    if (!res.status) {
                                        console.error("❌ [DB] Failed to create GROUP_MESSAGES table:", res.error);
                                    } else {
                                        console.log("📂 [DB] GROUP_MESSAGES table initialized");
                                    }

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
                                            console.error("❌ [DB] Failed to create CONTACT_REQUESTS table:", res.error);
                                        } else {
                                            console.log("📂 [DB] CONTACT_REQUESTS table initialized");
                                        }

                                        // Add from_address column if it doesn't exist (for existing tables)
                                        const addFromAddressColumn = `ALTER TABLE CONTACT_REQUESTS ADD COLUMN IF NOT EXISTS from_address VARCHAR(1024)`;
                                        MDS.sql(addFromAddressColumn, (res: any) => {
                                            if (!res.status) {
                                                console.log("ℹ️ [DB] from_address column already exists or error:", res.error);
                                            } else {
                                                console.log("📂 [DB] from_address column added/verified");
                                            }
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
                                                console.error("❌ [DB] Failed to create MAXIMA_CONTACT_REQUESTS table:", res.error);
                                            } else {
                                                console.log("📂 [DB] MAXIMA_CONTACT_REQUESTS table initialized");

                                                // Ensure DISCOVERED_PEERS has allow_non_contact_chats (Crucial for contact info perm detection)
                                                // This is also done in SW, but we must ensure it exists here too if SW hasn't run.
                                                const alterDiscoverySql = "ALTER TABLE DISCOVERED_PEERS ADD COLUMN IF NOT EXISTS allow_non_contact_chats BOOLEAN DEFAULT TRUE";
                                                MDS.sql(alterDiscoverySql, (alterRes: any) => {
                                                    if (alterRes.status) console.log("📂 [DB] Verified DISCOVERED_PEERS allow_non_contact_chats column");
                                                });
                                            }
                                            resolve();
                                        });
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
export async function resolveMaximaAddress(publicKey: string): Promise<string | null> {
    return new Promise((resolve) => {
        const safePubkey = escapeSql(publicKey);
        const sql = `SELECT address FROM DISCOVERED_PEERS WHERE publickey='${safePubkey}'`;

        MDS.sql(sql, (res: any) => {
            if (res.status && res.rows && res.rows.length > 0) {
                const address = res.rows[0].ADDRESS;
                console.log(`📍 [RESOLVE] Found Maxima Address for ${publicKey.substring(0, 15)}...: ${address}`);
                resolve(address);
            } else {
                console.log(`📍 [RESOLVE] No Maxima Address found for ${publicKey.substring(0, 15)}...`);
                resolve(null);
            }
        });
    });
}
