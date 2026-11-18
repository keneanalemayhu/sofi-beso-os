// src/services/orders.service.ts
//
// All order SQL lives here. Every function takes the database as a
// parameter so it can be tested against a test database.
//
// Timestamps are stored as UTC in `timestamp` (no time zone) columns, so
// new values are written as (now() AT TIME ZONE 'UTC') — correct whatever
// time zone the database session uses.

import type { Queryable } from "../db";
import { BUSINESS_TZ } from "../config";
import { HttpError } from "../errors";
import type { CreateOrderInput } from "../validation";

export type OrderRow = Record<string, unknown> & {
  id: string;
  status: string;
  total_amount: string;
  waiter_name?: string | null;
};
export type OrderItemRow = Record<string, unknown> & {
  order_id: string;
  name: string;
};
export type OrderWithItems = { order: OrderRow; items: OrderItemRow[] };

const NOW_UTC = `(now() AT TIME ZONE 'UTC')`;

/**
 * SQL for the UTC start of a business day. `day` is a SQL date expression;
 * `tz` is the placeholder holding the time zone name.
 */
function dayStartUtc(day: string, tz: string): string {
  return `((${day})::timestamp AT TIME ZONE ${tz}::text AT TIME ZONE 'UTC')`;
}

/**
 * SQL condition: `column` (UTC timestamp) falls on business days
 * `from`..`to` inclusive. Uses a plain range so the
 * (branch_id, created_at) index applies.
 */
function onDays(column: string, from: string, to: string, tz: string): string {
  return `${column} >= ${dayStartUtc(from, tz)}
      AND ${column} < ${dayStartUtc(`(${to})::date + 1`, tz)}`;
}

/** SQL date expression for "today" in the business time zone. */
function todaySql(asOf: string, tz: string): string {
  return `(COALESCE(${asOf}::timestamptz, now()) AT TIME ZONE ${tz}::text)::date`;
}

export type TodayOptions = {
  /** Which moment counts as "now" (tests). Defaults to the database clock. */
  asOf?: Date;
  /** Business time zone. Defaults to BUSINESS_TZ. */
  tz?: string;
};

const ORDER_COLUMNS = `o.*, w.name AS waiter_name`;

async function fetchItems(
  db: Queryable,
  orderIds: string[],
): Promise<Map<string, OrderItemRow[]>> {
  const byOrder = new Map<string, OrderItemRow[]>();
  if (orderIds.length === 0) return byOrder;

  const result = await db.query<OrderItemRow>(
    `SELECT oi.*, m.name
     FROM order_items oi
     JOIN menu_items m ON m.id = oi.menu_item_id
     WHERE oi.order_id = ANY($1::uuid[])
     ORDER BY oi.order_id, oi.line_no NULLS LAST, oi.created_at, oi.id`,
    [orderIds],
  );

  for (const item of result.rows) {
    const list = byOrder.get(item.order_id);
    if (list) list.push(item);
    else byOrder.set(item.order_id, [item]);
  }
  return byOrder;
}

async function withItems(
  db: Queryable,
  orders: OrderRow[],
): Promise<OrderWithItems[]> {
  const items = await fetchItems(
    db,
    orders.map((o) => o.id),
  );
  return orders.map((order) => ({ order, items: items.get(order.id) ?? [] }));
}

/**
 * Places an order in ONE statement: prices come from the branch menu, the
 * order and all its items are inserted, and the total is summed in SQL as
 * exact NUMERIC. The order is completed the moment it is placed.
 *
 * Retrying with the same (device_id, local_id) returns the order that was
 * already saved instead of adding its items a second time.
 */
