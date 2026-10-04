# AI Lab progress

Status: first version built (web, super admin only).

Done: schema (migration 0026), research pipeline with $5 monthly cap and reuse, OpenAI and Claude adapters, GitHub workflows (prod monthly, staging manual), research API, AI picks, holdings review, tests.

Open items:
- First staging run must measure real cost per company before the prod schedule is trusted.
- Set `GITHUB_DISPATCH_TOKEN` for tab-triggered runs; set `AI_LAB_ENABLED` / cap vars if different from defaults.
- Scorecard / track-record job and panel (picks vs KSE-100 after 1/3/6 months).
- Admin run log; mobile app support.
