// src/controllers/waiter.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";

export async function getWaiters(_: Request, res: Response) {
  try {
    const result = await pool.query(`
      SELECT id, name, is_active, created_at
      FROM waiters
      WHERE is_active = TRUE
      ORDER BY name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch waiters" });
  }
}

export async function getAllWaiters(_: Request, res: Response) {
  try {
    const result = await pool.query(`
      SELECT id, name, is_active, created_at
      FROM waiters
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch waiters" });
  }
}

export async function createWaiter(req: Request, res: Response) {
  const { name } = req.body as { name?: string };
  const trimmed = name?.trim();
  if (!trimmed) {
    return res.status(400).json({ error: "Waiter name is required" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO waiters (name) VALUES ($1)
       RETURNING id, name, is_active, created_at`,
      [trimmed],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A waiter with this name already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create waiter" });
  }
}

export async function updateWaiter(req: Request, res: Response) {
  const { name, is_active } = req.body as { name?: string; is_active?: boolean };
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (name !== undefined) {
    const t = name.trim();
    if (!t) return res.status(400).json({ error: "name cannot be empty" });
    fields.push(`name = $${i++}`);
    values.push(t);
  }
  if (is_active !== undefined) {
    fields.push(`is_active = $${i++}`);
    values.push(is_active);
  }
  if (fields.length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE waiters SET ${fields.join(", ")} WHERE id = $${i}
       RETURNING id, name, is_active, created_at`,
      values,
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Waiter not found" });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A waiter with this name already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update waiter" });
  }
}

export async function toggleWaiter(req: Request, res: Response) {
  try {
    const result = await pool.query(
      `UPDATE waiters SET is_active = NOT is_active WHERE id = $1
       RETURNING id, name, is_active, created_at`,
      [req.params.id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Waiter not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to toggle waiter" });
  }
}

export async function deleteWaiter(req: Request, res: Response) {
  try {
    const refCheck = await pool.query(
      `SELECT COUNT(*)::int AS count FROM orders WHERE waiter_id = $1`,
      [req.params.id],
    );
    if (refCheck.rows[0].count > 0) {
      return res.status(409).json({
        error: "This waiter has orders and cannot be deleted. Deactivate them instead.",
      });
    }
    const result = await pool.query(
      `DELETE FROM waiters WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Waiter not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete waiter" });
  }
}