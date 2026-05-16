import "dotenv/config";
import { one, run } from "../db/db.js";
import { findStock, searchStocks } from "./appService.js";
import { buildPriceHistory } from "./chartService.js";

const API_KEY = process.env.KUNPENG_API_KEY || "";
const BASE_URL = (process.env.KUNPENG_BASE_URL || "").replace(/\/$/, "");
const CACHE_MINUTES = Number(process.env.MARKET_DATA_CACHE_MINUTES || 15);

function isConfigured() {
  return Boolean(API_KEY && BASE_URL);
}

function normaliseSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function isFresh(updatedAt, minutes = CACHE_MINUTES) {
  if (!updatedAt) return false;
  const updated = new Date(updatedAt).getTime();
  return Date.now() - updated < minutes * 60 * 1000;
}

function buildUrl(pathTemplate, params = {}) {
  if (!BASE_URL) throw new Error("Missing KUNPENG_BASE_URL");

  let path = pathTemplate;
  for (const [key, value] of Object.entries(params)) {
    path = path.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
  }

  const url = new URL(path.startsWith("http") ? path : `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);

  if (!url.searchParams.has("apikey") && !url.searchParams.has("api_key") && !url.searchParams.has("token")) {
    url.searchParams.set(process.env.KUNPENG_KEY_PARAM || "apikey", API_KEY);
  }

  for (const [key, value] of Object.entries(params)) {
    if (!url.search.includes(`{${key}}`) && !url.searchParams.has(key)) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      ...(process.env.KUNPENG_AUTH_HEADER ? { [process.env.KUNPENG_AUTH_HEADER]: API_KEY } : {})
    }
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!response.ok) {
    const message = data?.message || data?.error || data?.raw || `HTTP ${response.status}`;
    throw new Error(`Kunpeng Data request failed: ${message}`);
  }

  if (data?.error) throw new Error(`Kunpeng Data error: ${data.error}`);
  if (data?.message && String(data.message).toLowerCase().includes("error")) {
    throw new Error(`Kunpeng Data error: ${data.message}`);
  }

  return data;
}

function numberFrom(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function mapQuote(symbol, data) {
  const src = data?.quote || data?.data || data?.result || data || {};
  const price = numberFrom(src.c, src.price, src.last, src.close, src.current, src.latestPrice, src.lastPrice);
  const previous = numberFrom(src.pc, src.previousClose, src.prevClose, src.previous, src.open);

  return {
    c: price ?? 0,
    o: numberFrom(src.o, src.open, price) ?? 0,
    h: numberFrom(src.h, src.high, price) ?? 0,
    l: numberFrom(src.l, src.low, price) ?? 0,
    pc: previous ?? price ?? 0,
    t: numberFrom(src.t, src.timestamp, Date.now() / 1000) ?? Math.floor(Date.now() / 1000)
  };
}

function localQuote(symbol) {
  const fallback = findStock(symbol);
  const price = Number(fallback?.price || 100);
  return {
    symbol,
    source: "local-fallback",
    quote: { c: price, h: price, l: price, o: price, pc: price, t: Math.floor(Date.now() / 1000) }
  };
}

export async function getLiveQuote(symbol) {
  symbol = normaliseSymbol(symbol);

  const cached = await one("SELECT * FROM stock_cache WHERE symbol = ?", [symbol]);
  if (cached?.quote_json && isFresh(cached.updated_at)) {
    return { symbol, source: "cache", quote: JSON.parse(cached.quote_json) };
  }

  if (!isConfigured()) return localQuote(symbol);

  try {
    const path = process.env.KUNPENG_QUOTE_PATH || "/quote?symbol={symbol}";
    const data = await fetchJson(buildUrl(path, { symbol }));
    const quote = mapQuote(symbol, data);

    const existing = await one("SELECT symbol FROM stock_cache WHERE symbol = ?", [symbol]);
    if (existing) {
      await run("UPDATE stock_cache SET quote_json = ?, updated_at = CURRENT_TIMESTAMP WHERE symbol = ?", [JSON.stringify(quote), symbol]);
    } else {
      await run("INSERT INTO stock_cache (symbol, quote_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)", [symbol, JSON.stringify(quote)]);
    }

    return { symbol, source: "kunpeng", quote };
  } catch (err) {
    console.error(`Kunpeng quote unavailable for ${symbol}. Using local fallback. Reason: ${err.message}`);
    return localQuote(symbol);
  }
}

export async function searchLiveSymbols(query) {
  const q = String(query || "").trim();
  if (!q) return { source: "local", results: searchStocks("").slice(0, 20) };

  if (!isConfigured()) return { source: "local-fallback", results: searchStocks(q) };

  try {
    const path = process.env.KUNPENG_SEARCH_PATH || "/search?q={q}";
    const data = await fetchJson(buildUrl(path, { q }));
    const list = data?.results || data?.data || data?.items || data?.symbols || [];

    const liveResults = list.slice(0, 20).map(item => ({
      symbol: normaliseSymbol(item.symbol || item.code || item.ticker),
      name: item.name || item.description || item.displayName || item.symbol || "Unknown",
      type: item.type || "Share",
      sector: item.sector || "Live Search",
      price: null,
      rating: 0,
      risk: "Unknown",
      signal: "Research",
      summary: "Live market data search result."
    })).filter(item => item.symbol);

    const localResults = searchStocks(q);
    const merged = [...localResults];
    for (const item of liveResults) {
      if (!merged.some(x => x.symbol === item.symbol)) merged.push(item);
    }

    return { source: "kunpeng", results: merged.slice(0, 30) };
  } catch (err) {
    console.error("Kunpeng search unavailable. Using local fallback. Reason:", err.message);
    return { source: "local-fallback", results: searchStocks(q) };
  }
}

export function getCompanyProfile(symbol) {
  symbol = normaliseSymbol(symbol);
  const local = findStock(symbol);
  const isAsx = symbol.endsWith(".AX") || /^[A-Z0-9]{2,6}$/.test(symbol);

  return {
    symbol,
    source: "local",
    profile: {
      name: local?.name || symbol,
      country: isAsx ? "Australia" : "Unknown",
      currency: isAsx ? "AUD" : "USD",
      exchange: isAsx ? "ASX" : "Unknown"
    }
  };
}

function mapCandlePoints(data) {
  const rows = data?.points || data?.candles || data?.values || data?.data || data?.results || [];
  if (!Array.isArray(rows)) return [];

  return rows.map(row => ({
    date: row.date || row.datetime || row.time || (row.timestamp ? new Date(Number(row.timestamp) * 1000).toISOString().slice(0, 10) : ""),
    open: numberFrom(row.open, row.o),
    high: numberFrom(row.high, row.h),
    low: numberFrom(row.low, row.l),
    close: numberFrom(row.close, row.c, row.price, row.value),
    volume: numberFrom(row.volume, row.v)
  })).filter(row => row.date && Number.isFinite(row.close));
}

function localCandles(symbol) {
  return {
    symbol,
    source: "local-fallback",
    points: buildPriceHistory(symbol).map(point => ({
      date: point.date,
      open: point.price,
      high: point.price,
      low: point.price,
      close: point.price,
      volume: null
    }))
  };
}

export async function getCandles(symbol, days = 90) {
  symbol = normaliseSymbol(symbol);

  if (!isConfigured()) return localCandles(symbol);

  try {
    const path = process.env.KUNPENG_CANDLES_PATH || "/candles?symbol={symbol}&interval=1day&days={days}";
    const data = await fetchJson(buildUrl(path, { symbol, days }));
    const points = mapCandlePoints(data);

    if (!points.length) throw new Error("No candle points returned");

    return { symbol, source: "kunpeng", points };
  } catch (err) {
    console.error(`Kunpeng candles unavailable for ${symbol}. Using local fallback. Reason: ${err.message}`);
    return localCandles(symbol);
  }
}

export async function getMarketNews() {
  if (!isConfigured()) {
    return {
      source: "local-fallback",
      articles: [
        { headline: "Market data provider not configured", summary: "Add KUNPENG_API_KEY and KUNPENG_BASE_URL to enable live market news.", url: "#", datetime: Math.floor(Date.now() / 1000) }
      ]
    };
  }

  try {
    const path = process.env.KUNPENG_NEWS_PATH || "/news";
    const data = await fetchJson(buildUrl(path, {}));
    const articles = data?.articles || data?.news || data?.data || data?.results || [];
    return { source: "kunpeng", articles: articles.slice(0, 15) };
  } catch (err) {
    console.error("Kunpeng news unavailable. Using local fallback. Reason:", err.message);
    return {
      source: "local-fallback",
      articles: [
        { headline: "Live news unavailable", summary: "The app is running with local fallback data.", url: "#", datetime: Math.floor(Date.now() / 1000) }
      ]
    };
  }
}
