import { Composer, InlineKeyboard } from "grammy";
import { MyContext } from "../types";
import { getSetting, esc } from "../core/database";
import * as Stats from "../services/stats.service";
import * as Broadcast from "../services/broadcast.service";

export const ownerModule = new Composer<MyContext>();

/**
 * 👑 Owner Feature Module
 * - Handles the main administrative dashboard.
 * - Handles broadcasting, admin management, and advanced analytics.
 * - Handles bot settings (Auto-delete, start/help texts).
 */

const isOwner = (ctx: MyContext) => ctx.role === "owner";
const isAdmin = (ctx: MyContext) => ["owner", "admin"].includes(ctx.role);

// --- COMMANDS ---

// 1. /admin - Open Dashboard
ownerModule.command("admin", async (ctx) => {
  if (!isAdmin(ctx)) return;
  return renderAdminMain(ctx);
});

// 2. /broadcast - Start broadcast flow
ownerModule.command("broadcast", async (ctx) => {
  if (!isOwner(ctx)) return;
  const prompt = await ctx.reply("📣 **Broadcast Message**\n\nForward or send me any message that you want to send to all users.\n\nSend /cancel to stop.", { parse_mode: "Markdown" });
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)").bind(ctx.from!.id, `wait_broadcast_msg:${prompt.message_id}`).run();
});

// 3. /addadmin - Promote users
ownerModule.command("addadmin", async (ctx) => {
  if (!isOwner(ctx)) return;
  const parts = ctx.match.split(" ");
  if (parts.length < 1) return ctx.reply("Usage: `/addadmin <id> [admin|owner]`");
  const id = parseInt(parts[0]);
  const role = (parts[1] === "owner") ? "owner" : "admin";
  await ctx.db.prepare("INSERT OR REPLACE INTO admins (user_id, role) VALUES (?, ?)").bind(id, role).run();
  await ctx.reply(`✅ User \`${id}\` promoted to \`${role}\`!`, { parse_mode: "Markdown" });
});

// 4. /exclude, /fj_exclude, /fj_include - Exclusions
ownerModule.command("exclude", async (ctx) => {
  if (!isOwner(ctx)) return;
  const id = parseInt(ctx.match);
  if (isNaN(id)) return ctx.reply("❌ Usage: `/exclude <user_id>`");
  await ctx.db.prepare("INSERT OR REPLACE INTO broadcast_exclusions (user_id) VALUES (?)").bind(id).run();
  await ctx.reply(`✅ **User \`${id}\` excluded** from broadcasts.`, { parse_mode: "Markdown" });
});

ownerModule.command("fj_exclude", async (ctx) => {
  if (!isOwner(ctx)) return;
  const id = parseInt(ctx.match);
  if (isNaN(id)) return ctx.reply("❌ Usage: `/fj_exclude <user_id>`");
  await ctx.db.prepare("INSERT OR REPLACE INTO fj_exclusions (user_id) VALUES (?)").bind(id).run();
  await ctx.reply(`✅ **User \`${id}\` whitelisted** (Bypasses Force Join).`, { parse_mode: "Markdown" });
});

ownerModule.command("blocklist", async (ctx) => {
  if (!isAdmin(ctx)) return;
  return renderBlockList(ctx);
});

// 5. /block, /unblock - Direct access
ownerModule.command("block", async (ctx) => {
  if (! isAdmin(ctx)) return;
  const id = parseInt(ctx.match);
  if (isNaN(id)) return ctx.reply("❌ Usage: `/block <user_id>`");
  await ctx.db.prepare("INSERT OR REPLACE INTO blocked_users (user_id) VALUES (?, ?)").bind(id, "Blocked by admin").run();
  await ctx.reply(`🚫 User \`${id}\` blocked.`);
});

