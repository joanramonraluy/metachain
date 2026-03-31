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
var GOSSIP_INTERVAL = 30000; // 30 seconds (overridable via keypair discovery_interval, in seconds)
var DISCOVERY_LIMIT = 5;    // peers per gossip cycle (overridable via keypair discovery_limit)
var LAST_BEACON_TIME = 0;

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

/**
 * Helper to clean Maxima Address specifically for the port issue
 */
function cleanMaximaAddress(addr) {
    if (!addr) return "";

    // 1. Basic trim
    var s = String(addr).trim();

    // 2. CRITICAL: Remove ALL whitespace first to prevent Java NumberFormatException
    s = s.replace(/\s+/g, "");

    // 3. Split by Last Colon (Host:Port)
    var idx = s.lastIndexOf(":");

    if (idx !== -1) {
        var base = s.substring(0, idx);
        var port = s.substring(idx + 1);

        // 4. AGGRESSIVE CLEANING
        // Remove all whitespace and invalid chars from base
        var cleanBase = base.replace(/[^a-zA-Z0-9@._-]/g, "");

        // Remove everything except numbers from port
        var cleanPort = port.replace(/[^0-9]/g, "");

        if (cleanBase && cleanPort) {
            return cleanBase + ":" + cleanPort;
        }
    }

    // Fallback: Just remove all whitespace and invalid chars
    return s.replace(/\s/g, "").replace(/[^a-zA-Z0-9@:._-]/g, "");
}

/**
 * Smart Send Helper - Resolves Address from DISCOVERED_PEERS for non-contacts
 * 
 * @param {string} pubkey - Target public key
 * @param {string} application - Maxima application name
 * @param {string} hexData - Hex-encoded data
 * @param {string} logTag - Tag for logging
 * @param {boolean} usePoll - Whether to use polling (default false)
 * @param {string} forcedAddress - Optional Mx address to use directly (bypasses DB lookup)
 */
function smartSend(pubkey, application, hexData, logTag, usePoll, forcedAddress) {
    var pollStr = usePoll === true ? " poll:true" : " poll:false";
    
    // 1. If we have a forced address, use it immediately
    if (forcedAddress) {
        var cleanAddr = cleanMaximaAddress(forcedAddress);
        if (cleanAddr && (cleanAddr.startsWith("Mx") || cleanAddr.startsWith("MX"))) {
            var sendCmd = "maxima action:send to:" + cleanAddr + " application:" + application + " data:" + hexData + pollStr;
            MDS.log("🔍 [" + logTag + "] Sending via FORCED address: " + cleanAddr.substring(0, 15) + "...");
            MDS.cmd(sendCmd, function(res) {
                if (res.status) {
                    MDS.log("✅ [" + logTag + "] Sent to " + pubkey.substring(0, 10));
                } else {
                    // If forced address fails, we could fallback to publickey, but usually if forced it fails for good reasons
                    MDS.log("⚠️ [" + logTag + "] Forced send failed, trying publickey: " + res.error);
                    MDS.cmd("maxima action:send publickey:" + pubkey + " application:" + application + " data:" + hexData + pollStr);
                }
            });
            return;
        }
    }

    var safeKey = escapeSql(pubkey);
    var peerSql = "SELECT ADDRESS FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('" + safeKey + "') AND ADDRESS IS NOT NULL LIMIT 1";

    MDS.sql(peerSql, function (peerRes) {
        var sendCmd;
        if (peerRes && peerRes.status && peerRes.rows && peerRes.rows.length > 0) {
            var rawMx = peerRes.rows[0].ADDRESS || peerRes.rows[0].address;
            var mxAddress = rawMx ? cleanMaximaAddress(rawMx) : null;

            if (mxAddress && (mxAddress.startsWith("Mx") || mxAddress.startsWith("MX"))) {
                sendCmd = "maxima action:send to:" + mxAddress + " application:" + application + " data:" + hexData + pollStr;
                MDS.log("🔍 [" + logTag + "] Optimized send via address resolution: " + mxAddress.substring(0, 15) + "...");
            } else {
                sendCmd = "maxima action:send publickey:" + pubkey + " application:" + application + " data:" + hexData + pollStr;
            }
        } else {
            sendCmd = "maxima action:send publickey:" + pubkey + " application:" + application + " data:" + hexData + pollStr;
        }

        MDS.cmd(sendCmd, function (res) {
            if (res.status) {
                MDS.log("✅ [" + logTag + "] Sent to " + pubkey.substring(0, 10));
            } else {
                MDS.log("⚠️ [" + logTag + "] Failed send to " + pubkey.substring(0, 10) + ": " + res.error);
            }
        });
    });
}
