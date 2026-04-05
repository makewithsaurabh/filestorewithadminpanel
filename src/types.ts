import { Context } from "grammy";

export type Bindings = {
  DB: D1Database;
  BOT_TOKEN: string;
  STORAGE_CHANNEL_ID: string;
  BACKUP_STORAGE_ID: string;
  ADMIN_UID: string;
  ADMIN_API_KEY: string;
  RENDER_URL: string;
};

export type DatabaseLink = {
  id: string;
  title: string;
  views: number;
  created_at: string;
  added_by: number | null;
};

export type DatabaseFile = {
  id: number;
  link_id: string;
  file_id: string;
  file_unique_id: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  downloads: number;
};

export type DatabaseChannel = {
  id: string;
  title: string;
  invite_link: string | null;
  is_force_join: number;
  added_by: number | null;
  position: number;
};

export type DatabaseAdmin = {
  user_id: number;
  role: 'admin' | 'owner';
  added_at: string;
};

export type DatabaseSetting = {
  key: string;
  value: string;
  updated_at: string;
};

export type MyContext = Context & {
  db: D1Database;
  config: {
    STORAGE_CHANNEL_ID: string;
    BACKUP_STORAGE_ID: string;
    ADMIN_UID: string;
    RENDER_URL: string;
    ADMIN_API_KEY: string;
  };
  role: 'user' | 'admin' | 'owner';
  executionCtx?: ExecutionContext;
};

export type DatabaseBroadcast = {
  id: number;
  message_id: number;
  from_chat_id: number;
  content_type: string;
  text_content: string | null;
  file_id: string | null;
  caption: string | null;
  total_users: number;
  sent: number;
  failed: number;
  status: 'pending' | 'running' | 'completed' | 'paused';
  created_at: string;
};

export type DatabaseBroadcastLog = {
  id: number;
  broadcast_id: number;
  user_id: number;
  status: 'pending' | 'success' | 'failed';
  error: string | null;
  updated_at: string;
};
