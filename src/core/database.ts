import { DatabaseSetting, DatabaseAdmin } from "../types";

/**
 * Escapes HTML special characters for Telegram messages.
 */
export const esc = (str: any): string =>
  String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Standard sleep/delay function.
 */
export const Sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retrieves a setting value from the database with a fallback.
 */
export async function getSetting(db: D1Database, key: string, defaultValue: string): Promise<string> {
  const s = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<DatabaseSetting>();
  return s ? s.value : defaultValue;
}

/**
 * Checks if a user is blocked in the database.
 */
export async function isUserBlocked(db: D1Database, userId: number): Promise<boolean> {
  const isBlocked = await db.prepare("SELECT user_id FROM blocked_users WHERE user_id = ?").bind(userId).first();
  return !!isBlocked;
}

/**
 * Identifies the role of a user (owner, admin, or user).
 */
export async function getUserRole(db: D1Database, userId: number, adminUid: string): Promise<'owner' | 'admin' | 'user'> {
  const ownerId = String(adminUid).trim();
  const currentUserId = String(userId).trim();

  if (currentUserId === ownerId) {
    return "owner";
  }

  const admin = await db.prepare("SELECT role FROM admins WHERE user_id = ?").bind(userId).first<DatabaseAdmin>();
  return admin ? admin.role : "user";
}

/**
 * Updates user activity and information in the database.
 * Logs daily unique interactions to the 'user_activity' table for DAU/MAU metrics.
 */
export async function trackUserActivity(db: D1Database, userId: number, username: string | null, firstName: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  try {
    // 1. Update Core User Profile
    await db.prepare(
      "INSERT INTO users (user_id, username, first_name, last_active_at) " +
      "VALUES (?, ?, ?, CURRENT_TIMESTAMP) " +
      "ON CONFLICT(user_id) DO UPDATE SET last_active_at = CURRENT_TIMESTAMP, username = ?, first_name = ?"
    )
      .bind(
        Number(userId),
        String(username || ""),
        String(firstName || "User"),
        String(username || ""),
        String(firstName || "User")
      )
      .run();
  } catch (e) {
    console.error("Activity tracking failed:", e);
  }
}
