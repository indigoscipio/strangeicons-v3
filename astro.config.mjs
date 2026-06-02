// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://strangeicons.com',
  output: 'static',
  integrations: [sitemap()],
});
