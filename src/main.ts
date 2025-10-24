import fs from 'node:fs'
import { parse, stringify } from 'ini'

type Environment = 'prod' | 'dev'

type CoreType = {
  getInput: (name: string, options?: { required: boolean }) => string
  setFailed: (message: string) => void
}

export async function run(core: CoreType): Promise<void> {
  try {
    const apiKey = core.getInput('api_key', { required: true })
    const account = core.getInput('account', { required: true })
    const prefix = core.getInput('prefix', { required: true })
    let raw_environment = core.getInput('environment')
    if (raw_environment === '') {
      raw_environment = 'prod'
    }
    if (raw_environment !== 'prod' && raw_environment !== 'dev') {
      throw new Error(`Invalid environment: ${raw_environment}`)
    }
    let environment = raw_environment as Environment

    let cacheUrl = core.getInput('cache_url')
    if (cacheUrl === '') {
      if (environment === 'prod') {
        cacheUrl = `grpcs://cas-${prefix}.build-faster.nativelink.net`
      } else {
        cacheUrl = `grpcs://cas-${prefix}.uc1.scdev.nativelink.net`
      }
    }

    let besUrl = core.getInput('bes_url')
    if (besUrl === '') {
      if (environment === 'prod') {
        besUrl = `grpcs://bes-${prefix}.build-faster.nativelink.net`
      } else {
        besUrl = `grpcs://bes-${prefix}.uc1.scdev.nativelink.net`
      }
    }

    let besResultsUrl = core.getInput('bes_results_url')
    if (besResultsUrl === '') {
      if (environment === 'prod') {
        besResultsUrl = `https://app.nativelink.com/a/${account}/build`
      } else {
        besResultsUrl = `https://web-dev.uc1.scdev.nativelink.net/a/${account}/build`
      }
    }

    let schedulerUrl = core.getInput('scheduler_url')
    if (schedulerUrl === '') {
      if (environment === 'prod') {
        schedulerUrl = `grpcs://scheduler-${prefix}.build-faster.nativelink.net`
      } else {
        schedulerUrl = `grpcs://scheduler-${prefix}.uc1.scdev.nativelink.net`
      }
    }

    let remoteTimeout = core.getInput('remote_timeout')
    if (remoteTimeout === '') {
      remoteTimeout = '600'
    }

    let buildSystem = core.getInput('build_system')
    if (buildSystem === '') {
      buildSystem = 'bazel'
    }
    if (buildSystem == 'bazel') {
      let existingBazelrc: string = ''
      try {
        existingBazelrc = fs.readFileSync('.bazelrc', 'utf-8')
      } catch (error) {
        // Ignore error if file does not exist
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }

      let bazelConfig = `build --remote_cache=${cacheUrl}
build --remote_header=x-nativelink-api-key=${apiKey}
build --bes_backend=${besUrl}
build --bes_header=x-nativelink-api-key=${apiKey}
build --bes_results_url=${besResultsUrl}
build --remote_timeout=${remoteTimeout}
build --remote_executor=${schedulerUrl}`

      if (existingBazelrc !== '') {
        bazelConfig = existingBazelrc + '\n' + bazelConfig
      }
      fs.writeFileSync('.bazelrc', bazelConfig)
    } else if (buildSystem == 'buck2') {
      let existingBuck2config: string = ''
      try {
        existingBuck2config = fs.readFileSync('.buckconfig', 'utf-8')
      } catch (error) {
        // Ignore error if file does not exist
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }

      let buckconfig = {
        buck2_re_client: {
          engine_address: schedulerUrl.replace('grpcs://', '') + ':443',
          action_cache_address: cacheUrl.replace('grpcs://', '') + ':443',
          cas_address: cacheUrl.replace('grpcs://', '') + ':443',
          tls: true,
          http_headers: `x-nativelink-api-key:${apiKey}`
        }
      }
      if (existingBuck2config !== '') {
        let existingconfig = parse(existingBuck2config)
        buckconfig = {
          ...buckconfig,
          ...existingconfig
        }
      }
      fs.writeFileSync(
        '.buckconfig',
        stringify(buckconfig, { whitespace: true })
      )
    } else {
      throw new Error(`Unknown build system: ${buildSystem}`)
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unknown error occurred: ' + JSON.stringify(error))
    }
  }
}
