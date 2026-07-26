import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// These tests execute bin/mdrender for real. The platform is steered by putting a
// stub `uname` first on PATH, and the launcher it should invoke (`open` on macOS,
// `md-render` on Linux) is a stub that records how it was called.
const WRAPPER = path.resolve(__dirname, '../../bin/mdrender')

let work: string
let stubBin: string
let recordFile: string

const writeStub = (name: string, body: string) => {
  const file = path.join(stubBin, name)
  writeFileSync(file, body)
  chmodSync(file, 0o755)
  return file
}

// Records argv and the launch-related env vars, one line per invocation.
const recordingStub = () => `#!/usr/bin/env bash
{
  echo "ARGS=$*"
  echo "TAURI_LAUNCH_FILE=\${TAURI_LAUNCH_FILE:-}"
  echo "SELF=$0"
} >> "${recordFile}"
`

const stubUname = (kernel: string) => {
  writeStub('uname', `#!/usr/bin/env bash\necho "${kernel}"\n`)
}

const runWrapper = (args: string[], env: Record<string, string> = {}) =>
  execFileSync('bash', [WRAPPER, ...args], {
    env: {
      ...process.env,
      PATH: `${stubBin}:${process.env.PATH ?? ''}`,
      MDRENDER_FOREGROUND: '1',
      ...env,
    },
    encoding: 'utf8',
  })

const recorded = () => (existsSync(recordFile) ? readFileSync(recordFile, 'utf8') : '')

