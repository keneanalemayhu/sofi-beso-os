// src/routes/waiters.routes.ts

import { Router } from "express";
import { getWaiters } from "../controllers/waiter.controller";

const router = Router();

router.get("/", getWaiters);

export default router;