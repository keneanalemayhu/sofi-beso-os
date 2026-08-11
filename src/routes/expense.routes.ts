// src/routes/expense.routes.ts

import { Router } from "express";
import * as ctrl from "../controllers/expense.controller";

const router = Router();

// Static paths first so they aren't swallowed by /:id
router.get("/categories", ctrl.listCategories);
router.post("/categories", ctrl.createCategory);

router.get("/recurring", ctrl.listRecurring);
router.post("/recurring", ctrl.createRecurring);
router.patch("/recurring/:id", ctrl.updateRecurring);
router.delete("/recurring/:id", ctrl.deleteRecurring);
router.post("/recurring/generate", ctrl.generateDue);

router.get("/summary", ctrl.expenseSummary);

router.get("/", ctrl.listExpenses);
router.post("/", ctrl.createExpense);
router.patch("/:id", ctrl.updateExpense);
router.delete("/:id", ctrl.deleteExpense);

export default router;