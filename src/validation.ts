// src/validation.ts

import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_ITEMS_PER_ORDER = 100;
export const MAX_QUANTITY = 1000;
export const MAX_COMMENT_LENGTH = 500;
export const MAX_VOID_REASON_LENGTH = 500;

export const SERVING_MODES = ["individual", "shared_tray"] as const;
export type ServingMode = (typeof SERVING_MODES)[number];

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) throw new HttpError(400, `${field} must be a valid id`);
  return value;
}

/** For router.param("id", ...): a malformed id is a 400, not a database error. */
export function validateIdParam(
  _req: Request,
  _res: Response,
  next: NextFunction,
  value: string,
) {
  if (!isUuid(value)) return next(new HttpError(400, "Invalid id"));
  next();
}

/** A real calendar date in YYYY-MM-DD form. */
export function requireDay(value: unknown, field: string): string {
  if (typeof value !== "string" || !DAY_RE.test(value)) {
    throw new HttpError(400, `${field} must be a date in YYYY-MM-DD form`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new HttpError(400, `${field} is not a real calendar date`);
  }
  return value;
}

export type OrderItemInput = {
  menu_item_id: string;
  quantity: number;
  comment: string | null;
};

export type CreateOrderInput = {
  waiter_id: string | null;
  created_by: string;
  serving_mode: ServingMode;
  device_id: string | null;
  local_id: string | null;
  items: OrderItemInput[];
};

export function parseCreateOrder(body: unknown): CreateOrderInput {
  const b = (body ?? {}) as Record<string, unknown>;

  const created_by = requireUuid(b.created_by, "created_by");

  const waiter_id =
    b.waiter_id === undefined || b.waiter_id === null || b.waiter_id === ""
      ? null
      : requireUuid(b.waiter_id, "waiter_id");

  const serving_mode = (b.serving_mode ?? "individual") as ServingMode;
  if (!SERVING_MODES.includes(serving_mode)) {
    throw new HttpError(400, "Invalid serving_mode");
  }

  let device_id: string | null = null;
  if (b.device_id !== undefined && b.device_id !== null && b.device_id !== "") {
    if (typeof b.device_id !== "string" || b.device_id.length > 100) {
      throw new HttpError(400, "Invalid device_id");
    }
    device_id = b.device_id.trim() || null;
  }

  const local_id =
    b.local_id === undefined || b.local_id === null || b.local_id === ""
      ? null
      : requireUuid(b.local_id, "local_id");

  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw new HttpError(400, "An order needs at least one item");
  }
  if (b.items.length > MAX_ITEMS_PER_ORDER) {
    throw new HttpError(
      400,
      `An order can have at most ${MAX_ITEMS_PER_ORDER} items`,
    );
  }

  const items = b.items.map((raw, i): OrderItemInput => {
    const it = (raw ?? {}) as Record<string, unknown>;
    const menu_item_id = requireUuid(it.menu_item_id, `items[${i}].menu_item_id`);

    const quantity = it.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      quantity > MAX_QUANTITY
    ) {
      throw new HttpError(
        400,
        `items[${i}].quantity must be a whole number from 1 to ${MAX_QUANTITY}`,
      );
    }

    let comment: string | null = null;
    if (it.comment !== undefined && it.comment !== null) {
      if (typeof it.comment !== "string") {
        throw new HttpError(400, `items[${i}].comment must be text`);
      }
      const trimmed = it.comment.trim();
      if (trimmed.length > MAX_COMMENT_LENGTH) {
        throw new HttpError(
          400,
          `items[${i}].comment is too long (max ${MAX_COMMENT_LENGTH})`,
        );
      }
      comment = trimmed || null;
    }

    return { menu_item_id, quantity, comment };
  });

  return { waiter_id, created_by, serving_mode, device_id, local_id, items };
}

export type VoidInput = { voided_by: string; void_reason: string | null };

export function parseVoidReason(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "void_reason must be text");
  }
  const reason = value.trim();
  if (reason.length > MAX_VOID_REASON_LENGTH) {
    throw new HttpError(
      400,
      `void_reason is too long (max ${MAX_VOID_REASON_LENGTH})`,
    );
  }
  return reason || null;
}
