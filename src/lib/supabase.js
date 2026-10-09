import { createClient } from '@supabase/supabase-js'
import { CONFIG } from '../config.js'

export const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: {
    flowType: 'pkce',          // confirmation / reset links return ?code=... (no tokens in the URL hash)
    persistSession: true,      // session token is kept in this browser's localStorage
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: { params: { eventsPerSecond: 10 } },
})

// Where email links should send people back to (works on GitHub Pages sub-paths).
export const appUrl = () => window.location.origin + window.location.pathname
