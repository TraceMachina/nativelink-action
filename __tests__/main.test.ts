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
    setFailed: jest.fn()
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
build --remote_timeout=600
build --remote_executor=grpcs://scheduler-demo-prefix.build-faster.nativelink.net`

const defaultBuckOutput = `[buck2_re_client]
engine_address = "scheduler-demo-prefix.build-faster.nativelink.net:443"
action_cache_address = "cas-demo-prefix.build-faster.nativelink.net:443"
cas_address = "cas-demo-prefix.build-faster.nativelink.net:443"
tls = true
http_headers = "x-nativelink-api-key:demo-key"`

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
build --remote_timeout=600
build --remote_executor=grpcs://scheduler-demo-prefix.uc1.scdev.nativelink.net`
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

  it('Writes bazel config with custom scheduler_url', async () => {
    writesBazelRc(
      { ...defaultInputs, scheduler_url: 'http://scheduler-url-foo' },
      defaultBazelOutput.replace(
        'grpcs://scheduler-demo-prefix.build-faster.nativelink.net',
        'http://scheduler-url-foo'
      )
    )
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
      'An unknown error occurred: \"Boom!\"'
    )
  })

  test.each(['bazel', 'buck2'])(
    '%s: goes boom on non-error',
    async (build_system) => {
      const oldFileSync = fs.readFileSync
      fs.readFileSync = () => {
        throw 'bad file'
      }
      const core = makeCore({ ...defaultInputs, build_system })
      await run(core)
      expect(core.setFailed).toHaveBeenCalledWith(
        'An unknown error occurred: \"bad file\"'
      )
      fs.readFileSync = oldFileSync
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
root = "."`
    )
    writesBuckConfig(
      {
        ...defaultInputs,
        build_system: 'buck2'
      },
      `${defaultBuckOutput}

[cells]
root = "."`
    )
  })
})
