import { MyContext, DatabaseChannel } from "../types";

/**
 * ⚙️ Channel Management Service
 * - Handles registration, invite link generation, and reordering.
 * - Pure engine logic: No buttons or keyboards.
 */

/**
 * Registers (or updates) a channel in the system.
 * Generates appropriate invite links for Direct vs JoinRequest modes.
 */
export async function registerChannel(ctx: MyContext, chatId: string, title: string, mode: 'direct' | 'request', username?: string) {
  try {
    let inviteLink = "";
    if (username) {
      inviteLink = `https://t.me/${username}`;
    } else if (mode === "direct") {
      inviteLink = await ctx.api.exportChatInviteLink(chatId);
    } else {
      const invite = await ctx.api.createChatInviteLink(chatId, { creates_join_request: true });
      inviteLink = invite.invite_link;
    }

    await ctx.db.prepare(
      "INSERT OR REPLACE INTO channels (id, title, invite_link, is_force_join, added_by, position) " +
      "VALUES (?, ?, ?, 1, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM channels))"
    )
    .bind(chatId, title, inviteLink, ctx.from!.id)
    .run();

    return inviteLink;
  } catch (e: any) {
    console.error("registerChannel Error:", e.message);
    throw e;
  }
}

/**
 * Moves a channel up or down in the position list.
 */
export async function reorderChannel(ctx: MyContext, chatId: string, direction: 'up' | 'down') {
  const { results: channels } = await ctx.db.prepare("SELECT id, position FROM channels ORDER BY position ASC, id ASC").all<{ id: string; position: number }>();
  const index = channels.findIndex(ch => ch.id === chatId);
  if (index === -1) return;

  let swapIndex = -1;
  if (direction === "up" && index > 0) swapIndex = index - 1;
  else if (direction === "down" && index < channels.length - 1) swapIndex = index + 1;

  if (swapIndex !== -1) {
    const batch: any[] = [];
    channels.forEach((ch, i) => {
      let newPos = i;
      if (i === index) newPos = swapIndex;
      else if (i === swapIndex) newPos = index;
      batch.push(ctx.db.prepare("UPDATE channels SET position = ? WHERE id = ?").bind(newPos, ch.id));
    });
    await ctx.db.batch(batch);
  }
}
