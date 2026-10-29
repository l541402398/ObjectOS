import { createHash } from 'node:crypto'
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const release = join(root, 'release')

function sha256(path) {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

function peMachine(path) {
  const buffer = readFileSync(path)
  if (buffer.toString('ascii', 0, 2) !== 'MZ') return 'not-pe'
  const peOffset = buffer.readUInt32LE(0x3c)
  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') return 'no-pe-header'
  const machine = buffer.readUInt16LE(peOffset + 4)
  return machine === 0x8664 ? 'x64' : machine === 0x14c ? 'ia32' : `0x${machine.toString(16)}`
}

const wanted = readdirSync(release).filter((name) => /\.(exe|AppImage)$/.test(name))
const rows = []
for (const name of wanted.sort()) {
  const path = join(release, name)
  const stats = statSync(path)
  rows.push({
    file: name,
    mb: Math.round((stats.size / 1024 / 1024) * 10) / 10,
    arch: name.endsWith('.exe') ? peMachine(path) : 'linux-x64',
    sha256: sha256(path),
  })
}
console.log(JSON.stringify(rows, null, 2))

const linuxDir = join(release, 'linux')
for (const name of readdirSync(linuxDir)) {
  if (!name.endsWith('.AppImage')) continue
  const path = join(linuxDir, name)
  const stats = statSync(path)
  console.log(
    JSON.stringify(
      { file: `linux/${name}`, mb: Math.round((stats.size / 1024 / 1024) * 10) / 10, sha256: sha256(path) },
      null,
      2,
    ),
  )
}
