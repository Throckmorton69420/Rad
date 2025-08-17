import { createClient } from '@supabase/supabase-js';
import { PlanDataBlob } from '../types';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const errorMessage = "Configuration Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not defined. For local development, create a '.env' file in the project root. For deployment, ensure these are set as Environment Variables in your hosting provider's settings (e.g., Vercel, Netlify).";
  
  // Display error to the user in the UI, as this is a client-side app
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="padding: 2rem; text-align: center; color: #fecaca; background-color: #7f1d1d; border: 1px solid #991b1b; margin: 1rem; border-radius: 0.5rem;">
      <h1 style="font-size: 1.5rem; font-weight: bold; margin-bottom: 1rem;">Configuration Error</h1>
      <p style="font-family: monospace; font-size: 0.9rem;">${errorMessage}</p>
    </div>`
  }
  throw new Error(errorMessage);
}

// A type for JSON as Supabase expects it. This helps TypeScript's inference.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// Define the shape of our database tables for TypeScript.
// For this app, we are using one table to store all synced state.
export interface Database {
  public: {
    Tables: {
      study_plans: { // The table name created by the user
        Row: { // The data shape of a row
          id: number;
          created_at: string;
          plan_data: PlanDataBlob;
        };
        Insert: { // The data shape for inserting a new row
          id: number;
          plan_data: PlanDataBlob;
        };
        Update: { // The data shape for updating a row
          plan_data?: PlanDataBlob;
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