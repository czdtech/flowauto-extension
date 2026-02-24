import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Avoid JSON import edge-cases in ESM config loaders.
const manifest = JSON.parse(
  readFileSync(new URL('./manifest.json', import.meta.url), 'utf-8')
);

export default defineConfig({
  plugins: [svelte(), crx({ manifest })],
});

