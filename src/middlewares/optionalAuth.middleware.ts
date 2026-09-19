import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthRequest, JwtPayload } from "../types/AuthRequest";

/**
 * Sesión opcional: la tienda permite comprar como invitado. Con un Bearer
 * válido deja `req.user`; sin token, o con uno vencido, sigue sin error para
 * que un token viejo en el navegador no bloquee una compra.
 */
export function optionalAuthMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(authHeader.split(" ")[1], env.JWT_SECRET) as JwtPayload;
    } catch {
      req.user = undefined;
    }
  }

  next();
}
