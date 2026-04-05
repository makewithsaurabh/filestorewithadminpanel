import { Composer, InlineKeyboard } from "grammy";
import { MyContext, DatabaseLink, DatabaseFile } from "../types";
import { esc } from "../core/database";

export const adminModule = new Composer<MyContext>();

/**
 * 🛠️ Admin Feature Module
 * - Handles link management (/manage, /store).
 * - Handles bulk upload mode (/bulk, /done).
 * - Handles file reception and storage logic.
 */

const isAdmin = (ctx: MyContext) => ["owner", "admin"].includes(ctx.role);

// --- COMMANDS ---

// 1. /manage - List links for management
adminModule.command("manage", async (ctx) => {
  if (!isAdmin(ctx)) return;
  return renderLinkList(ctx, 0);
});

// 2. /store - Info about single file storage
adminModule.command("store", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply("📤 **Single File Storage**\n\nTo create a new link for a single file:\n1. Simply **send the file** directly to this bot.\n2. I will automatically forward it and ask if you want to create a new link or add it to an existing one.\n\n*Note: Use /bulk for multiple files in one link.*", { parse_mode: "Markdown" });
});

// 2.1 /skip command (Legacy Fix)
adminModule.command("skip", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const stateRow = await ctx.db.prepare("SELECT state FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).first<{ state: string }>();
  if (!stateRow) return;

  if (stateRow.state.startsWith("wait_rename:")) {
    const slug = stateRow.state.split(":")[1];
    await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();
    await ctx.reply(`✅ **Stored with Default Name!**\n🔗 Link: \`https://t.me/${ctx.me.username}?start=${slug}\``, { parse_mode: "Markdown" });
  }
});

// 3. /bulk - Start bulk upload mode
adminModule.command("bulk", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.db.prepare("DELETE FROM temp_bulk_files WHERE admin_id = ?").bind(ctx.from!.id).run();

  const statusMsg = await ctx.reply("🔥 **Bulk Mode Active!**\n\n1. Send all files to include in this link.\n2. Use ** /done ** to generate the link.\n3. Use ** /cancel ** to stop.\n\n📥 **Collected:** 0", { parse_mode: "Markdown" });

  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `bulk_mode:${statusMsg.message_id}`).run();
});

// 4. /done - Finalize bulk upload
adminModule.command("done", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const stateRow = await ctx.db.prepare("SELECT state FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).first<{ state: string }>();
  if (!stateRow || !stateRow.state.startsWith("bulk_mode")) return ctx.reply("❌ Use /bulk first.");

  const { results: temps } = await ctx.db.prepare("SELECT * FROM temp_bulk_files WHERE admin_id = ?").bind(ctx.from!.id).all<{ file_id: string; file_name: string }>();
  if (temps.length === 0) return ctx.reply("❌ Send some files first.");

  const statusMsgId = parseInt(stateRow.state.split(":")[1]);
  const processMsg = await ctx.reply("⚙️ **Processing batch storage...**", { parse_mode: "Markdown" });

  try {
    const customName = ctx.match.trim();
    const slug = Math.random().toString(36).substring(2, 8);
    const title = customName || `Bulk Store ${slug}`;

    let linkCreatedBy = ctx.from!.id;
    const secondaryCheck = await ctx.db.prepare("SELECT state FROM admin_states WHERE admin_id = ? AND state LIKE 'create_link_for_%'").bind(ctx.from!.id).first<{ state: string }>();
    if (secondaryCheck) linkCreatedBy = parseInt(secondaryCheck.state.replace("create_link_for_", ""));

    console.log(`[SQL-DEBUG] Storage batch: slug=${slug}, user=${ctx.from!.id}`);
    // 1. Create Link immediately
    await ctx.db.prepare("INSERT INTO links (id, title, added_by) VALUES (?, ?, ?)")
      .bind(String(slug), String(title), Number(linkCreatedBy)).run();

      for (const t of temps) {
        console.log(`[SQL-DEBUG] Storing file: ${t.file_id}`);
        // 2. Sequential File Record
        await ctx.db.prepare("INSERT INTO files (link_id, file_id, file_unique_id, file_name) VALUES (?, ?, ?, ?)")
          .bind(String(slug), String(t.file_id), "bulk", String(t.file_name || "File")).run();

        // 3. Sequential Storage Log (Guaranteed Binding Count)
        await ctx.db.prepare("INSERT INTO storage_logs (admin_id, admin_name, file_id, file_name, link_id) VALUES (?, ?, ?, ?, ?)")
          .bind(
            Number(linkCreatedBy),
            String(ctx.from!.username || ctx.from!.first_name || "Admin"),
            String(t.file_id),
            String(t.file_name || "File"),
            String(slug)
          ).run();
      }

      // 4. Sequential Cleanup
      await ctx.db.prepare("DELETE FROM temp_bulk_files WHERE admin_id = ?").bind(Number(ctx.from!.id)).run();

    if (statusMsgId) await ctx.api.deleteMessage(ctx.from!.id, statusMsgId).catch(() => { });
    await ctx.api.deleteMessage(ctx.from!.id, processMsg.message_id).catch(() => { });

    if (customName) {
      await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).run();
      await ctx.reply(`✅ **Bulk Link Created!**\n\nName: ${title}\n🔗 Link: \`https://t.me/${ctx.me.username}?start=${slug}\``, { parse_mode: "Markdown" });
    } else {
      await ctx.db.prepare("UPDATE admin_states SET state = ? WHERE admin_id = ?").bind(`wait_rename:${slug}:${processMsg.message_id}`, ctx.from!.id).run();
      await ctx.reply(`✅ **Files stored securely!**\n\nPlease **send a Name** for this link now, or use /skip to keep default.`, { parse_mode: "Markdown" });
    }
  } catch (err: any) {
    await ctx.api.editMessageText(ctx.from!.id, processMsg.message_id, `❌ **Database Error:** ${err.message}`);
  }
});

