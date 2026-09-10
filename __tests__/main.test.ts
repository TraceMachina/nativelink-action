// Copyright 2025 The NativeLink Authors. All rights reserved.
//
// Licensed under the Business Source License 1.1 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    See the LICENSE file for the full terms and parameters
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { jest } from '@jest/globals'
import { fs, vol } from 'memfs'

jest.unstable_mockModule('node:fs', () => ({
  __esModule: true,
  default: fs
}))

const installAttribution = jest.fn()
jest.unstable_mockModule('../src/attribution.js', () => ({
  installAttribution
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
    setSecret: jest.fn(),
    addPath: jest.fn(),
    exportVariable: jest.fn(),
    setOutput: jest.fn(),
    saveState: jest.fn()
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

describe('per-invocation attribution setup', () => {
  beforeEach(() => {
    vol.reset()
    vol.mkdirSync(process.cwd(), { recursive: true })
    jest.clearAllMocks()
  })

  it('installs the invocation wrapper after writing the BES config, without a setup ticket', async () => {
    const core = makeCore({
      ...defaultInputs,
      attribution_url: 'https://github-app.example'
    })
    await run(core)
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(installAttribution).toHaveBeenCalledWith(core, '.bazelrc')
    expect(vol.readFileSync('.bazelrc', 'utf8')).toBe(defaultBazelOutput)
    expect(core.getIDToken).not.toHaveBeenCalled()
  })

  it('keeps buck2 unchanged and explains the unsupported attribution channel', async () => {
    const core = makeCore({
      ...defaultInputs,
      build_system: 'buck2',
      attribution_url: 'https://github-app.example'
    })
    await run(core)
    expect(installAttribution).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('buck2'))
  })
})
