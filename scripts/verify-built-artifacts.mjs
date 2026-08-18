import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const output = join(process.cwd(), 'lib')
const files = readdirSync(output).filter(file => file.endsWith('.js'))
if (files.length === 0) throw new Error('No built JavaScript artifacts were found in lib.')

for (const file of files) {
  execFileSync(process.execPath, ['--check', join(output, file)], { stdio: 'inherit' })
}

const shared = files.filter(file => /^typert\.shared-.*\.js$/.test(file))
if (shared.length !== 1) {
  throw new Error(`Expected one current Typert shared chunk, found ${shared.length}.`)
}

const host = readFileSync(join(output, 'index.js'), 'utf8')
if (/^\s*@Remote\s*\(/m.test(host)) {
  throw new Error('Host bundle still contains decorator syntax that Node cannot execute.')
}
