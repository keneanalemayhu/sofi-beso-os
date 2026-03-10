// src/routes/orders.routes.ts

import { Router } from "express";
import {
  createOrder,
  getActiveOrders,
  getActiveOrdersWithItems,
  getOrderById,
  updateOrderStatus,
} from "../controllers/order.controller";

const router = Router();

router.get("/", getActiveOrders);
router.get("/active-with-items", getActiveOrdersWithItems);
router.post("/", createOrder);
router.get("/:id", getOrderById);
router.patch("/:id/status", updateOrderStatus);

export default router;