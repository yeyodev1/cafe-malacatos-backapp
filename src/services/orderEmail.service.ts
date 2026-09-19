import { env } from "../config/env";
import { IOrder } from "../models/order.model";
import { sendEmail, layout } from "./email.service";

interface BankAccountView {
  bank: string;
  accountType: string;
  number: string;
  holder: string;
  idNumber: string;
}

type OrderView = Pick<
  IOrder,
  | "number"
  | "customer"
  | "shipping"
  | "items"
  | "subtotalCents"
  | "shippingCents"
  | "totalCents"
  | "paymentMethod"
  | "trackingNote"
>;

/** Nombres, direcciones y notas vienen del usuario: nunca van crudos al HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Centavos enteros → "$12.50". Sin pasar por floats. */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function notifyAddress(): string {
  return env.ORDERS_NOTIFY_EMAIL || env.ADMIN_EMAIL;
}

function trackingUrl(order: OrderView): string {
  const base = env.FRONTEND_URL.replace(/\/+$/, "");
  return `${base}/pedido/${encodeURIComponent(order.number)}?email=${encodeURIComponent(order.customer.email)}`;
}

function itemsTable(order: OrderView): string {
  const rows = order.items
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e4e4e7">${escapeHtml(item.name)}<br><span style="color:#71717a;font-size:13px">${escapeHtml(item.variantLabel)} × ${item.qty}</span></td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #e4e4e7;white-space:nowrap">${formatUsd(item.lineTotalCents)}</td>
      </tr>`,
    )
    .join("");

  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px">
    ${rows}
    <tr><td style="padding:8px 0 2px;color:#52525b">Subtotal</td><td align="right" style="padding:8px 0 2px">${formatUsd(order.subtotalCents)}</td></tr>
    <tr><td style="padding:2px 0;color:#52525b">Envío a ${escapeHtml(order.shipping.province)}</td><td align="right" style="padding:2px 0">${formatUsd(order.shippingCents)}</td></tr>
    <tr><td style="padding:6px 0;font-weight:bold;font-size:16px">Total</td><td align="right" style="padding:6px 0;font-weight:bold;font-size:16px">${formatUsd(order.totalCents)}</td></tr>
  </table>`;
}

function shippingBlock(order: OrderView): string {
  const reference = order.shipping.reference
    ? `<br>Referencia: ${escapeHtml(order.shipping.reference)}`
    : "";
  return `<p style="margin:16px 0 0"><strong>Enviamos a:</strong><br>${escapeHtml(order.shipping.address)}<br>${escapeHtml(order.shipping.city)}, ${escapeHtml(order.shipping.province)}${reference}</p>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block">${escapeHtml(label)}</a></p>`;
}

function bankAccountsBlock(accounts: BankAccountView[], instructions: string): string {
  const list = accounts
    .map(
      (account) => `
      <p style="margin:0 0 12px;padding:12px 16px;background:#f4f4f5;border-radius:10px">
        <strong>${escapeHtml(account.bank)}</strong>${account.accountType ? ` · ${escapeHtml(account.accountType)}` : ""}<br>
        Número: <strong>${escapeHtml(account.number)}</strong><br>
        Titular: ${escapeHtml(account.holder)}${account.idNumber ? `<br>Identificación: ${escapeHtml(account.idNumber)}` : ""}
      </p>`,
    )
    .join("");
  const extra = instructions
    ? `<p style="margin:0 0 12px">${escapeHtml(instructions).replace(/\n/g, "<br>")}</p>`
    : "";
  return `${list}${extra}`;
}

// ---------- Al comprador ----------

