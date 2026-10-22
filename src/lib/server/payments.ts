import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { PesaJet } from "@pesajet/sdk";

export class PaymentConfigError extends Error {}

export function createPesaJetClient() {
  const apiKey = process.env.PESAJET_API_KEY;
  const webhookSecret = process.env.PESAJET_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) {
    throw new PaymentConfigError("PesaJet server configuration is incomplete.");
  }
  return new PesaJet({ apiKey, webhookSecret });
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
