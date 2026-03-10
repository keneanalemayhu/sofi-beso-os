// src/controllers/analytics.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";

export async function todayAnalytics(_: Request, res: Response) {
  try {
    const summary = await pool.query(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount), 0) AS total_sales
      FROM orders
      WHERE status = 'completed'
        AND completed_at >= date_trunc('day', now())
        AND completed_at < date_trunc('day', now()) + interval '1 day'
    `);

    res.json({
      summary: summary.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Analytics failed" });
  }
}