@IsTest
private class LogicLearnPlatformTest {
    private static Training_Video__c externalVideo() {
        Training_Video__c video = new Training_Video__c(
            Name='External Tutorial', Status__c='Published', Category__c='Systems',
            Content_Type__c='External Link', External_URL__c='https://example.com/video',
            Skip_Prevention__c='Use Global Default', Due_Date__c=Date.today().addDays(-1)
        );
        insert video;
        return video;
    }

    @IsTest
    static void nestedProfileGroupIsLiveAndExternalCompletionIsManual() {
        LogicLearnAudienceService.adminOverride = true;
        insert new LogicLearn_Settings__c(Name='Global',Completion_Threshold__c=90,Prevent_Skipping__c=true,
            Assignment_Template_Name__c='LogicLearn Assignment',Reminder_Template_Name__c='LogicLearn Reminder');
        Training_Video__c video = externalVideo();
        Training_Group__c child = new Training_Group__c(Name='Profile members');
        Training_Group__c parent = new Training_Group__c(Name='All learners');
        insert new List<Training_Group__c>{child,parent};
        insert new Training_Group_Member__c(Group__c=child.Id,Member_Type__c='Profile',Profile_Id__c=UserInfo.getProfileId());
        insert new Training_Group_Member__c(Group__c=parent.Id,Member_Type__c='LogicLearn Group',Nested_Group__c=child.Id);
        insert new List<Training_Audience__c>{
            new Training_Audience__c(Training_Video__c=video.Id,Purpose__c='Visibility',Audience_Type__c='LogicLearn Group',LogicLearn_Group__c=parent.Id),
            new Training_Audience__c(Training_Video__c=video.Id,Purpose__c='Required',Audience_Type__c='User',User__c=UserInfo.getUserId())
        };

        LogicLearnAudienceService.adminOverride = false;
        System.assertEquals(true, LogicLearnAudienceService.canUserSeeVideo(UserInfo.getUserId(), video.Id));
        System.assertEquals(true, LogicLearnAudienceService.videoIdsForUser(UserInfo.getUserId(),'Required',new Set<Id>{video.Id}).contains(video.Id));
        TrainingVideoController.PlaybackInfo playback = TrainingVideoController.getPlayback(video.Id);
        System.assertEquals(true, playback.isExternal);
        System.assertEquals('https://example.com/video', playback.externalUrl);
        TrainingVideoController.markExternalComplete(video.Id);
        Training_View__c view = [SELECT Status__c,Completion_Method__c,Watch_Percent__c FROM Training_View__c WHERE Training_Video__c=:video.Id AND User__c=:UserInfo.getUserId()];
        System.assertEquals('Completed',view.Status__c);
        System.assertEquals('Manual',view.Completion_Method__c);
        System.assertEquals(100,view.Watch_Percent__c);
    }

    @IsTest
    static void nonAdminCannotCallAdministrativeApi() {
        LogicLearnAudienceService.adminOverride = false;
        Boolean blocked = false;
        try {
            TrainingVideoController.getAdminVideos();
        } catch (AuraHandledException expected) {
            blocked = true;
        }
        System.assertEquals(true, blocked, 'Expected admin enforcement.');
    }

    @IsTest
    static void tutorialSaveStoresAllThreeAudiencePurposes() {
        LogicLearnAudienceService.adminOverride = true;
        LogicLearnAdminController.TutorialInput input = new LogicLearnAdminController.TutorialInput();
        input.title='One-screen Tutorial'; input.status='Published'; input.contentType='External Link';
        input.externalUrl='https://example.com'; input.category='Products'; input.skipPrevention='Enabled';
        input.publishNotificationChannel='Email'; input.assignmentNotificationChannel='In-app';
        String userId=String.valueOf(UserInfo.getUserId());
        input.visibilityUsers=new List<String>{userId}; input.requiredUsers=new List<String>{userId}; input.notificationUsers=new List<String>{userId};
        input.title=null;
        Test.startTest(); Id videoId=LogicLearnAdminController.saveTutorialWithTitle(input, 'Saved tutorial'); Test.stopTest();
        System.assertEquals('Saved tutorial', [SELECT Name FROM Training_Video__c WHERE Id=:videoId].Name);
        Training_Video__c savedVideo=[SELECT Status__c,Publish_Notification_Channel__c,Assignment_Notification_Channel__c FROM Training_Video__c WHERE Id=:videoId];
        System.assertEquals('Published',savedVideo.Status__c);
        System.assertEquals('Email',savedVideo.Publish_Notification_Channel__c);
        System.assertEquals('In-app',savedVideo.Assignment_Notification_Channel__c);
        Map<String,Integer> counts=new Map<String,Integer>();
        for(AggregateResult row:[SELECT Purpose__c purpose,COUNT(Id) total FROM Training_Audience__c WHERE Training_Video__c=:videoId GROUP BY Purpose__c])counts.put((String)row.get('purpose'),(Integer)row.get('total'));
        System.assertEquals(1,counts.get('Visibility'));System.assertEquals(1,counts.get('Required'));System.assertEquals(1,counts.get('Notification'));
    }

