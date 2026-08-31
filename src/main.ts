import fs from 'node:fs'
import { parse, stringify } from 'ini'

type Environment = 'prod' | 'dev'

type CoreType = {
  getInput: (name: string, options?: { required: boolean }) => string
  setFailed: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
  /** Masks a value in every subsequent log line for the whole job. */
  setSecret: (secret: string) => void
  /**
   * Mints an OIDC token asserting this job's identity. Present on @actions/core;
   * throws when the workflow has not granted `id-token: write`.
   */
  getIDToken: (audience?: string) => Promise<string>
}

/**
 * Actions inputs are strings, so a boolean is whatever the user typed. `true`,
 * `TRUE`, `yes` and `1` all plainly mean yes, and silently treating them as no
 * would quietly disable a safety flag someone believed they had set.
 */
function booleanInput(core: CoreType, name: string): boolean {
  const raw = core.getInput(name).trim().toLowerCase()
  return raw === 'true' || raw === 'yes' || raw === '1' || raw === 'on'
}

/**
 * The keyword is written verbatim into .bazelrc, so its shape is a security
 * boundary, not a formatting detail. A value containing a newline injects
 * arbitrary bazelrc lines that land AFTER everything else — and Bazel is
 * last-flag-wins, so an injected `--remote_cache` would redirect the build
 * while our API-key header lines still applied. `null` would write a literal
 * `--bes_keywords=null`.
 */
const KEYWORD_SHAPE = /^[A-Za-z0-9_:.-]+$/

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
  //
  // Wrapped, because everything from here on can throw: fetch rejects on DNS
  // failure, connection refused and timeouts, and response.json() throws on a
  // non-JSON body. Letting any of those escape would reach the outer catch and
  // fail the customer's build over a NativeLink problem — exactly what this
  // function exists to prevent.
  let ticket: Partial<BuildTicket>
  try {
    const response = await fetch(
      `${url.replace(/\/+$/, '')}/v1/ci/token-exchange`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: idToken })
      }
    )

    if (!response.ok) {
      // Every refusal returns an identical 403 by design, so that a CI job
      // cannot probe which repositories other customers have connected.
      core.warning(
        `NativeLink build attribution skipped: the exchange returned ${response.status}. ` +
          'Check that this repository is enabled in NativeLink under Settings → Repositories.'
      )
      return undefined
    }

    ticket = (await response.json()) as Partial<BuildTicket>
  } catch (error) {
    core.warning(
      `NativeLink build attribution skipped: the exchange could not be completed (${String(error)}).`
    )
    return undefined
  }

  // Shape-check both fields rather than testing for undefined/''. This response
  // decides what gets written into the customer's .bazelrc, so `null`, a
  // number, or a value containing a newline all have to be refused here.
  if (
    typeof ticket.ticketId !== 'string' ||
    !KEYWORD_SHAPE.test(ticket.ticketId) ||
    typeof ticket.keyword !== 'string' ||
    !KEYWORD_SHAPE.test(ticket.keyword)
  ) {
    core.warning(
      'NativeLink build attribution skipped: the exchange returned no usable build ticket.'
    )
    return undefined
  }

  // Mask it for the rest of the job. The ticket is a six-hour bearer
  // credential and it is about to be written into .bazelrc, where
  // `--announce_rc`, `bazel build -s` or a plain `cat .bazelrc` would echo it
  // into a log that is public on any open-source repository. Not printing it
  // ourselves only covers our own lines; this covers everyone's.
  core.setSecret(ticket.ticketId)

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

      // Build attribution, when configured. Appended to the same .bazelrc the
      // cache settings go in, so the customer does not have to thread a flag
      // through their own build command.
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
        } else if (booleanInput(core, 'fail_on_attribution_error')) {
          throw new Error('NativeLink build attribution failed')
        }
      }

      if (existingBazelrc !== '') {
        bazelConfig = existingBazelrc + '\n' + bazelConfig
      }
      fs.writeFileSync('.bazelrc', bazelConfig)
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
