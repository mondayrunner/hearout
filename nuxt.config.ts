import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: { deployConfig: false, nodeCompat: true },
  },
  // The admin fetches everything in the browser, where the Basic Auth login lives.
  routeRules: { '/admin': { ssr: false } },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Interview',
      meta: [
        { name: 'robots', content: 'noindex' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
})
