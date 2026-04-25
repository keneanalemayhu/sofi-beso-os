// src/routes/sync.routes.ts

import { Router } from "express";
import {
  getUnsyncedOrders,
  markOrdersSynced,
  receiveOrders,
} from "../controllers/sync.controller";

const router = Router();

router.get("/orders/unsynced", getUnsyncedOrders);
router.post("/orders/receive", receiveOrders);
router.post("/orders/mark-synced", markOrdersSynced);

export default router;