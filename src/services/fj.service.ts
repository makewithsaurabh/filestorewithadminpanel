import { MyContext, DatabaseChannel } from "../types";

/**
 * ⚙️ Force-Join Logic Engine
 * - Core logic for verifying membership across multiple channels.
 * - Handles bypass whitelists and join-request registrations.
 */

/**
 * Returns a list of channels the user MUST join to proceed.
 * If the list is empty, access is granted.
 */
export async function getMissingChannels(ctx: MyContext, payload?: string): Promise<DatabaseChannel[]> {
  // 1. Owners/Admins bypass all checks
  const isAdmin = ["owner", "admin"].includes(ctx.role);
  if (isAdmin) return [];

  // 2. FJ Whitelist Bypass
  try {
    const isExcluded = await ctx.db.prepare("SELECT user_id FROM fj_exclusions WHERE user_id = ?").bind(Number(ctx.from!.id)).first();
    if (isExcluded) return [];
  } catch (e) { }

  // 3. Identify which channels to check
  const { results: allChannels } = await ctx.db.prepare("SELECT * FROM channels ORDER BY position ASC, id ASC").all<DatabaseChannel>();
  if (!allChannels || allChannels.length === 0) return [];

  let targetChannels: DatabaseChannel[] = [];
  if (payload) {
    // Check for link-specific overrides
    const { results: specific } = await ctx.db.prepare("SELECT c.* FROM channels c JOIN link_channels lc ON c.id = lc.channel_id WHERE lc.link_id = ? ORDER BY c.position ASC, c.id ASC").bind(String(payload)).all<DatabaseChannel>();
    targetChannels = (specific && specific.length > 0) ? specific : allChannels;
  } else {
    targetChannels = allChannels;
  }

  // 4. Verify membership in parallel
  /**
   * 🚀 Parallel Membership Check
   * We prioritize checking the local DATABASE for 'join_request' records before 
   * making expensive live calls to the Telegram API.
   */
  const missing: DatabaseChannel[] = [];
  const checks = await Promise.all(targetChannels.map(async (channel) => {
    // A. Check for existing join request record (Local Check - Fast)
    try {
      /**
       * 🛡️ Join-Request Bypass
       * We check if the user has already submitted a 'Request to Join'. 
       * If they have, we treat them as joined to prevent delivery friction.
       */
      console.log(`[SQL-DEBUG] Checking Join REQ: user=${ctx.from!.id}, chId=${channel.id}`);
      const exists = await ctx.db.prepare("SELECT user_id FROM join_requests WHERE user_id = ? AND channel_id = ?")
        .bind(Number(ctx.from!.id), String(channel.id)).first();
      
      if (exists) return null;
    } catch (e) { }

    // B. Live Status Check (Remote Check - Slower)
    try {
      const member = await ctx.api.getChatMember(channel.id, ctx.from!.id);
      const activeStatuses = ["creator", "administrator", "member", "restricted"];
      
      // If mereka statusnya aktif, return null (tidak missing)
      if (activeStatuses.includes(member.status)) return null;
      
      // Khusus untuk private channel, status 'left' berarti missing
      return channel;
    } catch (e: any) {
      /**
       * ⚠️ API Error Handling
       * If the bot cannot check membership (e.g., bot was removed as admin), 
       * we safely require user to join to protect the channel as a fallback.
       */
      return channel;
    }
  }));

  for (const res of checks) {
    if (res) missing.push(res);
  }

  return missing;
}
