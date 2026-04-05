import { Composer } from "grammy";
import { MyContext } from "../types";
import { isUserBlocked, getUserRole, trackUserActivity } from "../core/database";

export const authMiddleware = new Composer<MyContext>();

/**
 * 🛡️ Authentication & Authorization Middleware
 * - Blocks restricted users
 * - Identifies admin/owner roles
 * - Tracks Daily/Monthly Active Users (DAU/MAU)
 */
authMiddleware.use(async (ctx, next) => {
  if (!ctx.db || !ctx.config) return await next();
  if (!ctx.from) return await next();

  // 1. Check Block Status
  if (await isUserBlocked(ctx.db, ctx.from.id)) {
    return ctx.reply("❌ **Access Denied!**\n\nYou are blocked from using this bot.", { parse_mode: "Markdown" });
  }

  // 2. Identify Role
  ctx.role = await getUserRole(ctx.db, ctx.from.id, ctx.config.ADMIN_UID);

  // 3. Activity Logging (DAU/MAU)
  await trackUserActivity(ctx.db, ctx.from.id, ctx.from.username || null, ctx.from.first_name);

  return await next();
});
