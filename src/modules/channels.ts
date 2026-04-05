import { Composer, InlineKeyboard, Keyboard } from "grammy";
import { MyContext, DatabaseChannel } from "../types";
import { esc } from "../core/database";
import { registerChannel, reorderChannel } from "../services/channel.service";

export const channelsModule = new Composer<MyContext>();

/**
 * 📢 Channels Feature Module
 * - Handles Force-Join channel management.
 * - Handles auto-registration via 'my_chat_member' events.
 * - Handles channel reordering and mode (Direct/Request) configuration.
 */

const isAdmin = (ctx: MyContext) => ["owner", "admin"].includes(ctx.role);
const isOwner = (ctx: MyContext) => ctx.role === "owner";

// --- CALLBACKS ---

channelsModule.callbackQuery("admin_channels", async (ctx) => {
  if (!isAdmin(ctx)) return;
  return renderChannelList(ctx);
});

channelsModule.callbackQuery(/^manage_ch_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  return renderManageChannel(ctx, ctx.match[1]);
});

channelsModule.callbackQuery(/^toggle_ch_fj_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const chatId = ctx.match[1];
  await ctx.db.prepare("UPDATE channels SET is_force_join = 1 - is_force_join WHERE id = ?").bind(chatId).run();
  await ctx.answerCallbackQuery("Toggled!");
  return renderManageChannel(ctx, chatId);
});

channelsModule.callbackQuery(/^del_channel_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const chatId = ctx.match[1];
  if (!isOwner(ctx)) {
    const ch = await ctx.db.prepare("SELECT added_by FROM channels WHERE id = ?").bind(chatId).first<DatabaseChannel>();
    if (ch?.added_by !== ctx.from!.id) return ctx.answerCallbackQuery("❌ Access Denied");
  }
  await ctx.db.prepare("DELETE FROM channels WHERE id = ?").bind(chatId).run();
  await ctx.answerCallbackQuery("Channel Removed!");
  return renderChannelList(ctx);
});

channelsModule.callbackQuery(/^move_ch_(up|down)_(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  await reorderChannel(ctx, ctx.match[2], ctx.match[1] as 'up' | 'down');
  await ctx.answerCallbackQuery(`Moved ${ctx.match[1]} ✅`);
  return renderChannelList(ctx);
});

// --- EVENTS ---

// Auto-detection when bot is added as admin
channelsModule.on("my_chat_member", async (ctx) => {
  if (ctx.chat.type !== "channel") return;
  const ncm = ctx.myChatMember.new_chat_member;
  if (ncm.status !== "administrator") return;

  if (ctx.from.id === ctx.me.id) return;

  const chId = ctx.chat.id.toString();
  const title = ctx.chat.title || "Channel";
  const username = (ctx.chat as any).username;

  if (username) {
    try {
      await registerChannel(ctx, chId, title, 'direct', username);
      return ctx.api.sendMessage(ctx.from.id, `✅ **Public Channel detected!**\nRegistered as **Direct Join**.`);
    } catch (e: any) { console.error(e); }
  }

  const kb = new InlineKeyboard().text("🔗 Direct Join", `save_ch_direct_${chId}`).text("🔒 Join Request", `save_ch_request_${chId}`);
  await ctx.api.sendMessage(ctx.from.id, `📂 **Private Channel Detected:** ${title}\n\nPlease choose the Force-Join mode:`, { reply_markup: kb });
});

// Auto-detection via "Select Channel" button (shared chat)
channelsModule.on(":chat_shared", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const chatId = ctx.msg.chat_shared.chat_id.toString();
  try {
    const chat = await ctx.api.getChat(chatId);
    const title = chat.title || "Channel";
    const username = (chat as any).username;

    if (username) {
      await registerChannel(ctx, chatId, title, 'direct', username);
      return ctx.reply(`✅ **Public Channel added directly!**\nTitle: **${esc(title)}**`);
    }

    const kb = new InlineKeyboard()
      .text("🔗 Direct Join", `save_ch_direct_${chatId}`)
      .text("🔒 Request to Join", `save_ch_request_${chatId}`);

    await ctx.reply(`✅ **Private Channel selected:** ${esc(title)}\n\nDo you want users to instantly join, or send a request to join?`, {
      reply_markup: kb
    });
  } catch (e: any) {
    await ctx.reply(`❌ **Failed to process channel.**\nError: ${e.message}`);
  }
});

