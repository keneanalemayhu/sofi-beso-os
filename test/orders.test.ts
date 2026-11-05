// test/orders.test.ts
//
// Runs against a real Postgres (TEST_DATABASE_URL).

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { HttpError } from "../src/errors";
import * as orders from "../src/services/orders.service";
import type { CreateOrderInput } from "../src/validation";
import { Branches, freshDb, ids, seed, skipDb, testPool } from "./helpers";

const rejectsWith = (status: number) => (err: unknown) =>
  err instanceof HttpError && err.status === status;

function input(over: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    waiter_id: ids.waiter,
    created_by: ids.cashier,
    serving_mode: "individual",
    device_id: null,
    local_id: null,
    items: [{ menu_item_id: ids.tea, quantity: 1, comment: null }],
    ...over,
  };
}

describe("orders", { skip: skipDb }, () => {
  let pool: Pool;
  let branch: Branches;

  before(async () => {
    pool = testPool();
    await freshDb(pool);
  });
  after(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE order_items, orders, waiters, branch_menu_items, menu_items, categories, users CASCADE`,
    );
    branch = await seed(pool);
  });

  async function placeAt(utc: string, over: Partial<CreateOrderInput> = {}) {
    const { order } = await orders.createOrder(pool, branch.main, input(over));
    await pool.query(
      `UPDATE orders SET created_at = $2, completed_at = $2 WHERE id = $1`,
      [order.id, utc],
    );
    return order.id;
  }

  test("an order is completed when placed, with an exact total and branch prices", async () => {
    const { order, items, duplicate } = await orders.createOrder(
      pool,
      branch.main,
      input({
        serving_mode: "shared_tray",
        items: [
          { menu_item_id: ids.tea, quantity: 3, comment: null },
          { menu_item_id: ids.coffee, quantity: 1, comment: "no sugar" },
          { menu_item_id: ids.tea, quantity: 1, comment: "extra hot" },
        ],
      }),
    );

    assert.equal(duplicate, false);
    // 3 × 0.10 + 0.20 + 0.10 is 0.6000000000000001 with JavaScript numbers
    assert.equal(order.total_amount, "0.60");
    assert.equal(order.status, "completed");
    assert.equal(order.serving_mode, "shared_tray");
    assert.equal(order.waiter_name, "Abebe");
    assert.ok(order.completed_at);
    assert.deepEqual(
      items.map((i) => [i.name, i.quantity, i.price_at_time, i.comment, i.line_no]),
      [
        ["Tea", 3, "0.10", null, 1],
        ["Coffee", 1, "0.20", "no sugar", 2],
        ["Tea", 1, "0.10", "extra hot", 3],
      ],
    );
  });

  test("timestamps are stored in UTC whatever the session time zone", async () => {
    const { order } = await orders.createOrder(pool, branch.main, input());
    const { rows } = await pool.query(
      `SELECT abs(extract(epoch FROM (created_at - (now() AT TIME ZONE 'UTC')))) AS drift
       FROM orders WHERE id = $1`,
      [order.id],
    );
    assert.ok(Number(rows[0].drift) < 60, `created_at is ${rows[0].drift}s off UTC`);
  });

  test("an item not on this branch's menu rejects the whole order and saves nothing", async () => {
    for (const bad of [ids.offMenu, ids.missing]) {
      await assert.rejects(
        orders.createOrder(
          pool,
          branch.main,
          input({
            items: [
              { menu_item_id: ids.tea, quantity: 1, comment: null },
              { menu_item_id: bad, quantity: 1, comment: null },
            ],
          }),
        ),
        rejectsWith(400),
      );
    }
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM orders) AS o, (SELECT count(*) FROM order_items) AS i`,
    );
    assert.deepEqual(rows[0], { o: "0", i: "0" });
  });

  test("a waiter from another branch is rejected", async () => {
    await assert.rejects(
      orders.createOrder(pool, branch.main, input({ waiter_id: ids.otherWaiter })),
      (err: unknown) => err instanceof HttpError && /branch/.test(err.message),
    );
  });

  test("retrying the same order (same device + local id) does not add it twice", async () => {
    const same = {
      device_id: "cashier-1",
      local_id: "88888888-8888-4888-8888-888888888888",
      items: [
        { menu_item_id: ids.tea, quantity: 2, comment: null },
        { menu_item_id: ids.coffee, quantity: 1, comment: null },
      ],
    };
    const first = await orders.createOrder(pool, branch.main, input(same));
    const retry = await orders.createOrder(pool, branch.main, input(same));

    assert.equal(retry.duplicate, true);
    assert.equal(retry.order.id, first.order.id);
    assert.equal(retry.items.length, 2);

    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM orders) AS o, (SELECT count(*) FROM order_items) AS i`,
    );
    assert.deepEqual(rows[0], { o: "1", i: "2" });
  });

  test("voiding works once, only in the order's branch", async () => {
    const { order } = await orders.createOrder(pool, branch.main, input());

    await assert.rejects(
      orders.voidOrder(pool, branch.imperial, order.id, ids.cashier, null),
      rejectsWith(404),
    );

    const voided = await orders.voidOrder(pool, branch.main, order.id, ids.cashier, "wrong table");
    assert.equal(voided.order.status, "voided");
    assert.equal(voided.order.void_reason, "wrong table");
    assert.equal(voided.items.length, 1);

    await assert.rejects(
      orders.voidOrder(pool, branch.main, order.id, ids.cashier, null),
      rejectsWith(409),
    );
    await assert.rejects(
      orders.voidOrder(pool, branch.main, ids.missing, ids.cashier, null),
      rejectsWith(404),
    );
  });

  test("two cashiers voiding at the same moment: exactly one succeeds", async () => {
    const { order } = await orders.createOrder(pool, branch.main, input());
    const results = await Promise.allSettled([
      orders.voidOrder(pool, branch.main, order.id, ids.cashier, "a"),
      orders.voidOrder(pool, branch.main, order.id, ids.cashier, "b"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  });

  test("'today' is the Addis Ababa business day", async () => {
    // Addis is UTC+3: 4 Nov starts at 3 Nov 21:00 UTC.
    await placeAt("2026-11-03 20:50:00"); // 3 Nov 23:50 Addis — yesterday
    const early = await placeAt("2026-11-03 21:10:00"); // 4 Nov 00:10 Addis
    const late = await placeAt("2026-11-04 20:50:00"); // 4 Nov 23:50 Addis
    await placeAt("2026-11-04 21:05:00"); // 5 Nov 00:05 Addis — tomorrow
    const voided = await placeAt("2026-11-04 09:00:00");
    await orders.voidOrder(pool, branch.main, voided, ids.cashier, null);
    await placeAt("2026-11-04 09:00:00", {}); // then move it to the other branch
    await pool.query(
      `UPDATE orders SET branch_id = $1, waiter_id = NULL
       WHERE id = (SELECT id FROM orders ORDER BY order_number DESC LIMIT 1)`,
      [branch.imperial],
    );

    const asOf = new Date("2026-11-04T09:00:00+03:00");

    const today = await orders.listTodayOrders(pool, branch.main, { asOf });
    assert.deepEqual(today.map((o) => o.id), [late, early]); // newest first, no voided

    const oldestFirst = await orders.listTodayOrders(pool, branch.main, { asOf, newestFirst: false });
    assert.deepEqual(oldestFirst.map((o) => o.id), [early, late]);

    const summary = await orders.todaySummary(pool, { asOf });
    assert.deepEqual(summary, {
      total_orders: "3", // both branches
      total_sales: "0.30",
      voided_orders: "1",
      voided_amount: "0.10",
    });
  });

  test("history by day: completed orders, or only voided ones", async () => {
    const kept = await placeAt("2026-11-03 21:10:00");
    const voided = await placeAt("2026-11-04 08:00:00");
    await orders.voidOrder(pool, branch.main, voided, ids.cashier, null);
    await placeAt("2026-11-04 21:10:00"); // next day

    const completed = await orders.listOrdersByDay(pool, branch.main, "2026-11-04", false);
    assert.deepEqual(completed.map((r) => r.order.id), [kept]);
    assert.equal(completed[0].items.length, 1);

    const onlyVoided = await orders.listOrdersByDay(pool, branch.main, "2026-11-04", true);
    assert.deepEqual(onlyVoided.map((r) => r.order.id), [voided]);

    const range = await orders.listOrdersByRange(pool, "2026-11-04", "2026-11-05");
    assert.equal(range.length, 3);
  });
});
