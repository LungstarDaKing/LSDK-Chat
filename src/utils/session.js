// Session management for LSDKChat
import { supabase } from './supabase.js'

// Session state
let session = null
let sessionListeners = []

// Initialize session from localStorage or Supabase
const initializeSession = async () => {
  try {
    const { data: { session: sessionData } } = await supabase.auth.getSession()
    session = sessionData
    notifySessionListeners()
  } catch (error) {
    console.error('Error initializing session:', error)
  }
}

// Listen for auth changes
supabase.auth.onAuthStateChange((_event, sessionData) => {
  session = sessionData
  notifySessionListeners()
})

// Notify all session listeners
const notifySessionListeners = () => {
  sessionListeners.forEach(listener => listener(session))
}

// Subscribe to session changes
export const subscribeToSession = (listener) => {
  if (typeof listener === 'function') {
    sessionListeners.push(listener)
    // Call immediately with current session
    listener(session)

    // Return unsubscribe function
    return () => {
      sessionListeners = sessionListeners.filter(l => l !== listener)
    }
  }
  return () => {}
}

// Get current session
export const getSession = () => session

// Sign up with email and password
export const signUp = async (email, password, username) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: username || email.split('@')[0]
      }
    }
  })

  if (error) throw error

  // If email confirmation is not required, session is set automatically
  if (!data.user) {
    // Email confirmation required
    return { user: null, session: null }
  }

  return { user: data.user, session: data.session }
}

// Sign in with email and password
export const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) throw error
  return { user: data.user, session: data.session }
}

// Sign in with magic link (email)
export const signInWithMagicLink = async (email) => {
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin
    }
  })

  if (error) throw error
  return { data }
}

// Sign out
export const signOut = async () => {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// Update user profile
export const updateProfile = async (updates) => {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error

  const { data, error: profileError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id)

  if (profileError) throw profileError
  return data
}

// Initialize session on module load
initializeSession()

// Export auth helpers
export const {
  signUp,
  signIn,
  signInWithMagicLink,
  signOut,
  updateProfile,
  isAuthenticated,
  getCurrentUser,
  subscribeToSession
}