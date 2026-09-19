import { CustomError } from "../errors/customError.error";
import { Settings, SETTINGS_KEY } from "../models/settings.model";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Documento único. El upsert con clave fija evita que dos peticiones
 * simultáneas en una base vacía creen dos documentos; los valores por
 * defecto salen del schema.
 */
export async function getSettings() {
  return Settings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $setOnInsert: { key: SETTINGS_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

function withTransferFlag(settings: any) {
  const json = settings.toJSON();
  // Derivado, no guardado: hay transferencia si hay al menos una cuenta.
  return { ...json, transferEnabled: json.bankAccounts.length > 0 };
}

export async function getPublicSettings() {
  const full = withTransferFlag(await getSettings());
  return {
    whatsapp: full.whatsapp,
    contactEmail: full.contactEmail,
    contactPhone: full.contactPhone,
    social: full.social,
    bankAccounts: full.bankAccounts,
    transferInstructions: full.transferInstructions,
    transferEnabled: full.transferEnabled,
  };
}

export async function getAdminSettings() {
  return withTransferFlag(await getSettings());
}

export async function updateSettings(input: Record<string, any>) {
  const settings = await getSettings();

  if (input.whatsapp !== undefined) {
    // Se guarda solo con dígitos: así arma directo el enlace wa.me.
    settings.whatsapp = String(input.whatsapp).replace(/\D/g, "");
  }
  if (input.contactEmail !== undefined) {
    const contactEmail = String(input.contactEmail).trim();
    if (contactEmail && !EMAIL.test(contactEmail)) {
      throw new CustomError("El correo de contacto no es válido", 400);
    }
    settings.contactEmail = contactEmail;
  }
  if (input.contactPhone !== undefined) settings.contactPhone = String(input.contactPhone).trim();
  if (input.social !== undefined && input.social !== null && typeof input.social === "object") {
    for (const network of ["instagram", "facebook", "tiktok"] as const) {
      if (input.social[network] !== undefined) {
        settings.social[network] = String(input.social[network] ?? "").trim();
      }
    }
  }
  if (input.transferInstructions !== undefined) {
    settings.transferInstructions = String(input.transferInstructions ?? "");
  }
  if (input.bankAccounts !== undefined) {
    if (!Array.isArray(input.bankAccounts)) {
      throw new CustomError("Las cuentas bancarias deben ser una lista", 400);
    }
    const existingIds = new Set(settings.bankAccounts.map((account) => account._id.toString()));
    const accounts = input.bankAccounts.map((raw: any, index: number) => {
      const account: Record<string, unknown> = {
        bank: String(raw?.bank ?? "").trim(),
        accountType: String(raw?.accountType ?? "").trim(),
        number: String(raw?.number ?? "").trim(),
        holder: String(raw?.holder ?? "").trim(),
        idNumber: String(raw?.idNumber ?? "").trim(),
      };
      if (!account.bank || !account.number || !account.holder) {
        throw new CustomError(`La cuenta ${index + 1} necesita banco, número y titular`, 400);
      }
      const id = String(raw?.id ?? raw?._id ?? "");
      if (id && existingIds.has(id)) account._id = id;
      return account;
    });
    settings.set("bankAccounts", accounts);
  }

  await settings.save();
  return withTransferFlag(settings);
}
