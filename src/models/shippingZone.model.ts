import mongoose, { Schema } from "mongoose";
import { toClientJSON } from "../utils/toClientJSON";

export interface IShippingZone {
  province: string;
  /** null = tarifa sin definir: esa provincia solo se cierra por WhatsApp. */
  baseCents: number | null;
  extraPerKgCents: number;
  includedKg: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const shippingZoneSchema = new Schema<IShippingZone>(
  {
    province: { type: String, required: true, unique: true, trim: true },
    baseCents: { type: Number, default: null, min: 0 },
    extraPerKgCents: { type: Number, default: 0, min: 0 },
    includedKg: { type: Number, default: 1, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { transform: toClientJSON } },
);

export const ShippingZone =
  (mongoose.models.ShippingZone as mongoose.Model<IShippingZone>) ||
  mongoose.model<IShippingZone>("ShippingZone", shippingZoneSchema);
