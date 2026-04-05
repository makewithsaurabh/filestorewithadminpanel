import { MyContext, DatabaseFile, DatabaseLink } from "../types";
import { getSetting, Sleep } from "../core/database";
import { GrammyError } from "grammy";

/**
 * ⚙️ File Delivery Service
 * - Handles concurrency locking, batch delivery, and auto-deletion logic.
 * - Optimized for Cloudflare Workers with waitUntil support.
 */

export async function serveFilesToUser(ctx: MyContext, payload: string) {
  try {
    // 1. Concurrency Lock & Self-Healing (v2.2 Stable)
    const now = Date.now();
    try {
      // Aggressive cleanup of stale locks for this user (older than 5 mins)
      await ctx.db.prepare("DELETE FROM serving_locks WHERE user_id = ? AND created_at < ?")
        .bind(ctx.from!.id, now - 300000).run();
      
      // Try to acquire new lock
      await ctx.db.prepare("INSERT INTO serving_locks (user_id, link_id, created_at) VALUES (?, ?, ?)")
        .bind(ctx.from!.id, payload, now).run();
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint failed")) {
        return ctx.reply("⚠️ **Delivery in Progress!**\nYour files are already being sent. Please wait for the current batch to finish.", { parse_mode: "Markdown" });
      }
    }

    const link = await ctx.db.prepare("SELECT * FROM links WHERE id = ?").bind(payload).first<DatabaseLink>();
    if (!link) {
      return ctx.reply("❌ **Link Expired or Invalid!**\nPlease generate a new link.", { parse_mode: "Markdown" });
    }

    const { results: files } = await ctx.db.prepare("SELECT * FROM files WHERE link_id = ? ORDER BY id ASC").all<DatabaseFile>();
    if (!files || files.length === 0) {
      return ctx.reply("📁 This store is currently empty.");
    }

    // 2. Prepare Auto-Delete Logic
    const autoDeleteTime = await getSetting(ctx.db, "auto_delete_time", "off");
    let deleteMs = 0;
    if (autoDeleteTime !== "off") {
      const units: Record<string, number> = { "5m": 5, "10m": 10, "30m": 30, "1h": 60, "6h": 360, "12h": 720, "1d": 1440 };
      if (units[autoDeleteTime]) deleteMs = units[autoDeleteTime] * 60 * 1000;
    }

    // 3. Background Delivery Loop
    const doServing = async () => {
      const statusBase = `☁️ **Preparing your files (${files.length})...**\n📥 **Collected:**`;
      let statusMsgId: number | null = null;
      
      if (files.length > 3) {
        const status = await ctx.reply(`${statusBase} 0/${files.length}`, { parse_mode: "Markdown" });
        statusMsgId = status.message_id;
      }

      const statements: any[] = [
        ctx.db.prepare("UPDATE links SET views = views + 1 WHERE id = ?").bind(payload)
      ];

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          let sent = false;
          let retries = 0;

          while (!sent && retries < 3) {
            try {
              const msg = await ctx.api.copyMessage(ctx.from!.id, ctx.config.STORAGE_CHANNEL_ID, parseInt(file.file_id));
              sent = true;

              if (deleteMs > 0 && msg?.message_id) {
                statements.push(ctx.db.prepare("INSERT INTO auto_deletes (chat_id, message_id, delete_at) VALUES (?, ?, ?)")
                  .bind(ctx.from!.id, msg.message_id, Date.now() + deleteMs));
              }

              statements.push(ctx.db.prepare("UPDATE files SET downloads = downloads + 1 WHERE id = ?").bind(file.id));
              statements.push(ctx.db.prepare("INSERT INTO download_logs (user_id, user_name, file_id, file_name) VALUES (?, ?, ?, ?)")
                .bind(ctx.from!.id, ctx.from!.username || ctx.from!.first_name, file.file_id, file.file_name || "File"));

              if (statusMsgId && (i + 1) % 5 === 0) {
                await ctx.api.editMessageText(ctx.from!.id, statusMsgId, `${statusBase} ${i + 1}/${files.length}`, { parse_mode: "Markdown" }).catch(() => {});
              }
            } catch (e: any) {
              if (e instanceof GrammyError && e.error_code === 429) {
                const wait = (e.parameters.retry_after || 5) + 1;
                if (statusMsgId) await ctx.api.editMessageText(ctx.from!.id, statusMsgId, `⏳ **Rate Limit Hit!** Waiting ${wait}s...`).catch(() => {});
                await Sleep(wait * 1000);
                retries++;
              } else {
                sent = true; // Skip on other errors
              }
            }
          }
          if (i < files.length - 1) await Sleep(files.length > 20 ? 150 : 50);
        }
        await ctx.db.batch(statements);
      } catch (err) {
        console.error("Critical error in serving:", err);
      } finally {
        await clearLock(ctx, payload);
        if (statusMsgId) await ctx.api.deleteMessage(ctx.from!.id, statusMsgId).catch(() => {});
      }
    };

    if (ctx.executionCtx) {
      ctx.executionCtx.waitUntil(doServing());
    } else {
      await doServing();
    }
  } catch (err: any) {
    /**
     * 🛡️ Final Lock Cleanup
     * We ensure the user is unlocked if any error occurs during validation.
     */
    await clearLock(ctx, payload);
    throw err; // Re-throw for Global Error Boundary
  }
}


/**
 * 🗑 Auto-Delete Cleaner
 * - Fetches all expired messages from the queue.
 * - Deletes them from Telegram.
 * - Cleans up the database records.
 * - Designed to be triggered by Cloudflare Cron.
 */
export async function processAutoDeletes(db: D1Database, api: any) {
  const now = Date.now();
  const { results: expired } = await db.prepare("SELECT * FROM auto_deletes WHERE delete_at < ? LIMIT 50")
    .bind(now).all<{ id: number; chat_id: number; message_id: number }>();

  if (!expired || expired.length === 0) return;

  const idsToDelete: number[] = [];
  
  for (const record of expired) {
    try {
      // ⚡ Attempt deletion
      await api.deleteMessage(record.chat_id, record.message_id);
    } catch (e: any) {
      // Stop trying if the chat is missing or message is already gone
      console.warn(`[Auto-Delete] Failed for chat ${record.chat_id}: ${e.message}`);
    }
    idsToDelete.push(record.id);
  }

  // Cleanup DB in batch
  if (idsToDelete.length > 0) {
    const placeholders = idsToDelete.map(() => "?").join(",");
    await db.prepare(`DELETE FROM auto_deletes WHERE id IN (${placeholders})`)
      .bind(...idsToDelete).run();
  }

  console.log(`[Auto-Delete] Processed ${idsToDelete.length} records.`);
}

async function clearLock(ctx: MyContext, payload: string) {
  await ctx.db.prepare("DELETE FROM serving_locks WHERE user_id = ? AND link_id = ?")
    .bind(ctx.from!.id, payload).run().catch(() => {});
}