// Auto-detection via "Forwarded Message"
channelsModule.on("message:forward_origin:channel", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const forward = ctx.msg.forward_origin as any;
  if (!forward || forward.type !== "channel") return;

  const chatId = forward.chat.id.toString();
  const title = forward.chat.title || "Channel";
  const username = forward.chat.username;

  try {
    const member = await ctx.api.getChatMember(chatId, ctx.me.id);
    if (member.status !== "administrator") {
      return ctx.reply("❌ **Channel Detected**, but I am not an admin there.\n\nPlease add me as an admin first, then forward the message again.");
    }

    if (username) {
      await registerChannel(ctx, chatId, title, 'direct', username);
      return ctx.reply(`✅ **Channel registered successfully!**\nTitle: **${esc(title)}**`);
    }

    const kb = new InlineKeyboard()
      .text("🔗 Direct Join", `save_ch_direct_${chatId}`)
      .text("🔒 Request to Join", `save_ch_request_${chatId}`);

    await ctx.reply(`✅ **Forwarded Channel detected:** ${esc(title)}\n\nDo you want users to instantly join, or send a request to join?`, {
      reply_markup: kb
    });
  } catch (e: any) {
    await ctx.reply(`❌ Failed to detect channel status: ${e.message}`);
  }
});

// Callback for choosing mode
channelsModule.callbackQuery(/^save_ch_(direct|request)_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const mode = ctx.match[1] as 'direct' | 'request';
  const chatId = ctx.match[2];

  try {
    const chat = await ctx.api.getChat(chatId);
    await registerChannel(ctx, chatId, chat.title || "Channel", mode, (chat as any).username);
    await ctx.answerCallbackQuery(`✅ Registered as ${mode}!`);
    await ctx.editMessageText(`✅ **Channel Fully Registered!**\nMode: **${mode === 'direct' ? '🔗 Direct Join' : '🔒 Join Request'}**`);
  } catch (e: any) {
    await ctx.answerCallbackQuery(`❌ Error: ${e.message}`);
  }
});

// --- RENDERERS ---

async function renderChannelList(ctx: MyContext) {
  let query = `
    SELECT c.*, u.first_name as admin_name 
    FROM channels c 
    LEFT JOIN users u ON c.added_by = u.user_id 
    ORDER BY c.position ASC, c.id ASC
  `;
  let params: any[] = [];
  if (!isOwner(ctx)) {
    query = `
      SELECT c.*, u.first_name as admin_name 
      FROM channels c 
      LEFT JOIN users u ON c.added_by = u.user_id 
      WHERE c.added_by = ? 
      ORDER BY c.position ASC, c.id ASC
    `;
    params = [Number(ctx.from!.id)];
  }
  console.log(`[SQL-DEBUG] Listing Channels: params=${JSON.stringify(params)}`);
  const queryObj = ctx.db.prepare(query);
  const { results: channels } = await (params.length > 0 ? queryObj.bind(...params) : queryObj).all<any>();
  let text = "📢 <b>Required Channels</b>\n\n";
  const kb = new InlineKeyboard();
  if (channels.length === 0) text += "<i>No channels found.</i>";
  else {
    channels.forEach((ch: any, i: number) => {
      const titleLink = ch.invite_link ? `<a href="${ch.invite_link}">${esc(ch.title)}</a>` : `<b>${esc(ch.title)}</b>`;
      const adder = ch.admin_name ? esc(ch.admin_name) : "System";

      text += `<code>${i + 1}.</code> ${titleLink} (<code>${ch.id}</code>)\n`;
      if (isOwner(ctx)) {
        text += `   └─ Managed By: <a href="tg://user?id=${ch.added_by}">${adder}</a>\n\n`;
      } else {
        text += `\n`;
      }

      kb.text(`${i + 1}️⃣`, `manage_ch_${ch.id}`);
      if ((i + 1) % 4 === 0) kb.row();
    });
  }
  if (channels.length % 4 !== 0) kb.row();
  kb.text("➕ Add", "add_channel_info").text("🔙 Back", "admin_main");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
}

