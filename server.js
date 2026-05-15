
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
import { getLiveQuote, searchLiveSymbols, getCompanyProfile } from "./services/finnhubService.js";

dotenv.config();

console.log("BOOT: server.js started");
console.log("PORT:", process.env.PORT);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("TURSO_DATABASE_URL exists:", !!process.env.TURSO_DATABASE_URL);
console.log("TURSO_AUTH_TOKEN exists:", !!process.env.TURSO_AUTH_TOKEN);
console.log("FINNHUB_API_KEY exists:", !!process.env.FINNHUB_API_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET || "dev_secret_change_me";

let migrationPromise = migrate().catch((err) => {
  console.error("Database migration failed:", err);
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static(path.join(__dirname, "public")));
app.use(async (req,res,next)=>{ await migrationPromise; next(); });

async function currentUser(req) {
  const id = req.signedCookies.user_id;
  if (!id) return null;
  return one("SELECT id, name, email FROM users WHERE id = ?", [id]);
}

async function requireLogin(req,res,next) {
  const user = await currentUser(req);
  if (!user) return res.redirect("/login");
  req.user = user;
  await ensurePaperAccount(user.id);
  next();
}

app.use(async (req,res,next)=>{ res.locals.user = await currentUser(req); next(); });

app.get("/ping", (req, res) => res.status(200).send("pong"));

app.get("/", (req,res)=>res.render("index",{title:"Simple Shares Stage 10", stocks: loadStocks().sort((a,b)=>b.rating-a.rating).slice(0,4)}));

app.get("/health", async (req,res)=>{
  try {
    await one("SELECT 1 AS ok", []);
    res.json({ok:true, database:"connected", finnhub: !!process.env.FINNHUB_API_KEY});
  } catch (err) {
    res.status(500).json({ok:false, error:err.message});
  }
});

app.get("/login", (req,res)=>res.render("login",{title:"Login", error:null}));

app.post("/login", async (req,res)=>{
  const user = await one("SELECT * FROM users WHERE email = ?", [req.body.email]);
  if (!user || !bcrypt.compareSync(req.body.password || "", user.password_hash)) {
    return res.render("login",{title:"Login", error:"Invalid email or password."});
  }

  res.cookie("user_id", user.id, { signed:true, httpOnly:true, sameSite:"lax", secure: process.env.NODE_ENV === "production" });
  res.redirect("/sandbox");
});

app.get("/register", (req,res)=>res.render("register",{title:"Register", error:null}));

app.post("/register", async (req,res)=>{
  try {
    const hash = bcrypt.hashSync(req.body.password, 10);
    const result = await run("INSERT INTO users (name,email,password_hash) VALUES (?,?,?)", [req.body.name, req.body.email, hash]);
    await run("INSERT INTO paper_accounts (user_id, starting_cash, cash_balance) VALUES (?,10000,10000)", [Number(result.lastInsertRowid)]);
    res.cookie("user_id", Number(result.lastInsertRowid), { signed:true, httpOnly:true, sameSite:"lax", secure: process.env.NODE_ENV === "production" });
    res.redirect("/sandbox");
  } catch(e) {
    res.render("register",{title:"Register", error:"Could not create account."});
  }
});

app.post("/logout",(req,res)=>{res.clearCookie("user_id");res.redirect("/")});

app.get("/stocks",(req,res)=>res.render("stocks",{title:"Ratings", stocks: searchStocks(req.query.q || ""), q:req.query.q || "", message:null}));

app.get("/search", requireLogin, async (req,res)=>{
  const q = req.query.q || "";
  const live = q ? await searchLiveSymbols(q) : { source: "sample", results: searchStocks("") };

  res.render("search",{
    title:"Search + AI",
    q,
    symbol:req.query.symbol || "",
    results: live.results,
    searchSource: live.source,
    stocks:loadStocks().sort((a,b)=>b.rating-a.rating),
    prompts:loadPrompts(),
    answer:null,
    selectedPrompt:"explain_simple",
    compareSymbol:""
  });
});

app.post("/search/ask", requireLogin, async (req,res)=>{
  let liveQuote = null;

  if (req.body.symbol) {
    try { liveQuote = await getLiveQuote(req.body.symbol); }
    catch (err) { console.error("Live quote in ask failed:", err.message); }
  }

  const answer = buildGuidedAnswer({ promptId:req.body.promptId, symbol:req.body.symbol, compareSymbol:req.body.compareSymbol, liveQuote });
  const live = await searchLiveSymbols(req.body.q || req.body.symbol || "");

  res.render("search",{
    title:"Search + AI",
    q:req.body.q || "",
    symbol:req.body.symbol,
    results:live.results,
    searchSource: live.source,
    stocks:loadStocks().sort((a,b)=>b.rating-a.rating),
    prompts:loadPrompts(),
    answer,
    selectedPrompt:req.body.promptId,
    compareSymbol:req.body.compareSymbol || ""
  });
});

app.get("/stock/:symbol", async (req,res)=>{
  const stock = loadStocks().find(s=>s.symbol===req.params.symbol) || {
    symbol:req.params.symbol,
    name:req.params.symbol,
    summary:"Live searched symbol.",
    price:0,
    rating:0,
    risk:"Unknown",
    signal:"Research",
    sector:"Live Market"
  };

  let liveQuote = null;
  let profile = null;

  try { liveQuote = await getLiveQuote(stock.symbol); } catch (err) { console.error("Stock live quote failed:", err.message); }
  try { profile = await getCompanyProfile(stock.symbol); } catch (err) { console.error("Profile failed:", err.message); }

  res.render("stock-detail",{title:stock.symbol, stock, liveQuote, profile});
});

app.post("/watchlist/add", requireLogin, async (req,res)=>{
  await run("INSERT OR IGNORE INTO watchlist (user_id,symbol) VALUES (?,?)",[req.user.id, String(req.body.symbol).toUpperCase()]);
  res.redirect(req.get("referer") || "/search");
});

app.get("/sandbox", requireLogin, async (req,res)=>res.render("sandbox",{
  title:"Sandbox",
  stats: await sandboxStats(req.user.id),
  stocks:loadStocks().sort((a,b)=>b.rating-a.rating),
  message:req.query.message,
  error:req.query.error
}));

app.post("/sandbox/buy", requireLogin, async (req,res)=>{
  try{
    let price = null;
    try { const live = await getLiveQuote(req.body.symbol); price = live?.quote?.c; } catch (e) {}
    await buyPaperTrade(req.user.id, req.body.symbol, Number(req.body.units), req.body.reason || "", price);
    res.redirect("/sandbox?message=Virtual buy trade recorded");
  } catch(e) {
    res.redirect("/sandbox?error="+encodeURIComponent(e.message));
  }
});

app.post("/sandbox/sell", requireLogin, async (req,res)=>{
  try{
    let price = null;
    try { const live = await getLiveQuote(req.body.symbol); price = live?.quote?.c; } catch (e) {}
    await sellPaperTrade(req.user.id, req.body.symbol, Number(req.body.units), req.body.reason || "", price);
    res.redirect("/sandbox?message=Virtual sell trade recorded");
  } catch(e) {
    res.redirect("/sandbox?error="+encodeURIComponent(e.message));
  }
});

app.post("/sandbox/reset", requireLogin, async (req,res)=>{ await resetSandbox(req.user.id); res.redirect("/sandbox?message=Sandbox reset"); });

app.get("/coach", requireLogin, (req,res)=>res.render("coach",{title:"AI Coach", answer:null, question:""}));

app.post("/coach", requireLogin, async (req,res)=>res.render("coach",{
  title:"AI Coach",
  answer:coachResponse(req.body.question, await sandboxStats(req.user.id)),
  question:req.body.question
}));

app.get("/api/live-quote/:symbol", async (req,res)=>{
  try { res.json(await getLiveQuote(req.params.symbol)); }
  catch (err) { res.status(500).json({error:err.message}); }
});

app.get("/api/live-search", async (req,res)=>res.json(await searchLiveSymbols(req.query.q || "")));

app.get("/api/company-profile/:symbol", async (req,res)=>{
  try { res.json(await getCompanyProfile(req.params.symbol)); }
  catch (err) { res.status(500).json({error:err.message}); }
});

app.get("/api/chart/stock/:symbol",(req,res)=>res.json({points:buildPriceHistory(req.params.symbol)}));

app.get("/api/chart/sandbox", requireLogin, async (req,res)=>{
  const stats = await sandboxStats(req.user.id);
  res.json({points:buildPortfolioHistory(stats), markers:buildTradeMarkers(stats.trades)});
});

app.get("/simulator",(req,res)=>res.render("simulator",{title:"Simulator"}));

app.use((err,req,res,next)=>{
  console.error(err);
  res.status(500).send(`<h1>Application error</h1><p>${err.message}</p>`);
});

if (process.env.VERCEL !== "1") {
  app.listen(PORT, "0.0.0.0", () => console.log(`BOOT OK: Server running on 0.0.0.0:${PORT}`));
}

export default app;
