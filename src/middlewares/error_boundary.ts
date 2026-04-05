import { Composer } from "grammy";
import { MyContext } from "../types";

export const errorBoundary = new Composer<MyContext>();

/**
 * 🛡️ Global Error Boundary Middleware
 * - Catches ANY error in the middleware chain.
 * - Ensures ctx.answerCallbackQuery() is called to prevent "button lock-up".
 * - Notifies the user/admin of a silent failure if possible.
 */
errorBoundary.use(async (ctx, next) => {
  try {
    await next();
  } catch (err: any) {
    console.error("🛡️ [Error Boundary] Caught:", err);

    // 1. Ensure callback queries are ALWAYS answered if they haven't been
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({
        text: "❌ Internal Error occurred. Please try again.",
        show_alert: false
      }).catch(() => {});
    }

    // 2. Notify the user/admin if appropriate
    const errorMsg = `⚠️ **System Failure**\n\nCode: \`${err.message || "Unknown"}\`\n\n_Developers have been notified (Local Logs)._`;
    
    if (ctx.chat?.type === "private") {
      await ctx.reply(errorMsg, { parse_mode: "Markdown" }).catch(() => {});
    }
  }
});
