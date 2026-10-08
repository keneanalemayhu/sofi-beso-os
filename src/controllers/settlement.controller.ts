// src/controllers/settlement.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isValidAmount(value: unknown): boolean {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return false;
  }

  const n = Number(value);
  return (
    value !== "" &&
    Number.isFinite(n) &&
    n >= 0 &&
    n <= 9999999999.99 &&
    Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
  );
}

export async function getDailySettlements(
  req: Request,
  res: Response
) {
  const date = req.query.date;

  if (!isValidDate(date)) {
    return res.status(400).json({
      error: "Valid date is required (YYYY-MM-DD)",
    });
  }

  if (!req.branchId) {
    return res.status(428).json({
      error: "Branch is required",
    });
  }

  try {
    const { rows } = await pool.query(
      `
      WITH daily_sales AS (
        SELECT
          o.waiter_id,
          COUNT(*)::int AS order_count,
          COALESCE(SUM(o.total_amount), 0) AS sales
        FROM orders o
        WHERE o.branch_id = $1
          AND o.status <> 'voided'
          AND o.created_at >=
              ($2::date::timestamp - INTERVAL '3 hours')
          AND o.created_at <
              (($2::date + 1)::timestamp - INTERVAL '3 hours')
        GROUP BY o.waiter_id
      )
      SELECT
        w.id AS waiter_id,
        w.name AS waiter_name,
        w.is_active,
        COALESCE(ds.order_count, 0) AS order_count,
        COALESCE(ds.sales, 0) AS sales,
        s.id AS settlement_id,
        s.bank_amount,
        s.cash_amount,
        s.updated_at,
        CASE
          WHEN s.id IS NULL THEN FALSE
          ELSE TRUE
        END AS is_recorded
      FROM waiters w
      LEFT JOIN daily_sales ds ON ds.waiter_id = w.id
      LEFT JOIN waiter_daily_settlements s
        ON s.waiter_id = w.id
       AND s.branch_id = $1
       AND s.business_date = $2::date
      WHERE w.branch_id = $1
        AND w.role = 'waiter'
        AND (
          w.is_active = TRUE
          OR ds.waiter_id IS NOT NULL
          OR s.id IS NOT NULL
        )
      ORDER BY
        COALESCE(ds.sales, 0) DESC,
        w.name ASC
      `,
      [req.branchId, date]
    );

    const waiters = rows.map((row) => {
      const sales = Number(row.sales);
      const bank = row.is_recorded
        ? Number(row.bank_amount)
        : null;
      const cash = row.is_recorded
        ? Number(row.cash_amount)
        : null;

      return {
        waiter_id: row.waiter_id,
        waiter_name: row.waiter_name,
        is_active: row.is_active,
        order_count: row.order_count,
        sales,
        settlement_id: row.settlement_id,
        bank_amount: bank,
        cash_amount: cash,
        turned_in:
          bank !== null && cash !== null
            ? bank + cash
            : null,
        is_recorded: row.is_recorded,
        updated_at: row.updated_at,
      };
    });

    return res.json({
      business_date: date,
      branch_id: req.branchId,
      waiters,
      totals: {
        sales: waiters.reduce((sum, w) => sum + w.sales, 0),
        bank: waiters.reduce(
          (sum, w) => sum + (w.bank_amount ?? 0), 0
        ),
        cash: waiters.reduce(
          (sum, w) => sum + (w.cash_amount ?? 0), 0
        ),
        recorded_waiters: waiters.filter(
          (w) => w.is_recorded
        ).length,
      },
    });
  } catch (error) {
    console.error("getDailySettlements", error);
    return res.status(500).json({
      error: "Failed to load daily settlements",
    });
  }
}

export async function saveDailySettlement(
  req: Request,
  res: Response
) {
  const { waiter_id, business_date, bank_amount, cash_amount } =
    req.body ?? {};

  if (!req.branchId) {
    return res.status(428).json({
      error: "Branch is required",
    });
  }

  if (
    typeof waiter_id !== "string" ||
    !UUID_RE.test(waiter_id)
  ) {
    return res.status(400).json({
      error: "Valid waiter_id is required",
    });
  }

  if (!isValidDate(business_date)) {
    return res.status(400).json({
      error: "Valid business_date is required",
    });
  }

  if (
    !isValidAmount(bank_amount) ||
    !isValidAmount(cash_amount)
  ) {
    return res.status(400).json({
      error: "Bank and cash must be valid non-negative ETB amounts",
    });
  }

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO waiter_daily_settlements (
        branch_id,
        waiter_id,
        business_date,
        bank_amount,
        cash_amount
      )
      SELECT
        w.branch_id,
        w.id,
        $2::date,
        $3::numeric,
        $4::numeric
      FROM waiters w
      WHERE w.id = $1::uuid
        AND w.branch_id = $5::uuid
        AND w.role = 'waiter'
      ON CONFLICT (branch_id, waiter_id, business_date)
      DO UPDATE SET
        bank_amount = EXCLUDED.bank_amount,
        cash_amount = EXCLUDED.cash_amount,
        updated_at = NOW()
      RETURNING *
      `,
      [
        waiter_id,
        business_date,
        Number(bank_amount),
        Number(cash_amount),
        req.branchId,
      ]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: "Waiter not found in selected branch",
      });
    }

    return res.json({
      success: true,
      settlement: rows[0],
    });
  } catch (error) {
    console.error("saveDailySettlement", error);
    return res.status(500).json({
      error: "Failed to save settlement",
    });
  }
}
