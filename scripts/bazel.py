#!/usr/bin/env python3
"""Obtain a fresh GitHub attribution ticket immediately before each Bazel build."""

import json
import os
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


BUILD_COMMANDS = {"build", "test", "run", "coverage", "aquery", "cquery", "query", "fetch", "info", "sync"}
# Startup options also accept a separate value. In particular, `--output_base
# test build ...` must not mistake the output directory for the command.
STARTUP_VALUES = {
    "--bazelrc", "--output_base", "--output_user_root", "--install_base",
    "--server_javabase", "--host_jvm_args", "--host_jvm_profile",
    "--connect_timeout_secs", "--max_idle_secs", "--io_nice_level",
    "--command_port", "--digest_function", "--failure_detail_out",
    "--invocation_policy", "--macos_qos_class", "--unix_digest_hash_attribute_name",
}


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Neither the GitHub request credential nor the identity JWT may follow
        # a redirect to another server.
        raise ValueError("credential-bearing redirects are not supported")


def read_json(request):
    with build_opener(NoRedirects).open(request, timeout=12) as response:
        body = response.read(65537)
        if len(body) > 65536:
            raise ValueError("attribution response is too large")
        return json.loads(body)


def https_url(value, origin=False):
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.netloc or parsed.username
            or parsed.password or parsed.fragment
            or (origin and (parsed.query or parsed.path not in ("", "/")))):
        raise ValueError("invalid attribution URL")
    return parsed


def build_keyword(config):
    origin = config["url"]
    https_url(origin, origin=True)
    oidc = https_url(os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL") or config["oidcUrl"])
    bearer = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN") or config["oidcToken"]
    if not bearer:
        raise ValueError("missing GitHub OIDC permission")
    query = [(k, v) for k, v in parse_qsl(oidc.query) if k != "audience"]
    query.append(("audience", config["audience"]))
    request_url = urlunsplit(oidc._replace(query=urlencode(query)))
    token = read_json(Request(request_url, headers={"Authorization": "Bearer " + bearer}))["value"]
    if not isinstance(token, str) or not token:
        raise ValueError("invalid GitHub identity token")
    ticket = read_json(Request(
        origin.rstrip("/") + "/v1/ci/token-exchange",
        data=json.dumps({"token": token}).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    ))
    ticket_id = ticket.get("ticketId", "")
    if not isinstance(ticket_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", ticket_id):
        raise ValueError("invalid build ticket")
    if ticket.get("keyword") != "nl_ticket:" + ticket_id:
        raise ValueError("invalid build keyword")
    print("::add-mask::" + ticket_id, file=sys.stderr, flush=True)
    return ticket["keyword"]


def command_index(args):
    index = 0
    while index < len(args):
        arg = args[index]
        if not arg.startswith("-"):
            return index
        index += 2 if arg in STARTUP_VALUES else 1
    return None


def attributed_args(args, config):
    index = command_index(args)
    if index is None or args[index] not in BUILD_COMMANDS:
        return args
    # A PATH launcher can enter Bazelisk's workspace hook with its fresh ticket
    # already attached. Limit this check to that hook and to Bazel arguments.
    before_program = args[:args.index("--")] if "--" in args else args
    if os.environ.get("NATIVELINK_BAZEL_REAL") and any(
            arg.startswith("--bes_keywords=nl_ticket:") for arg in before_program):
        return args
    bazelrc = Path(os.environ.get("NATIVELINK_ATTRIBUTION_BAZELRC") or config["bazelrc"])
    # A fork with public cache reads has no BES configuration or attribution.
    if not bazelrc.exists() or not re.search(r"^\s*(?:build|common)\s+--bes_backend=\S+", bazelrc.read_text(), re.M):
        return args
    try:
        keyword = build_keyword(config)
    except Exception:
        # Exception text can contain bearer credentials or response bodies.
        print("::warning::NativeLink attribution unavailable; check App repository enablement, attribution_url, and id-token: write.", file=sys.stderr)
        if config.get("strict"):
            raise RuntimeError("NativeLink build attribution failed") from None
        return args
    # Place before user flags and `run -- program arguments`. Never mutate a
    # shared bazelrc: concurrent invocations must not race over their tickets.
    return [*args[:index + 1], "--bes_keywords=" + keyword, *args[index + 1:]]


def real_bazel():
    # Bazelisk's tools/bazel hook supplies the real binary directly.
    if os.environ.get("NATIVELINK_BAZEL_REAL"):
        return os.environ["NATIVELINK_BAZEL_REAL"]
    def is_launcher(directory):
        candidate = Path(directory).resolve()
        return (candidate.name == "bin" and candidate.parent.name.startswith("nativelink-attribution-")
                and (candidate.parent / "bazel.py").exists())
    search = os.pathsep.join(p for p in os.environ.get("PATH", "").split(os.pathsep)
                             if not is_launcher(p))
    executable = shutil.which("bazel", path=search) or shutil.which("bazelisk", path=search)
    if not executable:
        raise RuntimeError("Bazel is not installed; run your Bazel setup step first")
    return executable


def main():
    try:
        executable = real_bazel()
        config_path = os.environ.get("NATIVELINK_ATTRIBUTION_CONFIG")
        config = json.loads(Path(config_path).read_text()) if config_path else None
        args = attributed_args(sys.argv[1:], config) if config else sys.argv[1:]
        # Do not leak the hook's override into programs launched by bazel run:
        # their own Bazel commands are new invocations and need fresh tickets.
        os.environ.pop("NATIVELINK_BAZEL_REAL", None)
        os.execv(executable, [executable, *args])
    except Exception:
        print("::error::NativeLink could not start Bazel; check the attribution setup and Bazel installation.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
