import "dotenv/config";

const API_KEY = process.env.FINNHUB_API_KEY;

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Finnhub request failed: HTTP ${response.status}`);
  }

  return response.json();
}

export async function getMarketNews() {
  if (!API_KEY) {
    throw new Error("Missing FINNHUB_API_KEY");
  }

  const data = await fetchJson(
    `https://finnhub.io/api/v1/news?category=general&token=${API_KEY}`
  );

  return {
    source: "finnhub",
    articles: (data || []).slice(0, 15)
  };
}

export async function getCandles(symbol, days = 30) {
  if (!API_KEY) {
    throw new Error("Missing FINNHUB_API_KEY");
  }

  const now = Math.floor(Date.now() / 1000);
  const from = now - (days * 86400);

  const data = await fetchJson(
    `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${API_KEY}`
  );

  if (!data || data.s !== "ok") {
    return {
      symbol,
      points: []
    };
  }

  const points = data.t.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    close: data.c[i],
    high: data.h[i],
    low: data.l[i],
    open: data.o[i],
    volume: data.v[i]
  }));

  return {
    symbol,
    points
  };
}
