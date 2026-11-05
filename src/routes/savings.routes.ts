// src/routes/savings.routes.ts

import { Router } from "express";
import { validateIdParam } from "../validation";
import * as ctrl from "../controllers/savings.controller";

const router = Router();

// A malformed id is a 400, not a database error.
router.param("id", validateIdParam);

router.get("/plans", ctrl.listPlans);
router.post("/plans", ctrl.createPlan);
router.get("/plans/:id", ctrl.getPlanDetail);
router.patch("/plans/:id", ctrl.updatePlan);
router.delete("/plans/:id", ctrl.deletePlan);

router.post("/plans/:id/entries", ctrl.checkPeriod);
router.delete("/plans/:id/entries/:index", ctrl.uncheckPeriod);

export default router;