import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { projectVerification } from '../apps/runtime/src/verification-choice.js'
const roots:string[]=[]
const fixture=()=>{const root=mkdtempSync(join(tmpdir(),'verification-choice-'));roots.push(root);return root}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
it('selects the configured package manager without executing the script',()=>{
  const root=fixture();writeFileSync(join(root,'package.json'),JSON.stringify({packageManager:'pnpm@10.0.0',scripts:{test:'exit 73'}}))
  expect(projectVerification(root).command).toBe('pnpm test')
})
it('requires real discoverable tests, ignores dependencies and never turns missing tests into success',()=>{
  const root=fixture();mkdirSync(join(root,'node_modules'));writeFileSync(join(root,'node_modules','hidden.test.cjs'),'')
  writeFileSync(join(root,'package.json'),JSON.stringify({scripts:{test:'echo "Error: no test specified" && exit 1'}}))
  expect(()=>projectVerification(root)).toThrow(/补充测试/)
  writeFileSync(join(root,'storage.test.cjs'),"require('node:test')('real check',()=>{})")
  expect(projectVerification(root).command).toBe('node --test')
})
it('does not substitute a fallback for a broken project configuration',()=>{
  const root=fixture();writeFileSync(join(root,'package.json'),'{broken')
  expect(()=>projectVerification(root)).toThrow(/修复配置/)
})
