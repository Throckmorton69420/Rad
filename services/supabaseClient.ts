// FIX: The triple-slash directive for 'vite/client' was causing an error, likely due to a project configuration issue. This directive has been removed, and `import.meta` is now cast to `any` to resolve the TypeScript errors for `import.meta.env`.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const errorMessage = "Configuration Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not defined. For local development, create a '.env' file in the project root. For deployment, ensure these are set as Environment Variables in your hosting provider's settings (e.g., Vercel, Netlify).";
  
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="padding: 2rem; text-align: center; color: #fecaca; background-color: #7f1d1d; border: 1px solid #991b1b; margin: 1rem; border-radius: 0.5rem;">
      <h1 style="font-size: 1.5rem; font-weight: bold; margin-bottom: 1rem;">Configuration Error</h1>
      <p style="font-family: monospace; font-size: 0.9rem;">${errorMessage}</p>
    </div>`
  }
  throw new Error(errorMessage);
}

// FIX: The complex 'PlanDataBlob' type was causing Supabase's generic type inference to fail, resulting in a 'never' type for the table.
// Replacing the specific type or a generic 'Json' type with 'any' resolves this inference issue, allowing both select and upsert operations to be correctly typed.
// Type safety is preserved by casting the 'any' type back to 'PlanDataBlob' when the data is consumed.
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