# LogicLearn

LogicLearn is a general-purpose training platform built natively for Salesforce Lightning. Administrators create a complete tutorial from one screen, and learners use a focused library with resume progress and completion tracking.

## Features

- Salesforce Files video playback with progress, resume, configurable completion thresholds, and optional skip prevention
- HTTPS external-video links with a clear tracking notice and irreversible manual completion
- Separate live audiences for visibility, required completion, and notifications
- Audiences made from individual users, Salesforce Profiles, or reusable LogicLearn groups
- Nested LogicLearn groups whose profile and group membership is resolved live
- Optional per-tutorial due dates and administrator-only overdue reporting
- Explicit Salesforce in-app notifications, email notifications, or both
- Included assignment and reminder email templates
- Administrator tracking for opens, first/last view, watched percentage, completion, and completion method
- CSV tracking export, manual reminders, global settings, and first-run sample drafts
- Dedicated LogicLearn Lightning app, learner permission set, and administrator permission set
- Server-side administration enforcement through the `LogicLearn_Admin` custom permission

## Deploy

```sh
sf project deploy start --manifest manifest/package.xml --target-org YOUR_ORG --test-level RunLocalTests
sf org assign permset --name LogicLearn_Administrator --target-org YOUR_ORG
```

Assign learner access to internal Salesforce users who should use the library:

```sh
sf org assign permset --name Training_Library_Access --target-org YOUR_ORG
```

Open the LogicLearn app after deployment. The first administrator visit creates global settings and four editable sample drafts. Email template names, the default completion threshold, and skip prevention can be changed on the Admin > Settings screen.

Video files remain in Salesforce Files. The default upload limit is 150 MB; external links must use HTTPS.

## Managed 1GP preparation

The managed 1GP packaging-org setup, readiness checks, and upload commands are documented in [docs/PACKAGING.md](docs/PACKAGING.md). The registered namespace is `logiclearn`, and the existing package ID is recorded in `config/package1.json`.

Email templates and email folders are intentionally not package components. LogicLearn identifies subscriber-managed templates through its template-tagging configuration.
