/** Administrative API for setup, groups, the tutorial wizard, settings, and tracking. */
public without sharing class LogicLearnAdminController {
    public class Option { @AuraEnabled public String value; @AuraEnabled public String label; @AuraEnabled public String meta; }
    public class Catalog { @AuraEnabled public List<Option> users; @AuraEnabled public List<Option> profiles; @AuraEnabled public List<Option> groups; @AuraEnabled public List<Option> folders; }
    public class SettingsDto { @AuraEnabled public Decimal completionThreshold; @AuraEnabled public Boolean preventSkipping; @AuraEnabled public String assignmentTemplateName; @AuraEnabled public String reminderTemplateName; }
    public class TutorialInput {
        @AuraEnabled public Id videoId { get; set; } @AuraEnabled public String title { get; set; } @AuraEnabled public String description { get; set; }
        @AuraEnabled public Id folderId { get; set; } @AuraEnabled public String category { get; set; } @AuraEnabled public String contentType { get; set; }
        @AuraEnabled public String externalUrl { get; set; } @AuraEnabled public Decimal completionThreshold { get; set; } @AuraEnabled public String skipPrevention { get; set; }
        @AuraEnabled public Date dueDate { get; set; } @AuraEnabled public String status { get; set; }
        @AuraEnabled public List<String> visibilityUsers { get; set; } @AuraEnabled public List<String> visibilityProfiles { get; set; } @AuraEnabled public List<String> visibilityGroups { get; set; }
        @AuraEnabled public List<String> requiredUsers { get; set; } @AuraEnabled public List<String> requiredProfiles { get; set; } @AuraEnabled public List<String> requiredGroups { get; set; }
        @AuraEnabled public List<String> notificationUsers { get; set; } @AuraEnabled public List<String> notificationProfiles { get; set; } @AuraEnabled public List<String> notificationGroups { get; set; }
        @AuraEnabled public String fileName { get; set; }
    }
    public class GroupInput { @AuraEnabled public Id groupId { get; set; } @AuraEnabled public String name { get; set; } @AuraEnabled public String description { get; set; } @AuraEnabled public List<String> users { get; set; } @AuraEnabled public List<String> profiles { get; set; } @AuraEnabled public List<String> groups { get; set; } }
    public class GroupRow { @AuraEnabled public Id id; @AuraEnabled public String name; @AuraEnabled public String description; @AuraEnabled public Integer memberCount; }
    public class TrackingRow { @AuraEnabled public Id userId; @AuraEnabled public String userName; @AuraEnabled public String status; @AuraEnabled public Decimal watchPercent; @AuraEnabled public Decimal viewCount; @AuraEnabled public Datetime firstViewedAt; @AuraEnabled public Datetime lastViewedAt; @AuraEnabled public Datetime completedAt; @AuraEnabled public String completionMethod; @AuraEnabled public Date dueDate; @AuraEnabled public Boolean overdue; }
    public class FolderInput { @AuraEnabled public Id folderId; @AuraEnabled public String name; @AuraEnabled public Id parentId; @AuraEnabled public Decimal sortOrder; @AuraEnabled public String icon; @AuraEnabled public String description; }

    @AuraEnabled
    public static void initializeLogicLearn() {
        LogicLearnAudienceService.requireAdmin();
        if ([SELECT COUNT() FROM LogicLearn_Settings__c] == 0) {
            insert new LogicLearn_Settings__c(Name='Global', Completion_Threshold__c=90, Prevent_Skipping__c=true,
                Assignment_Template_Name__c='LogicLearn Assignment', Reminder_Template_Name__c='LogicLearn Reminder');
        }
        if ([SELECT COUNT() FROM Training_Folder__c] == 0 && [SELECT COUNT() FROM Training_Video__c] == 0) {
            List<Training_Folder__c> folders = new List<Training_Folder__c>{
                new Training_Folder__c(Name='Getting Started', Description__c='Start here to learn how LogicLearn works.', Sort_Order__c=10),
                new Training_Folder__c(Name='Onboarding', Description__c='New-team-member training.', Sort_Order__c=20),
                new Training_Folder__c(Name='Compliance', Description__c='Required policy and security training.', Sort_Order__c=30),
                new Training_Folder__c(Name='Products', Description__c='Product knowledge and demonstrations.', Sort_Order__c=40)
            };
            insert folders;
            insert new List<Training_Video__c>{
                sample('Welcome to LogicLearn', folders[0].Id, 'Onboarding', 10), sample('Your First Week', folders[1].Id, 'Onboarding', 20),
                sample('Security Awareness', folders[2].Id, 'Compliance', 30), sample('Product Overview', folders[3].Id, 'Products', 40)
            };
        }
    }

    private static Training_Video__c sample(String title, Id folderId, String category, Decimal orderValue) {
        return new Training_Video__c(Name=title, Folder__c=folderId, Category__c=category, Sort_Order__c=orderValue,
            Status__c='Draft', Content_Type__c='Salesforce File', Skip_Prevention__c='Use Global Default',
            Description__c='Sample draft. Upload your own content and select an audience before publishing.');
    }

    @AuraEnabled
    public static SettingsDto getSettings() {
        LogicLearnAudienceService.requireAdmin();
        LogicLearn_Settings__c row = settingsRow();
        SettingsDto dto = new SettingsDto();
        dto.completionThreshold=row.Completion_Threshold__c; dto.preventSkipping=row.Prevent_Skipping__c;
        dto.assignmentTemplateName=row.Assignment_Template_Name__c; dto.reminderTemplateName=row.Reminder_Template_Name__c;
        return dto;
    }

    @AuraEnabled
    public static void saveSettings(SettingsDto input) {
        LogicLearnAudienceService.requireAdmin();
        if (input == null || input.completionThreshold == null || input.completionThreshold < 1 || input.completionThreshold > 100)
            throw new AuraHandledException('Completion threshold must be between 1 and 100.');
        LogicLearn_Settings__c row = settingsRow();
        row.Completion_Threshold__c=input.completionThreshold; row.Prevent_Skipping__c=input.preventSkipping;
        row.Assignment_Template_Name__c=input.assignmentTemplateName; row.Reminder_Template_Name__c=input.reminderTemplateName;
        upsert row;
    }

    @AuraEnabled(cacheable=true)
    public static List<Option> getEmailTemplates() {
        LogicLearnAudienceService.requireAdmin();
        List<Option> result = new List<Option>();
        for (EmailTemplate templateRow : [SELECT Name, Subject FROM EmailTemplate WHERE IsActive = TRUE ORDER BY Name LIMIT 500]) {
            Option item = new Option(); item.value = templateRow.Name; item.label = templateRow.Name; item.meta = templateRow.Subject;
            result.add(item);
        }
        return result;
    }

    @AuraEnabled
    public static Option createEmailTemplate(String name, String subject, String htmlBody) {
        LogicLearnAudienceService.requireAdmin();
        if (String.isBlank(name) || String.isBlank(subject) || String.isBlank(htmlBody))
            throw new AuraHandledException('Template name, subject, and message are required.');
        List<Folder> folders = [SELECT Id FROM Folder WHERE Type = 'Email' AND DeveloperName = 'unfiled$public' LIMIT 1];
        if (folders.isEmpty()) throw new AuraHandledException('The public email template folder is unavailable.');
        String developerName = name.trim().replaceAll('[^A-Za-z0-9_]', '_').replaceAll('_+', '_');
        if (String.isBlank(developerName)) developerName = 'LogicLearn_Template';
        if ([SELECT COUNT() FROM EmailTemplate WHERE DeveloperName = :developerName] > 0)
            developerName += '_' + String.valueOf(Datetime.now().getTime());
        EmailTemplate templateRow = new EmailTemplate(
            Name = name.trim(), DeveloperName = developerName, FolderId = folders[0].Id,
            TemplateType = 'custom', Subject = subject.trim(), HtmlValue = htmlBody,
            Body = htmlBody.replaceAll('<[^>]+>', ''), IsActive = true, Encoding = 'UTF-8'
        );
        insert templateRow;
        Option result = new Option(); result.value = templateRow.Name; result.label = templateRow.Name; result.meta = templateRow.Subject;
        return result;
    }

    public static LogicLearn_Settings__c settingsRow() {
        List<LogicLearn_Settings__c> rows=[SELECT Id,Name,Completion_Threshold__c,Prevent_Skipping__c,Assignment_Template_Name__c,Reminder_Template_Name__c FROM LogicLearn_Settings__c ORDER BY CreatedDate LIMIT 1];
        return rows.isEmpty() ? new LogicLearn_Settings__c(Name='Global',Completion_Threshold__c=90,Prevent_Skipping__c=true,Assignment_Template_Name__c='LogicLearn Assignment',Reminder_Template_Name__c='LogicLearn Reminder') : rows[0];
    }

    @AuraEnabled(cacheable=true)
    public static Catalog getCatalog() {
        LogicLearnAudienceService.requireAdmin(); Catalog c=new Catalog(); c.users=new List<Option>(); c.profiles=new List<Option>(); c.groups=new List<Option>(); c.folders=new List<Option>();
        for(User u:[SELECT Id,Name,Profile.Name FROM User WHERE IsActive=TRUE ORDER BY Name LIMIT 2000]) c.users.add(opt(u.Id,u.Name,u.Profile.Name));
        for(Profile p:[SELECT Id,Name FROM Profile ORDER BY Name]) c.profiles.add(opt(p.Id,p.Name,'Profile'));
        for(Training_Group__c g:[SELECT Id,Name,Description__c FROM Training_Group__c ORDER BY Name]) c.groups.add(opt(g.Id,g.Name,g.Description__c));
        for(Training_Folder__c f:[SELECT Id,Name,Parent_Folder__r.Name FROM Training_Folder__c ORDER BY Sort_Order__c,Name]) c.folders.add(opt(f.Id,f.Name,f.Parent_Folder__r==null?'Folder':f.Parent_Folder__r.Name));
        return c;
    }
    private static Option opt(Id value,String label,String meta){Option o=new Option();o.value=value;o.label=label;o.meta=meta;return o;}

    @AuraEnabled(cacheable=true)
    public static FolderInput getFolder(Id folderId) {
        LogicLearnAudienceService.requireAdmin();
        Training_Folder__c folder = [SELECT Id, Name, Parent_Folder__c, Sort_Order__c, Icon__c, Description__c FROM Training_Folder__c WHERE Id = :folderId LIMIT 1];
        FolderInput result = new FolderInput(); result.folderId=folder.Id; result.name=folder.Name; result.parentId=folder.Parent_Folder__c;
        result.sortOrder=folder.Sort_Order__c; result.icon=folder.Icon__c; result.description=folder.Description__c; return result;
    }

    @AuraEnabled
    public static Id saveFolder(FolderInput input) {
        LogicLearnAudienceService.requireAdmin();
        if (input == null || String.isBlank(input.name)) throw new AuraHandledException('Enter a folder name.');
        if (input.folderId != null && input.folderId == input.parentId) throw new AuraHandledException('A folder cannot be its own parent.');
        Training_Folder__c folder = input.folderId == null ? new Training_Folder__c() : new Training_Folder__c(Id=input.folderId);
        folder.Name=input.name; folder.Parent_Folder__c=input.parentId; folder.Sort_Order__c=input.sortOrder;
        folder.Icon__c=input.icon; folder.Description__c=input.description; upsert folder; return folder.Id;
    }

    @AuraEnabled
    public static Id createTutorialDraft() {
        LogicLearnAudienceService.requireAdmin();
        Training_Video__c draft = new Training_Video__c(
            Name = 'Untitled Tutorial',
            Status__c = 'Draft',
            Content_Type__c = 'Salesforce File',
            Skip_Prevention__c = 'Use Global Default'
        );
        insert draft;
        return draft.Id;
    }

    @AuraEnabled(cacheable=true)
    public static TutorialInput getTutorial(Id videoId) {
        LogicLearnAudienceService.requireAdmin();
        if (videoId == null) throw new AuraHandledException('A tutorial is required.');
        Training_Video__c video = [
            SELECT Id, Name, Description__c, Folder__c, Category__c, Content_Type__c,
                External_URL__c, Completion_Threshold__c, Skip_Prevention__c, Due_Date__c,
                Status__c, Video_Content_Version_Id__c
            FROM Training_Video__c WHERE Id = :videoId LIMIT 1
        ];
        TutorialInput result = new TutorialInput();
        result.videoId = video.Id;
        result.title = video.Name == 'Untitled Tutorial' ? '' : video.Name;
        result.description = video.Description__c;
        result.folderId = video.Folder__c;
        result.category = video.Category__c;
        result.contentType = String.isBlank(video.Content_Type__c) ? 'Salesforce File' : video.Content_Type__c;
        result.externalUrl = video.External_URL__c;
        result.completionThreshold = video.Completion_Threshold__c;
        result.skipPrevention = String.isBlank(video.Skip_Prevention__c) ? 'Use Global Default' : video.Skip_Prevention__c;
        result.dueDate = video.Due_Date__c;
        result.status = video.Status__c;
        if (String.isNotBlank(video.Video_Content_Version_Id__c)) {
            List<ContentVersion> files = [
                SELECT Title, FileExtension FROM ContentVersion
                WHERE Id = :video.Video_Content_Version_Id__c LIMIT 1
            ];
            if (!files.isEmpty()) result.fileName = files[0].Title + (String.isBlank(files[0].FileExtension) ? '' : '.' + files[0].FileExtension);
        }
        result.visibilityUsers = new List<String>(); result.visibilityProfiles = new List<String>(); result.visibilityGroups = new List<String>();
        result.requiredUsers = new List<String>(); result.requiredProfiles = new List<String>(); result.requiredGroups = new List<String>();
        result.notificationUsers = new List<String>(); result.notificationProfiles = new List<String>(); result.notificationGroups = new List<String>();
        for (Training_Audience__c rule : [
            SELECT Purpose__c, Audience_Type__c, User__c, Profile_Id__c, LogicLearn_Group__c
            FROM Training_Audience__c WHERE Training_Video__c = :videoId
        ]) {
            String value = rule.Audience_Type__c == 'User' ? String.valueOf(rule.User__c) :
                rule.Audience_Type__c == 'Profile' ? rule.Profile_Id__c : String.valueOf(rule.LogicLearn_Group__c);
            if (String.isBlank(value) || value == 'null') continue;
            List<String> target;
            if (rule.Purpose__c == 'Visibility') target = rule.Audience_Type__c == 'User' ? result.visibilityUsers : rule.Audience_Type__c == 'Profile' ? result.visibilityProfiles : result.visibilityGroups;
            else if (rule.Purpose__c == 'Required') target = rule.Audience_Type__c == 'User' ? result.requiredUsers : rule.Audience_Type__c == 'Profile' ? result.requiredProfiles : result.requiredGroups;
            else target = rule.Audience_Type__c == 'User' ? result.notificationUsers : rule.Audience_Type__c == 'Profile' ? result.notificationProfiles : result.notificationGroups;
            target.add(value);
        }
        return result;
    }

    @AuraEnabled
    public static void discardTutorialDraft(Id videoId) {
        LogicLearnAudienceService.requireAdmin();
        if (videoId == null) return;
        List<Training_Video__c> drafts = [
            SELECT Id FROM Training_Video__c
            WHERE Id = :videoId AND Name = 'Untitled Tutorial' AND Status__c = 'Draft' LIMIT 1
        ];
        if (!drafts.isEmpty() && [SELECT COUNT() FROM Training_View__c WHERE Training_Video__c = :videoId] == 0) {
            Set<Id> documentIds = new Set<Id>();
            for (ContentDocumentLink link : [SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = :videoId]) documentIds.add(link.ContentDocumentId);
            delete drafts;
            if (!documentIds.isEmpty()) delete [SELECT Id FROM ContentDocument WHERE Id IN :documentIds];
        }
    }

    @AuraEnabled
    public static Id saveTutorial(TutorialInput input) {
        LogicLearnAudienceService.requireAdmin();
        if(input==null||String.isBlank(input.title)) throw new AuraHandledException('Enter a tutorial title.');
        if(input.contentType=='External Link' && (String.isBlank(input.externalUrl)||!input.externalUrl.toLowerCase().startsWith('https://')))
            throw new AuraHandledException('External video links must begin with https://.');
        Integer visibilityCount=size(input.visibilityUsers)+size(input.visibilityProfiles)+size(input.visibilityGroups);
        if(input.status=='Published'&&visibilityCount==0) throw new AuraHandledException('Select at least one visibility audience before publishing.');
        String requestedStatus=String.isBlank(input.status)?'Draft':input.status;
        Training_Video__c video=input.videoId==null?new Training_Video__c():new Training_Video__c(Id=input.videoId);
        video.Name=input.title;video.Description__c=input.description;video.Folder__c=input.folderId;video.Category__c=input.category;
        video.Content_Type__c=String.isBlank(input.contentType)?'Salesforce File':input.contentType;video.External_URL__c=input.externalUrl;
        video.Completion_Threshold__c=input.completionThreshold;video.Skip_Prevention__c=String.isBlank(input.skipPrevention)?'Use Global Default':input.skipPrevention;
        video.Due_Date__c=input.dueDate;
        // Publishing is finalized after audience rows exist. This keeps the UI one-step while
        // allowing the publication trigger to enforce the audience requirement everywhere.
        video.Status__c=requestedStatus=='Published'?'Draft':requestedStatus;upsert video;
        delete [SELECT Id FROM Training_Audience__c WHERE Training_Video__c=:video.Id];
        List<Training_Audience__c> rules=new List<Training_Audience__c>();
        addRules(rules,video.Id,'Visibility','User',input.visibilityUsers);addRules(rules,video.Id,'Visibility','Profile',input.visibilityProfiles);addRules(rules,video.Id,'Visibility','LogicLearn Group',input.visibilityGroups);
        addRules(rules,video.Id,'Required','User',input.requiredUsers);addRules(rules,video.Id,'Required','Profile',input.requiredProfiles);addRules(rules,video.Id,'Required','LogicLearn Group',input.requiredGroups);
        addRules(rules,video.Id,'Notification','User',input.notificationUsers);addRules(rules,video.Id,'Notification','Profile',input.notificationProfiles);addRules(rules,video.Id,'Notification','LogicLearn Group',input.notificationGroups);
        if(!rules.isEmpty()) insert rules;
        if(requestedStatus=='Published') update new Training_Video__c(Id=video.Id,Status__c='Published');
        return video.Id;
    }

    @AuraEnabled
    public static Id saveTutorialWithTitle(TutorialInput input, String title) {
        if (input == null) input = new TutorialInput();
        input.title = title;
        return saveTutorial(input);
    }
    private static Integer size(List<String> values){return values==null?0:values.size();}
    private static void addRules(List<Training_Audience__c> out,Id videoId,String purpose,String type,List<String> ids){
        if(ids==null)return;for(String raw:ids){if(String.isBlank(raw))continue;Training_Audience__c r=new Training_Audience__c(Training_Video__c=videoId,Purpose__c=purpose,Audience_Type__c=type);
            if(type=='User')r.User__c=(Id)raw;else if(type=='Profile')r.Profile_Id__c=raw;else r.LogicLearn_Group__c=(Id)raw;out.add(r);}
    }

    @AuraEnabled(cacheable=true)
    public static List<GroupRow> getGroups(){LogicLearnAudienceService.requireAdmin();List<GroupRow> out=new List<GroupRow>();
        Map<Id,Integer> counts=new Map<Id,Integer>();for(AggregateResult a:[SELECT Group__c g,COUNT(Id)c FROM Training_Group_Member__c GROUP BY Group__c])counts.put((Id)a.get('g'),(Integer)a.get('c'));
        for(Training_Group__c g:[SELECT Id,Name,Description__c FROM Training_Group__c ORDER BY Name]){GroupRow r=new GroupRow();r.id=g.Id;r.name=g.Name;r.description=g.Description__c;r.memberCount=counts.containsKey(g.Id)?counts.get(g.Id):0;out.add(r);}return out;}

    @AuraEnabled(cacheable=true)
    public static GroupInput getGroup(Id groupId) {
        LogicLearnAudienceService.requireAdmin();
        if (groupId == null) throw new AuraHandledException('A group is required.');
        Training_Group__c groupRow = [SELECT Id, Name, Description__c FROM Training_Group__c WHERE Id = :groupId LIMIT 1];
        GroupInput result = new GroupInput(); result.groupId = groupRow.Id; result.name = groupRow.Name; result.description = groupRow.Description__c;
        result.users = new List<String>(); result.profiles = new List<String>(); result.groups = new List<String>();
        for (Training_Group_Member__c member : [
            SELECT Member_Type__c, User__c, Profile_Id__c, Nested_Group__c
            FROM Training_Group_Member__c WHERE Group__c = :groupId
        ]) {
            if (member.Member_Type__c == 'User' && member.User__c != null) result.users.add(String.valueOf(member.User__c));
            else if (member.Member_Type__c == 'Profile' && String.isNotBlank(member.Profile_Id__c)) result.profiles.add(member.Profile_Id__c);
            else if (member.Member_Type__c == 'LogicLearn Group' && member.Nested_Group__c != null) result.groups.add(String.valueOf(member.Nested_Group__c));
        }
        return result;
    }

    @AuraEnabled
    public static void deleteGroup(Id groupId) {
        LogicLearnAudienceService.requireAdmin();
        if (groupId != null) delete [SELECT Id FROM Training_Group__c WHERE Id = :groupId LIMIT 1];
    }

    @AuraEnabled
    public static Id saveGroup(GroupInput input){LogicLearnAudienceService.requireAdmin();if(input==null||String.isBlank(input.name))throw new AuraHandledException('Enter a group name.');
        Training_Group__c g=input.groupId==null?new Training_Group__c():new Training_Group__c(Id=input.groupId);g.Name=input.name;g.Description__c=input.description;upsert g;
        if(input.groups!=null&&input.groups.contains(String.valueOf(g.Id)))throw new AuraHandledException('A group cannot contain itself.');
        if (createsGroupCycle(g.Id, input.groups)) throw new AuraHandledException('That nested group would create a circular group relationship.');
        delete [SELECT Id FROM Training_Group_Member__c WHERE Group__c=:g.Id];List<Training_Group_Member__c> members=new List<Training_Group_Member__c>();
        addMembers(members,g.Id,'User',input.users);addMembers(members,g.Id,'Profile',input.profiles);addMembers(members,g.Id,'LogicLearn Group',input.groups);if(!members.isEmpty())insert members;return g.Id;}
    private static void addMembers(List<Training_Group_Member__c> out,Id groupId,String type,List<String> ids){if(ids==null)return;for(String raw:ids){if(String.isBlank(raw))continue;Training_Group_Member__c m=new Training_Group_Member__c(Group__c=groupId,Member_Type__c=type);if(type=='User')m.User__c=(Id)raw;else if(type=='Profile')m.Profile_Id__c=raw;else m.Nested_Group__c=(Id)raw;out.add(m);}}
    private static Boolean createsGroupCycle(Id rootId, List<String> selectedGroups) {
        if (selectedGroups == null || selectedGroups.isEmpty()) return false;
        Set<Id> pending = new Set<Id>(); for (String value : selectedGroups) if (String.isNotBlank(value)) pending.add((Id)value);
        Set<Id> visited = new Set<Id>();
        while (!pending.isEmpty() && visited.size() < 500) {
            if (pending.contains(rootId)) return true;
            Set<Id> batch = new Set<Id>(pending); pending.clear(); visited.addAll(batch);
            for (Training_Group_Member__c member : [SELECT Nested_Group__c FROM Training_Group_Member__c WHERE Group__c IN :batch AND Nested_Group__c != null])
                if (!visited.contains(member.Nested_Group__c)) pending.add(member.Nested_Group__c);
        }
        return false;
    }

    @AuraEnabled(cacheable=true)
    public static List<TrackingRow> getTracking(Id videoId){LogicLearnAudienceService.requireAdmin();if(videoId==null)return new List<TrackingRow>();Set<Id> required=LogicLearnAudienceService.usersForVideo(videoId,'Required');
        Date dueDate=[SELECT Due_Date__c FROM Training_Video__c WHERE Id=:videoId LIMIT 1].Due_Date__c;
        Map<Id,Training_View__c> views=new Map<Id,Training_View__c>();for(Training_View__c v:[SELECT User__c,Status__c,Watch_Percent__c,View_Count__c,First_Viewed_At__c,Last_Viewed_At__c,Completed_At__c,Completion_Method__c FROM Training_View__c WHERE Training_Video__c=:videoId AND User__c IN:required])views.put(v.User__c,v);
        List<TrackingRow> out=new List<TrackingRow>();for(User u:[SELECT Id,Name FROM User WHERE Id IN:required ORDER BY Name]){Training_View__c v=views.get(u.Id);TrackingRow r=new TrackingRow();r.userId=u.Id;r.userName=u.Name;r.status=v==null?'Not Started':v.Status__c;r.watchPercent=v==null?0:v.Watch_Percent__c;r.viewCount=v==null?0:v.View_Count__c;r.firstViewedAt=v==null?null:v.First_Viewed_At__c;r.lastViewedAt=v==null?null:v.Last_Viewed_At__c;r.completedAt=v==null?null:v.Completed_At__c;r.completionMethod=v==null?null:v.Completion_Method__c;r.dueDate=dueDate;r.overdue=dueDate!=null&&dueDate<Date.today()&&r.status!='Completed';out.add(r);}return out;}

    @AuraEnabled
    public static Integer sendNotification(Id videoId,String notificationType){LogicLearnAudienceService.requireAdmin();return TrainingNotificationService.notifyAudience(videoId,notificationType);}

    @AuraEnabled
    public static Integer sendInAppNotification(Id videoId, String notificationType) {
        LogicLearnAudienceService.requireAdmin();
        if (videoId == null) throw new AuraHandledException('A tutorial is required.');
        String purpose = notificationType == 'New Video' ? 'Notification' : 'Required';
        Set<Id> recipients = LogicLearnAudienceService.usersForVideo(videoId, purpose);
        if (notificationType == 'Reminder' && !recipients.isEmpty()) {
            for (Training_View__c completed : [
                SELECT User__c FROM Training_View__c
                WHERE Training_Video__c = :videoId AND User__c IN :recipients AND Status__c = 'Completed'
            ]) recipients.remove(completed.User__c);
        }
        if (recipients.isEmpty()) return 0;
        Training_Video__c video = [SELECT Id, Name, Due_Date__c FROM Training_Video__c WHERE Id = :videoId LIMIT 1];
        List<CustomNotificationType> types = [
            SELECT Id FROM CustomNotificationType WHERE DeveloperName = 'LogicLearn_Notification' LIMIT 1
        ];
        if (types.isEmpty()) throw new AuraHandledException('The LogicLearn in-app notification type is not configured.');
        Messaging.CustomNotification notice = new Messaging.CustomNotification();
        notice.setNotificationTypeId(types[0].Id);
        notice.setTargetPageRef('{"type":"standard__navItemPage","attributes":{"apiName":"Training_Library"},"state":{"c__videoId":"' + video.Id + '"}}');
        notice.setTitle(notificationType == 'Reminder' ? 'LogicLearn reminder' : notificationType == 'Assignment' ? 'New required tutorial' : 'New LogicLearn tutorial');
        String body = notificationType == 'Reminder' ? 'Reminder: complete ' + video.Name :
            notificationType == 'Assignment' ? video.Name + ' has been assigned to you' : video.Name + ' is now available';
        if (video.Due_Date__c != null && notificationType != 'New Video') body += ' by ' + String.valueOf(video.Due_Date__c);
        notice.setBody(body + '.');
        Set<String> recipientIds = new Set<String>();
        for (Id recipientId : recipients) recipientIds.add(String.valueOf(recipientId));
        notice.send(recipientIds);
        return recipientIds.size();
    }
}
