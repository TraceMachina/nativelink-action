import { jest } from '@jest/globals'
import { fs, vol } from 'memfs'

jest.unstable_mockModule('fs', () => ({
  __esModule: true,
  default: fs
}))

jest.spyOn(console, 'log').mockImplementation(() => {})

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

const defaultOutput = `build --remote_cache=grpcs://cas-demo-prefix.build-faster.nativelink.net
build --remote_header=x-nativelink-api-key=demo-key
build --bes_backend=grpcs://bes-demo-prefix.build-faster.nativelink.net
build --bes_header=x-nativelink-api-key=demo-key
build --bes_results_url=https://app.nativelink.com/a/demo-account/build
build --remote_timeout=600
build --remote_executor=grpcs://scheduler-demo-prefix.build-faster.nativelink.net`

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
    await run(makeCore(inputs))
    const expected: Record<string, string> = {}
    expected[`${process.cwd()}/.bazelrc`] = output
    expect(vol.toJSON()).toEqual(expected)
  }

  it('Writes bazel config', async () => {
    writesBazelRc(defaultInputs, defaultOutput)
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
      defaultOutput.replace(
        'grpcs://cas-demo-prefix.build-faster.nativelink.net',
        'http://cache-url-foo'
      )
    )
  })

  it('Writes bazel config with custom bes', async () => {
    writesBazelRc(
      { ...defaultInputs, bes_url: 'http://bes-url-foo' },
      defaultOutput.replace(
        'grpcs://bes-demo-prefix.build-faster.nativelink.net',
        'http://bes-url-foo'
      )
    )
  })

  it('Writes bazel config with custom bes_results_url', async () => {
    writesBazelRc(
      { ...defaultInputs, bes_results_url: 'http://bes-results-url-foo' },
      defaultOutput.replace(
        'https://app.nativelink.com/a/demo-account/build',
        'http://bes-results-url-foo'
      )
    )
  })

  it('Writes bazel config with custom scheduler_url', async () => {
    writesBazelRc(
      { ...defaultInputs, scheduler_url: 'http://scheduler-url-foo' },
      defaultOutput.replace(
        'grpcs://scheduler-demo-prefix.build-faster.nativelink.net',
        'http://scheduler-url-foo'
      )
    )
  })

  it('Writes bazel config with custom remote timeout', async () => {
    writesBazelRc(
      { ...defaultInputs, remote_timeout: '100' },
      defaultOutput.replace('600', '100')
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
})
