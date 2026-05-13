
import express from "express";
import expressLayouts from "express-ejs-layouts";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";
import { migrate, one, run } from "./db/db.js";
import { loadStocks, sandboxStats, buyPaperTrade, sellPaperTrade, resetSandbox, ensurePaperAccount, coachResponse } from "./services/appService.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET || "dev_secret_change_me";

let migrationPromise = migrate().catch((err) => {
  console.error("Database migration failed:", err);
});

async function ready(req, res, next) {
  try {
    await migrationPromise;
    next();
  } catch (err) {
    next(err);
  }
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static(path.join(__dirname, "public")));
app.use(ready);

async function currentUser(req) {
  const id = req.signedCookies.user_id;
  if (!id) return null;
  return one("SELECT id, name, email FROM users WHERE id = ?", [id]);
}

async function requireLogin(req, res, next) {
  const user = await currentUser(req);
  if (!user) return res.redirect("/login");
  req.user = user;
  await ensurePaperAccount(user.id);
  next();
}

app.use(async (req, res, next) => {
  res.locals.user = await currentUser(req);
  next();
});

app.get("/", async (req, res) => {
  const stocks = loadStocks().sort((a,b)=>b.rating-a.rating).slice(0, 4);
  res.render("index", { title: "Simple Shares Stage 7", stocks });
});

app.get("/health", async (req, res) => {
  try {
    await one("SELECT 1 as ok", []);
    res.json({ ok: true, database: "connected" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/login", (req, res) => res.render("login", { title: "Login", error: null }));
app.post("/login", async (req, res) => {
  const user = await one("SELECT * FROM users WHERE email = ?", [req.body.email]);
  if (!user || !bcrypt.compareSync(req.body.password || "", user.password_hash)) {
    return res.render("login", { title: "Login", error: "Invalid email or password." });
  }
  res.cookie("user_id", user.id, { signed: true, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  res.redirect("/sandbox");
});

app.get("/register", (req, res) => res.render("register", { title: "Register", error: null }));
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.render("register", { title: "Register", error: "All fields are required." });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = await run("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)", [name, email, hash]);
    const userId = Number(result.lastInsertRowid);
    await run("INSERT INTO paper_accounts (user_id, starting_cash, cash_balance) VALUES (?, ?, ?)", [userId, 10000, 10000]);
    res.cookie("user_id", userId, { signed: true, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    res.redirect("/sandbox");
  } catch (err) {
    console.error(err);
    res.render("register", { title: "Register", error: "That email is already registered, or the database is not configured." });
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("user_id");
  res.redirect("/");
});

app.get("/stocks", (req, res) => {
  res.render("stocks", { title: "Ratings", stocks: loadStocks().sort((a,b)=>b.rating-a.rating), message: req.query.message || null });
});

app.get("/stock/:symbol", (req, res) => {
  const stock = loadStocks().find(s => s.symbol === req.params.symbol);
  if (!stock) return res.status(404).render("not-found", { title: "Not found" });
  res.render("stock-detail", { title: stock.symbol, stock, message: req.query.message || null });
});

app.post("/watchlist/add", requireLogin, async (req, res) => {
  await run("INSERT OR IGNORE INTO watchlist (user_id, symbol) VALUES (?, ?)", [req.user.id, req.body.symbol]);
  res.redirect(req.get("referer") || "/stocks");
});

app.get("/sandbox", requireLogin, async (req, res) => {
  const stats = await sandboxStats(req.user.id);
  const stocks = loadStocks().sort((a,b)=>b.rating-a.rating);
  res.render("sandbox", { title: "Sandbox Trading", stats, stocks, message: req.query.message || null, error: req.query.error || null });
});

app.post("/sandbox/buy", requireLogin, async (req, res) => {
  try {
    await buyPaperTrade(req.user.id, req.body.symbol, Number(req.body.units), req.body.reason || "");
    res.redirect("/sandbox?message=Virtual buy trade recorded");
  } catch (err) {
    res.redirect(`/sandbox?error=${encodeURIComponent(err.message)}`);
  }
});

app.post("/sandbox/sell", requireLogin, async (req, res) => {
  try {
    await sellPaperTrade(req.user.id, req.body.symbol, Number(req.body.units), req.body.reason || "");
    res.redirect("/sandbox?message=Virtual sell trade recorded");
  } catch (err) {
    res.redirect(`/sandbox?error=${encodeURIComponent(err.message)}`);
  }
});

app.post("/sandbox/reset", requireLogin, async (req, res) => {
  await resetSandbox(req.user.id);
  res.redirect("/sandbox?message=Sandbox reset to $10,000 virtual cash");
});

app.get("/coach", requireLogin, (req, res) => res.render("coach", { title: "AI Coach", answer: null, question: "" }));
app.post("/coach", requireLogin, async (req, res) => {
  const stats = await sandboxStats(req.user.id);
  const answer = coachResponse(req.body.question || "", stats);
  res.render("coach", { title: "AI Coach", answer, question: req.body.question || "" });
});

app.get("/simulator", (req, res) => res.render("simulator", { title: "Simulator" }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(`
    <h1>Application error</h1>
    <p>${err.message}</p>
    <p>Check that TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set in .env locally and in Vercel.</p>
  `);
});

if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => console.log(`Simple Shares Stage 7 running on http://localhost:${PORT}`));
}

export default app;
