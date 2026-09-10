import fs from 'node:fs';
import { i as installAttribution } from './attribution2.js';
import { c as core } from './core.js';
import 'node:path';
import 'node:os';
import 'node:url';
import 'node:child_process';
import 'os';
import 'crypto';
import 'fs';
import 'path';
import 'http';
import 'https';
import 'net';
import 'tls';
import 'events';
import 'assert';
import 'util';
import 'stream';
import 'buffer';
import 'querystring';
import 'stream/web';
import 'node:stream';
import 'node:util';
import 'node:events';
import 'worker_threads';
import 'perf_hooks';
import 'util/types';
import 'async_hooks';
import 'console';
import 'url';
import 'zlib';
import 'string_decoder';
import 'diagnostics_channel';
import 'child_process';
import 'timers';

var ini;
var hasRequiredIni;

function requireIni () {
	if (hasRequiredIni) return ini;
	hasRequiredIni = 1;
	const { hasOwnProperty } = Object.prototype;

	const encode = (obj, opt = {}) => {
	  if (typeof opt === 'string') {
	    opt = { section: opt };
	  }
	  opt.align = opt.align === true;
	  opt.newline = opt.newline === true;
	  opt.sort = opt.sort === true;
	  opt.whitespace = opt.whitespace === true || opt.align === true;
	  // The `typeof` check is required because accessing the `process` directly fails on browsers.
	  /* istanbul ignore next */
	  opt.platform = opt.platform || (typeof process !== 'undefined' && process.platform);
	  opt.bracketedArray = opt.bracketedArray !== false;

	  /* istanbul ignore next */
	  const eol = opt.platform === 'win32' ? '\r\n' : '\n';
	  const separator = opt.whitespace ? ' = ' : '=';
	  const children = [];

	  const keys = opt.sort ? Object.keys(obj).sort() : Object.keys(obj);

	  let padToChars = 0;
	  // If aligning on the separator, then padToChars is determined as follows:
	  // 1. Get the keys
	  // 2. Exclude keys pointing to objects unless the value is null or an array
	  // 3. Add `[]` to array keys
	  // 4. Ensure non empty set of keys
	  // 5. Reduce the set to the longest `safe` key
	  // 6. Get the `safe` length
	  if (opt.align) {
	    padToChars = safe(
	      (
	        keys
	          .filter(k => obj[k] === null || Array.isArray(obj[k]) || typeof obj[k] !== 'object')
	          .map(k => Array.isArray(obj[k]) ? `${k}[]` : k)
	      )
	        .concat([''])
	        .reduce((a, b) => safe(a).length >= safe(b).length ? a : b)
	    ).length;
	  }

	  let out = '';
	  const arraySuffix = opt.bracketedArray ? '[]' : '';

	  for (const k of keys) {
	    const val = obj[k];
	    if (val && Array.isArray(val)) {
	      for (const item of val) {
	        out += safe(`${k}${arraySuffix}`).padEnd(padToChars, ' ') + separator + safe(item) + eol;
	      }
	    } else if (val && typeof val === 'object') {
	      children.push(k);
	    } else {
	      out += safe(k).padEnd(padToChars, ' ') + separator + safe(val) + eol;
	    }
	  }

	  if (opt.section && out.length) {
	    out = '[' + safe(opt.section) + ']' + (opt.newline ? eol + eol : eol) + out;
	  }

	  for (const k of children) {
	    const nk = splitSections(k, '.').join('\\.');
	    const section = (opt.section ? opt.section + '.' : '') + nk;
	    const child = encode(obj[k], {
	      ...opt,
	      section,
	    });
	    if (out.length && child.length) {
	      out += eol;
	    }

	    out += child;
	  }

	  return out
	};

	function splitSections (str, separator) {
	  var lastMatchIndex = 0;
	  var lastSeparatorIndex = 0;
	  var nextIndex = 0;
	  var sections = [];

	  do {
	    nextIndex = str.indexOf(separator, lastMatchIndex);

	    if (nextIndex !== -1) {
	      lastMatchIndex = nextIndex + separator.length;

	      if (nextIndex > 0 && str[nextIndex - 1] === '\\') {
	        continue
	      }

	      sections.push(str.slice(lastSeparatorIndex, nextIndex));
	      lastSeparatorIndex = nextIndex + separator.length;
	    }
	  } while (nextIndex !== -1)

	  sections.push(str.slice(lastSeparatorIndex));

	  return sections
	}

	const decode = (str, opt = {}) => {
	  opt.bracketedArray = opt.bracketedArray !== false;
	  const out = Object.create(null);
	  let p = out;
	  let section = null;
	  //          section          |key      = value
	  const re = /^\[([^\]]*)\]\s*$|^([^=]+)(=(.*))?$/i;
	  const lines = str.split(/[\r\n]+/g);
	  const duplicates = {};

	  for (const line of lines) {
	    if (!line || line.match(/^\s*[;#]/) || line.match(/^\s*$/)) {
	      continue
	    }
	    const match = line.match(re);
	    if (!match) {
	      continue
	    }
	    if (match[1] !== undefined) {
	      section = unsafe(match[1]);
	      if (section === '__proto__') {
	        // not allowed
	        // keep parsing the section, but don't attach it.
	        p = Object.create(null);
	        continue
	      }
	      p = out[section] = out[section] || Object.create(null);
	      continue
	    }
	    const keyRaw = unsafe(match[2]);
	    let isArray;
	    if (opt.bracketedArray) {
	      isArray = keyRaw.length > 2 && keyRaw.slice(-2) === '[]';
	    } else {
	      duplicates[keyRaw] = (duplicates?.[keyRaw] || 0) + 1;
	      isArray = duplicates[keyRaw] > 1;
	    }
	    const key = isArray && keyRaw.endsWith('[]')
	      ? keyRaw.slice(0, -2) : keyRaw;

	    if (key === '__proto__') {
	      continue
	    }
	    const valueRaw = match[3] ? unsafe(match[4]) : true;
	    const value = valueRaw === 'true' ||
	      valueRaw === 'false' ||
	      valueRaw === 'null' ? JSON.parse(valueRaw)
	      : valueRaw;

	    // Convert keys with '[]' suffix to an array
	    if (isArray) {
	      if (!hasOwnProperty.call(p, key)) {
	        p[key] = [];
	      } else if (!Array.isArray(p[key])) {
	        p[key] = [p[key]];
	      }
	    }

	    // safeguard against resetting a previously defined
	    // array by accidentally forgetting the brackets
	    if (Array.isArray(p[key])) {
	      p[key].push(value);
	    } else {
	      p[key] = value;
	    }
	  }

	  // {a:{y:1},"a.b":{x:2}} --> {a:{y:1,b:{x:2}}}
	  // use a filter to return the keys that have to be deleted.
	  const remove = [];
	  for (const k of Object.keys(out)) {
	    if (!hasOwnProperty.call(out, k) ||
	      typeof out[k] !== 'object' ||
	      Array.isArray(out[k])) {
	      continue
	    }

	    // see if the parent section is also an object.
	    // if so, add it to that, and mark this one for deletion
	    const parts = splitSections(k, '.');
	    p = out;
	    const l = parts.pop();
	    const nl = l.replace(/\\\./g, '.');
	    for (const part of parts) {
	      if (part === '__proto__') {
	        continue
	      }
	      if (!hasOwnProperty.call(p, part) || typeof p[part] !== 'object') {
	        p[part] = Object.create(null);
	      }
	      p = p[part];
	    }
	    if (p === out && nl === l) {
	      continue
	    }

	    p[nl] = out[k];
	    remove.push(k);
	  }
	  for (const del of remove) {
	    delete out[del];
	  }

	  return out
	};

	const isQuoted = val => {
	  return (val.startsWith('"') && val.endsWith('"')) ||
	    (val.startsWith("'") && val.endsWith("'"))
	};

	const safe = val => {
	  if (
	    typeof val !== 'string' ||
	    val.match(/[=\r\n]/) ||
	    val.match(/^\[/) ||
	    (val.length > 1 && isQuoted(val)) ||
	    val !== val.trim()
	  ) {
	    return JSON.stringify(val)
	  }
	  return val.split(';').join('\\;').split('#').join('\\#')
	};

	const unsafe = val => {
	  val = (val || '').trim();
	  if (isQuoted(val)) {
	    // remove the single quotes before calling JSON.parse
	    if (val.charAt(0) === "'") {
	      val = val.slice(1, -1);
	    }
	    try {
	      val = JSON.parse(val);
	    } catch {
	      // ignore errors
	    }
	  } else {
	    // walk the val to find the first not-escaped ; character
	    let esc = false;
	    let unesc = '';
	    for (let i = 0, l = val.length; i < l; i++) {
	      const c = val.charAt(i);
	      if (esc) {
	        if ('\\;#'.indexOf(c) !== -1) {
	          unesc += c;
	        } else {
	          unesc += '\\' + c;
	        }

	        esc = false;
	      } else if (';#'.indexOf(c) !== -1) {
	        break
	      } else if (c === '\\') {
	        esc = true;
	      } else {
	        unesc += c;
	      }
	    }
	    if (esc) {
	      unesc += '\\';
	    }

	    return unesc.trim()
	  }
	  return val
	};

	ini = {
	  parse: decode,
	  decode,
	  stringify: encode,
	  encode,
	  safe,
	  unsafe,
	};
	return ini;
}

var iniExports = requireIni();

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
async function run(core) {
    try {
        const apiKey = core.getInput('api_key', { required: true });
        const account = core.getInput('account', { required: true });
        const prefix = core.getInput('prefix', { required: true });
        let raw_environment = core.getInput('environment');
        if (raw_environment === '') {
            raw_environment = 'prod';
        }
        if (raw_environment !== 'prod' && raw_environment !== 'dev') {
            throw new Error(`Invalid environment: ${raw_environment}`);
        }
        const environment = raw_environment;
        let cacheUrl = core.getInput('cache_url');
        if (cacheUrl === '') {
            if (environment === 'prod') {
                cacheUrl = `grpcs://cas-${prefix}.build-faster.nativelink.net`;
            }
            else {
                cacheUrl = `grpcs://cas-${prefix}.uc1.scdev.nativelink.net`;
            }
        }
        let besUrl = core.getInput('bes_url');
        if (besUrl === '') {
            if (environment === 'prod') {
                besUrl = `grpcs://bes-${prefix}.build-faster.nativelink.net`;
            }
            else {
                besUrl = `grpcs://bes-${prefix}.uc1.scdev.nativelink.net`;
            }
        }
        let besResultsUrl = core.getInput('bes_results_url');
        if (besResultsUrl === '') {
            if (environment === 'prod') {
                besResultsUrl = `https://app.nativelink.com/a/${account}/build`;
            }
            else {
                besResultsUrl = `https://web-dev.uc1.scdev.nativelink.net/a/${account}/build`;
            }
        }
        // No default. Remote execution is opt-in, and the scheduler address is not
        // derivable from the account prefix — it differs between deployments, and a
        // guessed hostname fails at build time rather than here. Users take it from
        // their NativeLink application; unset simply means "cache only".
        const schedulerUrl = core.getInput('scheduler_url').trim();
        let remoteTimeout = core.getInput('remote_timeout');
        if (remoteTimeout === '') {
            remoteTimeout = '600';
        }
        // Read once and share: the bazel and buck2 branches both need to know
        // whether attribution was asked for, and reading the input separately in
        // each invites them to disagree about it.
        const attributionUrl = core.getInput('attribution_url').trim();
        let buildSystem = core.getInput('build_system');
        if (buildSystem === '') {
            buildSystem = 'bazel';
        }
        if (buildSystem == 'bazel') {
            let existingBazelrc = '';
            try {
                existingBazelrc = fs.readFileSync('.bazelrc', 'utf-8');
            }
            catch (error) {
                // Ignore error if file does not exist
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
            let bazelConfig = `build --remote_cache=${cacheUrl}
build --remote_header=x-nativelink-api-key=${apiKey}
build --bes_backend=${besUrl}
build --bes_header=x-nativelink-api-key=${apiKey}
build --bes_results_url=${besResultsUrl}
build --remote_timeout=${remoteTimeout}`;
            // Only when the user supplied one: an empty --remote_executor is not
            // "no remote execution", it is a Bazel error.
            if (schedulerUrl !== '') {
                bazelConfig += `\nbuild --remote_executor=${schedulerUrl}`;
            }
            if (existingBazelrc !== '') {
                bazelConfig = existingBazelrc + '\n' + bazelConfig;
            }
            fs.writeFileSync('.bazelrc', bazelConfig);
            installAttribution(core, '.bazelrc');
        }
        else if (buildSystem == 'buck2') {
            if (attributionUrl !== '') {
                // --bes_keywords is a Bazel concept. Buck2 has no equivalent channel to
                // carry the ticket, so attribution cannot work there yet.
                core.warning('NativeLink build attribution is not supported for buck2 and was ignored.');
            }
            let existingBuck2config = '';
            try {
                existingBuck2config = fs.readFileSync('.buckconfig', 'utf-8');
            }
            catch (error) {
                // Ignore error if file does not exist
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
            // engine_address only when a scheduler was supplied; the cache addresses
            // stand on their own, so a cache-only buck2 setup stays valid.
            let buckconfig = {
                buck2_re_client: {
                    ...(schedulerUrl !== ''
                        ? { engine_address: schedulerUrl.replace('grpcs://', '') + ':443' }
                        : {}),
                    action_cache_address: cacheUrl.replace('grpcs://', '') + ':443',
                    cas_address: cacheUrl.replace('grpcs://', '') + ':443',
                    tls: true,
                    http_headers: `x-nativelink-api-key:${apiKey}`
                }
            };
            if (existingBuck2config !== '') {
                const existingconfig = iniExports.parse(existingBuck2config);
                buckconfig = {
                    ...buckconfig,
                    ...existingconfig
                };
            }
            fs.writeFileSync('.buckconfig', iniExports.stringify(buckconfig, { whitespace: true }));
        }
        else {
            throw new Error(`Unknown build system: ${buildSystem}`);
        }
    }
    catch (error) {
        // Fail the workflow run if an error occurs
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
        else {
            core.setFailed('An unknown error occurred: ' + JSON.stringify(error));
        }
    }
}

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
/**
 * The entrypoint for the action. This file simply imports and runs the action's
 * main logic.
 */
/* istanbul ignore next */
run(core);
//# sourceMappingURL=index.js.map
