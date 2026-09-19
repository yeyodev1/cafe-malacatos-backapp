import mongoose, { Types } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Product, PRODUCT_CATEGORIES, ProductCategory } from "../models/product.model";
import { slugify } from "../utils/slugify";
import { deleteImage, uploadBuffer } from "./cloudinary.service";

const IMAGES_FOLDER = "cafe-malacatos/productos";
const MAX_QTY = 99;

export interface CartItemInput {
  productId: string;
  variantId: string;
  qty: number;
}

export interface ResolvedLine {
  product: Types.ObjectId;
  variantId: Types.ObjectId;
  name: string;
  variantLabel: string;
  weightGrams: number;
  unitPriceCents: number;
  qty: number;
  lineTotalCents: number;
  image: string;
}

export interface ResolvedCart {
  lines: ResolvedLine[];
  subtotalCents: number;
  totalWeightGrams: number;
}

function isCategory(value: unknown): value is ProductCategory {
  return PRODUCT_CATEGORIES.includes(value as ProductCategory);
}

/** Deja solo las variantes activas: lo que ve la tienda. */
function toPublic(product: any) {
  const json = product.toJSON();
  json.variants = (json.variants || []).filter((variant: any) => variant.isActive);
  return json;
}

// ---------- Tienda ----------

export async function listPublished(category?: string) {
  const filter: Record<string, unknown> = { isPublished: true };
  if (category) {
    if (!isCategory(category)) throw new CustomError("Categoría no válida", 400);
    filter.category = category;
  }
  const products = await Product.find(filter).sort({ sortOrder: 1, createdAt: 1 });
  return products.map(toPublic);
}

export async function getPublishedBySlug(slug: string) {
  const product = await Product.findOne({ slug: slug.toLowerCase().trim(), isPublished: true });
  if (!product) throw new CustomError("Producto no encontrado", 404);
  return toPublic(product);
}

/**
 * Convierte el carrito del cliente en líneas con precio y peso leídos de la
 * base. Es el único camino por el que un monto entra a una orden o a una
 * cotización: nada de lo que mande el cliente, salvo ids y cantidades, se usa.
 */
export async function resolveCart(items: unknown): Promise<ResolvedCart> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CustomError("El carrito está vacío", 400);
  }

  // La misma variante repetida se suma, así el tope de cantidad no se esquiva
  // partiendo el pedido en varias líneas.
  const merged = new Map<string, CartItemInput>();
  for (const raw of items) {
    const productId = String(raw?.productId ?? "");
    const variantId = String(raw?.variantId ?? "");
    const qty = raw?.qty;
    if (!mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(variantId)) {
      throw new CustomError("Hay un producto del carrito que no existe", 400);
    }
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new CustomError(
        `La cantidad de cada producto debe ser un entero entre 1 y ${MAX_QTY}`,
        400,
      );
    }
    const key = `${productId}:${variantId}`;
    const previous = merged.get(key);
    if (previous) {
      previous.qty += qty;
      if (previous.qty > MAX_QTY) {
        throw new CustomError(
          `La cantidad de cada producto debe ser un entero entre 1 y ${MAX_QTY}`,
          400,
        );
      }
    } else {
      merged.set(key, { productId, variantId, qty });
    }
  }

  const inputs = [...merged.values()];
  const products = await Product.find({ _id: { $in: inputs.map((item) => item.productId) } });
  const byId = new Map(products.map((product) => [product._id.toString(), product]));

  const lines: ResolvedLine[] = [];
  for (const input of inputs) {
    const product = byId.get(input.productId);
    if (!product || !product.isPublished) {
      throw new CustomError("Hay un producto del carrito que ya no está disponible", 400);
    }
    const variant = product.variants.find((v) => v._id.toString() === input.variantId);
    if (!variant || !variant.isActive) {
      throw new CustomError(
        `La presentación elegida de "${product.name}" ya no está disponible`,
        400,
      );
    }
    if (!Number.isInteger(variant.weightGrams) || variant.weightGrams <= 0) {
      throw new CustomError(
        `"${product.name} (${variant.label})" todavía no se puede comprar en línea porque no tiene peso definido. Escríbenos por WhatsApp para pedirlo.`,
        400,
      );
    }
    if (!Number.isInteger(variant.priceCents) || variant.priceCents <= 0) {
      throw new CustomError(
        `"${product.name} (${variant.label})" todavía no tiene precio. Escríbenos por WhatsApp para pedirlo.`,
        400,
      );
    }

    lines.push({
      product: product._id,
      variantId: variant._id,
      name: product.name,
      variantLabel: variant.label,
      weightGrams: variant.weightGrams,
      unitPriceCents: variant.priceCents,
      qty: input.qty,
      lineTotalCents: variant.priceCents * input.qty,
      image: product.images[0]?.url || "",
    });
  }

  return {
    lines,
    subtotalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
    totalWeightGrams: lines.reduce((sum, line) => sum + line.weightGrams * line.qty, 0),
  };
}

// ---------- Admin ----------

function intOrNull(value: unknown, field: string, min: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new CustomError(`${field} debe ser un entero mayor o igual a ${min}, o vacío`, 400);
  }
  return number;
}

function requiredInt(value: unknown, field: string): number {
  const number = Number(value);
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isInteger(number) ||
    number < 0
  ) {
    throw new CustomError(`${field} debe ser un entero mayor o igual a 0`, 400);
  }
  return number;
}

/**
 * Normaliza las variantes que manda el admin. Si una trae `id` de una variante
 * existente se conserva su `_id`: las órdenes guardan `variantId`.
 */
