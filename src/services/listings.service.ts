import { runSQL } from "./database.service";

export const LISTINGS_PUBLIC_LIMIT = 10;

export async function getPublicListingsCount(): Promise<number> {
  const groupsSql =
    "SELECT COUNT(*) AS cnt FROM GROUPS WHERE COALESCE(is_public, FALSE) = TRUE";
  const channelsSql =
    "SELECT COUNT(*) AS cnt FROM CHANNELS WHERE COALESCE(is_public, FALSE) = TRUE";

  try {
    const [groupsRes, channelsRes] = await Promise.all([
      runSQL(groupsSql),
      runSQL(channelsSql),
    ]);

    const groupCount =
      groupsRes?.rows?.length > 0
        ? Number(groupsRes.rows[0].CNT || groupsRes.rows[0].cnt || 0)
        : 0;
    const channelCount =
      channelsRes?.rows?.length > 0
        ? Number(channelsRes.rows[0].CNT || channelsRes.rows[0].cnt || 0)
        : 0;

    return groupCount + channelCount;
  } catch (err) {
    console.error("❌ [LISTINGS] Failed to count public listings:", err);
    return 0;
  }
}
