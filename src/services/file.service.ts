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
    console.log(`[SQL-DEBUG] Fetching link: ${payload}`);
    const link = await ctx.db.prepare("SELECT * FROM links WHERE id = ?").bind(String(payload)).first<DatabaseLink>();
    if (!link) {
      return ctx.reply("❌ **Link Expired or Invalid!**\nPlease generate a new link.", { parse_mode: "Markdown" });
    }

    console.log(`[SQL-DEBUG] Fetching files for link: ${payload}`);
    const { results: files } = await ctx.db.prepare("SELECT * FROM files WHERE link_id = ? ORDER BY id ASC").bind(String(payload)).all<DatabaseFile>();
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

      try {
        // 1. Increment Link Views immediately (Sequential Fix)
        console.log(`[SQL-DEBUG] Updating views: ${payload}`);
        await ctx.db.prepare("UPDATE links SET views = views + 1 WHERE id = ?").bind(String(payload)).run();

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          let sent = false;
          let retries = 0;

          while (!sent && retries < 3) {
            try {
              const msg = await ctx.api.copyMessage(ctx.from!.id, ctx.config.STORAGE_CHANNEL_ID, parseInt(file.file_id));
              sent = true;

              // 2. Sequential Activity Logging (Guaranteed Binding Count)
              console.log(`[SQL-DEBUG] Logging download: ${file.file_id}`);
              await ctx.db.prepare("INSERT INTO download_logs (user_id, user_name, file_id, file_name, link_id) VALUES (?, ?, ?, ?, ?)")
                .bind(
                  Number(ctx.from!.id),
                  String(ctx.from!.username || ctx.from!.first_name || "User"),
                  String(file.file_id),
                  String(file.file_name || "File"),
                  String(payload)
                ).run();

              // 3. Sequential Increment Download Count
              await ctx.db.prepare("UPDATE files SET downloads = downloads + 1 WHERE id = ?").bind(Number(file.id)).run();

              // 4. Sequential Auto-Delete Handler
              if (deleteMs > 0 && msg?.message_id) {
                await ctx.db.prepare("INSERT INTO auto_deletes (chat_id, message_id, delete_at) VALUES (?, ?, ?)")
                  .bind(Number(ctx.from!.id), Number(msg.message_id), Number(Date.now() + deleteMs)).run();
              }

              if (statusMsgId && (i + 1) % 5 === 0) {
                await ctx.api.editMessageText(ctx.from!.id, statusMsgId, `${statusBase} ${i + 1}/${files.length}`, { parse_mode: "Markdown" }).catch(() => { });
              }
            } catch (e: any) {
              if (e instanceof GrammyError && e.error_code === 429) {
                const wait = (e.parameters.retry_after || 5) + 1;
                if (statusMsgId) await ctx.api.editMessageText(ctx.from!.id, statusMsgId, `⏳ **Rate Limit Hit!** Waiting ${wait}s...`).catch(() => { });
                await Sleep(wait * 1000);
                retries++;
              } else {
                sent = true; // Skip on other errors
              }
            }
          }
          if (i < files.length - 1) await Sleep(files.length > 20 ? 150 : 50);
        }
      } catch (err) {
        console.error("Critical error in serving:", err);
      } finally {
        if (statusMsgId) await ctx.api.deleteMessage(ctx.from!.id, statusMsgId).catch(() => { });
      }
    };

    if (ctx.executionCtx) {
      ctx.executionCtx.waitUntil(doServing());
    } else {
      await doServing();
    }
  } catch (err: any) {
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
    if (idsToDelete.length === 0) return;
  const placeholders = idsToDelete.map(() => "?").join(",");
    await db.prepare(`DELETE FROM auto_deletes WHERE id IN (${placeholders})`)
      .bind(...idsToDelete).run();
  }

  console.log(`[Auto-Delete] Processed ${idsToDelete.length} records.`);
}

