// src/routes/menu.routes.ts

import { Router } from "express";
import {
  getMenu,
  getAllMenuItems,
  createMenuItem,
  updateMenuItem,
  toggleMenuItem,
  deleteMenuItem,
} from "../controllers/menu.controller";

const router = Router();

router.get("/", getMenu);
router.get("/all", getAllMenuItems);
router.post("/", createMenuItem);
router.patch("/:id/toggle", toggleMenuItem);
router.patch("/:id", updateMenuItem);
router.delete("/:id", deleteMenuItem);

export default router;