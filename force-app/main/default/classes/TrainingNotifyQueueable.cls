/**
 * @description Async path for the record-level "Send Notification" checkbox: emails everyone
 * assigned to the given videos (via TrainingNotificationService), then clears the checkbox so it
 * can be triggered again. Assignment-time notifications are sent synchronously in
 * TrainingVideoController.assignToAudience instead.
 */
public with sharing class TrainingNotifyQueueable implements Queueable {
    private Set<Id> videoIds;

    public TrainingNotifyQueueable(Set<Id> videoIds) {
        this.videoIds = videoIds;
    }

    public void execute(QueueableContext ctx) {
        if (videoIds == null || videoIds.isEmpty()) {
            return;
        }
        TrainingNotificationService.notify(videoIds, null);
        resetFlags();
    }

    private void resetFlags() {
        List<Training_Video__c> toReset = new List<Training_Video__c>();
        for (Id vid : videoIds) {
            toReset.add(new Training_Video__c(Id = vid, Send_Notification__c = false));
        }
        update toReset;
    }
}
