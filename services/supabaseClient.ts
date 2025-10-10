// services/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

// These variables are expected to be set in the environment,
// typically through a .env file locally or in Vercel project settings.
// Vite exposes env vars prefixed with VITE_ to the client-side code.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // This error is thrown during initialization to ensure the app doesn't
  // run without proper Supabase configuration.
  throw new Error('Supabase URL and Anon Key must be defined in environment variables.');
}

// Create and export the Supabase client instance
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
