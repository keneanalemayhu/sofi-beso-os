// src/controllers/branch.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";

export async function listBranches(_req: Request, res: Response) {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug, is_active FROM branches
       WHERE is_active ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error("listBranches", err);
    res.status(500).json({ error: "Failed to fetch branches" });
  }
}

/** What branch am I? Called by the POS on boot. */
export async function whoAmI(req: Request, res: Response) {
  const deviceId = (req.header("X-Device-Id") || "").trim();
  if (!deviceId) return res.status(400).json({ error: "X-Device-Id required" });

  try {
    const { rows } = await pool.query(
      `SELECT d.device_id, d.name AS device_name,
              b.id AS branch_id, b.name AS branch_name, b.slug
       FROM devices d JOIN branches b ON b.id = d.branch_id
       WHERE d.device_id = $1`,
      [deviceId]
    );
    if (!rows.length) {
      return res.status(428).json({ error: "DEVICE_NOT_REGISTERED", device_id: deviceId });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("whoAmI", err);
    res.status(500).json({ error: "Failed to identify device" });
  }
}

/** Pair a tablet to a branch. Called once from the setup screen. */
export async function registerDevice(req: Request, res: Response) {
  const { device_id, branch_id, name } = req.body as {
    device_id?: string;
    branch_id?: string;
    name?: string;
  };
  if (!device_id || !branch_id) {
    return res.status(400).json({ error: "device_id and branch_id are required" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO devices (device_id, branch_id, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (device_id) DO UPDATE
         SET branch_id = EXCLUDED.branch_id,
             name = COALESCE(EXCLUDED.name, devices.name)
       RETURNING *`,
      [device_id.trim(), branch_id, name?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err?.code === "23503") {
      return res.status(400).json({ error: "Unknown branch" });
    }
    console.error("registerDevice", err);
    res.status(500).json({ error: "Failed to register device" });
  }
}

export async function listDevices(_req: Request, res: Response) {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, b.name AS branch_name
       FROM devices d JOIN branches b ON b.id = d.branch_id
       ORDER BY b.name, d.device_id`
    );
    res.json(rows);
  } catch (err) {
    console.error("listDevices", err);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
}