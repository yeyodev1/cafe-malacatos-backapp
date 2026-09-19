/**
 * Transform compartido de `toJSON`: el frontend trabaja con `id`, nunca con
 * `_id`, y `__v` es ruido interno de Mongoose.
 */
export function toClientJSON(_doc: unknown, ret: Record<string, any>) {
  if (ret._id != null) {
    ret.id = ret._id.toString();
    delete ret._id;
  }
  delete ret.__v;
  return ret;
}
