import {LightningElement, wire} from "lwc";
import {NavigationMixin} from "lightning/navigation";
import getMyPending from "@salesforce/apex/TrainingVideoController.getMyPending";

export default class MyTrainingPending extends NavigationMixin(LightningElement) {
    items = [];
    error;

    @wire(getMyPending)
    wiredPending({data, error}) {
        if (data) {
            this.items = data.map((v) => ({
                ...v,
                pillClass: v.isMandatory ? "pill mand" : "pill pend",
                pillLabel: v.isMandatory ? "Mandatory" : "Optional",
                statusLabel: v.viewStatus === "In Progress" ? `In progress · ${Math.round(v.watchPercent || 0)}%` : "Not started"
            }));
            this.error = undefined;
        } else if (error) {
            this.error = error.body ? error.body.message : "Unable to load your training.";
        }
    }

    get hasItems() {
        return this.items.length > 0;
    }

    get countLabel() {
        const n = this.items.length;
        return `${n} outstanding`;
    }

    handleClick(event) {
        const videoId = event.currentTarget.dataset.id;
        this[NavigationMixin.Navigate]({
            type: "standard__recordPage",
            attributes: {
                recordId: videoId,
                objectApiName: "Training_Video__c",
                actionName: "view"
            }
        });
    }
}
