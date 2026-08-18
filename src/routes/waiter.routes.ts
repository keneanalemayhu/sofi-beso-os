// src/routes/waiters.routes.ts

import { Router } from "express";
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

router.get("/", resolveBranch, getWaiters);
router.get("/all", getAllWaiters);
router.post("/", createWaiter);
router.patch("/:id/toggle", toggleWaiter);
router.patch("/:id", updateWaiter);
router.delete("/:id", deleteWaiter);

export default router;