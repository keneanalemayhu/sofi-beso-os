// src/routes/order.routes.ts

import { Router } from "express";
import { validateIdParam } from "../validation";
import {
  createOrder,
  getActiveOrders,
  getActiveOrdersWithItems,
  getCompletedOrdersByDay,
  getOrderById,
  getOrdersWithItems,
  getOrdersByRange,
  updateOrderStatus,
  printOrderById,
} from "../controllers/order.controller";
import { resolveBranch } from "../middleware/branch";

const router = Router();

// A malformed id is a 400, not a database error.
router.param("id", validateIdParam);

// POS routes — branch resolved from the tablet's device id
router.get("/", resolveBranch, getActiveOrders);
router.get("/active-with-items", resolveBranch, getActiveOrdersWithItems);
router.get("/with-items", resolveBranch, getOrdersWithItems);
router.get("/completed-by-day", resolveBranch, getCompletedOrdersByDay);
router.post("/", resolveBranch, createOrder);
router.patch("/:id/status", resolveBranch, updateOrderStatus);

// Admin routes — not branch-scoped yet
router.get("/by-range", getOrdersByRange);
router.post("/:id/print", printOrderById);
router.get("/:id", getOrderById);

export default router;