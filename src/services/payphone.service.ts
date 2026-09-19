import axios from "axios";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

const CONFIRM_URL = "https://paymentbox.payphonetodoesposible.com/api/confirm";

export const PAYPHONE_APPROVED = 3;
export const PAYPHONE_CANCELLED = 2;

export interface PayphoneBox {
  token: string;
  storeId: string;
  clientTransactionId: string;
  amount: number;
  amountWithoutTax: number;
  currency: "USD";
  reference: string;
}

export function isPayphoneConfigured(): boolean {
  return !!(env.PAYPHONE_TOKEN && env.PAYPHONE_STORE_ID);
}

export function requirePayphone(): void {
  if (!isPayphoneConfigured()) throw new CustomError("Pagos con tarjeta no configurados", 503);
}

/** Datos con los que el frontend abre la Cajita de Pagos. */
export function buildPaymentBox(order: {
  number: string;
  totalCents: number;
  clientTransactionId: string;
}): PayphoneBox {
  requirePayphone();
  return {
    token: env.PAYPHONE_TOKEN,
    storeId: env.PAYPHONE_STORE_ID,
    clientTransactionId: order.clientTransactionId,
    amount: order.totalCents,
    // No se desglosa IVA por ahora: todo el monto va como base sin impuesto.
    amountWithoutTax: order.totalCents,
    currency: "USD",
    reference: `Pedido ${order.number} - Café Malacatos`.slice(0, 100),
  };
}

/** Confirma la transacción del lado del servidor. Devuelve la respuesta completa. */
export async function confirmTransaction(
  id: number,
  clientTxId: string,
): Promise<Record<string, any>> {
  requirePayphone();
  try {
    const { data } = await axios.post(
      CONFIRM_URL,
      { id, clientTxId },
      {
        headers: {
          Authorization: `Bearer ${env.PAYPHONE_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      },
    );
    if (!data || typeof data !== "object") {
      throw new CustomError("Payphone respondió algo que no se pudo leer", 502);
    }
    return data;
  } catch (error: any) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      "No se pudo confirmar el pago con Payphone. Si se hizo el cobro, escríbenos para revisarlo.",
      502,
      error?.response?.data || error?.message,
    );
  }
}
