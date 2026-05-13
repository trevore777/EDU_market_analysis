# Simple Shares App - Stage 7

Stage 7 converts the app from local SQLite to Turso/libSQL so it can deploy properly on Vercel.

## Features

- Vercel-ready Express export
- Turso/libSQL database
- Automatic schema migration
- Demo user creation
- Login/register
- Sandbox paper trading
- Virtual cash
- Fake buy/sell trades
- Persistent paper holdings
- Trade history
- AI coach prototype
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

Then deploy from GitHub or run:

```bash
vercel
```

## Turso CLI quick commands

```bash
brew install tursodatabase/tap/turso
turso auth signup
turso db create simple-shares
turso db show simple-shares
turso db tokens create simple-shares
```

Use the database URL and token in Vercel.

## Important

This is a sandbox simulation. It does not place real trades and does not provide personal financial advice.
