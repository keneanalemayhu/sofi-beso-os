// src/routes/waiters.routes.ts

import { Router } from "express";
import { validateIdParam } from "../validation";
import {
  getWaiters,
  getAllWaiters,
  createWaiter,
  updateWaiter,
  toggleWaiter,
  deleteWaiter,
} from "../controllers/waiter.controller";
import { resolveBranch } from "../middleware/branch";

const router = Router();

// A malformed id is a 400, not a database error.
router.param("id", validateIdParam);

router.get("/", resolveBranch, getWaiters);
router.get("/all", getAllWaiters);
router.post("/", createWaiter);
router.patch("/:id/toggle", toggleWaiter);
router.patch("/:id", updateWaiter);
router.delete("/:id", deleteWaiter);

export default router;