import { jest } from '@jest/globals'
import { fs, vol } from 'memfs'

jest.unstable_mockModule('fs', () => ({
  __esModule: true,
  default: fs
}))

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.ts')

describe('main.ts', () => {
  beforeEach(() => {
    vol.mkdirSync(process.cwd(), { recursive: true })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('Writes bazel config', async () => {
    const core = {
      getInput: (name: string, options?: { required: boolean }) => {
        switch (name) {
          case 'api_key':
            return 'demo-key'
          case 'account':
            return 'demo-account'
          case 'prefix':
            return 'demo-prefix'
          default:
            if (options?.required === true) {
              throw new Error(`Input ${name} is required but was not provided`)
            }
            return ''
        }
      },
      setFailed: (message: string) => {
        console.log(`Failed: ${message}`)
      }
    }

    await run(core)
    const expected: Record<string, string> = {}
    expected[`${process.cwd()}/.bazelrc`] =
      `build --remote_cache=grpcs://cas-demo-prefix.build-faster.nativelink.net
build --remote_header=x-nativelink-api-key=demo-key
build --bes_backend=grpcs://bes-demo-prefix.build-faster.nativelink.net
build --bes_header=x-nativelink-api-key=demo-key
build --bes_results_url=https://app.nativelink.com/a/demo-account/build
build --remote_timeout=600
build --remote_executor=grpcs://scheduler-demo-prefix.build-faster.nativelink.net`
    expect(vol.toJSON()).toEqual(expected)
  })

  // it('Sets a failed status', async () => {
  //   // Clear the getInput mock and return an invalid value.
  //   core.getInput.mockClear().mockReturnValueOnce('this is not a number')

  //   await run()

  //   // Verify that the action was marked as failed.
  //   expect(core.setFailed).toHaveBeenNthCalledWith(
  //     1,
  //     'milliseconds is not a number'
  //   )
  // })
})
