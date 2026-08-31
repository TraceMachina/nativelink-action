# Nativelink Cloud Action

![CI](https://github.com/actions/typescript-action/actions/workflows/ci.yml/badge.svg)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

This action sets up your repository to use
[NativeLink Cloud](https://nativelink.com/) for your Bazel build. We primarily
set the values in your `.bazelrc` (creating or appending this as necessary) and
assume you're doing the rest of the Bazel setup.

## Which NativeLink is this for?

There are two ways to run NativeLink, and this action is written for the first:

- **NativeLink Cloud** — the managed service at
  [app.nativelink.com](https://app.nativelink.com). You sign up, you get an
  account, and the cache and build-event endpoints are hosted for you. Every
  default in this action assumes this.
- **NativeLink Enterprise (self-hosted)** — NativeLink running inside your own
  infrastructure, on your own network. See
  [enterprise.nativelink.com](https://enterprise.nativelink.com).

The action works for a self-hosted deployment too, but none of the defaults will
be right: your cache, build-event and scheduler endpoints are your own, so pass
`cache_url`, `bes_url` and `scheduler_url` explicitly. Take the values from the
NativeLink application for your deployment rather than constructing them.

## Usage

1. Goto https://app.nativelink.com and signup for an account
2. Add the following to your Github steps

```yaml
steps:
  # Other methods of getting Bazel are also usable, but this works well
  - uses: bazel-contrib/setup-bazel@0.15.0
    with:
      # Avoid downloading Bazel every time.
      bazelisk-cache: true
      # Build cache is all in Nativelink
      disk-cache: false
      # Share repository cache between workflows.
      repository-cache: true

  - name: Nativelink setup
    uses: TraceMachina/nativelink-action@latest
    with:
      api_key: ${{ secrets.NATIVELINK_API_KEY }}
      account: your-account-here
      prefix: your-account-prefix-here
```

You'll need to set `your-account-here` and `your-account-prefix-here`, as well
as the `NATIVELINK_API_KEY` value.

To determine these values, look at the Quickstart Bazel settings for your
account. If your `build --remote-cache=` value is say for example
`build --remote_cache=grpcs://cas-tom-parker-shemilt-y0738m.build-faster.nativelink.net`,
then `your-account-here` is `tom-parker-shemilt` and `your-account-prefix-here`
is `tom-parker-shemilt-y0738m`.

`NATIVELINK_API_KEY` is your `build --remote_header` value. e.g. if you have
`build --remote_header=x-nativelink-api-key=some-key-value`, then
`NATIVELINK_API_KEY` is `some-key-value`

## Remote execution (optional)

The action configures remote **caching** by default. Remote **execution** is
opt-in, and needs the scheduler address for your deployment:

```yaml
with:
  api_key: ${{ secrets.NATIVELINK_API_KEY }}
  account: your-account-here
  prefix: your-account-prefix-here
  scheduler_url: grpcs://... # from your NativeLink application
```

There is deliberately no default. The scheduler address is not derivable from
your account prefix and differs between deployments, so a guessed hostname would
fail at build time rather than here — take the value from the quickstart
settings in your NativeLink application, alongside the cache and API key values
above. Leave it unset and you get a cache-only build, with no
`--remote_executor` line written at all.

## Build attribution (optional)

By default a build carries no trustworthy record of who ran it. Bazel's
`BUILD_USER` is the OS username on the machine, which on a GitHub Actions runner
is literally `runner`, and a workflow author can set it to anything.

Set `attribution_url` and the action will instead ask GitHub for a token
asserting this job's identity, exchange it with NativeLink for an opaque build
ticket, and add that ticket to the `.bazelrc` it writes. NativeLink then shows
the GitHub user, repository, branch, commit and pull request on the build —
verified against GitHub's signature rather than taken on trust.

```yaml
permissions:
  id-token: write # required: no token is minted without it
  contents: read

steps:
  - name: Nativelink setup
    uses: TraceMachina/nativelink-action@latest
    with:
      api_key: ${{ secrets.NATIVELINK_API_KEY }}
      account: your-account-here
      prefix: your-account-prefix-here
      attribution_url: https://github-app.nativelink.com
```

| Input                       | Default          | Purpose                                                                 |
| --------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `attribution_url`           | _unset_          | Origin of the NativeLink GitHub App service. Unset means no attribution |
| `attribution_audience`      | `nativelink.com` | Audience the OIDC token is minted for; must match the server's          |
| `fail_on_attribution_error` | `false`          | Fail the job when attribution cannot be established                     |

Three things worth knowing:

- **`permissions: id-token: write` is required.** Without it GitHub mints no
  token at all, and the action says so rather than failing obscurely. This is by
  far the most common setup mistake.
- **Failure is soft by default.** A NativeLink outage, or a repository nobody
  enabled, costs the build its verified identity and nothing else — the build
  still runs and still uses the cache. Set `fail_on_attribution_error: true` if
  you would rather fail than lose provenance.
- **The repository must be enabled** in NativeLink under Settings →
  Repositories. Connecting an organisation makes a repository visible; it stays
  inert until someone turns it on.

Bazel only for now — `--bes_keywords` is a Bazel concept and buck2 has no
equivalent channel to carry the ticket, so the input is ignored there with a
warning.
