import { jest } from '@jest/globals'
import { fs, vol } from 'memfs'
import { fileURLToPath } from 'node:url'

jest.unstable_mockModule('node:fs', () => ({ default: fs }))
jest.unstable_mockModule('node:child_process', () => ({
  execFileSync: jest.fn(() => '/usr/bin/python3\n')
}))
const { installAttribution } = await import('../src/attribution.js')

const makeCore = (inputs: Record<string, string> = {}) => ({
  getInput: (key: string) =>
    ({ attribution_url: 'https://github-app.example', ...inputs })[key] || '',
  warning: jest.fn(),
  info: jest.fn(),
  setSecret: jest.fn(),
  addPath: jest.fn(),
  exportVariable: jest.fn(),
  setOutput: jest.fn(),
  saveState: jest.fn()
})

describe('attribution installation', () => {
  const originalEnv = { ...process.env }
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      RUNNER_TEMP: '/runner',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'private-request-token'
    }
    vol.reset()
    vol.mkdirSync('/runner', { recursive: true })
    vol.mkdirSync(process.cwd(), { recursive: true })
    const script = fileURLToPath(
      new URL('../scripts/bazel.py', import.meta.url)
    )
    vol.mkdirSync(fileURLToPath(new URL('../scripts/', import.meta.url)), {
      recursive: true
    })
    vol.writeFileSync(script, '# portable invocation wrapper')
    vol.writeFileSync(
      'user.bazelrc',
      'build --bes_backend=grpcs://bes.example\n'
    )
  })
  afterEach(() => {
    process.env = originalEnv
  })

  it('exports a portable wrapper and private config without putting a ticket in the bazelrc', () => {
    const core = makeCore({ attribution_audience: 'enterprise.example' })
    installAttribution(core, 'user.bazelrc')
    expect(core.warning).not.toHaveBeenCalled()
    const directory = core.saveState.mock.calls[0][1] as string
    const config = JSON.parse(
      vol.readFileSync(`${directory}/config.json`, 'utf8') as string
    )
    expect(config).toMatchObject({
      url: 'https://github-app.example',
      audience: 'enterprise.example',
      strict: false,
      oidcToken: 'private-request-token'
    })
    expect(fs.statSync(`${directory}/config.json`).mode & 0o777).toBe(0o600)
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700)
    expect(core.addPath).toHaveBeenCalledWith(`${directory}/bin`)
    expect(core.setSecret).toHaveBeenCalledWith('private-request-token')
    expect(core.setOutput).toHaveBeenCalledWith(
      'attribution-wrapper',
      `${directory}/bazel.py`
    )
    expect(vol.readFileSync('user.bazelrc', 'utf8')).not.toContain('nl_ticket:')
    expect(JSON.stringify(core.info.mock.calls)).not.toContain(
      'private-request-token'
    )
  })

  it('does nothing when attribution is not configured', () => {
    const core = makeCore({ attribution_url: '' })
    installAttribution(core, 'user.bazelrc')
    expect(core.addPath).not.toHaveBeenCalled()
    expect(core.saveState).not.toHaveBeenCalled()
  })

  it('does not create credentials or a wrapper for a cache-only fork', () => {
    vol.writeFileSync(
      'user.bazelrc',
      'build --remote_cache=grpcs://cas.example\n'
    )
    const core = makeCore()
    installAttribution(core, 'user.bazelrc')
    expect(core.addPath).not.toHaveBeenCalled()
    expect(core.saveState).not.toHaveBeenCalled()
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('explains a missing job permission without exposing credentials', () => {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL
    const core = makeCore()
    installAttribution(core, 'user.bazelrc')
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('id-token: write')
    )
    expect(JSON.stringify(core.warning.mock.calls)).not.toContain(
      'private-request-token'
    )
    expect(core.addPath).not.toHaveBeenCalled()
  })

  it.each([
    'http://app.example',
    'https://user:secret@app.example',
    'https://app.example/path',
    'https://app.example?token=secret',
    'https://app.example#fragment'
  ])('refuses an unsafe service URL: %s', (url) => {
    const core = makeCore({ attribution_url: url })
    installAttribution(core, 'user.bazelrc')
    expect(core.warning).toHaveBeenCalled()
    expect(core.saveState).not.toHaveBeenCalled()
    expect(JSON.stringify(core.warning.mock.calls)).not.toContain('secret')
  })

  it.each(['true', 'TRUE', 'yes', '1', 'on'])(
    'honors strict mode %s for setup failures',
    (strict) => {
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL
      expect(() =>
        installAttribution(
          makeCore({ fail_on_attribution_error: strict }),
          'user.bazelrc'
        )
      ).toThrow('NativeLink build attribution failed')
    }
  )
})
