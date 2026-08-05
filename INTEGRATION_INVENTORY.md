# StayWhile Operations Platform — Integration Inventory

> Architecture-level inventory only. No logins, emails, MFA status, or credentials live here — see `SECURE_CONFIGURATION_CHECKLIST.md` for what needs to be collected (as placeholders) before each platform is wired in, and `N8N_DISCOVERY.md` for the n8n-specific deep dive. Methodology/structure is reusable across future client projects; the data in this file is StayWhile-specific and stays in this workspace only (per `CLAUDE.md`).

**Status:** In progress — built platform-by-platform through an interview with the StayWhile team.

---

## Platform Inventory

| Platform            | Category | Purpose | Department | Business-Critical | Primary Users | Status |
| ------------------- | -------- | ------- | ---------- | ----------------- | ------------- | ------ |
| _pending interview_ |          |         |            |                   |               |        |

Status values: **In Use** · **Planned** · **Not Used**

---

## Integration Health Matrix

| Platform            | Connected Today | API Available | OAuth Supported | Webhooks Supported | Status | Notes |
| ------------------- | --------------- | ------------- | --------------- | ------------------ | ------ | ----- |
| _pending interview_ |                 |               |                 |                    |        |       |

Status legend: ✅ Connected · 🟡 Planned · 🔴 Missing · ⚠️ Needs Verification

---

## Current Connected Systems (per platform)

For each platform, answered per connection it has (existing or planned):

- What platform(s) is it connected to?
- Native integration or custom-built?
- Routed through n8n, Zapier, Make, or another automation platform (or direct)?
- Uses webhooks? Uses APIs?
- Syncs automatically or manually?
- What data is exchanged?
- One-way or two-way?
- Currently working, or broken/unverified?
- Needs improvement or replacement?

Unconfirmed connections are marked **Needs Verification** rather than assumed. Account/credential details for any connection live in `SECURE_CONFIGURATION_CHECKLIST.md`, not here.

_pending interview_

---

## Dependency Map

Visual tree of every platform-to-platform connection (existing and planned), built as platforms are interviewed.

```text
_pending interview_
```

---

## Dashboard Goals (per platform)

For each platform: what data should sync into the StayWhile Operations dashboard, what actions should sync back out, what manual tasks this eliminates, and what automations it enables.

_pending interview_

---

## Platforms Covered

### Business Platforms

- [ ] OwnerRez
- [ ] Airbnb
- [ ] Slack
- [ ] Asana
- [ ] Notion
- [ ] Gmail / Google Workspace
- [ ] Google Voice

### Development Platforms

- [ ] GitHub
- [ ] Supabase
- [ ] Vercel
- [ ] Claude API
- [ ] n8n (see `N8N_DISCOVERY.md` for the deep dive)
- [ ] MCP Servers

### Smart Devices

- [ ] Yale
- [ ] August
- [ ] Nest
- [ ] Ecobee
- [ ] Honeywell
- [ ] Cielo

### Additional platforms discovered during the interview

_None yet._

---

## Implementation Notes

_Captured per platform as the interview proceeds — sequencing considerations, dependencies between integrations, anything that affects build order._

---

## Missing Information / Blockers (architecture-level)

Gaps that block _design_ decisions (not credential collection — see `SECURE_CONFIGURATION_CHECKLIST.md` for that). E.g. "don't know if OwnerRez's webhook payload includes X," "unclear whether Airbnb's API allows Y."

- _TBD_

---

## Interview Log

Most recent first.

- _(starting now)_
