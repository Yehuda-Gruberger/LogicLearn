trigger TrainingVideoTrigger on Training_Video__c (after update) {
    if (Trigger.isAfter && Trigger.isUpdate) {
        TrainingVideoTriggerHandler.afterUpdate(Trigger.new, Trigger.oldMap);
    }
}
