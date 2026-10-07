// Supabase client initialization
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Initialize Supabase client
const supabaseUrl = 'https://btvrgoojmjkbajqmyqpg.supabase.co'
const supabaseAnonKey = 'sb_publishable_4fwQskQOnCuu_lrbL1KUoQ_oGbzOKzY'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Helper function to check if user is authenticated
export const isAuthenticated = async () => {
  const { data: { user }, error } = await supabase.auth.getUser()
  return !error && user
}

// Helper function to get current user
export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  return user
}