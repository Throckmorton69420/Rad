import { createClient } from '@supabase/supabase-js';

// FIXED: Safe environment variable access with proper fallbacks
const getEnvVar = (key: string): string | undefined => {
  try {
    return (import.meta as any)?.env?.[key];
  } catch {
    return undefined;
  }
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY') || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase configuration missing - app will work in offline mode');
  
  // Create a minimal client that doesn't crash the app
  const mockClient = {
    from: () => ({
      select: () => ({ single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }) }),
      upsert: () => Promise.resolve({ error: null })
    })
  };
  
  export const supabase = mockClient as any;
} else {
  export interface Database {
    public: {
      Tables: {
        study_plans: {
          Row: {
            id: number;
            created_at: string;
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
      Views: {
        [_ in never]: never;
      };
      Functions: {
        [_ in never]: never;
      };
      Enums: {
        [_ in never]: never;
      };
      CompositeTypes: {
        [_ in never]: never;
      };
    };
  }

  export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
}