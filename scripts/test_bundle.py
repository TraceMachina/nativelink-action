"""Exercise the shipped Action bundle, installed launcher, and post-job cleanup."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def command_file(path):
    result = {}
    lines = iter(path.read_text().splitlines())
    for line in lines:
        if '<<' in line:
            key, delimiter = line.split('<<', 1)
            value = []
            for part in lines:
                if part == delimiter:
                    break
                value.append(part)
            result[key] = '\n'.join(value)
        elif '=' in line:
            key, value = line.split('=', 1)
            result[key] = value
    return result


class BundleTest(unittest.TestCase):
    def test_shipped_action_two_builds_and_cleanup(self):
        node = os.environ.get('TEST_NODE') or shutil.which('node')
        self.assertTrue(node, 'Node is required to test the shipped Action')
        self.assertTrue((ROOT / 'dist/attribution.js').exists(), 'Run pnpm package before this test')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = dict(os.environ, RUNNER_TEMP=directory,
                       INPUT_ATTRIBUTION_URL='https://app.example', INPUT_BAZELRC='user.bazelrc',
                       ACTIONS_ID_TOKEN_REQUEST_URL='https://oidc.example/token',
                       ACTIONS_ID_TOKEN_REQUEST_TOKEN='test-request-credential')
            for key in ('GITHUB_PATH', 'GITHUB_ENV', 'GITHUB_OUTPUT', 'GITHUB_STATE'):
                file = root / key
                file.touch()
                env[key] = str(file)
            rc = root / 'user.bazelrc'
            original = 'common --bes_backend=grpcs://bes.example\n'
            rc.write_text(original)
            result = subprocess.run([node, str(ROOT / 'dist/attribution.js')], cwd=root,
                                    env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            outputs = command_file(root / 'GITHUB_OUTPUT')
            config = Path(outputs['attribution-config'])
            self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            # Test the real launcher with fake network transport and a fake
            # Bazel binary. No production endpoint or credential is involved.
            (root / 'sitecustomize.py').write_text('''import json,secrets,urllib.request
class Response:
 def __init__(self, value): self.value=value
 def __enter__(self): return self
 def __exit__(self, *args): pass
 def read(self, *args): return json.dumps(self.value).encode()
class Opener:
 def open(self, request, **kwargs):
  if request.data is None: return Response({"value":"test.jwt"})
  ticket=secrets.token_urlsafe(32)
  return Response({"ticketId":ticket,"keyword":"nl_ticket:"+ticket})
urllib.request.build_opener=lambda *args: Opener()
''')
            bazel = root / 'bazel'
            bazel.write_text(f'#!{sys.executable}\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n')
            bazel.chmod(0o700)
            launcher_dir = (root / 'GITHUB_PATH').read_text().strip()
            env.update(command_file(root / 'GITHUB_ENV'))
            env.update(PATH=os.pathsep.join((launcher_dir, directory, env['PATH'])), PYTHONPATH=directory)
            tickets = []
            for command in ('build', 'test'):
                run = subprocess.run([str(Path(launcher_dir) / 'bazel'), command, '//:target'], cwd=root,
                                     env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(run.returncode, 0, run.stderr)
                args = json.loads(run.stdout)
                self.assertEqual(args[0], command)
                self.assertEqual(args[-1], '//:target')
                tickets.append(args[1])
                self.assertIn('::add-mask::', run.stderr)
            self.assertTrue(all(ticket.startswith('--bes_keywords=nl_ticket:') for ticket in tickets))
            self.assertNotEqual(*tickets)
            self.assertEqual(rc.read_text(), original)
            env.update({f'STATE_{key}': value for key, value in command_file(root / 'GITHUB_STATE').items()})
            post = subprocess.run([node, str(ROOT / 'dist/post.js')], cwd=root, env=env,
                                  capture_output=True, text=True, timeout=10)
            self.assertEqual(post.returncode, 0, post.stderr)
            self.assertFalse(config.parent.exists(), 'The post step must remove the temporary credential directory')


if __name__ == '__main__':
    unittest.main()
