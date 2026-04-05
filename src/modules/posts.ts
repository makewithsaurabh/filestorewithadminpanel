import { Composer, InlineKeyboard } from "grammy";
import { MyContext } from "../types";

export const postsModule = new Composer<MyContext>();

const isOwner = (ctx: MyContext) => ctx.role === "owner";

/**
 * 📝 Channel Post Manager Module (v2.6)
 * - Ported from legacy bot logic.
 * - Allows bridge posting to channels.
 * - Tracks message IDs for remote editing/deletion.
 */

// --- CALLBACK QUEUE ---

/**
 * 📜 Post History Dashboard (Paginated)
 */
postsModule.callbackQuery(/^ch_post_history_(.+)_(\d+)$/, async (ctx) => {
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
      const preview = p.text_preview || "Media Post";
      text += `📅 ${new Date(p.sent_at).toLocaleString()}\n💬 Preview: *${preview.substring(0, 30)}...*\n\n`;
      kb.text(`✏️ Edit #${p.message_id}`, `edit_ch_post_${chId}_${p.message_id}`).text(`🗑 Del #${p.message_id}`, `del_ch_post_${chId}_${p.message_id}`).row();
    });
  }

  const navRow = [];
  if (page > 0) navRow.push(kb.text("◀️ Prev", `ch_post_history_${chId}_${page - 1}`));
  if (offset + limit < total) navRow.push(kb.text("Next ▶️", `ch_post_history_${chId}_${page + 1}`));
  
  kb.row().text("🔙 Back to Channel", `manage_ch_${chId}`);

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
});

/**
 * 🗑 Remote Deletion
 */
postsModule.callbackQuery(/^del_ch_post_(.+)_(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const chId = ctx.match[1];
  const msgId = parseInt(ctx.match[2]);

  try {
    await ctx.api.deleteMessage(chId, msgId);
    await ctx.db.prepare("DELETE FROM channel_posts WHERE channel_id = ? AND message_id = ?").bind(chId, msgId).run();
    await ctx.answerCallbackQuery("🗑 Post Deleted from Channel!");
  } catch (e: any) {
    await ctx.answerCallbackQuery(`❌ Failed to delete: ${e.message}`);
  }
  return ctx.callbackQuery.data = `ch_post_history_${chId}_0`;
});

/**
 * ✏️ Remote Editing Initiation
 */
postsModule.callbackQuery(/^edit_ch_post_(.+)_(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return;
  const chId = ctx.match[1];
  const msgId = ctx.match[2];
  
  await ctx.editMessageText(`✏️ **Edit Channel Post** (#${msgId})\n\nPlease send the NEW message content (Text or Caption) for this post.`, {
    reply_markup: new InlineKeyboard().text("❌ Cancel", `ch_post_history_${chId}_0`),
    parse_mode: "Markdown"
  });
  
  await ctx.db.prepare("INSERT OR REPLACE INTO admin_states (admin_id, state) VALUES (?, ?)")
    .bind(ctx.from!.id, `wait_edit_ch_post:${chId}:${msgId}:${ctx.callbackQuery.message?.message_id}`).run();
});

// --- MESSAGE HANDLERS (STATES) ---

/**
 * Capture logic for editing or creating posts is handled in states.ts 
 * but we can define the specific logic here or bridge it.
 * To keep it modular, let's assume states.ts handles the wait_ch_post_msg state.
 */
