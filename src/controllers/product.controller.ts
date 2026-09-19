import { Request, Response, NextFunction } from "express";
import * as productService from "../services/product.service";

/** GET /api/products?category= */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    res.status(200).json(await productService.listPublished(category));
  } catch (error) {
    next(error);
  }
}

/** GET /api/products/:slug */
export async function getBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.getPublishedBySlug(String(req.params.slug)));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/products — incluye borradores y variantes inactivas. */
export async function adminList(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.listAll());
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/products/:id */
export async function adminGet(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.getById(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/products */
export async function adminCreate(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await productService.createProduct(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/products/:id */
export async function adminUpdate(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.updateProduct(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/products/:id */
export async function adminRemove(req: Request, res: Response, next: NextFunction) {
  try {
    await productService.deleteProduct(String(req.params.id));
    res.status(200).json({ message: "Producto eliminado" });
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/products/:id/images — multipart, campo `file`. */
export async function adminAddImage(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.addImage(String(req.params.id), req.file));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/products/:id/images/:publicId — `publicId` url-encoded. */
export async function adminRemoveImage(req: Request, res: Response, next: NextFunction) {
  try {
    // El publicId de Cloudinary lleva "/" (carpeta). Según el proxy puede
    // llegar como un segmento codificado o ya partido en varios.
    const raw = req.params.publicId as unknown;
    const publicId = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
    res.status(200).json(await productService.removeImage(String(req.params.id), publicId));
  } catch (error) {
    next(error);
  }
}
