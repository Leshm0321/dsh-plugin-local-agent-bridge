import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<string, unknown>
}

function readPatches(path: string): PatchOptions[] {
  const parsed = load(readFileSync(new URL(path, import.meta.url), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`${path} must be a top-level patch array`)
  return parsed as PatchOptions[]
}

describe('DSH package and Profile composition', () => {
  it('declares an installable Host + Client bundle with files inside the package root', () => {
    const manifest = readJson('../../package.json') as {
      dsh?: { bundle?: { patch?: string }; client?: { platform?: string; inject?: string[] } }
      exports?: Record<string, unknown>
      files?: string[]
      private?: boolean
    }
    expect(manifest.private).toBe(true)
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-renderer')
    expect(manifest.exports).toHaveProperty('.')
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.files).toEqual(expect.arrayContaining([
      'lib/**/*.js',
      'lib/**/*.d.ts',
      'lib/**/*.map',
      'cordis.patch.yml',
    ]))
    expect(projectRoot.endsWith('dsh-plugin-local-agent-bridge\\') || projectRoot.endsWith('dsh-plugin-local-agent-bridge/')).toBe(true)
  })

  it('uses official Include patch semantics for install, override, disable, and enable', () => {
    const bundle = readPatches('../../cordis.patch.yml')
    const enabled = readPatches('../../examples/profile/local-agent-bridge.enabled.patch.yml')
    const disabled = readPatches('../../examples/profile/local-agent-bridge.disabled.patch.yml')
    const warnings: string[] = []
    const compose = (patches: PatchOptions[]) => applyEntryPatches([], patches, (message, ...args) => {
      warnings.push([message, ...args.map(String)].join(' '))
    })

    const installed = compose(bundle)
    expect(installed).toEqual([{
      id: 'local-agent-bridge',
      name: 'dsh-plugin-local-agent-bridge',
      config: {
        allowExperimentalVersions: false,
        enableFakeProvider: false,
        eventRetention: 2000,
        longPollMaxMs: 25000,
        processGraceMs: 3000,
      },
    }])
    expect(compose([...bundle, ...enabled])).toEqual(installed)
    expect(compose([...bundle, ...disabled])).toEqual([{ ...installed[0], disabled: true }])
    expect(compose([...bundle, ...disabled, ...enabled, { id: 'local-agent-bridge', disabled: null }])).toEqual(installed)
    expect(warnings).toEqual([])
  })

  it('replaces the Web Profile auto picker with the remote browse pair', () => {
    const remote = readPatches('../../examples/profile/remote-web.patch.yml')
    const warnings: string[] = []
    const composed = applyEntryPatches([{
      id: 'directory-picker',
      name: '@deepseek-ai/dsh-host-directory-picker-auto',
    }], remote, (message, ...args) => {
      warnings.push([message, ...args.map(String)].join(' '))
    })

    expect(composed).toEqual([
      {
        id: 'directory-picker',
        name: '@deepseek-ai/dsh-host-directory-picker-auto',
        disabled: true,
      },
      {
        id: 'directory-picker-browse',
        name: '@deepseek-ai/dsh-host-directory-picker-browse',
      },
      {
        id: 'ui-directory-picker-browse',
        name: '@deepseek-ai/dsh-client-ui-directory-picker-browse',
      },
    ])
    expect(warnings).toEqual([])
  })
})
