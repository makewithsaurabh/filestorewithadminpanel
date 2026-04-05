-- Links Table: Stores the unique slug, title, and views count
CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    added_by INTEGER
);

-- Files Table: Stores the Telegram file metadata linked to a specific link_id
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    file_unique_id TEXT NOT NULL,
    file_name TEXT,
    file_size INTEGER,
    mime_type TEXT,
    downloads INTEGER DEFAULT 0,
    FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);

-- Channels Table: Stores the channels required for Force Join
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY, -- Telegram Chat ID
    title TEXT NOT NULL,
    invite_link TEXT,
    is_force_join BOOLEAN DEFAULT 1,
    added_by INTEGER,
    position INTEGER DEFAULT 0 -- For manual button ordering
);

-- Users Table: To track bot users and their activity (DAU/MAU)
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Temp Bulk Files: Temporary storage for /bulk upload mode
CREATE TABLE IF NOT EXISTS temp_bulk_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    file_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin States: To track if an admin is in "Bulk Mode" on stateless workers
CREATE TABLE IF NOT EXISTS admin_states (
    admin_id INTEGER PRIMARY KEY,
    state TEXT NOT NULL, -- e.g., 'bulk_mode'
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admins Table: Multi-tier permission system
CREATE TABLE IF NOT EXISTS admins (
    user_id INTEGER PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'admin', -- 'admin' or 'owner'
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Settings Table: Dynamic bot texts (Start, Help, About)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Blocked Users Table: Restricted access
CREATE TABLE IF NOT EXISTS blocked_users (
    user_id INTEGER PRIMARY KEY,
    reason TEXT,
    blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Download Logs: Track which user downloaded which file and when
CREATE TABLE IF NOT EXISTS download_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_name TEXT,
    file_id TEXT NOT NULL,
    file_name TEXT,
    link_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Storage Logs: Track which admin stored which file and when
CREATE TABLE IF NOT EXISTS storage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    admin_name TEXT,
    file_id TEXT NOT NULL,
    file_name TEXT,
    link_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Join Requests: Track users who have submitted a 'Request to Join' for Force Join
CREATE TABLE IF NOT EXISTS join_requests (
    user_id INTEGER,
    channel_id TEXT,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, channel_id)
);

-- Auto Deletes: Queue for deleting messages after a delay
CREATE TABLE IF NOT EXISTS auto_deletes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    delete_at INTEGER NOT NULL
);

-- Link Specific Channels: Junction table mapping links to specific force join channels
CREATE TABLE IF NOT EXISTS link_channels (
    link_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    PRIMARY KEY(link_id, channel_id)
);

-- Channel Posts: Track messages posted by the bot in channels to allow Editing/Deleting
CREATE TABLE IF NOT EXISTS channel_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    text_preview TEXT,
    posted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Broadcast Exclusions: Users to skip during broadcasts
CREATE TABLE IF NOT EXISTS broadcast_exclusions (
    user_id INTEGER PRIMARY KEY,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Broadcast Table: Stores the unique broadcast campaign stats
CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL, -- The source message ID to copy
    from_chat_id INTEGER NOT NULL, -- The source chat (admin) to copy from
    content_type TEXT DEFAULT 'text', -- text, photo, video, etc.
    text_content TEXT, -- For text-only messages
    file_id TEXT, -- For media messages
    caption TEXT, -- For media messages
    total_users INTEGER DEFAULT 0,
    sent INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', -- pending, running, completed, paused
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Per-user Delivery Logs: Track delivery status for each user
CREATE TABLE IF NOT EXISTS broadcast_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, success, failed
    error TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE
);

-- Performance Indexes for scalability (100k+ users)
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_broadcast ON broadcast_logs (broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_status ON broadcast_logs (status);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users (last_active_at);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_user ON broadcast_logs (user_id);
-- Serving Locks: For concurrency control during file delivery
CREATE TABLE IF NOT EXISTS serving_locks (
    user_id INTEGER NOT NULL,
    link_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, link_id)
);

-- User Activity: Log DAILY unique interactions for DAU/MAU tracking
CREATE TABLE IF NOT EXISTS user_activity (
    user_id INTEGER NOT NULL,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, last_active)
);

-- Force Join Exclusions: Whitelisted users
CREATE TABLE IF NOT EXISTS fj_exclusions (
    user_id INTEGER PRIMARY KEY,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_activity_date ON user_activity (last_active);
