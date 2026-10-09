// Runs before `npm run build`. Warns locally, FAILS in CI (GitHub Actions)
// so you can't accidentally publish legal pages with placeholder text.
import { CONFIG, isPlaceholder } from '../src/config.js'

const missing = ['operatorName', 'contactEmail', 'jurisdiction', 'dataRegion'].filter((k) => isPlaceholder(CONFIG[k]))
if (/service_role|sb_secret/i.test(CONFIG.supabaseKey)) {
  console.error('\n✖ A secret Supabase key is in src/config.js. Use the publishable/anon key only.\n')
  process.exit(1)
}
if (missing.length) {
  const msg = `\n${process.env.CI ? '✖' : '⚠'} src/config.js still has placeholder values for: ${missing.join(', ')}\n  These appear in the Terms/Privacy Policy shown to users. Fill them in before inviting anyone.\n`
  if (process.env.CI) { console.error(msg); process.exit(1) }
  console.warn(msg)
}
