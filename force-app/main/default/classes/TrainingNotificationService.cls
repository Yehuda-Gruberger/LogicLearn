/**
 * @description Sends the training-assignment email to assigned users of one or more videos and
 * stamps Notified_At__c on their Training_View__c rows. Used both at assignment time (restricted
 * to the users just assigned) and by the record-level "Send Notification" flow (all assigned).
 *
 * The email uses a Classic/Lightning email template looked up by DeveloperName (TEMPLATE_NAME),
 * rendered per recipient so {!Training_Video__c.*} (or {{Related.*}}) merge fields resolve via
 * the video passed as whatId. If the template is missing or the send fails, nothing is stamped.
 */
public with sharing class TrainingNotificationService {
    // Temporary QA routing: keep test notifications for this learner out of their real inbox.
    @TestVisible private static final String QA_REDIRECT_USER = 'Shalom Eisenbach';
    @TestVisible private static final String QA_REDIRECT_EMAIL = 'dev@logicfold.com';
    // The email template's NAME (not API name), from a Custom Label so admins can point it at
    // whatever template they built — Lightning builder auto-generates an unhelpful API name.
    @TestVisible
    private static String templateName = Label.Training_Notification_Template_Name;

    /**
     * @param videoIds        videos whose assigned users to email
     * @param restrictUserIds if non-null, only these users are emailed (e.g. the ones just
     *                        assigned); if null, every assigned user is emailed
     * @return the number of users actually emailed
     */
    public static Integer notify(Set<Id> videoIds, Set<Id> restrictUserIds) {
        if (videoIds == null || videoIds.isEmpty()) {
            return 0;
        }
        List<EmailTemplate> tpls = [
            SELECT Id FROM EmailTemplate
            WHERE Name = :templateName AND IsActive = TRUE
            ORDER BY LastModifiedDate DESC
            LIMIT 1
        ];
        if (tpls.isEmpty()) {
            System.debug('TrainingNotify: active email template not found by Name: ' + templateName);
            return 0;
        }
        Id templateId = tpls[0].Id;
        String libraryUrl = buildLibraryUrl();

        List<Messaging.SingleEmailMessage> msgs = new List<Messaging.SingleEmailMessage>();
        List<Training_View__c> stamped = new List<Training_View__c>();
        // Only ever email assigned users who haven't been notified yet — one notification per
        // user per video. Re-assigning (e.g. a profile that includes already-notified people)
        // never re-spams them; only the newly added, un-notified users get the email.
        for (Training_View__c v : [
            SELECT Id, User__c, User__r.Name, User__r.Email, Training_Video__c, Training_Video__r.Name
            FROM Training_View__c
            WHERE Training_Video__c IN :videoIds
            AND Assigned__c = TRUE
            AND Notified_At__c = null
            AND User__r.IsActive = TRUE
            AND User__r.Email != null
        ]) {
            if (restrictUserIds != null && !restrictUserIds.contains(v.User__c)) {
                continue;
            }
            try {
                Messaging.SingleEmailMessage msg = Messaging.renderStoredEmailTemplate(
                    templateId,
                    v.User__c,
                    v.Training_Video__c
                );
                // Inject values ourselves via literal tokens, so the template needs no
                // Related-Entity merge fields (which custom objects don't reliably expose).
                // [VIDEO_LINK] deep-links straight to this video in the library.
                String videoLink = libraryUrl + '?c__videoId=' + v.Training_Video__c;
                applyTokens(msg, v.Training_Video__r.Name, v.User__r.Name, libraryUrl, videoLink);
                msg.setTreatTargetObjectAsRecipient(false);
                msg.setToAddresses(new List<String>{recipientEmail(v.User__r.Name, v.User__r.Email)});
                msg.setSaveAsActivity(false);
                msgs.add(msg);
                stamped.add(new Training_View__c(Id = v.Id, Notified_At__c = System.now()));
            } catch (Exception e) {
                System.debug('TrainingNotify: render failed for user ' + v.User__c + ': ' + e.getMessage());
            }
        }

        if (msgs.isEmpty()) {
            return 0;
        }
        List<Messaging.SendEmailResult> results;
        try {
            results = Messaging.sendEmail(msgs, false);
        } catch (Exception e) {
            System.debug('TrainingNotify: sendEmail threw: ' + e.getMessage());
            return 0;
        }
        // Only stamp Notified_At__c for messages that ACTUALLY sent. With allOrNone=false a
        // blocked send (e.g. sandbox deliverability off) is reported as a failed result rather
        // than thrown, so we must check each result — otherwise "Notified" is a false positive.
        List<Training_View__c> confirmed = new List<Training_View__c>();
        for (Integer i = 0; i < results.size(); i++) {
            if (results[i].isSuccess()) {
                confirmed.add(stamped[i]);
            } else if (!results[i].getErrors().isEmpty()) {
                System.debug('TrainingNotify: email not sent: ' + results[i].getErrors()[0].getMessage());
            }
        }
        if (!confirmed.isEmpty()) {
            update confirmed;
        }
        return confirmed.size();
    }

    /** Sends an explicit admin-requested email to a live LogicLearn audience. */
    public static Integer notifyAudience(Id videoId, String notificationType) {
        return notifyAudience(videoId, notificationType, null);
    }

    public static Integer notifyAudience(Id videoId, String notificationType, String templateOverride) {
        if (videoId == null) return 0;
        String type = String.isBlank(notificationType) ? 'Assignment' : notificationType;
        String purpose = new Set<String>{'New Video','First Publish','Update'}.contains(type) ? 'Visibility' : 'Required';
        Set<Id> recipientIds = LogicLearnAudienceService.usersForVideo(videoId, purpose);
        if (recipientIds.isEmpty()) return 0;

        if (type == 'Reminder') {
            for (Training_View__c completed : [
                SELECT User__c FROM Training_View__c
                WHERE Training_Video__c = :videoId AND User__c IN :recipientIds AND Status__c = 'Completed'
            ]) recipientIds.remove(completed.User__c);
        }
        if (recipientIds.isEmpty()) return 0;

        LogicLearn_Settings__c settings = LogicLearnAdminController.settingsRow();
        String selectedTemplate = String.isNotBlank(templateOverride) ? templateOverride :
            type == 'Reminder' ? settings.Reminder_Template_Name__c :
            type == 'Update' ? settings.Update_Email_Template__c :
            type == 'First Publish' || type == 'New Video' ? settings.First_Publish_Email_Template__c :
            settings.Assignment_Template_Name__c;
        List<EmailTemplate> templates = [
            SELECT Id FROM EmailTemplate
            WHERE (Name = :selectedTemplate OR DeveloperName = :selectedTemplate) AND IsActive = TRUE
            ORDER BY LastModifiedDate DESC LIMIT 1
        ];
        if (templates.isEmpty()) throw new AuraHandledException('Active email template not found: ' + selectedTemplate);

        Training_Video__c video = [SELECT Id, Name FROM Training_Video__c WHERE Id = :videoId LIMIT 1];
        List<User> users = [SELECT Id, Name, Email FROM User WHERE Id IN :recipientIds AND IsActive = TRUE AND Email != null];
        String libraryUrl = buildLibraryUrl();
        String videoLink = libraryUrl + '?c__videoId=' + video.Id;
        List<Messaging.SingleEmailMessage> messages = new List<Messaging.SingleEmailMessage>();
        List<User> messageUsers = new List<User>();
        List<Training_Notification_Log__c> logs = new List<Training_Notification_Log__c>();
        for (User user : users) {
            try {
                Messaging.SingleEmailMessage message = Messaging.renderStoredEmailTemplate(templates[0].Id, user.Id, video.Id);
                applyTokens(message, video.Name, user.Name, libraryUrl, videoLink);
                message.setTreatTargetObjectAsRecipient(false);
                message.setToAddresses(new List<String>{recipientEmail(user.Name, user.Email)});
                message.setSaveAsActivity(false);
                messages.add(message);
                messageUsers.add(user);
            } catch (Exception error) {
                logs.add(new Training_Notification_Log__c(
                    Training_Video__c = videoId, User__c = user.Id, Notification_Type__c = type,
                    Status__c = 'Failed', Sent_At__c = System.now(), Error__c = error.getMessage()
                ));
            }
        }

        Integer sent = 0;
        for (Integer start = 0; start < messages.size(); start += 10) {
            Integer finish = Math.min(start + 10, messages.size());
            List<Messaging.SingleEmailMessage> batch = new List<Messaging.SingleEmailMessage>();
            for (Integer i = start; i < finish; i++) batch.add(messages[i]);
            try {
                List<Messaging.SendEmailResult> results = Messaging.sendEmail(batch, false);
                for (Integer offset = 0; offset < results.size(); offset++) {
                    Integer index = start + offset;
                    Boolean success = results[offset].isSuccess();
                    String errorText = success || results[offset].getErrors().isEmpty() ? null : results[offset].getErrors()[0].getMessage();
                    logs.add(new Training_Notification_Log__c(
                        Training_Video__c = videoId, User__c = messageUsers[index].Id, Notification_Type__c = type,
                        Status__c = success ? 'Sent' : 'Failed', Sent_At__c = System.now(), Error__c = errorText
                    ));
                    if (success) sent++;
                }
            } catch (Exception error) {
                for (Integer i = start; i < finish; i++) logs.add(new Training_Notification_Log__c(
                    Training_Video__c = videoId, User__c = messageUsers[i].Id, Notification_Type__c = type,
                    Status__c = 'Failed', Sent_At__c = System.now(), Error__c = error.getMessage()
                ));
            }
        }
        // A reporting-log problem must never turn a successfully saved tutorial or sent email
        // into a false failure in the editor.
        if (!logs.isEmpty()) Database.insert(logs, false);
        return sent;
    }

    /** Replaces the literal placeholder tokens in the rendered subject/body with real values. */
    private static void applyTokens(
        Messaging.SingleEmailMessage msg,
        String videoName,
        String userName,
        String libraryUrl,
        String videoLink
    ) {
        Map<String, String> tokens = new Map<String, String>{
            '[VIDEO_NAME]' => videoName == null ? '' : videoName,
            '[USER_NAME]' => userName == null ? '' : userName,
            '[LIBRARY_LINK]' => libraryUrl == null ? '' : libraryUrl,
            '[VIDEO_LINK]' => videoLink == null ? '' : videoLink
        };
        msg.setSubject(replaceTokens(msg.getSubject(), tokens));
        if (msg.getHtmlBody() != null) {
            msg.setHtmlBody(replaceTokens(msg.getHtmlBody(), tokens));
        }
        if (msg.getPlainTextBody() != null) {
            msg.setPlainTextBody(replaceTokens(msg.getPlainTextBody(), tokens));
        }
    }

    private static String replaceTokens(String text, Map<String, String> tokens) {
        if (String.isBlank(text)) {
            return text;
        }
        for (String key : tokens.keySet()) {
            text = text.replace(key, tokens.get(key));
        }
        return text;
    }

    @TestVisible
    private static String recipientEmail(String userName, String originalEmail) {
        return QA_REDIRECT_USER.equalsIgnoreCase(userName) ? QA_REDIRECT_EMAIL : originalEmail;
    }

    /** Absolute URL to the Training Library tab, correct for the current org/sandbox. */
    private static String buildLibraryUrl() {
        String base = URL.getOrgDomainUrl().toExternalForm();
        // The Lightning nav path lives on the lightning.force.com host, not my.salesforce.com.
        String lightningBase = base.replace('.my.salesforce.com', '.lightning.force.com');
        return lightningBase + '/lightning/n/Training_Library';
    }
}

