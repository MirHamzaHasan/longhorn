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

## Required status checks

Not in the ruleset yet, on purpose. `verify.yml` has passed on a pull request but not yet on `main`, and
requiring it before then would block merges. After it first passes on `main`, add
its eight jobs as required checks. That work is `tasks/task004-hosted-ci.md`.

## Check made before going public

On 31 October 2026 all branches, the files then pending, and the text of every pull request
were pattern-scanned for keys, tokens, private keys, credentials in connection strings,
personal paths and private email addresses. Only test fixtures matched. That is a pattern
scan, not a guarantee.
