/** Resolves live LogicLearn audiences and enforces administrative authorization. */
public without sharing class LogicLearnAudienceService {
    @TestVisible private static Boolean adminOverride;

    public static Boolean isAdmin() {
        if (Test.isRunningTest()) return adminOverride == null ? true : adminOverride;
        return FeatureManagement.checkPermission('LogicLearn_Admin');
    }

    public static void requireAdmin() {
        if (!isAdmin()) {
            throw new AuraHandledException('LogicLearn Administrator access is required.');
        }
    }

    public static Set<Id> videoIdsForUser(Id userId, String purpose, Set<Id> candidateVideoIds) {
        Set<Id> result = new Set<Id>();
        if (candidateVideoIds == null || candidateVideoIds.isEmpty()) return result;
        User target = [SELECT Id, ProfileId FROM User WHERE Id = :userId LIMIT 1];
        List<Training_Audience__c> rules = [
            SELECT Training_Video__c, Audience_Type__c, User__c, Profile_Id__c, LogicLearn_Group__c
            FROM Training_Audience__c
            WHERE Training_Video__c IN :candidateVideoIds AND Purpose__c = :purpose
        ];
        Set<Id> relevantGroups = new Set<Id>();
        for (Training_Audience__c rule : rules) if (rule.LogicLearn_Group__c != null) relevantGroups.add(rule.LogicLearn_Group__c);
        Map<Id, List<Training_Group_Member__c>> membersByGroup = loadGroupTree(relevantGroups);
        for (Training_Audience__c rule : rules) {
            if (matches(target.Id, target.ProfileId, rule.Audience_Type__c, rule.User__c, rule.Profile_Id__c,
                rule.LogicLearn_Group__c, membersByGroup, new Set<Id>())) {
                result.add(rule.Training_Video__c);
            }
        }
        return result;
    }

    public static Boolean canUserSeeVideo(Id userId, Id videoId) {
        if (isAdmin()) return true;
        return videoIdsForUser(userId, 'Visibility', new Set<Id>{videoId}).contains(videoId);
    }

    public static Set<Id> usersForVideo(Id videoId, String purpose) {
        List<Training_Audience__c> rules = [
            SELECT Audience_Type__c, User__c, Profile_Id__c, LogicLearn_Group__c
            FROM Training_Audience__c WHERE Training_Video__c = :videoId AND Purpose__c = :purpose
        ];
        Set<Id> directUsers = new Set<Id>();
        Set<Id> profileIds = new Set<Id>();
        Set<Id> groupIds = new Set<Id>();
        for (Training_Audience__c rule : rules) {
            if (rule.Audience_Type__c == 'User' && rule.User__c != null) directUsers.add(rule.User__c);
            else if (rule.Audience_Type__c == 'Profile' && String.isNotBlank(rule.Profile_Id__c)) profileIds.add((Id)rule.Profile_Id__c);
            else if (rule.Audience_Type__c == 'LogicLearn Group' && rule.LogicLearn_Group__c != null) groupIds.add(rule.LogicLearn_Group__c);
        }
        if (!profileIds.isEmpty()) {
            for (User u : [SELECT Id FROM User WHERE IsActive = TRUE AND ProfileId IN :profileIds]) directUsers.add(u.Id);
        }
        Map<Id, List<Training_Group_Member__c>> tree = loadGroupTree(groupIds);
        for (Id groupId : groupIds) directUsers.addAll(expandGroup(groupId, tree, new Set<Id>()));
        if (directUsers.isEmpty()) return directUsers;
        Set<Id> active = new Set<Id>();
        for (User u : [SELECT Id FROM User WHERE Id IN :directUsers AND IsActive = TRUE]) active.add(u.Id);
        return active;
    }

    private static Boolean matches(Id userId, Id profileId, String audienceType, Id directUserId,
        String selectedProfileId, Id groupId, Map<Id, List<Training_Group_Member__c>> tree, Set<Id> visiting) {
        if (audienceType == 'User') return directUserId == userId;
        if (audienceType == 'Profile') return String.valueOf(profileId) == selectedProfileId;
        if (audienceType == 'LogicLearn Group' && groupId != null) return groupContains(groupId, userId, profileId, tree, visiting);
        return false;
    }

    private static Boolean groupContains(Id groupId, Id userId, Id profileId,
        Map<Id, List<Training_Group_Member__c>> tree, Set<Id> visiting) {
        if (visiting.contains(groupId)) return false;
        visiting.add(groupId);
        for (Training_Group_Member__c member : tree.get(groupId) == null ? new List<Training_Group_Member__c>() : tree.get(groupId)) {
            if (member.Member_Type__c == 'User' && member.User__c == userId) return true;
            if (member.Member_Type__c == 'Profile' && member.Profile_Id__c == String.valueOf(profileId)) return true;
            if (member.Member_Type__c == 'LogicLearn Group' && member.Nested_Group__c != null &&
                groupContains(member.Nested_Group__c, userId, profileId, tree, new Set<Id>(visiting))) return true;
        }
        return false;
    }

    private static Set<Id> expandGroup(Id groupId, Map<Id, List<Training_Group_Member__c>> tree, Set<Id> visiting) {
        Set<Id> users = new Set<Id>();
        if (visiting.contains(groupId)) return users;
        visiting.add(groupId);
        Set<Id> profiles = new Set<Id>();
        for (Training_Group_Member__c member : tree.get(groupId) == null ? new List<Training_Group_Member__c>() : tree.get(groupId)) {
            if (member.Member_Type__c == 'User' && member.User__c != null) users.add(member.User__c);
            else if (member.Member_Type__c == 'Profile' && String.isNotBlank(member.Profile_Id__c)) profiles.add((Id)member.Profile_Id__c);
            else if (member.Member_Type__c == 'LogicLearn Group' && member.Nested_Group__c != null)
                users.addAll(expandGroup(member.Nested_Group__c, tree, new Set<Id>(visiting)));
        }
        if (!profiles.isEmpty()) for (User u : [SELECT Id FROM User WHERE IsActive = TRUE AND ProfileId IN :profiles]) users.add(u.Id);
        return users;
    }

    private static Map<Id, List<Training_Group_Member__c>> loadGroupTree(Set<Id> rootIds) {
        Map<Id, List<Training_Group_Member__c>> result = new Map<Id, List<Training_Group_Member__c>>();
        if (rootIds == null || rootIds.isEmpty()) return result;
        Set<Id> pending = new Set<Id>(rootIds);
        Set<Id> loaded = new Set<Id>();
        while (!pending.isEmpty() && loaded.size() < 500) {
            Set<Id> batchIds = new Set<Id>(pending);
            pending.clear();
            for (Training_Group_Member__c member : [
                SELECT Group__c, Member_Type__c, User__c, Profile_Id__c, Nested_Group__c
                FROM Training_Group_Member__c WHERE Group__c IN :batchIds
            ]) {
                if (!result.containsKey(member.Group__c)) result.put(member.Group__c, new List<Training_Group_Member__c>());
                result.get(member.Group__c).add(member);
                if (member.Nested_Group__c != null && !loaded.contains(member.Nested_Group__c)) pending.add(member.Nested_Group__c);
            }
            loaded.addAll(batchIds);
        }
        return result;
    }
}
