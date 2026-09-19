import mongoose from "mongoose";
import { CustomError } from "../errors/customError.error";
import { ShippingZone, IShippingZone } from "../models/shippingZone.model";
import { resolveCart } from "./product.service";

export const ECUADOR_PROVINCES = [
  "Azuay",
  "Bolívar",
  "Cañar",
  "Carchi",
  "Chimborazo",
  "Cotopaxi",
  "El Oro",
  "Esmeraldas",
  "Galápagos",
  "Guayas",
  "Imbabura",
  "Loja",
  "Los Ríos",
  "Manabí",
  "Morona Santiago",
  "Napo",
  "Orellana",
  "Pastaza",
  "Pichincha",
  "Santa Elena",
  "Santo Domingo de los Tsáchilas",
  "Sucumbíos",
  "Tungurahua",
  "Zamora Chinchipe",
] as const;

/** Compara provincias sin tildes ni mayúsculas: "manabi" = "Manabí". */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * La primera vez siembra las 24 provincias SIN tarifa (`baseCents: null`).
 * Las tarifas las pone el cliente desde el admin; acá no se inventa ninguna.
 */
async function ensureZones(): Promise<void> {
  const count = await ShippingZone.estimatedDocumentCount();
  if (count > 0) return;

  try {
    await ShippingZone.insertMany(
      ECUADOR_PROVINCES.map((province) => ({
        province,
        baseCents: null,
        extraPerKgCents: 0,
        includedKg: 1,
        isActive: true,
      })),
      { ordered: false },
    );
  } catch (error: any) {
    // Dos peticiones a la vez en una base vacía: el índice único de
    // `province` rechaza los duplicados y la siembra queda completa igual.
    if (error?.code !== 11000 && !error?.writeErrors) throw error;
  }
}

export function isZoneAvailable(zone: Pick<IShippingZone, "baseCents" | "isActive">): boolean {
  return zone.isActive && zone.baseCents !== null;
}

/** baseCents + max(0, ceil(pesoKg - includedKg)) * extraPerKgCents */
export function computeShippingCents(
  zone: Pick<IShippingZone, "baseCents" | "extraPerKgCents" | "includedKg">,
  totalWeightGrams: number,
): number {
  const extraKg = Math.max(0, Math.ceil(totalWeightGrams / 1000 - zone.includedKg));
  return (zone.baseCents ?? 0) + extraKg * zone.extraPerKgCents;
}

export async function listZones() {
  await ensureZones();
  const zones = await ShippingZone.find();
  return zones.sort((a, b) => a.province.localeCompare(b.province, "es"));
}

export async function listPublicZones() {
  const zones = await listZones();
  return zones.map((zone) => ({ province: zone.province, available: isZoneAvailable(zone) }));
}

export async function findZoneByProvince(province: string) {
  const wanted = normalize(String(province ?? ""));
  if (!wanted) throw new CustomError("Elige la provincia de envío", 400);
  const zones = await listZones();
  const zone = zones.find((item) => normalize(item.province) === wanted);
  if (!zone) throw new CustomError("Provincia de envío no válida", 400);
  return zone;
}

export async function quote(province: string, items: unknown) {
  const zone = await findZoneByProvince(province);
  const cart = await resolveCart(items);

  if (!isZoneAvailable(zone)) {
    // Sin tarifa no hay monto que dar: el frontend ofrece cerrar por WhatsApp.
    return { available: false, shippingCents: null, totalWeightGrams: cart.totalWeightGrams };
  }
  return {
    available: true,
    shippingCents: computeShippingCents(zone, cart.totalWeightGrams),
    totalWeightGrams: cart.totalWeightGrams,
  };
}

export async function updateZone(id: string, input: Record<string, any>) {
  if (!mongoose.isValidObjectId(id)) throw new CustomError("Zona de envío no encontrada", 404);
  const zone = await ShippingZone.findById(id);
  if (!zone) throw new CustomError("Zona de envío no encontrada", 404);

  if (input.baseCents !== undefined) {
    if (input.baseCents === null || input.baseCents === "") {
      zone.baseCents = null;
    } else {
      const baseCents = Number(input.baseCents);
      if (!Number.isInteger(baseCents) || baseCents < 0) {
        throw new CustomError("La tarifa base debe ser un entero en centavos, o vacía", 400);
      }
      zone.baseCents = baseCents;
    }
  }
  if (input.extraPerKgCents !== undefined) {
    const extra = Number(input.extraPerKgCents);
    if (input.extraPerKgCents === null || !Number.isInteger(extra) || extra < 0) {
      throw new CustomError("El costo por kilo adicional debe ser un entero en centavos", 400);
    }
    zone.extraPerKgCents = extra;
  }
  if (input.includedKg !== undefined) {
    const includedKg = Number(input.includedKg);
    if (input.includedKg === null || !Number.isFinite(includedKg) || includedKg < 0) {
      throw new CustomError("Los kilos incluidos deben ser un número mayor o igual a 0", 400);
    }
    zone.includedKg = includedKg;
  }
  if (input.isActive !== undefined) zone.isActive = Boolean(input.isActive);

  await zone.save();
  return zone;
}
