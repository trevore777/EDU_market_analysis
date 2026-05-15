
import "dotenv/config";
import { one, run } from "../db/db.js";
import { findStock, searchStocks } from "./appService.js";

const API_KEY = process.env.FINNHUB_API_KEY;
const CACHE_MINUTES = 15;

function isFresh(updatedAt, minutes = CACHE_MINUTES) {
  if (!updatedAt) return false;
  const updated = new Date(updatedAt).getTime();
  return Date.now() - updated < minutes * 60 * 1000;
}

function normaliseSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

async function fetchJson(url) {
  if (!API_KEY) throw new Error("Missing FINNHUB_API_KEY");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Finnhub request failed: HTTP ${response.status}`);
  return response.json();
}

export async function getLiveQuote(symbol) {
  symbol = normaliseSymbol(symbol);
  const cached = await one("SELECT * FROM stock_cache WHERE symbol = ?", [symbol]);

  if (cached?.quote_json && isFresh(cached.updated_at)) {
    return { symbol, source: "cache", quote: JSON.parse(cached.quote_json) };
  }

  const quote = await fetchJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`);

  if (!quote || quote.c === 0) {
    const fallback = findStock(symbol);
    if (fallback) {
      return {
        symbol,
        source: "sample-fallback",
        quote: { c: fallback.price, h: fallback.price, l: fallback.price, o: fallback.price, pc: fallback.price, t: Math.floor(Date.now() / 1000) }
      };
    }
  }

  const existing = await one("SELECT symbol FROM stock_cache WHERE symbol = ?", [symbol]);
  if (existing) {
    await run("UPDATE stock_cache SET quote_json = ?, updated_at = CURRENT_TIMESTAMP WHERE symbol = ?", [JSON.stringify(quote), symbol]);
  } else {
    await run("INSERT INTO stock_cache (symbol, quote_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)", [symbol, JSON.stringify(quote)]);
  }

  return { symbol, source: "finnhub", quote };
}

export async function searchLiveSymbols(query) {
  const q = String(query || "").trim();
  if (!q) return { source: "sample", results: searchStocks("").slice(0, 20) };

  try {
    if (!API_KEY) throw new Error("Missing FINNHUB_API_KEY");
    const data = await fetchJson(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${API_KEY}`);

    const liveResults = (data.result || []).slice(0, 20).map(item => ({
      symbol: item.symbol,
      name: item.description || item.displaySymbol || item.symbol,
      type: item.type || "Share",
      sector: "Live Search",
      price: null,
      rating: 0,
      risk: "Unknown",
      signal: "Research",
      summary: "Live Finnhub search result."
    }));

    const localResults = searchStocks(q);
    const merged = [...localResults];

    for (const item of liveResults) {
      if (!merged.some(x => x.symbol === item.symbol)) merged.push(item);
    }

    return { source: "finnhub", results: merged.slice(0, 30) };
  } catch (err) {
    console.error("Finnhub search failed:", err.message);
    return { source: "sample-fallback", results: searchStocks(q) };
  }
}

export async function getCompanyProfile(symbol) {
  symbol = normaliseSymbol(symbol);
  const cached = await one("SELECT * FROM stock_cache WHERE symbol = ?", [symbol]);

  if (cached?.profile_json && isFresh(cached.updated_at, 60 * 24)) {
    return { symbol, source: "cache", profile: JSON.parse(cached.profile_json) };
  }

  const profile = await fetchJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`);

  const existing = await one("SELECT symbol FROM stock_cache WHERE symbol = ?", [symbol]);
  if (existing) await run("UPDATE stock_cache SET profile_json = ?, updated_at = CURRENT_TIMESTAMP WHERE symbol = ?", [JSON.stringify(profile), symbol]);
  else await run("INSERT INTO stock_cache (symbol, profile_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)", [symbol, JSON.stringify(profile)]);

  return { symbol, source: "finnhub", profile };
}
