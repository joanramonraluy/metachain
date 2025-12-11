/**
 * Hex conversion utilities
 */

// Convert HEX to UTF8
export function hexToUtf8(s: string): string {
    return decodeURIComponent(
        s.replace(/\s+/g, "").replace(/[0-9A-F]{2}/g, "%$&")
    );
}

// Convert UTF8 to HEX
export function utf8ToHex(s: string): string {
    const encoder = new TextEncoder();
    let r = "";
    for (const b of encoder.encode(s)) r += ("0" + b.toString(16)).slice(-2);
    return r;
}