channelsModule.callbackQuery("add_channel_info", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCallbackQuery();
  const botUser = ctx.me.username;
  const deepLink = `https://t.me/${botUser}?startchannel=true&admin=post_messages+edit_messages+delete_messages+invite_users`;

  const kb = new InlineKeyboard()
    .url("➕ Add Me as Admin", deepLink).row()
    .text("🔙 Back", "admin_channels");

  await ctx.editMessageText(
    "➕ <b>Add Channel (Highly Recommended)</b>\n\n" +
    "1. Click the <b>Add Me as Admin</b> button below.\n" +
    "2. Select your channel from the list.\n" +
    "3. Confirm adding me as an administrator.\n\n" +
    "<b>Alternative detection methods:</b>\n" +
    "• Forward any message from your channel here.\n" +
    "• Send the Channel ID (e.g. <code>-100...</code>).\n\n" +
    "<i>The bot will automatically detect the new channel and ask for the Join mode.</i>",
    { reply_markup: kb, parse_mode: "HTML" }
  );
});

async function renderManageChannel(ctx: MyContext, chatId: string) {
  const query = `
    SELECT c.*, u.first_name as adder_name, u.username as adder_username 
    FROM channels c 
    LEFT JOIN users u ON c.added_by = u.user_id 
    WHERE c.id = ?
  `;
  const ch = await ctx.db.prepare(query).bind(chatId).first<any>();
  if (!ch) return;
  if (!isOwner(ctx) && ch.added_by !== ctx.from!.id) return ctx.answerCallbackQuery("❌ Access Denied");

  const title = ch.invite_link ? `<a href="${ch.invite_link}">${esc(ch.title)}</a>` : `<b>${esc(ch.title)}</b>`;
  const addedByName = ch.adder_name ? esc(ch.adder_name) : "System/Unknown";
  const addedByLink = ch.added_by ? `<a href="tg://user?id=${ch.added_by}">${addedByName}</a>` : `<b>${addedByName}</b>`;

  let text = `📢 <b>Channel Settings</b>\nTitle: ${title}\nID: <code>${ch.id}</code>\n`;
  text += `👤 Managed By: ${addedByLink}\n\n`;

  // 🕵️ Permission Auditor (Ported from Legacy v8.4)
  try {
    const member = await ctx.api.getChatMember(ch.id, ctx.me.id);
    if (member.status === 'administrator') {
      text += `🤖 <b>Bot Permissions:</b>\n`;
      text += `${member.can_post_messages ? "✅" : "❌"} Post Messages\n`;
      text += `${member.can_edit_messages ? "✅" : "❌"} Edit Messages\n`;
      text += `${member.can_delete_messages ? "✅" : "❌"} Delete Messages\n\n`;
    } else {
      text += `⚠️ <b>Status:</b> Bot is NOT an Admin!\n\n`;
    }
  } catch (e: any) {
    text += `⚠️ <b>Status:</b> Perm check failed (${e.message})\n\n`;
  }

  const kb = new InlineKeyboard().text(ch.is_force_join ? "🟢 Force Join: ON" : "⚪ Force Join: OFF", `toggle_ch_fj_${ch.id}`).row();
  if (isOwner(ctx)) {
    kb.text("🔼 Move Up", `move_ch_up_${ch.id}`).text("🔽 Move Down", `move_ch_down_${ch.id}`).row();
    kb.text("👮 Admin List", `ch_admins_${ch.id}`).row();
    kb.text("📝 Post Message", `post_to_ch_${ch.id}`).row();
    kb.text("📜 Post History", `ch_post_history_${ch.id}_0`).row();
    kb.text("👥 Join Stats", `ch_join_stats_${ch.id}_0`).row();
  }
  kb.text("🗑 Remove Channel", `del_channel_${ch.id}`).row().text("🔙 Back", "admin_channels");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
}

