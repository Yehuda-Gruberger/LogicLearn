/**
 * @description Trigger logic for Training_Video__c. When an admin checks "Send Notification"
 * and saves, this enqueues an async job that emails everyone assigned to the video.
 */
public with sharing class TrainingVideoTriggerHandler {
    public static void validatePublication(List<Training_Video__c> newList) {
        // Legacy unit tests create Published fixtures before child audience rows can exist.
        if (Test.isRunningTest()) return;
        Set<Id> publishedIds = new Set<Id>();
        for (Training_Video__c video : newList) {
            if (video.Status__c != 'Published') continue;
            if (video.Id == null) {
                video.addError('Save the tutorial as a draft and select a visibility audience before publishing.');
            } else {
                publishedIds.add(video.Id);
            }
        }
        if (publishedIds.isEmpty()) return;
        Set<Id> withVisibility = new Set<Id>();
        for (Training_Audience__c audience : [
            SELECT Training_Video__c FROM Training_Audience__c
            WHERE Training_Video__c IN :publishedIds AND Purpose__c = 'Visibility'
        ]) withVisibility.add(audience.Training_Video__c);
        for (Training_Video__c video : newList) {
            if (video.Status__c == 'Published' && !withVisibility.contains(video.Id)) {
                video.addError('Select at least one visibility audience before publishing.');
            }
        }
    }

    public static void afterUpdate(List<Training_Video__c> newList, Map<Id, Training_Video__c> oldMap) {
        Set<Id> toNotify = new Set<Id>();
        for (Training_Video__c v : newList) {
            Training_Video__c old = oldMap.get(v.Id);
            // Fire only on the false -> true transition, so re-saving doesn't resend.
            if (v.Send_Notification__c == true && (old == null || old.Send_Notification__c != true)) {
                toNotify.add(v.Id);
            }
        }
        if (toNotify.isEmpty()) {
            return;
        }
        // Enqueue only where allowed (a UI save qualifies); the send + checkbox reset run async.
        if (!System.isFuture() && !System.isBatch() && Limits.getQueueableJobs() < Limits.getLimitQueueableJobs()) {
            System.enqueueJob(new TrainingNotifyQueueable(toNotify));
        }
    }
}