beforeEach(() => {
  // realpath so expectations match what the wrapper resolves; on macOS /var is a
  // symlink to /private/var.
  work = realpathSync(mkdtempSync(path.join(tmpdir(), 'mdrender-wrapper-')))
  stubBin = path.join(work, 'stub-bin')
  mkdirSync(stubBin)
  recordFile = path.join(work, 'calls.log')
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('bin/mdrender on Linux', () => {
  beforeEach(() => {
    stubUname('Linux')
    writeStub('md-render', recordingStub())
  })

  it('launches the md-render binary with no file when given no argument', () => {
    runWrapper([])

    const log = recorded()
    expect(log).toContain('ARGS=')
    expect(log).toContain('TAURI_LAUNCH_FILE=')
    expect(log).toMatch(/SELF=.*md-render/)
  })

  it('passes the markdown file to the binary as both argv and env var', () => {
    const doc = path.join(work, 'note.md')
    writeFileSync(doc, '# hello')

    runWrapper([doc])

    const log = recorded()
    expect(log).toContain(`ARGS=${doc}`)
    expect(log).toContain(`TAURI_LAUNCH_FILE=${doc}`)
  })

  it('resolves a relative path to an absolute one', () => {
    const doc = path.join(work, 'relative.md')
    writeFileSync(doc, '# hello')

    execFileSync('bash', [WRAPPER, 'relative.md'], {
      cwd: work,
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH ?? ''}`,
        MDRENDER_FOREGROUND: '1',
      },
      encoding: 'utf8',
    })

    const log = recorded()
    // The stub must receive an absolute path, not "relative.md".
    expect(log).toContain('ARGS=/')
    expect(log).toContain(`TAURI_LAUNCH_FILE=${doc}`)
    expect(log).not.toContain('ARGS=relative.md')
  })

  it('fails with a helpful message when the binary is not installed', () => {
    rmSync(path.join(stubBin, 'md-render'))
    // Run a copy outside the repo so the checkout-build fallback cannot resolve,
    // and use a PATH without the developer's own installed binaries.
    const isolated = path.join(work, 'isolated')
    mkdirSync(isolated)
    const wrapperCopy = path.join(isolated, 'mdrender')
    writeFileSync(wrapperCopy, readFileSync(WRAPPER, 'utf8'))
    chmodSync(wrapperCopy, 0o755)

    let stderr = ''
    let threw = false
    try {
      execFileSync('bash', [wrapperCopy], {
        env: { PATH: `${stubBin}:/usr/bin:/bin`, HOME: work },
        encoding: 'utf8',
      })
    } catch (error) {
      threw = true
      stderr = String((error as { stderr?: Buffer | string }).stderr ?? '')
    }

    expect(threw).toBe(true)
    expect(stderr).toContain('not installed')
  })

  it('does not invoke itself when the wrapper is on PATH as mdrender', () => {
    // Simulate the installed layout: wrapper at ~/bin/mdrender, earlier on PATH
    // than the real binary. The wrapper must skip itself and not recurse.
    rmSync(path.join(stubBin, 'md-render'))
    const wrapperDir = path.join(work, 'user-bin')
    mkdirSync(wrapperDir)
    const installedWrapper = path.join(wrapperDir, 'mdrender')
    writeFileSync(installedWrapper, readFileSync(WRAPPER, 'utf8'))
    chmodSync(installedWrapper, 0o755)

    const realBinDir = path.join(work, 'real-bin')
    mkdirSync(realBinDir)
    const realBin = path.join(realBinDir, 'md-render')
    writeFileSync(realBin, recordingStub())
    chmodSync(realBin, 0o755)

    execFileSync('bash', [installedWrapper], {
      env: {
        ...process.env,
        PATH: `${stubBin}:${wrapperDir}:${realBinDir}:${process.env.PATH ?? ''}`,
        MDRENDER_FOREGROUND: '1',
      },
      encoding: 'utf8',
      timeout: 10_000,
    })

    expect(recorded()).toMatch(/SELF=.*real-bin\/md-render/)
  })
})

describe('bin/mdrender on macOS', () => {
  beforeEach(() => {
    stubUname('Darwin')
    writeStub('open', recordingStub())
  })

  it('opens the app by name when given no argument', () => {
    runWrapper([])

    const log = recorded()
    expect(log).toContain('ARGS=-a MD_RENDER')
    expect(log).toContain('TAURI_LAUNCH_FILE=')
  })

  it('passes the file through TAURI_LAUNCH_FILE, not as an open argument', () => {
    const doc = path.join(work, 'note.md')
    writeFileSync(doc, '# hello')

    runWrapper([doc])

    const log = recorded()
    expect(log).toContain('ARGS=-a MD_RENDER')
    expect(log).toContain(`TAURI_LAUNCH_FILE=${doc}`)
  })
})

describe('bin/mdrender argument handling for server mode', () => {
  beforeEach(() => {
    stubUname('Linux')
    writeStub('md-render', recordingStub())
  })

  it('passes --port through untouched and absolutises the file', () => {
    const doc = path.join(work, 'note.md')
    writeFileSync(doc, '# hello')

    execFileSync('bash', [WRAPPER, '--port', '8080', 'note.md'], {
      cwd: work,
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ''}` },
      encoding: 'utf8',
    })

    const log = recorded()
    // The flag must survive verbatim; only the path is rewritten.
    expect(log).toContain(`ARGS=--port 8080 ${doc}`)
  })

  it('does not mistake a port number for a file path', () => {
    const doc = path.join(work, 'note.md')
    writeFileSync(doc, '# hello')

    execFileSync('bash', [WRAPPER, '--port', '8080', doc], {
      cwd: work,
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ''}` },
      encoding: 'utf8',
    })

    const log = recorded()
    // "8080" must not be absolutised into <cwd>/8080.
    expect(log).not.toContain(`${work}/8080`)
    expect(log).toContain('ARGS=--port 8080 ')
  })

  it('passes --host and multiple paths through', () => {
    const a = path.join(work, 'a.md')
    const b = path.join(work, 'b.md')
    writeFileSync(a, '# a')
    writeFileSync(b, '# b')

    execFileSync('bash', [WRAPPER, '--host', '127.0.0.1', '--port', '9000', a, b], {
      cwd: work,
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ''}` },
      encoding: 'utf8',
    })

    const log = recorded()
    expect(log).toContain(`ARGS=--host 127.0.0.1 --port 9000 ${a} ${b}`)
  })

  it('supports the --port=N form', () => {
    const doc = path.join(work, 'note.md')
    writeFileSync(doc, '# hello')

    execFileSync('bash', [WRAPPER, '--port=8081', doc], {
      cwd: work,
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ''}` },
      encoding: 'utf8',
    })

    expect(recorded()).toContain(`ARGS=--port=8081 ${doc}`)
  })
})

describe('bin/mdrender on an unsupported platform', () => {
  it('exits with an error', () => {
    stubUname('SunOS')

    expect(() => runWrapper([])).toThrow()
  })
})
