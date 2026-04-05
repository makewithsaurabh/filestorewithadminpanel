# 📁 Telegram File Store Bot (Expert Edition) 🤖⚡️

A high-performance, professional-grade Telegram File Store Bot built with **grammY** and **Cloudflare Workers (Hono + D1)**. This bot is designed for scalability, secure link management, and advanced administrative oversight.

---

## 🎭 User Roles & Permissions

The bot features a hierarchical permission system:

| Role | Permissions |
| :--- | :--- |
| **👤 User** | Access files via specific links, submit join requests to Force Join channels. |
| **🛡️ Admin** | Create/Manage links, Add/Remove their own Force Join channels, Perform broadcasts, Block users. |
| **👑 Owner** | **Full System Access**: Manage all Admins, view detailed Global Stats, Audit all channels, Audit all join requests, Post to any channel, Set global bot texts. |

---

## 🚀 Core Features

### 1. Advanced Force Join System 🛡️
The most robust Telegram Force Join engine available, supporting multiple layers of verification:
*   **Smart Detection**: Automatically detects if a channel is Public (via `@username`) or Private (via Chat ID).
*   **Modes**:
    *   **Direct Join**: Users must simply be a member of the channel.
    *   **Request to Join**: Users must have a "Pending" or "Approved" join request in private channels.
*   **Granular Hierarchy**:
    1.  **Link-Specific**: You can assign specific channels to a specific file link.
    2.  **Admin-Specific**: If no link-channels are set, the bot requires all channels added by that specific Admin.
    3.  **Global Fallback**: If still nothing is found, it falls back to the Owner's global channels.
*   **Join Audit Log (Owner Only)**: View a paginated list of exactly **Who** requested to join which channel and **When**.

### 2. High-Performance Broadcast System 📣
A background broadcast engine designed to bypass Cloudflare Worker timeouts:
*   **Format Preservation**: Uses `copyMessage` to ensure HTML formatting, buttons, and media are preserved exactly as sent.
*   **Live Progress Tracking**: Real-time percentage updates with success/blocked/deactivated counts.
*   **Background Execution**: Uses `ctx.executionCtx.waitUntil()` so the broadcast continues even after the initial request finishes.
*   **Owner Exclusions**: The Owner can maintain a private "Skip List" of user IDs to exclude from their broadcasts.

### 3. File Storage & Link Management 📁
*   **Single/Bulk Upload**: Store individual files or batch-upload multiple files into a single shareable link.
    *   *Bulk Flow*: Type `/bulk` -> Send multiple files -> Type `/done` -> Get one link for all.
*   **Link Customization (Renaming)**: After storing a file, the bot asks for a title. You can give it a custom name or `/skip` to use the default filename.
*   **Auto-Deletion**: Automatically delete the bot's response in the user's chat after a set time (5m, 10m, 1h, etc.) to keep their chat clean.
*   **Link Analytics**: Track views for every link and downloads for every individual file.
*   **Admin Isolation**: Admins can only see and manage the links and channels they personally created.
*   **Master Cancel**: Use `/cancel` at any time to exit a bulk upload, renaming flow, or broadcast setup.
*   **Post Auditing**: The bot tracks every message ID it sends to your channels, enabling remote management from within the bot's dashboard.

### 4. Admin & Owner Dashboard 🛠️
*   **Global Stats**: Overview of total users, links, views, and downloads.
*   **Advanced Analytics (Owner Only)**: 
    *   **DAU/MAU**: Daily and Monthly active user counts with improved visual accuracy.
    *   **Activity Logs**: Real-time logs of downloads and storage actions with **numbered lists** and linked user profiles.
    *   **User Directory**: Paginated list of every user with **absolute numbering** and a clear `Page X / Y` header. Clicking names opens their Telegram profiles.
