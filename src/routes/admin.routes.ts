import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import { uploadMiddleware } from "../middlewares/upload.middleware";
import * as adminController from "../controllers/admin.controller";
import * as orderController from "../controllers/order.controller";
import * as productController from "../controllers/product.controller";
import * as settingsController from "../controllers/settings.controller";
import * as shippingController from "../controllers/shipping.controller";

const router = Router();

// Todo /admin exige sesión de administración.
router.use(authMiddleware, adminMiddleware);

router.get("/stats", adminController.stats);
router.get("/customers", adminController.customers);

router.get("/products", productController.adminList);
router.post("/products", productController.adminCreate);
router.get("/products/:id", productController.adminGet);
router.put("/products/:id", productController.adminUpdate);
router.delete("/products/:id", productController.adminRemove);
router.post(
  "/products/:id/images",
  uploadMiddleware.single("file"),
  productController.adminAddImage,
);
// Comodín: el publicId de Cloudinary trae "/" y puede llegar partido en segmentos.
router.delete("/products/:id/images/*publicId", productController.adminRemoveImage);

router.get("/orders", orderController.adminList);
router.get("/orders/:id", orderController.adminGet);
router.post("/orders/:id/approve-transfer", orderController.adminApproveTransfer);
router.post("/orders/:id/ship", orderController.adminShip);
router.post("/orders/:id/deliver", orderController.adminDeliver);
router.post("/orders/:id/cancel", orderController.adminCancel);
router.post("/orders/:id/invoice", orderController.adminInvoice);
router.patch("/orders/:id/note", orderController.adminNote);

router.get("/shipping/zones", shippingController.adminListZones);
router.put("/shipping/zones/:id", shippingController.adminUpdateZone);

router.get("/settings", settingsController.adminGet);
router.put("/settings", settingsController.adminUpdate);

export default router;
