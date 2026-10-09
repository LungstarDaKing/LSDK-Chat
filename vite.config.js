import { defineConfig } from 'vite'
import { CONFIG } from './src/config.js'

// Content-Security-Policy is added to the production build only (the dev
// server needs inline/HMR scripts). GitHub Pages cannot send HTTP headers,
// so a <meta> tag is the best available option.
const host = new URL(CONFIG.supabaseUrl).host
const csp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  `connect-src 'self' https://${host} wss://${host}`,
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ')

export default defineConfig({
  base: './', // works under https://<user>.github.io/<repo>/ without changes
  plugins: [{
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml: () => [{
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
      injectTo: 'head-prepend',
    }],
  }],
  build: {
    target: 'es2020',
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
})