function parseVariants(input: unknown, existingIds: Set<string>) {
  if (!Array.isArray(input)) throw new CustomError("Las presentaciones deben ser una lista", 400);

  return input.map((raw, index) => {
    const label = String(raw?.label ?? "").trim();
    if (!label) throw new CustomError(`La presentación ${index + 1} necesita un nombre`, 400);

    const variant: Record<string, unknown> = {
      label,
      weightGrams: requiredInt(raw?.weightGrams, `El peso en gramos de "${label}"`),
      priceCents: requiredInt(raw?.priceCents, `El precio en centavos de "${label}"`),
      wholesalePriceCents: intOrNull(
        raw?.wholesalePriceCents,
        `El precio al por mayor de "${label}"`,
        0,
      ),
      wholesaleMinQty: intOrNull(
        raw?.wholesaleMinQty,
        `La cantidad mínima al por mayor de "${label}"`,
        1,
      ),
      isActive: raw?.isActive === undefined ? true : Boolean(raw.isActive),
    };

    const id = String(raw?.id ?? raw?._id ?? "");
    if (id && existingIds.has(id)) variant._id = id;
    return variant;
  });
}

async function ensureSlugFree(slug: string, exceptId?: string) {
  if (!slug) throw new CustomError("El slug no puede quedar vacío", 400);
  const clash = await Product.findOne({ slug }).select("_id");
  if (clash && clash._id.toString() !== exceptId) {
    throw new CustomError(`Ya existe un producto con el slug "${slug}"`, 409);
  }
}

async function findOrFail(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new CustomError("Producto no encontrado", 404);
  const product = await Product.findById(id);
  if (!product) throw new CustomError("Producto no encontrado", 404);
  return product;
}

export async function listAll() {
  return Product.find().sort({ sortOrder: 1, createdAt: 1 });
}

export async function getById(id: string) {
  return findOrFail(id);
}

export async function createProduct(input: Record<string, any>) {
  const name = String(input?.name ?? "").trim();
  if (!name) throw new CustomError("El producto necesita un nombre", 400);
  if (!isCategory(input?.category)) throw new CustomError("Categoría no válida", 400);

  const slug = slugify(String(input?.slug || name));
  await ensureSlugFree(slug);

  return Product.create({
    slug,
    name,
    category: input.category,
    shortDescription: String(input.shortDescription ?? ""),
    description: String(input.description ?? ""),
    usage: String(input.usage ?? ""),
    variants: parseVariants(input.variants ?? [], new Set()),
    isPublished: Boolean(input.isPublished),
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
  });
}

export async function updateProduct(id: string, input: Record<string, any>) {
  const product = await findOrFail(id);

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new CustomError("El producto necesita un nombre", 400);
    product.name = name;
  }
  if (input.slug !== undefined) {
    // Slug vacío en una edición = regenerarlo desde el nombre.
    const slug = slugify(String(input.slug || product.name));
    await ensureSlugFree(slug, product._id.toString());
    product.slug = slug;
  }
  if (input.category !== undefined) {
    if (!isCategory(input.category)) throw new CustomError("Categoría no válida", 400);
    product.category = input.category;
  }
  if (input.shortDescription !== undefined)
    product.shortDescription = String(input.shortDescription);
  if (input.description !== undefined) product.description = String(input.description);
  if (input.usage !== undefined) product.usage = String(input.usage);
  if (input.isPublished !== undefined) product.isPublished = Boolean(input.isPublished);
  if (input.sortOrder !== undefined) {
    const sortOrder = Number(input.sortOrder);
    if (!Number.isFinite(sortOrder)) throw new CustomError("El orden debe ser un número", 400);
    product.sortOrder = sortOrder;
  }
  if (input.variants !== undefined) {
    const existingIds = new Set(product.variants.map((variant) => variant._id.toString()));
    product.set("variants", parseVariants(input.variants, existingIds));
  }

  await product.save();
  return product;
}

export async function deleteProduct(id: string) {
  const product = await findOrFail(id);
  // Las fotos se intentan borrar, pero un fallo de Cloudinary no debe dejar
  // el producto a medio borrar.
  for (const image of product.images) {
    await deleteImage(image.publicId).catch((error) =>
      console.error(`[product] no se pudo borrar ${image.publicId} de Cloudinary:`, error),
    );
  }
  await product.deleteOne();
}

export async function addImage(id: string, file?: Express.Multer.File) {
  const product = await findOrFail(id);
  if (!file) throw new CustomError("Adjunta una imagen en el campo file", 400);
  if (!file.mimetype.startsWith("image/")) {
    throw new CustomError("El archivo debe ser una imagen", 400);
  }

  const uploaded = await uploadBuffer(file.buffer, IMAGES_FOLDER).catch((error) => {
    if (error instanceof CustomError) throw error;
    throw new CustomError("No se pudo subir la imagen a Cloudinary. Intenta de nuevo.", 502, error);
  });
  product.images.push(uploaded);
  await product.save();
  return product;
}

export async function removeImage(id: string, publicId: string) {
  const product = await findOrFail(id);
  const image = product.images.find((item) => item.publicId === publicId);
  if (!image) throw new CustomError("Esa imagen no pertenece al producto", 404);

  // Las imágenes "static/" son archivos del propio deploy: no existen en Cloudinary.
  if (publicId.startsWith("static/")) {
    product.set(
      "images",
      product.images.filter((item) => item.publicId !== publicId),
    );
    await product.save();
    return product;
  }

  await deleteImage(publicId).catch((error) => {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      "No se pudo borrar la imagen de Cloudinary. Intenta de nuevo.",
      502,
      error,
    );
  });
  product.set(
    "images",
    product.images.filter((item) => item.publicId !== publicId),
  );
  await product.save();
  return product;
}
