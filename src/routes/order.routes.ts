import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { optionalAuthMiddleware } from "../middlewares/optionalAuth.middleware";
import { uploadMiddleware } from "../middlewares/upload.middleware";
import * as orderController from "../controllers/order.controller";

const router = Router();

router.post("/", optionalAuthMiddleware, orderController.create);

// Rutas fijas ANTES de "/:number": si no, "mine" y "confirm" se leerían como
// un número de orden.
router.get("/mine", authMiddleware, orderController.mine);
router.post("/confirm", orderController.confirm);

router.post("/:number/proof", uploadMiddleware.single("file"), orderController.uploadProof);
router.get("/:number", orderController.getByNumber);

export default router;
