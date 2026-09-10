import contextlib
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

SCRIPT = Path(__file__).with_name('bazel.py')
spec = importlib.util.spec_from_file_location('wrapper', SCRIPT)
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)


class AttributionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.rc = self.root / 'user.bazelrc'
        self.rc.write_text('common --bes_backend=grpcs://bes.example\ncommon --bes_keywords=role=CI\n')
        self.config = dict(url='https://app.example', audience='nativelink.com',
                           bazelrc=str(self.rc), oidcUrl='https://oidc.example/token?api-version=1',
                           oidcToken='request-secret', strict=False)
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_oidc_and_keyword_contract(self):
        responses = [{'value': 'identity.jwt'}, {'ticketId': 'A' * 43, 'keyword': 'nl_ticket:' + 'A' * 43}]
        with patch.object(wrapper, 'read_json', side_effect=responses) as read, contextlib.redirect_stderr(io.StringIO()) as log:
            self.assertEqual(wrapper.build_keyword(self.config), 'nl_ticket:' + 'A' * 43)
        oidc, exchange = [call.args[0] for call in read.call_args_list]
        self.assertEqual(parse_qs(urlsplit(oidc.full_url).query)['audience'], ['nativelink.com'])
        self.assertEqual(oidc.get_header('Authorization'), 'Bearer request-secret')
        self.assertEqual(exchange.full_url, 'https://app.example/v1/ci/token-exchange')
        self.assertEqual(json.loads(exchange.data), {'token': 'identity.jwt'})
        self.assertEqual(log.getvalue().strip(), '::add-mask::' + 'A' * 43)

    def test_fresh_tickets_for_each_invocation_and_unchanged_config(self):
        original = self.rc.read_bytes()
        with patch.object(wrapper, 'build_keyword', side_effect=['nl_ticket:' + ch * 43 for ch in 'ABC']) as fetch:
            commands = [wrapper.attributed_args([cmd, '//:target'], self.config) for cmd in ('build', 'test', 'run')]
        self.assertEqual(fetch.call_count, 3)
        self.assertEqual(len({args[1] for args in commands}), 3)
        self.assertEqual(self.rc.read_bytes(), original)

    def test_startup_options_and_program_arguments_survive(self):
        args = ['--output_base', 'test', '--batch', 'run', '//:tool', '--', 'test', '--flag=a b']
        with patch.object(wrapper, 'build_keyword', return_value='nl_ticket:' + 'A' * 43):
            result = wrapper.attributed_args(args, self.config)
        self.assertEqual(result, [*args[:4], '--bes_keywords=nl_ticket:' + 'A' * 43, *args[4:]])

    def test_non_build_commands_do_not_request_identity(self):
        with patch.object(wrapper, 'build_keyword') as fetch:
            for args in ([], ['version'], ['help', 'build'], ['shutdown'], ['clean'], ['--output_base', 'test', 'version']):
                self.assertEqual(wrapper.attributed_args(args, self.config), args)
        fetch.assert_not_called()

    def test_cache_only_forks_never_request_identity(self):
        self.rc.write_text('build --remote_cache=grpcs://public.example\n')
        with patch.object(wrapper, 'build_keyword') as fetch:
            self.assertEqual(wrapper.attributed_args(['build', '//...'], self.config), ['build', '//...'])
        fetch.assert_not_called()

    def test_nested_bazelisk_hook_preserves_outer_ticket(self):
        os.environ['NATIVELINK_BAZEL_REAL'] = '/usr/bin/bazel'
        args = ['build', '--bes_keywords=nl_ticket:' + 'A' * 43, '//...']
        with patch.object(wrapper, 'build_keyword') as fetch:
            self.assertEqual(wrapper.attributed_args(args, self.config), args)
        fetch.assert_not_called()

    def test_failure_warns_without_secret_and_strict_mode_stops(self):
        for strict in (False, True):
            self.config['strict'] = strict
            with patch.object(wrapper, 'build_keyword', side_effect=ValueError('private-token-in-response')), contextlib.redirect_stderr(io.StringIO()) as log:
                if strict:
                    with self.assertRaisesRegex(RuntimeError, 'NativeLink build attribution failed'):
                        wrapper.attributed_args(['build', '//...'], self.config)
                else:
                    self.assertEqual(wrapper.attributed_args(['build', '//...'], self.config), ['build', '//...'])
            self.assertNotIn('private-token', log.getvalue())
            self.assertIn('::warning::', log.getvalue())

    def test_malformed_tickets_and_redirects_are_rejected(self):
        for ticket in ({'ticketId': None}, {'ticketId': 'A' * 43, 'keyword': 'nl_ticket:' + 'B' * 43},
                       {'ticketId': 'A' * 43, 'keyword': 'nl_ticket:x\nbuild --remote_cache=evil'}):
            with patch.object(wrapper, 'read_json', side_effect=[{'value': 'jwt'}, ticket]):
                with self.assertRaises(ValueError):
                    wrapper.build_keyword(self.config)
        with self.assertRaises(ValueError):
            wrapper.NoRedirects().redirect_request(None, None, 302, '', {}, 'https://other.example')

    def test_parallel_processes_forward_arguments_exit_status_and_distinct_tickets(self):
        fake = self.root / 'bazel'
        fake.write_text(f'#!{sys.executable}\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\nsys.exit(37)\n')
        fake.chmod(0o700)
        config_path = self.root / 'config.json'
        config_path.write_text(json.dumps(self.config))
        # The transport is mocked in each subprocess; the wrapper's actual
        # argument handling and exec into a Bazel process are exercised.
        launch = ('import importlib.util,secrets,sys; '
                  f's=importlib.util.spec_from_file_location("w",{str(SCRIPT)!r}); '
                  'w=importlib.util.module_from_spec(s); s.loader.exec_module(w); '
                  'w.read_json=lambda request: ({"value":"jwt"} if request.data is None else '
                  '(lambda t: {"ticketId":t,"keyword":"nl_ticket:"+t})(secrets.token_urlsafe(32))); '
                  'sys.exit(w.main())')
        env = {'PATH': str(self.root), 'NATIVELINK_ATTRIBUTION_CONFIG': str(config_path)}
        def invoke(_):
            return subprocess.run([sys.executable, '-c', launch, '--output_base', 'test', 'run', '//:tool', '--', 'a b'],
                                  env=env, capture_output=True, text=True, timeout=10)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(invoke, range(4)))
        tickets = set()
        for result in results:
            self.assertEqual(result.returncode, 37, result.stderr)
            args = json.loads(result.stdout)
            self.assertEqual(args[:3], ['--output_base', 'test', 'run'])
            self.assertEqual(args[4:], ['//:tool', '--', 'a b'])
            self.assertTrue(args[3].startswith('--bes_keywords=nl_ticket:'))
            tickets.add(args[3])
        self.assertEqual(len(tickets), 4)


if __name__ == '__main__':
    unittest.main()
