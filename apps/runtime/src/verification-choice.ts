import { existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '@projectos/contracts'
import { resolveWorkspacePath } from '@projectos/workspace'

/** Read project conventions; never execute discovery, install dependencies or invent a passing check. */
export function projectVerification(root: string): {command:string;label:string} {
  const file=(path:string)=>{
    const absolute=resolveWorkspacePath(root,path,{forWrite:true})
    if(!existsSync(absolute)||!lstatSync(absolute).isFile()||lstatSync(absolute).size>1_000_000)return null
    return readFileSync(absolute,'utf8')
  }
  const manifest=file('package.json')
  if(manifest){
    let pkg:{scripts?:Record<string,unknown>;packageManager?:string}
    try{pkg=JSON.parse(manifest) as typeof pkg}catch{throw new AppError('CONFLICT','项目测试配置无法读取，请让工程 Agent 修复配置后重试。')}
    const test=pkg.scripts?.test
    if(typeof test==='string'&&test.trim()&&!/no test specified|no tests? (?:yet|configured)/i.test(test)){
      const manager=pkg.packageManager?.split('@')[0]??(existsSync(join(root,'pnpm-lock.yaml'))?'pnpm':existsSync(join(root,'yarn.lock'))?'yarn':existsSync(join(root,'bun.lock'))?'bun':'npm')
      if(!['npm','pnpm','yarn','bun'].includes(manager))throw new AppError('CONFLICT','项目使用的测试工具暂不支持，请让工程 Agent 确认验证配置。')
      return {command:`${manager} test`,label:'项目自动测试'}
    }
  }
  const ignored=new Set(['.git','node_modules','dist','build','out','release','.venv','venv','target','.tmp'])
  let count=0
  const nodeTests=(dir:string,depth:number):boolean=>{
    if(depth>8)return false
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      if(++count>10000)throw new AppError('CONFLICT','项目文件较多，请让工程 Agent 在项目配置中明确自动测试方式。')
      if(entry.isSymbolicLink()||ignored.has(entry.name))continue
      if(entry.isFile()&&/\.test\.(?:cjs|mjs|js)$/.test(entry.name))return true
      if(entry.isDirectory()&&nodeTests(join(dir,entry.name),depth+1))return true
    }
    return false
  }
  if(nodeTests(root,0))return {command:'node --test',label:'项目自动测试'}
  if(file('pytest.ini')||file('pyproject.toml')?.includes('[tool.pytest'))return {command:'python -m pytest',label:'项目自动测试'}
  if(file('Cargo.toml'))return {command:'cargo test',label:'项目自动测试'}
  if(file('go.mod'))return {command:'go test ./...',label:'项目自动测试'}
  throw new AppError('CONFLICT','尚未发现项目的自动测试配置。请让工程 Agent 补充测试后，再运行验证。')
}
