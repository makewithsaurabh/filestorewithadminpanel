import { Composer } from "grammy";
import { MyContext } from "../types";

export const callbackMiddleware = new Composer<MyContext>();

/**
 * ⚡ Atomic Callback Query Acknowledger
 * - Ensures Telegram wait-clocks stop immediately on every button click.
 * - Non-blocking: Allows subsequent feature handlers to still send custom toast messages.
 */
callbackMiddleware.on("callback_query", async (ctx, next) => {
  // Check if we are in a Cloudflare Worker context with executionCtx
  if (ctx.executionCtx) {
    ctx.executionCtx.waitUntil(ctx.answerCallbackQuery().catch(() => { }));
  } else {
    // Fallback for standard environments
    await ctx.answerCallbackQuery().catch(() => { });
  }

  return await next();
});
