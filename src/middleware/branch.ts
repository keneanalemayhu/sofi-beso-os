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

const TTL_MS = 60_000;

/** slug -> branch id */
const branchCache = new Map<string, { branchId: string; at: number }>();
/** device id -> branch id */
const deviceCache = new Map<string, { branchId: string; at: number }>();

/** Used when a request carries no branch slug (legacy tablets). */
const FALLBACK_SLUG = process.env.DEFAULT_BRANCH_SLUG || null;

export async function resolveBranch(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const slug = (req.header("X-Branch-Slug") || "").trim() || null;
  const deviceId =
    (req.header("X-Device-Id") || req.body?.device_id || "").trim() || null;

  // Recorded on orders for sync dedup regardless of how branch was resolved
  if (deviceId) req.deviceId = deviceId;

  try {
    // 1. Branch from the URL the tablet is on
    const wanted = slug || FALLBACK_SLUG;
    if (wanted) {
      const hit = branchCache.get(wanted);
      if (hit && Date.now() - hit.at < TTL_MS) {
        req.branchId = hit.branchId;
        return next();
      }

      const { rows } = await pool.query(
        `SELECT id FROM branches WHERE slug = $1 AND is_active`,
        [wanted],
      );
      if (rows.length) {
        branchCache.set(wanted, { branchId: rows[0].id, at: Date.now() });
        req.branchId = rows[0].id;
        return next();
      }
      if (slug) {
        return res.status(404).json({ error: "UNKNOWN_BRANCH", slug });
      }
    }

    // 2. Fall back to a registered device
    if (deviceId) {
      const cached = deviceCache.get(deviceId);
      if (cached && Date.now() - cached.at < TTL_MS) {
        req.branchId = cached.branchId;
        return next();
      }

      const { rows } = await pool.query(
        `UPDATE devices SET last_seen_at = NOW()
         WHERE device_id = $1 RETURNING branch_id`,
        [deviceId],
      );
      if (rows.length) {
        deviceCache.set(deviceId, { branchId: rows[0].branch_id, at: Date.now() });
        req.branchId = rows[0].branch_id;
        return next();
      }
    }

    return res.status(428).json({
      error: "BRANCH_NOT_RESOLVED",
      message: "No branch could be determined for this request.",
    });
  } catch (err) {
    console.error("resolveBranch", err);
    res.status(500).json({ error: "Failed to resolve branch" });
  }
}