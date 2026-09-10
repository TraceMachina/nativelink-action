import fs from 'node:fs'
import core from '@actions/core'

const directory = core.getState('attribution-directory')
if (directory) fs.rmSync(directory, { recursive: true, force: true })