// --- CALLBACKS ---

adminModule.callbackQuery(/^page_links_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCallbackQuery();
  return renderLinkList(ctx, parseInt(ctx.match[1]));
});

adminModule.callbackQuery(/^manage_link_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCallbackQuery();
  return renderManageLink(ctx, ctx.match[1]);
});

adminModule.callbackQuery(/^del_link_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const slug = ctx.match[1];
  await ctx.db.prepare("DELETE FROM links WHERE id = ?").bind(slug).run();
  await ctx.db.prepare("DELETE FROM files WHERE link_id = ?").bind(slug).run();
  await ctx.db.prepare("DELETE FROM link_channels WHERE link_id = ?").bind(slug).run();

  /**
   * 🛡️ Force Confirmation
   * Using show_alert: true ensures the admin definitely sees the deletion results.
   */
  await ctx.answerCallbackQuery({ text: "✅ Store Deleted Forever!", show_alert: true });
  return renderLinkList(ctx, 0);
});

adminModule.callbackQuery(/^link_rename_setup_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCallbackQuery();
  const slug = ctx.match[1];
  await ctx.editMessageText("✏️ **Rename Store**\n\nPlease send the new name for this link.\n\nType /cancel to abort.", {
    reply_markup: new InlineKeyboard().text("🔙 Back", `manage_link_${slug}`),
    parse_mode: "Markdown"
  });
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `wait_rename:${slug}:${ctx.callbackQuery.message?.message_id}`).run();
});

// --- LINK-SPECIFIC FORCE JOIN ---

/**
 * 🛡️ Link FJ Settings
 * Allows overriding global Force-Join behavior for a specific link.
 */
adminModule.callbackQuery(/^link_fj_settings_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const slug = ctx.match[1];
  const link = await ctx.db.prepare("SELECT title FROM links WHERE id = ?").bind(slug).first<any>();
  if (!link) return;

  const { results: allCh } = await ctx.db.prepare("SELECT * FROM channels ORDER BY position ASC").all<any>();
  const { results: linked } = await ctx.db.prepare("SELECT channel_id FROM link_channels WHERE link_id = ?").bind(slug).all<any>();
  const linkedIds = new Set(linked.map(l => l.channel_id));

  let text = `🛡️ **FJ Overrides:** ${link.title}\n\nSelect channels that MUST be joined for this specific link. If none are selected, global FJ settings apply.`;
  const kb = new InlineKeyboard();

  allCh.forEach(ch => {
    const isLinked = linkedIds.has(ch.id);
    kb.text(`${isLinked ? "✅" : "⚪"} ${ch.title}`, `toggle_link_ch_${slug}_${ch.id}`).row();
  });

  kb.text("🔙 Back", `manage_link_${slug}`);
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
});

adminModule.callbackQuery(/^toggle_link_ch_(.+)_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const slug = ctx.match[1];
  const chId = ctx.match[2];

  const exists = await ctx.db.prepare("SELECT 1 FROM link_channels WHERE link_id = ? AND channel_id = ?").bind(slug, chId).first();
  if (exists) {
    await ctx.db.prepare("DELETE FROM link_channels WHERE link_id = ? AND channel_id = ?").bind(slug, chId).run();
    await ctx.answerCallbackQuery("Removed override ✅");
  } else {
    await ctx.db.prepare("INSERT INTO link_channels (link_id, channel_id) VALUES (?, ?)").bind(slug, chId).run();
    await ctx.answerCallbackQuery("Override Added ✅");
  }

  // Refresh UI
  await ctx.answerCallbackQuery("Updated override ✅");
  return ctx.callbackQuery.data = `link_fj_settings_${slug}`;
});

