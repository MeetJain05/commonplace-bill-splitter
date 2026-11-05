# Commonplace — Shared Bill Splitter

A small household bill splitter built with Hono on Cloudflare Workers, D1 (SQLite), React, Vite, TanStack Router, and TypeScript.

## Run locally

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173>. Wrangler applies the D1 migrations when the API starts. The dev server proxies `/api` to `http://localhost:8787`.

```bash
pnpm test
pnpm check
pnpm typecheck
pnpm build
```

## API

- `POST /api/homes` — create a home.
- `POST /api/homes/:homeId/members` — add a member.
- `POST /api/homes/:homeId/bills` — split positive whole cents between current members.
- `GET /api/homes/:homeId/bills` — load bills and their shares for the web page.
- `POST /api/bills/:billId/shares/:shareId/pay` — pay a share using `Idempotency-Key`.
- `GET /api/homes/:homeId/balances` — list unpaid totals by member.

Money is stored as integer cents. Remainder cents go to the earliest added members. Payment is a conditional database update; retries with the same key return the original payment result.

## Decisions

1. **Store money as integer cents.** Integer arithmetic avoids rounding errors when splitting bills; all share amounts always sum to the original total.
2. **Use a conditional update for payment.** `paid_at IS NULL` lets the database choose one winner when two requests race, while the stored idempotency key makes retries safe.
3. **Keep the schema responsible for data invariants.** Named foreign keys, unique keys, and checks guard relationships and payment state even if a future route forgets validation.

## Assignment submission

Record a video of 3 minutes or less explaining the architecture, request/data flow, one trade-off, and the required edge cases. Share a link anyone with the link can view. The application form asks for the repository and video URLs, and for disclosure of AI tools used.
