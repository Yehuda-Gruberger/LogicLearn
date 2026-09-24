/**
 * @description Controller for the Training Video Library. Serves the library grouped by
 * folder, resolves the playable ContentVersion for a video, and records per-employee watch
 * progress / completion in Training_View__c (one row per user per video, keyed by
 * User_Video_Key__c). Mirrors the recorder shape of PageVisitLogController but tracks watch-%
 * and completion rather than a single hit.
 */
public without sharing class TrainingVideoController {
    // A view is considered complete once the user has watched at least this % of the video.
    @TestVisible
    private static final Decimal COMPLETION_THRESHOLD = 90;

    // Video Status__c values that are visible to end users in the library.
    private static final Set<String> VISIBLE_STATUSES = new Set<String>{ 'Published' };

    // ───────────────────────── Wrappers ─────────────────────────

    public class FolderSection {
        @AuraEnabled public String folderId { get; set; }
        @AuraEnabled public String folderName { get; set; }
        @AuraEnabled public String description { get; set; }
        @AuraEnabled public String icon { get; set; }
        @AuraEnabled public List<VideoInfo> videos { get; set; }

        public FolderSection() {
            this.videos = new List<VideoInfo>();
        }
    }

    public class VideoInfo {
        @AuraEnabled public Id id { get; set; }
        @AuraEnabled public String title { get; set; }
        @AuraEnabled public String description { get; set; }
        @AuraEnabled public String category { get; set; }
        @AuraEnabled public Boolean isMandatory { get; set; }
        @AuraEnabled public Integer durationSeconds { get; set; }
        @AuraEnabled public Date dueDate { get; set; }
        @AuraEnabled public Datetime createdDate { get; set; }
        @AuraEnabled public String previewUrl { get; set; }
        @AuraEnabled public String thumbnailUrl { get; set; }
        @AuraEnabled public String viewStatus { get; set; } // Pending / In Progress / Completed / null
        @AuraEnabled public Decimal watchPercent { get; set; }
        @AuraEnabled public Datetime completedAt { get; set; }
        @AuraEnabled public String contentType { get; set; }
        @AuraEnabled public Integer pageCount { get; set; }
        @AuraEnabled public String documentPreview { get; set; }
    }

    public class FolderInfo {
        @AuraEnabled public Id id { get; set; }
        @AuraEnabled public String name { get; set; }
        @AuraEnabled public Id parentId { get; set; }
        @AuraEnabled public Decimal sortOrder { get; set; }
    }

    public class PlaybackInfo {
        @AuraEnabled public Id videoId { get; set; }
        @AuraEnabled public String title { get; set; }
        @AuraEnabled public String contentVersionId { get; set; }
        @AuraEnabled public String videoUrl { get; set; }
        @AuraEnabled public String viewStatus { get; set; }
        @AuraEnabled public Decimal resumePercent { get; set; }
        @AuraEnabled public Boolean isMandatory { get; set; }
        @AuraEnabled public Boolean isExternal { get; set; }
        @AuraEnabled public String externalUrl { get; set; }
        @AuraEnabled public Boolean preventSkipping { get; set; }
        @AuraEnabled public Date dueDate { get; set; }
    }

    public class DocumentPage {
        @AuraEnabled public Id id { get; set; }
        @AuraEnabled public String title { get; set; }
        @AuraEnabled public String body { get; set; }
        @AuraEnabled public Integer pageNumber { get; set; }
    }

    public class DocumentInfo {
        @AuraEnabled public Id videoId { get; set; }
        @AuraEnabled public String title { get; set; }
        @AuraEnabled public List<DocumentPage> pages { get; set; }
        @AuraEnabled public Integer currentPage { get; set; }
        @AuraEnabled public String viewStatus { get; set; }
        @AuraEnabled public Decimal watchPercent { get; set; }
        @AuraEnabled public String pageRequirement { get; set; }
        @AuraEnabled public String readingOrder { get; set; }
        @AuraEnabled public String completionMode { get; set; }
        @AuraEnabled public List<Integer> pagesRead { get; set; }
    }

    public class DocumentProgress {
        @AuraEnabled public Boolean completed { get; set; }
        @AuraEnabled public Decimal watchPercent { get; set; }
        @AuraEnabled public List<Integer> pagesRead { get; set; }
    }

    // ───────────────────────── Library ─────────────────────────

    /**
     * @description Returns the library grouped into folder sections, each carrying the running
     * user's own view status per video. Optionally filtered by folder and/or category.
     * @param folderId Optional Training_Folder__c Id to limit to a single folder
     * @param category Optional Category__c value to filter by
     * @return List<FolderSection> ordered by folder Sort_Order__c, then video Sort_Order__c
     */
    @AuraEnabled
    public static List<FolderSection> getLibrary(String folderId, String category) {
        List<Training_Video__c> videos = queryLibraryVideos(folderId, category);
        Set<Id> candidateIds = new Map<Id, Training_Video__c>(videos).keySet();
        Set<Id> visibleIds = LogicLearnAudienceService.isAdmin()
            ? candidateIds
            : LogicLearnAudienceService.videoIdsForUser(UserInfo.getUserId(), 'Visibility', candidateIds);
        Set<Id> requiredIds = LogicLearnAudienceService.videoIdsForUser(UserInfo.getUserId(), 'Required', candidateIds);
        List<Training_Video__c> allowedVideos = new List<Training_Video__c>();
        for (Training_Video__c video : videos) if (visibleIds.contains(video.Id)) allowedVideos.add(video);
        videos = allowedVideos;

        Map<Id, Integer> pageCountsByVideo = new Map<Id, Integer>();
        Map<Id, String> documentPreviewsByVideo = new Map<Id, String>();
        Set<Id> documentIds = new Set<Id>();
        for (Training_Video__c video : videos) {
            if (video.Content_Type__c == 'Document') documentIds.add(video.Id);
        }
        if (!documentIds.isEmpty()) {
            for (AggregateResult row : [
                SELECT Training_Video__c videoId, COUNT(Id) pageCount
                FROM Training_Tutorial_Page__c
                WHERE Training_Video__c IN :documentIds
                GROUP BY Training_Video__c
            ]) {
                pageCountsByVideo.put((Id) row.get('videoId'), (Integer) row.get('pageCount'));
            }
            for (Training_Tutorial_Page__c page : [
                SELECT Training_Video__c, Body__c
                FROM Training_Tutorial_Page__c
                WHERE Training_Video__c IN :documentIds
                ORDER BY Training_Video__c, Page_Number__c, CreatedDate
            ]) {
                if (!documentPreviewsByVideo.containsKey(page.Training_Video__c)) {
                    documentPreviewsByVideo.put(page.Training_Video__c, previewDocumentBody(page.Body__c));
                }
            }
        }

        // Running user's view rows for these videos, keyed by video Id.
        Map<Id, Training_View__c> viewsByVideo = new Map<Id, Training_View__c>();
        for (Training_View__c v : [
            SELECT Training_Video__c, Status__c, Watch_Percent__c, Completed_At__c, Assigned__c
            FROM Training_View__c
            WHERE User__c = :UserInfo.getUserId()
            AND Training_Video__c IN :videos
        ]) {
            viewsByVideo.put(v.Training_Video__c, v);
        }

        // Preserve query order (folder sort, then video sort) while grouping into sections.
        Map<String, FolderSection> sectionByKey = new Map<String, FolderSection>();
        List<FolderSection> ordered = new List<FolderSection>();

        for (Training_Video__c vid : videos) {
            String key = vid.Folder__c != null ? String.valueOf(vid.Folder__c) : 'none';
            FolderSection section = sectionByKey.get(key);
            if (section == null) {
                section = new FolderSection();
                if (vid.Folder__c != null) {
                    section.folderId = vid.Folder__c;
                    section.folderName = vid.Folder__r.Name;
                    section.description = vid.Folder__r.Description__c;
                    section.icon = vid.Folder__r.Icon__c;
                } else {
                    section.folderName = 'Ungrouped';
                }
                sectionByKey.put(key, section);
                ordered.add(section);
            }

            VideoInfo info = new VideoInfo();
            info.id = vid.Id;
            info.title = vid.Name;
            info.description = vid.Description__c;
            info.category = vid.Category__c;
            info.durationSeconds = vid.Duration_Seconds__c != null ? Integer.valueOf(vid.Duration_Seconds__c) : null;
            info.dueDate = vid.Due_Date__c;
            info.createdDate = vid.CreatedDate;
            info.previewUrl = vid.Content_Type__c != 'External Link' && String.isNotBlank(vid.Video_Content_Version_Id__c)
                ? '/sfc/servlet.shepherd/version/download/' + vid.Video_Content_Version_Id__c
                : null;
            info.thumbnailUrl = buildThumbnailUrl(vid.Video_Content_Version_Id__c);
            info.contentType = vid.Content_Type__c;
            info.pageCount = pageCountsByVideo.containsKey(vid.Id) ? pageCountsByVideo.get(vid.Id) : 0;
            info.documentPreview = documentPreviewsByVideo.get(vid.Id);

            Training_View__c view = viewsByVideo.get(vid.Id);
            // Mandatory is per-user: only when this user was actually assigned the video.
            info.isMandatory = requiredIds.contains(vid.Id) || (view != null && view.Assigned__c == true);
            if (view != null) {
                info.viewStatus = view.Status__c;
                info.watchPercent = view.Watch_Percent__c;
                info.completedAt = view.Completed_At__c;
            }
            section.videos.add(info);
        }

        return ordered;
    }

    /**
     * @description Returns every folder with its parent, so the client can render the folder
     * hierarchy in the library rail. Ordered by Sort_Order__c then Name.
     */
    @AuraEnabled
    public static List<FolderInfo> getFolders() {
        List<FolderInfo> result = new List<FolderInfo>();
        for (Training_Folder__c f : [
            SELECT Id, Name, Parent_Folder__c, Sort_Order__c
            FROM Training_Folder__c
            ORDER BY Sort_Order__c NULLS LAST, Name
        ]) {
            FolderInfo fi = new FolderInfo();
            fi.id = f.Id;
            fi.name = f.Name;
            fi.parentId = f.Parent_Folder__c;
            fi.sortOrder = f.Sort_Order__c;
            result.add(fi);
        }
        return result;
    }

    private static List<Training_Video__c> queryLibraryVideos(String folderId, String category) {
        String soql =
            'SELECT Id, Name, Description__c, Category__c, Status__c, Duration_Seconds__c, Due_Date__c, CreatedDate, ' +
            'Content_Type__c, Video_Content_Version_Id__c, ' +
            'Folder__c, Folder__r.Name, Folder__r.Description__c, Folder__r.Icon__c, ' +
            'Folder__r.Sort_Order__c, Sort_Order__c ' +
            'FROM Training_Video__c ' +
            'WHERE Status__c IN :VISIBLE_STATUSES ';
        if (String.isNotBlank(folderId)) {
            soql += 'AND Folder__c = :folderId ';
        }
        if (String.isNotBlank(category)) {
            soql += 'AND Category__c = :category ';
        }
        soql += 'ORDER BY Folder__r.Sort_Order__c NULLS LAST, Folder__r.Name NULLS LAST, ' +
            'Sort_Order__c NULLS LAST, Name';
        return Database.query(soql);
    }

    @AuraEnabled
    public static DocumentInfo getDocument(Id videoId) {
        if (videoId == null || !LogicLearnAudienceService.canUserSeeVideo(UserInfo.getUserId(), videoId))
            throw new AuraHandledException('You do not have access to this tutorial.');
        Training_Video__c video = [SELECT Id, Name, Content_Type__c, Document_Page_Requirement__c,
            Document_Reading_Order__c, Document_Completion_Mode__c FROM Training_Video__c WHERE Id = :videoId LIMIT 1];
        if (video.Content_Type__c != 'Document') throw new AuraHandledException('This tutorial is not a read tutorial.');
        Training_View__c view = ensureViewOnOpen(videoId);
        DocumentInfo result = new DocumentInfo();
        result.videoId = video.Id; result.title = video.Name; result.pages = new List<DocumentPage>();
        for (Training_Tutorial_Page__c page : [
            SELECT Id, Name, Body__c, Page_Number__c FROM Training_Tutorial_Page__c
            WHERE Training_Video__c = :videoId ORDER BY Page_Number__c, CreatedDate
        ]) {
            DocumentPage item = new DocumentPage();
            item.id = page.Id; item.title = page.Name; item.body = page.Body__c;
            item.pageNumber = Integer.valueOf(page.Page_Number__c); result.pages.add(item);
        }
        result.viewStatus = view.Status__c;
        result.watchPercent = view.Watch_Percent__c == null ? 0 : view.Watch_Percent__c;
        LogicLearn_Settings__c globalSettings = LogicLearnAdminController.settingsRow();
        result.pageRequirement = String.isBlank(video.Document_Page_Requirement__c) ? (String.isBlank(globalSettings.Document_Page_Requirement__c) ? 'Every page' : globalSettings.Document_Page_Requirement__c) : video.Document_Page_Requirement__c;
        result.readingOrder = String.isBlank(video.Document_Reading_Order__c) ? (String.isBlank(globalSettings.Document_Reading_Order__c) ? 'In order' : globalSettings.Document_Reading_Order__c) : video.Document_Reading_Order__c;
        result.completionMode = String.isBlank(video.Document_Completion_Mode__c) ? (String.isBlank(globalSettings.Document_Completion_Mode__c) ? 'Finish on last page' : globalSettings.Document_Completion_Mode__c) : video.Document_Completion_Mode__c;
        result.pagesRead = parsePagesRead(view.Document_Pages_Read__c);
        Integer pageCount = result.pages.size();
        Integer inferredPage = pageCount == 0 ? 0 : Math.min(pageCount, Math.max(1,
            Integer.valueOf(Math.floor((result.watchPercent / 100) * pageCount)) + 1));
        result.currentPage = pageCount == 0 ? 0 : (view.Document_Current_Page__c == null
            ? inferredPage
            : Math.min(pageCount, Math.max(1, Integer.valueOf(view.Document_Current_Page__c))));
        return result;
    }

    @AuraEnabled
    public static DocumentProgress recordDocumentProgress(Id videoId, Integer pageNumber, Integer totalPages, Boolean finishRequested, Integer currentPageNumber) {
        if (videoId == null || !LogicLearnAudienceService.canUserSeeVideo(UserInfo.getUserId(), videoId))
            throw new AuraHandledException('You do not have access to this tutorial.');
        Training_Video__c video = [SELECT Content_Type__c, Document_Page_Requirement__c,
            Document_Reading_Order__c, Document_Completion_Mode__c FROM Training_Video__c WHERE Id = :videoId LIMIT 1];
        if (video.Content_Type__c != 'Document') throw new AuraHandledException('This tutorial is not a read tutorial.');
        Integer total = totalPages == null || totalPages < 1 ? 1 : totalPages;
        Integer reached = pageNumber == null ? 1 : Math.max(1, Math.min(pageNumber, total));
        String key = buildKey(videoId);
        List<Training_View__c> existing = [
            SELECT Id, Status__c, Watch_Percent__c, Completed_At__c, Completion_Method__c,
                Document_Pages_Read__c, Document_Current_Page__c
            FROM Training_View__c WHERE User_Video_Key__c = :key LIMIT 1
        ];
        Training_View__c view = existing.isEmpty() ? ensureViewOnOpen(videoId) : existing[0];
        Set<Integer> pagesRead = new Set<Integer>(parsePagesRead(view.Document_Pages_Read__c));
        LogicLearn_Settings__c globalSettings = LogicLearnAdminController.settingsRow();
        String readingOrder = String.isBlank(video.Document_Reading_Order__c) ? (String.isBlank(globalSettings.Document_Reading_Order__c) ? 'In order' : globalSettings.Document_Reading_Order__c) : video.Document_Reading_Order__c;
        Integer sequentialRead = 0;
        while (pagesRead.contains(sequentialRead + 1)) sequentialRead++;
        if (readingOrder == 'Any order' || reached <= sequentialRead + 1) pagesRead.add(reached);
        List<Integer> sortedPages = new List<Integer>(pagesRead); sortedPages.sort();
        List<String> pageTokens = new List<String>(); for (Integer numberRead : sortedPages) pageTokens.add(String.valueOf(numberRead));
        view.Document_Pages_Read__c = String.join(pageTokens, ',');
        view.Document_Current_Page__c = Math.max(1, Math.min(currentPageNumber == null ? reached : currentPageNumber, total));
        Decimal percent = (Decimal.valueOf(String.valueOf(pagesRead.size())) / total * 100).setScale(0);
        if (view.Watch_Percent__c == null || percent > view.Watch_Percent__c) view.Watch_Percent__c = percent;
        view.Last_Viewed_At__c = System.now();
        String pageRequirement = String.isBlank(video.Document_Page_Requirement__c) ? (String.isBlank(globalSettings.Document_Page_Requirement__c) ? 'Every page' : globalSettings.Document_Page_Requirement__c) : video.Document_Page_Requirement__c;
        String completionMode = String.isBlank(video.Document_Completion_Mode__c) ? (String.isBlank(globalSettings.Document_Completion_Mode__c) ? 'Finish on last page' : globalSettings.Document_Completion_Mode__c) : video.Document_Completion_Mode__c;
        Boolean requirementMet = pageRequirement == 'Final page only' ? pagesRead.contains(total) : pagesRead.size() >= total;
        Boolean shouldComplete = requirementMet && (completionMode == 'Automatic' || (finishRequested == true && reached == total));
        if (shouldComplete) {
            view.Status__c = 'Completed'; view.Watch_Percent__c = 100;
            if (view.Completed_At__c == null) view.Completed_At__c = System.now();
            view.Completion_Method__c = 'Tracked';
        } else if (view.Status__c != 'Completed') {
            view.Status__c = 'In Progress';
        }
        update view;
        DocumentProgress result = new DocumentProgress();
        result.completed = view.Status__c == 'Completed'; result.watchPercent = view.Watch_Percent__c;
        result.pagesRead = sortedPages; return result;
    }

    private static List<Integer> parsePagesRead(String stored) {
        List<Integer> result = new List<Integer>();
        if (String.isBlank(stored)) return result;
        for (String token : stored.split(',')) {
            try { Integer value = Integer.valueOf(token); if (value > 0 && !result.contains(value)) result.add(value); }
            catch (Exception ignored) { }
        }
        result.sort(); return result;
    }

    // ───────────────────────── Playback ─────────────────────────

    /**
     * @description Resolves the ContentVersion to play for a video and ensures the running user
     * has a Training_View__c row (created Pending on first open, view count bumped otherwise).
     * @param videoId The Training_Video__c Id
     * @return PlaybackInfo with the content version id, a streaming URL, and resume data
     */
    @AuraEnabled
    public static PlaybackInfo getPlayback(Id videoId) {
        if (videoId == null) {
            throw new AuraHandledException('No video specified.');
        }

        if (!LogicLearnAudienceService.canUserSeeVideo(UserInfo.getUserId(), videoId)) {
            throw new AuraHandledException('You do not have access to this training video.');
        }
        List<Training_Video__c> videos = [
            SELECT Id, Name, Video_Content_Version_Id__c, Status__c, Content_Type__c,
                External_URL__c, Skip_Prevention__c, Due_Date__c
            FROM Training_Video__c
            WHERE Id = :videoId
            LIMIT 1
        ];
        if (videos.isEmpty()) {
            throw new AuraHandledException('You do not have access to this training video.');
        }
        Training_Video__c video = videos[0];

        Boolean required = LogicLearnAudienceService.videoIdsForUser(
            UserInfo.getUserId(), 'Required', new Set<Id>{videoId}
        ).contains(videoId);

        String cvId = video.Content_Type__c == 'External Link' ? null : String.isNotBlank(video.Video_Content_Version_Id__c)
            ? video.Video_Content_Version_Id__c
            : resolveLatestVideoContentVersion(videoId);

        // View tracking must never block playback — if the row can't be written (e.g. the org
        // is over its storage limit), the video still plays; we just skip the tracking update.
        Training_View__c view;
        try {
            view = ensureViewOnOpen(videoId);
        } catch (Exception e) {
            System.debug('getPlayback - view tracking skipped: ' + e.getMessage());
            view = null;
        }

        PlaybackInfo info = new PlaybackInfo();
        info.videoId = videoId;
        info.title = video.Name;
        info.contentVersionId = cvId;
        info.videoUrl = String.isNotBlank(cvId) ? '/sfc/servlet.shepherd/version/download/' + cvId : null;
        info.viewStatus = view != null ? view.Status__c : null;
        info.resumePercent = view != null ? view.Watch_Percent__c : 0;
        info.isMandatory = required;
        info.isExternal = video.Content_Type__c == 'External Link';
        info.externalUrl = video.External_URL__c;
        info.dueDate = video.Due_Date__c;
        Boolean globalSkip = LogicLearnAdminController.settingsRow().Prevent_Skipping__c;
        info.preventSkipping = required && (video.Skip_Prevention__c == 'Enabled' ||
            (video.Skip_Prevention__c != 'Disabled' && globalSkip));
        return info;
    }

    /** Administrative preview that never creates or updates learner tracking. */
    @AuraEnabled
    public static PlaybackInfo getAdminPreview(Id videoId) {
        LogicLearnAudienceService.requireAdmin();
        if (videoId == null) throw new AuraHandledException('No video specified.');
        Training_Video__c video = [
            SELECT Id, Name, Video_Content_Version_Id__c, Content_Type__c, External_URL__c, Due_Date__c
            FROM Training_Video__c WHERE Id = :videoId LIMIT 1
        ];
        String cvId = video.Content_Type__c == 'External Link' ? null : String.isNotBlank(video.Video_Content_Version_Id__c)
            ? video.Video_Content_Version_Id__c : resolveLatestVideoContentVersion(videoId);
        PlaybackInfo info = new PlaybackInfo();
        info.videoId = video.Id;
        info.title = video.Name;
        info.contentVersionId = cvId;
        info.videoUrl = String.isNotBlank(cvId) ? '/sfc/servlet.shepherd/version/download/' + cvId : null;
        info.resumePercent = 0;
        info.isMandatory = false;
        info.isExternal = video.Content_Type__c == 'External Link';
        info.externalUrl = video.External_URL__c;
        info.dueDate = video.Due_Date__c;
        info.preventSkipping = false;
        return info;
    }

    /**
     * @description Falls back to the latest file linked to the record when no ContentVersion has
     * been explicitly pinned. Prefers common video file types.
     */
    private static String resolveLatestVideoContentVersion(Id videoId) {
        Set<Id> docIds = new Set<Id>();
        for (ContentDocumentLink link : [
            SELECT ContentDocumentId
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :videoId
        ]) {
            docIds.add(link.ContentDocumentId);
        }
        if (docIds.isEmpty()) {
            return null;
        }

        Set<String> videoTypes = new Set<String>{ 'MP4', 'MOV', 'M4V', 'WEBM', 'OGV' };
        ContentVersion fallback;
        for (ContentVersion cv : [
            SELECT Id, FileType, ContentModifiedDate
            FROM ContentVersion
            WHERE ContentDocumentId IN :docIds AND IsLatest = TRUE
            ORDER BY ContentModifiedDate DESC
        ]) {
            if (fallback == null) {
                fallback = cv;
            }
            if (videoTypes.contains(cv.FileType)) {
                return cv.Id;
            }
        }
        return fallback != null ? fallback.Id : null;
    }

    /**
     * @description Ensures a Training_View__c exists for the running user + video. On first open
     * it is created Pending; on subsequent opens the view count is bumped and last-viewed stamped
     * (without regressing a completed row).
     */
    private static Training_View__c ensureViewOnOpen(Id videoId) {
        String key = buildKey(videoId);
        List<Training_View__c> existing = [
            SELECT Id, User_Video_Key__c, Status__c, Watch_Percent__c, View_Count__c,
                First_Viewed_At__c, Completed_At__c, Assigned__c, Document_Pages_Read__c, Document_Current_Page__c
            FROM Training_View__c
            WHERE User_Video_Key__c = :key
            LIMIT 1
        ];

        Training_View__c view;
        if (existing.isEmpty()) {
            view = new Training_View__c(
                Training_Video__c = videoId,
                User__c = UserInfo.getUserId(),
                Status__c = 'Pending',
                Watch_Percent__c = 0,
                View_Count__c = 1,
                First_Viewed_At__c = System.now(),
                Last_Viewed_At__c = System.now()
            );
        } else {
            view = existing[0];
            view.View_Count__c = (view.View_Count__c == null ? 0 : view.View_Count__c) + 1;
            view.Last_Viewed_At__c = System.now();
        }
        // Always populate the external-id field so upsert-by-external-id succeeds on both the
        // insert (race-safe) and the re-query/update paths.
        view.User_Video_Key__c = key;
        upsert view User_Video_Key__c;
        return view;
    }

    // ───────────────────────── Progress ─────────────────────────

    /**
     * @description Records the running user's progress through a video. Raises the stored
     * watch-% to the max seen, flips the row to In Progress once watching starts, and to
     * Completed once the threshold is reached or the video ends.
     * @param videoId The Training_Video__c Id
     * @param percent The percentage (0-100) of the video watched so far
     * @param ended   True when the video reached its end
     */
    @AuraEnabled
    public static void recordProgress(Id videoId, Decimal percent, Boolean ended) {
        if (videoId == null) {
            return;
        }
        if (!LogicLearnAudienceService.canUserSeeVideo(UserInfo.getUserId(), videoId)) {
            throw new AuraHandledException('You do not have access to this training video.');
        }
        Training_Video__c video = [SELECT Completion_Threshold__c, Content_Type__c FROM Training_Video__c WHERE Id = :videoId LIMIT 1];
        if (video.Content_Type__c == 'External Link') throw new AuraHandledException('External videos use manual completion.');
        Decimal threshold = video.Completion_Threshold__c == null
            ? LogicLearnAdminController.settingsRow().Completion_Threshold__c
            : video.Completion_Threshold__c;
        Decimal pct = percent == null ? 0 : percent;
        String key = buildKey(videoId);

        List<Training_View__c> existing = [
            SELECT Id, User_Video_Key__c, Status__c, Watch_Percent__c, View_Count__c,
                First_Viewed_At__c, Completed_At__c
            FROM Training_View__c
            WHERE User_Video_Key__c = :key
            LIMIT 1
        ];

        Training_View__c view;
        if (existing.isEmpty()) {
            view = new Training_View__c(
                Training_Video__c = videoId,
                User__c = UserInfo.getUserId(),
                Watch_Percent__c = 0,
                View_Count__c = 1,
                First_Viewed_At__c = System.now()
            );
        } else {
            view = existing[0];
        }

        view.Last_Viewed_At__c = System.now();
        if (view.Watch_Percent__c == null || pct > view.Watch_Percent__c) {
            view.Watch_Percent__c = pct;
        }

        if (view.Status__c != 'Completed') {
            if (ended == true || view.Watch_Percent__c >= threshold) {
                view.Status__c = 'Completed';
                view.Completed_At__c = System.now();
                view.Completion_Method__c = 'Tracked';
            } else if (view.Watch_Percent__c > 0) {
                view.Status__c = 'In Progress';
            } else {
                view.Status__c = 'Pending';
            }
        }

        // Populate the external-id field so upsert-by-external-id works on both insert and update.
        view.User_Video_Key__c = key;
        upsert view User_Video_Key__c;
    }

    @AuraEnabled
    public static void markExternalComplete(Id videoId) {
        if (videoId == null || !LogicLearnAudienceService.canUserSeeVideo(UserInfo.getUserId(), videoId)) {
            throw new AuraHandledException('You do not have access to this training video.');
        }
        Training_Video__c video = [SELECT Content_Type__c FROM Training_Video__c WHERE Id = :videoId LIMIT 1];
        if (video.Content_Type__c != 'External Link') throw new AuraHandledException('Only external videos can be completed manually.');
        Training_View__c view = ensureViewOnOpen(videoId);
        view.Status__c = 'Completed';
        view.Watch_Percent__c = 100;
        view.Completed_At__c = System.now();
        view.Last_Viewed_At__c = System.now();
        view.Completion_Method__c = 'Manual';
        update view;
    }

    // ───────────────────────── My Training ─────────────────────────

    /**
     * @description Returns the running user's outstanding (Pending / In Progress) training for
     * videos still Published or Mandatory, mandatory first. Drives the "My Training" component.
     */
    @AuraEnabled
    public static List<VideoInfo> getMyPending() {
        List<Training_Video__c> candidates = [
            SELECT Id, Name, Category__c FROM Training_Video__c
            WHERE Status__c IN :VISIBLE_STATUSES ORDER BY Name
        ];
        Set<Id> candidateIds = new Map<Id, Training_Video__c>(candidates).keySet();
        Set<Id> visibleIds = LogicLearnAudienceService.isAdmin() ? candidateIds :
            LogicLearnAudienceService.videoIdsForUser(UserInfo.getUserId(), 'Visibility', candidateIds);
        Set<Id> requiredIds = LogicLearnAudienceService.videoIdsForUser(UserInfo.getUserId(), 'Required', candidateIds);
        Map<Id, Training_View__c> views = new Map<Id, Training_View__c>();
        for (Training_View__c view : [
            SELECT Training_Video__c, Status__c, Watch_Percent__c, Assigned__c
            FROM Training_View__c WHERE User__c = :UserInfo.getUserId() AND Training_Video__c IN :visibleIds
        ]) views.put(view.Training_Video__c, view);
        List<VideoInfo> mandatory = new List<VideoInfo>();
        List<VideoInfo> optional = new List<VideoInfo>();
        for (Training_Video__c video : candidates) {
            if (!visibleIds.contains(video.Id)) continue;
            Training_View__c view = views.get(video.Id);
            Boolean isRequired = requiredIds.contains(video.Id) || (view != null && view.Assigned__c == true);
            if (!isRequired && (view == null || view.Status__c == 'Completed')) continue;
            if (isRequired && view != null && view.Status__c == 'Completed') continue;
            VideoInfo info = new VideoInfo();
            info.id = video.Id;
            info.title = video.Name;
            info.category = video.Category__c;
            info.isMandatory = isRequired;
            info.viewStatus = view == null ? 'Pending' : view.Status__c;
            info.watchPercent = view == null ? 0 : view.Watch_Percent__c;
            if (info.isMandatory) {
                mandatory.add(info);
            } else {
                optional.add(info);
            }
        }
        mandatory.addAll(optional);
        return mandatory;
    }

    // ───────────────────────── Admin: pin the file ─────────────────────────

    /**
     * @description Stamps the chosen ContentVersion as the video to play for a record. Called
     * after an admin uploads the file. Requires edit access to the Training Video (admins only).
     * @param videoId The Training_Video__c Id
     * @param contentVersionId The ContentVersion Id of the uploaded video
     */
    @AuraEnabled
    public static void setVideoFile(Id videoId, Id contentVersionId) {
        LogicLearnAudienceService.requireAdmin();
        if (videoId == null || contentVersionId == null) {
            throw new AuraHandledException('A video and an uploaded file are required.');
        }
        update new Training_Video__c(
            Id = videoId,
            Video_Content_Version_Id__c = contentVersionId
        );
    }

    // ───────────────────────── Admin console ─────────────────────────

    public class VideoAdminRow {
        @AuraEnabled public Id id { get; set; }
        @AuraEnabled public String title { get; set; }
        @AuraEnabled public Id folderId { get; set; }
        @AuraEnabled public String folderName { get; set; }
        @AuraEnabled public String category { get; set; }
        @AuraEnabled public String status { get; set; }
        @AuraEnabled public Datetime createdDate { get; set; }
        @AuraEnabled public String createdByName { get; set; }
        @AuraEnabled public Boolean isMine { get; set; }
        @AuraEnabled public String previewUrl { get; set; }
        @AuraEnabled public String thumbnailUrl { get; set; }
        @AuraEnabled public String contentType { get; set; }
        @AuraEnabled public String documentPreview { get; set; }
        @AuraEnabled public Integer assignedCount { get; set; }
        @AuraEnabled public Integer completedCount { get; set; }
    }

    /** @description Whether the running user can manage the library (create Training Videos). */
    @AuraEnabled
    public static Boolean isLibraryAdmin() {
        return LogicLearnAudienceService.isAdmin();
    }

    /** @description Every video (all statuses, incl. Draft) with assignment/completion counts. */
    @AuraEnabled
    public static List<VideoAdminRow> getAdminVideos() {
        LogicLearnAudienceService.requireAdmin();
        Map<Id, Integer> assignedByVideo = new Map<Id, Integer>();
        Map<Id, Integer> completedByVideo = new Map<Id, Integer>();
        for (AggregateResult ar : [
            SELECT Training_Video__c vid, COUNT(Id) c
            FROM Training_View__c
            WHERE Assigned__c = TRUE
            GROUP BY Training_Video__c
        ]) {
            assignedByVideo.put((Id) ar.get('vid'), (Integer) ar.get('c'));
        }
        for (AggregateResult ar : [
            SELECT Training_Video__c vid, COUNT(Id) c
            FROM Training_View__c
            WHERE Assigned__c = TRUE AND Status__c = 'Completed'
            GROUP BY Training_Video__c
        ]) {
            completedByVideo.put((Id) ar.get('vid'), (Integer) ar.get('c'));
        }

        List<Training_Video__c> adminVideos = [
            SELECT Id, Name, Folder__c, Folder__r.Name, Category__c, Status__c, CreatedDate, CreatedById, CreatedBy.Name,
                Content_Type__c, Video_Content_Version_Id__c
            FROM Training_Video__c
            ORDER BY CreatedDate DESC
        ];
        Set<Id> adminDocumentIds = new Set<Id>();
        for (Training_Video__c video : adminVideos) if (video.Content_Type__c == 'Document') adminDocumentIds.add(video.Id);
        Map<Id, String> adminDocumentPreviews = new Map<Id, String>();
        if (!adminDocumentIds.isEmpty()) {
            for (Training_Tutorial_Page__c page : [
                SELECT Training_Video__c, Body__c
                FROM Training_Tutorial_Page__c
                WHERE Training_Video__c IN :adminDocumentIds
                ORDER BY Training_Video__c, Page_Number__c, CreatedDate
            ]) {
                if (!adminDocumentPreviews.containsKey(page.Training_Video__c)) {
                    adminDocumentPreviews.put(page.Training_Video__c, previewDocumentBody(page.Body__c));
                }
            }
        }

        List<VideoAdminRow> rows = new List<VideoAdminRow>();
        for (Training_Video__c v : adminVideos) {
            VideoAdminRow r = new VideoAdminRow();
            r.id = v.Id;
            r.title = v.Name;
            r.folderId = v.Folder__c;
            r.folderName = v.Folder__r.Name;
            r.category = v.Category__c;
            r.status = v.Status__c;
            r.createdDate = v.CreatedDate;
            r.createdByName = v.CreatedBy.Name;
            r.isMine = v.CreatedById == UserInfo.getUserId();
            r.contentType = v.Content_Type__c;
            r.previewUrl = v.Content_Type__c != 'External Link' && String.isNotBlank(v.Video_Content_Version_Id__c)
                ? '/sfc/servlet.shepherd/version/download/' + v.Video_Content_Version_Id__c
                : null;
            r.thumbnailUrl = buildThumbnailUrl(v.Video_Content_Version_Id__c);
            r.documentPreview = adminDocumentPreviews.get(v.Id);
            r.assignedCount = assignedByVideo.containsKey(v.Id) ? assignedByVideo.get(v.Id) : 0;
            r.completedCount = completedByVideo.containsKey(v.Id) ? completedByVideo.get(v.Id) : 0;
            rows.add(r);
        }
        return rows;
    }

    private static String buildThumbnailUrl(String contentVersionId) {
        return String.isBlank(contentVersionId)
            ? null
            : '/sfc/servlet.shepherd/version/renditionDownload?rendition=THUMB240BY180&versionId=' + contentVersionId;
    }

    private static String previewDocumentBody(String body) {
        if (String.isBlank(body)) return null;
        return body.length() > 2000 ? body.substring(0, 2000) : body;
    }

    // ───────────────────────── Admin: audience & assignments ─────────────────────────

    public class Option {
        @AuraEnabled public String id { get; set; }
        @AuraEnabled public String label { get; set; }
    }

    public class AssignmentRow {
        @AuraEnabled public Id id { get; set; }
        @AuraEnabled public Id userId { get; set; }
        @AuraEnabled public String userName { get; set; }
        @AuraEnabled public String status { get; set; }
        @AuraEnabled public Decimal watchPercent { get; set; }
        @AuraEnabled public Datetime completedAt { get; set; }
        @AuraEnabled public Boolean assigned { get; set; }
        @AuraEnabled public String assignedVia { get; set; }
        @AuraEnabled public Datetime notifiedAt { get; set; }
    }

    public class AssignResult {
        @AuraEnabled public Integer assigned { get; set; }
        @AuraEnabled public Integer notified { get; set; }
    }

    /** @description Profiles for the audience picker. */
    @AuraEnabled
    public static List<Option> getProfiles() {
        LogicLearnAudienceService.requireAdmin();
        List<Option> opts = new List<Option>();
        for (Profile p : [SELECT Id, Name FROM Profile ORDER BY Name]) {
            Option o = new Option();
            o.id = p.Id;
            o.label = p.Name;
            opts.add(o);
        }
        return opts;
    }

    /** @description Active-user search for the audience picker. */
    @AuraEnabled
    public static List<Option> searchUsers(String term) {
        LogicLearnAudienceService.requireAdmin();
        List<Option> opts = new List<Option>();
        String pattern = '%' + (term == null ? '' : String.escapeSingleQuotes(term)) + '%';
        for (User u : [
            SELECT Id, Name, Profile.Name
            FROM User
            WHERE IsActive = TRUE AND Name LIKE :pattern
            ORDER BY Name
            LIMIT 50
        ]) {
            Option o = new Option();
            o.id = u.Id;
            o.label = u.Profile.Name != null ? u.Name + ' (' + u.Profile.Name + ')' : u.Name;
            opts.add(o);
        }
        return opts;
    }

    /**
     * @description Assigns a video as mandatory to an audience: all active users in the chosen
     * profiles, plus the chosen users. Creates (or flags) one Training_View__c per user as an
     * assignment, and marks the video Mandatory. Idempotent via User_Video_Key__c.
     * @param notify when true, emails the users just assigned and stamps Notified_At__c
     * @return an AssignResult with the counts assigned and (if notify) emailed
     */
    @AuraEnabled
    public static AssignResult assignToAudience(Id videoId, List<Id> profileIds, List<Id> userIds, Boolean notify) {
        LogicLearnAudienceService.requireAdmin();
        if (videoId == null) {
            throw new AuraHandledException('No video specified.');
        }

        // Resolve the target user set with how each was reached (for the "Assigned Via" column).
        Map<Id, String> userToVia = new Map<Id, String>();
        if (profileIds != null && !profileIds.isEmpty()) {
            Map<Id, Profile> profs = new Map<Id, Profile>([SELECT Id, Name FROM Profile WHERE Id IN :profileIds]);
            for (User u : [SELECT Id, ProfileId FROM User WHERE IsActive = TRUE AND ProfileId IN :profileIds]) {
                userToVia.put(u.Id, profs.containsKey(u.ProfileId) ? profs.get(u.ProfileId).Name : 'Profile');
            }
        }
        if (userIds != null) {
            for (Id uid : userIds) {
                if (uid != null && !userToVia.containsKey(uid)) {
                    userToVia.put(uid, 'Directly assigned');
                }
            }
        }
        AssignResult result = new AssignResult();
        result.assigned = 0;
        result.notified = 0;
        if (userToVia.isEmpty()) {
            return result;
        }

        // Load any existing view rows so we flag rather than duplicate.
        Map<String, Training_View__c> existingByKey = new Map<String, Training_View__c>();
        Set<String> keys = new Set<String>();
        for (Id uid : userToVia.keySet()) {
            keys.add(uid + '-' + videoId);
        }
        for (Training_View__c v : [
            SELECT Id, User_Video_Key__c, Status__c
            FROM Training_View__c
            WHERE User_Video_Key__c IN :keys
        ]) {
            existingByKey.put(v.User_Video_Key__c, v);
        }

        List<Training_View__c> toUpsert = new List<Training_View__c>();
        for (Id uid : userToVia.keySet()) {
            String key = uid + '-' + videoId;
            Training_View__c v = existingByKey.get(key);
            if (v == null) {
                v = new Training_View__c(
                    Training_Video__c = videoId,
                    User__c = uid,
                    User_Video_Key__c = key,
                    Status__c = 'Pending',
                    Watch_Percent__c = 0,
                    View_Count__c = 0
                );
            }
            v.Assigned__c = true;
            v.Assigned_Via__c = userToVia.get(uid);
            toUpsert.add(v);
        }
        upsert toUpsert User_Video_Key__c;

        // Ensure the assigned video is visible in the library (mandatory-ness comes from the
        // per-user assignment, not the video Status).
        update new Training_Video__c(Id = videoId, Status__c = 'Published');

        result.assigned = toUpsert.size();
        if (notify == true) {
            // Email just the users assigned in this action, and stamp their Notified_At__c.
            result.notified = TrainingNotificationService.notify(
                new Set<Id>{videoId},
                userToVia.keySet()
            );
        }
        return result;
    }

    /**
     * @description The per-user tracking rows for a video — the admin "who's done it" list.
     * Limited to users the video was ASSIGNED to (Assigned__c = true), so self-initiated views
     * by non-assigned users don't clutter the assignment roster.
     */
    @AuraEnabled
    public static List<AssignmentRow> getAssignments(Id videoId) {
        LogicLearnAudienceService.requireAdmin();
        List<AssignmentRow> rows = new List<AssignmentRow>();
        for (Training_View__c v : [
            SELECT Id, User__c, User__r.Name, Status__c, Watch_Percent__c, Completed_At__c,
                Assigned__c, Assigned_Via__c, Notified_At__c
            FROM Training_View__c
            WHERE Training_Video__c = :videoId AND Assigned__c = TRUE
            ORDER BY Status__c, User__r.Name
        ]) {
            AssignmentRow r = new AssignmentRow();
            r.id = v.Id;
            r.userId = v.User__c;
            r.userName = v.User__r.Name;
            r.status = v.Status__c;
            r.watchPercent = v.Watch_Percent__c;
            r.completedAt = v.Completed_At__c;
            r.assigned = v.Assigned__c;
            r.assignedVia = v.Assigned_Via__c;
            r.notifiedAt = v.Notified_At__c;
            rows.add(r);
        }
        return rows;
    }

    /**
     * @description Removes an assignment. A never-watched Pending row is deleted outright; a row
     * the user has already engaged with is kept (un-assigned) so their history isn't lost.
     */
    @AuraEnabled
    public static void removeAssignment(Id trainingViewId) {
        LogicLearnAudienceService.requireAdmin();
        if (trainingViewId == null) {
            return;
        }
        List<Training_View__c> vs = [
            SELECT Id, Status__c, View_Count__c
            FROM Training_View__c
            WHERE Id = :trainingViewId
            LIMIT 1
        ];
        if (vs.isEmpty()) {
            return;
        }
        Training_View__c v = vs[0];
        if (v.Status__c == 'Pending' && (v.View_Count__c == null || v.View_Count__c == 0)) {
            delete v;
        } else {
            v.Assigned__c = false;
            update v;
        }
    }

    /**
     * @description Removes every assignment for a video at once. Same rule as removeAssignment:
     * never-watched Pending rows are deleted; rows the user has engaged with are kept (un-assigned)
     * so their history isn't lost.
     */
    @AuraEnabled
    public static void removeAllAssignments(Id videoId) {
        LogicLearnAudienceService.requireAdmin();
        if (videoId == null) {
            return;
        }
        List<Training_View__c> toDelete = new List<Training_View__c>();
        List<Training_View__c> toUnassign = new List<Training_View__c>();
        for (Training_View__c v : [
            SELECT Id, Status__c, View_Count__c
            FROM Training_View__c
            WHERE Training_Video__c = :videoId AND Assigned__c = TRUE
        ]) {
            if (v.Status__c == 'Pending' && (v.View_Count__c == null || v.View_Count__c == 0)) {
                toDelete.add(v);
            } else {
                v.Assigned__c = false;
                toUnassign.add(v);
            }
        }
        if (!toUnassign.isEmpty()) {
            update toUnassign;
        }
        if (!toDelete.isEmpty()) {
            delete toDelete;
        }
    }

    // ───────────────────────── Admin: single video file ─────────────────────────

    /** @description The current video file for a record (pinned or latest linked), or null. */
    @AuraEnabled
    public static Option getCurrentVideoFile(Id videoId) {
        LogicLearnAudienceService.requireAdmin();
        if (videoId == null) {
            return null;
        }
        List<Training_Video__c> vids = [
            SELECT Video_Content_Version_Id__c FROM Training_Video__c WHERE Id = :videoId LIMIT 1
        ];
        if (vids.isEmpty()) {
            return null;
        }
        String cvId = String.isNotBlank(vids[0].Video_Content_Version_Id__c)
            ? vids[0].Video_Content_Version_Id__c
            : resolveLatestVideoContentVersion(videoId);
        if (String.isBlank(cvId)) {
            return null;
        }
        List<ContentVersion> cvs = [SELECT Id, Title, FileExtension, ContentSize FROM ContentVersion WHERE Id = :cvId LIMIT 1];
        if (cvs.isEmpty()) {
            return null;
        }
        Option o = new Option();
        o.id = cvs[0].Id;
        String fileName = String.isNotBlank(cvs[0].FileExtension) ? cvs[0].Title + '.' + cvs[0].FileExtension : cvs[0].Title;
        Decimal sizeMB = (Decimal) cvs[0].ContentSize / 1048576;
        o.label = fileName + ' (' + sizeMB.setScale(1) + ' MB)';
        return o;
    }

    /**
     * @description Pins the uploaded file as THE video for the record and enforces one-per-record
     * by deleting any other files previously linked to it. Called after upload so a new video
     * overrides the old one.
     */
    @AuraEnabled
    public static void replaceVideoFile(Id videoId, Id contentVersionId) {
        LogicLearnAudienceService.requireAdmin();
        if (videoId == null || contentVersionId == null) {
            throw new AuraHandledException('A video and an uploaded file are required.');
        }
        Id keepDocId = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :contentVersionId LIMIT 1]
            .ContentDocumentId;

        List<Id> docsToDelete = new List<Id>();
        for (ContentDocumentLink link : [
            SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = :videoId
        ]) {
            if (link.ContentDocumentId != keepDocId) {
                docsToDelete.add(link.ContentDocumentId);
            }
        }
        if (!docsToDelete.isEmpty()) {
            delete [SELECT Id FROM ContentDocument WHERE Id IN :docsToDelete];
        }
        update new Training_Video__c(Id = videoId, Video_Content_Version_Id__c = contentVersionId);
    }

    /**
     * @description Called after a lightning-file-upload finishes (which yields a
     * ContentDocumentId): resolves the document's latest version and pins it as the single
     * video for the record.
     */
    @AuraEnabled
    public static void setUploadedVideo(Id videoId, Id contentDocumentId) {
        LogicLearnAudienceService.requireAdmin();
        if (videoId == null || contentDocumentId == null) {
            throw new AuraHandledException('A video and an uploaded file are required.');
        }
        List<ContentVersion> cvs = [
            SELECT Id, ContentSize FROM ContentVersion
            WHERE ContentDocumentId = :contentDocumentId AND IsLatest = TRUE
            LIMIT 1
        ];
        if (cvs.isEmpty()) {
            throw new AuraHandledException('Could not find the uploaded file.');
        }

        // Enforce the size limit: reject and remove oversized uploads so they can't blow the
        // org's file storage or stream poorly. The admin compresses and re-uploads.
        Long maxBytes = getMaxVideoBytes();
        if (maxBytes > 0 && cvs[0].ContentSize > maxBytes) {
            delete [SELECT Id FROM ContentDocument WHERE Id = :contentDocumentId];
            Decimal sizeMB = (Decimal) cvs[0].ContentSize / 1048576;
            Decimal limitMB = (Decimal) maxBytes / 1048576;
            throw new AuraHandledException(
                'This video is ' + sizeMB.setScale(0) + ' MB, over the ' + limitMB.setScale(0) +
                ' MB limit. Please compress it (MP4 / H.264, 720p or 1080p) and upload again.'
            );
        }

        replaceVideoFile(videoId, cvs[0].Id);
    }

    // Overridable in tests. Reads the Max Training Video (MB) custom label; defaults to 150.
    @TestVisible
    private static Long maxBytesOverride = null;

    private static Long getMaxVideoBytes() {
        if (maxBytesOverride != null) {
            return maxBytesOverride;
        }
        Integer mb = 150;
        try {
            mb = Integer.valueOf(Label.Training_Max_Video_MB);
        } catch (Exception e) {
            System.debug('Training_Max_Video_MB label not a number; using 150');
        }
        return (Long) mb * 1048576;
    }

    // ───────────────────────── Helpers ─────────────────────────

    private static String buildKey(Id videoId) {
        return UserInfo.getUserId() + '-' + videoId;
    }
}
