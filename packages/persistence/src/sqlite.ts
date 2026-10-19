import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'

/**
 * esbuild rewrites static `node:sqlite` imports to `sqlite` for some targets.
 * Loading through a runtime-computed specifier keeps the built-in name intact.
 */
const require = createRequire(import.meta.url)
const sqliteSpecifier = 'node:sqlite'
const sqliteModule = require(sqliteSpecifier) as typeof import('node:sqlite')
export const DatabaseSync = sqliteModule.DatabaseSync
export type DatabaseSync = DatabaseSyncType
