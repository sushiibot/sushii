# Deployment approvals

A private approval backend and a separate public webhook relay. Source lives beside
sushii-worker; deployment configuration lives in sushii-ansible.

GitHub owns the production environment gate. The owner links their GitHub account,
reviews a specific run in Discord, then confirms it. The backend uses that user's
expiring token to review the existing gate. GitHub's reviewer rules still apply.
The installation token is read-only and cannot approve a deployment.

## Components

- `APPROVAL_MODE=relay`: accepts only signed GitHub events at `/github/webhook`.
  Persists the raw signed delivery before returning 202; retries private delivery.
  Has no GitHub private key, OAuth credentials, bot token or token encryption key.
- `APPROVAL_MODE=backend`: private OAuth routes, authenticated bot API and SSE.
  Stores encrypted user tokens, pending releases, confirmations and message IDs in
  SQLite. Revalidates repository ID, branch head, workflow, attempt, environment
  and current reviewer eligibility before submitting a decision.
- `sushii-worker/src/features/deployment-approvals`: owner-only buttons and Discord
  publishing. Only active deployment cluster zero consumes events. Other clusters
  handle interactions. Neither bot nor relay receives GitHub user tokens.

There is no GitHub polling. Timers retry persisted deliveries and reconnect the
private stream. A missed event at GitHub still needs webhook redelivery. GitHub
[does not automatically retry failed deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries).

## Run and test

```sh
cd packages/deploy-approval
bun install --frozen-lockfile
bun run typecheck
bun test
```

The Dockerfile uses the repository root as build context. Runtime code uses only Bun
builtins. Both processes require `DATABASE_PATH`; keep databases on separate durable
volumes. Secrets accept either `NAME` or `NAME_FILE`. Prefer encrypted file mounts.
See `src/index.ts` for the complete startup contract and the Ansible runbook for setup.

Targets are a JSON array with `repository`, `repositoryId`, `environment`,
`environmentId`, `workflow`, `branch`, `releaseTarget`, `statusActorId`, `channelId`
and `label`. Ansible renders these from the deployment registry. Do not maintain a
second editable copy of its repository or release policy.

## Behavior and limits

One pending message per repository/environment is updated for newer eligible runs.
After a decision, the card is frozen and a new run gets a new card. Thread status is
updated in place. Success requires the trusted app's exact run/attempt host receipt;
a successful workflow alone is insufficient.

Only first-attempt push runs at current branch head are supported, matching the
registry release protocol. Older runs and reruns remain visible in GitHub but cannot
be approved here. Main bot blue/green and non-registry releases are not configured
as initial targets. Their existing release mechanisms remain authoritative.

An ambiguous approval response or interrupted approval is never automatically
submitted again. Inspect GitHub and complete the review there if it remains pending.
Subsequent webhooks reconcile the card. The backend requires expiring GitHub user
tokens and a fixed HTTPS callback; the callback can be private on Tailscale.

`/health` reports queue counts. Monitor disk space and retry backlog. Neither public
Traefik nor private HTTPS proxies should log OAuth query strings or authorization
headers. A deleted Discord message requires operator repair; failures are isolated
so other services continue. Keep backend database and encryption key backups
separate, and preserve both SQLite databases across upgrades. Do not run multiple
backend instances against separate databases.

## API references

- [Deployment review events](https://docs.github.com/en/webhooks/webhook-events-and-payloads#deployment_review)
- [GitHub App user tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [Review pending deployments](https://docs.github.com/en/rest/actions/workflow-runs#review-pending-deployments-for-a-workflow-run)
- [Validate webhook signatures](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

## Linked account and release comparisons

The owner may link any GitHub account through the browser-bound OAuth flow.
The returned numeric GitHub identity is encrypted with its tokens under the Discord
owner ID. Refresh and revocation use that stored identity. GitHub still decides
whether the linked user may review each environment; linking grants no reviewer role.

Cards compare the last observed deployed source with the candidate source. At migration,
`initialDeployedSha` in a target may seed a full commit SHA verified from its running
production image. This is a one-time bootstrap, not a desired version pin. It never
overwrites stored deployment history on restart. Later exact trusted host receipts
advance the stored baseline per repository/environment and refresh pending cards.
Older receipts cannot regress it. Approved cards retain the comparison they showed.
If no baseline is recorded, cards say so rather than using the previous CI run.
Operator rollbacks outside this release protocol require reconciling the stored baseline.
