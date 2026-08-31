import fs from 'node:fs'
import { parse, stringify } from 'ini'

type Environment = 'prod' | 'dev'

type CoreType = {
  getInput: (name: string, options?: { required: boolean }) => string
  setFailed: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
  /**
   * Mints an OIDC token asserting this job's identity. Present on @actions/core;
   * throws when the workflow has not granted `id-token: write`.
   */
  getIDToken: (audience?: string) => Promise<string>
}

type BuildTicket = {
  ticketId: string
  keyword: string
  repository: string
  account: string
}

/**
 * Trade this job's GitHub OIDC token for a NativeLink build ticket.
 *
 * A build cannot be trusted to say who ran it — a workflow author controls every
 * flag Bazel sends, and BUILD_USER on a runner is literally `runner`. So the job
 * asks GitHub for a token asserting its own identity, and NativeLink exchanges
 * that for an opaque ticket. Only the ticket travels with the build, and
 * resolving it later yields an identity GitHub attested to.
 *
 * Returns undefined rather than throwing on any failure: this runs inside the
 * customer's build, so a NativeLink outage or a repository nobody enabled must
 * cost the build its verified identity, never its result. The caller decides
 * whether to escalate.
 */
async function fetchBuildTicket(
  core: CoreType,
  url: string,
  audience: string
): Promise<BuildTicket | undefined> {
  let idToken: string
  try {
    idToken = await core.getIDToken(audience)
  } catch {
    // Almost always a missing workflow permission rather than anything on our
    // side, and the raw error does not say so.
    core.warning(
      'NativeLink build attribution skipped: this job has no OIDC token. ' +
        "Add 'permissions: { id-token: write }' to the workflow or job."
    )
    return undefined
  }

  // The token goes in the body, never a query string: it is a bearer credential
  // and query strings are recorded by every proxy and access log in between.
  const response = await fetch(
    `${url.replace(/\/+$/, '')}/v1/ci/token-exchange`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: idToken })
    }
  )

  if (!response.ok) {
    // Every refusal returns an identical 403 by design, so that a CI job cannot
    // probe which repositories other customers have connected.
    core.warning(
      `NativeLink build attribution skipped: the exchange returned ${response.status}. ` +
        'Check that this repository is enabled in NativeLink under Settings → Repositories.'
    )
    return undefined
  }

  const ticket = (await response.json()) as Partial<BuildTicket>
  if (
    ticket.ticketId === undefined ||
    ticket.ticketId === '' ||
    ticket.keyword === undefined ||
    ticket.keyword === ''
  ) {
    core.warning(
      'NativeLink build attribution skipped: the exchange returned no build ticket.'
    )
    return undefined
  }

  return ticket as BuildTicket
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

      // Build attribution, when configured. Appended to the same .bazelrc the
      // cache settings go in, so the customer does not have to thread a flag
      // through their own build command.
      const attributionUrl = core.getInput('attribution_url')
      if (attributionUrl !== '') {
        let audience = core.getInput('attribution_audience')
        if (audience === '') {
          audience = 'nativelink.com'
        }
        const ticket = await fetchBuildTicket(core, attributionUrl, audience)
        if (ticket !== undefined) {
          bazelConfig += `\nbuild --bes_keywords=${ticket.keyword}`
          // The ticket id is a six-hour bearer credential and Actions logs are
          // public on open-source repositories, so it is never printed. The
          // repository is safe and is what someone debugging wants to see.
          core.info(
            `NativeLink: this build will be attributed to ${ticket.repository}`
          )
        } else if (core.getInput('fail_on_attribution_error') === 'true') {
          throw new Error('NativeLink build attribution failed')
        }
      }

      if (existingBazelrc !== '') {
        bazelConfig = existingBazelrc + '\n' + bazelConfig
      }
      fs.writeFileSync('.bazelrc', bazelConfig)
    } else if (buildSystem == 'buck2') {
      if (core.getInput('attribution_url') !== '') {
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
