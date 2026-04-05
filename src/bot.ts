import { Bot } from "grammy";
import { MyContext } from "./types";
import { authMiddleware } from "./middlewares/auth";
import { callbackMiddleware } from "./middlewares/callback";
import { errorBoundary } from "./middlewares/error_boundary";
import { guardMiddleware } from "./middlewares/guard";
import { publicModule } from "./modules/public";
import { adminModule } from "./modules/admin";
import { ownerModule } from "./modules/owner";
import { channelsModule } from "./modules/channels";
import { postsModule } from "./modules/posts";
import { statesModule } from "./modules/states";

/**
 * 🤖 Main Bot Factory
 * - Assembles the bot using the modular architecture (v2.0).
 * - Middleware & Feature module ordering is critical.
 */
export function createBot(token: string, db: D1Database, config: {
  STORAGE_CHANNEL_ID: string;
  BACKUP_STORAGE_ID: string;
  ADMIN_UID: string;
  RENDER_URL: string;
  ADMIN_API_KEY: string;
}, executionCtx?: ExecutionContext) {
  
  const bot = new Bot<MyContext>(token);

  // 1. Initial Context Setup (Database & Config)
  bot.use(async (ctx, next) => {
    ctx.db = db;
    ctx.config = config;
    ctx.executionCtx = executionCtx;
    await next();
  });

  // 2. Global Middlewares (🛡️ Error Boundary, 🛡️ Auth, 📡 Guard & ⚡ Callbacks)
  bot.use(errorBoundary);    // KEEP THIS FIRST to catch all failures
  bot.use(guardMiddleware);  
  bot.use(authMiddleware);
  bot.use(callbackMiddleware);

  // 3. Feature Modules (📦 Grouped Commands + Callbacks)
  bot.use(publicModule);   // /start, /help, /me, join verification
  bot.use(adminModule);    // /manage, /bulk, /store, file storage logic
  bot.use(channelsModule); // /admin_channels, chat_member events
  bot.use(postsModule);    // Remote channel posting/editing
  bot.use(ownerModule);     // /admin, /broadcast, advanced stats, exclusions
  bot.use(statesModule);    // Text input waiting logic (rename link, etc.)

  // 4. Global Error Handler
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`, err.error);
    
    // Attempt to notify the user if possible
    ctx.reply(`❌ **Bot Error!**\n\n\`${err.message || String(err.error)}\``, { 
      parse_mode: "Markdown" 
    }).catch(() => { });
  });

  return bot;
}
