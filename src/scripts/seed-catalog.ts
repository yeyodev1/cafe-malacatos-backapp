/**
 * Seed script — carga (o actualiza) el catálogo desde un JSON.
 * Uso: pnpm seed:catalog [ruta/al/catalogo.json]
 *
 * Idempotente: busca cada producto por `slug`. Las fotos solo se suben si el
 * producto todavía no tiene ninguna, para no duplicarlas en cada corrida.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { dbConnect } from "../config/mongo";
import { Product, PRODUCT_CATEGORIES } from "../models/product.model";
import { isCloudinaryConfigured, uploadBuffer } from "../services/cloudinary.service";
import { slugify } from "../utils/slugify";

const DEFAULT_CATALOG =
  "/Users/yeyodev/projects/work/bakano/clients/cafe-malacatos/recursos/catalogo.json";
const IMAGES_FOLDER = "cafe-malacatos/productos";

/** Las claves que empiezan con "_" son notas para humanos, no datos. */
function withoutNotes(input: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(input || {}).filter(([key]) => !key.startsWith("_")));
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

/** Empareja por `label` con las variantes existentes para conservar su `_id`. */
function buildVariants(input: unknown, existing: any[]) {
  const byLabel = new Map(existing.map((variant) => [normalizeLabel(variant.label), variant]));

  return (Array.isArray(input) ? input : []).map((raw) => {
    const data = withoutNotes(raw);
    const label = String(data.label ?? "").trim();
    if (!label) throw new Error("hay una variante sin label");

    const weightGrams = Number(data.weightGrams);
    const priceCents = Number(data.priceCents);
    if (!Number.isInteger(weightGrams) || weightGrams < 0) {
      throw new Error(`weightGrams inválido en la variante "${label}"`);
    }
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      throw new Error(
        `priceCents inválido en la variante "${label}" (debe ser entero en centavos)`,
      );
    }

    const previous = byLabel.get(normalizeLabel(label));
    const variant: Record<string, unknown> = {
      label,
      weightGrams,
      priceCents,
      wholesalePriceCents: intOrNull(data.wholesalePriceCents),
      wholesaleMinQty: intOrNull(data.wholesaleMinQty),
      isActive:
        data.isActive === undefined
          ? previous
            ? previous.isActive
            : true
          : Boolean(data.isActive),
    };
    if (previous) variant._id = previous._id;
    return variant;
  });
}

async function main() {
  const catalogPath = path.resolve(process.argv[2] || DEFAULT_CATALOG);
  if (!fs.existsSync(catalogPath)) {
    console.error(`✖ No existe el catálogo: ${catalogPath}`);
    process.exit(1);
  }
  const baseDir = path.dirname(catalogPath);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const entries: Record<string, any>[] = Array.isArray(catalog) ? catalog : catalog.products;
  if (!Array.isArray(entries)) {
    console.error('✖ El catálogo debe tener una lista "products"');
    process.exit(1);
  }

  console.log(`Catálogo: ${catalogPath} (${entries.length} productos)`);
  console.log("Conectando a MongoDB...");
  await dbConnect();

  const cloudinaryReady = isCloudinaryConfigured();
  if (!cloudinaryReady) {
    console.warn("⚠ Cloudinary no está configurado: se cargan los productos SIN imágenes.");
  }

  const summary = {
    created: 0,
    updated: 0,
    failed: [] as string[],
    imagesUploaded: 0,
    imagesLinked: 0,
    missingFiles: [] as string[],
  };

  for (const rawEntry of entries) {
    const entry = withoutNotes(rawEntry);
    const slug = slugify(String(entry.slug || entry.name || ""));

    try {
      if (!slug) throw new Error("producto sin slug ni name");
      if (!PRODUCT_CATEGORIES.includes(entry.category)) {
        throw new Error(`categoría inválida: ${entry.category}`);
      }

      let product = await Product.findOne({ slug });
      const isNew = !product;
      if (!product) product = new Product({ slug });

      product.name = String(entry.name ?? "").trim();
      product.category = entry.category;
      product.shortDescription = String(entry.shortDescription ?? "");
      product.description = String(entry.description ?? "");
      product.usage = String(entry.usage ?? "");
      product.sortOrder = Number.isFinite(Number(entry.sortOrder)) ? Number(entry.sortOrder) : 0;
      product.isPublished = Boolean(entry.isPublished);
      product.set("variants", buildVariants(entry.variants, isNew ? [] : product.variants));

      const imagePaths: string[] = Array.isArray(entry.images) ? entry.images : [];
      if (product.images.length > 0) {
        if (imagePaths.length > 0) console.log(`  · ${slug}: ya tiene imágenes, no se sube nada`);
      } else {
        for (const relative of imagePaths) {
          // Una URL ya alojada (estáticos del propio deploy) se guarda tal cual. El prefijo
          // "static/" le dice al borrado que no hay nada que destruir en Cloudinary.
          if (/^https?:\/\//.test(relative)) {
            const name = relative.split("/").pop() || relative;
            product.images.push({ url: relative, publicId: `static/${name}` });
            summary.imagesLinked += 1;
            console.log(`  ⇢ ${slug}: ${relative}`);
            continue;
          }
          if (!cloudinaryReady) continue;
          const absolute = path.resolve(baseDir, relative);
          if (!fs.existsSync(absolute)) {
            console.warn(`  ⚠ ${slug}: no existe el archivo ${relative}`);
            summary.missingFiles.push(`${slug}: ${relative}`);
            continue;
          }
          try {
            const uploaded = await uploadBuffer(fs.readFileSync(absolute), IMAGES_FOLDER);
            product.images.push(uploaded);
            summary.imagesUploaded += 1;
            console.log(`  ↑ ${slug}: ${relative}`);
          } catch (error: any) {
            console.error(`  ✖ ${slug}: no se pudo subir ${relative}: ${error?.message || error}`);
          }
        }
      }

      await product.save();
      if (isNew) summary.created += 1;
      else summary.updated += 1;
      console.log(`${isNew ? "✔ creado" : "✔ actualizado"}: ${slug}`);
    } catch (error: any) {
      summary.failed.push(`${slug || "(sin slug)"}: ${error?.message || error}`);
      console.error(`✖ ${slug || "(sin slug)"}: ${error?.message || error}`);
    }
  }

  console.log("\n===== Resumen =====");
  console.log(`Creados:           ${summary.created}`);
  console.log(`Actualizados:      ${summary.updated}`);
  console.log(`Imágenes subidas:  ${summary.imagesUploaded}`);
  console.log(`Imágenes enlazadas: ${summary.imagesLinked}`);
  console.log(`Archivos faltantes: ${summary.missingFiles.length}`);
  for (const missing of summary.missingFiles) console.log(`  - ${missing}`);
  if (summary.failed.length > 0) {
    console.log(`Con error:         ${summary.failed.length}`);
    for (const failed of summary.failed) console.log(`  - ${failed}`);
  }

  process.exit(summary.failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("✖ Falló la carga del catálogo:", error);
  process.exit(1);
});
