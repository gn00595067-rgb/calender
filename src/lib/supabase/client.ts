import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

type Client = ReturnType<typeof createBrowserClient<Database>>;

let cached: Client | null = null;

/**
 * 瀏覽器端 Supabase client（Client Components 使用）。單例，避免重複建立。
 */
export function createClient(): Client {
  if (cached) return cached;
  cached = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}
