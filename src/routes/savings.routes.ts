// src/routes/savings.routes.ts

import { Router } from "express";
import * as ctrl from "../controllers/savings.controller";

const router = Router();

router.get("/plans", ctrl.listPlans);
router.post("/plans", ctrl.createPlan);
router.get("/plans/:id", ctrl.getPlanDetail);
router.patch("/plans/:id", ctrl.updatePlan);
router.delete("/plans/:id", ctrl.deletePlan);

router.post("/plans/:id/entries", ctrl.checkPeriod);
router.delete("/plans/:id/entries/:index", ctrl.uncheckPeriod);

export default router;