// 6. /init - Initialize bot menus
ownerModule.command("init", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ **Access Denied.** Only Admins can use /init.");

  await ctx.reply("🔄 **Initializing Bot Menus...**");

  try {
    // 1. Standard User Menu - Using all_private_chats for better visibility
    const standardCommands = [
      { command: "start", description: "Start the bot / Access files" },
      { command: "help", description: "Usage instructions" },
      { command: "about", description: "About the bot" },
    ];

    await ctx.api.setMyCommands(standardCommands, { scope: { type: "default" } });
    await ctx.api.setMyCommands(standardCommands, { scope: { type: "all_private_chats" } });

    // 2. Admin Menu
    const adminCommands = [
      { command: "start", description: "Start / Access files" },
      { command: "about", description: "About the bot" },
      { command: "admin", description: "Open Dashboard" },
      { command: "store", description: "Store Single File" },
      { command: "bulk", description: "Start Bulk Upload" },
      { command: "help", description: "Admin Help" },
    ];

    // Root Owner
    await ctx.api.setMyCommands(adminCommands, { 
      scope: { type: "chat", chat_id: parseInt(ctx.config.ADMIN_UID) } 
    }).catch(e => console.error(`Root Owner Menu Err: ${e.message}`));

    // Secondary Admins
    const { results: admins } = await ctx.db.prepare("SELECT user_id FROM admins").all<{ user_id: number }>();
    for (const adm of admins) {
      await ctx.api.setMyCommands(adminCommands, { 
        scope: { type: "chat", chat_id: adm.user_id } 
      }).catch(e => console.error(`Admin Menu Err (${adm.user_id}): ${e.message}`));
    }

    await ctx.reply("✅ **Bot initialized successfully!**\n\nCommand menus have been synchronized globally for all users and staff.\n\n*Note: Users may need to restart their Telegram app to see the changes immediately.*");
  } catch (e: any) {
    await ctx.reply(`❌ **Initialization Failed:** ${e.message}`);
  }
});

// --- CALLBACKS ---

ownerModule.callbackQuery("admin_main", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCallbackQuery();
  return renderAdminMain(ctx);
});

// 📊 Global Stats
ownerModule.callbackQuery("admin_stats", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCallbackQuery();
  const s = await Stats.getGlobalStats(ctx);
  await ctx.editMessageText(`📊 **Global Stats**\n\n👤 Users: ${s.total_users}\n🔗 Links: ${s.total_links}\n👁️ Views: ${s.total_views || 0}\n⬇️ Downloads: ${s.total_downloads || 0}`, { reply_markup: new InlineKeyboard().text("🔙 Back", "admin_main"), parse_mode: "Markdown" });
});

// 💎 Advanced Stats Menu
ownerModule.callbackQuery("owner_adv_stats", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard()
    .text("📉 Activity", "adv_activity").text("📥 Downloads", "adv_downloads").row()
    .text("📤 Storage", "adv_storage").text("👤 User List", "owner_users_0").row()
    .text("🔙 Back", "admin_main");
  await ctx.editMessageText("💎 **Advanced Analytics**", { reply_markup: kb, parse_mode: "Markdown" });
});

// ⚙️ Settings Menu
ownerModule.callbackQuery("owner_texts", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard()
    .text("⏳ Auto Delete", "admin_autodelete").row()
    .text("Edit Start", "edit_start_text").text("Edit Help", "edit_help_text").row()
    .text("Edit About", "edit_about_text").row()
    .text("🔗 Edit Updates", "edit_about_updates_text").text("🛠 Edit Support", "edit_about_support_text").row()
    .text("🔙 Back", "admin_main");
  await ctx.editMessageText("⚙️ **Settings**", { reply_markup: kb, parse_mode: "Markdown" });
});

ownerModule.callbackQuery(/^edit_(start|help|about|about_updates|about_support)_text$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const type = ctx.match[1].replace(/_/g, " ");
  
  let prompt = `Please send the new <b>${type}</b> text/URL.`;
  if (type === "start") prompt += "\n\n<i>Tip: Use {user} to mention the user's name.</i>";
  if (type.includes("updates") || type.includes("support")) prompt += "\n\n<i>Ensure you send a valid URL (https://...)</i>";

  await ctx.editMessageText(prompt, {
    reply_markup: new InlineKeyboard().text("❌ Cancel", "owner_texts"),
    parse_mode: "HTML"
  });

  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `wait_new_${ctx.match[1]}_text`).run();
});

// --- ADMIN STAFF MANAGEMENT ---

/**
 * 👥 Admin Management Dashboard
 * Shows all active staff and provides revocation controls.
 */