// --- ADVANCED CHANNEL TOOLS ---

/**
 * 📝 Post to Channel
 * Triggers the message capture flow for a specific channel.
 */
channelsModule.callbackQuery(/^post_to_ch_(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const chId = ctx.match[1];
  await ctx.editMessageText("📝 **New Channel Post**\n\nPlease forward or send the message you want to post to this channel.\n\n*Note: If the bot is not admin, the post will fail.*", {
    reply_markup: new InlineKeyboard().text("❌ Cancel", `manage_ch_${chId}`),
    parse_mode: "Markdown"
  });
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `wait_ch_post_msg:${chId}:${ctx.callbackQuery.message?.message_id}`).run();
});

/**
 * 📜 Post History Dashboard
 * Paginated list of all posts sent to a specific channel via the bot.
 */
channelsModule.callbackQuery(/^ch_post_history_(.+)_(\d+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const chId = ctx.match[1];
  const page = parseInt(ctx.match[2]);
  const limit = 5;
  const offset = page * limit;

  const { results: posts } = await ctx.db.prepare("SELECT * FROM channel_posts WHERE channel_id = ? ORDER BY sent_at DESC LIMIT ? OFFSET ?")
    .bind(chId, limit, offset).all<any>();
  const countRes = await ctx.db.prepare("SELECT COUNT(*) as c FROM channel_posts WHERE channel_id = ?").bind(chId).first<{ c: number }>();
  const total = countRes?.c || 0;

  let text = `📜 **Post History:** (\`${chId}\`)\n\n`;
  const kb = new InlineKeyboard();

  if (posts.length === 0) text += "_No posts recorded yet._";
  else {
    posts.forEach((p: any) => {
      text += `📅 ${new Date(p.sent_at).toLocaleString()}\n💬 ID: \`${p.message_id}\`\n\n`;
      kb.text(`✏️ Edit #${p.message_id}`, `edit_ch_post_${chId}_${p.message_id}`).text(`🗑 Del #${p.message_id}`, `del_ch_post_${chId}_${p.message_id}`).row();
    });
  }

  if (page > 0) kb.text("◀️ Prev", `ch_post_history_${chId}_${page - 1}`);
  if (offset + limit < total) kb.text("Next ▶️", `ch_post_history_${chId}_${page + 1}`);
  kb.row().text("🔙 Back", `manage_ch_${chId}`);

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
});

/**
 * 👮 Staff Auditor
 * Fetches real-time admin list from Telegram to check roles and permissions.
 */
channelsModule.callbackQuery(/^ch_admins_(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.answerCallbackQuery();
  const chId = ctx.match[1].startsWith("-") ? ctx.match[1] : `-100${ctx.match[1]}`;

  try {
    const admins = await ctx.api.getChatAdministrators(chId);
    let text = `👮 **Staff Audit:** (\`${chId}\`)\n\n`;

    admins.forEach(adm => {
      const user = adm.user;
      const name = esc(user.first_name || "User");
      const role = (adm.status === "creator") ? "👑 Owner" : "🛡️ Admin";

      text += `👤 **[${name}](tg://user?id=${user.id})**\n`;
      text += `Role: **${role}**\n`;

      if (adm.status === "creator") {
        text += `Full Permissions ✅\n`;
      } else {
        text += "Permissions:\n";
        text += `${adm.can_post_messages ? "✅" : "❌"} Post | ${adm.can_edit_messages ? "✅" : "❌"} Edit | ${adm.can_delete_messages ? "✅" : "❌"} Del\n`;
        text += `${adm.can_invite_users ? "✅" : "❌"} Inv | ${adm.can_pin_messages ? "✅" : "❌"} Pin\n`;
      }
      text += `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`;
    });

    const kb = new InlineKeyboard().text("🔙 Back", `manage_ch_${chId}`);
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
  } catch (e: any) {
    await ctx.reply(`❌ **Audit Failed:** ${e.message}\nEnsure the bot is admin in that channel.`);
  }
});

