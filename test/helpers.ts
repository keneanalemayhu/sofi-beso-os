// test/helpers.ts

import fs from "fs";
import path from "path";
import { Pool } from "pg";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Reason to skip the database tests, or false when they can run. */
export const skipDb: string | false = TEST_DATABASE_URL
  ? false
  : "set TEST_DATABASE_URL to run the database tests";

export function testPool(): Pool {
  const url = TEST_DATABASE_URL!;
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.includes("test")) {
    throw new Error(
      `Refusing to run: database "${dbName}" does not contain "test" (the tests wipe it).`,
    );
  }
  // Run in Addis Ababa time on purpose: the code must not depend on the
  // session time zone (production databases usually run in UTC).
  return new Pool({
    connectionString: url,
    options: "-c TimeZone=Africa/Addis_Ababa",
    max: 4,
  });
}

const MIGRATIONS = path.join(__dirname, "..", "..", "migrations");

/** Wipes the database and applies every migration, as production has them. */
export async function freshDb(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const files = fs
      .readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (file.startsWith("007")) {
        // 007 fills the menu of a branch that was created by hand in production.
        await client.query(
          `INSERT INTO branches (name, slug) VALUES ('Imperial', 'imperial')`,
        );
      }
      // Drop psql-only lines (pg_dump's \restrict) that the server cannot run.
      const sql = fs
        .readFileSync(path.join(MIGRATIONS, file), "utf8")
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("\\"))
        .join("\n");
      // Migrations were written against a UTC database.
      await client.query("SET TIME ZONE 'UTC'");
      await client.query(sql);
      // pg_dump empties search_path; put the session back to normal.
      await client.query("RESET ALL");
    }
  } finally {
    client.release();
  }
}

export const ids = {
  cashier: "11111111-1111-4111-8111-111111111111",
  waiter: "22222222-2222-4222-8222-222222222222",
  otherWaiter: "22222222-2222-4222-8222-999999999999",
  category: "33333333-3333-4333-8333-333333333333",
  tea: "44444444-4444-4444-8444-444444444444",
  coffee: "55555555-5555-4555-8555-555555555555",
  offMenu: "66666666-6666-4666-8666-666666666666",
  missing: "77777777-7777-4777-8777-777777777777",
};

export type Branches = { main: string; imperial: string };

export async function seed(pool: Pool): Promise<Branches> {
  const b = await pool.query<{ slug: string; id: string }>(
    `SELECT slug, id FROM branches`,
  );
  const branch = Object.fromEntries(b.rows.map((r) => [r.slug, r.id])) as Branches;

  await pool.query(
    `INSERT INTO users (id, name, role) VALUES ($1, 'Cashier', 'cashier')`,
    [ids.cashier],
  );
  await pool.query(
    `INSERT INTO waiters (id, name, branch_id) VALUES ($1, 'Abebe', $2), ($3, 'Kebede', $4)`,
    [ids.waiter, branch.main, ids.otherWaiter, branch.imperial],
  );
  await pool.query(`INSERT INTO categories (id, name) VALUES ($1, 'Test drinks')`, [
    ids.category,
  ]);
  await pool.query(
    `INSERT INTO menu_items (id, category_id, name, price) VALUES
       ($1, $4, 'Tea', 0.10), ($2, $4, 'Coffee', 0.20), ($3, $4, 'Imperial only', 5.00)`,
    [ids.tea, ids.coffee, ids.offMenu, ids.category],
  );
  // Main sells tea and coffee (coffee at a branch price); imperial sells the third.
  await pool.query(
    `INSERT INTO branch_menu_items (branch_id, menu_item_id, price_override) VALUES
       ($1, $2, NULL), ($1, $3, 0.20), ($4, $5, NULL)`,
    [branch.main, ids.tea, ids.coffee, branch.imperial, ids.offMenu],
  );
  return branch;
}
