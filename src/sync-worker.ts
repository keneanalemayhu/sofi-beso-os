// src/sync-worker.ts

import { pool } from "./db";

const CLOUD_API_BASE = process.env.CLOUD_API_BASE;
const ENABLE_SYNC = process.env.ENABLE_SYNC === "true";

export async function syncToCloud() {
  if (!ENABLE_SYNC || !CLOUD_API_BASE) return;

  const result = await pool.query(`
    SELECT *
    FROM orders
    WHERE synced_at IS NULL
      AND device_id IS NOT NULL
      AND local_id IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 50
  `);

  const orders = result.rows;
  if (orders.length === 0) return;

  const orderIds = orders.map((o) => o.id);

  const itemsResult = await pool.query(
    `
    SELECT *
    FROM order_items
    WHERE order_id = ANY($1::uuid[])
    ORDER BY created_at ASC
    `,
    [orderIds],
  );

  const itemsByOrderId = new Map<string, any[]>();

  for (const item of itemsResult.rows) {
    if (!itemsByOrderId.has(item.order_id)) {
      itemsByOrderId.set(item.order_id, []);
    }

    itemsByOrderId.get(item.order_id)!.push(item);
  }

  const payload = {
    orders: orders.map((order) => ({
      order,
      items: itemsByOrderId.get(order.id) || [],
    })),
  };

  const res = await fetch(`${CLOUD_API_BASE}/sync/orders/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Cloud sync failed: ${res.status}`);
  }

  await pool.query(
    `
    UPDATE orders
    SET synced_at = NOW()
    WHERE id = ANY($1::uuid[])
    `,
    [orderIds],
  );

  console.log(`Synced ${orders.length} orders to cloud`);
}