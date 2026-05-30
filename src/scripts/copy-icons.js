/**
 * copy-icons.js
 * Copies /icons → /public/icons so Astro serves them as static assets.
 * Run before `astro dev` or `astro build`.
 */

import { cpSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

const SRC  = join(process.cwd(), 'icons');
const DEST = join(process.cwd(), 'public', 'icons');

if (!existsSync(SRC)) {
  console.error('✗ /icons directory not found. Run from project root.');
  process.exit(1);
}

// Clear old copy first so removed icons don't linger
if (existsSync(DEST)) {
  rmSync(DEST, { recursive: true });
}

cpSync(SRC, DEST, { recursive: true });
console.log(`✓ Icons copied to public/icons`);