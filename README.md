# Simple Shares App - Stage 8

Stage 8 adds charts and graphing to the Turso/Vercel-ready sandbox app.

## Features

- Vercel-ready Express app
- Turso/libSQL database
- Login/register
- Sandbox paper trading
- Virtual cash
- Fake buy/sell trades
- Persistent paper holdings
- Trade history
- Share price history charts
- Sandbox portfolio value chart
- Fake trade markers on charts
- Health endpoint at `/health`

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

Then run:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Demo login

The migration creates this user automatically:

```text
demo@shares.app
demo123
```

## Vercel deployment

Add these environment variables in Vercel:

```env
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
COOKIE_SECRET
```

## Important

This is a sandbox simulation. It does not place real trades and does not provide personal financial advice.

The chart data is currently generated sample-history data based on the app's sample prices. Later, this can be replaced with live historical data from Finnhub, Twelve Data, Alpha Vantage, Polygon, or another market-data provider.
