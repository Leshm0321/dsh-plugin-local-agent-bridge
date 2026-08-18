import { defineConfig } from 'tsdown'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

export default defineConfig({
  name: 'dsh-plugin-local-agent-bridge',
  entry: {
    index: 'src/index.ts',
    'typert.host': 'src/typert.host.ts',
    'typert.remote-client': 'src/typert.remote-client.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: true,
  plugins: [typertPlugin()],
})
