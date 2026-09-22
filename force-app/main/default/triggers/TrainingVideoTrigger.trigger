trigger TrainingVideoTrigger on Training_Video__c (before insert, before update, after update) {
    if (Trigger.isBefore) {
        TrainingVideoTriggerHandler.validatePublication(Trigger.new);
    }
    if (Trigger.isAfter && Trigger.isUpdate) {
        TrainingVideoTriggerHandler.afterUpdate(Trigger.new, Trigger.oldMap);
    }
}