ownerModule.callbackQuery("owner_admins", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  return renderOwnerAdmins(ctx);
});

ownerModule.callbackQuery("add_adm_info", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.editMessageText("➕ **Promote a User**\n\nUse this command to grant admin/owner status:\n`/addadmin <id> [admin|owner]`\n\n*Note: Root owners cannot be revoked.*", {
    reply_markup: new InlineKeyboard().text("🔙 Back", "owner_admins"),
    parse_mode: "Markdown"
  });
});

ownerModule.callbackQuery(/^rev_adm_(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const targetId = ctx.match[1];
  
  if (targetId === ctx.config.ADMIN_UID) {
    return ctx.answerCallbackQuery("❌ Cannot revoke root owner!");
  }

  await ctx.db.prepare("DELETE FROM admins WHERE user_id = ?").bind(targetId).run();
  await ctx.answerCallbackQuery("✅ Staff rights revoked.");
  return renderOwnerAdmins(ctx);
});

ownerModule.callbackQuery("create_link_for", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("🎯 **Delegated Creation**\n\nPlease send the **User ID** of the person who should own the next created link.\n\nType /cancel to stop.", {
    reply_markup: new InlineKeyboard().text("🔙 Back", "admin_main"),
    parse_mode: "Markdown"
  });
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `create_link_for_wait_id`).run();
});

// --- EXCLUSION MANAGEMENT ---

/**
 * 🚫 Exclusion Dashboard
 * Route for managing broadcast bans and FJ whitelists.
 */
ownerModule.callbackQuery("create_link_for", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  return renderAdminPicker(ctx);
});

ownerModule.callbackQuery(/^set_create_link_for_(\d+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const targetId = parseInt(ctx.match[1]);
  await ctx.answerCallbackQuery("🎯 Delegation active!");
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `create_link_for_${targetId}`).run();
  
  await ctx.editMessageText(`🎯 **Delegated Creation Active!**\n\nThe next link you create will be assigned to: \`${targetId}\`\n\nSend the file(s) now to begin.`, {
    reply_markup: new InlineKeyboard().text("🔙 Back", "admin_main"),
    parse_mode: "Markdown"
  });
});

/**
 * 🚫 Exclusion Dashboard
 * Route for managing broadcast bans and FJ whitelists.
 */
ownerModule.callbackQuery("owner_exclusions", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard()
    .text("📢 Broadcast Exclusions", "manage_excl_broadcast").row()
    .text("🔒 Force-Join Whitelist", "manage_excl_fj").row()
    .text("🔙 Back", "admin_main");
  await ctx.editMessageText("🚫 **Exclusion Management**\n\nManage users who are bypassed by key bot features.", { reply_markup: kb, parse_mode: "Markdown" });
});

ownerModule.callbackQuery("manage_excl_broadcast", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const { results: excluded } = await ctx.db.prepare("SELECT be.user_id, u.first_name FROM broadcast_exclusions be LEFT JOIN users u ON be.user_id = u.user_id").all<any>();
  const { results: admins } = await ctx.db.prepare("SELECT a.user_id, u.first_name FROM admins a LEFT JOIN users u ON a.user_id = u.user_id").all<any>();
  
  let text = "📢 **Broadcast Exclusions** (Blocked Users)\n\n";
  const kb = new InlineKeyboard();
  
  if (excluded.length === 0) text += "_No one is manually excluded._";
  else {
    excluded.forEach(u => {
      text += `• ${u.first_name || "User"} (\`${u.user_id}\`)\n`;
      kb.text(`🗑 Remove ${u.user_id}`, `del_excl_broadcast_${u.user_id}`).row();
    });
  }

  // 🛡️ Quick Exclude Admins (Ported from Legacy)
  if (admins && admins.length > 0) {
    text += "\n**Quick-Toggle Admins:**\n";
    const excludedIds = new Set(excluded.map(e => e.user_id.toString()));
    
    admins.forEach(adm => {
      const isExcl = excludedIds.has(adm.user_id.toString());
      const icon = isExcl ? "✅" : "❌";
      kb.text(`${icon} ${adm.first_name || adm.user_id}`, `toggle_adm_excl_${adm.user_id}`);
    });
    kb.row();
  }

  kb.text("🔙 Back", "owner_exclusions");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
});

