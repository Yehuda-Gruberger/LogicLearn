/**
 * @description Tests for TrainingVideoController — library grouping/visibility, playback row
 * creation, progress → completion transitions, upsert idempotency, and admin file pinning.
 */
@isTest
private class TrainingVideoControllerTest {
    @TestSetup
    static void setup() {
        Training_Folder__c folder = new Training_Folder__c(
            Name = 'Onboarding',
            Sort_Order__c = 1
        );
        insert folder;

        insert new List<Training_Video__c>{
            new Training_Video__c(
                Name = 'Published One',
                Folder__c = folder.Id,
                Category__c = 'Onboarding',
                Status__c = 'Published',
                Sort_Order__c = 1
            ),
            new Training_Video__c(
                Name = 'Mandatory One',
                Folder__c = folder.Id,
                Category__c = 'Compliance',
                Status__c = 'Published',
                Sort_Order__c = 2
            ),
            new Training_Video__c(
                Name = 'Draft One',
                Folder__c = folder.Id,
                Status__c = 'Draft',
                Sort_Order__c = 3
            )
        };
    }

    private static Id videoId(String title) {
        return [SELECT Id FROM Training_Video__c WHERE Name = :title LIMIT 1].Id;
    }

    // ─── Library ───

    @isTest
    static void getLibrary_groupsVisibleVideosAndHidesDraft() {
        Test.startTest();
        List<TrainingVideoController.FolderSection> sections = TrainingVideoController.getLibrary(null, null);
        Test.stopTest();

        System.assertEquals(1, sections.size(), 'One folder section expected');
        TrainingVideoController.FolderSection section = sections[0];
        System.assertEquals('Onboarding', section.folderName, 'Folder name should carry through');
        System.assertEquals(2, section.videos.size(), 'Draft video must be excluded from the library');
        System.assertEquals('Published One', section.videos[0].title, 'Sort order should be honored');
        System.assertEquals(false, section.videos[1].isMandatory, 'Mandatory only applies to assigned users; nobody is assigned here');
        System.assertEquals(null, section.videos[0].viewStatus, 'No view yet means null status');
    }

    @isTest
    static void getLibrary_mandatoryReflectsAssignment() {
        Id vid = videoId('Mandatory One');
        // Assign the running user, so the video is mandatory FOR THEM.
        TrainingVideoController.assignToAudience(vid, null, new List<Id>{UserInfo.getUserId()}, false);

        Test.startTest();
        List<TrainingVideoController.FolderSection> sections = TrainingVideoController.getLibrary(null, null);
        Test.stopTest();

        Boolean checked = false;
        for (TrainingVideoController.FolderSection s : sections) {
            for (TrainingVideoController.VideoInfo v : s.videos) {
                if (v.id == vid) {
                    System.assertEquals(true, v.isMandatory, 'Assigned user should see the video as mandatory');
                    checked = true;
                }
            }
        }
        System.assert(checked, 'The mandatory video should appear in the library');
    }

    @isTest
    static void getLibrary_filtersByCategory() {
        Test.startTest();
        List<TrainingVideoController.FolderSection> sections = TrainingVideoController.getLibrary(null, 'Compliance');
        Test.stopTest();

        System.assertEquals(1, sections.size(), 'One section expected');
        System.assertEquals(1, sections[0].videos.size(), 'Only the Compliance video should return');
        System.assertEquals('Mandatory One', sections[0].videos[0].title, 'Wrong video for category filter');
    }

    // ─── Playback ───

    @isTest
    static void getPlayback_createsPendingViewAndResolvesFile() {
        Id vid = videoId('Published One');

        // Link a video file so the fallback resolver has something to find.
        ContentVersion cv = new ContentVersion(
            Title = 'Clip',
            PathOnClient = 'clip.mp4',
            VersionData = Blob.valueOf('fake-bytes')
        );
        insert cv;
        Id docId = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id].ContentDocumentId;
        insert new ContentDocumentLink(
            ContentDocumentId = docId,
            LinkedEntityId = vid,
            ShareType = 'V'
        );

