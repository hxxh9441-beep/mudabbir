import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    /**
     * PWA: **العمل بلا شبكة + تحديثٌ تلقائيّ**.
     * • العمل بلا شبكة: يُخزَّن هيكل التطبيق (HTML/JS/CSS) مع **بيانات المصحف
     *   (١٫٥ ميغا)** و**الخطوط (العربية والثمانية)** و**الأيقونات** في مخزن
     *   العمل (precache) لحظة التثبيت ⇒ يفتح التطبيق كاملاً بلا إنترنت.
     * • التحديث التلقائيّ: `autoUpdate` ⇒ عند نشر نسخةٍ جديدة يلتقطها العامل
     *   الخادميّ في الخلفيّة ويُفعّلها فوراً (skipWaiting + clientsClaim) بلا أن
     *   يطلب المعلّم شيئاً.
     * • البيانات نفسها في IndexedDB ولا تُمَسّ بالتحديث إطلاقاً.
     */
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // نسجّل يدوياً من main.tsx
      manifest: false, // نُبقي public/manifest.json المكتوب يدوياً (rtl + الألوان)
      includeAssets: ['icon.svg', 'favicon.svg', 'icons/*.png'],
      workbox: {
        // كل ما يلزم للعمل بلا شبكة: الكود + البيانات + الخطوط + الأيقونات
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, // mushaf-pages.json = ١٫٥م
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // خطوط جوجل (Cairo + Amiri Quran) — بلا شبكة بعد أول تحميل
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-css',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // العامل الخادميّ الحقيقيّ يُبنى في `npm run build` ويُجرَّب بـ`preview`.
        enabled: false,
      },
    }),
  ],
  server: {
    host: true, // To allow LAN access
    port: 3000,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
  publicDir: 'public',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
