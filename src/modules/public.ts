import { Composer, InlineKeyboard } from "grammy";
import { MyContext } from "../types";
import { getSetting, esc } from "../core/database";
import { getMissingChannels } from "../services/fj.service";
import { serveFilesToUser } from "../services/file.service";

export const publicModule = new Composer<MyContext>();

/**
 * 🌍 Public Feature Module
 * - Handles all user-facing interactions: /start, /help, /me.
 * - Handles Force-Join verification (verify_join).
 * - Handles join request registration.
 */

// 1. /start command
publicModule.command("start", async (ctx) => {
  const payload = ctx.match;
  const isAdmin = ["owner", "admin"].includes(ctx.role);

  if (!payload) {
    // Standard Welcome Message
    const defaultStart = "👋 <b>Welcome {user}!</b>\n\nI am a premium file storage and sharing bot. Send me a valid share link to instantly access your files.\n\n<i>Need help? Click /help to learn more.</i>";
    let startText = await getSetting(ctx.db, "start_text", defaultStart);
    const userMention = `<a href="tg://user?id=${ctx.from!.id}">${esc(ctx.from!.first_name)}</a>`;
    startText = startText.replace(/{user}/g, userMention);

    const roleText = isAdmin ? `👑 Role: <b>${ctx.role}</b>\n\n` : "";
    return ctx.reply(`${roleText}${startText}`, { parse_mode: "HTML" });
  }

  // 2. File Access (Payload provided)
  const missing = await getMissingChannels(ctx, payload);
  if (missing.length > 0) {
    return sendJoinPrompt(ctx, missing, payload);
  }

  // All checks passed, serve files
  await serveFilesToUser(ctx, payload);
});

// 2. /help command
publicModule.command("help", async (ctx) => {
  const defaultHelp = `📖 <b>Bot Usage Guide</b>\n\n<b>For Users:</b>\n• Click on any shared link to smoothly receive your files.\n• If requested, join our official channels to unlock access.\n\n<b>About:</b>\nThis bot serves as a secure, high-speed file management system.`;
  const helpText = await getSetting(ctx.db, "help_text", defaultHelp);
  await ctx.reply(helpText, { parse_mode: "HTML" });
});

// 3. /me command
publicModule.command("me", async (ctx) => {
  const text = `👤 <b>User Info</b>\n\nName: ${esc(ctx.from?.first_name || "User")}\nID: <code>${ctx.from?.id}</code>\nRole: <b>${ctx.role}</b>`;
  await ctx.reply(text, { parse_mode: "HTML" });
});

// 4. /about command (Restoration Polished)
publicModule.command("about", async (ctx) => {
  const aboutText = await getSetting(ctx.db, "about_text", 
    "🤖 <b>Welcome to the FileStore!</b>\n\n" +
    "This bot allows you to access and store files securely on Telegram.\n\n" +
    "✨ <b>How to use:</b>\n" +
    "• Click on file links to access content\n" +
    "• Join required channels to unlock files\n" +
    "• Contact support for help with your account"
  );

  const ensureUrl = (val: string) => {
    const trimmed = val.trim();
    if (trimmed.startsWith("http")) return trimmed;
    if (trimmed.startsWith("@")) return `https://t.me/${trimmed.substring(1)}`;
    if (trimmed.includes("/") || trimmed.includes("t.me")) return `https://${trimmed.replace(/^https?:\/\//, "")}`;
    return `https://t.me/${trimmed}`;
  };

  const updatesUrl = ensureUrl(await getSetting(ctx.db, "about_updates_text", "https://t.me/your_channel"));
  const supportUrl = ensureUrl(await getSetting(ctx.db, "about_support_text", "https://t.me/your_username"));
  
  const kb = new InlineKeyboard()
    .url("📢 Updates", updatesUrl)
    .url("🛠 Support", supportUrl);

  await ctx.reply(aboutText, { reply_markup: kb, parse_mode: "HTML" });
});

// 4. Force-Join Verification Callback
publicModule.callbackQuery(/^verify_join(_(.*))?$/, async (ctx) => {
  const payload = ctx.match[2]; // Can be undefined for generic join check
  const missing = await getMissingChannels(ctx, payload);

  if (missing.length > 0) {
    /**
     * 🛡️ Force Join Protection
     * User hasn't joined everything. We delete the old prompt and send a fresh one
     * to ensure it stays at the bottom of the chat ("again and again").
     */
    await ctx.answerCallbackQuery({
      text: "❌ You still haven't joined all required channels!",
      show_alert: false
    });

    try {
      await ctx.deleteMessage().catch(() => {});
    } catch (e) {}

    const keyboard = createJoinKeyboard(missing, payload);
    return await ctx.reply("❌ **Access Denied!**\n\nYou must join our channels to access the files.", { 
      reply_markup: keyboard,
      parse_mode: "Markdown" 
    });
  }

  await ctx.answerCallbackQuery("✅ Access Granted!");
  await ctx.editMessageText("🎉 **Verification successful!** Delivering your files now...", { parse_mode: "Markdown" });

  if (payload) {
    await serveFilesToUser(ctx, payload);
  }
});

// 5. Chat Join Request Event
publicModule.on("chat_join_request", async (ctx) => {
  try {
    console.log(`[SQL-DEBUG] Join Request: user=${ctx.from.id}, chat=${ctx.chat.id}`);
    // We register the request in the DB but DO NOT send a DM confirmation (user's request).
    // Instead, they will get a toast when they click "Verify Join" in the main bot.
    await ctx.db.prepare("INSERT OR REPLACE INTO join_requests (user_id, channel_id) VALUES (?, ?)")
      .bind(Number(ctx.from.id), String(ctx.chat.id)).run();
  } catch (e) { 
    console.error("Join Request Log Error:", e); 
  }
});

// --- HELPER FUNCTIONS ---

function createJoinKeyboard(missing: any[], payload?: string) {
  const keyboard = new InlineKeyboard();
  missing.forEach((ch, index) => {
    keyboard.url(ch.title || `Channel`, ch.invite_link || `https://t.me/${ch.id.replace("-100", "")}`);
    if ((index + 1) % 2 === 0) keyboard.row();
  });
  keyboard.row().text("Joined Check ✅", payload ? `verify_join_${payload}` : `verify_join`);
  return keyboard;
}

async function sendJoinPrompt(ctx: MyContext, missing: any[], payload: string) {
  const keyboard = createJoinKeyboard(missing, payload);
  await ctx.reply("❌ **Access Denied!**\n\nYou must join our channels to access the files.", { reply_markup: keyboard });
}
