# Repository settings

Owner: the repository owner. Records what is configured on GitHub, so it can be checked
or rebuilt. Connects [contributing](../CONTRIBUTING.md), [security](../SECURITY.md),
[release verification](release-verification.md) and the [website](website.md).

## Files in the repository

| File | Purpose |
| --- | --- |
| `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` | How to take part and report problems |
| `.github/CODEOWNERS` | Requests the maintainer's review on pull requests |
| `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/` | What contributors are asked for |
| `.github/dependabot.yml` | Weekly updates, except the runtimes pinned for verification |
| `.github/rulesets/main.json` | Branch protection for `main` |

## Set on GitHub

Description, topics, squash and rebase merges only, branch deletion after merge,
Discussions on, wiki off, and Dependabot alerts and security updates.

## Applied when going public

Run on 31 October 2026 and confirmed with `gh api`. GitHub's free plan offers these only on
public repositories. The ruleset's first attempt returned "Repository has been locked" just
after the visibility change, and a retry worked. To rebuild them:

```sh
gh repo edit MirHamzaHasan/longhorn --visibility public --accept-visibility-change-consequences
gh api -X POST repos/MirHamzaHasan/longhorn/rulesets --input .github/rulesets/main.json
gh api -X PATCH repos/MirHamzaHasan/longhorn -F security_and_analysis[secret_scanning][status]=enabled -F security_and_analysis[secret_scanning_push_protection][status]=enabled
gh api -X PUT repos/MirHamzaHasan/longhorn/private-vulnerability-reporting
gh api -X POST repos/MirHamzaHasan/longhorn/pages -f build_type=workflow
gh repo edit MirHamzaHasan/longhorn --homepage https://mirhamzahasan.github.io/longhorn/
gh workflow run "Website" --repo MirHamzaHasan/longhorn
```

## What the ruleset does

- `main` can't be deleted or force-pushed, and its history stays linear.
- Changes need a pull request with one approval and resolved threads.
- Repository admins can bypass the pull request rule. A solo maintainer can't approve
  their own pull request, so without this every merge would be stuck.

## Who can open pull requests

Outside contributors can only open pull requests when `pull_request_creation_policy` is `all`.
It was found set to `collaborators_only` on 31 October 2026, which blocks them. Check or set it with:

```sh
gh api repos/MirHamzaHasan/longhorn --jq .pull_request_creation_policy
gh api -X PATCH repos/MirHamzaHasan/longhorn -f pull_request_creation_policy=all
```

This does not let anyone push to `main`. Only the maintainer can merge.

## Required status checks

Active since 31 October 2026, after all eight `verify.yml` jobs passed on `main` at `6977d4e`
(run 41215461094). A pull request needs `account-operations`, `browser`, `d1-storage`,
`independent-distribution`, `redis-cache`, `rust-reports`, `source-and-runtimes` and `telemetry`
to pass. Branches don't have to be up to date with `main`. An admin merge can still bypass the
checks. If you rename a job in `verify.yml`, update the ruleset too, or pull requests wait
for a check that never reports. `durable-delivery` and `worker-runtime` run on every pull
request but are not required yet, because they have not passed on `main`.

## Check made before going public

On 31 October 2026 all branches, the files then pending, and the text of every pull request
were pattern-scanned for keys, tokens, private keys, credentials in connection strings,
personal paths and private email addresses. Only test fixtures matched. That is a pattern
scan, not a guarantee.
