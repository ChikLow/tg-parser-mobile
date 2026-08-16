import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the app from /<repo>/, other hosts from the root.
// Override with BASE_PATH=/ npm run build
const base = process.env.BASE_PATH ?? '/tg-parser-mobile/'

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.png'],
      manifest: {
        name: 'TG Parser — телеграм парсер',
        short_name: 'TG Parser',
        description: 'Парсер повідомлень та учасників Telegram просто в браузері телефона',
        lang: 'uk',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0e1621',
        theme_color: '#0e1621',
        categories: ['utilities', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // the MTProto bundle is ~1.8 MB, well above workbox' 2 MB default
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2500,
  },
  server: { host: true },
})
