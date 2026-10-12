# WebSentry Security Scan

A GitHub Action that scans a deployed site with [WebSentry](https://websentry.dev) and fails the build when a deploy makes security worse.

It gates on **regressions by default**, not on absolute grades. A site that has carried the same weak Content Security Policy since last year will not break every build; a deploy that newly removes a security header will.

## Quick start

Scan every successful deployment, including preview deployments from Vercel, Netlify, and Cloudflare Pages:

```yaml
name: WebSentry

on:
  deployment_status:

permissions:
  contents: read
  pull-requests: write

jobs:
  security:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: axoxweb/websentry-action@v1
        with:
          url: ${{ github.event.deployment_status.environment_url }}
          api-key: ${{ secrets.WEBSENTRY_API_KEY }}
```

Or scan a fixed URL on a schedule or on demand:

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: '0 7 * * 1'

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: axoxweb/websentry-action@v1
        with:
          url: https://example.com
          api-key: ${{ secrets.WEBSENTRY_API_KEY }}
          minimum-score: 80
```

Get a key from your [WebSentry dashboard](https://websentry.dev/dashboard) and store it as a repository secret.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `url` | yes | | The deployed URL to scan. A bare domain works; `https://` is assumed. |
| `api-key` | yes | | WebSentry CI key or API key. Always pass this from a secret. |
| `minimum-score` | no | | Fail when the score is below this number, 0 to 100. |
| `fail-on` | no | see below | `none`, `regression`, `score`, or `both`. |
| `comment` | no | `true` | Post or update a comment on the pull request. |
| `github-token` | no | `${{ github.token }}` | Token used for the comment. Needs `pull-requests: write`. |
| `api-url` | no | `https://websentry.dev` | Override the WebSentry base URL. |

`fail-on` left empty means `both` when you set a `minimum-score`, and `regression` otherwise. Set it explicitly to be unambiguous:

- `regression`: fail only when this deploy introduced new findings.
- `score`: fail only when the score falls below `minimum-score`.
- `both`: either condition fails the build.
- `none`: never fail, just report. Useful while you are getting a baseline.

## Outputs

| Output | Description |
| --- | --- |
| `score` | Security score out of 100. |
| `grade` | Letter grade, for example `A`. |
| `scan-id` | Identifier of the scan that ran. |
| `report-url` | Link to the full report. |
| `new-findings` | Checks that regressed since the previous scan. |
| `fixed-findings` | Checks fixed since the previous scan. |

Use them in later steps:

```yaml
      - uses: axoxweb/websentry-action@v1
        id: websentry
        with:
          url: https://example.com
          api-key: ${{ secrets.WEBSENTRY_API_KEY }}
          fail-on: none
      - run: echo "Scored ${{ steps.websentry.outputs.score }} with ${{ steps.websentry.outputs.new-findings }} new findings"
```

## Pull request comments

When the run belongs to a pull request, the action keeps a single comment up to date rather than adding one per commit. It finds the pull request from the event payload, or from the commit when the run came from a `deployment_status` event.

Two cases where the comment is skipped, both by design and neither fails the build:

- **Pull requests from forks** receive a read only token, so no comment can be written.
- **Missing permissions**: add `permissions: pull-requests: write` to the workflow.

The job summary always carries the full result either way.

## Plans

Scanning, the score, the grade, and the `minimum-score` gate work with any key.

Detailed results, meaning which checks regressed and the category breakdown, are part of the Pro and Agency plans. On a plan without them the action still scans and still gates on score; it says so in the job summary instead of failing.

## Notes

- A scan takes roughly 10 to 30 seconds and counts against your WebSentry monthly quota.
- Scanning the same URL twice within an hour returns the cached result, so a retried workflow does not re-scan the site.
- The action runs on `node20` and calls the public [`websentry-api`](https://www.npmjs.com/package/websentry-api) client, the same SDK you can use directly.

## License

MIT
