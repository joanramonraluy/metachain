import { MDS } from "@minima-global/mds";

/* --------------------------------------------------------------------------
   UTILITY FUNCTIONS
   -------------------------------------------------------------------------- */

export const utf8ToHex = (str: string): string => {
  return (
    "0x" +
    Array.from(str)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
  );
};

export const hexToUtf8 = (hex: string): string => {
  const cleanHex = hex.startsWith("0x") ? hex.substring(2) : hex;
  const bytes = cleanHex.match(/.{1,2}/g) || [];
  return bytes.map((byte) => String.fromCharCode(parseInt(byte, 16))).join("");
};

export const runSQL = (sql: string): Promise<any> => {
  return new Promise((resolve) => {
    MDS.sql(sql, (res: any) => {
      resolve(res);
    });
  });
};

/* --------------------------------------------------------------------------
   P2P DISCOVERY FUNCTIONS
   -------------------------------------------------------------------------- */

// Layer 1: Get P2P discovered peers (ephemeral, TTL 1 hour)
export const getDiscoveredPeers = async (
  pk?: string,
): Promise<DiscoveredPeer[]> => {
  const sql = pk
    ? `SELECT * FROM DISCOVERED_PEERS WHERE UPPER(publickey)=UPPER('${pk}') ORDER BY last_seen DESC`
    : "SELECT * FROM DISCOVERED_PEERS ORDER BY last_seen DESC";
  const result = await MDS.sql(sql);
  return result.rows || [];
};

// Layer 2: Get stable user registry (persistent, no TTL)
export const getMetachainUsers = async (
  pk?: string,
): Promise<MetachainUser[]> => {
  const sql = pk
    ? `SELECT * FROM METACHAIN_USERS WHERE UPPER(publickey)=UPPER('${pk}') ORDER BY last_updated DESC`
    : "SELECT * FROM METACHAIN_USERS ORDER BY last_updated DESC";
  const result = await MDS.sql(sql);
  return result.rows || [];
};

