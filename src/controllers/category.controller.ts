// src/controllers/category.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";

export async function getCategories(_: Request, res: Response) {
  try {
    const result = await pool.query(`
      SELECT
        c.id,
        c.name,
        c.created_at,
        COUNT(m.id)::int AS item_count
      FROM categories c
      LEFT JOIN menu_items m ON m.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
}

export async function createCategory(req: Request, res: Response) {
  const { name } = req.body as { name?: string };
  const trimmed = name?.trim();
  if (!trimmed) {
    return res.status(400).json({ error: "Category name is required" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO categories (name) VALUES ($1) RETURNING id, name, created_at`,
      [trimmed],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A category with this name already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create category" });
  }
}

export async function updateCategory(req: Request, res: Response) {
  const { name } = req.body as { name?: string };
  const trimmed = name?.trim();
  if (!trimmed) {
    return res.status(400).json({ error: "Category name is required" });
  }
  try {
    const result = await pool.query(
      `UPDATE categories SET name = $1 WHERE id = $2 RETURNING id, name, created_at`,
      [trimmed, req.params.id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A category with this name already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update category" });
  }
}

export async function deleteCategory(req: Request, res: Response) {
  try {
    const itemCheck = await pool.query(
      `SELECT COUNT(*)::int AS count FROM menu_items WHERE category_id = $1`,
      [req.params.id],
    );
    if (itemCheck.rows[0].count > 0) {
      return res.status(409).json({
        error:
          "Cannot delete a category that still has menu items. Move or delete the items first.",
      });
    }
    const result = await pool.query(
      `DELETE FROM categories WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete category" });
  }
}