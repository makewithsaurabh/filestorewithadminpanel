import { MyContext } from "../types";

/**
 * ⚙️ 📢 Broadcast Service
 * 
 * PURPOSE: Centralizes global transmission logic and tracks states (pending/running/done).
 * WHY: Decouples UI triggers from the backend execution status.
 * 
 * Logic to communicate with the external Render engine is located here for easy debugging.
 */

/**
 * Initializes a new broadcast campaign. 
 * Triggers the remote Render engine via HTTP.
 */
export async function startBroadcast(ctx: MyContext, broadcastId: number, statusMsgId?: number) {
  const bc = await ctx.db.prepare("SELECT * FROM broadcasts WHERE id = ?").bind(broadcastId).first<any>();
  if (!bc) throw new Error("Broadcast not found.");

  // 1. Mark as running locally
  await ctx.db.prepare("UPDATE broadcasts SET status = 'running' WHERE id = ?").bind(broadcastId).run();

  // 2. Trigger External Rendering Engine (via Render)
  if (ctx.config.RENDER_URL) {
    try {
      const resp = await fetch(`${ctx.config.RENDER_URL}/broadcast`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-API-Key': ctx.config.ADMIN_API_KEY
        },
        body: JSON.stringify({
          broadcast_id: broadcastId,
          message_id: bc.message_id,
          from_chat_id: bc.from_chat_id,
          admin_id: ctx.from!.id,
          status_msg_id: statusMsgId || null
        })
      });
      return await resp.json();
    } catch (e: any) {
      console.error("Broadcast trigger failed:", e);
      throw new Error(`Render Trigger Error: ${e.message}`);
    }
  }
  
  return { success: true, mode: 'local_tracking_only' };
}

/**
 * Updates the current transmission status of a broadcast.
 */
export async function updateBroadcastStatus(ctx: MyContext, broadcastId: number, status: string, sent: number, failed: number) {
  return await ctx.db.prepare("UPDATE broadcasts SET status = ?, sent = ?, failed = ? WHERE id = ?")
    .bind(status, sent, failed, broadcastId).run();
}

/**
 * ⏯️ Remote Status Toggler
 */
export async function toggleBroadcastStatus(ctx: MyContext, broadcastId: number) {
  const b = await ctx.db.prepare("SELECT status FROM broadcasts WHERE id = ?").bind(broadcastId).first<{ status: string }>();
  if (!b) throw new Error("Broadcast not found.");

  const newStatus = b.status === "paused" ? "running" : "paused";
  await ctx.db.prepare("UPDATE broadcasts SET status = ? WHERE id = ?").bind(newStatus, broadcastId).run();
  
  // Note: Render engine should poll or be notified of this change.
  return newStatus;
}

/**
 * 🗑️ Campaign Purge
 */
export async function deleteBroadcast(ctx: MyContext, broadcastId: number) {
  await ctx.db.prepare("DELETE FROM broadcasts WHERE id = ?").bind(broadcastId).run();
  await ctx.db.prepare("DELETE FROM broadcast_logs WHERE broadcast_id = ?").bind(broadcastId).run();
}
