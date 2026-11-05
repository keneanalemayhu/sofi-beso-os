// src/routes/wage.routes.ts

import { Router } from "express";
import { validateIdParam } from "../validation";
import * as ctrl from "../controllers/wage.controller";

const router = Router();

// A malformed id is a 400, not a database error.
router.param("id", validateIdParam);

router.get("/waiters", ctrl.listWaiterWages);
router.patch("/waiters/:id", ctrl.updateWaiterWage);

router.get("/due", ctrl.duePayments);

router.get("/payments", ctrl.listPayments);
router.post("/payments", ctrl.createPayment);
router.delete("/payments/:id", ctrl.deletePayment);

export default router;