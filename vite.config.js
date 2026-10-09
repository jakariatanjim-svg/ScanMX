import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          opencv: ['@techstark/opencv-js'],
          jspdf: ['jspdf'],
        },
      },
    },
  },
});
