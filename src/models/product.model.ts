import mongoose, { Schema, Types } from "mongoose";
import { toClientJSON } from "../utils/toClientJSON";

export const PRODUCT_CATEGORIES = ["cafe", "harinas", "endulzantes", "untables", "dulces"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export interface IProductImage {
  url: string;
  publicId: string;
}

export interface IProductVariant {
  _id: Types.ObjectId;
  label: string;
  /** Entero en gramos; base del cálculo de envío. 0 = no se puede vender en línea. */
  weightGrams: number;
  priceCents: number;
  wholesalePriceCents: number | null;
  wholesaleMinQty: number | null;
  isActive: boolean;
}

export interface IProduct {
  slug: string;
  name: string;
  category: ProductCategory;
  shortDescription: string;
  description: string;
  usage: string;
  images: IProductImage[];
  variants: IProductVariant[];
  isPublished: boolean;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const entero = { validator: Number.isInteger, message: "{PATH} debe ser un entero" };

const imageSchema = new Schema<IProductImage>(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { _id: false },
);

const variantSchema = new Schema<IProductVariant>(
  {
    label: { type: String, required: true, trim: true },
    weightGrams: { type: Number, required: true, min: 0, validate: entero },
    priceCents: { type: Number, required: true, min: 0, validate: entero },
    wholesalePriceCents: { type: Number, default: null, min: 0 },
    wholesaleMinQty: { type: Number, default: null, min: 1 },
    isActive: { type: Boolean, default: true },
  },
  { toJSON: { transform: toClientJSON } },
);

const productSchema = new Schema<IProduct>(
  {
    slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: PRODUCT_CATEGORIES, required: true, index: true },
    shortDescription: { type: String, default: "" },
    description: { type: String, default: "" },
    usage: { type: String, default: "" },
    images: { type: [imageSchema], default: [] },
    variants: { type: [variantSchema], default: [] },
    isPublished: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: { transform: toClientJSON } },
);

export const Product =
  (mongoose.models.Product as mongoose.Model<IProduct>) ||
  mongoose.model<IProduct>("Product", productSchema);
