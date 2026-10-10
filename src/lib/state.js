// Tiny shared state so pages don't import main.js (avoids circular imports).
import { supabase } from './supabase.js'

export const state = { session: null, profile: null, recovering: false, route: () => {} }
export const flash = { message: null, kind: 'info' }
export const setFlash = (message, kind = 'info') => { flash.message = message; flash.kind = kind }

export const go = (hash) => { if (location.hash === hash) state.route(); else location.hash = hash }
export const getProfile = () => state.profile

export async function refreshProfile() {
  if (!state.session) { state.profile = null; return null }
  const { data, error } = await supabase.from('profiles')
    .select('id, username, bio, avatar_path, terms_version, terms_accepted_at, created_at')
    .eq('id', state.session.user.id).maybeSingle()
  if (error) throw error
  state.profile = data
  return data
}
