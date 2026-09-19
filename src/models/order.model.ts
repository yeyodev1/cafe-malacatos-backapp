import mongoose, { Schema, Types } from "mongoose";
import { toClientJSON } from "../utils/toClientJSON";

export const PAYMENT_METHODS = ["card", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ORDER_STATUSES = [
  "pending",
  "awaiting_verification",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const BILLING_ID_TYPES = ["cedula", "ruc", "pasaporte", "consumidor_final"] as const;
export type BillingIdType = (typeof BILLING_ID_TYPES)[number];

export interface IOrderItem {
  product: Types.ObjectId;
  variantId: Types.ObjectId;
  // Copia de los datos al momento de comprar: si el producto cambia o se
  // borra después, la orden sigue diciendo qué se vendió y a qué precio.
  name: string;
  variantLabel: string;
  weightGrams: number;
  unitPriceCents: number;
  qty: number;
  lineTotalCents: number;
  image: string;
}

export interface IOrder {
  number: string;
  user: Types.ObjectId | null;
  customer: { name: string; email: string; phone: string };
  shipping: {
    province: string;
    city: string;
    address: string;
    reference: string;
    lat: number | null;
    lng: number | null;
  };
  billing: {
    idType: BillingIdType;
    idNumber: string;
    name: string;
    address: string;
    email: string;
    phone: string;
  };
  items: IOrderItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  totalWeightGrams: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  clientTransactionId: string;
  transferProof: { url: string; publicId: string } | null;
  payphone: Record<string, any> | null;
  invoiceIssued: boolean;
  trackingNote: string;
  adminNote: string;
  paidAt: Date | null;
  shippedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const entero = { validator: Number.isInteger, message: "{PATH} debe ser un entero en centavos" };

const orderItemSchema = new Schema<IOrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    variantLabel: { type: String, required: true },
    weightGrams: { type: Number, required: true },
    unitPriceCents: { type: Number, required: true, validate: entero },
    qty: { type: Number, required: true, min: 1, max: 99 },
    lineTotalCents: { type: Number, required: true, validate: entero },
    image: { type: String, default: "" },
  },
  { _id: false },
);

const transferProofSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    number: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    customer: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, lowercase: true, trim: true },
      phone: { type: String, required: true, trim: true },
    },
    shipping: {
      province: { type: String, required: true },
      city: { type: String, required: true, trim: true },
      address: { type: String, required: true, trim: true },
      reference: { type: String, default: "", trim: true },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    billing: {
      idType: { type: String, enum: BILLING_ID_TYPES, required: true },
      idNumber: { type: String, required: true, trim: true },
      name: { type: String, required: true, trim: true },
      address: { type: String, required: true, trim: true },
      email: { type: String, required: true, lowercase: true, trim: true },
      phone: { type: String, required: true, trim: true },
    },
    items: { type: [orderItemSchema], required: true },
    subtotalCents: { type: Number, required: true, validate: entero },
    shippingCents: { type: Number, required: true, validate: entero },
    totalCents: { type: Number, required: true, validate: entero },
    totalWeightGrams: { type: Number, required: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    status: { type: String, enum: ORDER_STATUSES, default: "pending", index: true },
    clientTransactionId: { type: String, required: true, unique: true, maxlength: 50 },
    transferProof: { type: transferProofSchema, default: null },
    // Respuesta completa de Payphone /confirm. Solo la ve el admin.
    payphone: { type: Schema.Types.Mixed, default: null },
    invoiceIssued: { type: Boolean, default: false },
    trackingNote: { type: String, default: "" },
    adminNote: { type: String, default: "" },
    paidAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { transform: toClientJSON } },
);

export const Order =
  (mongoose.models.Order as mongoose.Model<IOrder>) || mongoose.model<IOrder>("Order", orderSchema);
