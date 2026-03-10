// src/routes/analytics.routes.ts

import { Router } from "express";
import { todayAnalytics } from "../controllers/analytics.controller";

const router = Router();
router.get("/today", todayAnalytics);

export default router;