/**
 * ➕ New Link Flow (Restoration)
 * Logic to generate a fresh link for a single file reception.
 */
adminModule.callbackQuery(/^new_link_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const msgId = ctx.match[1];
  const stateRow = await ctx.db.prepare("SELECT state FROM admin_states WHERE admin_id = ? AND state LIKE 'last_file_name:%'").bind(ctx.from!.id).first<{ state: string }>();
  const fName = stateRow ? stateRow.state.replace("last_file_name:", "") : "File";

  const slug = Math.random().toString(36).substring(2, 8);

  await ctx.db.prepare("INSERT INTO links (id, title, added_by) VALUES (?, ?, ?)")
    .bind(slug, fName, ctx.from!.id).run();
  await ctx.db.prepare("INSERT INTO files (link_id, file_id, file_unique_id, file_name) VALUES (?, ?, ?, ?)")
    .bind(slug, msgId, "manual_single", fName).run();

  await ctx.answerCallbackQuery("✨ Link Created!");
  await ctx.db.prepare("UPDATE admin_states SET state = ? WHERE admin_id = ?").bind(`wait_rename:${slug}:${ctx.callbackQuery.message?.message_id}`, ctx.from!.id).run();

  await ctx.editMessageText(`✅ **File stored securely!**\n\nPlease **send a Name** for this link now, or use /skip to keep default.`, { parse_mode: "Markdown" });
});

// --- ADD TO EXISTING STORE ---

/**
 * ➕ Add to Existing
 * Paginated UI to select a target link for a newly uploaded file.
 */
adminModule.callbackQuery(/^add_to_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCallbackQuery();
  const msgId = ctx.match[1];
  return renderAddToLinks(ctx, msgId, 0);
});

adminModule.callbackQuery(/^page_add_to_(.+)_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCallbackQuery();
  const msgId = ctx.match[1];
  const page = parseInt(ctx.match[2]);
  return renderAddToLinks(ctx, msgId, page);
});

adminModule.callbackQuery(/^confirm_add_(.+)_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const msgId = ctx.match[1];
  const slug = ctx.match[2];

  const stateRow = await ctx.db.prepare("SELECT state FROM admin_states WHERE admin_id = ? AND state LIKE 'last_file_name:%'").bind(ctx.from!.id).first<{ state: string }>();
  const fName = stateRow ? stateRow.state.replace("last_file_name:", "") : "File";

  await ctx.db.prepare("INSERT INTO files (link_id, file_id, file_unique_id, file_name) VALUES (?, ?, ?, ?)")
    .bind(slug, msgId, "manual_add", fName).run();

  /**
   * ➕ UI Feedback
   * Acknowledging the callback ensures the user sees an immediate 'toast' or 
   * removal of the loading state in the client.
   */
  await ctx.answerCallbackQuery("✅ File added to store!");
  await ctx.db.prepare("DELETE FROM admin_states WHERE admin_id = ? AND state LIKE 'last_file_name:%'").bind(ctx.from!.id).run();
  return renderManageLink(ctx, slug);
});

/**
 * Renders the paginated link selection for 'Add to Existing' flow.
 */
async function renderAddToLinks(ctx: MyContext, msgId: string, page: number) {
  const offset = page * 10;
  const { results: links } = await ctx.db.prepare("SELECT * FROM links ORDER BY created_at DESC LIMIT 10 OFFSET ?").bind(offset).all<DatabaseLink>();
  const countRes = await ctx.db.prepare("SELECT COUNT(*) as c FROM links").first<{ c: number }>();
  const total = countRes ? countRes.c : 0;

  const kb = new InlineKeyboard();
  links.forEach(l => kb.text(l.title, `confirm_add_${msgId}_${l.id}`).row());

  if (page > 0) kb.text("◀️ Prev", `page_add_to_${msgId}_${page - 1}`);
  if (offset + 10 < total) kb.text("Next ▶️", `page_add_to_${msgId}_${page + 1}`);
  kb.row().text("❌ Cancel", "admin_main");

  const text = `🎯 **Target Store** (Page ${page + 1})\nSelect the link where you want to add this file.`;
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
}

// --- FILE RECEPTION ---

