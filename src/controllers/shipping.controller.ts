import { Request, Response, NextFunction } from "express";
import * as shippingService from "../services/shipping.service";

/** GET /api/shipping/zones — { province, available }[] */
export async function listZones(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await shippingService.listPublicZones());
  } catch (error) {
    next(error);
  }
}

/** POST /api/shipping/quote — body: { province, items: [{ productId, variantId, qty }] } */
export async function quote(req: Request, res: Response, next: NextFunction) {
  try {
    const { province, items } = req.body ?? {};
    res.status(200).json(await shippingService.quote(String(province ?? ""), items));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/shipping/zones — zonas completas, con tarifas. */
export async function adminListZones(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await shippingService.listZones());
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/shipping/zones/:id */
export async function adminUpdateZone(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await shippingService.updateZone(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}
