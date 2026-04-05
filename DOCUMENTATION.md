# 🤖 Premium FileStore Bot: Production Documentation (v2.6)

Welcome to the definitive guide for your high-performance Telegram FileStore bot. This bot is built using Cloudflare Workers (Hono/D1) and integrated with a high-res Broadcast Engine.

## 🚀 Key Features

### 1. Advanced Broadcasting (v2.6)
- **High-Res Reporting**: Shaded progress bars (`████▒▒▒`) for live tracking and history.
- **Pre-Flight Preview**: Mandatory `copyMessage` preview to verify HTML/Markdown formatting before starting.
- **Fail-Safe Processing**: Real-time error categorization (Blocked, Deactivated, Not Found) with percentage tracking.

### 2. Multi-Admin Infrastructure
- **Ghost Channel Assignment**: Owners can assign any Force-Join channel to any admin ID, making it natively manageable in their list.
- **Link Attribution (Pro)**: A visual selection menu allows the owner to delegate link creation to specific admins.
- **Privacy Separation**: Each admin only sees and manages their own links/channels, even though enforcement is global.

### 3. Protection & Optimization
- **Exclusion Manager**: Integrated blacklist to skip specific users during broadcasts.
- **Audience Purge**: Optimized for active users only (~448 active user stabilization).
- **Force Join Protection**: Scalable multi-channel verification with D1 database caching for performance.

## 📁 Repository Structure
- `/src`: Core bot logic (Handlers, Services, Middlewares).
- `schema.sql`: Database schema for D1.
- `wrangler.toml`: Cloudflare deployment configuration (Sanitized).

## 🛠 Deployment & Setup

### 1. Prerequisites
- Cloudflare Account & Wrangler CLI
- Telegram Bot Token from @BotFather

### 2. Production Environment (Secrets)
**CRITICAL**: All sensitive keys have been scrubbed from `wrangler.toml`. You MUST manually set them before deploying:

```bash
wrangler secret put BOT_TOKEN
wrangler secret put ADMIN_API_KEY
wrangler secret put ADMIN_UID
```

### 3. Database Initialization
```bash
npx wrangler d1 execute DB --local --file=./schema.sql
```

### 4. Broadcaster Engine
The **Master Broadcaster Bot (Render-server)** has been separated to your Desktop. It must be hosted on Render or a similar platform with a high-performance HTTP endpoint.

---

## 🛠 Administrative Navigation
- `/admin`: Open the main owner/admin dashboard.
- **Broadcast Menu**: Manage campaigns, history, and the Exclusion list.
- **Channel Menu**: Add channels, set FJ modes (Direct/Request), and reorder buttons.
- **Link Attribution**: Choose who "owns" the next upload batch.

> [!TIP]
> Always verify your **BOT_TOKEN** and **RENDER_URL** in the Cloudflare dashboard if the broadcast engine isn't receiving campaign triggers.
