
/**
 * Sanitizes a URL to prevent XSS attacks (e.g. javascript: protocol).
 * Returns the URL if safe, or undefined if unsafe.
 * 
 * @param url The URL to sanitize
 * @param allowedProtocols List of allowed protocols. Defaults to ['http', 'https']
 */
export function safeUrl(url: string | undefined, allowedProtocols: string[] = ['http', 'https']): string | undefined {
    if (!url) return undefined;

    const trimmed = url.trim();

    // 1. Block obviously dangerous protocols immediately (case insensitive)
    if (/^\s*(javascript|vbscript|data):/i.test(trimmed)) {
        return undefined;
    }

    // 2. Check if it has a protocol
    const protocolMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);

    if (protocolMatch) {
        // Has protocol - must be in allowlist
        const protocol = protocolMatch[1].toLowerCase();
        if (allowedProtocols.includes(protocol)) {
            return trimmed;
        }
        return undefined; // Unknown/disallowed protocol
    }

    // 3. No protocol - Prepend https:// as default for websites
    // Only if https is allowed
    if (allowedProtocols.includes('https')) {
        return 'https://' + trimmed;
    }

    return undefined;
}

/**
 * Validates text input to ensure it doesn't contain simple HTML/Script tags.
 * Note: React escapes by default, but this can be used for extra validation before saving.
 */
export function validateSafeText(text: string): boolean {
    // Basic check for script tags or HTML-like structures
    if (/<script\b[^>]*>([\s\S]*?)<\/script>/gm.test(text)) return false;
    if (/javascript:/i.test(text)) return false;
    return true;
}
