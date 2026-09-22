# LogicLearn

LogicLearn is a Salesforce Lightning video-training library. It supports nested folders, Salesforce Files video uploads, individual and profile-based assignments, email notifications, resume progress, completion tracking, and administration inside Lightning Experience.

## Included metadata

- Five Lightning Web Components for the library, player, administration, assignment management, and pending-training list
- Apex controller, notification service, queueable, trigger handler, and automated test class
- `Training_Video__c`, `Training_Folder__c`, and `Training_View__c` objects and fields
- Lightning tabs, layouts, record page, trigger, permission set, and custom labels
- A deployment manifest at `manifest/package.xml`

## Deploy

Authenticate a Salesforce org, then run:

```sh
sf project deploy start --manifest manifest/package.xml --target-org YOUR_ORG --test-level RunSpecifiedTests --tests TrainingVideoControllerTest
```

Assign the included permission set to users:

```sh
sf org assign permset --name Training_Library_Access --target-org YOUR_ORG
```

## Post-deployment setup

1. Create and activate an email template named `Training Video Assignment Notification`, or change the `Training_Notification_Template_Name` custom label to the template's name.
2. The template may use `[VIDEO_NAME]`, `[USER_NAME]`, `[LIBRARY_LINK]`, and `[VIDEO_LINK]` placeholders.
3. Adjust `Training_Max_Video_MB` if the default 150 MB upload limit is unsuitable.
4. Give training administrators create/edit access to the training objects. Regular users can use the included permission set.
5. Add the Training Library tab and optional components to the desired Lightning apps/pages.

Video files are stored as Salesforce Files. No video binaries or organization data are included in this repository.
