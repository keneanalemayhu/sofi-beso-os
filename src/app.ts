// src/app.ts

import express from "express";
import cors from "cors";

import menuRoutes from "./routes/menu.routes";
import categoryRoutes from "./routes/category.routes";
import orderRoutes from "./routes/order.routes";
import analyticsRoutes from "./routes/analytics.routes";
import waiterRoutes from "./routes/waiter.routes";
import syncRoutes from "./routes/sync.routes";
import expenseRoutes from "./routes/expense.routes";
import savingsRoutes from "./routes/savings.routes";

export function createApp() {
  const app = express();

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin(origin, callback) {
        // allow curl / server-to-server (no Origin header)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    })
  );

  app.use(express.json());

  app.use("/menu", menuRoutes);
  app.use("/categories", categoryRoutes);
  app.use("/orders", orderRoutes);
  app.use("/analytics", analyticsRoutes);
  app.use("/waiters", waiterRoutes);
  app.use("/expenses", expenseRoutes);
  app.use("/savings", savingsRoutes);
  app.use("/sync", syncRoutes);

  app.get("/health", (_, res) => res.json({ ok: true }));

  return app;
}