*   **Moderation**: Block/Unblock users by ID with optional reasons.
*   **Admin Management**: Manage staff with a clear **Name + ID** interface. Revoke buttons are now labeled with the administrator's name for clarity.
*   **Performance Optimization**: Every button in the dashboard is now optimized with instant "Callback Answer" signals to prevent UI lag.
*   **Safe-HTML Architecture**: All analytic and management views now use a robust **HTML Sanitization Engine** (`esc()`) to prevent crashes from special characters in user names.
*   **Customization**: Change `/start` and `/help` texts directly from the bot.

---

## 🛠 Technical Architecture

### 1. Data Layer (Cloudflare D1)
The bot uses a relational SQLite database (D1) with the following key tables:
*   `links` & `files`: Data relationships for file storage.
*   `users`: Tracks user profiles and `last_active_at` for DAU/MAU.
*   `channels` & `link_channels`: Management of Force Join requirements.
*   `join_requests`: Tracks "Request to Join" submissions.
*   `broadcast_exclusions`: Owner-specific skip list.
*   `channel_posts`: Tracking for bot-sent messages in channels (for Edit/Delete).
*   `admin_states`: Lightweight state machine for handling multi-step flows (Rename, Post, Broadcast, Edit).

### 2. Logic Layer (grammY + Hono)
*   **Middleware**: A robust main middleware handles role identification (Owner vs Admin), blocked user filtering, and automatic activity tracking.
    *   *Real-time Sync*: The `last_active_at` timestamp for every user is updated on **every single interaction** (message, tap, button click), providing pinpoint accuracy for DAU/MAU stats.
*   **Custom Context**: The `MyContext` type extends `grammY.Context` to provide type-safe access to `db`, `config`, `role`, and `executionCtx`.
*   **Background Tasks**: Leverages the Cloudflare Worker `ExecutionContext` to handle long-running operations like broadcasts and auto-deletions without blocking the webhook response.

---

## 📖 How to Use

### For Admins:
1.  **Dashboard**: Type `/admin` to open your management center.
2.  **Add Channel**: In "Manage Channels", use the "Select Channel" button. The bot will automatically request all necessary permissions.
3.  **Store File**: Simply send or forward any file to the bot. It will be stored in your private storage channel, and you'll get a shareable `t.me/...` link.
4.  **Broadcast**: Type `/broadcast`, send your message, preview it, and hit "Start".

### For Owner:
1.  **View All**: In "Manage Channels" and "Manage Links", you see everything from all admins.
2.  **Audit Users**: Go to "Advanced Stats" -> "User List" to see your audience.
3.  **Post Directly**: Select any channel in "Manage Channels" and click "Post Message" to send updates through the bot.
4.  **Manage Posts**: Access "Post History" in any channel's menu to **Edit** or **Delete** previous messages.
5.  **Manage Staff**: Use `/addadmin <id>` to promote users to Admin or Owner status.

---

## 🚀 Commands Reference

| Command | Description |
| :--- | :--- |
| `/start` | Bot entry point / Access shared files. |
| `/admin` | Open Primary Dashboard. |
| `/store` | Start single file storage flow. |
| `/bulk` | Start bulk file storage flow. |
| `/manage` | Quick access to Link Management. |
| `/broadcast` | Start global broadcast flow. |
| `/exclude <id>` | (Owner) Skip user in broadcasts. |
| `/include <id>` | (Owner) Unskip user in broadcasts. |
| `/block <id>` | Prevent a user from using the bot. |
| `/addadmin <id>` | Promote a user to staff. |
| `/cancel` | Master reset for any active flow. |

---

## 🔧 Deployment

1.  **Environment Variables**:
    *   `BOT_TOKEN`: Your Telegram Bot API token.
    *   `DB`: Your Cloudflare D1 Database binding.
    *   `STORAGE_CHANNEL_ID`: The ID of your private file storage channel.
    *   `ADMIN_UID`: The ID of the bot creator (Root Owner).
2.  **Command**: `npx wrangler deploy`
3.  **Init**: Send `/init` to the bot after deployment to set up the specialized Admin/User menus.

---
> [!NOTE]
> This bot is built for the **V12 Engine** architecture, focusing on background processing and D1 performance. 🚀🦾
