import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolvePath = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@poker/domain': resolvePath('../../packages/domain/src/index.ts'),
      '@poker/engine': resolvePath('../../packages/engine/src/index.ts'),
      '@poker/ai': resolvePath('../../packages/ai/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
  },
  build: {
    // three.js 本身约 700KB（gzip 181KB），拆分后主业务仅 62KB；
    // 阈值按已知体积上调，避免每次构建都出现无意义的告警。
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // three.js 体积最大且几乎不变，单独成 chunk 便于长期缓存。
        manualChunks(id: string): string | undefined {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/@react-three/')) return 'r3f';
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
});
