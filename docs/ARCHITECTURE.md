# Architecture & Decisions

## Layout

```
shared/   zod schemas, constants, money maths, DTO types  (compiled to shared/dist, used by both sides)
server/   Express API: config → middleware → routes → controllers → services → models
client/   React SPA: layouts, pages (auth / restaurant / admin), components, store, services, hooks
```

The server is the only place with business rules. Controllers only parse input (`parse(schema, body)`)
and call services; services enforce scope, compute totals and write audit logs.

## Security model

- Sessions: signed JWT (HS256) in an `httpOnly`, `SameSite=Strict` cookie. Every request reloads the
  user from MongoDB, so deactivation, reassignment and password resets take effect immediately
  (`tokenVersion` revokes old sessions).
- CSRF: SameSite cookie + mandatory `X-Requested-With: rb-client` header + Origin check.
- Roles: `SUPER_ADMIN`, `RESTAURANT_ADMIN` and `KITCHEN`; the `role` field is `immutable` in Mongoose.
  The Super Admin's user form can only create `RESTAURANT_ADMIN` or `KITCHEN`; Super Admins are created
  only by the CLI script. A `KITCHEN` login is refused by `authenticate` on every route except `/auth/*`
  and `/kitchen/*` (deny by default), and works one branch's Kitchen Display only.
- Scope: `requireBranchScope` / `requireMenuScope` resolve the branch from the `X-Branch-Id` header and
  verify the user is assigned to it and that branch + restaurant are active. Every query is additionally
  filtered by `branchId` / `restaurantId`, so a guessed id from another branch returns 404/403.
- Unknown body fields are rejected (strict schemas) – clients cannot send prices, totals or roles.
- Login rate limiting (failed attempts only), general API rate limit, Helmet headers and CSP,
  100 kB JSON limit, image uploads verified by magic bytes (JPEG/PNG/WebP, ≤ 2 MB, random file names,
  served with `nosniff` and `default-src 'none'`).
- Errors: one handler maps known errors to `{ error: { code, message } }`; 500s are logged server-side only.

## Money

Integer paise and basis points everywhere (`shared/src/money.ts`). The same `calculateBill()` runs on the
client for the instant preview and on the server as the authority. Discounts are applied before tax and
spread proportionally over taxable/non-taxable lines; tax is rounded half-up once per component.
Inclusive-tax restaurants get the tax extracted from the price instead of added.

## Open bills (drafts) and persistence

- Drafts live in MongoDB (`drafts` collection), one per table group or per admin counter.
- The client's `DraftSync` engine (`client/src/store/draftSync.ts`) applies edits locally, debounces
  saves (350 ms), sends `{ version, items:[{menuItemId, quantity}] }`, and adopts the server's re-priced
  draft. Engines live outside React in a registry, so navigating away never cancels a save; they are
  dropped only when nothing is pending. Network failures retry with back-off; `beforeunload` warns when
  something is unsaved.
- Optimistic concurrency: `findOneAndUpdate({ _id, version })` + `$inc version`. A stale write gets
  `409 CONFLICT` with the current draft, which the UI displays instead of overwriting.
- We chose full-state saves with versions (rather than per-item operations) because they make
  conflicts explicit, which the specification asks for.

## Table occupancy

Seats in use are derived from active drafts instead of being stored, so the table can never disagree
with its bills. Group creation runs in a transaction and bumps `tables.version`, which serialises
concurrent "add group" calls so the last seat cannot be sold twice (tested with parallel requests).
A table is released automatically when its last group is billed or deleted.

## Finalisation

`POST /bills/:id/finalize` (in a MongoDB transaction when available):
1. replay check by idempotency key;
2. load the draft, verify version, non-empty, all items available;
3. re-price from the menu, compute totals;
4. claim the draft (`ACTIVE → FINALIZED` with version check);
5. take the next bill number from `counters` (inside the transaction → no gaps on rollback);
6. insert the immutable transaction with snapshots; write the audit entry.

Duplicate protection does not depend on transactions alone: `transactions.sourceDraftId` and
`(branchId, idempotencyKey)` are unique, and a duplicate-key race returns the existing bill. On a
standalone MongoDB (no transactions) the claim is reverted if the insert fails.

## Menu scope

`branchId = null` = shared menu (Super Admin, restaurant scope). Branches see shared + their own items.
Branch edits to a shared item can only change price/availability and are stored as
`branchOverrides[]` on the item; everything else on shared items is managed in restaurant scope. Items
are archived, never deleted.

## Reporting

Analytics run as one `$facet` aggregation over `transactions` (indexed by `status, finalizedAt` and
`branchId/restaurantId, finalizedAt`), grouped by day/month in `APP_TIMEZONE`. Only `COMPLETED` bills are
revenue; voided/refunded are reported separately. Ranges are capped at two years; days/months without
sales are filled with zeros on the server.

## UI decisions (see UI_REFERENCE_INVENTORY.md)

- Layout follows the six reference images; colours/font come from the logo theme (`client/src/styles/theme.css`).
- Restaurant Admin navigation omits Reports/Analytics (role rule overrides the image).
- "Partially occupied" uses brand amber instead of the image's blue.
- Payment buttons: UPI, Cash and Card; split payments are not implemented.
- Food images are optional; a consistent placeholder is shown when missing.
