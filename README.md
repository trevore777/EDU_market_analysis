# Simple Shares App - Stage 10 Finnhub

Complete replacement files for Stage 10.

## New Stage 10 Features

- Finnhub live symbol search
- Finnhub live quote endpoint
- Finnhub company profile endpoint
- Turso stock quote cache
- Sandbox fake trades use live quote when available
- Fallback sample data if Finnhub fails/rate-limits
- Existing sandbox, charts and guided prompts retained

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Set `.env`:

```env
PORT=3000
COOKIE_SECRET=make_this_long_and_random
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-token
FINNHUB_API_KEY=your-finnhub-key
NODE_ENV=development
```

## Test

```text
http://localhost:3000/health
http://localhost:3000/api/live-quote/AAPL
http://localhost:3000/api/live-search?q=apple
```

## Render

Build Command:

```bash
npm install --include=prod --no-audit --no-fund && ls node_modules/express
```

Start Command:

```bash
npm start
```

Environment variables:

```env
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
COOKIE_SECRET
FINNHUB_API_KEY
NODE_ENV=production
```

Educational sandbox only. No real trades. Not financial advice.
