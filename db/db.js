
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.warn("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN. Add them to .env locally and Vercel Environment Variables.");
}

export const db = createClient({
  url: url || "file:local-dev-warning.db",
  authToken: authToken || undefined
});

export async function execute(sql, args = []) {
  return db.execute({ sql, args });
}

export async function one(sql, args = []) {
  const result = await execute(sql, args);
  return result.rows[0] || null;
}

export async function all(sql, args = []) {
  const result = await execute(sql, args);
  return result.rows || [];
}

export async function run(sql, args = []) {
  return execute(sql, args);
}

export async function migrate() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, symbol)
    )`,
    `CREATE TABLE IF NOT EXISTS paper_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      starting_cash REAL NOT NULL DEFAULT 10000,
      cash_balance REAL NOT NULL DEFAULT 10000,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      action TEXT NOT NULL,
      units REAL NOT NULL,
      price REAL NOT NULL,
      total_value REAL NOT NULL,
      reason TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS paper_holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      units REAL NOT NULL DEFAULT 0,
      avg_price REAL NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, symbol)
    )`,
    `CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      target_price REAL,
      note TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  ], "write");

  const demoEmail = "demo@shares.app";
  const existing = await one("SELECT id FROM users WHERE email = ?", [demoEmail]);
  if (!existing) {
    const hash = bcrypt.hashSync("demo123", 10);
    const result = await run("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)", ["Demo User", demoEmail, hash]);
    const userId = Number(result.lastInsertRowid);
    await run("INSERT INTO paper_accounts (user_id, starting_cash, cash_balance) VALUES (?, ?, ?)", [userId, 10000, 10000]);
  } else {
    await run("INSERT OR IGNORE INTO paper_accounts (user_id, starting_cash, cash_balance) VALUES (?, ?, ?)", [existing.id, 10000, 10000]);
  }
}
