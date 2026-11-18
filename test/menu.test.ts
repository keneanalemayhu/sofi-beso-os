// test/menu.test.ts

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { listBranchMenu } from "../src/services/menu.service";
import * as orders from "../src/services/orders.service";
import { freshDb, ids, seed, skipDb, testPool } from "./helpers";

describe("menu", { skip: skipDb }, () => {
  let pool: Pool;

  before(async () => {
    pool = testPool();
    await freshDb(pool);
  });
  after(async () => {
    await pool?.end();
  });

  test("each item carries how many recent orders included it, in this branch", async () => {
    const branch = await seed(pool);
    const place = async (items: string[]) =>
      (
        await orders.createOrder(pool, branch.main, {
          waiter_id: null,
          created_by: ids.cashier,
          serving_mode: "individual",
          device_id: null,
          local_id: null,
          items: items.map((id) => ({ menu_item_id: id, quantity: 3, comment: null })),
        })
      ).order.id;

    await place([ids.tea]);
    await place([ids.tea, ids.coffee]);
    await place([ids.tea, ids.tea]); // same item twice in one order counts once
    const voided = await place([ids.coffee]);
    await orders.voidOrder(pool, branch.main, voided, ids.cashier, null);
    const old = await place([ids.coffee]);
    await pool.query(
      `UPDATE orders SET created_at = created_at - interval '40 days' WHERE id = $1`,
      [old],
    );

    const menu = await listBranchMenu(pool, branch.main);
    const count = Object.fromEntries(menu.map((m) => [m.name, m.order_count]));
    assert.equal(count["Tea"], 3);
    assert.equal(count["Coffee"], 1); // voided and 40-day-old orders don't count
    assert.equal(menu.find((m) => m.name === "Coffee")?.price, "0.20"); // branch price

    // Another branch's menu and counts are separate.
    const imperial = await listBranchMenu(pool, branch.imperial);
    assert.ok(imperial.every((m) => m.order_count === 0));
    assert.ok(!imperial.some((m) => m.name === "Tea"));
  });
});
