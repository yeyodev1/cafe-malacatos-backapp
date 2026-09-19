import mongoose, { Schema, Types } from "mongoose";
import { toClientJSON } from "../utils/toClientJSON";

export interface IBankAccount {
  _id: Types.ObjectId;
  bank: string;
  accountType: string;
  number: string;
  holder: string;
  idNumber: string;
}

export interface ISettings {
  /** Siempre "main": el índice único garantiza que el documento sea uno solo. */
  key: string;
  whatsapp: string;
  contactEmail: string;
  contactPhone: string;
  social: { instagram: string; facebook: string; tiktok: string };
  bankAccounts: IBankAccount[];
  transferInstructions: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const SETTINGS_KEY = "main";

const bankAccountSchema = new Schema<IBankAccount>(
  {
    bank: { type: String, required: true, trim: true },
    accountType: { type: String, default: "", trim: true },
    number: { type: String, required: true, trim: true },
    holder: { type: String, required: true, trim: true },
    idNumber: { type: String, default: "", trim: true },
  },
  { toJSON: { transform: toClientJSON } },
);

const settingsSchema = new Schema<ISettings>(
  {
    key: { type: String, default: SETTINGS_KEY, unique: true },
    whatsapp: { type: String, default: "593985366039" },
    contactEmail: { type: String, default: "sandritagj12@hotmail.com" },
    contactPhone: { type: String, default: "0985 366 039" },
    social: {
      instagram: { type: String, default: "" },
      facebook: { type: String, default: "https://www.facebook.com/Cafemalacatus/" },
      tiktok: { type: String, default: "" },
    },
    bankAccounts: { type: [bankAccountSchema], default: [] },
    transferInstructions: { type: String, default: "" },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        delete ret.key;
        return toClientJSON(doc, ret);
      },
    },
  },
);

export const Settings =
  (mongoose.models.Settings as mongoose.Model<ISettings>) ||
  mongoose.model<ISettings>("Settings", settingsSchema);
