// src/routes/orders.routes.ts

import { Router } from "express";
import {
  createOrder,
  getActiveOrders,
  getActiveOrdersWithItems,
  getCompletedOrdersByDay,
  getOrderById,
  getOrdersWithItems,
  updateOrderStatus,
  printOrderById,
} from "../controllers/order.controller";

const router = Router();

router.get("/", getActiveOrders);
router.get("/active-with-items", getActiveOrdersWithItems);
router.get("/with-items", getOrdersWithItems);
router.get("/completed-by-day", getCompletedOrdersByDay);
router.post("/", createOrder);
router.patch("/:id/status", updateOrderStatus);
router.post("/:id/print", printOrderById);
router.get("/:id", getOrderById);

export default router;