        Test.startTest();
        TrainingVideoController.PlaybackInfo info = TrainingVideoController.getPlayback(vid);
        Test.stopTest();

        System.assertNotEquals(null, info.contentVersionId, 'Should resolve the linked ContentVersion');
        System.assert(info.videoUrl.contains('/sfc/servlet.shepherd/version/download/'), 'Streaming URL expected');
        System.assertEquals('Pending', info.viewStatus, 'First open should create a Pending view');

        List<Training_View__c> views = [SELECT Status__c, View_Count__c FROM Training_View__c WHERE Training_Video__c = :vid];
        System.assertEquals(1, views.size(), 'Exactly one view row should exist');
        System.assertEquals(1, views[0].View_Count__c, 'View count should be 1 after first open');
    }

    @isTest
    static void getPlayback_isIdempotentAndBumpsViewCount() {
        Id vid = videoId('Published One');

        Test.startTest();
        TrainingVideoController.getPlayback(vid);
        TrainingVideoController.getPlayback(vid);
        Test.stopTest();

        List<Training_View__c> views = [SELECT View_Count__c FROM Training_View__c WHERE Training_Video__c = :vid];
        System.assertEquals(1, views.size(), 'No duplicate view row should be created (unique key)');
        System.assertEquals(2, views[0].View_Count__c, 'Second open should bump the view count');
    }

    // ─── Progress → completion ───

    @isTest
    static void recordProgress_partialMarksInProgress() {
        Id vid = videoId('Mandatory One');

        Test.startTest();
        TrainingVideoController.recordProgress(vid, 40, false);
        Test.stopTest();

        Training_View__c view = [SELECT Status__c, Watch_Percent__c, Completed_At__c FROM Training_View__c WHERE Training_Video__c = :vid];
        System.assertEquals('In Progress', view.Status__c, 'Partial watch should be In Progress');
        System.assertEquals(40, view.Watch_Percent__c, 'Watch percent should be recorded');
        System.assertEquals(null, view.Completed_At__c, 'Not completed yet');
    }

    @isTest
    static void recordProgress_thresholdMarksCompleted() {
        Id vid = videoId('Mandatory One');

        Test.startTest();
        TrainingVideoController.recordProgress(vid, 40, false);
        TrainingVideoController.recordProgress(vid, 92, false);
        Test.stopTest();

        Training_View__c view = [SELECT Status__c, Watch_Percent__c, Completed_At__c FROM Training_View__c WHERE Training_Video__c = :vid];
        System.assertEquals('Completed', view.Status__c, 'Crossing the threshold should complete the view');
        System.assertEquals(92, view.Watch_Percent__c, 'Watch percent should rise to the max seen');
        System.assertNotEquals(null, view.Completed_At__c, 'Completed timestamp should be set');
    }

    @isTest
    static void recordProgress_endedMarksCompletedRegardlessOfPercent() {
        Id vid = videoId('Mandatory One');

        Test.startTest();
        TrainingVideoController.recordProgress(vid, 70, true);
        Test.stopTest();

        Training_View__c view = [SELECT Status__c, Completed_At__c FROM Training_View__c WHERE Training_Video__c = :vid];
        System.assertEquals('Completed', view.Status__c, 'Reaching the end should complete even below the threshold');
        System.assertNotEquals(null, view.Completed_At__c, 'Completed timestamp should be set');
    }

    @isTest
    static void recordProgress_doesNotRegressCompleted() {
        Id vid = videoId('Mandatory One');

        Test.startTest();
        TrainingVideoController.recordProgress(vid, 95, false); // completes
        TrainingVideoController.recordProgress(vid, 10, false); // re-watch from start
        Test.stopTest();

        Training_View__c view = [SELECT Status__c, Watch_Percent__c FROM Training_View__c WHERE Training_Video__c = :vid];
        System.assertEquals('Completed', view.Status__c, 'A completed view must stay completed on re-watch');
        System.assertEquals(95, view.Watch_Percent__c, 'Watch percent should not drop');
    }

    // ─── My Training ───

    @isTest
    static void getMyPending_returnsOutstandingMandatoryFirst() {
        // Assign 'Mandatory One' to the running user so it's mandatory FOR THEM; leave
        // 'Published One' as a self-started (non-assigned) view.
        TrainingVideoController.assignToAudience(videoId('Mandatory One'), null, new List<Id>{UserInfo.getUserId()}, false);
        TrainingVideoController.recordProgress(videoId('Published One'), 30, false); // In Progress, not assigned

        Test.startTest();
        List<TrainingVideoController.VideoInfo> pending = TrainingVideoController.getMyPending();
        Test.stopTest();

        System.assertEquals(2, pending.size(), 'Both outstanding videos should be returned');
        System.assertEquals('Mandatory One', pending[0].title, 'Assigned (mandatory) should sort first');
        System.assertEquals(true, pending[0].isMandatory, 'Assigned video is mandatory for this user');
        System.assertEquals(false, pending[1].isMandatory, 'Non-assigned in-progress video is not mandatory');
    }

    @isTest
    static void getMyPending_excludesCompleted() {
        TrainingVideoController.recordProgress(videoId('Published One'), 100, true); // Completed

        Test.startTest();
        List<TrainingVideoController.VideoInfo> pending = TrainingVideoController.getMyPending();
        Test.stopTest();

        System.assertEquals(0, pending.size(), 'Completed training should not appear as pending');
    }

    // ─── Admin file pin ───

    @isTest
    static void setVideoFile_pinsContentVersion() {
        Id vid = videoId('Published One');
        ContentVersion cv = new ContentVersion(
            Title = 'Clip',
            PathOnClient = 'clip.mp4',
            VersionData = Blob.valueOf('fake-bytes')
        );
        insert cv;

        Test.startTest();
        TrainingVideoController.setVideoFile(vid, cv.Id);
        Test.stopTest();

        Training_Video__c video = [SELECT Video_Content_Version_Id__c FROM Training_Video__c WHERE Id = :vid];
        System.assertEquals(String.valueOf(cv.Id), video.Video_Content_Version_Id__c, 'ContentVersion should be pinned');

        // getPlayback should now use the pinned version.
        TrainingVideoController.PlaybackInfo info = TrainingVideoController.getPlayback(vid);
        System.assertEquals(String.valueOf(cv.Id), info.contentVersionId, 'Pinned version should win over fallback');
    }

    // ─── Folder hierarchy ───

    @isTest
    static void getFolders_returnsParentAndChild() {
        Training_Folder__c parent = [SELECT Id FROM Training_Folder__c WHERE Name = 'Onboarding' LIMIT 1];
        Training_Folder__c child = new Training_Folder__c(
            Name = 'Phone Basics',
            Parent_Folder__c = parent.Id,
            Sort_Order__c = 1
        );
        insert child;

        Test.startTest();
        List<TrainingVideoController.FolderInfo> folders = TrainingVideoController.getFolders();
        Test.stopTest();

        System.assertEquals(2, folders.size(), 'Both folders should be returned');
        Map<Id, TrainingVideoController.FolderInfo> byId = new Map<Id, TrainingVideoController.FolderInfo>();
        for (TrainingVideoController.FolderInfo fi : folders) {
            byId.put(fi.id, fi);
        }
        System.assertEquals(parent.Id, byId.get(child.Id).parentId, 'Child should point to its parent');
        System.assertEquals(null, byId.get(parent.Id).parentId, 'Top-level folder has no parent');
    }

    // ─── Notification ───

    @isTest
    static void sendNotification_withTemplateRunsSendPath() {
        Id vid = videoId('Published One');
        User u = insertTestUser();
        TrainingVideoController.assignToAudience(vid, null, new List<Id>{u.Id}, false);

        // Create the template the queueable looks up, so the render + send path executes.
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert new EmailTemplate(
                Name = 'Training Video Assignment Notification',
                DeveloperName = 'Training_Video_Assignment',
                FolderId = UserInfo.getUserId(),
                TemplateType = 'text',
                Subject = 'Training assigned',
                Body = 'You have been assigned a training video. Visit the library.',
                IsActive = true
            );
        }

        Test.startTest();
        update new Training_Video__c(Id = vid, Send_Notification__c = true);
        Test.stopTest(); // runs the queued job (email is not actually sent in test context)

        System.assertEquals(
            false,
            [SELECT Send_Notification__c FROM Training_Video__c WHERE Id = :vid].Send_Notification__c,
            'Send Notification should clear after sending'
        );
    }

    @isTest
    static void assignToAudience_notifyEmailsAndStampsNotifiedAt() {
        Id vid = videoId('Published One');
        User u = insertTestUser();
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert new EmailTemplate(
                Name = 'Training Video Assignment Notification',
                DeveloperName = 'Training_Video_Assignment',
                FolderId = UserInfo.getUserId(),
                TemplateType = 'text',
                Subject = 'Training assigned',
                Body = 'You have been assigned a training video. Visit the library.',
                IsActive = true
            );
        }

        Test.startTest();
        TrainingVideoController.AssignResult res =
            TrainingVideoController.assignToAudience(vid, null, new List<Id>{u.Id}, true);
        Test.stopTest();

        System.assertEquals(1, res.assigned, 'One user assigned');
        System.assertEquals(1, res.notified, 'One user emailed');
        Training_View__c v = [
            SELECT Notified_At__c FROM Training_View__c WHERE Training_Video__c = :vid AND User__c = :u.Id
        ];
        System.assertNotEquals(null, v.Notified_At__c, 'Notified_At should be stamped on the assigned view');
    }

    @isTest
    static void notify_onlyOncePerUserPerVideo() {
        Id vid = videoId('Published One');
        User u = insertTestUser();
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert new EmailTemplate(
                Name = 'Training Video Assignment Notification',
                DeveloperName = 'Training_Video_Assignment',
                FolderId = UserInfo.getUserId(),
                TemplateType = 'text',
                Subject = 'Assigned',
                Body = 'You have a new training video.',
                IsActive = true
            );
        }

        Test.startTest();
        Integer first = TrainingVideoController.assignToAudience(vid, null, new List<Id>{u.Id}, true).notified;
        // Re-assigning the same user with notify on must NOT email them again.
        Integer second = TrainingVideoController.assignToAudience(vid, null, new List<Id>{u.Id}, true).notified;
        Test.stopTest();

        System.assertEquals(1, first, 'First notify should email the newly assigned user');
        System.assertEquals(0, second, 'Already-notified user should not be emailed again');
    }

    @isTest
    static void sendNotification_clearsCheckboxAfterAsyncRun() {
        Id vid = videoId('Published One');
        User u = insertTestUser();
        TrainingVideoController.assignToAudience(vid, null, new List<Id>{u.Id}, false);

        Test.startTest();
        update new Training_Video__c(Id = vid, Send_Notification__c = true);
        Test.stopTest(); // runs the enqueued TrainingNotifyQueueable

        // No email template exists in the test org, so sending is skipped — but the checkbox
        // must reset so it can be triggered again.
        System.assertEquals(
            false,
            [SELECT Send_Notification__c FROM Training_Video__c WHERE Id = :vid].Send_Notification__c,
            'Send Notification should clear after the async job runs'
        );
    }

    // ─── Admin console ───

    @isTest
    static void isLibraryAdmin_trueForAdminUser() {
        Test.startTest();
        Boolean isAdmin = TrainingVideoController.isLibraryAdmin();
        Test.stopTest();
        // The test runs as the (admin) running user, who can create Training Videos.
        System.assertEquals(true, isAdmin, 'Running admin user should be a library admin');
    }

    @isTest
    static void getAdminVideos_returnsAllStatusesWithCounts() {
        Id vid = videoId('Mandatory One');
        User u = insertTestUser();
        TrainingVideoController.assignToAudience(vid, null, new List<Id>{u.Id}, false);

        Test.startTest();
        List<TrainingVideoController.VideoAdminRow> rows = TrainingVideoController.getAdminVideos();
        Test.stopTest();

        // Setup created 3 videos incl. a Draft — admin view shows them all.
        System.assertEquals(3, rows.size(), 'All videos including Draft should be listed');
        Boolean sawDraft = false;
        Boolean checkedCounts = false;
        for (TrainingVideoController.VideoAdminRow r : rows) {
            if (r.status == 'Draft') {
                sawDraft = true;
            }
            if (r.id == vid) {
                System.assertEquals(1, r.assignedCount, 'One assigned user expected');
                System.assertEquals(0, r.completedCount, 'None completed yet');
                checkedCounts = true;
            }
        }
        System.assert(sawDraft, 'Draft video should appear in the admin list');
        System.assert(checkedCounts, 'Assigned video row should be present');
    }

    // ─── Audience assignment ───

    private static User makeUser() {
        Profile p = [SELECT Id FROM Profile WHERE UserLicense.Name = 'Salesforce' ORDER BY Name LIMIT 1];
        String uniq = 'ttv' + String.valueOf(System.now().getTime());
        return new User(
            Alias = 'ttv',
            Email = uniq + '@example.com',
            LastName = 'TrainingTester',
            Username = uniq + '@example.com.trainingtest',
            ProfileId = p.Id,
            TimeZoneSidKey = 'America/New_York',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
    }

    private static User insertTestUser() {
        User u = makeUser();
        // Isolate setup-object DML to avoid MIXED_DML_OPERATION with Training_View__c DML.
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert u;
        }
        return u;
    }

    @isTest
    static void getProfiles_returnsProfiles() {
        Test.startTest();
        List<TrainingVideoController.Option> profs = TrainingVideoController.getProfiles();
        Test.stopTest();
        System.assert(!profs.isEmpty(), 'Org profiles should be returned for the picker');
    }

    @isTest
    static void searchUsers_returnsList() {
        Test.startTest();
        List<TrainingVideoController.Option> users = TrainingVideoController.searchUsers('a');
        Test.stopTest();
        System.assertNotEquals(null, users, 'Search should return a (possibly empty) list');
    }

    @isTest
    static void assignToAudience_byUserCreatesPendingAssignment() {
        Id vid = videoId('Published One');
        User u = insertTestUser();

        Test.startTest();
        Integer n = TrainingVideoController.assignToAudience(vid, null, new List<Id>{u.Id}, false).assigned;
        Test.stopTest();

        System.assertEquals(1, n, 'One user should be assigned');
        Training_View__c v = [
            SELECT Status__c, Assigned__c, Assigned_Via__c
            FROM Training_View__c
            WHERE Training_Video__c = :vid AND User__c = :u.Id
        ];
        System.assertEquals('Pending', v.Status__c, 'Assignment should start Pending');
        System.assertEquals(true, v.Assigned__c, 'Row should be flagged as assigned');
        System.assertEquals('Directly assigned', v.Assigned_Via__c, 'Direct assignment label expected');
        System.assertEquals('Published', [SELECT Status__c FROM Training_Video__c WHERE Id = :vid].Status__c, 'Assigned video should be Published (visible)');
    }

    @isTest
    static void assignToAudience_byProfileAssignsProfileUsers() {
        Id vid = videoId('Published One');
        User u = insertTestUser();

        Test.startTest();
        Integer n = TrainingVideoController.assignToAudience(vid, new List<Id>{u.ProfileId}, null, false).assigned;
        Test.stopTest();

        System.assert(n >= 1, 'At least the created user should be assigned via profile');
        List<Training_View__c> v = [
            SELECT Assigned__c, Assigned_Via__c
            FROM Training_View__c
            WHERE Training_Video__c = :vid AND User__c = :u.Id
        ];
        System.assertEquals(1, v.size(), 'User in the assigned profile should get a tracking row');
        System.assertEquals(true, v[0].Assigned__c, 'Row should be flagged assigned');
    }

    @isTest
    static void getAssignments_returnsRows() {
        Id vid = videoId('Published One');
        User u = insertTestUser();
        TrainingVideoController.assignToAudience(vid, null, new List<Id>{u.Id}, false);

        Test.startTest();
        List<TrainingVideoController.AssignmentRow> rows = TrainingVideoController.getAssignments(vid);
        Test.stopTest();

        Boolean found = false;
        for (TrainingVideoController.AssignmentRow r : rows) {
            if (r.userId == u.Id) {
                found = true;
                System.assertEquals(true, r.assigned, 'Row should be flagged assigned');
            }
        }
        System.assert(found, 'The assigned user should appear in the tracking rows');
    }

    @isTest
    static void getAssignments_excludesNonAssignedSelfViews() {
        Id vid = videoId('Published One');
        // A self-initiated (non-assigned) view by the running user — should NOT appear.
        TrainingVideoController.recordProgress(vid, 100, true);
        // An assigned user — should appear.
        User u = insertTestUser();
        TrainingVideoController.assignToAudience(vid, null, new List<Id>{u.Id}, false);

        Test.startTest();
        List<TrainingVideoController.AssignmentRow> rows = TrainingVideoController.getAssignments(vid);
        Test.stopTest();

        Boolean foundAssigned = false;
        for (TrainingVideoController.AssignmentRow r : rows) {
            System.assertEquals(true, r.assigned, 'Only assigned rows should be returned');
            System.assertNotEquals(UserInfo.getUserId(), r.userId, 'A non-assigned self-view must be excluded');
            if (r.userId == u.Id) {
                foundAssigned = true;
            }
        }
        System.assert(foundAssigned, 'The assigned user should be present');
    }

    @isTest
    static void removeAllAssignments_clearsRoster() {
        Id vid = videoId('Published One');
        User u = insertTestUser();
        // Assign the running user + a test user.
        TrainingVideoController.assignToAudience(vid, null, new List<Id>{u.Id, UserInfo.getUserId()}, false);
        // Running user engages with it (so their row is kept, un-assigned); u stays Pending/unwatched.
        TrainingVideoController.recordProgress(vid, 50, false);

        Test.startTest();
        TrainingVideoController.removeAllAssignments(vid);
        Test.stopTest();

        System.assertEquals(
            0,
            [SELECT COUNT() FROM Training_View__c WHERE Training_Video__c = :vid AND Assigned__c = TRUE],
            'No assigned rows should remain'
        );
        System.assertEquals(
            1,
            [SELECT COUNT() FROM Training_View__c WHERE Training_Video__c = :vid AND User__c = :UserInfo.getUserId()],
            'A watched user keeps their history (un-assigned, not deleted)'
        );
    }

    @isTest
    static void removeAssignment_deletesPendingUnwatched() {
        Id vid = videoId('Published One');
        User u = insertTestUser();
        TrainingVideoController.assignToAudience(vid, null, new List<Id>{u.Id}, false);
        Training_View__c v = [SELECT Id FROM Training_View__c WHERE Training_Video__c = :vid AND User__c = :u.Id];

        Test.startTest();
        TrainingVideoController.removeAssignment(v.Id);
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Training_View__c WHERE Id = :v.Id], 'Unwatched pending assignment should be deleted');
    }

    // ─── Single video file ───

    @isTest
    static void replaceVideoFile_enforcesSingleFile() {
        Id vid = videoId('Published One');

        ContentVersion cv1 = new ContentVersion(Title = 'Old', PathOnClient = 'old.mp4', VersionData = Blob.valueOf('old'));
        insert cv1;
        Id doc1 = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv1.Id].ContentDocumentId;
        insert new ContentDocumentLink(ContentDocumentId = doc1, LinkedEntityId = vid, ShareType = 'V');

        ContentVersion cv2 = new ContentVersion(Title = 'New', PathOnClient = 'new.mp4', VersionData = Blob.valueOf('new'));
        insert cv2;
        Id doc2 = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv2.Id].ContentDocumentId;
        insert new ContentDocumentLink(ContentDocumentId = doc2, LinkedEntityId = vid, ShareType = 'V');

        Test.startTest();
        TrainingVideoController.replaceVideoFile(vid, cv2.Id);
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM ContentDocument WHERE Id = :doc1], 'The previous file should be removed');
        System.assertEquals(1, [SELECT COUNT() FROM ContentDocument WHERE Id = :doc2], 'The new file should remain');
        System.assertEquals(
            String.valueOf(cv2.Id),
            [SELECT Video_Content_Version_Id__c FROM Training_Video__c WHERE Id = :vid].Video_Content_Version_Id__c,
            'The new ContentVersion should be pinned'
        );
    }

    @isTest
    static void setUploadedVideo_pinsDocumentLatestVersion() {
        Id vid = videoId('Published One');
        ContentVersion cv = new ContentVersion(Title = 'Fresh', PathOnClient = 'fresh.mp4', VersionData = Blob.valueOf('bytes'));
        insert cv;
        Id docId = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id].ContentDocumentId;
        insert new ContentDocumentLink(ContentDocumentId = docId, LinkedEntityId = vid, ShareType = 'V');

        Test.startTest();
        TrainingVideoController.setUploadedVideo(vid, docId);
        Test.stopTest();

        System.assertEquals(
            String.valueOf(cv.Id),
            [SELECT Video_Content_Version_Id__c FROM Training_Video__c WHERE Id = :vid].Video_Content_Version_Id__c,
            'The uploaded document\'s latest version should be pinned'
        );
    }

    @isTest
    static void setUploadedVideo_rejectsAndDeletesOversize() {
        Id vid = videoId('Published One');
        ContentVersion cv = new ContentVersion(Title = 'Big', PathOnClient = 'big.mp4', VersionData = Blob.valueOf('some bytes'));
        insert cv;
        Id docId = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id].ContentDocumentId;
        insert new ContentDocumentLink(ContentDocumentId = docId, LinkedEntityId = vid, ShareType = 'V');

        // Force any non-empty file to be "over" the limit.
        TrainingVideoController.maxBytesOverride = 1;

        Test.startTest();
        Boolean threw = false;
        try {
            TrainingVideoController.setUploadedVideo(vid, docId);
        } catch (Exception e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'Oversized upload should be rejected');
        System.assertEquals(0, [SELECT COUNT() FROM ContentDocument WHERE Id = :docId], 'Oversized file should be deleted');
        System.assertEquals(
            null,
            [SELECT Video_Content_Version_Id__c FROM Training_Video__c WHERE Id = :vid].Video_Content_Version_Id__c,
            'No file should be pinned when rejected'
        );
    }

    @isTest
    static void getCurrentVideoFile_returnsPinnedFile() {
        Id vid = videoId('Published One');
        ContentVersion cv = new ContentVersion(Title = 'Clip', PathOnClient = 'clip.mp4', VersionData = Blob.valueOf('bytes'));
        insert cv;
        TrainingVideoController.setVideoFile(vid, cv.Id);

        Test.startTest();
        TrainingVideoController.Option file = TrainingVideoController.getCurrentVideoFile(vid);
        Test.stopTest();

        System.assertNotEquals(null, file, 'Current file should be returned');
        System.assert(file.label.startsWith('Clip.mp4'), 'Label should start with title.extension: ' + file.label);
    }

    @isTest
    static void getPlayback_nullVideoThrows() {
        Test.startTest();
        try {
            TrainingVideoController.getPlayback(null);
            System.assert(false, 'Expected an exception for a null video');
        } catch (Exception e) {
            System.assert(true, 'Exception thrown as expected');
        }
        Test.stopTest();
    }
}