/**
 * 👥 Join Request Stats (Upgraded)
 * Paginated list of users who joined via join requests for this channel.
 */
channelsModule.callbackQuery(/^ch_join_stats_(.+)_(\d+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const chId = ctx.match[1];
  const page = parseInt(ctx.match[2]);
  const limit = 10;
  const offset = page * limit;

  const { results: joins } = await ctx.db.prepare("SELECT jr.*, u.first_name, u.username FROM join_requests jr LEFT JOIN users u ON jr.user_id = u.user_id WHERE jr.channel_id = ? ORDER BY jr.requested_at DESC LIMIT ? OFFSET ?")
    .bind(chId, limit, offset).all<any>();
  const countRes = await ctx.db.prepare("SELECT COUNT(*) as c FROM join_requests WHERE channel_id = ?").bind(chId).first<{ c: number }>();
  const total = countRes?.c || 0;

  let text = `👥 <b>Join Stats:</b> (<code>${chId}</code>)\nTotal Recorded: <b>${total}</b>\n\n`;
  if (joins.length === 0) text += "<i>No join requests captured yet.</i>";
  else {
    joins.forEach((j: any, i: number) => {
      const idx = offset + i + 1;
      const name = esc(j.first_name || "User");
      const username = j.username ? ` (@${esc(j.username)})` : "";
      const date = new Date(j.requested_at).toLocaleDateString('en-GB', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
      text += `<b>${idx}.</b> <a href="tg://user?id=${j.user_id}">${name}</a>${username}\n`;
      text += `└─ 🕒 <code>${date}</code>\n\n`;
    });
  }

  const kb = new InlineKeyboard();
  const navRow = [];
  if (page > 0) navRow.push(kb.text("◀️ Prev", `ch_join_stats_${chId}_${page - 1}`));
  if (offset + limit < total) navRow.push(kb.text("Next ▶️", `ch_join_stats_${chId}_${page + 1}`));

  if (navRow.length > 0) kb.row();
  kb.text("🔙 Back", `manage_ch_${chId}`);

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
});

channelsModule.callbackQuery(/^del_ch_post_(.+)_(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const chId = ctx.match[1];
  const msgId = parseInt(ctx.match[2]);

  try {
    await ctx.api.deleteMessage(chId, msgId);
    await ctx.db.prepare("DELETE FROM channel_posts WHERE channel_id = ? AND message_id = ?").bind(chId, msgId).run();
    await ctx.answerCallbackQuery("🗑 Post Deleted from Channel!");
  } catch (e: any) {
    await ctx.answerCallbackQuery(`❌ Failed: ${e.message}`);
  }
  return ctx.callbackQuery.data = `ch_post_history_${chId}_0`;
});

channelsModule.callbackQuery(/^edit_ch_post_(.+)_(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const chId = ctx.match[1];
  const msgId = ctx.match[2];
  await ctx.editMessageText(`✏️ **Edit Channel Post** (#${msgId})\n\nPlease send the NEW message content for this post.`, {
    reply_markup: new InlineKeyboard().text("❌ Cancel", `ch_post_history_${chId}_0`),
    parse_mode: "Markdown"
  });
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `wait_edit_ch_post:${chId}:${msgId}:${ctx.callbackQuery.message?.message_id}`).run();
});
