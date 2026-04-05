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

    // A. Extract Preview Metadata (Exact Parity with oldbotlogic)
    let contentType = 'text';
    let textContent = ctx.msg.text || null;
    let fileId = null;
    let caption = ctx.msg.caption || null;

    if (ctx.msg.photo) {
      contentType = 'photo';
      fileId = ctx.msg.photo[ctx.msg.photo.length - 1].file_id;
    } else if (ctx.msg.video) {
      contentType = 'video';
      fileId = ctx.msg.video.file_id;
    } else if (ctx.msg.document) {
      contentType = 'document';
      fileId = ctx.msg.document.file_id;
    } else if (ctx.msg.animation) {
      contentType = 'animation';
      fileId = ctx.msg.animation.file_id;
    }

    // B. Store the record (Full schema compliance)
    console.log(`[SQL-DEBUG] Broadcast Start: msg=${msgId}, type=${contentType}`);
    
    // 🔍 Fetch current user count for target audience
    const countRes = await ctx.db.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>();
    const totalUsers = countRes?.c || 0;

    const { meta } = await ctx.db.prepare(
      "INSERT INTO broadcasts (message_id, from_chat_id, content_type, text_content, file_id, caption, total_users, status) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')"
    ).bind(
      Number(msgId), 
      Number(ctx.from!.id), 
      String(contentType), 
      textContent ? String(textContent) : null, 
      fileId ? String(fileId) : null, 
      caption ? String(caption) : null,
      Number(totalUsers)
    ).run();
    const bId = meta.last_row_id;
    
    // ✨ Send Preview to Admin
    await ctx.api.copyMessage(ctx.from!.id, ctx.from!.id, msgId);

    const kb = new InlineKeyboard().text("🚀 Start", `confirm_broadcast:${bId}`).row().text("❌ Cancel", `cancel_broadcast:${bId}`);
    await ctx.reply(`✨ **Preview above.** Ready to transmit? (#${bId})\n\nThis will be sent to **${totalUsers}** active users.`, { 
      reply_markup: kb, 
      parse_mode: "Markdown",
      reply_to_message_id: msgId
    });
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
      const preview = (ctx.msg.text || ctx.msg.caption || "Media/Post").substring(0, 50);
      await ctx.db.prepare("INSERT INTO channel_posts (channel_id, message_id, text_preview) VALUES (?, ?, ?)").bind(String(chId), Number(sent.message_id), String(preview)).run();
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

  // 9. Broadcast Exclusion Manager (Add/Remove ID)
  if (stateRow.state === "wait_exclude_id" || stateRow.state === "wait_unexclude_id") {
    if (!isOwner(ctx)) return;
    const targetId = parseInt(ctx.msg.text.trim());
    const isAdding = stateRow.state === "wait_exclude_id";

    if (isNaN(targetId)) return ctx.reply("❌ **Invalid ID.** Please send a numeric User ID.");

    try {
      if (isAdding) {
        await ctx.db.prepare("INSERT OR IGNORE INTO broadcast_exclusions (user_id) VALUES (?)").bind(targetId).run();
        await ctx.reply(`🚫 **User ${targetId} added to Exclusions.**`, {
          reply_markup: new InlineKeyboard().text("🔙 Back to Manager", "broadcast_exclusions")
        });
      } else {
        await ctx.db.prepare("DELETE FROM broadcast_exclusions WHERE user_id = ?").bind(targetId).run();
        await ctx.reply(`✅ **User ${targetId} removed from Exclusions.**`, {
          reply_markup: new InlineKeyboard().text("🔙 Back to Manager", "broadcast_exclusions")
        });
      }
      await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();
    } catch (e: any) {
      await ctx.reply(`❌ **Operation Failed:** ${e.message}`);
    }
    return;
  }

  // 10. Ghost Admin Assignment (Channel -> Admin)
  if (stateRow.state.startsWith("wait_assign_ch_admin:")) {
    if (!isOwner(ctx)) return;
    const chId = stateRow.state.split(":")[1];
    const targetUserId = parseInt(ctx.msg.text.trim());

    if (isNaN(targetUserId)) return ctx.reply("❌ **Invalid ID.** Please send a numeric User ID.");

    try {
      // Update the channel owner
      await ctx.db.prepare("UPDATE channels SET added_by = ? WHERE id = ?")
        .bind(Number(targetUserId), String(chId)).run();

      await ctx.reply(`✅ **Assignment Complete!**\n\nChannel \`${chId}\` is now managed by **${targetUserId}**.`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Channels", "admin_channels")
      });
      await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();
    } catch (e: any) {
      await ctx.reply(`❌ **Assignment Failed:** ${e.message}`);
    }
    return;
  }

  return next();
});
