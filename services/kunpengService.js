import "dotenv/config";
import { findStock, searchStocks } from "./appService.js";
import { buildPriceHistory } from "./chartService.js";

const TOKEN = process.env.KUNPENG_TOKEN || process.env.KUNPENG_API_KEY || "";
const WS_URL = process.env.KUNPENG_WS_URL || "wss://ws.kun.pro/ws";

// Default market/exchange codes. Change these in .env if Kunpeng gives you different codes.
const AU_MARKET = process.env.KUNPENG_AU_MARKET || process.env.KUNPENG_MARKET_AU || "AU";
const ASX_EXCHANGE = process.env.KUNPENG_ASX_EXCHANGE || process.env.KUNPENG_EXCHANGE_ASX || "ASX";
const US_MARKET = process.env.KUNPENG_US_MARKET || process.env.KUNPENG_MARKET_US || "US";
const DEFAULT_US_EXCHANGE = process.env.KUNPENG_US_EXCHANGE || process.env.KUNPENG_EXCHANGE_US || "NASDAQ";

const NYSE_SYMBOLS = new Set([
  "BRK.B",
  "BRK-B",
  "IBM",
  "DIS",
  "KO",
  "MCD",
  "WMT",
  "JPM",
  "BAC",
  "V",
  "MA",
  "JNJ",
  "PG",
  "XOM",
  "CVX",
  "BA",
  "NKE"
]);

const NASDAQ_SYMBOLS = new Set([
  "AAPL",
  "MSFT",
  "TSLA",
  "NVDA",
  "GOOGL",
  "GOOG",
  "META",
  "AMZN",
  "NFLX",
  "AMD",
  "INTC",
  "ADBE",
  "COST",
  "PEP",
  "AVGO",
  "QCOM"
]);

function cleanSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function normaliseTickerForKunpeng(ticker) {
  // Many market APIs use BRK.B, but some use BRK-B. Keep BRK.B by default because
  // Kunpeng's docs only specify EXCHANGE:TICKER, not class-share punctuation rules.
  // Change here if Kunpeng confirms dash format is required.
  return cleanSymbol(ticker);
}

function inferUsExchange(ticker) {
  const clean = cleanSymbol(ticker);
  const overrideKey = `KUNPENG_EXCHANGE_${clean.replace(/[^A-Z0-9]/g, "_")}`;
  if (process.env[overrideKey]) return process.env[overrideKey];

  if (NYSE_SYMBOLS.has(clean)) return "NYSE";
  if (NASDAQ_SYMBOLS.has(clean)) return "NASDAQ";
  return DEFAULT_US_EXCHANGE;
}

export function getKunpengInstrument(symbol) {
  const raw = cleanSymbol(symbol);
  if (!raw) {
    return {
      appSymbol: "",
      market: AU_MARKET,
      exchange: ASX_EXCHANGE,
      ticker: "",
      symbol: ""
    };
  }

  // Already in Kunpeng EXCHANGE:TICKER format.
  if (raw.includes(":")) {
    const [exchangeRaw, tickerRaw] = raw.split(":");
    const exchange = cleanSymbol(exchangeRaw);
    const ticker = normaliseTickerForKunpeng(tickerRaw);
    const market = exchange === ASX_EXCHANGE ? AU_MARKET : US_MARKET;
    return {
      appSymbol: fromKunpengSymbol(raw),
      market,
      exchange,
      ticker,
      symbol: `${exchange}:${ticker}`
    };
  }

  // Australian/ASX app symbols use Yahoo-style .AX. Kunpeng wants ASX:IVV.
  if (raw.endsWith(".AX")) {
    const ticker = normaliseTickerForKunpeng(raw.replace(/\.AX$/, ""));
    return {
      appSymbol: raw,
      market: AU_MARKET,
      exchange: ASX_EXCHANGE,
      ticker,
      symbol: `${ASX_EXCHANGE}:${ticker}`
    };
  }

  // US symbols are not ASX. Use NASDAQ or NYSE based on known symbol mapping.
  const ticker = normaliseTickerForKunpeng(raw);
  const exchange = inferUsExchange(ticker);
  return {
    appSymbol: raw,
    market: US_MARKET,
    exchange,
    ticker,
    symbol: `${exchange}:${ticker}`
  };
}

export function toKunpengSymbol(symbol) {
  return getKunpengInstrument(symbol).symbol;
}

export function fromKunpengSymbol(symbol) {
  const s = cleanSymbol(symbol);
  if (!s.includes(":")) return s;
  const [exchange, ticker] = s.split(":");
  if ((exchange || "").toUpperCase() === ASX_EXCHANGE) return `${ticker}.AX`;
  return ticker || s;
}

