// src/controllers/expense.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";

const ADMIN_ID = process.env.ADMIN_USER_ID || null;

/** Addis-local today, as YYYY-MM-DD */
function addisToday(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ---------- EXPENSES ----------

export async function listExpenses(req: Request, res: Response) {
  const { from, to, category_id } = req.query;
  const params: any[] = [];
  const where: string[] = [];

  if (from) { params.push(from); where.push(`e.expense_date >= $${params.length}`); }
  if (to)   { params.push(to);   where.push(`e.expense_date <= $${params.length}`); }
  if (category_id) { params.push(category_id); where.push(`e.category_id = $${params.length}`); }

  try {
    const { rows } = await pool.query(
      `SELECT e.*, c.name AS category_name,
              (e.recurring_expense_id IS NOT NULL) AS is_recurring,
              (e.wage_payment_id IS NOT NULL) AS is_wage,
              w.name AS waiter_name
       FROM expenses e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN waiter_wage_payments wp ON wp.id = e.wage_payment_id
       LEFT JOIN waiters w ON w.id = wp.waiter_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY e.expense_date DESC, e.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("listExpenses", err);
    res.status(500).json({ error: "Failed to fetch expenses" });
  }
}

export async function createExpense(req: Request, res: Response) {
  const { category_id, description, amount, expense_date, payment_method, note } = req.body;

  if (!description || !amount) {
    return res.status(400).json({ error: "description and amount are required" });
  }
  if (Number(amount) <= 0) {
    return res.status(400).json({ error: "amount must be greater than 0" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO expenses
         (category_id, description, amount, expense_date, payment_method, note, created_by)
       VALUES ($1, $2, $3, COALESCE($4::date, $7::date), COALESCE($5, 'cash'), $6, $8)
       RETURNING *`,
      [category_id || null, description, amount, expense_date || null,
       payment_method || null, note || null, addisToday(), ADMIN_ID]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createExpense", err);
    res.status(500).json({ error: "Failed to create expense" });
  }
}

export async function updateExpense(req: Request, res: Response) {
  const { id } = req.params;
  const { category_id, description, amount, expense_date, payment_method, note } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE expenses SET
         category_id    = COALESCE($2, category_id),
         description    = COALESCE($3, description),
         amount         = COALESCE($4, amount),
         expense_date   = COALESCE($5::date, expense_date),
         payment_method = COALESCE($6, payment_method),
         note           = COALESCE($7, note)
       WHERE id = $1 AND wage_payment_id IS NULL
       RETURNING *`,
      [id, category_id, description, amount, expense_date, payment_method, note]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Expense not found, or is a wage payout (edit the payout instead)" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("updateExpense", err);
    res.status(500).json({ error: "Failed to update expense" });
  }
}

export async function deleteExpense(req: Request, res: Response) {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM expenses WHERE id = $1 AND wage_payment_id IS NULL`,
      [req.params.id]
    );
    if (!rowCount) {
      return res.status(404).json({ error: "Expense not found, or is a wage payout" });
    }
    res.status(204).send();
  } catch (err) {
    console.error("deleteExpense", err);
    res.status(500).json({ error: "Failed to delete expense" });
  }
}

// ---------- CATEGORIES ----------

export async function listCategories(_req: Request, res: Response) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM expense_categories ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error("listCategories", err);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
}

export async function createCategory(req: Request, res: Response) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  try {
    const { rows } = await pool.query(
      `INSERT INTO expense_categories (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING RETURNING *`,
      [name]
    );
    if (!rows.length) return res.status(409).json({ error: "Category already exists" });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createCategory", err);
    res.status(500).json({ error: "Failed to create category" });
  }
}

// ---------- RECURRING ----------

export async function listRecurring(_req: Request, res: Response) {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, c.name AS category_name,
              (SELECT MAX(expense_date) FROM expenses e
               WHERE e.recurring_expense_id = r.id) AS last_generated
       FROM recurring_expenses r
       LEFT JOIN expense_categories c ON c.id = r.category_id
       ORDER BY r.is_active DESC, r.description`
    );
    res.json(rows);
  } catch (err) {
    console.error("listRecurring", err);
    res.status(500).json({ error: "Failed to fetch recurring expenses" });
  }
}

export async function createRecurring(req: Request, res: Response) {
  const { category_id, description, amount, frequency,
          day_of_week, day_of_month, start_date, end_date } = req.body;

  if (!description || !amount || !frequency) {
    return res.status(400).json({ error: "description, amount and frequency are required" });
  }
  if (frequency === "weekly" && !day_of_week) {
    return res.status(400).json({ error: "day_of_week (1-7) is required for weekly" });
  }
  if (frequency === "monthly" && !day_of_month) {
    return res.status(400).json({ error: "day_of_month (1-31) is required for monthly" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO recurring_expenses
         (category_id, description, amount, frequency, day_of_week, day_of_month, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, $9::date), $8)
       RETURNING *`,
      [category_id || null, description, amount, frequency,
       frequency === "weekly" ? day_of_week : null,
       frequency === "monthly" ? day_of_month : null,
       start_date || null, end_date || null, addisToday()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createRecurring", err);
    res.status(500).json({ error: "Failed to create recurring expense" });
  }
}

export async function updateRecurring(req: Request, res: Response) {
  const { id } = req.params;
  const { description, amount, is_active, end_date } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE recurring_expenses SET
         description = COALESCE($2, description),
         amount      = COALESCE($3, amount),
         is_active   = COALESCE($4, is_active),
         end_date    = COALESCE($5::date, end_date)
       WHERE id = $1 RETURNING *`,
      [id, description, amount, is_active, end_date]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("updateRecurring", err);
    res.status(500).json({ error: "Failed to update recurring expense" });
  }
}

export async function deleteRecurring(req: Request, res: Response) {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM recurring_expenses WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (err) {
    console.error("deleteRecurring", err);
    res.status(500).json({ error: "Failed to delete recurring expense" });
  }
}

/** Manual trigger — same function cron calls at 23:55 Addis. */
export async function generateDue(req: Request, res: Response) {
  try {
    const { rows } = await pool.query(
      `SELECT generate_due_expenses($1::date) AS created`,
      [req.body?.date || null]
    );
    res.json({ created: rows[0].created });
  } catch (err) {
    console.error("generateDue", err);
    res.status(500).json({ error: "Failed to generate expenses" });
  }
}

// ---------- SUMMARY ----------

export async function expenseSummary(req: Request, res: Response) {
  const from = (req.query.from as string) || addisToday().slice(0, 8) + "01";
  const to   = (req.query.to as string)   || addisToday();

  try {
    const [byCategory, totals] = await Promise.all([
      pool.query(
        `SELECT COALESCE(c.name, 'Uncategorized') AS category,
                SUM(e.amount) AS total, COUNT(*) AS count
         FROM expenses e
         LEFT JOIN expense_categories c ON c.id = e.category_id
         WHERE e.expense_date BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 2 DESC`,
        [from, to]
      ),
      pool.query(
        `SELECT COALESCE(SUM(revenue), 0)  AS revenue,
                COALESCE(SUM(expenses), 0) AS expenses,
                COALESCE(SUM(savings), 0)  AS savings,
                COALESCE(SUM(available_cash), 0) AS available_cash
         FROM daily_cash_flow WHERE day BETWEEN $1 AND $2`,
        [from, to]
      ),
    ]);

    res.json({ from, to, totals: totals.rows[0], by_category: byCategory.rows });
  } catch (err) {
    console.error("expenseSummary", err);
    res.status(500).json({ error: "Failed to build summary" });
  }
}