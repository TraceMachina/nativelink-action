import core from '@actions/core'
import { installAttribution } from './attribution.js'

try {
  installAttribution(core, core.getInput('bazelrc') || '.bazelrc')
} catch {
  core.setFailed('NativeLink build attribution failed')
}
