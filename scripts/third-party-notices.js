// Generates third-party-notices.txt from the PRODUCTION dependency tree in package-lock.json.
// usage: node scripts/third-party-notices.js <output-dir>
import fs from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2] || 'public'
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
const entries = Object.entries(lock.packages).filter(([k, v]) => k.startsWith('node_modules/') && !v.dev && !v.optional)
const out = ['THIRD-PARTY SOFTWARE NOTICES', 'This application bundles the following open-source packages.', '']
for (const [dir] of entries.sort()) {
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  out.push('='.repeat(78), `${pj.name}@${pj.version}`, `License: ${typeof pj.license === 'string' ? pj.license : JSON.stringify(pj.license)}`,
    pj.repository ? `Source: ${typeof pj.repository === 'string' ? pj.repository : pj.repository.url}` : '', '')
  const file = fs.readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\..*)?$/i.test(f))
  out.push(file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : '(license text not included in the package; see the license identifier above)', '')
}
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'third-party-notices.txt'), out.join('\n'))
console.log(`third-party-notices.txt written to ${outDir} (${entries.length} packages)`)
