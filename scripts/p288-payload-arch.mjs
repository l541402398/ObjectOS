import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
function peMachine(path) {
  const buffer = readFileSync(path)
  if (buffer.toString('ascii', 0, 2) !== 'MZ') return 'not-pe'
  const peOffset = buffer.readUInt32LE(0x3c)
  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') return 'no-pe-header'
  const machine = buffer.readUInt16LE(peOffset + 4)
  return machine === 0x8664 ? 'x64' : machine === 0x14c ? 'ia32' : `0x${machine.toString(16)}`
}

const targets = [
  ['release/win-x64/win-unpacked/ProjectOS.exe', 'Windows x64 payload'],
  ['release/win-ia32/win-ia32-unpacked/ProjectOS.exe', 'Windows ia32 payload'],
]
for (const [relative, label] of targets) {
  const path = join(root, relative)
  if (!existsSync(path)) {
    console.log(label, 'MISSING', relative)
    continue
  }
  const stats = statSync(path)
  const asar = join(path, '..', 'resources', 'app.asar')
  console.log(
    JSON.stringify({
      label,
      path: relative,
      arch: peMachine(path),
      mb: Math.round((stats.size / 1024 / 1024) * 10) / 10,
      asar: existsSync(asar) ? Math.round((statSync(asar).size / 1024 / 1024) * 10) / 10 : null,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16),
    }),
  )
}