// Combined: Get users with online/offline status
export const getUsersWithStatus = async (): Promise<UserWithStatus[]> => {
  // Fetch both layers and merge in JS to ensure full visibility
  const registrySql = "SELECT * FROM METACHAIN_USERS";
  const discoveredSql = "SELECT * FROM DISCOVERED_PEERS";

  // Use runSQL helper to ensure Promise behavior
  const [registryRes, discoveredRes] = await Promise.all([
    runSQL(registrySql),
    runSQL(discoveredSql),
  ]);

  if (!registryRes.status)
    console.error(
      "❌ [DiscoveryService] Registry SQL Error:",
      registryRes.error,
    );
  if (!discoveredRes.status)
    console.error(
      "❌ [DiscoveryService] Discovered SQL Error:",
      discoveredRes.error,
    );

  const registryUsers: MetachainUser[] = registryRes.rows || [];
  const discoveredPeers: DiscoveredPeer[] = discoveredRes.rows || [];

  console.log(
    "🔍 [DiscoveryService] RAW DISCOVERED PEERS:",
    JSON.stringify(discoveredPeers),
  ); // DEBUG LOG

  const userMap = new Map<string, UserWithStatus>();

  // 1. Add Registry Users (Base)
  registryUsers.forEach((user) => {
    // H2 returns uppercase column names
    const userId = (user as any).USER_ID || user.user_id;
    const publickey = (user as any).PUBLICKEY || user.publickey;
    const alias = (user as any).ALIAS || user.alias;
    const address = (user as any).ADDRESS || user.address;
    const firstSeen = (user as any).FIRST_SEEN || user.first_seen;
    const lastUpdated = (user as any).LAST_UPDATED || user.last_updated;

    userMap.set(publickey.toUpperCase(), {
      user_id: userId,
      publickey: publickey,
      alias: alias,
      bio: undefined,
      address: address,
      first_seen: firstSeen,
      last_updated: lastUpdated,
      is_online: false, // Default to offline until confirmed by discovery
    });
  });

  // 2. Add/Update with Discovered Peers (Online)
  // Helper to get property case-insensitively
  const getCI = (obj: any, key: string) => {
    const foundKey = Object.keys(obj).find(
      (k) => k.toLowerCase() === key.toLowerCase(),
    );
    return foundKey ? obj[foundKey] : undefined;
  };

  // ...

  const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();

  // 2. Add/Update with Discovered Peers (Online)
  discoveredPeers.forEach((peer) => {
    // Robust case-insensitive extraction
    const publickey = getCI(peer, "publickey");
    const alias = getCI(peer, "alias");
    const bio = getCI(peer, "bio");
    const address = getCI(peer, "address");
    const lastSeen = getCI(peer, "last_seen");
    const source = getCI(peer, "source");

    // Parse extra_data if available
    let extendedInfo: any = {};
    const extraDataRaw = getCI(peer, "extra_data");
    if (extraDataRaw) {
      try {
        // H2 CLOB might need handling if it's an object or string
        // Usually comes as string from SQL result
        const jsonStr =
          typeof extraDataRaw === "string"
            ? extraDataRaw
            : JSON.stringify(extraDataRaw);
        extendedInfo = JSON.parse(jsonStr);
      } catch (e) {
        console.warn("⚠️ [Discovery] Failed to parse extra_data", e);
      }
    }

    if (!publickey) return; // Skip invalid rows

    // Helper to safe decode
    const safeDecode = (str: string | undefined) => {
      if (!str) return str;

      // 1. Try resolving Mojibake (UTF-8 bytes interpreted as Latin-1)
      // e.g. "CatalÃ " (where 'à' became 'Ã ' via C3 A0)
      try {
        // Heuristic: If string has unlikely UTF-8 sequences interpreted as single bytes
        // We convert chars back to bytes and try decoding as UTF-8
        // This fixes cases like "CatalÃ " -> "Català"
        if (/[ÃÂÅÄ]/.test(str)) {
          // Common artifacts of UTF-8 misinterpretation
          const bytes = new Uint8Array(str.length);
          for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if (code > 255) {
              // If we have real unicode chars > 255, it's probably not simple Latin-1 mojibake
              // unless it's mixed. But let's be conservative.
              // allow it to proceed effectively treating it as mixed? No, risky.
              // If it's pure Mojibake, all chars are <= 255 (ISO-8859-1 range)
              // Actually some Windows-1252 chars are mapped > 255 in Unicode keys.
              // Let's stick to the simplest try-catch approach:
            }
            bytes[i] = code;
          }

          const decoder = new TextDecoder("utf-8");
          const decoded = decoder.decode(bytes);

          // If decoding worked and changed something (and didn't result in replacement chars which are 0xFFFD)
          if (decoded !== str && !decoded.includes("\uFFFD")) {
            str = decoded;
          }
        }
      } catch (e) {
        // Ignore failure
      }

      // 2. Try URI decoding
      try {
        if (str.includes("%")) {
          str = decodeURIComponent(str);
        }
      } catch (e) {
        // Ignore
      }

      // 3. Known Manual Fixes (Emergency Fallback)
      if (str && typeof str === "string") {
        if (
          str.includes("Catalan") &&
          (str.includes("Catal") || str.includes("CatalÃ"))
        ) {
          return "Catalan (Català)";
        }
        if (
          str.includes("Spanish") &&
          (str.includes("Espa") || str.includes("EspaÃ±"))
        ) {
          return "Spanish (Español)";
        }
        if (str.includes("Basque") && str.includes("Euskera")) {
          return "Basque (Euskera)";
        }
      }

      return str;
    };

    const minimaaddress = getCI(peer, "minimaaddress") || extendedInfo.minimaaddress;

    const existing = userMap.get(publickey.toUpperCase());
    if (existing) {
      // Update existing user with online status and latest address
      userMap.set(publickey.toUpperCase(), {
        ...existing,
        // Force update alias from beacon if present and valid (not empty/unknown)
        alias:
          alias && alias !== "Unknown" && alias !== "Anonymous"
            ? safeDecode(alias)
            : existing.alias || alias,
        bio: safeDecode(bio) || existing.bio,
        address: address || existing.address,
        is_online: now - lastSeen < ONLINE_THRESHOLD_MS,
        source: source as "P2P" | "BOOTSTRAP",
        last_updated: Math.max(existing.last_updated, lastSeen),
        // Merge Extended Info
        avatar: extendedInfo.avatar || existing.avatar,
        country: safeDecode(extendedInfo.country) || existing.country,
        languages:
          extendedInfo.languages && Array.isArray(extendedInfo.languages)
            ? extendedInfo.languages.map((l: string) => safeDecode(l))
            : existing.languages,
        minimaaddress: minimaaddress || existing.minimaaddress,
      });
    } else {
      // Add new ephemeral peer not in registry yet
      userMap.set(publickey.toUpperCase(), {
        user_id: publickey,
        publickey: publickey,
        alias: safeDecode(alias) || "Anonymous",
        bio: safeDecode(bio),
        address: address,
        first_seen: lastSeen,
        last_updated: lastSeen,
        is_online: now - lastSeen < ONLINE_THRESHOLD_MS,
        source: source as "P2P" | "BOOTSTRAP",
        // Extended Info
        avatar: extendedInfo.avatar,
        country: extendedInfo.country,
        languages: extendedInfo.languages,
        minimaaddress: minimaaddress,
      });
    }
  });

  // 3. Enrich with Resource Counts from DISCOVERED_LISTINGS
  const countsRes = await runSQL("SELECT owner_publickey, listings FROM DISCOVERED_LISTINGS");
  if (countsRes.status && countsRes.rows) {
     countsRes.rows.forEach((row: any) => {
        const owner = getCI(row, "owner_publickey");
        const listingsStr = getCI(row, "listings");
        if (owner && listingsStr) {
           try {
              const listings = JSON.parse(typeof listingsStr === 'string' ? listingsStr : JSON.stringify(listingsStr));
              const count = Array.isArray(listings) ? listings.length : 0;
              const user = userMap.get(owner.toUpperCase());
              if (user) {
                 user.resource_count = count;
              }
           } catch (e) {}
        }
     });
  }

  // Get own public key to exclude from list
  let myPublicKey = "";
  let myAlias = "";

  try {
    const maximaInfo = await MDS.cmd.maxima({ params: { action: "info" } });

    if (maximaInfo.status && maximaInfo.response) {
      const response = maximaInfo.response as any;
      myPublicKey = response.publickey || "";
      myAlias = response.name || "";
    }
  } catch (err) {
    console.error("❌ [Discovery] Failed to fetch own publickey:", err);
  }

  // Convert map to array, exclude self, and sort
  const sortedUsers = Array.from(userMap.values())
    .filter((user) => {
      // Debug log for checking each user against filters
      // console.log(`🔍 [Discovery] Checking user: "${user.alias}" (${user.publickey?.substring(0, 8)}...) vs Self: "${myAlias}"`);

      // 1. Exclude by Public Key (Case-Insensitive Match)
      if (
        myPublicKey &&
        user.publickey &&
        user.publickey.toLowerCase() === myPublicKey.toLowerCase()
      ) {
        return false;
      }

      // 2. Exclude by Alias (Case-Insensitive Match)
      if (myAlias && myAlias !== "Anonymous" && myAlias !== "Unknown") {
        const userAlias = (user.alias || "").trim();
        const myAliasClean = myAlias.trim();

        if (
          userAlias &&
          userAlias.toLowerCase() === myAliasClean.toLowerCase()
        ) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      // Sort by Online status first, then recency
      // This sort is CRITICAL for the deduplication step below to work effectively
      if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
      return b.last_updated - a.last_updated;
    });

  return sortedUsers;
};

