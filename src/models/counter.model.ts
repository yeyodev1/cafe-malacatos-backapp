import mongoose, { Schema } from "mongoose";

export interface ICounter {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Counter =
  (mongoose.models.Counter as mongoose.Model<ICounter>) ||
  mongoose.model<ICounter>("Counter", counterSchema);

/**
 * Siguiente valor de una secuencia. `$inc` + `upsert` en una sola operación:
 * dos órdenes simultáneas nunca reciben el mismo número.
 */
export async function nextSequence(name: string): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return counter.seq;
}
