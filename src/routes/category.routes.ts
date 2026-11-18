// src/routes/category.routes.ts

import { Router } from "express";
import { validateIdParam } from "../validation";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/category.controller";

const router = Router();

// A malformed id is a 400, not a database error.
router.param("id", validateIdParam);

router.get("/", getCategories);
router.post("/", createCategory);
router.patch("/:id", updateCategory);
router.delete("/:id", deleteCategory);

export default router;