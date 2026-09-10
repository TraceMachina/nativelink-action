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

import fs from 'node:fs'
import { parse, stringify } from 'ini'
import { installAttribution, type AttributionCore } from './attribution.js'

type Environment = 'prod' | 'dev'

type CoreType = AttributionCore & {
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
    const environment = raw_environment as Environment

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

    // No default. Remote execution is opt-in, and the scheduler address is not
    // derivable from the account prefix — it differs between deployments, and a
    // guessed hostname fails at build time rather than here. Users take it from
    // their NativeLink application; unset simply means "cache only".
    const schedulerUrl = core.getInput('scheduler_url').trim()

    let remoteTimeout = core.getInput('remote_timeout')
    if (remoteTimeout === '') {
      remoteTimeout = '600'
    }

    // Read once and share: the bazel and buck2 branches both need to know
    // whether attribution was asked for, and reading the input separately in
    // each invites them to disagree about it.
    const attributionUrl = core.getInput('attribution_url').trim()

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
build --remote_timeout=${remoteTimeout}`

      // Only when the user supplied one: an empty --remote_executor is not
      // "no remote execution", it is a Bazel error.
      if (schedulerUrl !== '') {
        bazelConfig += `\nbuild --remote_executor=${schedulerUrl}`
      }

      if (existingBazelrc !== '') {
        bazelConfig = existingBazelrc + '\n' + bazelConfig
      }
      fs.writeFileSync('.bazelrc', bazelConfig)
      installAttribution(core, '.bazelrc')
    } else if (buildSystem == 'buck2') {
      if (attributionUrl !== '') {
        // --bes_keywords is a Bazel concept. Buck2 has no equivalent channel to
        // carry the ticket, so attribution cannot work there yet.
        core.warning(
          'NativeLink build attribution is not supported for buck2 and was ignored.'
        )
      }
      let existingBuck2config: string = ''
      try {
        existingBuck2config = fs.readFileSync('.buckconfig', 'utf-8')
      } catch (error) {
        // Ignore error if file does not exist
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }

      // engine_address only when a scheduler was supplied; the cache addresses
      // stand on their own, so a cache-only buck2 setup stays valid.
      let buckconfig: Record<string, Record<string, unknown>> = {
        buck2_re_client: {
          ...(schedulerUrl !== ''
            ? { engine_address: schedulerUrl.replace('grpcs://', '') + ':443' }
            : {}),
          action_cache_address: cacheUrl.replace('grpcs://', '') + ':443',
          cas_address: cacheUrl.replace('grpcs://', '') + ':443',
          tls: true,
          http_headers: `x-nativelink-api-key:${apiKey}`
        }
      }
      if (existingBuck2config !== '') {
        const existingconfig = parse(existingBuck2config)
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
