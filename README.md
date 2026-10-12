# WebSentry Security Scan

A GitHub Action that checks your site's security after it deploys, and tells you in the pull request if the deploy made anything worse.

It uses [WebSentry](https://websentry.dev) to scan the live page: headers, TLS, cookies, content security policy, and the rest. You get a score out of 100 and a letter grade.

**By default it only fails your build when a deploy breaks something new.** If your site has had the same weak setting for a year, every build still passes; the day a change removes a security header, the build goes red. That way the check stays useful instead of becoming the one everybody ignores.

## Quick start

Check every deploy, including preview deploys from Vercel, Netlify, and Cloudflare Pages:

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

Or check one address on a schedule, and require a minimum score:

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

## Getting a key

Open your [WebSentry dashboard](https://websentry.dev/dashboard), go to the API tab, and create a key. Then add it to your repository under **Settings → Secrets and variables → Actions** as `WEBSENTRY_API_KEY`.

**Every plan can do this, including the free one.** Free accounts get a CI key, which starts scans and nothing else. Paid plans get a full key that also reads results as JSON and manages monitors.

Checks count against the scans included in your plan, whichever key you use.

## Settings

| Setting | Required | Default | What it does |
| --- | --- | --- | --- |
| `url` | yes | | The address to check. A bare domain is fine, `https://` is added for you. |
| `api-key` | yes | | Your WebSentry key. Always pass it from a secret, never type it in the file. |
| `minimum-score` | no | | Fail if the score drops below this number, 0 to 100. |
| `fail-on` | no | see below | When to fail the build. |
| `comment` | no | `true` | Keep a comment on the pull request with the result. |
| `github-token` | no | `${{ github.token }}` | Used to write that comment. |
| `api-url` | no | `https://websentry.dev` | Point at a different WebSentry install. |

### When it fails the build

- `regression`: only when this deploy broke something that worked before. This is the default.
- `score`: only when the score is under your `minimum-score`.
- `both`: either of the above.
- `none`: never fail, just report. Good for the first week while you see what it finds.

Leave `fail-on` out and it picks for you: `both` if you set a `minimum-score`, otherwise `regression`.

## What you get back

| Value | What it is |
| --- | --- |
| `score` | The score out of 100. |
| `grade` | The letter grade, such as `A`. |
| `scan-id` | The id of this check. |
| `report-url` | Link to the full report. |
| `new-findings` | How many things this deploy broke. |
| `fixed-findings` | How many things this deploy fixed. |

Use them in later steps:

```yaml
      - uses: axoxweb/websentry-action@v1
        id: websentry
        with:
          url: https://example.com
          api-key: ${{ secrets.WEBSENTRY_API_KEY }}
          fail-on: none
      - run: echo "Scored ${{ steps.websentry.outputs.score }}, ${{ steps.websentry.outputs.new-findings }} new problems"
```

## The pull request comment

When the run belongs to a pull request, you get one comment that updates itself. A pull request with forty commits has one current comment, not forty old ones.

Two times the comment is skipped. Neither one fails your build, and the result is always in the job summary either way:

- **Pull requests from someone else's fork.** GitHub only gives those runs read access, so nothing can write a comment.
- **Missing permission.** Add `permissions: pull-requests: write` to your workflow.

## Good to know

- A check takes about 10 to 30 seconds and counts as one scan on your WebSentry plan.
- Checking the same address twice within an hour returns the earlier result instead of scanning again.
- Seeing which exact checks changed comes with Pro and Agency. On the free plan the action still reports the score and grade, and says so in the summary.
- Runs on `node20` and uses the public [`websentry-api`](https://www.npmjs.com/package/websentry-api) client, the same one you can call yourself.

## License

MIT
