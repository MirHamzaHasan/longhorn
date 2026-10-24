import { fileURLToPath } from 'node:url'
export const buildOptions = {
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/index.ts', 'src/config.ts', 'src/app.ts'], outdir: 'dist',
  bundle: true, format: 'esm', platform: 'node', packages: 'external', target: 'es2022', sourcemap: true,
}
