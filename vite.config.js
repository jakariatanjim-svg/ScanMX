import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function escapeRegExp(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => String.fromCharCode(92) + character);
}

function inlineStandaloneAssets() {
  return {
    name: 'scanmx-inline-standalone-assets',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlFiles = Object.keys(bundle).filter((name) => /\.html?$/i.test(name));
      const scriptFiles = Object.keys(bundle).filter((name) => /\.[mc]?js$/i.test(name));
      const styleFiles = Object.keys(bundle).filter((name) => /\.css$/i.test(name));
      const removeAfterInlining = [];

      for (const htmlFile of htmlFiles) {
        const htmlAsset = bundle[htmlFile];
        let html = String(htmlAsset.source);
        for (const filename of scriptFiles) {
          const script = bundle[filename];
          if (!script || script.type !== 'chunk' || script.code == null) continue;
          const reference = new RegExp(`<script([^>]*?) src="(?:[^"]*?/)?${escapeRegExp(script.fileName)}"([^>]*)></script>`);
          const code = script.code
            .replace(/"?__VITE_PRELOAD__"?/g, 'void 0')
            .replace(/<(\/script>|!--)/g, (_match, ending) => `${String.fromCharCode(92)}x3C${ending}`);
          const replaced = html.replace(reference, (_match, before, after) => `<script${before}${after}>${code.trim()}</script>`);
          if (replaced === html) this.error(`Could not inline the application script ${script.fileName} into ${htmlFile}.`);
          html = replaced;
          removeAfterInlining.push(filename);
        }
        for (const filename of styleFiles) {
          const style = bundle[filename];
          if (!style || style.type !== 'asset') continue;
          const reference = new RegExp(`<link([^>]*?) href="(?:[^"]*?/)?${escapeRegExp(filename)}"([^>]*)>`);
          const css = String(style.source).replace('@charset "UTF-8";', '');
          const replaced = html.replace(reference, (_match, before, after) => `<style${before}${after}>${css.trim()}</style>`);
          if (replaced === html) this.error(`Could not inline the application stylesheet ${filename} into ${htmlFile}.`);
          html = replaced;
          removeAfterInlining.push(filename);
        }
        htmlAsset.source = html;
      }

      for (const filename of removeAfterInlining) delete bundle[filename];
      const remainingAssets = Object.values(bundle).filter((item) => item.type === 'asset' && !/\.html?$/i.test(item.fileName));
      for (const asset of remainingAssets) this.warn(`Standalone output still contains a separate asset: ${asset.fileName}`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), inlineStandaloneAssets()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
  },
});
