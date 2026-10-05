import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __dbTablesCreated?: boolean;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);

// Auto-create tables on first use
export async function ensureTables() {
  if (globalForDb.__dbTablesCreated) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        status_message TEXT DEFAULT 'Ожидание загрузки...',
        video1_name TEXT,
        video2_name TEXT,
        trim_point TEXT,
        merged_video_url TEXT,
        screenshots JSONB DEFAULT '[]',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        chat_id BIGINT NOT NULL,
        username TEXT,
        job_id TEXT,
        status TEXT NOT NULL DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    globalForDb.__dbTablesCreated = true;
    console.log("✅ Database tables ready");
  } catch (err) {
    console.error("❌ Failed to create tables:", err);
  }
}
