// src/controllers/savings.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";

const ADMIN_ID = process.env.ADMIN_USER_ID || null;

/** SQL fragment: one period's length, based on plan.period_type */
const PERIOD_INTERVAL = `
  CASE p.period_type
    WHEN 'daily'  THEN INTERVAL '1 day'
    WHEN 'weekly' THEN INTERVAL '1 week'
    ELSE INTERVAL '1 month'
  END`;

// ---------- PLANS ----------

export async function listPlans(_req: Request, res: Response) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM savings_plan_summary ORDER BY is_active DESC, start_date DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("listPlans", err);
    res.status(500).json({ error: "Failed to fetch savings plans" });
  }
}

export async function createPlan(req: Request, res: Response) {
  const { name, period_type, target_per_period, period_count, start_date } = req.body;

  if (!name || !period_type || !target_per_period || !period_count) {
    return res.status(400).json({
      error: "name, period_type, target_per_period and period_count are required",
    });
  }
  if (!["daily", "weekly", "monthly"].includes(period_type)) {
    return res.status(400).json({ error: "period_type must be daily, weekly or monthly" });
  }
  if (Number(target_per_period) <= 0 || Number(period_count) <= 0) {
    return res.status(400).json({ error: "target_per_period and period_count must be positive" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO savings_plans
         (name, period_type, target_per_period, period_count, start_date, created_by)
       VALUES ($1, $2, $3, $4,
               COALESCE($5::date, (now() AT TIME ZONE 'Africa/Addis_Ababa')::date), $6)
       RETURNING *`,
      [name, period_type, target_per_period, period_count, start_date || null, ADMIN_ID]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createPlan", err);
    res.status(500).json({ error: "Failed to create savings plan" });
  }
}

/**
 * The checkbox grid. Returns one row per period with:
 *   checked, amount, running_total, and available_cash for that period's days.
 */
export async function getPlanDetail(req: Request, res: Response) {
  try {
    const planRes = await pool.query(
      `SELECT * FROM savings_plan_summary WHERE plan_id = $1`, [req.params.id]
    );
    if (!planRes.rows.length) return res.status(404).json({ error: "Plan not found" });

    const { rows: periods } = await pool.query(
      `WITH p AS (SELECT * FROM savings_plans WHERE id = $1),
       periods AS (
         SELECT gs.idx AS period_index,
                (p.start_date + ((gs.idx - 1) * (${PERIOD_INTERVAL})))::date AS period_start,
                ((p.start_date + (gs.idx * (${PERIOD_INTERVAL}))) - INTERVAL '1 day')::date AS period_end
         FROM p, generate_series(1, p.period_count) AS gs(idx)
       )
       SELECT
         pe.period_index,
         pe.period_start,
         pe.period_end,
         (e.id IS NOT NULL) AS checked,
         COALESCE(e.amount, p.target_per_period) AS amount,
         e.saved_at,
         e.note,
         COALESCE(cash.available, 0) AS available_cash,
         SUM(CASE WHEN e.id IS NOT NULL THEN e.amount ELSE 0 END)
           OVER (ORDER BY pe.period_index ROWS UNBOUNDED PRECEDING) AS running_total
       FROM periods pe
       CROSS JOIN p
       LEFT JOIN savings_entries e
         ON e.plan_id = p.id AND e.period_index = pe.period_index
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(d.available_cash), 0) AS available
         FROM daily_cash_flow d
         WHERE d.day BETWEEN pe.period_start AND pe.period_end
       ) cash ON TRUE
       ORDER BY pe.period_index`,
      [req.params.id]
    );

    res.json({ ...planRes.rows[0], periods });
  } catch (err) {
    console.error("getPlanDetail", err);
    res.status(500).json({ error: "Failed to fetch plan detail" });
  }
}

export async function updatePlan(req: Request, res: Response) {
  const { name, is_active, target_per_period, period_count } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE savings_plans SET
         name              = COALESCE($2, name),
         is_active         = COALESCE($3, is_active),
         target_per_period = COALESCE($4, target_per_period),
         period_count      = COALESCE($5, period_count)
       WHERE id = $1 RETURNING *`,
      [req.params.id, name, is_active, target_per_period, period_count]
    );
    if (!rows.length) return res.status(404).json({ error: "Plan not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("updatePlan", err);
    res.status(500).json({ error: "Failed to update plan" });
  }
}

export async function deletePlan(req: Request, res: Response) {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM savings_plans WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Plan not found" });
    res.status(204).send();
  } catch (err) {
    console.error("deletePlan", err);
    res.status(500).json({ error: "Failed to delete plan" });
  }
}

// ---------- TICK / UNTICK ----------

/** Tick a checkbox. Amount defaults to the plan target; pass one to override. */
export async function checkPeriod(req: Request, res: Response) {
  const { period_index, amount, note } = req.body;
  if (!period_index) return res.status(400).json({ error: "period_index is required" });

  try {
    const { rows } = await pool.query(
      `WITH p AS (SELECT * FROM savings_plans WHERE id = $1)
       INSERT INTO savings_entries (plan_id, period_index, period_date, amount, note, created_by)
       SELECT p.id, $2,
              (p.start_date + (($2::int - 1) * (${PERIOD_INTERVAL})))::date,
              COALESCE($3, p.target_per_period), $4, $5
       FROM p
       WHERE $2::int BETWEEN 1 AND p.period_count
       ON CONFLICT (plan_id, period_index)
         DO UPDATE SET amount = EXCLUDED.amount,
                       note   = EXCLUDED.note,
                       saved_at = NOW()
       RETURNING *`,
      [req.params.id, period_index, amount || null, note || null, ADMIN_ID]
    );
    if (!rows.length) {
      return res.status(400).json({ error: "Plan not found, or period_index out of range" });
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("checkPeriod", err);
    res.status(500).json({ error: "Failed to record saving" });
  }
}

/** Untick — deletes the row. */
export async function uncheckPeriod(req: Request, res: Response) {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM savings_entries WHERE plan_id = $1 AND period_index = $2`,
      [req.params.id, req.params.index]
    );
    if (!rowCount) return res.status(404).json({ error: "Not saved yet" });
    res.status(204).send();
  } catch (err) {
    console.error("uncheckPeriod", err);
    res.status(500).json({ error: "Failed to remove saving" });
  }
}