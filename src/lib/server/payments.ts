import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

export class PaymentConfigError extends Error {}

export class MarzPayApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly errorCode: string | null,
  ) {
    super(message);
  }
}

export type MarzPayConfig = {
  apiBase: string;
  authorization: string;
  callbackUrl: string;
};

export function createMarzPayConfig(): MarzPayConfig {
  const apiKey = process.env.MARZPAY_API_KEY;
  const apiSecret = process.env.MARZPAY_API_SECRET;
  const apiBase = process.env.MARZPAY_API_BASE || "https://wallet.wearemarz.com/api/v1";
  const callbackUrl = process.env.MARZPAY_CALLBACK_URL;
  if (!apiKey || !apiSecret || !callbackUrl) {
    throw new PaymentConfigError("MarzPay server configuration is incomplete.");
  }

  let parsedCallbackUrl: URL;
  try {
    parsedCallbackUrl = new URL(callbackUrl);
  } catch {
    throw new PaymentConfigError("MarzPay callback URL is invalid.");
  }
  if (parsedCallbackUrl.protocol !== "https:" || parsedCallbackUrl.username || parsedCallbackUrl.password) {
    throw new PaymentConfigError("MarzPay callback URL must be an HTTPS URL.");
  }

  let parsedApiBase: URL;
  try {
    parsedApiBase = new URL(apiBase);
  } catch {
    throw new PaymentConfigError("MarzPay API base URL is invalid.");
  }
  if (parsedApiBase.protocol !== "https:" || parsedApiBase.username || parsedApiBase.password) {
    throw new PaymentConfigError("MarzPay API base URL must be an HTTPS URL.");
  }

  return {
    apiBase: parsedApiBase.toString().replace(/\/+$/, ""),
    authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
    callbackUrl: parsedCallbackUrl.toString(),
  };
}

export async function requestMarzPay(
  config: MarzPayConfig,
  path: string,
  method: "GET" | "POST",
  payload?: Record<string, unknown>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${config.apiBase}/${path.replace(/^\/+/, "")}`, {
      method,
      headers: {
        Authorization: config.authorization,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      cache: "no-store",
    });
  } catch (error) {
    throw new Error("Could not connect to MarzPay.", { cause: error });
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new MarzPayApiError("MarzPay returned an invalid response.", response.status, null);
  }

  if (!isRecord(result)) {
    throw new MarzPayApiError("MarzPay returned an unexpected response.", response.status, null);
  }
  if (!response.ok || result.status === "error") {
    throw new MarzPayApiError(
      typeof result.message === "string" ? result.message : "MarzPay rejected the request.",
      response.status,
      typeof result.error_code === "string" ? result.error_code : null,
    );
  }
  return result;
}

export function verifyMarzPayWebhookSignature(rawBody: string, headers: Headers): boolean {
  const secret = process.env.MARZPAY_WEBHOOK_SECRET;
  if (!secret) return false;

  const signature = headers.get("x-marzpay-signature");
  const timestamp = headers.get("x-marzpay-timestamp");
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false;
  const signedTimestamp = signature.match(/(?:^|,)\s*t=(\d+)\s*(?=,|$)/)?.[1];
  if (signedTimestamp !== timestamp) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    return false;
  }

  const signatures = [...signature.matchAll(/(?:^|,)\s*v1=([a-f0-9]{64})\s*(?=,|$)/gi)];
  if (!signatures.length) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  return signatures.some((match) => {
    const received = Buffer.from(match[1], "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new PaymentConfigError("Supabase server configuration is incomplete.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function authenticateRequest(request: Request): Promise<{
  client: SupabaseClient;
  user: User;
} | null> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey) return null;

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { client, user: data.user };
}
