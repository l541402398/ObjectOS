import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildOrganizationServer } from '../apps/server/src/persistent-server.js'
import {
  migrateOrganizationDatabase,
  postgresTokens,
  ORGANIZATION_SCHEMA_VERSION,
} from '../apps/server/src/postgres-store.js'
import { reserveOrganizationTestPort, startOrganizationTestDatabase } from './helpers/org-postgres.js'
import { canonicalAssetDefinition } from '@projectos/organization-contracts'

describe('A2.2 device identity and grants — actual PostgreSQL / HTTP', () => {
  let database: Awaited<ReturnType<typeof startOrganizationTestDatabase>>,
    server: Awaited<ReturnType<typeof buildOrganizationServer>>,
    origin: string
  const org = randomUUID(),
    other = randomUUID(),
    project = randomUUID()
  const owner = randomUUID(),
    admin = randomUUID(),
    member = randomUUID()
  const tokens = new Map<string, string>()
  const secret = () => randomBytes(48).toString('base64url')
  const enrollment = () => ({
    registrationId: randomUUID(),
    instanceId: randomUUID(),
    secret: secret(),
    name: '设计工作站',
    platform: 'win32',
    protocol: 'local-worker/1',
  })
  const grant = () => ({
    id: randomUUID(),
    projectId: project,
    workspaceRef: randomUUID(),
    scope: { directories: ['src'], tools: ['read_file'], maxToolCalls: 20 },
    scopeDigest: 'a'.repeat(64),
    expiresAt: Date.now() + 3600_000,
  })
  async function request(
    path: string,
    body?: unknown,
    account: string = owner,
    method = body ? 'POST' : 'GET',
    proof?: string,
    orgId: string = org,
  ) {
    const response = await fetch(origin + `/v1/organizations/${orgId}/workers` + path, {
      method,
      headers: {
        authorization: `Bearer ${tokens.get(account) ?? account}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(proof ? { 'x-worker-proof': proof } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, body: (await response.json()) as any }
  }
  beforeAll(async () => {
    database = await startOrganizationTestDatabase()
    await migrateOrganizationDatabase(database.pool, 2)
    const old = (
      await database.pool.query(
        'SELECT version,checksum FROM organization_schema_migrations ORDER BY version',
      )
    ).rows
    await migrateOrganizationDatabase(database.pool)
    expect(
      (
        await database.pool.query(
          'SELECT version,checksum FROM organization_schema_migrations WHERE version<3 ORDER BY version',
        )
      ).rows,
    ).toEqual(old)
    expect(ORGANIZATION_SCHEMA_VERSION).toBe(4)
    for (const id of [owner, admin, member])
      await database.pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$1,$2,false)', [
        id,
        `${id}@worker.invalid`,
      ])
    for (const id of [org, other])
      await database.pool.query('INSERT INTO organization(id,name,slug,"createdAt") VALUES($1,$1,$1,now())', [
        id,
      ])
    for (const [id, role] of [
      [owner, 'owner'],
      [admin, 'admin'],
      [member, 'member'],
    ]) {
      await database.pool.query(
        'INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',
        [randomUUID(), org, id, role],
      )
      const token = secret()
      tokens.set(id!, token)
      await postgresTokens(database.pool).issue(createHash('sha256').update(token).digest('base64url'), {
        accountId: id!,
        expiresAt: Date.now() + 3600_000,
      })
    }
    await database.pool.query(
      'INSERT INTO organization_projects(id,organization_id,key,name,created_at,updated_at) VALUES($1,$2,$1,$1,1,1)',
      [project, org],
    )
    await database.pool.query(
      'INSERT INTO organization_project_members(id,organization_id,project_id,account_id,role,created_at) VALUES($1,$2,$3,$4,$5,1)',
      [randomUUID(), org, project, owner, 'owner'],
    )
    origin = `http://127.0.0.1:${await reserveOrganizationTestPort()}`
    server = await buildOrganizationServer({
      databaseUrl: database.databaseUrl,
      secret: secret(),
      baseURL: origin,
    })
    await server.listen({ host: '127.0.0.1', port: Number(new URL(origin).port) })
  }, 60_000)
  afterAll(async () => {
    await server?.close()
    await database?.stop()
  })

  it('idempotently enrolls one device, hashes its proof and exposes no path/secret/session', async () => {
    const value = enrollment()
    expect((await request('', value)).status).toBe(200)
    expect((await request('', value)).status).toBe(200)
    const rows = (
      await database.pool.query('SELECT * FROM organization_workers WHERE id=$1', [value.registrationId])
    ).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].secret_hash).not.toBe(value.secret)
    const listed = await request('')
    expect(listed.status).toBe(200)
    expect(JSON.stringify(listed.body)).not.toContain(value.secret)
    expect(JSON.stringify(listed.body)).not.toContain(rows[0].desktop_session_hash)
    expect(listed.body.workers.find((w: any) => w.id === value.registrationId)).toMatchObject({
      status: 'offline',
      executionReady: true,
    })
    expect((await request(`/${value.registrationId}/heartbeat`, {}, value.secret)).status).toBe(200)
    expect((await request('')).body.workers.find((w: any) => w.id === value.registrationId).status).toBe(
      'online',
    )
    expect((await request('', { ...value, secret: secret() })).status).toBe(403)
    expect((await request('', value, member)).status).toBe(403)
    expect((await request('', undefined, owner, 'GET', undefined, other)).status).toBe(403)
  })
  it('keeps project access distinct, allows exact grant retries and rejects widening or reactivation', async () => {
    const value = enrollment(),
      consent = grant()
    await request('', value)
    expect((await request(`/${value.registrationId}/grants`, consent, value.secret)).status).toBe(200)
    expect((await request(`/${value.registrationId}/grants`, consent, value.secret)).status).toBe(200)
    expect(
      (
        await request(
          `/${value.registrationId}/grants`,
          { ...consent, scope: { ...consent.scope, tools: ['write_file'] } },
          value.secret,
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await request(
          `/${value.registrationId}/grants`,
          { ...grant(), expiresAt: Date.now() - 1 },
          value.secret,
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await request(
          `/${value.registrationId}/grants`,
          { ...grant(), scope: { ...consent.scope, directories: ['../outside'] } },
          value.secret,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await request(
          `/${value.registrationId}/grants`,
          { ...grant(), scope: { ...consent.scope, tools: ['run_command'] } },
          value.secret,
        )
      ).status,
    ).toBe(400)
    expect((await request('', undefined, admin)).body.grants).toEqual([])
    expect((await request(`/grants/${consent.id}`, undefined, owner, 'DELETE')).status).toBe(200)
    expect((await request(`/${value.registrationId}/grants`, consent, value.secret)).status).toBe(409)
    const unprivileged = enrollment()
    await request('', unprivileged, member)
    expect(
      (await request(`/${unprivileged.registrationId}/grants`, grant(), unprivileged.secret)).status,
    ).toBe(403)
  })
  it('permits admin pause/revoke but resumes only with owner plus matching device proof', async () => {
    const value = enrollment()
    await request('', value)
    const state = { workerId: value.registrationId, expectedRevision: 1, state: 'paused' }
    expect((await request('/state', state, admin)).status).toBe(200)
    expect((await request(`/${value.registrationId}/heartbeat`, {}, value.secret)).status).toBe(403)
    expect(
      (
        await request(
          '/state',
          { ...state, expectedRevision: 2, state: 'active' },
          admin,
          'POST',
          value.secret,
        )
      ).status,
    ).toBe(403)
    expect((await request('/state', { ...state, expectedRevision: 2, state: 'active' })).status).toBe(403)
    expect(
      (
        await request(
          '/state',
          { ...state, expectedRevision: 2, state: 'active' },
          owner,
          'POST',
          value.secret,
        )
      ).status,
    ).toBe(200)
    expect((await request('/state', { ...state, expectedRevision: 2, state: 'revoked' })).status).toBe(409)
    expect((await request('/state', { ...state, expectedRevision: 3, state: 'revoked' }, admin)).status).toBe(
      200,
    )
    expect((await request('', value)).status).toBe(403)
    expect(
      (
        await request(
          '/state',
          { ...state, expectedRevision: 4, state: 'active' },
          owner,
          'POST',
          value.secret,
        )
      ).status,
    ).toBe(409)
  })
  it('serializes role removal against grants and projects invalid authority honestly', async () => {
    const value = enrollment()
    await request('', value)
    const consent = grant()
    await request(`/${value.registrationId}/grants`, consent, value.secret)
    await database.pool.query(
      "UPDATE organization_project_members SET role='viewer' WHERE project_id=$1 AND account_id=$2",
      [project, owner],
    )
    expect((await request(`/${value.registrationId}/grants`, grant(), value.secret)).status).toBe(403)
    expect((await request('')).body.grants.find((g: any) => g.id === consent.id).status).toBe('unavailable')
    await database.pool.query(
      "UPDATE organization_project_members SET role='owner' WHERE project_id=$1 AND account_id=$2",
      [project, owner],
    )
    await database.pool.query('DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2', [org, owner])
    expect((await request(`/${value.registrationId}/heartbeat`, {}, value.secret)).status).toBe(403)
    expect((await request('')).status).toBe(403)
    await database.pool.query(
      'INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,\'owner\',now())',
      [randomUUID(), org, owner],
    )
  })
  it('pins published assets, fences one native job and rejects revoked authority after approval', async () => {
    const value=enrollment();await request('',value)
    const consent={...grant(),scope:{directories:['src'],tools:['read_file','write_file'],maxToolCalls:2}}
    expect((await request(`/${value.registrationId}/grants`,consent,value.secret)).status).toBe(200)
    const assetId=randomUUID(),versionId=randomUUID(),definition={kind:'agent' as const,role:'工程师',instructions:'只在授权目录处理任务',runtime:'native' as const,skillVersionIds:[],toolIds:['read_file','write_file']}
    const checksum='sha256:'+createHash('sha256').update(canonicalAssetDefinition(definition)).digest('hex')
    await database.pool.query("INSERT INTO organization_assets(id,organization_id,name,kind,visibility,created_by,created_at) VALUES($1,$2,'组织工程师','agent','organization',$3,1)",[assetId,org,owner])
    await database.pool.query("INSERT INTO organization_asset_versions(id,organization_id,asset_id,version,definition,checksum,status,created_by,created_at,published_at) VALUES($1,$2,$3,'1.0.0',$4,$5,'published',$6,1,1)",[versionId,org,assetId,JSON.stringify(definition),checksum,owner])
    const call=async(path:string,body?:unknown,bearer=tokens.get(owner)!,method=body?'POST':'GET')=>{const r=await fetch(`${origin}/v1/organizations/${org}/worker-jobs${path}`,{method,headers:{authorization:`Bearer ${bearer}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json() as any}}
    const input={id:randomUUID(),grantId:consent.id,agentVersionId:versionId,prompt:'在 src 读取并更新代码'}
    expect((await call('',input)).status).toBe(403)
    await database.pool.query('INSERT INTO organization_asset_bindings(organization_id,project_id,asset_id,version_id,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,1)',[org,project,assetId,versionId,owner])
    expect((await call('',input)).status).toBe(200);expect((await call('',input)).status).toBe(200)
    const prefix=`/${input.id}/workers/${value.registrationId}`
    const claimed=await call(prefix+'/claim',{},value.secret);expect(claimed.status).toBe(200)
    expect((await call(prefix+'/claim',{},value.secret)).status).toBe(409)
    const proof={token:claimed.body.token,fencing:claimed.body.job.fencing}
    const saved=(await database.pool.query('SELECT * FROM organization_worker_jobs WHERE id=$1',[input.id])).rows[0]
    expect(saved.lease_hash).not.toBe(proof.token);expect(JSON.stringify(saved)).not.toContain(value.secret)
    expect((await call(prefix+'/check',{...proof,fencing:proof.fencing+1,tool:'write_file',consume:true},value.secret)).status).toBe(409)
    expect((await call(prefix+'/check',{...proof,tool:'run_command',consume:true},value.secret)).status).toBe(400)
    expect((await call(prefix+'/check',{...proof,tool:'write_file',consume:false},value.secret)).status).toBe(200)
    await request('/grants/'+consent.id,undefined,owner,'DELETE')
    expect((await call(prefix+'/check',{...proof,tool:'write_file',consume:true},value.secret)).status).toBe(403)
    expect((await call(prefix+'/finish',{...proof,status:'completed',runId:'run_native'},value.secret)).status).toBe(403)
    const listed=await call('');expect(JSON.stringify(listed.body)).not.toContain(proof.token)
    expect((await database.pool.query('SELECT tool_calls FROM organization_worker_jobs WHERE id=$1',[input.id])).rows[0].tool_calls).toBe(0)
  })
  it('ties device authority to a live login and records real audit facts', async () => {
    const value = enrollment()
    await request('', value)
    const tokenHash = createHash('sha256').update(tokens.get(owner)!).digest('base64url')
    await database.pool.query('UPDATE desktop_sessions SET revoked_at=$2 WHERE token_hash=$1', [
      tokenHash,
      Date.now(),
    ])
    expect((await request(`/${value.registrationId}/heartbeat`, {}, value.secret)).status).toBe(403)
    expect((await request(`/${value.registrationId}/grants`, grant(), value.secret)).status).toBe(403)
    const audit = (
      await database.pool.query(
        "SELECT operation FROM organization_audit_events WHERE organization_id=$1 AND operation LIKE 'worker.%'",
        [org],
      )
    ).rows
    expect(audit.length).toBeGreaterThan(10)
    expect(audit.some((r) => r.operation === 'worker.grant_revoked')).toBe(true)
  })
})
