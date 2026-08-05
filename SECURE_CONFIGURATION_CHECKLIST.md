# Secure Configuration Checklist

> This file tracks **what** needs to be collected before/during implementation for each platform — never the actual values. Real credentials, emails, and secrets belong in a password manager or secrets vault (e.g. the app's own `.env`, which is gitignored — see `.env.example` for the shape). Replace placeholders in-place during deployment; never commit real values over them.

Placeholder tokens used below: `<TO_BE_PROVIDED>` (a human needs to supply this), `<TO_BE_CONFIGURED>` (setup work needed, not just a lookup), `<VERIFY_WITH_CLIENT>` (assumption made, needs StayWhile confirmation).

For each platform, the following are needed before it can be wired into the platform:

- Login email — `<TO_BE_PROVIDED>`
- Account owner — `<TO_BE_PROVIDED>`
- Administrator(s) — `<TO_BE_PROVIDED>`
- Shared vs. individual account — `<VERIFY_WITH_CLIENT>`
- OAuth required? — `<VERIFY_WITH_CLIENT>`
- API credentials required? — `<VERIFY_WITH_CLIENT>`
- Environment variables required? — `<TO_BE_CONFIGURED>` (see `.env.example` once the integration's real var names are known)

## Business Platforms

- [ ] OwnerRez
- [ ] Airbnb
- [ ] Slack
- [ ] Asana
- [ ] Notion
- [ ] Gmail / Google Workspace
- [ ] Google Voice

## Development Platforms

- [ ] GitHub
- [ ] Supabase
- [ ] Vercel
- [ ] Claude API
- [ ] n8n
- [ ] MCP Servers

## Smart Devices

- [ ] Yale
- [ ] August
- [ ] Nest
- [ ] Ecobee
- [ ] Honeywell
- [ ] Cielo

Each checkbox above expands to the 7-item list once that platform's implementation work starts — see `INTEGRATION_INVENTORY.md` for the architecture-level status of each.
