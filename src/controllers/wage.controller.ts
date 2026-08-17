// src/controllers/wage.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";
import {
  gregorianToEthiopian,
  ethiopianToGregorian,
  ethiopianMonthLength,
  formatEthiopian,
} from "../utils/ethiopian-date";
import { param } from "../utils/http";

const ADMIN_ID = process.env.ADMIN_USER_ID || null;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function addisNow(): Date {
  return new Date(Date.now() + 3 * 60 * 60 * 1000);
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Next payday for a waiter, in whichever calendar their wage_day is expressed.
 * Returns both representations so the UI can show either.
 */
function nextPayday(w: {
  wage_cycle: string;
  wage_day: number | null;
  wage_calendar: string;
}): { gregorian: string; ethiopian: string } | null {
  const today = addisNow();

  if (w.wage_cycle === "daily") {
    const g = today;
    return {
      gregorian: iso(g),
      ethiopian: formatEthiopian(gregorianToEthiopian(g)),
    };
  }

  if (!w.wage_day) return null;

  if (w.wage_cycle === "weekly") {
    const todayDow = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
    const ahead = (w.wage_day - todayDow + 7) % 7 || 7;
    const g = new Date(today);
    g.setUTCDate(g.getUTCDate() + ahead);
    return {
      gregorian: iso(g),
      ethiopian: formatEthiopian(gregorianToEthiopian(g)),
    };
  }

  // monthly
  if (w.wage_calendar === "ethiopian") {
    const et = gregorianToEthiopian(today);
    let { year, month } = et;
    if (et.day >= w.wage_day) {
      month += 1;
      if (month > 13) {
        month = 1;
        year += 1;
      }
    }
    const day = Math.min(w.wage_day, ethiopianMonthLength(year, month));
    const g = ethiopianToGregorian({ year, month, day });
    return {
      gregorian: iso(g),
      ethiopian: formatEthiopian({ year, month, day }),
    };
  }

  // gregorian monthly — clamp to month length
  let y = today.getUTCFullYear();
  let m = today.getUTCMonth();
  if (today.getUTCDate() >= w.wage_day) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const g = new Date(Date.UTC(y, m, Math.min(w.wage_day, lastDay)));
  return {
    gregorian: iso(g),
    ethiopian: formatEthiopian(gregorianToEthiopian(g)),
  };
}

// ---------- WAITER WAGE CONFIG ----------

export async function listWaiterWages(_req: Request, res: Response) {
  try {
    const { rows } = await pool.query(
      `SELECT w.id, w.name, w.is_active, w.role, w.wage_amount, w.wage_cycle,
              w.wage_day, w.wage_calendar, w.hired_on,
              lp.paid_on   AS last_paid_on,
              lp.amount    AS last_paid_amount,
              lp.period_end AS last_period_end
       FROM waiters w
       LEFT JOIN LATERAL (
         SELECT * FROM waiter_wage_payments p
         WHERE p.waiter_id = w.id
         ORDER BY p.period_end DESC LIMIT 1
       ) lp ON TRUE
       ORDER BY w.is_active DESC, w.name`,
    );

    res.json(rows.map((w) => ({ ...w, next_payday: nextPayday(w) })));
  } catch (err) {
    console.error("listWaiterWages", err);
    res.status(500).json({ error: "Failed to fetch waiter wages" });
  }
}

export async function updateWaiterWage(req: Request, res: Response) {
  const { wage_amount, wage_cycle, wage_day, wage_calendar, hired_on } =
    req.body;

  try {
    const waiterId = param(req.params.id);
    if (!UUID_RE.test(waiterId)) {
      return res.status(400).json({ error: "Invalid waiter id" });
    }
    if (wage_cycle === "daily" && wage_day) {
      return res
        .status(400)
        .json({ error: "wage_day must be null for daily cycle" });
    }
    if (wage_cycle === "weekly" && wage_day && (wage_day < 1 || wage_day > 7)) {
      return res
        .status(400)
        .json({ error: "weekly wage_day must be 1-7 (Mon-Sun)" });
    }

    const { rows } = await pool.query(
      `UPDATE waiters SET
         wage_amount   = COALESCE($2, wage_amount),
         wage_cycle    = COALESCE($3, wage_cycle),
         wage_day      = CASE WHEN $3 = 'daily' THEN NULL ELSE COALESCE($4, wage_day) END,
         wage_calendar = COALESCE($5, wage_calendar),
         hired_on      = COALESCE($6::date, hired_on)
       WHERE id = $1
       RETURNING id, name, role, wage_amount, wage_cycle, wage_day, wage_calendar, hired_on`,
      [
        waiterId,
        wage_amount,
        wage_cycle,
        wage_day,
        wage_calendar,
        hired_on || null,
      ],
    );
    if (!rows.length)
      return res.status(404).json({ error: "Waiter not found" });

    res.json({ ...rows[0], next_payday: nextPayday(rows[0]) });
  } catch (err) {
    console.error("updateWaiterWage", err);
    res.status(500).json({ error: "Failed to update wage config" });
  }
}

// ---------- PAYOUTS ----------

export async function listPayments(req: Request, res: Response) {
  const { waiter_id, from, to } = req.query;
  const params: any[] = [];
  const where: string[] = [];

  if (waiter_id) {
    params.push(waiter_id);
    where.push(`p.waiter_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`p.paid_on >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`p.paid_on <= $${params.length}`);
  }

  try {
    const { rows } = await pool.query(
      `SELECT p.*, w.name AS waiter_name
       FROM waiter_wage_payments p
       JOIN waiters w ON w.id = p.waiter_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY p.paid_on DESC, p.created_at DESC`,
      params,
    );
    res.json(rows);
  } catch (err) {
    console.error("listPayments", err);
    res.status(500).json({ error: "Failed to fetch wage payments" });
  }
}

/** Records a payout AND its matching expense row, atomically. */
export async function createPayment(req: Request, res: Response) {
  const {
    waiter_id,
    amount,
    period_start,
    period_end,
    paid_on,
    note,
    payment_method,
  } = req.body;

  if (!waiter_id || !amount || !period_start || !period_end) {
    return res.status(400).json({
      error: "waiter_id, amount, period_start and period_end are required",
    });
  }
  if (Number(amount) <= 0) {
    return res.status(400).json({ error: "amount must be greater than 0" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const payRes = await client.query(
      `INSERT INTO waiter_wage_payments
         (waiter_id, amount, period_start, period_end, paid_on, paid_by, note)
       VALUES ($1, $2, $3, $4,
               COALESCE($5::date, (now() AT TIME ZONE 'Africa/Addis_Ababa')::date), $6, $7)
       RETURNING *`,
      [
        waiter_id,
        amount,
        period_start,
        period_end,
        paid_on || null,
        ADMIN_ID,
        note || null,
      ],
    );
    const payment = payRes.rows[0];

    const waiterRes = await client.query(
      `SELECT name FROM waiters WHERE id = $1`,
      [waiter_id],
    );
    if (!waiterRes.rows.length) throw new Error("WAITER_NOT_FOUND");

    await client.query(
      `INSERT INTO expenses
         (category_id, wage_payment_id, description, amount,
          expense_date, payment_method, created_by, note)
       VALUES ((SELECT id FROM expense_categories WHERE name = 'Wages'),
               $1, $2, $3, $4, COALESCE($5, 'cash'), $6, $7)`,
      [
        payment.id,
        `Wage — ${waiterRes.rows[0].name} (${period_start} to ${period_end})`,
        amount,
        payment.paid_on,
        payment_method || null,
        ADMIN_ID,
        note || null,
      ],
    );

    await client.query("COMMIT");
    res.status(201).json({ ...payment, waiter_name: waiterRes.rows[0].name });
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ error: "This waiter has already been paid for that period" });
    }
    if (err.message === "WAITER_NOT_FOUND") {
      return res.status(404).json({ error: "Waiter not found" });
    }
    console.error("createPayment", err);
    res.status(500).json({ error: "Failed to record wage payment" });
  } finally {
    client.release();
  }
}

