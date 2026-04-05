import { MyContext } from "../types";
import { esc } from "../core/database";

/**
 * ⚙️ 📈 Advanced Analytics Service
 * 
 * PURPOSE: Centralizes all complex D1 queries for the analytics dashboards.
 * WHY: Keeps the 'owner' module clean and ensures heavy queries are reusable.
 * 
 * Documentation added for easier debugging of nested SQL queries.
 */

/**
 * Returns broad global statistics for the main dashboard.
 */
export async function getGlobalStats(ctx: MyContext) {
  const query = `
    SELECT 
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM links) as total_links,
      (SELECT SUM(views) FROM links) as total_views,
      (SELECT SUM(downloads) FROM files) as total_downloads
  `;
  return await ctx.db.prepare(query).first<any>();
}

/**
 * Calculates DAU (Daily Active) and MAU (Monthly Active) users.
 * Uses the user_activity table for precise distinct user tracking.
 */
export async function getActivityMetrics(ctx: MyContext) {
  // DAU: Daily Active Users (Seen within last 24h)
  const dau = await ctx.db.prepare("SELECT COUNT(*) as c FROM users WHERE last_active_at >= datetime('now', '-1 day')").first<{ c: number }>();
  // MAU: Monthly Active Users (Seen within last 30d)
  const mau = await ctx.db.prepare("SELECT COUNT(*) as c FROM users WHERE last_active_at >= datetime('now', '-30 days')").first<{ c: number }>();
  
  return { 
    dau: dau?.c || 0, 
    mau: mau?.c || 0 
  };
}

/**
 * Returns top-performing files based on total cumulative downloads.
 */
export async function getTopDownloads(ctx: MyContext, limit: number = 5) {
  const { results } = await ctx.db.prepare("SELECT file_name, downloads FROM files ORDER BY downloads DESC LIMIT ?")
    .bind(limit).all<any>();
  const totalRes = await ctx.db.prepare("SELECT SUM(downloads) as s FROM files").first<{ s: number }>();
  
  return {
    top_files: results,
    total_delivered: totalRes?.s || 0
  };
}

/**
 * Fetches user directory with pagination for the admin dashboard.
 */
export async function getUserDirectory(ctx: MyContext, page: number, limit: number = 10) {
  const offset = page * limit;
  const { results } = await ctx.db.prepare("SELECT * FROM users ORDER BY joined_at DESC LIMIT ? OFFSET ?")
    .bind(limit, offset).all<any>();
  const countRes = await ctx.db.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>();
  
  return {
    users: results,
    total: countRes?.c || 0,
    hasMore: (offset + limit) < (countRes?.c || 0)
  };
}