ownerModule.callbackQuery(/^toggle_adm_excl_(\d+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const targetId = ctx.match[1];
  const exists = await ctx.db.prepare("SELECT user_id FROM broadcast_exclusions WHERE user_id = ?").bind(targetId).first();
  
  if (exists) {
    await ctx.db.prepare("DELETE FROM broadcast_exclusions WHERE user_id = ?").bind(targetId).run();
    await ctx.answerCallbackQuery("✅ Admin will now receive broadcasts.");
  } else {
    await ctx.db.prepare("INSERT INTO broadcast_exclusions (user_id) VALUES (?)").bind(targetId).run();
    await ctx.answerCallbackQuery("✅ Admin excluded from broadcasts.");
  }
  return ctx.callbackQuery.data = "manage_excl_broadcast";
});

ownerModule.callbackQuery("manage_excl_fj", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const { results: excluded } = await ctx.db.prepare("SELECT fe.user_id, u.first_name FROM fj_exclusions fe LEFT JOIN users u ON fe.user_id = u.user_id").all<any>();
  let text = "🔒 **Force-Join Whitelist** (Bypassed Users)\n\n";
  const kb = new InlineKeyboard();
  if (excluded.length === 0) text += "_No one is whitelisted._";
  else {
    excluded.forEach(u => {
      text += `• ${u.first_name || "User"} (\`${u.user_id}\`)\n`;
      kb.text(`🗑 Remove ${u.user_id}`, `del_excl_fj_${u.user_id}`).row();
    });
  }
  kb.text("🔙 Back", "owner_exclusions");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
});

ownerModule.callbackQuery(/^del_excl_(broadcast|fj)_(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const type = ctx.match[1];
  const userId = ctx.match[2];
  const table = type === "broadcast" ? "broadcast_exclusions" : "fj_exclusions";
  await ctx.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId).run();
  await ctx.answerCallbackQuery("✅ Corrected exclusion list.");
  
  // Dynamic refresh based on type
  if (type === "broadcast") return ctx.callbackQuery.data = "manage_excl_broadcast";
  return ctx.callbackQuery.data = "manage_excl_fj";
});

ownerModule.callbackQuery("id_block_info", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("🚫 **Block User**\n\nPlease send the **User ID** you want to block.\n\nType /cancel to stop or click below to see currently blocked users.", {
    reply_markup: new InlineKeyboard().text("📋 Show Blocked List", "admin_block_list").row().text("🔙 Back", "admin_main"),
    parse_mode: "Markdown"
  });
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `wait_block_id`).run();
});

ownerModule.callbackQuery("admin_block_list", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCallbackQuery();
  return renderBlockList(ctx);
});

ownerModule.callbackQuery(/^del_block_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.match[1];
  await ctx.db.prepare("DELETE FROM blocked_users WHERE user_id = ?").bind(targetId).run();
  await ctx.answerCallbackQuery("✅ User unblocked.");
  return renderBlockList(ctx);
});

// --- SETTINGS & TEXTS MANAGEMENT ---

/**
 * ⚙️ Settings Dashboard
 * Entry point for bot-wide configurations and text overrides.
 */
ownerModule.callbackQuery("admin_autodelete", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const curr = await getSetting(ctx.db, "auto_delete_time", "off");
  const kb = new InlineKeyboard()
    .text(curr === "5m" ? "🟢 5m" : "5m", "set_ad_5m").text(curr === "10m" ? "🟢 10m" : "10m", "set_ad_10m").text(curr === "30m" ? "🟢 30m" : "30m", "set_ad_30m").row()
    .text(curr === "1h" ? "🟢 1h" : "1h", "set_ad_1h").text(curr === "6h" ? "🟢 6h" : "6h", "set_ad_6h").text(curr === "12h" ? "🟢 12h" : "12h", "set_ad_12h").row()
    .text(curr === "off" ? "🛑 Off" : "off", "set_ad_off").row().text("🔙 Back", "owner_texts");
  await ctx.editMessageText(`⏳ **Auto Delete**\nCurrent: **${curr}**\n\nAutomatically delete sent files after the specified time.`, { reply_markup: kb, parse_mode: "Markdown" });
});