export function getExchangeInfo(symbol) {
  const instrument = getKunpengInstrument(symbol);
  const ticker = instrument.ticker;
  const exchange = instrument.exchange;

  if (exchange === ASX_EXCHANGE) {
    return {
      exchange,
      market: instrument.market,
      label: `${ticker} on ASX`,
      exchangeName: "Australian Securities Exchange",
      exchangeHomeUrl: "https://www.asx.com.au/",
      quoteUrl: `https://www.google.com/finance/quote/${encodeURIComponent(ticker)}:ASX`,
      graphUrl: `https://www.google.com/finance/quote/${encodeURIComponent(ticker)}:ASX`
    };
  }

  if (exchange === "NASDAQ") {
    return {
      exchange,
      market: instrument.market,
      label: `${ticker} on NASDAQ`,
      exchangeName: "Nasdaq",
      exchangeHomeUrl: "https://www.nasdaq.com/",
      quoteUrl: `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(ticker.toLowerCase())}`,
      graphUrl: `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(ticker.toLowerCase())}`
    };
  }

  if (exchange === "NYSE") {
    return {
      exchange,
      market: instrument.market,
      label: `${ticker} on NYSE`,
      exchangeName: "New York Stock Exchange",
      exchangeHomeUrl: "https://www.nyse.com/",
      quoteUrl: `https://www.google.com/finance/quote/${encodeURIComponent(ticker)}:NYSE`,
      graphUrl: `https://www.google.com/finance/quote/${encodeURIComponent(ticker)}:NYSE`
    };
  }

  return {
    exchange,
    market: instrument.market,
    label: `${ticker} on ${exchange}`,
    exchangeName: exchange,
    exchangeHomeUrl: "#",
    quoteUrl: `https://www.google.com/finance/search?q=${encodeURIComponent(ticker + " " + exchange)}`,
    graphUrl: `https://www.google.com/finance/search?q=${encodeURIComponent(ticker + " " + exchange)}`
  };
}

export function getLocalProfile(symbol, stock = null) {
  const clean = cleanSymbol(symbol);
  const instrument = getKunpengInstrument(clean);
  const local = stock || findStock(clean) || {
    symbol: clean,
    name: clean,
    sector: "Market data",
    summary: "Kunpeng market data symbol."
  };

  const isAsx = instrument.exchange === ASX_EXCHANGE;
  const exchangeInfo = getExchangeInfo(clean);

  return {
    symbol: clean,
    kunpengSymbol: instrument.symbol,
    source: "local-profile",
    exchangeInfo,
    profile: {
      name: local.name || clean,
      country: isAsx ? "Australia" : "United States",
      currency: isAsx ? "AUD" : "USD",
      exchange: instrument.exchange,
      market: instrument.market,
      sector: local.sector || "Unknown"
    }
  };
}

export async function getLiveQuote(symbol) {
  // The supplied Kunpeng documentation is WebSocket realtime. This server-side
  // quote gives the page an immediate stable value; the browser WebSocket updates it live.
  const clean = cleanSymbol(symbol);
  const instrument = getKunpengInstrument(clean);
  const local = findStock(clean) || { price: 0 };
  const price = Number(local.price || 0);

  return {
    symbol: clean,
    kunpengSymbol: instrument.symbol,
    market: instrument.market,
    exchange: instrument.exchange,
    exchangeInfo: getExchangeInfo(clean),
    source: "local-until-kunpeng-websocket-tick",
    quote: {
      c: price,
      o: price,
      h: price,
      l: price,
      pc: price,
      ch: 0,
      chp: 0,
      t: Math.floor(Date.now() / 1000)
    }
  };
}

export async function searchLiveSymbols(query) {
  const q = String(query || "").trim();
  const results = searchStocks(q).map((s) => {
    const instrument = getKunpengInstrument(s.symbol);
    return {
      ...s,
      kunpengSymbol: instrument.symbol,
      market: instrument.market,
      exchange: instrument.exchange,
      exchangeInfo: getExchangeInfo(s.symbol),
      summary: s.summary || "Local symbol. Live prices update through Kunpeng WebSocket when opened."
    };
  });

  return { source: "local-symbols-kunpeng-ready", results };
}

export async function getCandles(symbol, days = 90) {
  // Supplied Kunpeng documentation covers realtime WebSocket ticks, not a historical
  // OHLC/candle REST endpoint. Seed the chart locally, then update the latest point
  // live when a WebSocket tick arrives.
  const clean = cleanSymbol(symbol);
  const instrument = getKunpengInstrument(clean);
  return {
    symbol: clean,
    kunpengSymbol: instrument.symbol,
    market: instrument.market,
    exchange: instrument.exchange,
    exchangeInfo: getExchangeInfo(clean),
    source: "local-history-plus-kunpeng-live-updates",
    message: `Graph seeded locally. Kunpeng live subscription will use ${instrument.market} / ${instrument.exchange} / ${instrument.symbol}.`,
    points: buildPriceHistory(clean, Number(days || 90)).map((p) => ({
      date: p.date,
      close: Number(p.price),
      price: Number(p.price)
    }))
  };
}

export async function getMarketNews() {
  return {
    source: "local",
    articles: [
      {
        headline: "Kunpeng realtime market data connected",
        summary: "News is local because the supplied Kunpeng documentation covers realtime prices, not a market news endpoint.",
        url: "#",
        datetime: Math.floor(Date.now() / 1000)
      }
    ]
  };
}

export function getKunpengClientConfig(symbol) {
  const clean = cleanSymbol(symbol);
  const instrument = getKunpengInstrument(clean);

  return {
    enabled: Boolean(TOKEN),
    wsUrl: WS_URL,
    token: TOKEN,
    market: instrument.market,
    exchange: instrument.exchange,
    ticker: instrument.ticker,
    symbol: instrument.symbol,
    exchangeInfo: getExchangeInfo(clean),
    replay: "last",
    appSymbol: clean,
    message: TOKEN
      ? `Kunpeng WebSocket config ready for ${instrument.market} / ${instrument.exchange} / ${instrument.symbol}.`
      : "Missing KUNPENG_TOKEN or KUNPENG_API_KEY in .env."
  };
}
