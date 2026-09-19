import { Router } from "express";
import * as shippingController from "../controllers/shipping.controller";

const router = Router();

router.get("/zones", shippingController.listZones);
router.post("/quote", shippingController.quote);

export default router;