ownerModule.callbackQuery(/^set_ad_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const val = ctx.match[1];
  await ctx.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind("auto_delete_time", val).run();
  await ctx.answerCallbackQuery(`✅ Auto-Delete: ${val}`);
  
  // Instant UI Refresh
  const kb = new InlineKeyboard()
    .text(val === "5m" ? "🟢 5m" : "5m", "set_ad_5m").text(val === "10m" ? "🟢 10m" : "10m", "set_ad_10m").text(val === "30m" ? "🟢 30m" : "30m", "set_ad_30m").row()
    .text(val === "1h" ? "🟢 1h" : "1h", "set_ad_1h").text(val === "6h" ? "🟢 6h" : "6h", "set_ad_6h").text(val === "12h" ? "🟢 12h" : "12h", "set_ad_12h").row()
    .text(val === "off" ? "🛑 Off" : "off", "set_ad_off").row().text("🔙 Back", "owner_texts");
  return ctx.editMessageText(`⏳ **Auto Delete**\nCurrent: **${val}**`, { reply_markup: kb, parse_mode: "Markdown" });
});

ownerModule.callbackQuery("edit_start_text", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.editMessageText("✏️ **Edit Start Text**\n\nSend the new welcome message. Use `{user}` for user mention.\n\n*Note: Markdown is supported.*", {
    reply_markup: new InlineKeyboard().text("🔙 Back", "owner_texts"),
    parse_mode: "Markdown"
  });
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `wait_new_start_text:${ctx.callbackQuery.message?.message_id}`).run();
});

ownerModule.callbackQuery("edit_help_text", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.editMessageText("✏️ **Edit Help Text**\n\nSend the new help guide text for your users.", {
    reply_markup: new InlineKeyboard().text("🔙 Back", "owner_texts"),
    parse_mode: "Markdown"
  });
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `wait_new_help_text:${ctx.callbackQuery.message?.message_id}`).run();
});

ownerModule.callbackQuery("edit_about_text", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.editMessageText("✏️ **Edit About Text**\n\nPlease send the new detailed 'About' section for your bot.\n\n*Note: Markdown is supported.*", {
    reply_markup: new InlineKeyboard().text("🔙 Back", "owner_texts"),
    parse_mode: "Markdown"
  });
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `wait_new_about_text:${ctx.callbackQuery.message?.message_id}`).run();
});

ownerModule.callbackQuery("owner_set_menu", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.editMessageText("🔄 **Update Command Menu**\n\nForce-refresh the bot command menu for all users and admins.", {
    reply_markup: new InlineKeyboard().text("✅ Start /init", "run_init").row().text("🔙 Back", "admin_main"),
    parse_mode: "Markdown"
  });
});

ownerModule.callbackQuery("run_init", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery("⚠️ Please send /init directly.");
  await ctx.editMessageText("⚠️ **Manual Action Required**\n\nPlease send the `/init` command directly to the bot chat to refresh all scopes.", {
    reply_markup: new InlineKeyboard().text("🔙 Back", "admin_main")
  });
});

// --- ADVANCED ANALYTICS & BROADCASTING ---

/**
 * 📢 Broadcast Initiation
 * Triggers the message capture flow for global transmissions.
 */
ownerModule.callbackQuery("broadcast_info", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard()
    .text("📣 New Broadcast", "broadcast_new").row()
    .text("📊 Broadcast History", "broadcast_history_0").row()
    .text("🔙 Back", "admin_main");
  await ctx.editMessageText("📣 **Broadcast Menu**\n\nManage your global transmissions and campaign logs.", { reply_markup: kb, parse_mode: "Markdown" });
});

ownerModule.callbackQuery("broadcast_new", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.editMessageText("📣 **New Broadcast**\n\nPlease forward or send the message you want to transmit to all users.\n\n*Markdown and Media (Photo/Video/Files) are supported.*", {
    reply_markup: new InlineKeyboard().text("❌ Cancel", "broadcast_info"),
    parse_mode: "Markdown"
  });
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `wait_broadcast_msg:${ctx.callbackQuery.message?.message_id}`).run();
});

