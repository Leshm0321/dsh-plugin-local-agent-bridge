import { defineConfig } from 'tsdown'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

// Only the decorator-lowering transform is wanted from this plugin. Its
// writeBundle has never emitted anything for this repository — it looks for a
// package.json between lib/ and the workspace root and stops at the root — and
// from 0.2.1 it locates that root by requiring a packages/ directory, which a
// standalone plugin repository does not have, so it throws instead.
const { writeBundle: _writeBundle, ...typert } = typertPlugin()

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
  plugins: [typert],
})
