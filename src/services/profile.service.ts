/**
 * Profile Service
 * Handles extended profile requests via P2P using Maxima addresses
 */

import { MDS } from "@minima-global/mds";

export interface ExtendedProfile {
  name: string;
  avatar: string;
  bio: string;
  // Level 2 - Optional
  location?: string;
  country?: string;
  languages?: string[];
  website?: string;
  social?: {
    twitter?: string;
    linkedin?: string;
    github?: string;
  };
  // Level 3 - Optional
  email?: string;
  phone?: string;
  // Chat permissions
  allowNonContactChats?: boolean;
  // Privacy Status
  privacy_l2?: string; // 'hidden' if restricted
  privacy_l3?: string; // 'hidden' if restricted
}

// Pending profile requests
const pendingRequests = new Map<
  string,
  {
    resolve: (profile: ExtendedProfile) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }
>();
const inFlightRequests = new Map<string, Promise<ExtendedProfile>>();
const lastProfileRequestAt = new Map<string, number>();
const PROFILE_REQUEST_THROTTLE_MS = 30000;

/**
 * Request extended profile from a discovered peer
 * @param peerAddress - The full Maxima address of the peer
 * @param timeout - Request timeout in milliseconds (default: 10000)
 * @returns Promise with extended profile data
 */
function normalizeKey(key: string): string {
  return key ? key.toLowerCase().trim() : "";
}

// Helper to convert UTF8 to Hex
function utf8ToHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function requestProfile(
  peerAddress: string,
  peerPublicKey: string, // Add publickey parameter
  timeout: number = 30000, // Increased to 30s for better reliability
): Promise<ExtendedProfile> {
  const normalizedKey = normalizeKey(peerPublicKey);
  const existingRequest = inFlightRequests.get(normalizedKey);
  if (existingRequest) {
    return existingRequest;
  }

  const now = Date.now();
  const lastRequestAt = lastProfileRequestAt.get(normalizedKey) || 0;
  if (now - lastRequestAt < PROFILE_REQUEST_THROTTLE_MS) {
    return Promise.reject(new Error("Profile request throttled"));
  }
  lastProfileRequestAt.set(normalizedKey, now);

  console.log(
    `[ProfileService] Requesting profile from ${peerAddress.substring(0, 20)}...`,
  );

  const requestPromise = new Promise<ExtendedProfile>((resolve, reject) => {
    // Get my Maxima info
    MDS.cmd.maxima({ params: { action: "info" } }, (infoRes: any) => {
      if (!infoRes.status) {
        reject(new Error("Failed to get Maxima info"));
        return;
      }

      const myPublicKey = infoRes.response.publickey;
      const myAddress = infoRes.response.contact; // My Maxima address for response

      // Create profile request payload
      const request = {
        type: "profile_request",
        requester: myPublicKey,
        requesterAddress: myAddress, // Include address for response
        timestamp: Date.now(),
      };

      console.log(
        "[ProfileService] Sending profile request via Maxima to:",
        peerAddress.substring(0, 30),
      );

      // Set up timeout and register pending request BEFORE sending to avoid race condition
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(normalizeKey(peerPublicKey)); // Use publickey as key
        reject(new Error("Profile request timed out"));
      }, timeout);

      // Store pending request (use publickey as key for response matching)
      pendingRequests.set(normalizedKey, {
        resolve,
        reject,
        timeout: timeoutId,
      });

      // Encode payload to HEX (Critical for Service Worker compatibility)
      const jsonStr = JSON.stringify(request);
      const hexData = "0x" + utf8ToHex(jsonStr).toUpperCase();

      // Send via Maxima using contact address (no need to be contacts!)
      MDS.cmd.maxima(
        {
          params: {
            action: "send",
            to: peerAddress, // Use full Maxima address instead of publickey
            application: "metachain",
            data: hexData,
          } as any,
        },
        (sendRes: any) => {
          if (!sendRes.status) {
            console.error("[ProfileService] Failed to send:", sendRes);
            // Cleanup pending request if send failed
            clearTimeout(timeoutId);
            pendingRequests.delete(normalizedKey);
            reject(
              new Error(`Failed to send profile request: ${sendRes.error}`),
            );
            return;
          }

          console.log(`[ProfileService] ✅ Profile request sent successfully`);
        },
      );
    });
  });

  inFlightRequests.set(normalizedKey, requestPromise);
  return requestPromise.finally(() => {
    inFlightRequests.delete(normalizedKey);
  });
}

// Debug module init
console.log("🚀 [ProfileService] Module Initialized via import");

/**
 * Handle incoming profile response
 * Called by minimaService when a profile_response message is received
 */
export function handleProfileResponse(
  senderPublicKey: string,
  data: ExtendedProfile,
) {
  console.log(
    `[ProfileService] Received profile response from ${senderPublicKey.substring(0, 10)}`,
  );
  console.log(
    `[ProfileService] Raw Response Data:`,
    JSON.stringify(data, null, 2),
  );

  const normalizedKey = normalizeKey(senderPublicKey);
  const pending = pendingRequests.get(normalizedKey);

  if (pending) {
    clearTimeout(pending.timeout);
    pendingRequests.delete(normalizedKey);
    pending.resolve(data);
  } else {
    console.log(
      `ℹ️ [ProfileService] Ignoring duplicate/unsolicited profile response from ${senderPublicKey.substring(0, 10)}`,
    );
  }
}

/**
 * Cancel a pending profile request
 */
export function cancelProfileRequest(peerPublicKey: string) {
  const normalizedKey = normalizeKey(peerPublicKey);
  const pending = pendingRequests.get(normalizedKey);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingRequests.delete(normalizedKey);
    pending.reject(new Error("Request cancelled"));
  }
}