ownerModule.callbackQuery(/^broadcast_history_(\d+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const page = parseInt(ctx.match[1]);
  const limit = 5;
  const offset = page * limit;

  const { results: broadcasts } = await ctx.db.prepare("SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .bind(limit, offset).all<any>();
  const countRes = await ctx.db.prepare("SELECT COUNT(*) as c FROM broadcasts").first<{ c: number }>();
  const total = countRes?.c || 0;

  let text = `📊 **Broadcast History** (Page ${page + 1})\n\n`;
  const kb = new InlineKeyboard();

  if (broadcasts.length === 0) text += "_No broadcasts recorded yet._";
  else {
    broadcasts.forEach((b: any) => {
      const statusIcon = b.status === 'completed' ? '✅' : (b.status === 'running' ? '⏳' : '🕒');
      text += `${statusIcon} **ID #${b.id}** (${b.status})\n`;
      text += `📅 ${new Date(b.created_at).toLocaleString()}\n`;
      text += `🏁 Total: ${b.total_users} | ✅ Sent: ${b.sent} | ❌ Fail: ${b.failed}\n\n`;
      kb.text(`🔍 Details #${b.id}`, `broadcast_report_${b.id}`).row();
    });
  }

  if (page > 0) kb.text("◀️ Prev", `broadcast_history_${page - 1}`);
  if (offset + limit < total) kb.text("Next ▶️", `broadcast_history_${page + 1}`);
  kb.row().text("🔙 Back", "broadcast_info");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
});

ownerModule.callbackQuery(/^broadcast_report_(\d+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const bId = ctx.match[1];
  const b = await ctx.db.prepare("SELECT * FROM broadcasts WHERE id = ?").bind(bId).first<any>();
  if (!b) return ctx.answerCallbackQuery("Not found.");

  let text = `📈 **Broadcast Report #${bId}**\n\n`;
  text += `🏁 **Target Audience:** ${b.total_users}\n`;
  text += `✅ **Successful:** ${b.sent}\n`;
  text += `❌ **Failed:** ${b.failed}\n`;
  
  const successRate = b.total_users > 0 ? Math.round((b.sent / b.total_users) * 100) : 0;
  text += `📊 **Success Rate:** ${successRate}%\n\n`;
  text += `🕒 **Created At:** ${new Date(b.created_at).toLocaleString()}\n`;
  text += `🛰 **Status:** ${b.status.toUpperCase()}\n`;

  const kb = new InlineKeyboard();
  
  if (b.status === "running") {
    kb.text("⏸️ Pause", `toggle_bc_status_${bId}`).row();
  } else if (b.status === "paused") {
    kb.text("▶️ Resume", `toggle_bc_status_${bId}`).row();
  }

  if (b.failed > 0 && b.status === "completed") {
    kb.text("🔄 Retry Failed Users", `retry_broadcast_${bId}`).row();
  }

  kb.text("🗑 Delete Campaign", `del_broadcast_${bId}`).row();
  kb.text("🔙 Back to History", "broadcast_history_0");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
});

ownerModule.callbackQuery(/^toggle_bc_status_(\d+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const bId = parseInt(ctx.match[1]);
  try {
    const newStatus = await Broadcast.toggleBroadcastStatus(ctx, bId);
    await ctx.answerCallbackQuery(`📡 Status: ${newStatus}`);
    return ctx.callbackQuery.data = `broadcast_report_${bId}`;
  } catch (e: any) {
    await ctx.answerCallbackQuery(`❌ Failed: ${e.message}`);
  }
});

ownerModule.callbackQuery(/^del_broadcast_(\d+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const bId = parseInt(ctx.match[1]);
  await Broadcast.deleteBroadcast(ctx, bId);
  await ctx.answerCallbackQuery("🗑 Campaign Purged.");
  return ctx.callbackQuery.data = "broadcast_history_0";
});

ownerModule.callbackQuery(/^retry_broadcast_(\d+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const bId = parseInt(ctx.match[1]);
  try {
    // 1. Reset status to pending so Render engine can pick it up again
    // Actually, we might need a specific 'retry' flag or just mark as pending.
    // Assuming the Render engine looks for 'pending' or 'running'.
    await ctx.db.prepare("UPDATE broadcasts SET status = 'pending', sent = 0, failed = 0 WHERE id = ?").bind(bId).run();
    
    await Broadcast.startBroadcast(ctx, bId);
    await ctx.answerCallbackQuery("🔄 Retry Started!");
    await ctx.editMessageText(`🔄 **Retry for Broadcast #${bId} Engaged**\n\nThe engine is now re-attempting delivery to failed recipients.`, {
      reply_markup: new InlineKeyboard().text("🔙 Check History", "broadcast_history_0")
    });
  } catch (e: any) {
    await ctx.answerCallbackQuery(`❌ Retry Failed: ${e.message}`);
  }
});

/**
 * 📈 Advanced Analytics Logic
 * Sub-dashboards for deep oversight of bot activity.
 */
ownerModule.callbackQuery("adv_activity", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const metrics = await Stats.getActivityMetrics(ctx);
  await ctx.editMessageText(`📉 <b>User Activity</b>\n\nDaily Active (DAU): <b>${metrics.dau}</b>\nMonthly Active (MAU): <b>${metrics.mau}</b>\n\n<i>Tracking based on unique interaction events per cycle.</i>`, {
    reply_markup: new InlineKeyboard().text("🔙 Back", "owner_adv_stats"),
    parse_mode: "HTML"
  });
});

