import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export type AttributionCore = {
  getInput: (name: string) => string
  warning: (message: string) => void
  info: (message: string) => void
  setSecret: (secret: string) => void
  addPath: (path: string) => void
  exportVariable: (name: string, value: string) => void
  setOutput: (name: string, value: string) => void
  saveState: (name: string, value: string) => void
}

export function strictAttribution(core: AttributionCore): boolean {
  return /^(true|yes|1|on)$/i.test(
    core.getInput('fail_on_attribution_error').trim()
  )
}

export function installAttribution(
  core: AttributionCore,
  bazelrc: string
): void {
  const url = core.getInput('attribution_url').trim()
  if (!url) return
  try {
    const origin = new URL(url)
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== '/'
    ) {
      throw new Error('invalid origin')
    }
    // Cache-only forks never get a wrapper or a credential file.
    if (
      !/^\s*(?:build|common)\s+--bes_backend=\S+/m.test(
        fs.readFileSync(bazelrc, 'utf8')
      )
    )
      return
    const oidcUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
    const oidcToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    if (!oidcUrl || !oidcToken) throw new Error('missing OIDC')
    const python = execFileSync(
      'python3',
      ['-c', 'import sys; print(sys.executable)'],
      { encoding: 'utf8' }
    ).trim()
    const directory = fs.mkdtempSync(
      path.join(
        process.env.RUNNER_TEMP || os.tmpdir(),
        'nativelink-attribution-'
      )
    )
    fs.chmodSync(directory, 0o700)
    core.saveState('attribution-directory', directory)
    const wrapper = path.join(directory, 'bazel.py')
    fs.copyFileSync(
      fileURLToPath(new URL('../scripts/bazel.py', import.meta.url)),
      wrapper
    )
    const configFile = path.join(directory, 'config.json')
    core.setSecret(oidcToken)
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        url: origin.origin,
        audience:
          core.getInput('attribution_audience').trim() || 'nativelink.com',
        strict: strictAttribution(core),
        bazelrc: path.resolve(bazelrc),
        oidcUrl,
        oidcToken
      }),
      { mode: 0o600 }
    )
    const bin = path.join(directory, 'bin')
    fs.mkdirSync(bin)
    const quote = (value: string): string =>
      "'" + value.replaceAll("'", "'\\''") + "'"
    fs.writeFileSync(
      path.join(bin, 'bazel'),
      `#!/bin/sh\nexec ${quote(python)} ${quote(wrapper)} "$@"\n`,
      { mode: 0o700 }
    )
    // PowerShell/cmd resolve .cmd; Git Bash uses the POSIX launcher above.
    fs.writeFileSync(
      path.join(bin, 'bazel.cmd'),
      `@"${python}" "${wrapper}" %*\r\n`
    )
    core.exportVariable('NATIVELINK_ATTRIBUTION_CONFIG', configFile)
    core.exportVariable('NATIVELINK_BAZEL_WRAPPER', wrapper)
    core.setOutput('attribution-config', configFile)
    core.setOutput('attribution-wrapper', wrapper)
    core.addPath(bin)
    core.info(
      'NativeLink attribution enabled: each Bazel invocation will request its own identity ticket.'
    )
  } catch {
    core.warning(
      'NativeLink attribution setup unavailable; check attribution_url, Python 3, and permissions: id-token: write.'
    )
    if (strictAttribution(core))
      throw new Error('NativeLink build attribution failed')
  }
}
