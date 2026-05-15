
import "dotenv/config";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

console.log("DB URL exists:", !!url);
console.log("DB token exists:", !!authToken);
console.log("DB URL starts with libsql:", url?.startsWith("libsql://"));

if (!url || !authToken) {
  throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
}

export const db = createClient({ url, authToken });

export async function one(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows[0] || null;
}

export async function all(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows || [];
}

export async function run(sql, args = []) {
  return db.execute({ sql, args });
}

export async function migrate() {
  console.log("Running database migration...");

  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    `CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, symbol)
    )`,
    `CREATE TABLE IF NOT EXISTS stock_cache (
      symbol TEXT PRIMARY KEY,
      quote_json TEXT,
      profile_json TEXT,
      search_json TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const sql of statements) {
    console.log("Running:", sql.split("(")[0].trim());
    await run(sql);
  }

  const demo = await one("SELECT id FROM users WHERE email = ?", ["demo@shares.app"]);
  if (!demo) {
    const hash = bcrypt.hashSync("demo123", 10);
    const result = await run(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
      ["Demo User", "demo@shares.app", hash]
    );

    await run(
      "INSERT INTO paper_accounts (user_id, starting_cash, cash_balance) VALUES (?, ?, ?)",
      [Number(result.lastInsertRowid), 10000, 10000]
    );
  }

  console.log("Database migration complete");
}
