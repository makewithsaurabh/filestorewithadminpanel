import { Hono } from "hono";
import { webhookCallback } from "grammy";
import { createBot } from "./bot";
import { Bindings } from "./types";
import { cors } from "hono/cors";
import { processAutoDeletes } from "./services/file.service";
import { Bot, Api } from "grammy";

const app = new Hono<{ Bindings: Bindings }>();

// 🛡️ PERMISSIVE CORS
app.use("*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "X-API-Key"],
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
}));

// Home / Status Check
app.get("/", (c) => c.text("🚀 SendFlow v2.0 MODULAR: Engine Active (Clean Architecture)"));

// 🛠️ PUBLIC DASHBOARD ENDPOINTS
app.get("/api/dashboard/stats", async (c) => {
  try {
    const broadcasts = await c.env.DB.prepare("SELECT id, message_id, sent, failed, total_users, status, created_at FROM broadcasts ORDER BY id DESC LIMIT 10").all();
    const countRes = await c.env.DB.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>();
    const total = countRes?.c || 0;
    
    return c.json({ 
        broadcasts: broadcasts.results || [], 
        total_users: total
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/dashboard/audience", async (c) => {
  try {
    const { results } = await c.env.DB.prepare("SELECT user_id, username, first_name, joined_at FROM users ORDER BY joined_at DESC LIMIT 500").all();
    return c.json(results || []);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 🤖 Telegram Bot Webhook (Fail-Safe Unified Handler)
const handleBotUpdate = async (c: any) => {
  const bot = createBot(c.env.BOT_TOKEN, c.env.DB, {
    STORAGE_CHANNEL_ID: c.env.STORAGE_CHANNEL_ID,
    BACKUP_STORAGE_ID: c.env.BACKUP_STORAGE_ID,
    ADMIN_UID: c.env.ADMIN_UID,
    RENDER_URL: c.env.RENDER_URL,
    ADMIN_API_KEY: c.env.ADMIN_API_KEY
  }, c.executionCtx);

  const handler = webhookCallback(bot, "hono");
  return handler(c);
};

app.post("/", handleBotUpdate);
app.post("/webhook", handleBotUpdate);

// 🔐 PROTECTED ENGINE ENDPOINTS (Requires X-API-Key)
app.use("/api/users/*", async (c, next) => {
  const key = c.req.header("X-API-Key");
  if (!key || key !== c.env.ADMIN_API_KEY) return c.json({ error: "Unauthorized" }, 401);
  await next();
});
app.use("/api/broadcasts*", async (c, next) => {
  const key = c.req.header("X-API-Key");
  if (!key || key !== c.env.ADMIN_API_KEY) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

app.use("/api/users/block", async (c, next) => {
  const key = c.req.header("X-API-Key");
  if (!key || key !== c.env.ADMIN_API_KEY) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

// 🚀 BROADCAST MANAGEMENT (Aligned with 'sent'/'failed' schema)
app.get("/api/users", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "1000"), 5000);
  const page = Math.max(parseInt(c.req.query("page") || "1"), 1);
  const offset = (page - 1) * limit;
  try {
    const { results } = await c.env.DB.prepare("SELECT user_id FROM users WHERE user_id NOT IN (SELECT user_id FROM broadcast_exclusions) ORDER BY joined_at DESC LIMIT ? OFFSET ?")
      .bind(Number(limit), Number(offset)).all();
    const countRes = await c.env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE user_id NOT IN (SELECT user_id FROM broadcast_exclusions)").first<{ c: number }>();
    c.header("x-total-count", (countRes?.c || 0).toString());
    return c.json(results || []);
  } catch (e: any) { 
    console.error(`[API-ERROR] GET /api/users: ${e.message}`);
    return c.json({ error: e.message }, 500); 
  }
});

app.post("/api/broadcasts", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { message_id, from_chat_id } = body;
  
  if (!message_id || !from_chat_id) {
    return c.json({ error: "Invalid payload: message_id and from_chat_id are required" }, 400);
  }

  try {
    const countRes = await c.env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE user_id NOT IN (SELECT user_id FROM broadcast_exclusions)").first<{ c: number }>();
    const totalUsers = countRes?.c || 0;
    console.log(`[API-DEBUG] Creating broadcast ID. users table count: ${totalUsers}`);
    console.log(`[API-DEBUG] Creating broadcast. Audience Count: ${totalUsers}`);
    
    // Schema match: sent, failed (not sent_count)
    const res = await c.env.DB.prepare("INSERT INTO broadcasts (message_id, from_chat_id, total_users, sent, failed, status, created_at) VALUES (?, ?, ?, 0, 0, 'pending', datetime('now')) RETURNING id")
      .bind(Number(message_id), Number(from_chat_id), Number(totalUsers)).first<any>();
    return c.json({ broadcast_id: res.id, total_users: totalUsers });
  } catch (e: any) { 
    console.error(`[API-ERROR] POST /api/broadcasts: ${e.message}`);
    return c.json({ error: e.message }, 500); 
  }
});

app.get("/api/broadcasts/:id/progress", async (c) => {
  const id = c.req.param("id");
  try {
    const res = await c.env.DB.prepare("SELECT total_users, sent, failed, message_id, from_chat_id FROM broadcasts WHERE id = ?")
      .bind(Number(id)).first<any>();
    if (!res) return c.json({ error: "Not found" }, 404);
    
    // Map to engine expectations
    return c.json({ 
        total_users: res.total_users || 0, 
        sent_count: res.sent || 0, 
        failed_count: res.failed || 0,
        message_id: res.message_id,
        from_chat_id: res.from_chat_id
    });
  } catch (e: any) { 
    console.error(`[API-ERROR] GET /api/broadcasts/${id}/progress: ${e.message}`);
    return c.json({ error: e.message }, 500); 
  }
});

app.post("/api/users/block", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { user_id, reason } = body;
  if (!user_id) return c.json({ error: "user_id required" }, 400);

  try {
    // Report dead user to main blocked list
    await c.env.DB.prepare("INSERT OR IGNORE INTO blocked_users (user_id, reason, blocked_at) VALUES (?, ?, datetime('now'))")
      .bind(Number(user_id), String(reason || "Auto-detected dead user")).run();
    return c.json({ status: "blocked", user_id });
  } catch (e: any) {
    console.error(`[API-ERROR] POST /api/users/block: ${e.message}`);
    return c.json({ error: e.message }, 500);
  }
});

app.patch("/api/broadcasts/:id/finish", async (c) => {
  const id = c.req.param("id");
  try {
    await c.env.DB.prepare("UPDATE broadcasts SET status = 'completed' WHERE id = ?").bind(Number(id)).run();
    return c.json({ status: "finished" });
  } catch (e: any) { 
    console.error(`[API-ERROR] PATCH /api/broadcasts/${id}/finish: ${e.message}`);
    return c.json({ error: e.message }, 500); 
  }
});

app.patch("/api/broadcast-logs/update", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { broadcast_id, updates } = body;
  
  if (!broadcast_id || !Array.isArray(updates)) {
    return c.json({ error: "Invalid update payload" }, 400);
  }

  const successCount = updates.filter((u: any) => u.status === "success").length;
  const failedCount = updates.length - successCount;
  
  try {
    // 1. Update Campaign Summary Counts (Categorized)
    let updateQuery = "UPDATE broadcasts SET sent = sent + ?, failed = failed + ?";
    const params = [Number(successCount), Number(failedCount)];

    const blocked = updates.filter((u: any) => u.type === "blocked").length;
    const deactivated = updates.filter((u: any) => u.type === "deactivated").length;
    const notFound = updates.filter((u: any) => u.type === "not_found").length;

    if (blocked > 0) { updateQuery += ", blocked_count = blocked_count + ?"; params.push(blocked); }
    if (deactivated > 0) { updateQuery += ", deactivated_count = deactivated_count + ?"; params.push(deactivated); }
    if (notFound > 0) { updateQuery += ", not_found_count = not_found_count + ?"; params.push(notFound); }

    updateQuery += " WHERE id = ?";
    params.push(Number(broadcast_id));

    await c.env.DB.prepare(updateQuery).bind(...params).run();

    // 2. Detailed Per-User Logging (Bulk Insert)
    if (updates.length > 0) {
      const stmt = c.env.DB.prepare(
        "INSERT INTO broadcast_logs (broadcast_id, user_id, status, error) VALUES (?, ?, ?, ?)"
      );
      const batch = updates.map((u: any) => 
        stmt.bind(Number(broadcast_id), Number(u.user_id), String(u.status), String(u.error || ""))
      );
      await c.env.DB.batch(batch);
    }

    return c.json({ status: "updated", received: updates.length });
  } catch (e: any) { 
    console.error(`[API-ERROR] PATCH /api/broadcast-logs/update: ${e.message}`);
    return c.json({ error: e.message }, 500); 
  }
});


export default {
  /**
   * 🌐 Standard HTTP Fetch Handler (Hono)
   */
  fetch: app.fetch,

  /**
   * ⏰ Scheduled Task Handler (Cloudflare Cron)
   * - Triggered periodically (e.g., every 1 min) to process background queues.
   */
  async scheduled(event: any, env: Bindings, ctx: ExecutionContext) {
    console.log(`[Cron] Triggered at: ${new Date().toISOString()}`);
    
    // 1. Process Auto-Deletes (Expired messages)
    const api = new Api(env.BOT_TOKEN);
    ctx.waitUntil(processAutoDeletes(env.DB, api));

    // Future background tasks (e.g. broadcast retry) can be added here
  }
};
