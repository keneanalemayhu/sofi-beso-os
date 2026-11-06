# Sofi Beso OS

Backend API for the Sofi Beso ordering system: Express, PostgreSQL and Socket.io.
It serves the cashier and history screens (`sofi-beso`) and the admin
(`sofi-beso-admin`).

## How orders work

An order is **done the moment it is placed**: the kitchen ticket is printed,
so there is no pending step and nobody has to complete it. If an order was a
mistake, a cashier **voids** it. An order is either `completed` or `voided`.

Orders belong to a branch. The branch comes from the tablet: the
`X-Branch-Slug` header, or the registered device in `X-Device-Id`.

## Setup

```bash
npm install
cp .env.example .env     # fill in the database settings
npm run dev              # development, restarts on changes
```

Production:

```bash
npm run build
npm start                # never `npm run dev` in production
```

### Updating a server

On the server, from the repo folder:

```bash
./deploy/update.sh
```

It runs these steps in order, and stops at the first one that fails:

1. Pulls the checked-out branch, trying again if GitHub refuses for a moment.
2. Runs `npm ci` and `npm run build`.
3. Runs any new migrations, after taking a backup into `deploy/backups/`.
4. Runs `pm2 reload sofi-beso-backend`.

The cashier (`sofi-beso-frontend`) and admin (`sofi-beso-admin`) repos have
the same script, minus the migrations.

### Migrations

`migrations/` holds numbered SQL files. Each one wraps itself in
`BEGIN/COMMIT`. `deploy/update.sh` runs each file once and records it in the
`schema_migrations` table. If you run one by hand, record it too:

```bash
psql -f migrations/012_example.sql
psql -c "INSERT INTO schema_migrations (name) VALUES ('012_example.sql')"
```

Never edit a migration that has already run; add a new file instead.

> **011** renames the order status `pending` to `completed`. Run it at the
> same moment you deploy this backend, outside rush hour. The previous
> backend looks for `pending` orders and would show empty lists once 011 has
> run.

## API (orders)

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/orders` | Place an order (see below) |
| GET | `/orders` | Today's orders for the branch, oldest first, no items |
| GET | `/orders/active-with-items` | Today's orders with items, newest first |
| GET | `/orders/with-items` | Same as `active-with-items` |
| GET | `/orders/completed-by-day?day=YYYY-MM-DD` | One day's orders; `&includeVoided=true` returns only the voided ones |
| PATCH | `/orders/:id/status` | Void an order |
| GET | `/orders/by-range?from=…&to=…` | Admin: all branches, all statuses |
| GET | `/orders/:id` | One order with items |
| POST | `/orders/:id/print` | Print a ticket on the server's printer |
| GET | `/analytics/today` | Today's order count, sales and voids (all branches) |

"Today" and every day filter use the business day in `BUSINESS_TZ`
(default `Africa/Addis_Ababa`), whatever time zone the database runs in.
Lists are capped at 500 orders.

### Place an order

```json
POST /orders
{
  "created_by": "<user id>",
  "waiter_id": "<waiter id or null>",
  "serving_mode": "individual",
  "device_id": "<tablet id>",
  "local_id": "<uuid made by the tablet>",
  "items": [{ "menu_item_id": "<id>", "quantity": 2, "comment": "no sugar" }]
}
```

- Prices come from the branch menu, not from the client.
- If any item is not on this branch's menu, or the waiter belongs to another
  branch, the whole order is rejected and nothing is saved.
- Sending the same `device_id` + `local_id` again (a retry after a dropped
  connection) returns the order already saved, with `"duplicate": true`,
  instead of adding it twice.

The response includes the saved `order` and its `items`.

### Void an order

```json
PATCH /orders/:id/status
{ "status": "voided", "voided_by": "<user id>", "void_reason": "wrong table" }
```

Voiding an order that is already voided returns `409`.

### Errors

Errors are JSON `{ "error": "message" }`:

- `400` means the input is bad, including a malformed id.
- `404` means the record was not found.
- `409` means a conflict, such as voiding twice.
- `503` means the server is busy and the client should retry.

Database details are logged on the server and never sent to the client.

### Live updates (Socket.io)

| Event | Payload |
| --- | --- |
| `new_order` | `{ orderId, serving_mode, order, items }` |
| `order_status_update` | `{ orderId, status, voided_by, void_reason, order, items }` |

## Tests

The tests need a separate, empty Postgres database whose name contains
`test`. They wipe it and apply every migration.

```bash
createdb sofi_beso_test
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/sofi_beso_test npm test
```

Without `TEST_DATABASE_URL`, only the tests that don't need a database run.
