// src/controllers/menu.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";

export async function getMenu(_: Request, res: Response) {
  try {
    const result = await pool.query(`
      SELECT m.*, c.name AS category_name
      FROM menu_items m
      JOIN categories c ON m.category_id = c.id
      WHERE m.is_active = TRUE
      ORDER BY c.name, m.name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch menu" });
  }
}