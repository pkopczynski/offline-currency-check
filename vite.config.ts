import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const SW_ENTRY = 'sw';

// Lists every file in a directory tree, relative to it, using forward slashes.
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));
}

// Injects the list of built files and a hash of their contents into the service
// worker, so the precache always matches the build and changes invalidate the cache.
function precacheManifest(): Plugin {
  let publicDir = '';
  return {
    name: 'precache-manifest',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle: {
      // 'post' so Vite's HTML plugin has already emitted index.html into the bundle.
      order: 'post',
      handler(_options, bundle) {
        const sw = Object.values(bundle).find((f) => f.type === 'chunk' && f.isEntry && f.name === SW_ENTRY);
        if (!sw || sw.type !== 'chunk') throw new Error('Service worker chunk not found');

        const files = new Map<string, string | Uint8Array>();
        for (const f of Object.values(bundle)) {
          if (f !== sw) files.set(f.fileName, f.type === 'chunk' ? f.code : f.source);
        }
        if (publicDir) {
          for (const name of listFiles(publicDir)) files.set(name, readFileSync(join(publicDir, name)));
        }

        const names = [...files.keys()].sort();
        const hash = createHash('sha256');
        for (const name of names) hash.update(name).update('\0').update(files.get(name)!).update('\0');

        const replacements = {
          __PRECACHE_FILES__: JSON.stringify(names.map((n) => `./${n}`)),
          __PRECACHE_VERSION__: JSON.stringify(hash.digest('hex').slice(0, 12)),
        };
        for (const [placeholder, value] of Object.entries(replacements)) {
          if (sw.code.split(placeholder).length !== 2) throw new Error(`Expected one ${placeholder} in the service worker`);
          sw.code = sw.code.replace(placeholder, value);
        }
      },
    },
  };
}

export default defineConfig({
  // Relative URLs, so the build works at a domain root and under a GitHub Pages
  // repository subpath (https://<user>.github.io/<repo>/) without configuration.
  base: './',
  build: {
    rolldownOptions: {
      input: { index: 'index.html', [SW_ENTRY]: 'src/sw.ts' },
      output: {
        // The service worker needs a stable URL at the root so its scope covers the whole app.
        entryFileNames: (chunk) => (chunk.name === SW_ENTRY ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  plugins: [precacheManifest()],
});
