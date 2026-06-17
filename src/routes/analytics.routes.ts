// src/routes/analytics.routes.ts

import { Router } from "express";
import {
  todayAnalytics,
  overviewAnalytics,
} from "../controllers/analytics.controller";

const router = Router();

router.get("/today", todayAnalytics);
router.get("/overview", overviewAnalytics);

export default router;