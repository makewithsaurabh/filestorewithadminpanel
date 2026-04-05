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

// 🚀 BROADCAST MANAGEMENT (Aligned with 'sent'/'failed' schema)
app.get("/api/users", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "1000"), 5000);
  const page = Math.max(parseInt(c.req.query("page") || "1"), 1);
  const offset = (page - 1) * limit;
  try {
    const { results } = await c.env.DB.prepare("SELECT user_id FROM users ORDER BY joined_at DESC LIMIT ? OFFSET ?").bind(limit, offset).all();
    const countRes = await c.env.DB.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>();
    c.header("x-total-count", (countRes?.c || 0).toString());
    return c.json(results || []);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/api/broadcasts", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { message_id, from_chat_id } = body;
  
  if (!message_id || !from_chat_id) {
    return c.json({ error: "Invalid payload: message_id and from_chat_id are required" }, 400);
  }

  try {
    const countRes = await c.env.DB.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>();
    const totalUsers = countRes?.c || 0;
    
    // Schema match: sent, failed (not sent_count)
    const res = await c.env.DB.prepare("INSERT INTO broadcasts (message_id, from_chat_id, total_users, sent, failed, status, created_at) VALUES (?, ?, ?, 0, 0, 'pending', datetime('now')) RETURNING id").bind(message_id, from_chat_id, totalUsers).first<any>();
    return c.json({ broadcast_id: res.id, total_users: totalUsers });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.get("/api/broadcasts/:id/progress", async (c) => {
  const id = c.req.param("id");
  try {
    const res = await c.env.DB.prepare("SELECT total_users, sent, failed FROM broadcasts WHERE id = ?").bind(id).first<any>();
    if (!res) return c.json({ error: "Not found" }, 404);
    
    // Map to engine expectations if needed, or keep exact schema
    return c.json({ 
        total_users: res.total_users || 0, 
        sent_count: res.sent || 0, 
        failed_count: res.failed || 0 
    });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.patch("/api/broadcasts/:id/finish", async (c) => {
  const id = c.req.param("id");
  try {
    await c.env.DB.prepare("UPDATE broadcasts SET status = 'completed' WHERE id = ?").bind(id).run();
    return c.json({ status: "finished" });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
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
    // Schema match: SET sent = sent + ?, failed = failed + ?
    await c.env.DB.prepare("UPDATE broadcasts SET sent = sent + ?, failed = failed + ? WHERE id = ?").bind(successCount, failedCount, broadcast_id).run();
    return c.json({ status: "updated", received: updates.length });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
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
