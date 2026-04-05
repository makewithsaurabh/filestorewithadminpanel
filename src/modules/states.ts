import { Composer, InlineKeyboard } from "grammy";
import { MyContext } from "../types";
import { registerChannel } from "../services/channel.service";

export const statesModule = new Composer<MyContext>();

/**
 * 📝 States Feature Module
 * - Handles all text-based administrative inputs.
 * - Uses the 'admin_states' table to determine which input is being waited for.
 * - Logic for Renaming, Broadcast Capturing, Channel ID input, User Blocking, etc.
 */

const isAdmin = (ctx: MyContext) => ["owner", "admin"].includes(ctx.role);
const isOwner = (ctx: MyContext) => ctx.role === "owner";

// 0. Global /cancel command
statesModule.command("cancel", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();
  await ctx.reply("🚫 **Action Cancelled.**", { parse_mode: "Markdown" });
});

statesModule.on("message:text", async (ctx, next) => {
  if (!isAdmin(ctx)) return next();
  
  // If it's a command, let command handlers tackle it first
  if (ctx.msg.text.startsWith("/")) return next();

  const stateRow = await ctx.db.prepare("SELECT state FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).first<{ state: string }>();
  if (!stateRow) return next();

  // 1. Rename Link
  if (stateRow.state.startsWith("wait_rename:")) {
    const parts = stateRow.state.split(":");
    const slug = parts[1];
    const promptId = parts[2];
    const newName = ctx.msg.text.trim();

    await ctx.db.prepare("UPDATE links SET title = ? WHERE id = ?").bind(newName, slug).run();
    await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();

    if (promptId) await ctx.api.deleteMessage(ctx.from!.id, parseInt(promptId)).catch(() => { });
    
    /**
     * 🔗 Safety Link Generation
     * ctx.me is mostly provided by grammy, but we use a fallback if needed.
     */
    const botUser = ctx.me?.username || (await ctx.api.getMe()).username;
    return ctx.reply(`✅ **Stored with Custom Name!**\n\nTitle: ${newName}\n🔗 URL: \`https://t.me/${botUser}?start=${slug}\``, { parse_mode: "Markdown" });
  }

  // 2. Broadcast Message Capture
  if (stateRow.state.startsWith("wait_broadcast_msg")) {
    if (!isOwner(ctx)) return;
    const msgId = ctx.msg.message_id;

    // We store the message and ask for confirmation
    const { meta } = await ctx.db.prepare("INSERT INTO broadcasts (message_id, from_chat_id, status) VALUES (?, ?, 'pending')").bind(msgId, ctx.from!.id).run();
    const bId = meta.last_row_id;

    const kb = new InlineKeyboard().text("🚀 Start", `confirm_broadcast:${bId}`).row().text("❌ Cancel", `cancel_broadcast:${bId}`);
    await ctx.reply(`⚠️ **Ready to transmit?** (ID #${bId})\n\nForwarding this message will begin the broadcast.`, { reply_markup: kb, parse_mode: "Markdown" });
    await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();
    return;
  }

  // 3. Add Channel by ID
  if (stateRow.state.startsWith("wait_ch_id_input")) {
    const chId = ctx.msg.text.trim();
    if (!chId.startsWith("-100")) return ctx.reply("❌ Invalid format. Channel IDs start with `-100...`.");
    try {
      const chat = await ctx.api.getChat(chId);
      const title = chat.title || "Channel";
      const username = (chat as any).username;

      if (username) {
        await registerChannel(ctx, chId, title, "direct", username);
        await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();
        return ctx.reply(`✅ **Public Channel Added:** ${title}`);
      } else {
        const kb = new InlineKeyboard().text("🔗 Direct", `save_ch_direct_${chId}`).text("🔒 Request", `save_ch_request_${chId}`);
        await ctx.reply(`📂 **Private Channel Detected:** ${title}\n\nChoose join mode:`, { reply_markup: kb });
      }
    } catch (e: any) {
      return ctx.reply(`❌ **Failed to add channel:** ${e.message}`);
    }
  }

  // 4. Update Settings Texts (Start/Help/About/URLs)
  if (stateRow.state.startsWith("wait_new_") && stateRow.state.endsWith("_text")) {
    const type = stateRow.state.replace("wait_new_", "").replace("_text", "");
    
    await ctx.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(`${type}_text`, ctx.msg.text.trim()).run();
    await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();
    return ctx.reply(`✅ **${type.replace("_", " ")} updated!**`);
  }

  // 5. Block / Unblock ID
  if (stateRow.state.startsWith("wait_block_id") || stateRow.state.startsWith("wait_unblock_id")) {
    const isBlock = stateRow.state.includes("wait_block");
    const targetId = parseInt(ctx.msg.text.trim());
    if (isNaN(targetId)) return ctx.reply("❌ Invalid ID.");

    if (isBlock) {
      await ctx.db.prepare("INSERT OR REPLACE INTO blocked_users (user_id, reason) VALUES (?, ?)").bind(targetId, "Blocked by admin").run();
    } else {
      await ctx.db.prepare("DELETE FROM blocked_users WHERE user_id = ?").bind(targetId).run();
    }
    await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();
    return ctx.reply(isBlock ? `🚫 User ${targetId} blocked.` : `✅ User ${targetId} unblocked.`);
  }

  // 6. Create Link For (Delegated)
  if (stateRow.state.startsWith("create_link_for_wait_id")) {
    if (!isOwner(ctx)) return;
    const targetId = parseInt(ctx.msg.text.trim());
    if (isNaN(targetId)) return ctx.reply("❌ Invalid user ID.");
    
    await ctx.db.prepare("UPDATE admin_states SET state = ? WHERE admin_id = ?").bind(`create_link_for_${targetId}`, ctx.from!.id).run();
    return ctx.reply(`🎯 **Delegation Active!**\n\nThe next link you create will be assigned to: \`${targetId}\`\n\nSend the file(s) now.`);
  }

  // 7. Channel Post Message Capture
  if (stateRow.state.startsWith("wait_ch_post_msg:")) {
    if (!isOwner(ctx)) return;
    const parts = stateRow.state.split(":");
    const chId = parts[1];
    const promptId = parseInt(parts[2]);

    try {
      const sent = await ctx.api.copyMessage(chId, ctx.from!.id, ctx.msg.message_id);
      await ctx.db.prepare("INSERT INTO channel_posts (channel_id, message_id) VALUES (?, ?)").bind(chId, sent.message_id).run();
      await ctx.reply(`✅ **Posted successfully!** (Message ID: \`${sent.message_id}\`)`, {
        reply_markup: new InlineKeyboard().text("🔙 Back", `manage_ch_${chId}`),
      });
      if (promptId) await ctx.api.deleteMessage(ctx.from!.id, promptId).catch(() => {});
      await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();
    } catch (e: any) {
      await ctx.reply(`❌ **Post Failed:** ${e.message}`);
    }
    return;
  }

  // 8. Edit Channel Post Capture
  if (stateRow.state.startsWith("wait_edit_ch_post:")) {
    if (!isOwner(ctx)) return;
    const parts = stateRow.state.split(":");
    const chId = parts[1];
    const msgId = parseInt(parts[2]);
    const promptId = parseInt(parts[3]);

    try {
      await ctx.api.editMessageText(chId, msgId, ctx.msg.text);
      await ctx.reply("✅ **Channel post updated!**", {
        reply_markup: new InlineKeyboard().text("🔙 Back", `ch_post_history_${chId}_0`),
      });
      if (promptId) await ctx.api.deleteMessage(ctx.from!.id, promptId).catch(() => {});
      await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();
    } catch (e: any) {
      await ctx.reply(`❌ **Edit Failed:** ${e.message}`);
    }
    return;
  }

  return next();
});
