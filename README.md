# Tiffin House – Multi-Branch Restaurant Billing

Restaurant billing and management for several restaurants and branches.

- **client/** – React + Vite (TypeScript)
- **server/** – Node.js + Express + MongoDB/Mongoose (TypeScript)
- **shared/** – validation schemas, money maths and API types used by both
- **docs/** – [UI reference inventory](docs/UI_REFERENCE_INVENTORY.md), [database schema](docs/DATABASE_SCHEMA.md), [API](docs/API_DOCUMENTATION.md), [architecture decisions](docs/ARCHITECTURE.md), [testing checklist](docs/TESTING_CHECKLIST.md)

There are exactly two roles:

| Role | Can do |
|---|---|
| **Super Admin** | Restaurants, branches, Restaurant Admin accounts and assignments, shared and branch menus, all transactions, reports (CSV), analytics, audit log |
| **Restaurant Admin** | Exactly **one** branch (branches are fully isolated): New Bill, table billing, menu (branch items, branch prices/availability/photos), transactions, void/refund with reason |

## Requirements

- Node.js 20.19 or newer (tested on 24)
- A MongoDB database – MongoDB Atlas (free tier is fine) recommended, see below

## Quick start

```bash
npm install
cp .env.example .env          # then edit .env (MONGODB_URI and JWT_SECRET)
npm run setup:superadmin      # create the first Super Admin (prompts for details)
npm run seed:demo             # optional: demo restaurant, menu, tables and a Restaurant Admin
npm run dev                   # API on :4000, web app on http://localhost:5173
```

Generate a `JWT_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Trying it without a database:** set `MONGODB_URI=memory` in `.env`. The server then starts a
local MongoDB replica set and keeps its data in `server/.data/` (development only; the first
start downloads the MongoDB binary, ~600 MB). Because the setup scripts need the same
database, run `npm run dev` first and point the scripts at it:

```bash
MONGODB_URI="mongodb://127.0.0.1:27027/restaurant_billing?replicaSet=rb-dev&directConnection=true" npm run setup:superadmin
```

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | shared types (watch) + API (`tsx watch`) + Vite dev server |
| `npm run build` | builds shared, server (`server/dist`) and client (`client/dist`) |
| `npm start` | runs the built API (`server/dist/server.js`) |
| `npm run lint` | ESLint over the whole repo (zero warnings allowed) |
| `npm run typecheck` | TypeScript checks for all packages |
| `npm test` | shared money tests, server integration tests (in-memory replica set), client sync-engine tests |
| `npm run setup:superadmin` | create a Super Admin (`-- --reset-password` to reset one) |
| `npm run seed:demo` | demo data (refuses to run in production; creates no sales) |

## Getting a MongoDB URL (MongoDB Atlas)

1. Go to <https://www.mongodb.com/cloud/atlas/register> and create a free account.
2. **Create a cluster** → choose the free **M0** tier and a region close to your restaurants (e.g. Mumbai `ap-south-1`).
3. **Database Access** → *Add New Database User* → username + a strong password (role: *Read and write to any database*).
4. **Network Access** → *Add IP Address* → add the public IP of the machine running the server
   (for a quick test you can use *Allow access from anywhere* `0.0.0.0/0`, but restrict it before going live).
5. **Database → Connect → Drivers** → copy the connection string. It looks like
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Add the database name `restaurant_billing` after `.net/` and put your real password in:
   `mongodb+srv://billing:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/restaurant_billing?retryWrites=true&w=majority`
7. Paste it into `.env` as `MONGODB_URI=...` (special characters in the password such as `@ : / ?` must be URL-encoded).

Keep this string private – put it only in `.env`, never in chat, code or git.

**Troubleshooting `querySrv ECONNREFUSED`:** some Windows setups (VPNs, antivirus or local DNS
proxies) block the DNS lookup that `mongodb+srv://` needs. Use the standard form instead – the hosts
come from `nslookup -type=SRV _mongodb._tcp.<cluster-host>` and the replica set from
`nslookup -type=TXT <cluster-host>`:
`mongodb://USER:PASSWORD@host-00:27017,host-01:27017,host-02:27017/restaurant_billing?ssl=true&replicaSet=<name>&authSource=admin&retryWrites=true&w=majority`
Atlas clusters are replica sets, so multi-document transactions (used when generating bills)
are enabled automatically.

## How billing works

- **New Bill** (counter/takeaway): each admin has one open counter bill per branch, saved in MongoDB.
- **Tables**: a table can seat several **groups**; each group has its own open bill. Seats in use are
  derived from the open groups (Available → Partially Occupied → Full). Reserved tables must be marked
  available before seating guests.
- Every change to an open bill is applied on screen immediately and saved to MongoDB within ~0.3 s.
  Bills survive table switching, page changes, refreshes and closing the browser. If the server is
  unreachable the top bar shows *“not saved – retrying”* and the change is retried automatically; the
  browser warns before closing with unsaved changes.
- Two admins editing the same bill cannot overwrite each other: the second one gets a conflict
  message and sees the latest version.
- **Generate Bill** re-prices everything from the server-side menu, computes taxes on the server, gives
  the bill a sequential number per branch (`B00001`…), stores immutable item/price snapshots and closes
  the open bill. Repeated clicks return the same bill (idempotency key + unique indexes).
- Taxes are **off until configured** by the Super Admin per restaurant (Restaurant → *Taxes & Receipt*).
- Completed bills are never edited or deleted. Corrections use **Void** or **Refund** with a reason,
  both recorded in the audit log and excluded from sales.

## Receipt printing

*Print Bill* opens a receipt page sized for **80 mm thermal printers** and calls the browser’s print
dialog. Printing reads the stored bill and never creates a new one.

- Install the printer’s driver on the billing computer and set it as the default printer.
- In Chrome/Edge print settings choose the thermal printer, *Margins: None*, and untick *Headers and footers*.
- For one-click printing in Chrome you can start it with `--kiosk-printing` (prints to the default printer without the dialog).
- 58 mm printers work but long item names wrap; there is no direct ESC/POS (USB/serial) integration – printing goes through the browser.

## Deployment

**Vercel (this repository is set up for it – `vercel.json` + `api/index.js`):**

Vercel serves the built React app as static files and runs the Express API as one serverless
function (`/api/*` and `/uploads/*`). Menu photos are stored in MongoDB (`IMAGE_STORAGE=mongo`),
because Vercel has no persistent disk.

1. In the Vercel project: **Settings → General → Root Directory** must be the repository root
   (empty), Framework Preset *Other*. Build/output settings come from `vercel.json`.
2. **Settings → Environment Variables** (Production and Preview):

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `MONGODB_URI` | your Atlas connection string (the `mongodb+srv://…` form works on Vercel) |
   | `JWT_SECRET` | a new long random secret (do not reuse the development one) |
   | `APP_TIMEZONE` | `Asia/Kolkata` |
   | `TRUST_PROXY` | `1` |
   | `IMAGE_STORAGE` | `mongo` |

   Optional demo buttons on the login page (they fill the form): `VITE_DEMO_SUPERADMIN_EMAIL`,
   `VITE_DEMO_SUPERADMIN_PASSWORD`, `VITE_DEMO_BRANCH_EMAIL`, `VITE_DEMO_BRANCH_PASSWORD`. These end up
   in the public web page, so use them only for demo accounts and delete them (then redeploy) after
   the demo. Locally they go in `client/.env.local` (gitignored).

3. **MongoDB Atlas → Network Access → Add IP Address → Allow access from anywhere (`0.0.0.0/0`)** –
   Vercel functions do not have fixed IP addresses. Keep the database user's password strong.
4. Push to the connected branch; Vercel builds and deploys automatically.
5. Photos uploaded earlier to a local `server/uploads` folder can be copied into MongoDB with
   `npm run images:migrate` (run locally with the production `MONGODB_URI`).

Notes: the login rate limit is kept in memory per function instance, so it is weaker on serverless
than on a single server; the first request after idle time is slower (cold start + DB connect).

**Single server:**

1. `npm ci && npm run build`
2. Set environment variables (see `.env.example`): `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET`,
   `SERVE_CLIENT=true`, `CORS_ORIGINS=https://your-domain`, and `TRUST_PROXY=1` behind a reverse proxy.
3. `npm start` – Express serves the API at `/api/v1` and the React app for every other path.
4. Put it behind HTTPS (Nginx/Caddy or a platform such as Render/Railway). Session cookies are
   `Secure` in production, so HTTPS is required.
5. Run `npm run setup:superadmin` once against the production database.

**Photos:** stored in MongoDB by default (`IMAGE_STORAGE=mongo`). With `IMAGE_STORAGE=local` they are
written to `server/uploads` (or `UPLOAD_DIR`), which needs a persistent disk. Object storage (S3, GCS,
Cloudinary) can be added as another driver in `server/src/services/storage.service.ts`.

**Backups:** enable Atlas backups; transactions and audit logs are the financial record.

## Known limitations

- Split payments and partial payments are not supported (one payment method per bill, paid in full).
- No offline mode: bills need a connection to be saved (unsaved edits are kept in the open tab and retried).
- One currency (₹) and one reporting time zone (`APP_TIMEZONE`) for the whole installation.
- Uploaded images are never deleted automatically (old bills may reference them).
- The UI was built against the reference images and checked through builds and API tests; it has not
  been through a pixel-level visual review in a browser yet – see the manual items in `docs/TESTING_CHECKLIST.md`.
- This is not yet production-hardened (no monitoring, no load testing, no external security audit).
