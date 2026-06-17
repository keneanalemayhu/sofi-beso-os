// src/routes/category.routes.ts

import { Router } from "express";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/category.controller";

const router = Router();

router.get("/", getCategories);
router.post("/", createCategory);
router.patch("/:id", updateCategory);
router.delete("/:id", deleteCategory);

export default router;