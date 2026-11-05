// test/migrations.test.ts
//
// 011 on a database that still uses 'pending' for placed orders.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import type { Pool } from "pg";
import { freshDb, ids, skipDb, testPool } from "./helpers";

const MIGRATIONS = path.join(__dirname, "..", "..", "migrations");

describe("migration 011", { skip: skipDb }, () => {
  let pool: Pool;

  before(async () => {
    pool = testPool();
  });
  after(async () => {
    await pool?.end();
  });

  test("pending orders become completed; voided ones keep their state", async () => {
    await freshDb(pool);
    // Put the database back to how 010 left it.
    await pool.query(`
      ALTER TABLE orders DROP CONSTRAINT orders_status_check;
      ALTER TABLE orders ALTER COLUMN completed_at DROP NOT NULL;
      ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'voided'));
      ALTER TABLE order_items DROP COLUMN line_no;
    `);
    const { rows: b } = await pool.query(`SELECT id FROM branches WHERE slug = 'main'`);
    await pool.query(`INSERT INTO users (id, name, role) VALUES ($1, 'C', 'cashier')`, [ids.cashier]);
    await pool.query(
      `INSERT INTO orders (created_by, branch_id, status, created_at, completed_at)
       VALUES ($1, $2, 'pending', '2026-11-03 18:00', NULL)`,
      [ids.cashier, b[0].id],
    );
    await pool.query(
      `INSERT INTO orders (created_by, branch_id, status, created_at, completed_at, voided_at, voided_by)
       VALUES ($1, $2, 'voided', '2026-11-03 19:00', NULL, '2026-11-03 19:05', $1)`,
      [ids.cashier, b[0].id],
    );

    await pool.query(
      fs.readFileSync(path.join(MIGRATIONS, "011_orders_completed_status.sql"), "utf8"),
    );

    const { rows } = await pool.query(
      `SELECT status, to_char(completed_at, 'YYYY-MM-DD HH24:MI') AS completed_at
       FROM orders ORDER BY created_at`,
    );
    assert.deepEqual(rows, [
      { status: "completed", completed_at: "2026-11-03 18:00" },
      { status: "voided", completed_at: "2026-11-03 19:00" },
    ]);

    await assert.rejects(
      pool.query(`INSERT INTO orders (created_by, branch_id, status) VALUES ($1, $2, 'pending')`, [
        ids.cashier,
        b[0].id,
      ]),
      (err: unknown) => (err as { code?: string }).code === "23514",
    );
  });
});
