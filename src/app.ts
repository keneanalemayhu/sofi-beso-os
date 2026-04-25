// src/app.ts

import express from "express";
import cors from "cors";

import menuRoutes from "./routes/menu.routes";
import orderRoutes from "./routes/order.routes";
import analyticsRoutes from "./routes/analytics.routes";
import waiterRoutes from "./routes/waiter.routes";
import syncRoutes from "./routes/sync.routes";

export function createApp() {
  const app = express();

  const allowedOrigin = process.env.FRONTEND_URL || "*";

  app.use(
    cors({
      origin: allowedOrigin,
      credentials: true,
    })
  );

  app.use(express.json());

  app.use("/menu", menuRoutes);
  app.use("/orders", orderRoutes);
  app.use("/analytics", analyticsRoutes);
  app.use("/waiters", waiterRoutes);
  app.use("/sync", syncRoutes);

  app.get("/health", (_, res) => res.json({ ok: true }));

  return app;
}