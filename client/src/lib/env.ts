const raw = {
  apiUrl: (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, ''),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
};

export const env = raw;

/** Names of required variables that are missing (shown on a friendly setup screen). */
export const missingEnv: string[] = [
  ['VITE_API_URL', raw.apiUrl],
  ['VITE_SUPABASE_URL', raw.supabaseUrl],
  ['VITE_SUPABASE_ANON_KEY', raw.supabaseAnonKey],
]
  .filter(([, v]) => !v)
  .map(([k]) => k as string);
