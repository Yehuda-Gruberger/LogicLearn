# LogicLearn

LogicLearn is a training and knowledge platform built natively on Salesforce Lightning. It gives administrators one place to create, assign, publish, and track tutorials while learners get a focused library that remembers their progress.

> **Project status:** Active development. The Salesforce managed 1GP package is being prepared; no installable package version has been published yet.

## What LogicLearn provides

### For learners

- A searchable training library organized by folders and categories
- Video tutorials stored in Salesforce Files
- Page-based document tutorials
- HTTPS links to externally hosted content
- Resume progress, completion tracking, and due dates
- A dedicated view of assigned and incomplete training
- Automatic completion thresholds with optional skip prevention
- Explicit manual completion for external content

### For administrators

- A guided tutorial editor for drafting and publishing content
- Separate audiences for visibility, required completion, and notifications
- Audience targeting by user, Salesforce Profile, or reusable LogicLearn group
- Nested groups with live membership resolution
- In-app notifications, email notifications, or both
- Configurable assignment, reminder, publish, and update messages
- Completion reporting, overdue reporting, manual reminders, and CSV export
- Global defaults for progress rules and document-reading behavior
- Server-side authorization through the `LogicLearn_Admin` custom permission

## Salesforce components

LogicLearn is implemented entirely with Salesforce metadata:

- Lightning Web Components for the learner library, player, document reader, tutorial editor, settings, groups, and reporting
- Apex controllers and services for content access, audience resolution, progress tracking, and notifications
- Custom objects for tutorials, tutorial pages, folders, categories, audiences, groups, assignments, progress, settings, and notification logs
- A dedicated Lightning app plus administrator and learner permission sets
- Salesforce Files for uploaded video content

The project uses Salesforce API version `64.0` and the registered namespace `logiclearn`.

## Prerequisites

- A Salesforce org where you can deploy metadata and Apex
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`)
- An account allowed to assign permission sets
- Git

No Node.js build step or third-party runtime package is required.

## Set up a development org

Clone the repository and enter the project directory:

```sh
git clone https://github.com/Yehuda-Gruberger/LogicLearn.git
cd LogicLearn
```

Authenticate a development org. The alias below is only an example; do not use the permanent packaging org for ordinary feature development.

```sh
sf org login web --alias LogicLearnDev
```

Deploy the application and run all local Apex tests:

```sh
sf project deploy start \
  --source-dir force-app \
  --target-org LogicLearnDev \
  --test-level RunLocalTests \
  --wait 30
```

Assign administrator access to the people who configure and manage LogicLearn:

```sh
sf org assign permset \
  --name LogicLearn_Administrator \
  --target-org LogicLearnDev
```

Assign learner access to each internal Salesforce user who needs the training library:

```sh
sf org assign permset \
  --name Training_Library_Access \
  --target-org LogicLearnDev
```

Open the org and select **LogicLearn** from the App Launcher:

```sh
sf org open --target-org LogicLearnDev
```

On the first administrator visit, LogicLearn initializes its global settings and creates editable sample drafts. Review **Admin > Settings** before publishing content.

## Email-template boundary

Email templates and email folders are deliberately excluded from the managed package. Subscribers own and configure their templates through LogicLearn's template-tagging setup.

The templates under `force-app/main/default/email` are development examples only. Do not add them—or their folders—to the managed package. The application can also use Salesforce in-app notifications without email.

## Development workflow

Before opening a pull request or handing off a release candidate:

1. Run the package-readiness checks:

   ```powershell
   ./scripts/Test-PackageReadiness.ps1
   ```

2. Validate the current source against your development org:

   ```powershell
   sf project deploy validate `
     --source-dir force-app `
     --target-org LogicLearnDev `
     --test-level RunLocalTests `
     --wait 30
   ```

3. Review the diff and commit the exact source snapshot that passed validation.

Keep source API names unprefixed. Salesforce applies `logiclearn__` when the managed package is installed; manually adding that prefix to Apex, metadata, or LWC schema imports will break source deployments.

## Repository layout

```text
LogicLearn/
|-- force-app/main/default/   Salesforce application source
|-- manifest/package.xml     Deployable application manifest
|-- config/package1.json     Managed 1GP package identity
|-- docs/PACKAGING.md        Packaging and release procedure
|-- scripts/                 Readiness and package-component scripts
|-- sfdx-project.json        Salesforce project configuration
`-- README.md
```

## Managed 1GP packaging

The packaging org is permanent and separate from ordinary development orgs. Before adding components or uploading a beta, follow [the managed 1GP packaging guide](docs/PACKAGING.md).

The guide records the namespace and package identity, explains the package boundary, and provides the exact readiness, component-association, beta-upload, clean-install, and managed-release steps.

Do not upload a beta from an uncommitted worktree, and do not create a managed-released version until the clean-org release gate has passed.

## Access model

- `LogicLearn_Administrator` grants application administration, content management, audience management, settings, notifications, and reporting.
- `Training_Library_Access` grants learners access to published content and their own progress records.
- `LogicLearn_Admin` is the custom permission enforced by server-side administration methods.

Permission sets are the supported access mechanism. Avoid granting equivalent access ad hoc through profiles because it is harder to audit and upgrade.

## Additional documentation

- [Managed 1GP packaging and release guide](docs/PACKAGING.md)
- [Salesforce CLI documentation](https://developer.salesforce.com/docs/platform/salesforce-cli)
- [Salesforce first-generation managed packaging guide](https://developer.salesforce.com/docs/platform/pkg1-dev/guide/)
