// src/routes/branch.routes.ts

import { Router } from "express";
import * as ctrl from "../controllers/branch.controller";

const router = Router();

router.get("/", ctrl.listBranches);
router.get("/whoami", ctrl.whoAmI);
router.get("/devices", ctrl.listDevices);
router.post("/devices", ctrl.registerDevice);

export default router;