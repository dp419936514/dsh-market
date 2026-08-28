/**
 * Persistent log sink: every market event survives the process, capped and
 * sanitized, and the export carries prior sessions alongside this one.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { configurePersistentLog, exportLogs, logEvent, readPersistentLog } from '../src/log.ts'

let home: string
let logFile: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dshm-log-'))
  logFile = join(home, '.dsh-market', 'log.ndjson')
})
afterEach(() => {
  configurePersistentLog(null)
  rmSync(home, { recursive: true, force: true })
})

describe('persistent log sink', () => {
  it('appends sanitized events as ndjson and reads the tail back', () => {
    configurePersistentLog(logFile)
    logEvent('warn', 'install', `failed under ${join(homedir(), '.dsh', 'profiles', 'web')} with token sk-abcdefgh12345678`)
    const lines = readPersistentLog(logFile)
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]!) as { detail: string }
    expect(entry.detail).toContain('~/.dsh/profiles/web')
    expect(entry.detail).not.toContain('sk-abcdefgh12345678')
  })

  it('trims an oversized file to its newest half on configure', () => {
    mkdirSync(join(home, '.dsh-market'), { recursive: true })
    writeFileSync(logFile, `${'x'.repeat(64)}\n`.repeat(6000))
    configurePersistentLog(logFile)
    const trimmed = readFileSync(logFile, 'utf8')
    expect(trimmed.length).toBeLessThanOrEqual(128 * 1024 + 128)
    expect(trimmed.endsWith('x\n')).toBe(true)
  })

  it('keeps exportLogs readable with and without prior sessions', () => {
    configurePersistentLog(logFile)
    logEvent('error', 'install', 'remove failed (exit 1) but the package is gone')
    configurePersistentLog(null)
    logEvent('info', 'uninstall', 'a fresh process event')
    const exported = exportLogs({ 'dsh-market': 'test' }, ['bundles (1):', '  plug-a: NOT RESOLVED'], readPersistentLog(logFile))
    expect(exported).toContain('## previous sessions (persisted log)')
    expect(exported).toContain('remove failed (exit 1)')
    expect(exported).toContain('## events this session')
    expect(exported).toContain('a fresh process event')
    expect(exportLogs({}, [], readPersistentLog(join(home, 'absent.ndjson')))).not.toContain('previous sessions')
  })
})
