import express from "express";
import expressLayouts from "express-ejs-layouts";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";
import { migrate, one, run } from "./db/db.js";
import {
  loadStocks,
  loadPrompts,
  searchStocks,
  sandboxStats,
  buyPaperTrade,
  sellPaperTrade,
  resetSandbox,
  ensurePaperAccount,
  coachResponse,
  buildGuidedAnswer
} from "./services/appService.js";
import { buildPriceHistory, buildPortfolioHistory, buildTradeMarkers } from "./services/chartService.js";

console.log("BOOT: server.js started");
console.log("PORT:", process.env.PORT);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("TURSO_DATABASE_URL exists:", !!process.env.TURSO_DATABASE_URL);
console.log("TURSO_AUTH_TOKEN exists:", !!process.env.TURSO_AUTH_TOKEN);


dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET || "dev_secret_change_me";

let migrationPromise = Promise.resolve();
console.log("TEMP: migration bypassed");


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

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

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
  res.render("index", { title: "Simple Shares Stage 9", stocks });
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
  const q = req.query.q || "";
  res.render("stocks", {
    title: "Ratings",
    stocks: searchStocks(q),
    q,
    message: req.query.message || null
  });
});

app.get("/search", requireLogin, async (req, res) => {
  const q = req.query.q || "";
  const symbol = req.query.symbol || "";
  const results = searchStocks(q);
  const stocks = loadStocks().sort((a,b)=>b.rating-a.rating);
  const prompts = loadPrompts();
  const stats = await sandboxStats(req.user.id);
  res.render("search", {
    title: "Search & Ask AI",
    q,
    symbol,
    results,
    stocks,
    prompts,
    answer: null,
    selectedPrompt: "explain_simple",
    compareSymbol: ""
  });
});

app.post("/search/ask", requireLogin, async (req, res) => {
  const { q, symbol, promptId, compareSymbol } = req.body;
  const results = searchStocks(q || symbol || "");
  const stocks = loadStocks().sort((a,b)=>b.rating-a.rating);
  const prompts = loadPrompts();
  const stats = await sandboxStats(req.user.id);
  const answer = buildGuidedAnswer({ promptId, symbol, compareSymbol, stats });
  res.render("search", {
    title: "Search & Ask AI",
    q: q || "",
    symbol,
    results,
    stocks,
    prompts,
    answer,
    selectedPrompt: promptId,
    compareSymbol: compareSymbol || ""
  });
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

app.get("/coach", requireLogin, (req, res) => {
  res.render("coach", { title: "AI Coach", answer: null, question: "" });
});

app.post("/coach", requireLogin, async (req, res) => {
  const stats = await sandboxStats(req.user.id);
  const answer = coachResponse(req.body.question || "", stats);
  res.render("coach", { title: "AI Coach", answer, question: req.body.question || "" });
});

app.get("/api/search", (req, res) => {
  res.json({ results: searchStocks(req.query.q || "") });
});

app.get("/api/prompts", (req, res) => {
  res.json({ prompts: loadPrompts() });
});

app.get("/api/chart/stock/:symbol", async (req, res) => {
  const points = buildPriceHistory(req.params.symbol, 90);
  if (!points.length) return res.status(404).json({ error: "Stock not found" });
  res.json({ symbol: req.params.symbol, points });
});

app.get("/api/chart/sandbox", requireLogin, async (req, res) => {
  const stats = await sandboxStats(req.user.id);
  res.json({
    points: buildPortfolioHistory(stats, 90),
    markers: buildTradeMarkers(stats.trades)
  });
});

app.get("/simulator", (req, res) => res.render("simulator", { title: "Simulator" }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(`
    <h1>Application error</h1>
    <p>${err.message}</p>
    <p>Check that TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set in .env locally and in Vercel/Render.</p>
  `);
});

if (process.env.VERCEL !== "1") {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BOOT OK: Server running on 0.0.0.0:${PORT}`);
  });
}

export default app;
