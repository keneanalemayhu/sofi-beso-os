// src/routes/settlement.routes.ts

import { Router } from "express";
import { resolveBranch } from "../middleware/branch";

import {
  getDailySettlements,
  saveDailySettlement,
} from "../controllers/settlement.controller";

const router = Router();

router.get("/", resolveBranch, getDailySettlements);
router.put("/", resolveBranch, saveDailySettlement);

export default router;
