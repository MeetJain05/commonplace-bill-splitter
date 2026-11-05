# Commonplace

Commonplace helps people sharing a home keep track of household bills. Add your housemates, enter a bill, and the app splits the cost into individual shares. When a share is marked paid, the balances update to show what remains outstanding.

## How it works

The web app is built with React, TypeScript, Vite, and TanStack Router. It talks to a Hono API running on a Cloudflare Worker. The API stores homes, members, bills, and shares in D1, Cloudflare's SQLite database. SQL migrations create and update the database schema.

Money is stored as whole cents, so each split stays precise. If a bill does not divide evenly, leftover cents go to the earliest-added members. Bill and share records are saved together, and database constraints help keep their relationships consistent.

Marking a share paid uses a conditional database update and an idempotency key. This makes retries safe and ensures competing requests cannot record the same share as paid twice. It records payment status in the app; it does not transfer real money.

## Run locally

You will need Node.js and pnpm installed. From the project root, install the dependencies and start both the API and the web app:

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173> in your browser. The web server forwards `/api` requests to the local API at `http://localhost:8787`. When the API starts, Wrangler applies the D1 migrations to its local database.

If your terminal says `pnpm` is not recognized, run `npm install --global pnpm`, then open a new terminal and try again.

## Useful commands

Run these from the project root:

```bash
pnpm test       # Run the API tests
pnpm check      # Check formatting and code style
pnpm typecheck  # Type-check the API and web app
pnpm build      # Build the web app for production
```

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/homes` | Create a home |
| `POST` | `/api/homes/:homeId/members` | Add a member to a home |
| `POST` | `/api/homes/:homeId/bills` | Create a bill and split it between current members |
| `GET` | `/api/homes/:homeId/bills` | Get the home's bills and shares |
| `POST` | `/api/bills/:billId/shares/:shareId/pay` | Mark a share paid; requires an `Idempotency-Key` header |
| `GET` | `/api/homes/:homeId/balances` | Get each member's unpaid total |
| `GET` | `/api/health` | Check that the API is responding |

## Design choices

- **Use integer cents for money.** This avoids decimal rounding and ensures the shares add up to the bill total.
- **Make payment updates conditional.** The database changes only a share that is still unpaid. An idempotency key lets the API return the original result when a request is retried.
- **Enforce important rules in the database.** Foreign keys, unique constraints, and checks protect the data even if another part of the app misses a validation step.
