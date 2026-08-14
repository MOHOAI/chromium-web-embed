import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    extension: 'src/extension.ts',
    'extension-worker': 'src/extension-worker.ts',
    'extension-bridge': 'src/extension-bridge.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  outDir: 'dist'
});
