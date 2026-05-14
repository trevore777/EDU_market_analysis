import "dotenv/config";
import { createClient } from "@libsql/client";

console.log("URL:", process.env.TURSO_DATABASE_URL);
console.log("TOKEN EXISTS:", !!process.env.TURSO_AUTH_TOKEN);

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

try {
  const result = await db.execute("SELECT 1 AS test");
  console.log("TURSO OK:", result.rows);
} catch (err) {
  console.error("TURSO TEST FAILED:");
  console.error(err);
}