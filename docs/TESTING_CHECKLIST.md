# Testing Checklist

Automated tests run with `npm test` (Vitest). Server integration tests start an in-memory
MongoDB **replica set** (`mongodb-memory-server`), so multi-document transactions are
exercised. They never touch a real database.

Legend: **[A]** automated test, **[M]** manual check in the browser.

## Last run – 25 Oct 2026

| Suite | Result |
|---|---|
| `shared` money library | 10 / 10 passed |
| `server` integration (auth, admin, menu, billing, tables, transactions, analytics, security) | 85 / 85 passed |
| `client` draft sync engine (debounce, flush, conflict, offline retry) | 6 / 6 passed |
| `npm run typecheck`, `npm run lint`, `npm run build` | clean |
| Live end-to-end over HTTP against the built server (single-server mode) | table switch → fresh login → finalise → duplicate click → table released → takeaway bill → RA analytics 403 → SA analytics totals: all as expected |

All **[A]** items below are covered by those suites. **[M]** items still need a person in a browser.

## Authentication
- [A] Super Admin login succeeds
- [A] Restaurant Admin login succeeds
- [A] Wrong password / unknown email → 401 with the same message
- [A] Inactive user cannot log in; deactivation kills existing sessions
- [A] Requests without a session → 401
- [A] Mutating requests without `X-Requested-With` → 403
- [A] Login rate limiting → 429
- [A] Role cannot be changed through any user endpoint (unknown fields rejected)

## Super Admin
- [A] Create restaurant; duplicate name rejected
- [A] Create multiple branches; duplicate branch code rejected
- [A] Create Restaurant Admin assigned to branches; reassign; deactivate
- [A] Branch isolation – admin of A1 cannot read A2 data
- [A] Analytics overview only for Super Admin; numbers match the created transactions
- [A] Voided transactions are excluded from revenue
- [A] CSV exports honour filters

## Restaurant Admin
- [A] Can only use assigned branches; inactive branch/restaurant → 403
- [A] Creates categories and items in branch scope
- [A] Cannot edit shared item name; price/availability change becomes a branch override
- [A] Cannot reach `/admin/*` (403)

## Menu
- [A] Duplicate category names rejected in the same scope
- [A] Required fields validated; negative / fractional-paise prices rejected
- [A] Unavailable item cannot be added to a bill
- [A] Image upload: valid PNG accepted; fake image (wrong magic bytes) rejected; size limit

## Billing
- [A] Shared money library: subtotal, percent / flat discount, exclusive & inclusive tax, rounding
- [A] Server ignores client prices; totals recomputed from the menu
- [A] Add / change quantity / remove items
- [A] Finalise creates a transaction with snapshots and sequential bill number
- [A] Double finalise (same key, and concurrent calls) → exactly one transaction
- [A] Changing a menu price after billing does not change the transaction

## Table persistence (exact sequence from the spec)
- [A] Open Table 1, add two items
- [A] Switch to Table 2, add three items
- [A] Return to Table 1 – the two items are still there
- [A] "Refresh" (new request, nothing cached) – Table 1 draft still there
- [A] Table 2 still has its three items
- [A] Finalise Table 1 → transaction created, draft `FINALIZED`, table released
- [A] Draft deletion (does not affect transactions, audit logged)
- [A] Concurrent edit with a stale version → 409 with the latest draft
- [A] Seats: a group larger than the free seats is rejected
- [M] Browser: switch tables quickly, refresh mid-edit, close and reopen the browser – drafts restored
- [M] Browser: stop the server, add an item → "Not saved – retrying" indicator; restart → saved

## Transactions
- [A] Search by bill number
- [A] Date filter
- [A] Pagination metadata
- [A] Historical prices preserved
- [A] Restaurant / branch isolation
- [A] Void / refund workflow writes audit logs and rejects a second change
- [A] Bill edit within 30 minutes re-prices on the server, keeps the old version, logs it; stale copy, voided bill, other branch and after-30-minutes edits (Restaurant Admin) are refused; the Super Admin can edit any time and existing lines keep their billed price
- [M] Transactions → open a bill made in the last 30 minutes → "Edit bill (N min left)" → add/remove food, change payment → Save; list shows "Edited", receipt shows "Revised"

## Security
- [A] Restaurant Admin → analytics API 403
- [A] Restaurant Admin → create restaurant / branch 403
- [A] Restaurant Admin → create users 403
- [A] Cannot read or modify another branch's drafts, tables, transactions
- [A] Super Admin cannot be created through the API

## UI (manual, compare with `docs/ui-reference/`)
- [M] New Bill matches image 4 (cards left, bill right)
- [M] Menu matches image 5
- [M] Tables grid + Add Table panel match images 2 and 6
- [M] Table group panel matches image 1
- [M] Transactions + Bill Details match image 3
- [M] Receipt prints on 80 mm paper (browser print dialog)
