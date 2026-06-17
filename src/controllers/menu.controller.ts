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

export async function getAllMenuItems(_: Request, res: Response) {
  try {
    const result = await pool.query(`
      SELECT m.*, c.name AS category_name
      FROM menu_items m
      JOIN categories c ON m.category_id = c.id
      ORDER BY c.name, m.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch menu items" });
  }
}

export async function createMenuItem(req: Request, res: Response) {
  const { category_id, name, price, is_active } = req.body as {
    category_id?: string;
    name?: string;
    price?: number;
    is_active?: boolean;
  };
  const trimmedName = name?.trim();
  if (!category_id || !trimmedName || typeof price !== "number" || price < 0) {
    return res
      .status(400)
      .json({ error: "category_id, name, and a non-negative price are required" });
  }
  try {
    const inserted = await pool.query(
      `INSERT INTO menu_items (category_id, name, price, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [category_id, trimmedName, price, is_active ?? true],
    );
    const withCat = await pool.query(
      `SELECT m.*, c.name AS category_name
       FROM menu_items m
       JOIN categories c ON m.category_id = c.id
       WHERE m.id = $1`,
      [inserted.rows[0].id],
    );
    res.status(201).json(withCat.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res
        .status(409)
        .json({ error: "An item with this name already exists in this category" });
    }
    if (err?.code === "23503") {
      return res.status(400).json({ error: "Invalid category" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create menu item" });
  }
}

export async function updateMenuItem(req: Request, res: Response) {
  const { category_id, name, price, is_active } = req.body as {
    category_id?: string;
    name?: string;
    price?: number;
    is_active?: boolean;
  };

  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (category_id !== undefined) {
    fields.push(`category_id = $${i++}`);
    values.push(category_id);
  }
  if (name !== undefined) {
    const t = name.trim();
    if (!t) return res.status(400).json({ error: "name cannot be empty" });
    fields.push(`name = $${i++}`);
    values.push(t);
  }
  if (price !== undefined) {
    if (typeof price !== "number" || price < 0) {
      return res.status(400).json({ error: "price must be a non-negative number" });
    }
    fields.push(`price = $${i++}`);
    values.push(price);
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
      `UPDATE menu_items SET ${fields.join(", ")} WHERE id = $${i} RETURNING id`,
      values,
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Menu item not found" });
    }
    const withCat = await pool.query(
      `SELECT m.*, c.name AS category_name
       FROM menu_items m
       JOIN categories c ON m.category_id = c.id
       WHERE m.id = $1`,
      [req.params.id],
    );
    res.json(withCat.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res
        .status(409)
        .json({ error: "An item with this name already exists in this category" });
    }
    if (err?.code === "23503") {
      return res.status(400).json({ error: "Invalid category" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update menu item" });
  }
}

export async function toggleMenuItem(req: Request, res: Response) {
  try {
    const result = await pool.query(
      `UPDATE menu_items SET is_active = NOT is_active WHERE id = $1
       RETURNING *`,
      [req.params.id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Menu item not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to toggle menu item" });
  }
}

export async function deleteMenuItem(req: Request, res: Response) {
  try {
    const refCheck = await pool.query(
      `SELECT COUNT(*)::int AS count FROM order_items WHERE menu_item_id = $1`,
      [req.params.id],
    );
    if (refCheck.rows[0].count > 0) {
      return res.status(409).json({
        error:
          "This item appears in past orders and cannot be deleted. Deactivate it instead.",
      });
    }
    const result = await pool.query(
      `DELETE FROM menu_items WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Menu item not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete menu item" });
  }
}