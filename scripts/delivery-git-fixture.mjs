/** Disposable Git fixture infrastructure only; product actions occur through the desktop UI. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const evidence=resolve('docs/v2/evidence/delivery-organization-closure')
const {profile}=JSON.parse(readFileSync(join(evidence,'desktop-session.json'),'utf8'))
const root=join(profile,'delivery-project'),remote=join(profile,'delivery-remote.git'),other=join(profile,'delivery-peer')
const git=(where,...args)=>execFileSync('git',['-C',where,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim()
const commit=(where,file,content)=>{writeFileSync(join(where,file),content);git(where,'add','--',file);git(where,'-c','user.name=Desktop fixture','-c','user.email=desktop@local','commit','-qm','desktop acceptance fixture')}
const phase=process.argv[2]??'init'
if(phase==='init'){
 if(existsSync(root))throw new Error('Fixture exists; refusing to reset existing evidence')
 mkdirSync(root);mkdirSync(remote);git(root,'init','-b','main');git(root,'config','core.autocrlf','false');git(remote,'init','--bare','-b','main')
 commit(root,'value.cjs',"module.exports = { greeting: 'Hello', suffix: '!' };\n")
 commit(root,'value.test.cjs',"const assert = require('node:assert/strict'); require('node:test')('greeting config', () => {const v=require('./value.cjs');assert.equal(typeof v.greeting,'string');assert.equal(typeof v.suffix,'string');});\n")
 git(root,'remote','add','origin',remote);git(root,'push','-u','origin','main');git(profile,'clone','-c','core.autocrlf=false',remote,other)
 commit(other,'remote-note.txt','Synchronized through approved desktop fetch and pull.\n');git(other,'push','origin','main')
}else if(phase==='manual-conflict'){
 git(other,'pull','--ff-only');commit(root,'value.cjs',"module.exports = { greeting: 'Hello there', suffix: '!' };\n");commit(other,'value.cjs',"module.exports = { greeting: 'Hello', suffix: '!!' };\n");git(other,'push','origin','main')
}else if(phase==='agent-conflict'){
 git(other,'pull','--ff-only');commit(root,'value.cjs',"module.exports = { greeting: 'Welcome', suffix: '!!' };\n");commit(other,'value.cjs',"module.exports = { greeting: 'Hello there', suffix: '!!!' };\n");git(other,'push','origin','main')
}else if(phase==='visual'){
 writeFileSync(join(root,'org','long-line.js'),`// Long-line and scrolling fixture for the real desktop comparison viewer.\nmodule.exports = ${JSON.stringify('Long line readable at 1024 and 125 percent. '.repeat(24))};\n`+Array.from({length:80},(_,i)=>`// Review line ${i+1}: original source remains available through vertical scrolling.`).join('\n')+'\n')
}else throw new Error('Unknown fixture phase')
const facts={phase,root,remote,other,local:git(root,'rev-parse','HEAD'),remoteHead:git(other,'rev-parse','HEAD')}
writeFileSync(join(evidence,`fixture-${phase}.json`),JSON.stringify(facts,null,2));console.log(JSON.stringify(facts,null,2))