/** Deleting a payout removes its expense row too, via ON DELETE CASCADE. */
export async function deletePayment(req: Request, res: Response) {
  try {
    const paymentId = param(req.params.id);
    if (!UUID_RE.test(paymentId)) {
      return res.status(400).json({ error: "Invalid payment id" });
    }
    const { rowCount } = await pool.query(
      `DELETE FROM waiter_wage_payments WHERE id = $1`, [paymentId]
    );
    if (!rowCount) return res.status(404).json({ error: "Payment not found" });
    res.status(204).send();
  } catch (err) {
    console.error("deletePayment", err);
    res.status(500).json({ error: "Failed to delete payment" });
  }
}

/** Who's due — anyone whose next payday is today or overdue. */
export async function duePayments(_req: Request, res: Response) {
  try {
    const { rows } = await pool.query(
      `SELECT w.id, w.name, w.wage_amount, w.wage_cycle, w.wage_day, w.wage_calendar,
              lp.period_end AS last_period_end, lp.paid_on AS last_paid_on
       FROM waiters w
       LEFT JOIN LATERAL (
         SELECT * FROM waiter_wage_payments p
         WHERE p.waiter_id = w.id ORDER BY p.period_end DESC LIMIT 1
       ) lp ON TRUE
       WHERE w.is_active AND w.wage_amount > 0`,
    );

    const today = iso(addisNow());
    const due = rows
      .map((w) => ({ ...w, next_payday: nextPayday(w) }))
      .filter((w) => {
        if (!w.last_paid_on) return true;
        return (
          w.last_paid_on < today &&
          (!w.next_payday || w.next_payday.gregorian <= today)
        );
      });

    res.json(due);
  } catch (err) {
    console.error("duePayments", err);
    res.status(500).json({ error: "Failed to compute due payments" });
  }
}
