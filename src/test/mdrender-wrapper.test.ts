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

  it('serves the current directory and opens the browser when given no argument', () => {
    execFileSync('bash', [WRAPPER], {
      cwd: work,
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH ?? ''}`,
        MDRENDER_FOREGROUND: '1',
      },
      encoding: 'utf8',
    })

    const log = recorded()
    expect(log).toContain(`ARGS=--port --open ${work}`)
    expect(log).toMatch(/SELF=.*md-render/)
  })

  it('serves the markdown file with the browser opening on it', () => {
    const doc = path.join(work, 'note.md')
    writeFileSync(doc, '# hello')

    runWrapper([doc])

    const log = recorded()
    expect(log).toContain(`ARGS=--port --open ${doc}`)
    // The window is not involved, so no launch file for it.
    expect(log).toContain('TAURI_LAUNCH_FILE=\n')
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
    expect(log).toContain(`ARGS=--port --open ${doc}`)
    expect(log).not.toContain('ARGS=--port --open relative.md')
  })

  it('opens the desktop app instead with --app, passing the file as argv and env var', () => {
    const doc = path.join(work, 'note.md')
    writeFileSync(doc, '# hello')

    runWrapper(['--app', doc])

    const log = recorded()
    expect(log).toContain(`ARGS=${doc}\n`)
    expect(log).toContain(`TAURI_LAUNCH_FILE=${doc}`)
    expect(log).not.toContain('--app')
  })

  it('opens the empty desktop app with --app and no file', () => {
    runWrapper(['--app'])

    const log = recorded()
    expect(log).toContain('ARGS=\n')
    expect(log).toContain('TAURI_LAUNCH_FILE=\n')
  })

  it('honours MDRENDER_BIN over the binary on PATH', () => {
    const elsewhere = path.join(work, 'elsewhere')
    mkdirSync(elsewhere)
    const custom = path.join(elsewhere, 'md-render')
    writeFileSync(custom, recordingStub())
    chmodSync(custom, 0o755)

    const doc = path.join(work, 'x.md')
    writeFileSync(doc, '# x')

    runWrapper(['--port', '8080', doc], { MDRENDER_BIN: custom })

    expect(recorded()).toContain(`SELF=${custom}`)
  })

  it('passes --warm-tikz straight to the binary, without serving', () => {
    const custom = path.join(work, 'md-render-warm')
    writeFileSync(custom, recordingStub())
    chmodSync(custom, 0o755)

    runWrapper(['--warm-tikz'], { MDRENDER_BIN: custom })

    expect(recorded()).toContain('ARGS=--warm-tikz\n')
    expect(recorded()).not.toContain('--port')
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

  it('serves the file through the app bundle binary and opens the browser', () => {
    // The bundle's executable lives at a fixed path under /Applications;
    // MDRENDER_BIN stands in for it here.
    const bin = writeStub('md-render', recordingStub())
    const doc = path.join(work, 'note.md')
    writeFileSync(doc, '# hello')

    runWrapper([doc], { MDRENDER_BIN: bin })

    const log = recorded()
    expect(log).toContain(`ARGS=--port --open ${doc}`)
    expect(log).toContain(`SELF=${bin}`)
    // `open -a` was not used: the browser is the binary's job.
    expect(log).not.toContain('-a MD_RENDER')
  })

  it('opens the app by name with --app and no file', () => {
    runWrapper(['--app'])

    const log = recorded()
    expect(log).toContain('ARGS=-a MD_RENDER')
    expect(log).toContain('TAURI_LAUNCH_FILE=')
  })

  it('passes the file as an open --args argument and keeps the env var with --app', () => {
    const doc = path.join(work, 'note.md')
    writeFileSync(doc, '# hello')

    runWrapper(['--app', doc])

    const log = recorded()
    expect(log).toContain(`ARGS=-a MD_RENDER --args ${doc}`)
    expect(log).toContain(`TAURI_LAUNCH_FILE=${doc}`)
  })

  it('passes several files through with --app so they open as tabs', () => {
    const a = path.join(work, 'a.md')
    const b = path.join(work, 'b.md')
    writeFileSync(a, '# a')
    writeFileSync(b, '# b')

    runWrapper([a, '--app', b])

    const log = recorded()
    expect(log).toContain(`ARGS=-a MD_RENDER --args ${a} ${b}`)
    expect(log).toContain(`TAURI_LAUNCH_FILE=${a}`)
  })
})

describe('bin/mdrender default mode in the background', () => {
  beforeEach(() => {
    stubUname('Linux')
  })

  // Without MDRENDER_FOREGROUND the wrapper detaches the server and returns
  // once its banner is out. The stub plays the server: banner, then it lingers.
  const runDetached = (args: string[]) =>
    execFileSync('bash', [WRAPPER, ...args], {
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ''}`, MDRENDER_FOREGROUND: '' },
      encoding: 'utf8',
      timeout: 15_000,
    })

  it('echoes the banner, drops the ctrl-c hint, and returns while the server runs on', () => {
    writeStub(
      'md-render',
      `#!/usr/bin/env bash
echo "serving 1 file on http://127.0.0.1:9999"
echo "  http://127.0.0.1:9999/notes/"
echo "    a.md"
echo "opening http://127.0.0.1:9999/notes/?doc=1 in the browser"
echo "(ctrl-c to stop)"
sleep 4
`,
    )
    const doc = path.join(work, 'a.md')
    writeFileSync(doc, '# a')

    const started = Date.now()
    const output = runDetached([doc])

    expect(Date.now() - started).toBeLessThan(3_000)
    expect(output).toContain('serving 1 file on http://127.0.0.1:9999')
    expect(output).toContain('opening http://127.0.0.1:9999/notes/?doc=1')
    expect(output).not.toContain('ctrl-c')
    expect(output).toMatch(/running in the background, pid \d+/)
  })

  it('just relays the output when the binary joined a running server and exited', () => {
    writeStub(
      'md-render',
      `#!/usr/bin/env bash
echo "added to http://127.0.0.1:9999"
echo "  b.md"
echo "opening http://127.0.0.1:9999/notes/?doc=2 in the browser"
`,
    )
    const doc = path.join(work, 'b.md')
    writeFileSync(doc, '# b')

    const output = runDetached([doc])

    expect(output).toContain('added to http://127.0.0.1:9999')
    expect(output).toContain('opening http://127.0.0.1:9999/notes/?doc=2')
    expect(output).not.toContain('background')
  })

  it('fails with the binary\'s message and status when it could not serve', () => {
    writeStub(
      'md-render',
      `#!/usr/bin/env bash
echo "md-render: port 9999 is in use by another program" >&2
exit 1
`,
    )
    const doc = path.join(work, 'c.md')
    writeFileSync(doc, '# c')

    let status = 0
    let output = ''
    try {
      runDetached([doc])
    } catch (error) {
      const failure = error as { status?: number; stdout?: string }
      status = failure.status ?? 0
      output = String(failure.stdout ?? '')
    }

    expect(status).toBe(1)
    expect(output).toContain('port 9999 is in use')
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

  it('treats a path after --port as a document, not as the port value', () => {
    const doc = path.join(work, 'note.md')
    writeFileSync(doc, '# hello')

    execFileSync('bash', [WRAPPER, '--port', 'note.md'], {
      cwd: work,
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ''}` },
      encoding: 'utf8',
    })

    // The port value is optional, so the path must still be absolutised and
    // handed over as a document.
    expect(recorded()).toContain(`ARGS=--port ${doc}`)
  })

  it('passes a URL through untouched and does not treat it as the launch file', () => {
    const doc = path.join(work, 'local.md')
    writeFileSync(doc, '# local')

    runWrapper(['https://github.com/anthropics/skills/blob/main/README.md', doc])

    const log = recorded()
    // Not absolutised against the working directory.
    expect(log).toContain(
      'ARGS=--port --open https://github.com/anthropics/skills/blob/main/README.md ' + doc,
    )
    expect(log).not.toContain('/https:')
  })

  it('with --app, the launch file is the first local path, not the URL', () => {
    const doc = path.join(work, 'local.md')
    writeFileSync(doc, '# local')

    runWrapper(['--app', 'https://github.com/anthropics/skills/blob/main/README.md', doc])

    const log = recorded()
    expect(log).toContain('ARGS=https://github.com/anthropics/skills/blob/main/README.md ' + doc)
    expect(log).toContain(`TAURI_LAUNCH_FILE=${doc}`)
  })

  it('passes a URL through in server mode too', () => {
    runWrapper(['--port', '8080', 'http://127.0.0.1:9000/notes.md'])

    expect(recorded()).toContain('ARGS=--port 8080 http://127.0.0.1:9000/notes.md')
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

describe('bin/mdrender --help', () => {
  beforeEach(() => {
    stubUname('Linux')
    writeStub('md-render', recordingStub())
  })

  it('prints a short usage and exits without launching anything', () => {
    const output = runWrapper(['-h'])

    expect(output).toContain('mdrender')
    expect(output).toContain('--port')
    expect(output).toContain('--app')
    expect(output).toContain('9999')
    // Neither the app nor the server was started.
    expect(recorded()).toBe('')
  })

  it('honours --help even after other arguments', () => {
    const doc = path.join(work, 'note.md')
    writeFileSync(doc, '# hello')

    const output = runWrapper([doc, '--help'])

    expect(output).toContain('mdrender')
    expect(recorded()).toBe('')
  })
})

describe('bin/mdrender --mcp', () => {
  beforeEach(() => {
    stubUname('Linux')
    writeStub('md-render', recordingStub())
    writeStub('node', recordingStub())
  })

  it('execs node on the bundle named by MDRENDER_MCP_DIR and passes arguments through', () => {
    const mcpDir = path.join(work, 'mcp-install')
    mkdirSync(mcpDir)
    const bundle = path.join(mcpDir, 'index.js')
    writeFileSync(bundle, '// bundle')

    runWrapper(['--mcp', '--extra', 'flag'], { MDRENDER_MCP_DIR: mcpDir })

    const log = recorded()
    expect(log).toContain(`ARGS=${bundle} --extra flag`)
    expect(log).toContain(`SELF=${path.join(stubBin, 'node')}`)
    // The app itself was not launched.
    expect(log).not.toContain('md-render')
  })

  it('falls back to the bundle installed under the home directory', () => {
    const home = path.join(work, 'home')
    const installed = path.join(home, '.local', 'share', 'md-render', 'mcp')
    mkdirSync(installed, { recursive: true })
    writeFileSync(path.join(installed, 'index.js'), '// bundle')

    runWrapper(['--mcp'], { HOME: home })

    expect(recorded()).toContain(`ARGS=${path.join(installed, 'index.js')}`)
  })

  it('fails helpfully when no bundle exists', () => {
    // A copy outside the repo so the checkout build cannot be found, and a
    // home directory with nothing installed.
    const isolated = path.join(work, 'isolated')
    mkdirSync(isolated)
    const wrapperCopy = path.join(isolated, 'mdrender')
    writeFileSync(wrapperCopy, readFileSync(WRAPPER, 'utf8'))
    chmodSync(wrapperCopy, 0o755)

    let stderr = ''
    let threw = false
    try {
      execFileSync('bash', [wrapperCopy, '--mcp'], {
        env: { PATH: `${stubBin}:/usr/bin:/bin`, HOME: work },
        encoding: 'utf8',
      })
    } catch (error) {
      threw = true
      stderr = String((error as { stderr?: Buffer | string }).stderr ?? '')
    }

    expect(threw).toBe(true)
    expect(stderr).toContain('not built')
    expect(recorded()).toBe('')
  })

  it('fails helpfully when node is missing', () => {
    rmSync(path.join(stubBin, 'node'))
    const mcpDir = path.join(work, 'mcp-install')
    mkdirSync(mcpDir)
    writeFileSync(path.join(mcpDir, 'index.js'), '// bundle')

    let stderr = ''
    let threw = false
    try {
      execFileSync('bash', [WRAPPER, '--mcp'], {
        env: { PATH: `${stubBin}:/usr/bin:/bin`, HOME: work, MDRENDER_MCP_DIR: mcpDir },
        encoding: 'utf8',
      })
    } catch (error) {
      threw = true
      stderr = String((error as { stderr?: Buffer | string }).stderr ?? '')
    }

    expect(threw).toBe(true)
    expect(stderr).toContain('needs node')
  })

  it('mentions --mcp in the usage text', () => {
    expect(runWrapper(['-h'])).toContain('--mcp')
  })
})

describe('bin/mdrender on an unsupported platform', () => {
  it('exits with an error', () => {
    stubUname('SunOS')

    expect(() => runWrapper([])).toThrow()
  })
})