export async function createOrder(
  db: Queryable,
  branchId: string,
  input: CreateOrderInput,
): Promise<OrderWithItems & { duplicate: boolean }> {
  const result = await db.query<OrderRow>(
    `WITH input AS (
       SELECT t.menu_item_id, t.quantity, t.comment, t.line_no::int AS line_no
       FROM unnest($7::uuid[], $8::int[], $9::text[])
            WITH ORDINALITY AS t(menu_item_id, quantity, comment, line_no)
     ),
     priced AS (
       SELECT i.*, m.price
       FROM input i
       JOIN branch_menu m
         ON m.id = i.menu_item_id AND m.branch_id = $6 AND m.is_active
     ),
     new_order AS (
       INSERT INTO orders
         (waiter_id, created_by, serving_mode, device_id, local_id, branch_id,
          status, total_amount, created_at, completed_at, updated_at)
       SELECT $1, $2, $3, $4, $5, $6,
              'completed', COALESCE(SUM(p.price * p.quantity), 0),
              ${NOW_UTC}, ${NOW_UTC}, ${NOW_UTC}
       FROM priced p
       -- every item must be on this branch's menu, and the waiter must
       -- belong to this branch; otherwise nothing is inserted
       HAVING COUNT(*) = (SELECT COUNT(*) FROM input)
          AND ($1::uuid IS NULL OR EXISTS (
                SELECT 1 FROM waiters WHERE id = $1 AND branch_id = $6))
       ON CONFLICT (device_id, local_id)
         WHERE device_id IS NOT NULL AND local_id IS NOT NULL
         DO NOTHING
       RETURNING *
     ),
     new_items AS (
       INSERT INTO order_items
         (order_id, menu_item_id, quantity, price_at_time, comment, line_no, created_at)
       SELECT o.id, p.menu_item_id, p.quantity, p.price, p.comment, p.line_no, ${NOW_UTC}
       FROM new_order o CROSS JOIN priced p
     )
     SELECT o.*, w.name AS waiter_name
     FROM new_order o
     LEFT JOIN waiters w ON w.id = o.waiter_id`,
    [
      input.waiter_id,
      input.created_by,
      input.serving_mode,
      input.device_id,
      input.local_id,
      branchId,
      input.items.map((i) => i.menu_item_id),
      input.items.map((i) => i.quantity),
      input.items.map((i) => i.comment),
    ],
  );

  const created = result.rows[0];
  if (created) {
    // Items are known from the input; read them back for names and ids.
    const [full] = await withItems(db, [created]);
    return { ...full, duplicate: false };
  }

  // Nothing inserted: a retry of an order already saved, or bad input.
  if (input.device_id && input.local_id) {
    const existing = await db.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS}
       FROM orders o LEFT JOIN waiters w ON w.id = o.waiter_id
       WHERE o.device_id = $1 AND o.local_id = $2 AND o.branch_id = $3`,
      [input.device_id, input.local_id, branchId],
    );
    if (existing.rows[0]) {
      const [full] = await withItems(db, existing.rows);
      return { ...full, duplicate: true };
    }
  }

  if (input.waiter_id) {
    const w = await db.query(
      `SELECT 1 FROM waiters WHERE id = $1 AND branch_id = $2`,
      [input.waiter_id, branchId],
    );
    if (!w.rows.length) {
      throw new HttpError(400, "Waiter does not belong to this branch");
    }
  }
  throw new HttpError(400, "One or more menu items are invalid or inactive");
}

export async function getOrderWithItems(
  db: Queryable,
  id: string,
): Promise<OrderWithItems> {
  const result = await db.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
     FROM orders o LEFT JOIN waiters w ON w.id = o.waiter_id
     WHERE o.id = $1`,
    [id],
  );
  if (!result.rows[0]) throw new HttpError(404, "Order not found");
  const [full] = await withItems(db, result.rows);
  return full;
}

export type TodayListOptions = TodayOptions & {
  newestFirst?: boolean;
  limit?: number;
};