adminModule.on(":file", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const stMsg = await ctx.reply("🔍 **Processing...**", { parse_mode: "Markdown" });
  try {
    const stateRow = await ctx.db.prepare("SELECT state FROM admin_states WHERE admin_id = ?").bind(ctx.from!.id).first<{ state: string }>();

    // Duo-Storage Sync
    await ctx.api.forwardMessage(ctx.config.BACKUP_STORAGE_ID, ctx.from!.id, ctx.msg.message_id).catch(() => null);
    const forward = await ctx.api.forwardMessage(ctx.config.STORAGE_CHANNEL_ID, ctx.from!.id, ctx.msg.message_id);

    await ctx.api.deleteMessage(ctx.from!.id, ctx.msg.message_id).catch(() => { });

    let fName = "File";
    const m = ctx.msg;
    if (m.document) fName = m.document.file_name || "Document";
    else if (m.video) fName = m.video.file_name || m.caption || "Video";
    else if (m.audio) fName = m.audio.title || m.audio.file_name || m.caption || "Audio";
    else if (m.photo) fName = m.caption || "Photo";
    else if (m.caption) fName = m.caption;

    if (stateRow?.state.startsWith("bulk_mode")) {
      await ctx.db.prepare("INSERT INTO temp_bulk_files (admin_id, file_id, file_name) VALUES (?, ?, ?)").bind(ctx.from!.id, forward.message_id.toString(), fName).run();
      const countRes = await ctx.db.prepare("SELECT COUNT(*) as c FROM temp_bulk_files WHERE admin_id = ?").bind(ctx.from!.id).first<{ c: number }>();
      const count = countRes?.c || 0;

      const statusMsgId = parseInt(stateRow.state.split(":")[1]);
      const newText = `🔥 **Bulk Mode Active!**\n📥 **Collected:** ${fName} (#${count})\n\nUse /done to finish.`;

      await ctx.api.deleteMessage(ctx.from!.id, stMsg.message_id).catch(() => { });
      if (statusMsgId) await ctx.api.editMessageText(ctx.from!.id, statusMsgId, newText, { parse_mode: "Markdown" }).catch(() => { });
      return;
    }

    // Normal single file
    await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)").bind(ctx.from!.id, `last_file_name:${fName}`).run();
    const kb = new InlineKeyboard().text("➕ Add to existing", `add_to_${forward.message_id}`).text("✨ New Link", `new_link_${forward.message_id}`);
    await ctx.api.deleteMessage(ctx.from!.id, stMsg.message_id).catch(() => { });
    await ctx.reply(`✅ **Stored:** ${fName}`, { reply_markup: kb, parse_mode: "Markdown" });

  } catch (e: any) {
    await ctx.api.editMessageText(ctx.from!.id, stMsg.message_id, `❌ **Error:** ${e.message}`);
  }
});

// --- RENDERERS ---

async function renderLinkList(ctx: MyContext, page: number) {
  const offset = page * 10;
  const { results: links } = await ctx.db.prepare("SELECT * FROM links ORDER BY created_at DESC LIMIT 10 OFFSET ?").bind(offset).all<DatabaseLink>();
  const countRes = await ctx.db.prepare("SELECT COUNT(*) as c FROM links").first<{ c: number }>();
  const total = countRes ? countRes.c : 0;

  const kb = new InlineKeyboard();
  links.forEach((l: any) => kb.text(`[${l.views}👁️] ${l.title}`, `manage_link_${l.id}`).row());

  if (page > 0) kb.text("◀️ Prev", `page_links_${page - 1}`);
  if (offset + 10 < total) kb.text("Next ▶️", `page_links_${page + 1}`);
  kb.row().text("🔙 Back", "admin_main");

  const text = `📂 **Link Management** (Page ${page + 1})\nSelect a link to manage.`;
  if (ctx.callbackQuery) return ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
  return ctx.reply(text, { reply_markup: kb, parse_mode: "Markdown" });
}

async function renderManageLink(ctx: MyContext, slug: string) {
  const link = await ctx.db.prepare("SELECT * FROM links WHERE id = ?").bind(slug).first<DatabaseLink>();
  if (!link) return;
  const { results: files } = await ctx.db.prepare("SELECT * FROM files WHERE link_id = ?").bind(slug).all<DatabaseFile>();

  let text = `📂 **Store:** ${link.title}\nViews: ${link.views}\nID: \`${slug}\`\nURL: \`t.me/${ctx.me.username}?start=${slug}\`\n\n`;
  const kb = new InlineKeyboard();
  files.forEach(f => {
    text += `• ${f.file_name} (${f.downloads}⬇️)\n`;
  });
  kb.text("✏️ Rename Title", `link_rename_setup_${slug}`).row();
  kb.text("🛡️ Force Join Settings", `link_fj_settings_${slug}`).row();
  kb.text("🗑 Delete Whole Link", `del_link_${slug}`).row().text("🔙 Back", "page_links_0");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
}
