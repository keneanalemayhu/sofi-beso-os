// src/middleware/branch.ts

import { Request, Response, NextFunction } from "express";
import { pool } from "../db";

declare global {
  namespace Express {
    interface Request {
      branchId?: string;
      deviceId?: string;
    }
  }
}

/**
 * Cache device -> branch. Devices are re-registered rarely; a short TTL
 * keeps a moved tablet from being stale for long.
 */
const cache = new Map<string, { branchId: string; at: number }>();
const TTL_MS = 60_000;

/** Set only during rollout, while tablets still run the pre-branch bundle. */
const FALLBACK_SLUG = process.env.DEFAULT_BRANCH_SLUG || null;

export async function resolveBranch(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const deviceId =
    (req.header("X-Device-Id") || req.body?.device_id || "").trim() || null;

  try {
    if (deviceId) {
      const hit = cache.get(deviceId);
      if (hit && Date.now() - hit.at < TTL_MS) {
        req.deviceId = deviceId;
        req.branchId = hit.branchId;
        return next();
      }

      const { rows } = await pool.query(
        `UPDATE devices SET last_seen_at = NOW()
         WHERE device_id = $1
         RETURNING branch_id`,
        [deviceId]
      );

      if (rows.length) {
        cache.set(deviceId, { branchId: rows[0].branch_id, at: Date.now() });
        req.deviceId = deviceId;
        req.branchId = rows[0].branch_id;
        return next();
      }

      return res.status(428).json({
        error: "DEVICE_NOT_REGISTERED",
        message: "This device is not registered to a branch.",
        device_id: deviceId,
      });
    }

    if (FALLBACK_SLUG) {
      const { rows } = await pool.query(
        `SELECT id FROM branches WHERE slug = $1`,
        [FALLBACK_SLUG]
      );
      if (rows.length) {
        req.branchId = rows[0].id;
        return next();
      }
    }

    return res.status(428).json({
      error: "DEVICE_NOT_REGISTERED",
      message: "No device id supplied.",
    });
  } catch (err) {
    console.error("resolveBranch", err);
    res.status(500).json({ error: "Failed to resolve branch" });
  }
}