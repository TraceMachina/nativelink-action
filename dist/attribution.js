import { c as core } from './core.js';
import { i as installAttribution } from './attribution2.js';
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
import 'node:fs';
import 'node:path';
import 'node:os';
import 'node:url';
import 'node:child_process';

try {
    installAttribution(core, core.getInput('bazelrc') || '.bazelrc');
}
catch {
    core.setFailed('NativeLink build attribution failed');
}
//# sourceMappingURL=attribution.js.map
