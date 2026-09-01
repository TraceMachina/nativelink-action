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
  [dev.app.nativelink.com](https://dev.app.nativelink.com). You sign up, you get
  an account, and the cache and build-event endpoints are hosted for you. Every
  default in this action assumes this.
- **NativeLink Enterprise (on-prem / self-hosted)** — NativeLink running inside
  your own infrastructure, on your own network. See
  [enterprise.nativelink.com](https://enterprise.nativelink.com).

The action works for a self-hosted deployment too, but none of the defaults will
be right: your cache, build-event and scheduler endpoints are your own, so pass
`cache_url`, `bes_url` and `scheduler_url` explicitly. Take the values from the
NativeLink application for your deployment rather than constructing them.

## Usage

Three inputs are required — `api_key`, `account` and `prefix` — and all three
come from one screen in the NativeLink application. Collect them first, then
paste the workflow. Doing it the other way round means editing placeholders in a
file you have already committed.

### 1. Create an account and open the quickstart

Go to [dev.app.nativelink.com](https://dev.app.nativelink.com) and sign up. Once
you are in, open **Quickstart** and select **Bazel**. You will see a block like
this, already filled in with your own values:

```
build --remote_cache=grpcs://cas-tom-parker-shemilt-y0738m.build-faster.nativelink.net
build --remote_header=x-nativelink-api-key=abc123-your-real-key
```

Leave that page open. Every value below comes from those two lines.

### 2. Read the three values off that block

| Action input | Comes from                              | In the example above        |
| ------------ | --------------------------------------- | --------------------------- |
| `api_key`    | `--remote_header=x-nativelink-api-key=` | `abc123-your-real-key`      |
| `prefix`     | `--remote_cache=` host, after `cas-`    | `tom-parker-shemilt-y0738m` |
| `account`    | `prefix` without its last `-` segment   | `tom-parker-shemilt`        |

`prefix` is your account name plus a short generated suffix, which is why
`account` is the same string with that suffix removed. If you would rather not
do it by eye, paste your own `--remote_cache` line into this and read the
answers off:

```bash
CAS='grpcs://cas-tom-parker-shemilt-y0738m.build-faster.nativelink.net'  # <- yours

PREFIX=$(printf '%s' "$CAS" | sed -E 's#^grpcs://cas-##; s#\..*$##')
ACCOUNT=$(printf '%s' "$PREFIX" | sed -E 's#-[^-]+$##')
printf 'prefix : %s\naccount: %s\n' "$PREFIX" "$ACCOUNT"
```

### 3. Store the API key as a repository secret

The API key is a credential. It goes in GitHub's secret store, never in the
workflow file.

In your repository on GitHub: **Settings → Secrets and variables → Actions → New
repository secret**. Name it exactly `NATIVELINK_API_KEY`, and paste the
`api_key` value from the table above.

The name has to match exactly, because the workflow below reads
`secrets.NATIVELINK_API_KEY`. A typo here surfaces as an empty key and an
authentication failure at build time, not as a workflow error.

### 4. Add the action to your workflow

In `.github/workflows/<your-workflow>.yml`, add both entries below to the job
that runs your build — the `steps:` key is GitHub's own workflow syntax, so keep
that line as it is and add the two `- uses:` entries under it. Substitute your
own `account` and `prefix`; leave the `api_key` line exactly as written, since
it reads the secret you just created.

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
    uses: TraceMachina/nativelink-action@v0
    with:
      api_key: ${{ secrets.NATIVELINK_API_KEY }}
      account: tom-parker-shemilt # <- your account
      prefix: tom-parker-shemilt-y0738m # <- your prefix
```

Commit, push, and let the workflow run. The action writes the cache
configuration into `.bazelrc` before Bazel starts; a second run of the same
build should be substantially faster than the first.

### Which version to reference

Use `@v0`. It tracks the current release.

**Do not use `@latest`.** It looks like it means "the newest version" and does
not — it is an ordinary mutable tag that has to be moved by hand, and it
currently points at an older commit than `v0` does. Earlier revisions of this
document recommended it, which is why it appears in workflows that predate this
note; change those to `@v0`.

If you pin by commit SHA instead — the hardened option, and what GitHub
recommends for third-party actions — take the SHA from a release rather than
from the tip of `main`.

## Remote execution (optional)

The action configures remote **caching** by default. Remote **execution** is
opt-in, and needs the scheduler address for your deployment:

```yaml
with:
  api_key: ${{ secrets.NATIVELINK_API_KEY }}
  account: tom-parker-shemilt # <- your account
  prefix: tom-parker-shemilt-y0738m # <- your prefix
  scheduler_url: grpcs://... # <- from your NativeLink application
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
    uses: TraceMachina/nativelink-action@v0
    with:
      api_key: ${{ secrets.NATIVELINK_API_KEY }}
      account: tom-parker-shemilt # <- your account
      prefix: tom-parker-shemilt-y0738m # <- your prefix
      attribution_url: https://github-app.nativelink.com
```

**Needs v0.0.3 or newer.** The attribution inputs arrived in that release, so
`@v0` is correct only if it has been moved to it — which it has. Referencing an
older version does not fail: an unknown input is ignored, so the action runs and
configures a perfectly ordinary unattributed build. If attribution silently does
not appear, check the version you resolved before looking anywhere else.

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