    @IsTest
    static void explicitAudienceExclusionAlwaysWins() {
        LogicLearnAudienceService.adminOverride = true;
        String userId=String.valueOf(UserInfo.getUserId());
        LogicLearnAdminController.TutorialInput input = new LogicLearnAdminController.TutorialInput();
        input.title='Excluded tutorial'; input.status='Published'; input.contentType='External Link';
        input.externalUrl='https://example.com/excluded'; input.category='Custom Category';
        input.visibilityProfiles=new List<String>{String.valueOf(UserInfo.getProfileId())};
        input.visibilityUsers=new List<String>{userId};
        input.visibilityExcludedUsers=new List<String>{userId};
        Id videoId=LogicLearnAdminController.saveTutorial(input);

        System.assertEquals(false, LogicLearnAudienceService.videoIdsForUser(
            UserInfo.getUserId(),'Visibility',new Set<Id>{videoId}).contains(videoId));
        System.assertEquals(0,LogicLearnAudienceService.usersForVideo(videoId,'Visibility').size());
        LogicLearnAdminController.TutorialInput loaded=LogicLearnAdminController.getTutorial(videoId);
        System.assertEquals(new List<String>{userId},loaded.visibilityExcludedUsers);
        System.assert(LogicLearnAdminController.getAudienceMembers(
            new List<String>{String.valueOf(UserInfo.getProfileId())},new List<String>()).contains(userId));
    }

    @IsTest
    static void readTutorialPagesTrackProgressAndEngagementDetails() {
        LogicLearnAudienceService.adminOverride = true;
        Id videoId = LogicLearnAdminController.createTutorialDraft();
        LogicLearnAdminController.TutorialPageInput first = new LogicLearnAdminController.TutorialPageInput();
        first.title = 'Welcome'; first.body = '<p>Welcome to the guide.</p>'; first.pageNumber = 1;
        LogicLearnAdminController.TutorialPageInput second = new LogicLearnAdminController.TutorialPageInput();
        second.title = 'Finish'; second.body = '<p>You are done.</p>'; second.pageNumber = 2;
        LogicLearnAdminController.saveTutorialPages(videoId, new List<LogicLearnAdminController.TutorialPageInput>{first, second});

        LogicLearnAdminController.TutorialInput input = new LogicLearnAdminController.TutorialInput();
        input.videoId = videoId; input.title = 'Read this'; input.status = 'Published'; input.contentType = 'Document';
        input.visibilityUsers = new List<String>{String.valueOf(UserInfo.getUserId())};
        input.requiredUsers = new List<String>{String.valueOf(UserInfo.getUserId())};
        LogicLearnAdminController.saveTutorial(input);
        System.assertEquals(2, LogicLearnAdminController.getTutorialPages(videoId).size());

        LogicLearnAudienceService.adminOverride = false;
        TrainingVideoController.DocumentInfo document = TrainingVideoController.getDocument(videoId);
        System.assertEquals(2, document.pages.size()); System.assertEquals(1, document.currentPage);
        TrainingVideoController.recordDocumentProgress(videoId, 1, 2);
        TrainingVideoController.recordDocumentProgress(videoId, 2, 2);
        Training_View__c view = [SELECT Status__c, Watch_Percent__c, View_Count__c FROM Training_View__c WHERE Training_Video__c = :videoId AND User__c = :UserInfo.getUserId()];
        System.assertEquals('Completed', view.Status__c); System.assertEquals(100, view.Watch_Percent__c); System.assertEquals(1, view.View_Count__c);

        LogicLearnAudienceService.adminOverride = true;
        LogicLearnAdminController.EngagementPage detail = LogicLearnAdminController.getEngagementDetails(videoId, 'Completed', 1, 6);
        System.assertEquals(1, detail.total); System.assertEquals(1, detail.rows.size());
        LogicLearnAdminController.EngagementSummary summary = LogicLearnAdminController.getEngagementSummary(videoId);
        System.assertEquals(1, summary.totalOpens); System.assertEquals(1, summary.started); System.assertEquals(1, summary.completed);
    }

