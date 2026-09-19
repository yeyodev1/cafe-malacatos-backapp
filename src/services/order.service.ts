import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { CustomError } from "../errors/customError.error";
import { nextSequence } from "../models/counter.model";
import {
  BILLING_ID_TYPES,
  BillingIdType,
  Order,
  ORDER_STATUSES,
  OrderStatus,
  PAYMENT_METHODS,
  PaymentMethod,
} from "../models/order.model";
import { deleteImage, uploadBuffer } from "./cloudinary.service";
import * as orderEmail from "./orderEmail.service";
import * as payphoneService from "./payphone.service";
import { resolveCart } from "./product.service";
import { getPublicSettings } from "./settings.service";
import { computeShippingCents, findZoneByProvince, isZoneAvailable } from "./shipping.service";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PROOFS_FOLDER = "cafe-malacatos/comprobantes";
const PAGE_SIZE = 20;
/** Estados en los que el dinero ya entró. */
const PAID_STATUSES: OrderStatus[] = ["paid", "shipped", "delivered"];

// ---------- Helpers ----------

function text(value: unknown, max = 300): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function requiredText(value: unknown, message: string, max = 300): string {
  const result = text(value, max);
  if (!result) throw new CustomError(message, 400);
  return result;
}

function requiredEmail(value: unknown, message: string): string {
  const email = text(value, 200).toLowerCase();
  if (!EMAIL.test(email)) throw new CustomError(message, 400);
  return email;
}

function coordinate(value: unknown, limit: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

/** Las rutas públicas nunca exponen la respuesta de Payphone ni la nota interna. */
export function toPublicOrder(order: any) {
  const json = order.toJSON();
  delete json.payphone;
  delete json.adminNote;
  return json;
}

/** Un correo que falla se registra, pero nunca tumba la compra. */
async function safely(label: string, tasks: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected")
      console.error(`[order] falló un correo de ${label}:`, result.reason);
  }
}

async function findByIdOrFail(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new CustomError("Pedido no encontrado", 404);
  const order = await Order.findById(id);
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  return order;
}

/**
 * Busca por número y exige que el correo coincida. Si no coincide responde lo
 * mismo que si no existiera: la ruta no sirve para averiguar números de orden.
 */
async function findByNumberAndEmail(number: string, email: unknown) {
  const notFound = new CustomError("Pedido no encontrado", 404);
  const wanted = text(email, 200).toLowerCase();
  if (!wanted) throw notFound;
  const order = await Order.findOne({ number: text(number, 30).toUpperCase() });
  if (!order || order.customer.email.toLowerCase() !== wanted) throw notFound;
  return order;
}

function parseCustomer(input: any) {
  return {
    name: requiredText(input?.name, "Escribe tu nombre", 120),
    email: requiredEmail(input?.email, "Escribe un correo válido"),
    phone: requiredText(input?.phone, "Escribe tu teléfono", 30),
  };
}

function parseShipping(input: any) {
  return {
    province: requiredText(input?.province, "Elige la provincia de envío", 60),
    city: requiredText(input?.city, "Escribe la ciudad de envío", 80),
    address: requiredText(input?.address, "Escribe la dirección de envío"),
    reference: text(input?.reference),
    lat: coordinate(input?.lat, 90),
    lng: coordinate(input?.lng, 180),
  };
}

function parseBilling(
  input: any,
  customer: { name: string; email: string; phone: string },
  address: string,
) {
  const idType = input?.idType as BillingIdType;
  if (!BILLING_ID_TYPES.includes(idType)) {
    throw new CustomError("Elige el tipo de identificación para la factura", 400);
  }

  // Consumidor final no lleva datos propios: se completa con los del comprador.
  if (idType === "consumidor_final") {
    return {
      idType,
      idNumber: text(input?.idNumber, 20) || "9999999999999",
      name: text(input?.name, 160) || "Consumidor final",
      address: text(input?.address) || address,
      email: EMAIL.test(text(input?.email, 200).toLowerCase())
        ? text(input?.email, 200).toLowerCase()
        : customer.email,
      phone: text(input?.phone, 30) || customer.phone,
    };
  }

  return {
    idType,
    idNumber: requiredText(
      input?.idNumber,
      "Escribe el número de identificación para la factura",
      20,
    ),
    name: requiredText(input?.name, "Escribe el nombre o razón social para la factura", 160),
    address: requiredText(input?.address, "Escribe la dirección para la factura"),
    email: requiredEmail(input?.email, "Escribe un correo válido para la factura"),
    phone: requiredText(input?.phone, "Escribe el teléfono para la factura", 30),
  };
}

// ---------- Tienda ----------

