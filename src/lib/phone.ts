import type { PaymentProvider } from "./types";

export function normalizeUgandaPhone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("256")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return /^\d{9}$/.test(digits) ? `+256${digits}` : null;
}

export function detectUgandaMobileProvider(phone: string): PaymentProvider | null {
  const normalized = normalizeUgandaPhone(phone);
  if (!normalized) return null;

  const nationalNumber = normalized.slice(4);
  if (/^(77|78|76|79|39)/.test(nationalNumber)) return "mtn";
  if (/^(70|75|74)/.test(nationalNumber)) return "airtel";
  return null;
}
