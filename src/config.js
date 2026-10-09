// ---------------------------------------------------------------------------
// App configuration. Fill in the values marked  <<< SET THIS  before you
// invite other people: they are shown to users in the Terms and Privacy Policy.
// ---------------------------------------------------------------------------
export const CONFIG = {
  appName: 'LSDKChat',

  // Supabase project (Project Settings -> API). The publishable/anon key is
  // meant to be public; your data is protected by the Row Level Security rules
  // in supabase/schema.sql, NOT by hiding this key. NEVER put a secret /
  // service_role key in this file.
  supabaseUrl: 'https://btvrgoojmjkbajqmyqpg.supabase.co',
  supabaseKey: 'sb_publishable_4fwQskQOnCuu_lrbL1KUoQ_oGbzOKzY',

  // --- shown in the legal pages ---
  operatorName: 'Lungelo Mthethwa' ,          // <<< SET THIS (person/entity responsible for the service)
  contactEmail: 'mthethwalungelo43@gmail.com' ,      // <<< SET THIS (a mailbox you actually read)
  jurisdiction: 'South Africa',            // <<< SET THIS (e.g. "South Africa") - governing law
  dataRegion:   'eu-west-2',    // <<< SET THIS (Supabase -> Project Settings -> General, e.g. "eu-west-1 (Ireland)")

  // Bump this whenever you change the Terms/Privacy/Disclosures. Every user
  // is then asked to accept again before they can keep chatting.
  termsVersion: '2026-10-07',
  minAge: 18,
}

export const isPlaceholder = (v) => !v || String(v).startsWith('REPLACE_')
export const operatorConfigured = () =>
  ['operatorName', 'contactEmail', 'jurisdiction', 'dataRegion'].every((k) => !isPlaceholder(CONFIG[k]))
