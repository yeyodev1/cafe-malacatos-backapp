import { Router } from "express";
import * as settingsController from "../controllers/settings.controller";

const router = Router();

router.get("/public", settingsController.getPublic);

export default router;