/** Today's non-voided orders for a branch (business day). */
export async function listTodayOrders(
  db: Queryable,
  branchId: string,
  opts: TodayListOptions = {},
): Promise<OrderRow[]> {
  const today = todaySql("$2", "$3");
  const result = await db.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
     FROM orders o
     LEFT JOIN waiters w ON w.id = o.waiter_id
     WHERE o.branch_id = $1
       AND o.status = 'completed'
       AND ${onDays("o.created_at", today, today, "$3")}
     ORDER BY o.created_at ${opts.newestFirst === false ? "ASC" : "DESC"}
     LIMIT $4`,
    [branchId, opts.asOf ?? null, opts.tz ?? BUSINESS_TZ, opts.limit ?? 500],
  );
  return result.rows;
}

export async function listTodayOrdersWithItems(
  db: Queryable,
  branchId: string,
  opts: TodayListOptions = {},
): Promise<OrderWithItems[]> {
  return withItems(db, await listTodayOrders(db, branchId, opts));
}

/**
 * One business day for a branch: the completed orders, or only the voided
 * ones when `voidedOnly` is set (the history screen's "show voided").
 */
export async function listOrdersByDay(
  db: Queryable,
  branchId: string,
  day: string,
  voidedOnly: boolean,
  tz = BUSINESS_TZ,
): Promise<OrderWithItems[]> {
  const result = await db.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
     FROM orders o
     LEFT JOIN waiters w ON w.id = o.waiter_id
     WHERE o.branch_id = $1
       AND o.status = $3
       AND ${onDays("o.created_at", "$2::date", "$2::date", "$4")}
     ORDER BY o.created_at DESC`,
    [branchId, day, voidedOnly ? "voided" : "completed", tz],
  );
  return withItems(db, result.rows);
}

/** All orders (any branch, any status) placed on business days from..to. */
export async function listOrdersByRange(
  db: Queryable,
  from: string,
  to: string,
  tz = BUSINESS_TZ,
): Promise<OrderWithItems[]> {
  const result = await db.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
     FROM orders o
     LEFT JOIN waiters w ON w.id = o.waiter_id
     WHERE ${onDays("o.created_at", "$1::date", "$2::date", "$3")}
     ORDER BY o.created_at DESC`,
    [from, to, tz],
  );
  return withItems(db, result.rows);
}

/**
 * Voids an order of this branch. A single conditional UPDATE, so two
 * cashiers voiding the same order at the same moment cannot both succeed.
 */
export async function voidOrder(
  db: Queryable,
  branchId: string,
  id: string,
  voidedBy: string,
  reason: string | null,
): Promise<OrderWithItems> {
  const result = await db.query<OrderRow>(
    `WITH updated AS (
       UPDATE orders
       SET status = 'voided',
           voided_at = ${NOW_UTC},
           voided_by = $3,
           void_reason = $4,
           updated_at = ${NOW_UTC},
           synced_at = NULL
       WHERE id = $1 AND branch_id = $2 AND status <> 'voided'
       RETURNING *
     )
     SELECT u.*, w.name AS waiter_name
     FROM updated u LEFT JOIN waiters w ON w.id = u.waiter_id`,
    [id, branchId, voidedBy, reason],
  );

  if (result.rows[0]) {
    const [full] = await withItems(db, result.rows);
    return full;
  }

  const existing = await db.query(
    `SELECT status FROM orders WHERE id = $1 AND branch_id = $2`,
    [id, branchId],
  );
  if (!existing.rows[0]) throw new HttpError(404, "Order not found");
  throw new HttpError(409, "Order is already voided");
}

/** Today's totals across all branches. Voided orders are counted apart. */
export async function todaySummary(db: Queryable, opts: TodayOptions = {}) {
  const today = todaySql("$1", "$2");
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status <> 'voided')                       AS total_orders,
       COALESCE(SUM(total_amount) FILTER (WHERE status <> 'voided'), 0) AS total_sales,
       COUNT(*) FILTER (WHERE status = 'voided')                        AS voided_orders,
       COALESCE(SUM(total_amount) FILTER (WHERE status = 'voided'), 0)  AS voided_amount
     FROM orders
     WHERE ${onDays("created_at", today, today, "$2")}`,
    [opts.asOf ?? null, opts.tz ?? BUSINESS_TZ],
  );
  return result.rows[0];
}
