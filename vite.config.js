import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, join } from 'path';
import { cpSync, copyFileSync, mkdirSync, existsSync } from 'fs';

// Custom plugin: copy extension static files into dist/ after build
function copyExtensionFiles() {
  return {
    name: 'copy-extension-files',
    closeBundle() {
      const root = process.cwd();
      const dist = join(root, 'dist');

      function copy(src, dest) {
        const fullSrc = join(root, src);
        const fullDest = join(dist, dest || src);
        if (!existsSync(fullSrc)) {
          console.warn(`[ext-copy] Skipping missing: ${src}`);
          return;
        }
        mkdirSync(join(fullDest, '..'), { recursive: true });
        try {
          cpSync(fullSrc, fullDest, { recursive: true });
          console.log(`[ext-copy] ${src} → dist/${dest || src}`);
        } catch (e) {
          console.error(`[ext-copy] Failed to copy ${src}:`, e.message);
        }
      }

      // Manifest
      copyFileSync(join(root, 'manifest.json'), join(dist, 'manifest.json'));
      console.log('[ext-copy] manifest.json → dist/manifest.json');

      // Background service worker
      mkdirSync(join(dist, 'background'), { recursive: true });
      copyFileSync(
        join(root, 'background/service-worker.js'),
        join(dist, 'background/service-worker.js')
      );
      console.log('[ext-copy] background/service-worker.js → dist/');

      // Content script
      mkdirSync(join(dist, 'content'), { recursive: true });
      copyFileSync(
        join(root, 'content/facebook.js'),
        join(dist, 'content/facebook.js')
      );
      console.log('[ext-copy] content/facebook.js → dist/');

      // Assets (icons)
      if (existsSync(join(root, 'assets'))) {
        mkdirSync(join(dist, 'assets'), { recursive: true });
        cpSync(join(root, 'assets'), join(dist, 'assets'), { recursive: true });
        console.log('[ext-copy] assets/ → dist/assets/');
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionFiles()],
  base: './',
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup/popup.html')
      },
      output: {
        // Keep chunk names predictable for extension
        entryFileNames: 'popup/[name].js',
        chunkFileNames: 'popup/chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          if (name.endsWith('.css')) return 'popup/[name][extname]';
          return 'popup/[name]-[hash][extname]';
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.')
    }
  }
});
