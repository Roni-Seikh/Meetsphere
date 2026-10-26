import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Only the public anon key is ever used in the browser. The service-role key lives on the server.
export const supabase = createClient(env.supabaseUrl || 'http://localhost', env.supabaseAnonKey || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
