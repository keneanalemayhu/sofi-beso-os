// src/controllers/order.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";
import type { Server as IOServer } from "socket.io";

type OrderItemInput = {
  menu_item_id: string;
  quantity: number;
  comment?: string | null;
};

function getIO(req: Request): IOServer | undefined {
  return req.app.locals.io as IOServer | undefined;
}

const ALLOWED_SERVING_MODES = ["individual", "shared_tray"] as const;
type ServingMode = (typeof ALLOWED_SERVING_MODES)[number];

export async function createOrder(req: Request, res: Response) {
  const { waiter_id, created_by, serving_mode, device_id, local_id, items } =
    req.body as {
      waiter_id?: string | null;
      created_by: string;
      serving_mode?: ServingMode;
      device_id?: string;
      local_id?: string;
      items: OrderItemInput[];
    };

  const normalizedServingMode: ServingMode = serving_mode ?? "individual";

  if (!created_by || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Invalid order data" });
  }

  if (!ALLOWED_SERVING_MODES.includes(normalizedServingMode)) {
    return res.status(400).json({ error: "Invalid serving_mode" });
  }

  for (const it of items) {
    if (
      !it?.menu_item_id ||
      typeof it.quantity !== "number" ||
      it.quantity <= 0
    ) {
      return res.status(400).json({ error: "Invalid order items" });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ids = [...new Set(items.map((i) => i.menu_item_id))];
    const menuRes = await client.query(
      `SELECT id, price
       FROM menu_items
       WHERE id = ANY($1::uuid[])
       AND is_active = TRUE`,
      [ids],
    );

    const priceMap = new Map<string, number>();
    for (const row of menuRes.rows) priceMap.set(row.id, Number(row.price));

    if (priceMap.size !== ids.length) {
      throw new Error("One or more menu items are invalid or inactive");
    }

    const orderResult = await client.query(
      `INSERT INTO orders
      (waiter_id, created_by, serving_mode, device_id, local_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (device_id, local_id)
      WHERE device_id IS NOT NULL AND local_id IS NOT NULL
      DO UPDATE SET updated_at = NOW()
      RETURNING *`,
      [
        waiter_id || null,
        created_by,
        normalizedServingMode,
        device_id || process.env.DEVICE_ID || null,
        local_id || null,
      ],
    );

    const order = orderResult.rows[0];
    let total = 0;

    for (const item of items) {
      const price = priceMap.get(item.menu_item_id)!;
      total += price * item.quantity;

      await client.query(
        `INSERT INTO order_items
         (order_id, menu_item_id, quantity, price_at_time, comment)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          order.id,
          item.menu_item_id,
          item.quantity,
          price,
          item.comment || null,
        ],
      );
    }

    await client.query(`UPDATE orders SET total_amount = $1 WHERE id = $2`, [
      total,
      order.id,
    ]);

    await client.query("COMMIT");

    getIO(req)?.emit("new_order", {
      orderId: order.id,
      serving_mode: normalizedServingMode,
    });

    res.json({
      success: true,
      orderId: order.id,
      total,
      serving_mode: normalizedServingMode,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to create order" });
  } finally {
    client.release();
  }
}

export async function getActiveOrders(_: Request, res: Response) {
  try {
    const result = await pool.query(`
      SELECT o.*, w.name AS waiter_name
      FROM orders o
      LEFT JOIN waiters w ON w.id = o.waiter_id
      WHERE o.status = 'pending'
      ORDER BY o.created_at ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
}

export async function getActiveOrdersWithItems(_: Request, res: Response) {
  try {
    const ordersResult = await pool.query(`
  SELECT o.*, w.name AS waiter_name
  FROM orders o
  LEFT JOIN waiters w ON w.id = o.waiter_id
  WHERE o.status = 'pending'
  ORDER BY o.created_at ASC
`);

    const orders = ordersResult.rows;

    if (orders.length === 0) {
      return res.json([]);
    }

    const orderIds = orders.map((o) => o.id);

    const itemsResult = await pool.query(
      `SELECT
         oi.*,
         m.name
       FROM order_items oi
       JOIN menu_items m ON oi.menu_item_id = m.id
       WHERE oi.order_id = ANY($1::uuid[])
       ORDER BY oi.created_at ASC`,
      [orderIds],
    );

    const itemsByOrderId = new Map<string, any[]>();

    for (const item of itemsResult.rows) {
      if (!itemsByOrderId.has(item.order_id)) {
        itemsByOrderId.set(item.order_id, []);
      }
      itemsByOrderId.get(item.order_id)!.push(item);
    }

    const payload = orders.map((order) => ({
      order,
      items: itemsByOrderId.get(order.id) || [],
    }));

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch active orders" });
  }
}

export async function getOrderById(req: Request, res: Response) {
  try {
    const order = await pool.query(
      `
      SELECT o.*, w.name AS waiter_name
      FROM orders o
      LEFT JOIN waiters w ON w.id = o.waiter_id
      WHERE o.id = $1
      `,
      [req.params.id],
    );

    if (!order.rows.length) {
      return res.status(404).json({ error: "Order not found" });
    }

    const items = await pool.query(
      `SELECT oi.*, m.name
       FROM order_items oi
       JOIN menu_items m ON oi.menu_item_id = m.id
       WHERE oi.order_id = $1`,
      [req.params.id],
    );

    res.json({ order: order.rows[0], items: items.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
}

export async function getOrdersWithItems(_: Request, res: Response) {
  try {
    const ordersResult = await pool.query(`
  SELECT o.*, w.name AS waiter_name
  FROM orders o
  LEFT JOIN waiters w ON w.id = o.waiter_id
  WHERE o.status IN ('pending', 'completed')
  ORDER BY o.created_at DESC
`);

    const orders = ordersResult.rows;

    if (orders.length === 0) {
      return res.json([]);
    }

    const orderIds = orders.map((o) => o.id);

    const itemsResult = await pool.query(
      `SELECT
         oi.*,
         m.name
       FROM order_items oi
       JOIN menu_items m ON oi.menu_item_id = m.id
       WHERE oi.order_id = ANY($1::uuid[])
       ORDER BY oi.created_at ASC`,
      [orderIds],
    );

    const itemsByOrderId = new Map<string, any[]>();

    for (const item of itemsResult.rows) {
      if (!itemsByOrderId.has(item.order_id)) {
        itemsByOrderId.set(item.order_id, []);
      }
      itemsByOrderId.get(item.order_id)!.push(item);
    }

    const payload = orders.map((order) => ({
      order,
      items: itemsByOrderId.get(order.id) || [],
    }));

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
}

export async function getCompletedOrdersByDay(req: Request, res: Response) {
  const { day } = req.query as { day?: string };

  if (!day) {
    return res.status(400).json({ error: "day query param is required" });
  }

  // expects YYYY-MM-DD
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(`${day}T23:59:59.999`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return res.status(400).json({ error: "Invalid day format. Use YYYY-MM-DD" });
  }

  try {
    const ordersResult = await pool.query(
      `
      SELECT o.*, w.name AS waiter_name
      FROM orders o
      LEFT JOIN waiters w ON w.id = o.waiter_id
      WHERE o.status = 'completed'
        AND o.completed_at IS NOT NULL
        AND o.completed_at >= $1
        AND o.completed_at <= $2
      ORDER BY o.completed_at DESC
      `,
      [start, end],
    );

    const orders = ordersResult.rows;

    if (orders.length === 0) {
      return res.json([]);
    }

    const orderIds = orders.map((o) => o.id);

    const itemsResult = await pool.query(
      `
      SELECT
        oi.*,
        m.name
      FROM order_items oi
      JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE oi.order_id = ANY($1::uuid[])
      ORDER BY oi.created_at ASC
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

    const payload = orders.map((order) => ({
      order,
      items: itemsByOrderId.get(order.id) || [],
    }));

    return res.json(payload);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch completed orders by day" });
  }
}

export async function updateOrderStatus(req: Request, res: Response) {
  const { status, voided_by, void_reason } = req.body as {
    status?: string;
    voided_by?: string;
    void_reason?: string;
  };
  const allowed = ["pending", "completed", "voided"];

  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  if (status === "voided" && !voided_by) {
    return res
      .status(400)
      .json({ error: "voided_by is required when voiding an order" });
  }

  try {
    const existing = await pool.query(
      `SELECT id, status FROM orders WHERE id = $1`,
      [req.params.id],
    );

    if (!existing.rows.length) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (existing.rows[0].status === "completed" && status !== "completed") {
      return res
        .status(400)
        .json({ error: "Completed orders cannot be changed" });
    }

    if (existing.rows[0].status === "voided" && status !== "voided") {
      return res.status(400).json({ error: "Voided orders cannot be changed" });
    }

    const completedAt = status === "completed" ? new Date() : null;
    const voidedAt = status === "voided" ? new Date() : null;
    const voidedBy = status === "voided" ? voided_by : null;
    const voidReason = status === "voided" ? void_reason?.trim() || null : null;

    const result = await pool.query(
      `
    UPDATE orders
    SET status = $1,
        completed_at = $2,
        voided_at = $3,
        voided_by = $4,
        void_reason = $5
    WHERE id = $6
    RETURNING *
    `,
      [status, completedAt, voidedAt, voidedBy, voidReason, req.params.id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    try {
      getIO(req)?.emit("order_status_update", {
        orderId: req.params.id,
        status,
        voided_by: status === "voided" ? voided_by : null,
        void_reason: status === "voided" ? void_reason?.trim() || null : null,
      });
    } catch (socketErr) {
      console.error("socket emit error:", socketErr);
    }

    return res.json({
      success: true,
      order: result.rows[0],
    });
  } catch (err) {
    console.error("updateOrderStatus error:", err);
    return res.status(500).json({
      error: "Status update failed",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
