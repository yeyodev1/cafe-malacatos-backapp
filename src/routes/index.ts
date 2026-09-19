import express, { Application } from "express";
import adminRoutes from "./admin.routes";
import authRoutes from "./auth.routes";
import healthRoutes from "./health.routes";
import orderRoutes from "./order.routes";
import productRoutes from "./product.routes";
import settingsRoutes from "./settings.routes";
import shippingRoutes from "./shipping.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use("/health", healthRoutes);
  router.use("/auth", authRoutes);
  router.use("/products", productRoutes);
  router.use("/shipping", shippingRoutes);
  router.use("/settings", settingsRoutes);
  router.use("/orders", orderRoutes);
  router.use("/admin", adminRoutes);
}

export default routerApi;
