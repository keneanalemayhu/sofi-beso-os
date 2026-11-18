// src/services/menu.service.ts

import type { Queryable } from "../db";

/** How far back "most ordered" looks. */
export const POPULAR_WINDOW_DAYS = 30;

export type BranchMenuRow = {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  price: string;
  is_active: boolean;
  created_at: string;
  /** Orders (not voided) in this branch that included the item, last 30 days. */
  order_count: number;
};

/**
 * The active menu of a branch, with how often each item was ordered there
 * recently, so the cashier can show the most ordered items first.
 */
export async function listBranchMenu(
  db: Queryable,
  branchId: string,
  windowDays = POPULAR_WINDOW_DAYS,
): Promise<BranchMenuRow[]> {
  const result = await db.query<BranchMenuRow>(
    `WITH recent AS (
       SELECT oi.menu_item_id, COUNT(DISTINCT oi.order_id)::int AS order_count
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.branch_id = $1
         AND o.status <> 'voided'
         AND o.created_at >= (now() AT TIME ZONE 'UTC') - make_interval(days => $2)
       GROUP BY oi.menu_item_id
     )
     SELECT m.id, m.category_id, m.category_name, m.name, m.price,
            m.is_active, m.created_at,
            COALESCE(r.order_count, 0) AS order_count
     FROM branch_menu m
     LEFT JOIN recent r ON r.menu_item_id = m.id
     WHERE m.branch_id = $1 AND m.is_active = TRUE
     ORDER BY m.category_name, m.name`,
    [branchId, windowDays],
  );
  return result.rows;
}
