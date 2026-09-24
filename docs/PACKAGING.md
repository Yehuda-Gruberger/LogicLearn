# LogicLearn managed 1GP

LogicLearn uses a first-generation managed package (managed 1GP). The separate LogicLearn repository is the source of truth, and the Developer Edition org authenticated as `LogicLearn` is the permanent packaging org.

## Current setup

- Namespace: `logiclearn`
- Package name: `LogicLearn`
- Package ID: `033hm00000057YjAAI`
- Packaging-org alias: `LogicLearn`
- Planned first version: `0.1`
- Uploaded versions: none as of September 23, 2026

These values are also recorded in `sfdx-project.json` and `config/package1.json`.

The package currently contains the application metadata selected by `manifest/package.xml`: Apex, the trigger, the app, custom objects and fields, labels, notification type, permission, tabs, FlexiPage, layouts, LWCs, and permission sets. Salesforce automatically included the nine custom-object layouts.

## Package boundary

Email templates and email folders are intentionally not package components.

- Do not add `LogicLearn_Assignment` or `LogicLearn_Reminder` to the package.
- Do not add `unfiled$public` or `LogicLearn_Email_Templates` to the package.
- The packaging-org copies are unpackaged configuration used to test the template-tagging behavior.
- A subscriber must create/configure the LogicLearn template tag and select or create its own templates during setup.

The package manifest deliberately has no `EmailTemplate` type. `scripts/Test-PackageReadiness.ps1` treats adding that type as a blocking error.

The current initialization logic calls `ensureDefaultEmailTemplates()` before `moveConfiguredEmailTemplates()`. If same-named templates already exist outside the LogicLearn tag, initialization can fail with `DUPLICATE_DEVELOPER_NAME`. Fix or test that ordering before the first beta.

## Namespace rules

Keep source API names unprefixed. Do not rename source files or manually add `logiclearn__` to Apex references, LWC imports, custom objects, fields, tabs, permission sets, or manifest members. Salesforce applies the namespace in installed subscriber orgs.

Literal strings that construct URLs, page references, or API names are different. The readiness script reports the remaining namespace-sensitive literals that must be tested in a clean installed org.

## Step by step while finishing development

1. Work only in the separate LogicLearn repository.

2. Run the local readiness check:

   ```powershell
   ./scripts/Test-PackageReadiness.ps1
   ```

3. Validate the exact source snapshot against the packaging org:

   ```powershell
   sf project deploy validate `
     --source-dir force-app `
     --target-org LogicLearn `
     --test-level RunLocalTests `
     --wait 30
   ```

4. Deploy the tested snapshot to the packaging org:

   ```powershell
   sf project deploy start `
     --source-dir force-app `
     --target-org LogicLearn `
     --test-level RunLocalTests `
     --wait 30
   ```

   A normal source deployment updates the org. It does not by itself add unpackaged email configuration to the managed package.

5. If development introduced a new packageable component, run the package-component script:

   ```powershell
   ./scripts/Add-PackageComponents.ps1
   ```

   The script converts all current application metadata except the `email` and `settings` directories, associates it with the existing named package, retrieves the named package, and fails if an `EmailTemplate` type appears.

6. In Setup -> Package Manager -> LogicLearn -> Components, review the component list and automatically added dependencies. Confirm that no email template or email folder is present.

7. Retrieve the named package for an independent membership check:

   ```powershell
   $verifyDir = Join-Path $env:TEMP ("logiclearn-package-verify-" + [guid]::NewGuid().ToString("N"))

   sf project retrieve start `
     --package-name LogicLearn `
     --target-org LogicLearn `
     --target-metadata-dir $verifyDir `
     --unzip `
     --wait 30
   ```

   Inspect the retrieved `LogicLearn/package.xml`. It must contain the intended application components and no `EmailTemplate` type.

8. Commit the exact tested snapshot. Do not upload a beta from an uncommitted or partially deployed worktree.

Managed 1GP does not use a Dev Hub, `packageAliases`, a `0Ho` package ID, `0.1.0.NEXT`, or `sf package version promote`.

## Beta upload

Do this only after the final-touch work, namespace fixes, clean-install test, and email-tag setup all pass.

```powershell
sf package1 version create `
  --package-id 033hm00000057YjAAI `
  --name "LogicLearn 0.1 Beta" `
  --version 0.1 `
  --description "Initial LogicLearn beta" `
  --target-org LogicLearn `
  --wait 30
```

List versions and obtain the generated `04t` installable version ID:

```powershell
sf package1 version list `
  --package-id 033hm00000057YjAAI `
  --target-org LogicLearn
```

Install the beta in a separate Developer Edition, scratch, or sandbox org. Do not use the packaging org as the installation test.

```powershell
sf package install `
  --package 04t_REPLACE_WITH_BETA_VERSION_ID `
  --target-org LogicLearnBetaTest `
  --wait 30 `
  --publish-wait 10 `
  --no-prompt
```

## Release gate

- The beta installs, upgrades, and uninstalls in a clean test org.
- The clean org has no dependency on unpackaged packaging-org metadata.
- Template tagging and subscriber-managed templates work without packaged email components.
- All Apex tests pass and package coverage satisfies Salesforce requirements.
- Both permission sets assign successfully.
- App navigation, record links, emails, and notifications work with the namespace.
- Admin, learner, assignment, completion, reminder, and CSV workflows pass.
- The package contains no secrets, org IDs, user IDs, customer URLs, profiles, or production data.
- The retrieved named-package manifest matches the intended package boundary.
- The uploaded Git commit is tagged or otherwise recorded.

## Managed release

A Managed - Released upload locks important component attributes. Run it only after the beta passes the release gate.

```powershell
sf package1 version create `
  --package-id 033hm00000057YjAAI `
  --name "LogicLearn 0.1" `
  --version 0.1 `
  --description "Initial LogicLearn release" `
  --managed-released `
  --target-org LogicLearn `
  --wait 30
```

## Current namespace-sensitive audit

Resolve and test the readiness-script warnings before beta, including literal references to `Training_Library` and `Training_Video__c` that Salesforce cannot automatically namespace inside arbitrary strings.

## Official references

- [Build and deploy a 1GP package with Salesforce CLI](https://developer.salesforce.com/docs/platform/pkg1-dev/guide/sfdx-dev-build-man-pack-deploy.html)
- [Create and upload a first-generation managed package](https://developer.salesforce.com/docs/platform/pkg1-dev/guide/uploading-packages.html)
- [Create a 1GP managed package version](https://developer.salesforce.com/docs/platform/pkg1-dev/guide/sfdx-dev-build-man-pack-create.html)
- [Salesforce CLI: package1 version create](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_package1_version_create.html)
