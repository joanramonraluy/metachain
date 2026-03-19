/**
 * MetaChain Service Worker - Utilities
 * Shared functions and global variables for all handlers
 */

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

var LAST_GOSSIP = 0;
var BEACON_INTERVAL = 60000; // 1 minute
var MY_MAXIMA_PK = "";
var BEACON_CACHE = {};
var GOSSIP_INTERVAL = 60000; // 60 seconds default (Increased from 30s to reduce saturation)
var GOSSIP_LIMIT = 5; // 5 peers default
var LAST_BEACON_TIME = 0;

/**
 * Sync discovery settings from MDS keypair
 * Allows the Service Worker to respect UI settings for interval and limit
 * Includes adaptive back-off for high-peer environments
 */
function syncDiscoverySettings() {
    // 1. Fetch Interval
    MDS.keypair.get("discovery_interval", function (res) {
        if (res && res.status && res.value) {
            var val = parseInt(res.value) * 1000; // convert to ms
            if (val >= 30000) {
                GOSSIP_INTERVAL = val;
                MDS.log("⚙️ [GOSSIP-CONFIG] Interval updated from Keypair: " + (val / 1000) + "s");
            } else {
                MDS.log("⚙️ [GOSSIP-CONFIG] Using Default Interval: " + (GOSSIP_INTERVAL / 1000) + "s (Keypair value " + res.value + "s is too low)");
            }
        } else {
            MDS.log("⚙️ [GOSSIP-CONFIG] Using Default Interval: " + (GOSSIP_INTERVAL / 1000) + "s");
        }

        // 2. Fetch Limit
        MDS.keypair.get("discovery_limit", function (resLimit) {
            if (resLimit && resLimit.status && resLimit.value) {
                var lim = parseInt(resLimit.value);
                if (lim >= 1 && lim <= 50) {
                    GOSSIP_LIMIT = lim;
                    MDS.log("⚙️ [GOSSIP-CONFIG] Limit updated from Keypair: " + lim + " nodes");
                }
            } else {
                MDS.log("⚙️ [GOSSIP-CONFIG] Using Default Limit: " + GOSSIP_LIMIT + " nodes");
            }

            // 3. Adaptive Back-off: If we have many peers, slow down to reduce Maxima noise
            MDS.sql("SELECT COUNT(*) as cnt FROM DISCOVERED_PEERS", function (sqlRes) {
                if (sqlRes.status && sqlRes.rows && sqlRes.rows.length > 0) {
                    var count = parseInt(sqlRes.rows[0].CNT || 0);
                    if (count > 50) {
                        // Double the interval if we have > 50 peers
                        var original = GOSSIP_INTERVAL;
                        GOSSIP_INTERVAL = GOSSIP_INTERVAL * 2;
                        MDS.log("📈 [GOSSIP-LIMIT] Adaptive back-off active (" + count + " peers). Interval increased: " + (original / 1000) + "s -> " + (GOSSIP_INTERVAL / 1000) + "s");
                    }
                }
                MDS.log("⚙️ [GOSSIP-CONFIG] Sync complete. Interval: " + (GOSSIP_INTERVAL / 1000) + "s, Limit: " + GOSSIP_LIMIT);
            });
        });
    });
}

// ============================================================================
// HEX/UTF8 CONVERSION UTILITIES
// ============================================================================

/**
 * Convert HEX to UTF8 - Full UTF-8 Variant for MAXIMA Messages
 * Properly decodes multi-byte characters (català, emojis, etc.)
 */
function hexToUtf8(hexStr) {
    hexStr = hexStr.replace(/\s+/g, '').replace(/^0x/i, '');
    var bytes = [];
    for (var i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }

    var str = '';
    var i = 0;
    while (i < bytes.length) {
        var byte1 = bytes[i++];
        if (byte1 < 0x80) {
            str += String.fromCharCode(byte1);
        } else if (byte1 >= 0xC0 && byte1 < 0xE0) {
            var byte2 = bytes[i++];
            var codePoint = ((byte1 & 0x1F) << 6) | (byte2 & 0x3F);
            str += String.fromCharCode(codePoint);
        } else if (byte1 >= 0xE0 && byte1 < 0xF0) {
            var byte2 = bytes[i++];
            var byte3 = bytes[i++];
            var codePoint = ((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F);
            str += String.fromCharCode(codePoint);
        } else if (byte1 >= 0xF0 && byte1 < 0xF8) {
            var byte2 = bytes[i++];
            var byte3 = bytes[i++];
            var byte4 = bytes[i++];
            var codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
            codePoint -= 0x10000;
            str += String.fromCharCode(0xD800 + (codePoint >> 10));
            str += String.fromCharCode(0xDC00 + (codePoint & 0x3FF));
        }
    }
    return str;
}

/**
 * Convert HEX to UTF8 - Simple Variant for P2P Beacons
 */
function hexToUtf8Simple(hexStr) {
    hexStr = hexStr.replace(/\s+/g, '');
    var bytes = [];
    for (var i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }
    var str = '';
    for (var i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return str;
}

/**
 * Convert UTF8 to HEX
 */
function utf8ToHex(s) {
    var r = "";
    var utf8 = unescape(encodeURIComponent(s));
    for (var i = 0; i < utf8.length; i++) {
        var b = utf8.charCodeAt(i);
        r += ("0" + b.toString(16)).slice(-2);
    }
    return r;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper to determine if a privacy level should be included
 */
function shouldIncludeLevel(visibility, isContact, isPersonalContact) {
    if (visibility === 'public') return true;
    if (visibility === 'contacts' && isContact) return true;
    if (visibility === 'personal' && isPersonalContact) return true;
    return false;
}

/**
 * Safe Decode Helper - Handles Mojibake and URI encoding
 */
function safeDecode(str) {
    if (!str) return str;

    // 1. Try resolving Mojibake
    try {
        if (/[ÃÂÅÄ]/.test(str)) {
            var bytes = new Uint8Array(str.length);
            for (var i = 0; i < str.length; i++) {
                var code = str.charCodeAt(i);
                if (code > 255) { }
                bytes[i] = code;
            }
            var decoder = new TextDecoder('utf-8');
            var decoded = decoder.decode(bytes);
            if (decoded !== str && decoded.indexOf('\uFFFD') === -1) {
                str = decoded;
            }
        }
    } catch (e) { }

    // 2. Try URI decoding
    try {
        if (str.indexOf('%') !== -1) {
            str = decodeURIComponent(str);
        }
    } catch (e) { }

    // 3. Known Manual Fixes
    if (str && typeof str === 'string') {
        if (str.indexOf('Catalan') !== -1 && (str.indexOf('Catal') !== -1 || str.indexOf('CatalÃ') !== -1)) return 'Catalan (Català)';
        if (str.indexOf('Spanish') !== -1 && (str.indexOf('Espa') !== -1 || str.indexOf('EspaÃ±') !== -1)) return 'Spanish (Español)';
        if (str.indexOf('Basque') !== -1 && str.indexOf('Euskera') !== -1) return 'Basque (Euskera)';
    }

    return str;
}

/**
 * SQL Escape helper
 */
function escapeSql(str) {
    return (str || '').replace(/'/g, "''");
}
/**
 * Log to both SW and Frontend (via solo comms)
 */
function logToUI(msg) {
    MDS.log(msg);
    try {
        if (typeof MDS !== 'undefined' && MDS.comms && MDS.comms.solo) {
            MDS.comms.solo(JSON.stringify({
                type: "SW_LOG",
                message: msg,
                timestamp: Date.now()
            }));
        }
    } catch (e) { }
}
