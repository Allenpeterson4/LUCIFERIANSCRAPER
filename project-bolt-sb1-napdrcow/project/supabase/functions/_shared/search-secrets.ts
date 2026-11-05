import { createClient } from "npm:@supabase/supabase-js@2.57.4";

export type SearchSecretName = "google_maps_api_key" | "google_cse_api_key" | "google_cse_id";

export async function getSearchSecret(name: SearchSecretName, environmentName: string): Promise<string | undefined> {
  const environmentValue = Deno.env.get(environmentName)?.trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return environmentValue || undefined;

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase.from("search_service_secrets")
      .select("secret_value").eq("name", name).maybeSingle();
    const storedValue = typeof data?.secret_value === "string" ? data.secret_value.trim() : "";
    if (!error && storedValue) return storedValue;
  } catch {
    // Keep environment-based configuration available if the secret table is unavailable.
  }

  return environmentValue || undefined;
}