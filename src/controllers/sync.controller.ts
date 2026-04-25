// src/controllers/sync.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";

export async function getUnsyncedOrders(_: Request, res: Response) {
  const ordersResult = await pool.query(`
    SELECT *
    FROM orders
    WHERE synced_at IS NULL
      AND device_id IS NOT NULL
      AND local_id IS NOT NULL
    ORDER BY created_at ASC
  `);

  const orders = ordersResult.rows;

  if (orders.length === 0) return res.json([]);

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

  res.json(
    orders.map((order) => ({
      order,
      items: itemsByOrderId.get(order.id) || [],
    })),
  );
}

export async function receiveOrders(req: Request, res: Response) {
  const rows = Array.isArray(req.body?.orders) ? req.body.orders : [];

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const row of rows) {
      const { order, items } = row;

      const orderResult = await client.query(
        `
        INSERT INTO orders
        (
          waiter_id,
          created_by,
          serving_mode,
          device_id,
          local_id,
          status,
          total_amount,
          created_at,
          completed_at,
          voided_at,
          voided_by,
          void_reason
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (device_id, local_id)
        WHERE device_id IS NOT NULL AND local_id IS NOT NULL
        DO UPDATE SET
          status = EXCLUDED.status,
          total_amount = EXCLUDED.total_amount,
          completed_at = EXCLUDED.completed_at,
          voided_at = EXCLUDED.voided_at,
          voided_by = EXCLUDED.voided_by,
          void_reason = EXCLUDED.void_reason,
          updated_at = NOW()
        RETURNING id
        `,
        [
          order.waiter_id,
          order.created_by,
          order.serving_mode || "individual",
          order.device_id,
          order.local_id,
          order.status,
          order.total_amount,
          order.created_at,
          order.completed_at,
          order.voided_at,
          order.voided_by,
          order.void_reason,
        ],
      );

      const cloudOrderId = orderResult.rows[0].id;

      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [
        cloudOrderId,
      ]);

      for (const item of items) {
        await client.query(
          `
          INSERT INTO order_items
          (order_id, menu_item_id, quantity, price_at_time, comment, created_at)
          VALUES ($1,$2,$3,$4,$5,$6)
          `,
          [
            cloudOrderId,
            item.menu_item_id,
            item.quantity,
            item.price_at_time,
            item.comment,
            item.created_at,
          ],
        );
      }
    }

    await client.query("COMMIT");

    res.json({ success: true, count: rows.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("receiveOrders sync error:", err);
    res.status(500).json({ error: "Sync failed" });
  } finally {
    client.release();
  }
}

export async function markOrdersSynced(req: Request, res: Response) {
  const localIds = Array.isArray(req.body?.local_ids) ? req.body.local_ids : [];

  await pool.query(
    `
    UPDATE orders
    SET synced_at = NOW()
    WHERE local_id = ANY($1::uuid[])
    `,
    [localIds],
  );

  res.json({ success: true });
}