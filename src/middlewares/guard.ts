import { Composer } from "grammy";
import { MyContext } from "../types";

export const guardMiddleware = new Composer<MyContext>();

/**
 * 🛰️ Global Chat Guard Middleware
 * 
 * PURPOSE: Restricts the bot from responding in Groups/Supergroups/Channels.
 * EXCEPTIONS:
 * - Specific callback query events that require channel interaction.
 * - Admin/Owner actions.
 * 
 * WHY: Prevents unwanted bot activity in unauthorized groups and reduces server load.
 */
guardMiddleware.use(async (ctx, next) => {
  // If no chat object, proceed (e.g. some internal events)
  if (!ctx.chat) return await next();

  // 1. Allow all Private Chats
  if (ctx.chat.type === "private") return await next();

  // 2. Allow Channel Join Requests (Core logic)
  if (ctx.update.chat_join_request) return await next();

  // 3. Allow specific administrative callbacks
  if (ctx.callbackQuery?.data?.includes("save_ch_")) return await next();

  // Block everything else in non-private chats
  // console.log(`[Guard] Blocked activity in ${ctx.chat.type} (${ctx.chat.id})`);
  return; 
});
