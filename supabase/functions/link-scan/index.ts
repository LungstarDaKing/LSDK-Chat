// Supabase Edge Function "link-scan": asks Google Safe Browsing whether an address is listed as dangerous.
// It does NOT visit the address (so it cannot be used to probe private networks). Only signed-in users may call it.
// Setup:  supabase secrets set GSB_API_KEY=<key from Google Cloud: enable "Safe Browsing API">
//         supabase functions deploy link-scan
// Without GSB_API_KEY it answers { checked: false } and the app uses its built-in checks only.
import { createClient } from 'npm:@supabase/supabase-js@2'

const KEY = Deno.env.get('GSB_API_KEY') ?? ''
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  // must be a signed-in user
  const auth = req.headers.get('authorization') ?? ''
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: u } = await sb.auth.getUser()
  if (!u?.user) return json({ error: 'Not signed in' }, 401)

  let url = ''
  try { url = String((await req.json())?.url ?? '') } catch { return json({ error: 'Bad request' }, 400) }
  if (url.length > 400 || !/^https:\/\//i.test(url)) return json({ error: 'Bad address' }, 400)
  if (!KEY) return json({ checked: false, threat: null })

  try {
    const r = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(KEY)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'lsdkchat', clientVersion: '1.0' },
        threatInfo: { threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'], platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: [{ url }] },
      }),
    })
    if (!r.ok) return json({ checked: false, threat: null })
    const d = await r.json()
    const m = Array.isArray(d?.matches) && d.matches.length ? String(d.matches[0].threatType ?? 'THREAT') : null
    return json({ checked: true, threat: m })
  } catch { return json({ checked: false, threat: null }) }
})
