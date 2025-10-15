import { createClient } from '@supabase/supabase-js';

// Safe env getter (works in Vite prod and local)
const getEnvVar = (key: string): string | undefined => {
  try {
    const v = (import.meta as any)?.env?.[key];
    return typeof v === 'string' && v.length ? v : undefined;
  } catch {
    // Non-Vite contexts (SSR/build) won’t have import.meta
    return (process as any)?.env?.[key];
  }
};

const SUPABASE_URL = getEnvVar('VITE_SUPABASE_URL');
const SUPABASE_ANON_KEY = getEnvVar('VITE_SUPABASE_ANON_KEY');

// Single export at top-level so esbuild doesn’t see conditional exports
export type SupabaseClientLike = {
  from: (table: string) => {
    select: (columns?: string) => { single: () => Promise<{ data: any; error: any }> };
    upsert: (rows: any[]) => Promise<{ error: any }>;
  };
};

// Minimal mock client used when env vars are missing (prevents crashes)
const makeMockClient = (): SupabaseClientLike => ({
  from: () => ({
    select: () => ({
      // Simulate “no rows” so app proceeds to generate a plan
      single: async () => ({ data: null, error: { code: 'PGRST116' } }),
    }),
    upsert: async () => ({ error: null }),
  }),
});

// Build a real client when env is present
const buildRealClient = () => {
  // Local runtime guard: if either is missing, fall back to mock
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return makeMockClient();

  // Define DB types only in the real path (but not via “export” here)
  interface Database {
    public: {
      Tables: {
        study_plans: {
          Row: {
            id: number;
            created_at?: string;
            plan_data: any | null;
          };
          Insert: {
            id?: number;
            plan_data?: any | null;
          };
          Update: {
            plan_data?: any | null;
          };
        };
      };
      Views: { [_ in never]: never };
      Functions: { [_ in never]: never };
      Enums: { [_ in never]: never };
      CompositeTypes: { [_ in never]: never };
    };
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY) as unknown as SupabaseClientLike;
};

// Decide once at module init; do not use conditional “export”
const internalClient: SupabaseClientLike =
  SUPABASE_URL && SUPABASE_ANON_KEY ? buildRealClient() : makeMockClient();

export const supabase = internalClient;
