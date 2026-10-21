import { copyFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
const root = process.cwd()
const release = join(root, 'release')
const jobs = [
  { dir: 'win-x64', arch: 'x64' },
  { dir: 'win-ia32', arch: 'ia32' },
]
for (const job of jobs) {
  const source = join(release, job.dir)
  if (!existsSync(source)) throw new Error(`missing ${source}`)
  const files = readdirSync(source)
  const portable = files.find((name) => name.endsWith('-portable.exe'))
  const setup = files.find((name) => name.endsWith('-setup.exe'))
  if (!portable || !setup) throw new Error(`missing artifacts in ${source}`)
  copyFileSync(join(source, portable), join(release, `ProjectOS-1.7.0-win-${job.arch}-portable.exe`))
  copyFileSync(join(source, setup), join(release, `ProjectOS-1.7.0-win-${job.arch}-setup.exe`))
  console.log(`collected ${job.arch}: ${portable}, ${setup}`)
}
