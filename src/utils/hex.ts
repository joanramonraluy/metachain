/**
 * Hex conversion utilities
 */

// Convert HEX to UTF8 - Proper UTF-8 byte sequence decoder
// Compatible with TextEncoder output
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

// Convert UTF8 to HEX
export function utf8ToHex(s: string): string {
    const encoder = new TextEncoder();
    let r = "";
    for (const b of encoder.encode(s)) r += ("0" + b.toString(16)).slice(-2);
    return r;
}

// Shorten public key for display (e.g., 0x1234...5678)
export function shortenPublicKey(pk: string | undefined | null, startChars: number = 6, endChars: number = 8): string {
    if (!pk) return "";
    if (pk.length <= startChars + endChars) return pk;
    return `${pk.substring(0, startChars)}...${pk.substring(pk.length - endChars)}`;
}
