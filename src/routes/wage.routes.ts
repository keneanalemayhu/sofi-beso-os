// src/routes/wage.routes.ts

import { Router } from "express";
import * as ctrl from "../controllers/wage.controller";

const router = Router();

router.get("/waiters", ctrl.listWaiterWages);
router.patch("/waiters/:id", ctrl.updateWaiterWage);

router.get("/due", ctrl.duePayments);

router.get("/payments", ctrl.listPayments);
router.post("/payments", ctrl.createPayment);
router.delete("/payments/:id", ctrl.deletePayment);

export default router;