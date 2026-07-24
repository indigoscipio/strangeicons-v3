// @ts-check
import { defineConfig } from 'astro/config';
import library from './src/data/library.json' with { type: 'json' };

// https://astro.build/config
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: library.siteUrl,
  output: 'static',
  integrations: [sitemap()],
});