export async function createOrder(input: any, userId?: string) {
  const paymentMethod = input?.paymentMethod as PaymentMethod;
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new CustomError("Elige cómo quieres pagar: tarjeta o transferencia", 400);
  }

  const customer = parseCustomer(input?.customer);
  const shipping = parseShipping(input?.shipping);
  const billing = parseBilling(input?.billing, customer, shipping.address);

  // Precios, peso, envío y total salen de la base. Cualquier monto que venga
  // en el body se ignora.
  const cart = await resolveCart(input?.items);

  const zone = await findZoneByProvince(shipping.province);
  if (!isZoneAvailable(zone)) {
    throw new CustomError(
      `Todavía no tenemos tarifa de envío en línea para ${zone.province}. Este pedido se cierra por WhatsApp.`,
      400,
    );
  }
  shipping.province = zone.province;

  const shippingCents = computeShippingCents(zone, cart.totalWeightGrams);
  const totalCents = cart.subtotalCents + shippingCents;
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new CustomError("No se pudo calcular el total del pedido", 400);
  }

  const settings = await getPublicSettings();
  if (paymentMethod === "transfer" && !settings.transferEnabled) {
    throw new CustomError("El pago por transferencia no está disponible por ahora", 400);
  }
  // Antes de gastar un número de orden: sin credenciales no hay cobro posible.
  if (paymentMethod === "card") payphoneService.requirePayphone();

  const sequence = await nextSequence("order");
  const number = `CM-${String(sequence).padStart(6, "0")}`;
  // Payphone exige un id único por intento y de máximo 50 caracteres.
  const clientTransactionId = `${number}-${randomBytes(4).toString("hex")}`.slice(0, 50);

  const order = await Order.create({
    number,
    user: userId && mongoose.isValidObjectId(userId) ? userId : null,
    customer,
    shipping,
    billing,
    items: cart.lines,
    subtotalCents: cart.subtotalCents,
    shippingCents,
    totalCents,
    totalWeightGrams: cart.totalWeightGrams,
    paymentMethod,
    status: "pending",
    clientTransactionId,
  });

  await safely("orden nueva", [
    orderEmail.sendOrderReceived(order, {
      bankAccounts: settings.bankAccounts,
      transferInstructions: settings.transferInstructions,
    }),
    orderEmail.sendAdminNewOrder(order),
  ]);

  if (paymentMethod === "card") {
    return { order: toPublicOrder(order), payphone: payphoneService.buildPaymentBox(order) };
  }
  return {
    order: toPublicOrder(order),
    bankAccounts: settings.bankAccounts,
    transferInstructions: settings.transferInstructions,
  };
}

export async function confirmCardPayment(idInput: unknown, clientTransactionIdInput: unknown) {
  const id = Number(idInput);
  const clientTransactionId = text(clientTransactionIdInput, 50);
  if (!Number.isInteger(id) || id <= 0 || !clientTransactionId) {
    throw new CustomError("Faltan los datos de la transacción", 400);
  }

  const order = await Order.findOne({ clientTransactionId });
  if (!order || order.paymentMethod !== "card") throw new CustomError("Pedido no encontrado", 404);

  // Idempotente: recargar la página de retorno no vuelve a llamar a Payphone
  // ni reenvía correos. Igual si Payphone ya había dicho que se canceló.
  if (PAID_STATUSES.includes(order.status)) return { order: toPublicOrder(order) };
  if (order.status === "cancelled" && order.payphone) return { order: toPublicOrder(order) };

  const data = await payphoneService.confirmTransaction(id, clientTransactionId);
  const statusCode = Number(data.statusCode);

  if (statusCode === payphoneService.PAYPHONE_APPROVED) {
    const sameTransaction =
      !data.clientTransactionId || String(data.clientTransactionId) === order.clientTransactionId;
    if (Number(data.amount) !== order.totalCents || !sameTransaction) {
      // Se guarda la evidencia, pero la orden NO se marca pagada.
      await Order.updateOne({ _id: order._id }, { $set: { payphone: data } });
      throw new CustomError(
        "El monto cobrado no coincide con el total del pedido. No lo marcamos como pagado: escríbenos para revisarlo.",
        409,
        { number: order.number, esperado: order.totalCents, recibido: data.amount },
      );
    }

    // El filtro por estado hace de candado: si dos confirmaciones llegan a la
    // vez, solo una marca la orden y solo esa envía el correo.
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: { $nin: PAID_STATUSES } },
      { $set: { status: "paid", paidAt: new Date(), payphone: data } },
      { new: true },
    );
    if (!updated) {
      const current = await Order.findById(order._id);
      return { order: toPublicOrder(current) };
    }

    await safely("pago confirmado", [orderEmail.sendCardPaymentConfirmed(updated)]);
    return { order: toPublicOrder(updated) };
  }

  if (statusCode === payphoneService.PAYPHONE_CANCELLED) {
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: { $nin: PAID_STATUSES } },
      { $set: { status: "cancelled", payphone: data } },
      { new: true },
    );
    return { order: toPublicOrder(updated || (await Order.findById(order._id))) };
  }

  await Order.updateOne({ _id: order._id }, { $set: { payphone: data } });
  throw new CustomError(
    "Payphone todavía no aprueba este pago. Intenta de nuevo en un momento.",
    409,
  );
}