    @IsTest
    static void administrativeSurfacesRoundTrip() {
        LogicLearnAudienceService.adminOverride = true;
        LogicLearnAdminController.initializeLogicLearn();
        System.assertEquals(4, [SELECT COUNT() FROM Training_Folder__c]);
        System.assertEquals(4, [SELECT COUNT() FROM Training_Video__c]);

        LogicLearnAdminController.SettingsDto settings = LogicLearnAdminController.getSettings();
        settings.completionThreshold = 85; settings.preventSkipping = false;
        settings.assignmentTemplateName = 'Custom Assignment'; settings.reminderTemplateName = 'Custom Reminder';
        settings.firstPublishEmailTemplate = 'Custom Publish'; settings.updateEmailTemplate = 'Custom Update';
        settings.firstPublishInAppMessage = '[VIDEO_NAME] is ready.'; settings.updateInAppMessage = '[VIDEO_NAME] changed.';
        LogicLearnAdminController.saveSettings(settings);
        System.assertEquals(85, LogicLearnAdminController.getSettings().completionThreshold);
        System.assertEquals('Custom Update', LogicLearnAdminController.getSettings().updateEmailTemplate);

        LogicLearnAdminController.FolderInput folder = new LogicLearnAdminController.FolderInput();
        folder.name='Advanced'; folder.sortOrder=90; folder.description='Advanced material';
        Id folderId=LogicLearnAdminController.saveFolder(folder);
        LogicLearnAdminController.FolderInput loadedFolder=LogicLearnAdminController.getFolder(folderId);
        System.assertEquals('Advanced',loadedFolder.name);

        LogicLearnAdminController.Catalog catalog=LogicLearnAdminController.getCatalog();
        System.assert(catalog.users.size()>0); System.assert(catalog.profiles.size()>0); System.assert(catalog.folders.size()>0);

        LogicLearnAdminController.GroupInput groupInput = new LogicLearnAdminController.GroupInput();
        groupInput.name='Dynamic team'; groupInput.description='Live membership';
        groupInput.users=new List<String>{String.valueOf(UserInfo.getUserId())};
        groupInput.profiles=new List<String>{String.valueOf(UserInfo.getProfileId())}; groupInput.groups=new List<String>();
        Id groupId=LogicLearnAdminController.saveGroup(groupInput);
        System.assertEquals(2,LogicLearnAdminController.getGroup(groupId).users.size()+LogicLearnAdminController.getGroup(groupId).profiles.size());
        System.assertEquals(1,LogicLearnAdminController.getGroups().size());

        Id draftId=LogicLearnAdminController.createTutorialDraft();
        LogicLearnAdminController.TutorialInput draft=LogicLearnAdminController.getTutorial(draftId);
        System.assertEquals('',draft.title); System.assertEquals('Salesforce File',draft.contentType);
        LogicLearnAdminController.discardTutorialDraft(draftId);
        System.assertEquals(0,[SELECT COUNT() FROM Training_Video__c WHERE Id=:draftId]);

        Training_Video__c sample=[SELECT Id FROM Training_Video__c LIMIT 1];
        insert new Training_Audience__c(Training_Video__c=sample.Id,Purpose__c='Required',Audience_Type__c='User',User__c=UserInfo.getUserId());
        List<LogicLearnAdminController.TrackingRow> tracking=LogicLearnAdminController.getTracking(sample.Id);
        System.assertEquals(1,tracking.size()); System.assertEquals('Not Started',tracking[0].status);
        System.assertEquals(0,LogicLearnAdminController.sendNotification(sample.Id,'New Video'));
        System.assertEquals(0,LogicLearnAdminController.sendInAppNotification(sample.Id,'New Video'));

        LogicLearnAdminController.deleteGroup(groupId);
        System.assertEquals(0,LogicLearnAdminController.getGroups().size());
        System.assert(TrainingVideoController.getAdminVideos().size()>=4);
    }
}
