import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as orderService from "../services/order.service";

/** POST /api/orders — con o sin sesión (optionalAuthMiddleware). */
export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await orderService.createOrder(req.body ?? {}, req.user?.userId));
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders/confirm — body: { id, clientTransactionId } */
export async function confirm(req: Request, res: Response, next: NextFunction) {
  try {
    const { id, clientTransactionId } = req.body ?? {};
    res.status(200).json(await orderService.confirmCardPayment(id, clientTransactionId));
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/mine */
export async function mine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await orderService.listMine(req.user.userId));
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders/:number/proof — multipart: `file` + `email`. */
export async function uploadProof(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await orderService.uploadTransferProof(
      String(req.params.number),
      req.body?.email,
      req.file,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/:number?email= */
export async function getByNumber(req: Request, res: Response, next: NextFunction) {
  try {
    const email = typeof req.query.email === "string" ? req.query.email : "";
    res.status(200).json(await orderService.getPublicOrder(String(req.params.number), email));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/orders?status=&page= */
export async function adminList(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, page } = req.query;
    res.status(200).json(await orderService.listOrders({ status, page }));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/orders/:id */
export async function adminGet(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.getOrderById(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/orders/:id/approve-transfer */
export async function adminApproveTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.approveTransfer(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/orders/:id/ship — body: { trackingNote } */
export async function adminShip(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await orderService.shipOrder(String(req.params.id), req.body?.trackingNote);
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/orders/:id/deliver */
export async function adminDeliver(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.deliverOrder(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/orders/:id/cancel */
export async function adminCancel(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.cancelOrder(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/orders/:id/invoice — body: { issued } */
export async function adminInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await orderService.setInvoiceIssued(String(req.params.id), req.body?.issued);
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/admin/orders/:id/note — body: { adminNote } */
export async function adminNote(req: Request, res: Response, next: NextFunction) {
  try {
    const note = req.body?.adminNote ?? req.body?.note;
    res.status(200).json(await orderService.setAdminNote(String(req.params.id), note));
  } catch (error) {
    next(error);
  }
}
