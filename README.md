# Nativelink Cloud action

![CI](https://github.com/actions/typescript-action/actions/workflows/ci.yml/badge.svg)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

This action sets up your repository to use
[Nativelink Cloud](https://nativelink.com/) for your Bazel build. We primarily
set the values in your `.bazelrc` (creating or appending this as necessary) and
assume you're doing the rest of the Bazel setup.

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
    uses: TraceMachina/nativelink-action@0ec6ddb897f731db2a4de9cf815dea5926820fb3
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
