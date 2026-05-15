# Simple Shares App - Stage 9 Full

This is a complete replacement version, not just snippets.

## Features

- Turso/libSQL database
- Vercel-ready setup
- Render-compatible Node app
- Login/register
- Sandbox paper trading
- Virtual cash
- Fake buy/sell trades
- Persistent paper holdings
- Trade history
- Share search
- Guided AI prompt dropdowns
- Compare two shares/ETFs
- Add searched share to watchlist
- Fake buy searched share
- Share price charts
- Sandbox portfolio graph
- `/health` database test route

## Local setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```env
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-token
COOKIE_SECRET=make_this_long_and_random
```

Run:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Demo login

The app creates this demo user automatically:

```text
demo@shares.app
demo123
```

## Vercel

Use the included `vercel.json`.

Set environment variables:

```env
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
COOKIE_SECRET
```

If Vercel keeps showing a warning about `builds`, your deployed repository still has an old `vercel.json`.

## Render

Settings:

```text
Environment: Node
Build Command: npm install
Start Command: npm start
```

Environment variables:

```env
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
COOKIE_SECRET
NODE_ENV=production
```

## Important

This is an educational sandbox. It does not place real trades and does not provide personal financial advice.

The search is currently based on the expanded local sample database. Later you can connect Finnhub, Twelve Data, Alpha Vantage, or Polygon for live external search.
