# UI Reference Inventory

The inspiration images were supplied as `1.png` … `6.png`. Copies live in
[`docs/ui-reference/`](ui-reference/) with descriptive names; the originals were not
modified. The images define **layout and structure**; colours and font come from the
theme configuration (see "Theme" below).

## Shared shell (all images)

| Element | Reference | Implementation |
|---|---|---|
| Left sidebar | Logo top-left, vertical nav with outline icons, active item uses a tinted pill | `client/src/layouts/AppLayout.tsx` |
| Top bar | Wide rounded search field, user avatar + name + chevron on the right | `client/src/components/Topbar.tsx` – placeholder text changes per page |
| Page header | Large bold title + muted subtitle, actions aligned right | `PageHeader` component |
| Right side panel | White rounded panel with title + close (X) | `SidePanel` component |

Sidebar order in the images: **New Bill, Menu, Transactions, Reports, Tables, Analytics**.

Decision (role rules override the image): Restaurant Admins may not see business
analytics, so their sidebar shows **New Bill, Menu, Transactions, Tables**. The Super
Admin uses the same shell with **Restaurants, Admins, Menu, Transactions, Reports,
Analytics, Audit Log**.

## Image 1 – `1-tables-group-panel.png` → Tables page with table detail panel

- Status legend (Available / Partially Occupied / Full / Reserved), floor dropdown, 4-column grid of table cards.
- Selected table opens a right panel: "Table T02", capacity, "2 / 4 Seats Used" chip.
- **Each table can hold several groups.** A group card shows icon, name, people count, a tag (Family/Friends), the running amount, thumbnails of ordered items (+N), **Add Items** and **Generate Bill**.
- Dashed **Add New Group (n seats available)** button; footer "Available Seats: n".

Interactions implemented:
- Click a table → loads its groups (active drafts) from MongoDB.
- Add New Group → name, guest count (limited to free seats), optional tag → creates a persisted draft.
- Add Items → opens the New Bill screen bound to that group's draft.
- Generate Bill → payment-method dialog → server finalises the draft into a transaction.
- Delete group draft (with confirmation when non-empty).

## Image 2 – `2-tables-grid.png` → Tables page (default state)

- Header row: title/subtitle, **Ground Floor** dropdown, **Add Table** primary button.
- Table card: label, seat count, top-down table illustration (square or round) with chairs, status pill (`Available`, `2 / 4 Seats`, `Full`, `Reserved`). Card background tinted by status.

Interactions: floor filter, top-bar search filters tables by label, click a card → Image 1 panel.

## Image 3 – `3-transactions.png` → Transactions page

- Top bar search "Search by bill number, table number or date…" and a date-range display.
- Preset chips: **All Bills, Today, Yesterday, This Week, This Month**, plus **Select Date Range**; **Export** button.
- Table columns: Bill No., Date & Time, Table (badge; "Takeaway" in purple), Items, Total Amount, Payment Mode (Cash/UPI/Card badges), Status, Action (View).
- Right **Bill Details** panel: bill no + Paid badge, date & time, table, payment mode, cashier, item list with thumbnails, qty and line total, Total Amount, **Print Bill Again**.

Interactions: server-side search/filter/pagination, payment-mode and status filters, View → details, Print Bill Again (does not create a transaction), Export CSV with current filters, controlled Void/Refund (added – required by spec).

Decision: "Split" payment shown in the image is not implemented in v1 (documented limitation). Payment modes: Cash, UPI, Card.

## Image 4 – `4-new-bill.png` → New Bill (billing) page

- Category chips row (All + categories with small icons).
- 3-column food cards: image, name, price, **Add** button.
- Right bill panel: **Customer Name** input, line items with thumbnail, price, − qty + stepper, delete icon, **Total**, payment buttons (**UPI**, **Cash**), **Generate Bill**.

Interactions: Add (or clicking the card) adds the item or increments its quantity; stepper and delete update immediately; draft is persisted to MongoDB (debounced, versioned); totals preview uses the same calculation library the server uses, the server total is authoritative.

Decisions:
- A third payment button (**Card**) is added beside UPI/Cash.
- The bill panel also shows subtotal / tax / discount rows when tax or discount is configured, and a "Clear" action with confirmation.
- When opened from a table group, the panel header shows "Table T02 · Group 1".
- Without a table, the page is a counter/takeaway bill (also persisted per admin per branch).

## Image 5 – `5-menu.png` → Menu management page

- Header with **Add Item** primary button; category chips row.
- 5-column cards: image, name, price, edit (pencil) and delete (trash) icon buttons.

Interactions: Add Item / edit opens a right side panel (same pattern as Image 6) containing the
Create Category + Create Food workflow; delete archives the item (history is preserved);
availability toggle in the edit panel, "Unavailable" overlay on the card; a "Categories" button
opens category management (rename, reorder, activate/deactivate).

## Image 6 – `6-tables-add-table.png` → Tables page with Add Table panel

- Right panel: **Table Number** (e.g. T13), **Number of Seats** − / + stepper, **Table Shape** (Square / Round tiles), **Status** select (Available / Reserved), **Add Table** button.

Decision: a **Floor** field is added (the grid has a floor filter, so a table must belong to a floor). It defaults to the currently selected floor.

## Pages without a reference image

Login, Restaurants, Restaurant detail (branches, admins, settings), Admins, Reports,
Analytics, Audit Log and the printable receipt. These reuse the same shell, page header,
cards, tables, chips and side-panel patterns so they stay consistent with the references.

## Theme

Taken from `Logo.jpeg` (Idly Tiffin House): green, sunflower yellow, black on white.

| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#1E7B34` | primary buttons, active nav, links |
| `--color-secondary` | `#F7C600` | accents, highlights, "partially occupied" status |
| `--color-bg` | `#F7F8F4` | app background |
| `--color-text` | `#1A1D1A` | body text |
| Font | Inter | all text |

All tokens are defined once in `client/src/styles/theme.css`.

Decision: the images use blue for "Partially Occupied". Blue is not part of the brand, so the
status palette is Available = green, Partially Occupied = amber (brand yellow, darkened for
contrast), Full = red, Reserved = grey. Each is a separate CSS variable and can be changed.
