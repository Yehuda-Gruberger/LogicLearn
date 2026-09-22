import {LightningElement, api} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import createTutorialDraft from "@salesforce/apex/LogicLearnAdminController.createTutorialDraft";
import discardTutorialDraft from "@salesforce/apex/LogicLearnAdminController.discardTutorialDraft";
import getCatalog from "@salesforce/apex/LogicLearnAdminController.getCatalog";
import getTutorial from "@salesforce/apex/LogicLearnAdminController.getTutorial";
import saveTutorial from "@salesforce/apex/LogicLearnAdminController.saveTutorial";
import sendNotification from "@salesforce/apex/LogicLearnAdminController.sendNotification";
import sendInAppNotification from "@salesforce/apex/LogicLearnAdminController.sendInAppNotification";
import setUploadedVideo from "@salesforce/apex/TrainingVideoController.setUploadedVideo";

const EMPTY_FORM = {
    videoId: null,
    title: "",
    description: "",
    folderId: null,
    category: "Onboarding",
    contentType: "Salesforce File",
    externalUrl: "",
    completionThreshold: null,
    skipPrevention: "Use Global Default",
    dueDate: null,
    status: "Draft",
    visibilityUsers: [],
    visibilityProfiles: [],
    visibilityGroups: [],
    requiredUsers: [],
    requiredProfiles: [],
    requiredGroups: [],
    notificationUsers: [],
    notificationProfiles: [],
    notificationGroups: []
};

export default class LogicLearnTutorialEditor extends LightningElement {
    @api recordId;
    form = {...EMPTY_FORM};
    catalog = {users: [], profiles: [], groups: [], folders: []};
    loading = true;
    saving = false;
    createdDraft = false;
    fileName;
    newVideoChannel = "None";
    assignmentChannel = "None";

    async connectedCallback() {
        try {
            const [catalog, id] = await Promise.all([
                getCatalog(),
                this.recordId ? Promise.resolve(this.recordId) : createTutorialDraft()
            ]);
            this.catalog = catalog;
            this.createdDraft = !this.recordId;
            this.recordId = id;
            const tutorial = await getTutorial({videoId: id});
            this.fileName = tutorial.fileName;
            this.form = this.normalize({...EMPTY_FORM, ...tutorial, videoId: id});
        } catch (error) {
            this.toast("Unable to open tutorial", this.message(error), "error");
            this.dispatchEvent(new CustomEvent("close"));
        } finally {
            this.loading = false;
        }
    }

    normalize(value) {
        const result = {...value};
        ["visibilityUsers", "visibilityProfiles", "visibilityGroups", "requiredUsers", "requiredProfiles",
            "requiredGroups", "notificationUsers", "notificationProfiles", "notificationGroups"].forEach((key) => {
            result[key] = Array.isArray(result[key]) ? result[key] : [];
        });
        return result;
    }

    get title() {
        return this.createdDraft ? "Create tutorial" : "Edit tutorial";
    }

    get isFile() {
        return this.form.contentType === "Salesforce File";
    }

    get hasFile() {
        return Boolean(this.fileName);
    }

    get busy() {
        return this.loading || this.saving;
    }

    get categoryOptions() {
        return ["Onboarding", "Compliance", "Products", "Processes", "Systems", "Professional Development", "Other"]
            .map((value) => ({label: value, value}));
    }

    get contentOptions() {
        return [
            {label: "Salesforce File (tracked)", value: "Salesforce File"},
            {label: "External link (manual completion)", value: "External Link"}
        ];
    }

    get skipOptions() {
        return ["Use Global Default", "Enabled", "Disabled"].map((value) => ({label: value, value}));
    }

    get statusOptions() {
        return [
            {label: "Draft", value: "Draft"},
            {label: "Published", value: "Published"},
            {label: "Archived", value: "Archived"}
        ];
    }

    get channelOptions() {
        return ["None", "In-app", "Email", "Both"].map((value) => ({label: value, value}));
    }

    handleField(event) {
        const field = event.currentTarget.dataset.field;
        const value = event.target.type === "checkbox" ? event.target.checked : event.detail?.value ?? event.target.value;
        if (field === "newVideoChannel" || field === "assignmentChannel") {
            this[field] = value;
            return;
        }
        this.form = {...this.form, [field]: value === "" ? null : value};
    }

    handlePicker(event) {
        const field = event.currentTarget.dataset.field;
        this.form = {...this.form, [field]: event.detail.value};
    }

    async handleUpload(event) {
        const files = event.detail.files || [];
        if (!files.length) return;
        try {
            await setUploadedVideo({videoId: this.recordId, contentDocumentId: files[0].documentId});
            this.fileName = files[0].name;
            this.toast("Uploaded", `${files[0].name} is ready.`, "success");
        } catch (error) {
            this.toast("Upload error", this.message(error), "error");
        }
    }

    async handleSave() {
        const inputs = [...this.template.querySelectorAll("lightning-input, lightning-textarea, lightning-combobox")];
        if (!inputs.reduce((valid, input) => input.reportValidity() && valid, true)) return;
        const visibilityCount = this.form.visibilityUsers.length + this.form.visibilityProfiles.length + this.form.visibilityGroups.length;
        if (this.form.status === "Published" && visibilityCount === 0) {
            this.toast("Audience required", "Select at least one visibility audience before publishing.", "error");
            return;
        }
        if (this.form.contentType === "Salesforce File" && this.form.status === "Published" && !this.fileName) {
            this.toast("Video required", "Upload a video file before publishing.", "error");
            return;
        }
        this.saving = true;
        try {
            const videoId = await saveTutorial({input: {...this.form, videoId: this.recordId, fileName: null}});
            const notices = [];
            if (["Email", "Both"].includes(this.newVideoChannel)) notices.push(sendNotification({videoId, notificationType: "New Video"}));
            if (["In-app", "Both"].includes(this.newVideoChannel)) notices.push(sendInAppNotification({videoId, notificationType: "New Video"}));
            if (["Email", "Both"].includes(this.assignmentChannel)) notices.push(sendNotification({videoId, notificationType: "Assignment"}));
            if (["In-app", "Both"].includes(this.assignmentChannel)) notices.push(sendInAppNotification({videoId, notificationType: "Assignment"}));
            const counts = notices.length ? await Promise.all(notices) : [];
            const emailed = counts.reduce((sum, count) => sum + count, 0);
            this.createdDraft = false;
            this.toast("Saved", emailed ? `Tutorial saved and ${emailed} email${emailed === 1 ? " was" : "s were"} sent.` : "Tutorial saved.", "success");
            this.dispatchEvent(new CustomEvent("saved", {detail: {videoId}}));
        } catch (error) {
            this.toast("Could not save", this.message(error), "error");
        } finally {
            this.saving = false;
        }
    }

    async handleCancel() {
        if (this.createdDraft && this.recordId) {
            try {
                await discardTutorialDraft({videoId: this.recordId});
            } catch (error) {
                // Closing the editor should not trap the admin if draft cleanup fails.
            }
        }
        this.dispatchEvent(new CustomEvent("close"));
    }

    stopPropagation(event) {
        event.stopPropagation();
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({title, message, variant}));
    }

    message(error) {
        return error?.body?.message || error?.message || "Something went wrong.";
    }
}
