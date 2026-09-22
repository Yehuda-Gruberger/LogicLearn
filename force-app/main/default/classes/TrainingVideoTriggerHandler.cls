/**
 * @description Trigger logic for Training_Video__c. When an admin checks "Send Notification"
 * and saves, this enqueues an async job that emails everyone assigned to the video.
 */
public with sharing class TrainingVideoTriggerHandler {
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
