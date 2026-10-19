import {
  ensureProjectRoot,
  getGitDiff,
  getGitStatus,
  initGitRepository,
  readTextFile,
  readWorkspaceTree,
  runApprovedCommand,
  runReadonlyCommand,
  writeTextFile,
} from '@projectos/workspace'
import type { WorkspacePort } from '@projectos/application'
import type { CommandResult } from '@projectos/contracts'

export interface WorkspaceAdapter extends WorkspacePort {
  runCommand(rootPath: string, command: string, timeoutMs?: number): Promise<CommandResult>
  readonlyReadonly(rootPath: string, command: string): Promise<CommandResult>
  getDiff(rootPath: string, path?: string): Promise<{ patch: string; truncated: boolean }>
}

export function createWorkspaceAdapter(): WorkspaceAdapter {
  return {
    ensureProjectRoot,
    readWorkspaceTree,
    writeTextFile,
    readTextFile,
    getGitStatus,
    initGitRepository,
    runCommand: runApprovedCommand,
    readonlyReadonly: runReadonlyCommand,
    getDiff: getGitDiff,
  }
}