export async function sendOrderReceived(
  order: OrderView,
  bank?: { bankAccounts: BankAccountView[]; transferInstructions: string },
): Promise<boolean> {
  const greeting = `<p>Hola ${escapeHtml(order.customer.name)}, recibimos tu pedido <strong>${escapeHtml(order.number)}</strong>.</p>`;

  const payment =
    order.paymentMethod === "transfer"
      ? `<p>Para confirmarlo, transfiere <strong>${formatUsd(order.totalCents)}</strong> a una de estas cuentas y sube tu comprobante:</p>
         ${bankAccountsBlock(bank?.bankAccounts || [], bank?.transferInstructions || "")}
         ${button(trackingUrl(order), "Subir comprobante")}`
      : `<p>Elegiste pagar con tarjeta. Te avisaremos por este medio apenas se confirme el pago.</p>
         ${button(trackingUrl(order), "Ver mi pedido")}`;

  return sendEmail(
    order.customer.email,
    `Recibimos tu pedido ${order.number}`,
    layout(
      "Recibimos tu pedido",
      `${greeting}${payment}${itemsTable(order)}${shippingBlock(order)}`,
    ),
  );
}

export async function sendCardPaymentConfirmed(order: OrderView): Promise<boolean> {
  const body = `
    <p>Hola ${escapeHtml(order.customer.name)}, tu pago con tarjeta del pedido <strong>${escapeHtml(order.number)}</strong> fue confirmado. Ya estamos preparando tu envío.</p>
    ${itemsTable(order)}${shippingBlock(order)}
    ${button(trackingUrl(order), "Ver mi pedido")}`;
  return sendEmail(
    order.customer.email,
    `Pago confirmado — pedido ${order.number}`,
    layout("Pago confirmado", body),
  );
}

export async function sendTransferApproved(order: OrderView): Promise<boolean> {
  const body = `
    <p>Hola ${escapeHtml(order.customer.name)}, revisamos tu transferencia del pedido <strong>${escapeHtml(order.number)}</strong>.</p>
    <p><strong>Tu compra ha sido aprobada. A continuación empieza tu envío.</strong></p>
    ${itemsTable(order)}${shippingBlock(order)}
    ${button(trackingUrl(order), "Ver mi pedido")}`;
  return sendEmail(
    order.customer.email,
    `Tu compra fue aprobada — pedido ${order.number}`,
    layout("Tu compra ha sido aprobada", body),
  );
}

export async function sendOrderShipped(order: OrderView): Promise<boolean> {
  const note = order.trackingNote
    ? `<p style="padding:12px 16px;background:#f4f4f5;border-radius:10px"><strong>Datos de tu envío:</strong><br>${escapeHtml(order.trackingNote).replace(/\n/g, "<br>")}</p>`
    : "";
  const body = `
    <p>Hola ${escapeHtml(order.customer.name)}, tu pedido <strong>${escapeHtml(order.number)}</strong> ya va en camino.</p>
    ${note}${itemsTable(order)}${shippingBlock(order)}
    ${button(trackingUrl(order), "Ver mi pedido")}`;
  return sendEmail(
    order.customer.email,
    `Tu pedido ${order.number} va en camino`,
    layout("Tu pedido fue enviado", body),
  );
}

// ---------- Al admin ----------

function customerBlock(order: OrderView): string {
  return `<p><strong>Cliente:</strong> ${escapeHtml(order.customer.name)}<br>${escapeHtml(order.customer.email)} · ${escapeHtml(order.customer.phone)}</p>`;
}

export async function sendAdminNewOrder(order: OrderView): Promise<boolean> {
  const method = order.paymentMethod === "transfer" ? "transferencia" : "tarjeta";
  const body = `
    <p>Entró el pedido <strong>${escapeHtml(order.number)}</strong>, pago por <strong>${method}</strong>.</p>
    ${customerBlock(order)}${itemsTable(order)}${shippingBlock(order)}`;
  return sendEmail(
    notifyAddress(),
    `Nuevo pedido ${order.number} (${method})`,
    layout("Nuevo pedido", body),
  );
}

export async function sendAdminProofUploaded(order: OrderView, proofUrl: string): Promise<boolean> {
  const body = `
    <p>El cliente subió el comprobante de transferencia del pedido <strong>${escapeHtml(order.number)}</strong>. Revísalo y apruébalo desde el panel.</p>
    ${customerBlock(order)}
    ${button(proofUrl, "Ver comprobante")}
    ${itemsTable(order)}`;
  return sendEmail(
    notifyAddress(),
    `Comprobante recibido — pedido ${order.number}`,
    layout("Comprobante por revisar", body),
  );
}
