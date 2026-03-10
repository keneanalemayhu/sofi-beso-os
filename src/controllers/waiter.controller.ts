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