export async function uploadTransferProof(
  number: string,
  email: unknown,
  file?: Express.Multer.File,
) {
  const order = await findByNumberAndEmail(number, email);

  if (order.paymentMethod !== "transfer") {
    throw new CustomError("Este pedido no se paga por transferencia", 400);
  }
  if (order.status !== "pending" && order.status !== "awaiting_verification") {
    throw new CustomError("Este pedido ya no admite comprobantes", 409);
  }
  if (!file) throw new CustomError("Adjunta la foto del comprobante en el campo file", 400);
  if (!file.mimetype.startsWith("image/")) {
    throw new CustomError("El comprobante debe ser una imagen (foto o captura de pantalla)", 400);
  }

  const previous = order.transferProof;
  const uploaded = await uploadBuffer(file.buffer, PROOFS_FOLDER).catch((error) => {
    if (error instanceof CustomError) throw error;
    // El detalle de Cloudinary va al log, no al comprador.
    throw new CustomError(
      "No se pudo subir el comprobante. Intenta de nuevo en un momento.",
      502,
      error,
    );
  });

  order.transferProof = uploaded;
  order.status = "awaiting_verification";
  await order.save();

  if (previous?.publicId) {
    await deleteImage(previous.publicId).catch((error) =>
      console.error(
        `[order] no se pudo borrar el comprobante anterior ${previous.publicId}:`,
        error,
      ),
    );
  }

  await safely("comprobante", [orderEmail.sendAdminProofUploaded(order, uploaded.url)]);
  return { order: toPublicOrder(order) };
}

export async function getPublicOrder(number: string, email: unknown) {
  const order = await findByNumberAndEmail(number, email);
  return { order: toPublicOrder(order) };
}

export async function listMine(userId: string) {
  if (!mongoose.isValidObjectId(userId)) return [];
  const orders = await Order.find({ user: userId }).sort({ createdAt: -1 });
  return orders.map(toPublicOrder);
}

// ---------- Admin ----------

export async function listOrders(query: { status?: unknown; page?: unknown }) {
  const filter: Record<string, unknown> = {};
  if (query.status) {
    if (!ORDER_STATUSES.includes(query.status as OrderStatus)) {
      throw new CustomError("Estado de pedido no válido", 400);
    }
    filter.status = query.status;
  }

  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const [items, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
    Order.countDocuments(filter),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getOrderById(id: string) {
  return findByIdOrFail(id);
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "pendiente de pago",
  awaiting_verification: "con comprobante por revisar",
  paid: "pagado",
  shipped: "enviado",
  delivered: "entregado",
  cancelled: "cancelado",
};

/**
 * Aplica una transición solo si la orden sigue en un estado permitido. El
 * filtro va en la misma operación que el cambio: dos clics seguidos en el
 * panel no aprueban ni envían dos veces.
 */
async function transition(
  id: string,
  allowedFrom: OrderStatus[],
  changes: Record<string, unknown>,
  action: string,
  extraFilter: Record<string, unknown> = {},
) {
  const order = await findByIdOrFail(id);
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: { $in: allowedFrom }, ...extraFilter },
    { $set: changes },
    { new: true },
  );
  if (!updated) {
    throw new CustomError(
      `No se puede ${action}: el pedido ${order.number} está ${STATUS_LABELS[order.status]}.`,
      409,
    );
  }
  return updated;
}

export async function approveTransfer(id: string) {
  const order = await findByIdOrFail(id);
  if (order.paymentMethod !== "transfer") {
    throw new CustomError(
      `No se puede aprobar la transferencia: el pedido ${order.number} se paga con tarjeta.`,
      409,
    );
  }
  const updated = await transition(
    id,
    ["pending", "awaiting_verification"],
    { status: "paid", paidAt: new Date() },
    "aprobar la transferencia",
    { paymentMethod: "transfer" },
  );
  await safely("transferencia aprobada", [orderEmail.sendTransferApproved(updated)]);
  return updated;
}

export async function shipOrder(id: string, trackingNote: unknown) {
  const updated = await transition(
    id,
    ["paid"],
    { status: "shipped", shippedAt: new Date(), trackingNote: text(trackingNote, 1000) },
    "marcar como enviado",
  );
  await safely("pedido enviado", [orderEmail.sendOrderShipped(updated)]);
  return updated;
}

export async function deliverOrder(id: string) {
  return transition(id, ["shipped"], { status: "delivered" }, "marcar como entregado");
}

export async function cancelOrder(id: string) {
  return transition(
    id,
    ["pending", "awaiting_verification", "paid", "shipped"],
    { status: "cancelled" },
    "cancelar",
  );
}

export async function setInvoiceIssued(id: string, issued: unknown) {
  if (typeof issued !== "boolean") throw new CustomError("Indica si la factura fue emitida", 400);
  const order = await findByIdOrFail(id);
  order.invoiceIssued = issued;
  await order.save();
  return order;
}

export async function setAdminNote(id: string, note: unknown) {
  const order = await findByIdOrFail(id);
  order.adminNote = text(note, 2000);
  await order.save();
  return order;
}
