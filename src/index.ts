/**
 * The entrypoint for the action. This file simply imports and runs the action's
 * main logic.
 */
import { run } from './main.js'
import core from '@actions/core'

/* istanbul ignore next */
run(core)
