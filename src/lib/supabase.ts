import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

export function getSupabaseConfigurationError() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart the app.";
  }

  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname || !["http:", "https:"].includes(parsedUrl.protocol)) {
      return "NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP or HTTPS URL.";
    }
  } catch {
    return "NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP or HTTPS URL.";
  }

  return null;
}

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const configurationError = getSupabaseConfigurationError();
  if (configurationError) throw new Error(configurationError);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase configuration became unavailable.");
  }
  browserClient = createClient(url, anonKey);
  return browserClient;
}