ownerModule.callbackQuery("adv_downloads", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const data = await Stats.getTopDownloads(ctx);
  let text = "📥 <b>Top Downloads</b>\n\n";
  data.top_files.forEach((f, i) => text += `${i+1}. ${f.file_name} (<b>${f.downloads}</b>)\n`);
  text += `\nTotal Delivered: <b>${data.total_delivered}</b> files.`;
  await ctx.editMessageText(text, { reply_markup: new InlineKeyboard().text("🔙 Back", "owner_adv_stats"), parse_mode: "HTML" });
});

ownerModule.callbackQuery("adv_storage", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const s = await Stats.getGlobalStats(ctx); 
  await ctx.editMessageText(`📤 <b>Storage Integrity</b>\n\nTotal Links: <b>${s.total_links}</b>\nTotal Files: <b>${s.total_files || "?"}</b>\n\n<i>Files are distributed across Duo-Storage channels.</i>`, {
    reply_markup: new InlineKeyboard().text("🧹 Purge Temp Files", "purge_temp_bulk").row().text("🔙 Back", "owner_adv_stats"),
    parse_mode: "HTML"
  });
});

ownerModule.callbackQuery("purge_temp_bulk", async (ctx) => {
  if (!isOwner(ctx)) return;
  const res = await ctx.db.prepare("DELETE FROM temp_bulk_files").run();
  await ctx.answerCallbackQuery(`🧹 Cleaned ${res.meta.changes} files.`);
});

ownerModule.callbackQuery(/^owner_users_(\d+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const page = parseInt(ctx.match[1]);
  const data = await Stats.getUserDirectory(ctx, page);
  
  let text = `👤 <b>User Directory</b> (Page ${page + 1})\n\n`;
  data.users.forEach((u: any) => {
    const name = u.first_name ? esc(u.first_name) : "User";
    text += `• <a href="tg://user?id=${u.user_id}">${name}</a> (<code>${u.user_id}</code>)\n`;
  });
  
  const kb = new InlineKeyboard();
  if (page > 0) kb.text("◀️ Prev", `owner_users_${page - 1}`);
  if (data.hasMore) kb.text("Next ▶️", `owner_users_${page + 1}`);
  kb.row().text("🔙 Back", "owner_adv_stats");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
});

/**
 * 🚀 Start Broadcast Flow 
 * Now integrated with Broadcast Service for proper handoff to Render.
 */
ownerModule.callbackQuery(/^confirm_broadcast:(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const bId = parseInt(ctx.match[1]);
  try {
    await Broadcast.startBroadcast(ctx, bId);
    await ctx.answerCallbackQuery("🚀 Transmission Started!");
    await ctx.editMessageText(`🚀 **Broadcast Campaign #${bId} is now RUNNING**\n\nThe transmission has been handed over to the external engine. Stats will update in real-time.`, {
      reply_markup: new InlineKeyboard().text("🔙 Back", "admin_main")
    });
  } catch (e: any) {
    await ctx.answerCallbackQuery(`❌ Failed: ${e.message}`);
  }
});

