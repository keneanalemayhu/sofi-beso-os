// src/routes/menu.routes.ts

import { Router } from "express";
import { validateIdParam } from "../validation";
import {
  getMenu,
  getAllMenuItems,
  createMenuItem,
  updateMenuItem,
  toggleMenuItem,
  deleteMenuItem,
} from "../controllers/menu.controller";
import { resolveBranch } from "../middleware/branch";

const router = Router();

// A malformed id is a 400, not a database error.
router.param("id", validateIdParam);

router.get("/", resolveBranch, getMenu);
router.get("/all", getAllMenuItems);
router.post("/", createMenuItem);
router.patch("/:id/toggle", toggleMenuItem);
router.patch("/:id", updateMenuItem);
router.delete("/:id", deleteMenuItem);

export default router;