/* --------------------------------------------------------------------------
   DISCOVERED LISTINGS (Public Groups/Channels)
   -------------------------------------------------------------------------- */

const buildJoinLink = (
  type: "group" | "channel",
  payload: {
    id: string;
    name: string;
    adminPublickey?: string;
    adminAddress?: string;
  },
): string => {
  if (
    !payload?.id ||
    !payload?.name ||
    !payload?.adminPublickey ||
    !payload?.adminAddress
  )
    return "";
  const data =
    type === "group"
      ? {
          g: payload.id,
          n: payload.name,
          p: payload.adminPublickey,
          a: payload.adminAddress,
        }
      : {
          c: payload.id,
          n: payload.name,
          p: payload.adminPublickey,
          a: payload.adminAddress,
        };
  try {
    const jsonStr = JSON.stringify(data);
    const base64 = window.btoa(unescape(encodeURIComponent(jsonStr)));
    return type === "group" ? `mcgrp://${base64}` : `mcch://${base64}`;
  } catch (e) {
    return "";
  }
};

export const getDiscoveredListings = async (): Promise<DiscoveredListing[]> => {
  const listingsRes = await runSQL("SELECT * FROM DISCOVERED_LISTINGS");
  const [peersRes, usersRes] = await Promise.all([
    runSQL("SELECT publickey, alias FROM DISCOVERED_PEERS"),
    runSQL("SELECT publickey, alias FROM METACHAIN_USERS"),
  ]);

  const getCI = (obj: any, key: string) => {
    const foundKey = Object.keys(obj).find(
      (k) => k.toLowerCase() === key.toLowerCase(),
    );
    return foundKey ? obj[foundKey] : undefined;
  };

  const aliasMap = new Map<string, string>();
  (usersRes.rows || []).forEach((row: any) => {
    const pk = getCI(row, "publickey");
    const alias = getCI(row, "alias");
    if (pk && alias) aliasMap.set(pk.toUpperCase(), alias);
  });
  (peersRes.rows || []).forEach((row: any) => {
    const pk = getCI(row, "publickey");
    const alias = getCI(row, "alias");
    if (pk && alias && !aliasMap.has(pk.toUpperCase())) aliasMap.set(pk.toUpperCase(), alias);
  });

  const rows = listingsRes.rows || [];
  const results: DiscoveredListing[] = [];

  rows.forEach((row: any) => {
    const owner = getCI(row, "owner_publickey");
    const rawListings = getCI(row, "listings");
    if (!owner || !rawListings) return;

    let listArr: any[] = [];
    try {
      const jsonStr =
        typeof rawListings === "string"
          ? rawListings
          : JSON.stringify(rawListings);
      listArr = JSON.parse(jsonStr) || [];
    } catch (e) {
      listArr = [];
    }

    listArr.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const type =
        item.type === "channel"
          ? "channel"
          : item.type === "group"
            ? "group"
            : null;
      if (!type) return;
      const id = item.id || item.group_id || item.channel_id;
      const name = item.name;
      if (!id || !name) return;
      const description = item.description || "";
      const joinPayload = item.join || {};
      const link =
        item.link ||
        buildJoinLink(type, {
          id,
          name,
          adminPublickey:
            joinPayload.admin_publickey || joinPayload.adminPublickey,
          adminAddress: joinPayload.admin_address || joinPayload.adminAddress,
        });

      results.push({
        owner_publickey: owner,
        owner_alias: aliasMap.get(owner.toUpperCase()),
        type,
        id,
        name,
        description,
        link: link || undefined,
      });
    });
  });

  // Deduplicate by listing id — the same channel/group can arrive from
  // multiple peers or from duplicate DISCOVERED_LISTINGS rows (case mismatch)
  const seen = new Set<string>();
  return results.filter((item) => {
    const key = item.type + ":" + item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Update local profile (for beacon generation)
export const updateLocalProfile = async (alias: string): Promise<void> => {
  await MDS.keypair.set("username", alias);
  console.log(`✅ [Discovery] Local profile updated: ${alias}`);
};

// Register with Static MLS bootstrap server
export const registerWithBootstrap = async (): Promise<void> => {
  const maximaInfo = await MDS.cmd.maxima();
  const staticMLS = maximaInfo.response.mls;

  if (!staticMLS || !maximaInfo.response.staticmls) {
    throw new Error("Static MLS not configured");
  }

  const publickey = maximaInfo.response.publickey;
  const address = maximaInfo.response.contact;
  const alias = (await MDS.keypair.get("username")) || "Anonymous";

  const msgData = {
    app: "metachain",
    type: "register",
    pubkey: publickey,
    address,
    alias,
  };

  const cmd = `maxima action:send to:${staticMLS} application:metachain data:${JSON.stringify(msgData)}`;
  await MDS.executeRaw(cmd);
  console.log(`✅ [Discovery] Registered with bootstrap server`);
};

// Request peers from Static MLS bootstrap server
export const requestBootstrapPeers = async (): Promise<void> => {
  const maximaInfo = await MDS.cmd.maxima();
  const staticMLS = maximaInfo.response.mls;

  if (!staticMLS || !maximaInfo.response.staticmls) {
    throw new Error("Static MLS not configured");
  }

  const msgData = {
    app: "metachain",
    type: "get_peers",
  };

  const cmd = `maxima action:send to:${staticMLS} application:metachain data:${JSON.stringify(msgData)}`;
  await MDS.executeRaw(cmd);
  console.log(`✅ [Discovery] Requested peers from bootstrap`);
};

/* --------------------------------------------------------------------------
   TYPE DEFINITIONS FOR P2P DISCOVERY
   -------------------------------------------------------------------------- */

export interface DiscoveredPeer {
  publickey: string;
  alias: string;
  bio?: string;
  address: string;
  last_seen: number;
  source: "P2P" | "BOOTSTRAP";
  extra_data?: string; // JSON string
}

export interface MetachainUser {
  user_id: string;
  publickey: string;
  alias: string;
  bio?: string;
  address: string;
  first_seen: number;
  last_updated: number;
  // Extended fields (optional as they might not persist in SQL layer 2 yet)
  avatar?: string;
  country?: string;
  languages?: string[];
  minimaaddress?: string;
  resource_count?: number;
}

export interface UserWithStatus extends MetachainUser {
  is_online: boolean;
  source?: "P2P" | "BOOTSTRAP";
}

export interface DiscoveredListing {
  owner_publickey: string;
  owner_alias?: string;
  type: "group" | "channel";
  id: string;
  name: string;
  description?: string;
  link?: string;
}

/* --------------------------------------------------------------------------
   DISCOVERY SERVICE EXPORT
   -------------------------------------------------------------------------- */

export const DiscoveryService = {
  // Utility functions
  utf8ToHex,
  hexToUtf8,
  runSQL,

  // P2P Discovery functions
  getDiscoveredPeers,
  getMetachainUsers,
  getUsersWithStatus,
  getDiscoveredListings,
  updateLocalProfile,
  registerWithBootstrap,
  requestBootstrapPeers,
};
