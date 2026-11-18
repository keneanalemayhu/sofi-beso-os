// src/controllers/order.controller.ts
//
// An order is done the moment it is placed (the ticket is printed). The
// only change afterwards is voiding. Errors thrown here are turned into
// safe JSON responses by errorHandler (src/errors.ts).

import { Request, Response } from "express";
import type { Server as IOServer } from "socket.io";
import { pool } from "../db";
import { HttpError } from "../errors";
import { printOrderReceipt } from "../services/print.service";
import * as orders from "../services/orders.service";
import { param } from "../utils/http";
import {
  parseCreateOrder,
  parseVoidReason,
  requireDay,
  requireUuid,
} from "../validation";

function getIO(req: Request): IOServer | undefined {
  return req.app.locals.io as IOServer | undefined;
}

function emit(req: Request, event: string, payload: unknown) {
  try {
    getIO(req)?.emit(event, payload);
  } catch (err) {
    console.error(`socket emit "${event}" failed:`, err);
  }
}

function branchOf(req: Request): string {
  if (!req.branchId) throw new HttpError(428, "BRANCH_NOT_RESOLVED");
  return req.branchId;
}

export async function createOrder(req: Request, res: Response) {
  const input = parseCreateOrder(req.body);
  if (req.deviceId) input.device_id = req.deviceId;

  const { order, items, duplicate } = await orders.createOrder(
    pool,
    branchOf(req),
    input,
  );

  // The whole order goes out, so screens can add it without refetching.
  if (!duplicate) {
    emit(req, "new_order", {
      orderId: order.id,
      serving_mode: order.serving_mode,
      order,
      items,
    });
  }

  res.json({
    success: true,
    orderId: order.id,
    total: Number(order.total_amount),
    serving_mode: order.serving_mode,
    duplicate,
    order,
    items,
  });
}

/** GET /orders — today's orders for this branch, oldest first, no items. */
export async function getActiveOrders(req: Request, res: Response) {
  res.json(
    await orders.listTodayOrders(pool, branchOf(req), { newestFirst: false }),
  );
}

/** GET /orders/active-with-items — today's orders with items, newest first. */
export async function getActiveOrdersWithItems(req: Request, res: Response) {
  res.json(await orders.listTodayOrdersWithItems(pool, branchOf(req)));
}

/** GET /orders/with-items — same as active-with-items (kept for old screens). */
export async function getOrdersWithItems(req: Request, res: Response) {
  res.json(await orders.listTodayOrdersWithItems(pool, branchOf(req)));
}

/**
 * GET /orders/completed-by-day?day=YYYY-MM-DD&includeVoided=true
 * Completed orders of that day, or only the voided ones when includeVoided
 * is "true" (what the history screen's "show voided" toggle expects).
 */
export async function getCompletedOrdersByDay(req: Request, res: Response) {
  if (!req.query.day) throw new HttpError(400, "day query param is required");
  const day = requireDay(req.query.day, "day");
  const voidedOnly = req.query.includeVoided === "true";
  res.json(await orders.listOrdersByDay(pool, branchOf(req), day, voidedOnly));
}

export async function getOrderById(req: Request, res: Response) {
  res.json(await orders.getOrderWithItems(pool, param(req.params.id)));
}

/**
 * PATCH /orders/:id/status
 *   { "status": "voided", "voided_by": "<user id>", "void_reason": "..." }
 *
 * "completed" (or the old "pending") is accepted as a no-op on an order
 * that is not voided. A voided order cannot be changed back.
 */
export async function updateOrderStatus(req: Request, res: Response) {
  const id = param(req.params.id);
  const branchId = branchOf(req);
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (body.status === "completed" || body.status === "pending") {
    const { order } = await orders.getOrderWithItems(pool, id);
    if (order.branch_id !== branchId) throw new HttpError(404, "Order not found");
    if (order.status === "voided") {
      throw new HttpError(409, "Voided orders cannot be changed");
    }
    return res.json({ success: true, order });
  }

  if (body.status !== "voided") throw new HttpError(400, "Invalid status");

  if (!body.voided_by) {
    throw new HttpError(400, "voided_by is required when voiding an order");
  }
  const voidedBy = requireUuid(body.voided_by, "voided_by");
  const reason = parseVoidReason(body.void_reason);

  const { order, items } = await orders.voidOrder(
    pool,
    branchId,
    id,
    voidedBy,
    reason,
  );

  emit(req, "order_status_update", {
    orderId: order.id,
    status: order.status,
    voided_by: order.voided_by,
    void_reason: order.void_reason,
    order,
    items,
  });

  res.json({ success: true, order });
}

export async function printOrderById(req: Request, res: Response) {
  const { order, items } = await orders.getOrderWithItems(
    pool,
    param(req.params.id),
  );

  await printOrderReceipt({
    orderId: order.id,
    waiterName: order.waiter_name,
    servingMode: order.serving_mode as string,
    total: Number(order.total_amount),
    items: items as unknown as Parameters<typeof printOrderReceipt>[0]["items"],
  });

  res.json({ success: true });
}

/** GET /orders/by-range?from=YYYY-MM-DD&to=YYYY-MM-DD (admin, all branches). */
export async function getOrdersByRange(req: Request, res: Response) {
  if (!req.query.from || !req.query.to) {
    throw new HttpError(
      400,
      "from and to query params are required (YYYY-MM-DD)",
    );
  }
  const from = requireDay(req.query.from, "from");
  const to = requireDay(req.query.to, "to");
  if (from > to) throw new HttpError(400, "from must be before to");

  res.json(await orders.listOrdersByRange(pool, from, to));
}