// --- RENDERERS ---

/**
 * Lists all administrativ staff from the database.
 */
async function renderOwnerAdmins(ctx: MyContext) {
  const { results: admins } = await ctx.db.prepare("SELECT a.*, u.first_name as name FROM admins a LEFT JOIN users u ON a.user_id = u.user_id").all<any>();
  let text = "👤 **Manage Admin Staff:**\n\n";
  const kb = new InlineKeyboard();
  
  admins.forEach((a: any) => {
    const rawName = a.name || "Unknown";
    const roleIcon = a.role === "owner" ? "👑" : "🛡️";
    text += `${roleIcon} **${rawName}** (\`${a.user_id}\`)\n`;
    
    // Cannot revoke the root admin (from config)
    if (a.user_id.toString() !== ctx.config.ADMIN_UID) {
      /**
       * 🛡️ Safe Slicing
       * We use character-aware slicing to prevent breaking UTF-8 multi-byte sequences.
       */
      const safeName = [...rawName].slice(0, 10).join("");
      kb.text(`❌ Revoke ${safeName}...`, `rev_adm_${a.user_id}`).row();
    }
  });
  
  kb.text("➕ Add Admin", "add_adm_info").row().text("🔙 Back", "admin_main");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
}

async function renderAdminPicker(ctx: MyContext) {
  const { results: admins } = await ctx.db.prepare("SELECT a.user_id, u.first_name as name FROM admins a LEFT JOIN users u ON a.user_id = u.user_id").all<any>();
  let text = "🎯 **Choose Target Administrator**\n\nSelect which staff member will own the link you are about to create:";
  const kb = new InlineKeyboard();
  
  admins.forEach((a: any) => {
    kb.text(`🛡️ ${a.name || a.user_id}`, `set_create_link_for_${a.user_id}`).row();
  });
  
  kb.text("🔙 Back", "admin_main");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
}

async function renderBlockList(ctx: MyContext) {
  const { results: blocked } = await ctx.db.prepare("SELECT bu.*, u.first_name FROM blocked_users bu LEFT JOIN users u ON bu.user_id = u.user_id").all<any>();
  let text = "🚫 **Blocked Users Directory:**\n\n";
  const kb = new InlineKeyboard();
  
  if (blocked.length === 0) {
    text += "_No users are currently blocked._";
  } else {
    blocked.forEach((u: any) => {
      text += `• ${u.first_name || "User"} (\`${u.user_id}\`)\n`;
      kb.text(`🗑 Unblock ${u.user_id}`, `del_block_${u.user_id}`).row();
    });
  }
  
  kb.text("🔙 Back", "admin_main");
  const opts = { reply_markup: kb, parse_mode: "Markdown" as const };
  if (ctx.callbackQuery) return ctx.editMessageText(text, opts);
  return ctx.reply(text, opts);
}

async function renderAdminMain(ctx: MyContext) {
  const kb = new InlineKeyboard()
    .text("📁 Manage Links", "page_links_0").text("📢 Manage Channels", "admin_channels").row()
    .text("📊 Global Stats", "admin_stats").text("🚫 Block User", "id_block_info").row();
    
  if (isOwner(ctx)) {
    kb.text("📣 Broadcast", "broadcast_info").row()
      .text("👤 Manage Admins", "owner_admins").text("🔗 Create Link For", "create_link_for").row()
      .text("⚙️ Bot Settings", "owner_texts").text("💎 Advanced Stats", "owner_adv_stats").row()
      .text("🚫 Exclusions", "owner_exclusions").text("🔄 Set Menu", "owner_set_menu").row();
  }
  
  const text = isOwner(ctx) ? "🛠 **Owner Dashboard**" : "🛠 **Admin Dashboard**";
  if (ctx.callbackQuery) return ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
  return ctx.reply(text, { reply_markup: kb, parse_mode: "Markdown" });
}
