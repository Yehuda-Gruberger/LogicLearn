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
        String userId=String.valueOf(UserInfo.getUserId());
        input.visibilityUsers=new List<String>{userId}; input.requiredUsers=new List<String>{userId}; input.notificationUsers=new List<String>{userId};
        input.title=null;
        Test.startTest(); Id videoId=LogicLearnAdminController.saveTutorialWithTitle(input, 'Saved tutorial'); Test.stopTest();
        System.assertEquals('Saved tutorial', [SELECT Name FROM Training_Video__c WHERE Id=:videoId].Name);
        System.assertEquals('Published',[SELECT Status__c FROM Training_Video__c WHERE Id=:videoId].Status__c);
        Map<String,Integer> counts=new Map<String,Integer>();
        for(AggregateResult row:[SELECT Purpose__c purpose,COUNT(Id) total FROM Training_Audience__c WHERE Training_Video__c=:videoId GROUP BY Purpose__c])counts.put((String)row.get('purpose'),(Integer)row.get('total'));
        System.assertEquals(1,counts.get('Visibility'));System.assertEquals(1,counts.get('Required'));System.assertEquals(1,counts.get('Notification'));
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
        LogicLearnAdminController.saveSettings(settings);
        System.assertEquals(85, LogicLearnAdminController.getSettings().completionThreshold);

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
