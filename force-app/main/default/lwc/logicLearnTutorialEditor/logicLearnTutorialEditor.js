import {LightningElement, api} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import createTutorialDraft from "@salesforce/apex/LogicLearnAdminController.createTutorialDraft";
import discardTutorialDraft from "@salesforce/apex/LogicLearnAdminController.discardTutorialDraft";
import getCatalog from "@salesforce/apex/LogicLearnAdminController.getCatalog";
import getSettings from "@salesforce/apex/LogicLearnAdminController.getSettings";
import getTutorial from "@salesforce/apex/LogicLearnAdminController.getTutorial";
import saveTutorial from "@salesforce/apex/LogicLearnAdminController.saveTutorial";
import sendNotification from "@salesforce/apex/LogicLearnAdminController.sendNotification";
import sendInAppNotification from "@salesforce/apex/LogicLearnAdminController.sendInAppNotification";
import setUploadedVideo from "@salesforce/apex/TrainingVideoController.setUploadedVideo";
import saveGroup from "@salesforce/apex/LogicLearnAdminController.saveGroup";

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
    settings = {completionThreshold: 90, preventSkipping: true, assignmentTemplateName: "", reminderTemplateName: ""};
    completionMode = "global";
    loading = true;
    saving = false;
    createdDraft = false;
    fileName;
    newVideoChannel = "None";
    assignmentChannel = "None";
    activeStage = "content";
    showGroupCreator = false;
    groupSaving = false;
    groupTargetField;
    groupForm = {groupId: null, name: "", description: "", users: [], profiles: [], groups: []};
    showVideoPreview = false;
    draftTitle = "";

    async connectedCallback() {
        try {
            const [catalog, settings, id] = await Promise.all([
                getCatalog(),
                getSettings(),
                this.recordId ? Promise.resolve(this.recordId) : createTutorialDraft()
            ]);
            this.catalog = catalog;
            this.settings = settings;
            this.createdDraft = !this.recordId;
            this.recordId = id;
            const tutorial = await getTutorial({videoId: id});
            this.fileName = tutorial.fileName;
            this.form = this.normalize({...EMPTY_FORM, ...tutorial, videoId: id});
            this.draftTitle = this.form.title || "";
            this.completionMode = tutorial.completionThreshold == null ? "global" : "custom";
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

    get saveLabel() {
        return this.form.status === "Published" ? "Publish tutorial" : "Save tutorial";
    }

    get fileDisplayName() {
        return this.fileName || "No video selected yet";
    }

    get contentStageClass() { return this.activeStage === "content" ? "studio-stage active" : "studio-stage"; }
    get detailsStageClass() { return this.activeStage === "details" ? "studio-stage active" : "studio-stage"; }
    get settingsStageClass() { return this.activeStage === "settings" ? "studio-stage active" : "studio-stage"; }
    get audienceStageClass() { return this.activeStage === "audience" ? "studio-stage active" : "studio-stage"; }
    get isContentStage() { return this.activeStage === "content"; }
    get isDetailsStage() { return this.activeStage === "details"; }
    get isSettingsStage() { return this.activeStage === "settings"; }
    get isAudienceStage() { return this.activeStage === "audience"; }

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
        const globalValue = this.settings.preventSkipping ? "Enabled" : "Disabled";
        return [
            {label: `Use global default (${globalValue})`, value: "Use Global Default"},
            {label: "Enabled", value: "Enabled"},
            {label: "Disabled", value: "Disabled"}
        ];
    }

    get completionModeOptions() {
        return [
            {label: `Use global default (${this.settings.completionThreshold}%)`, value: "global"},
            {label: "Custom threshold", value: "custom"}
        ];
    }

    get isCustomThreshold() {
        return this.completionMode === "custom";
    }

    get emailTemplateHelp() {
        return `Email uses “${this.settings.assignmentTemplateName}”; reminders use “${this.settings.reminderTemplateName}”.`;
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

    handleTitleInput(event) {
        this.draftTitle = event.currentTarget.value || "";
    }

    handlePicker(event) {
        const field = event.currentTarget.dataset.field;
        this.form = {...this.form, [field]: event.detail.value};
    }

    handleCreateGroup(event) {
        this.groupTargetField = event.currentTarget.dataset.field;
        this.groupForm = {groupId: null, name: "", description: "", users: [], profiles: [], groups: []};
        this.showGroupCreator = true;
    }

    closeGroupCreator() {
        this.showGroupCreator = false;
    }

    handleGroupField(event) {
        this.groupForm = {...this.groupForm, [event.currentTarget.dataset.field]: event.target.value};
    }

    handleGroupPicker(event) {
        this.groupForm = {...this.groupForm, [event.currentTarget.dataset.field]: event.detail.value};
    }

    async handleGroupSave() {
        const name = this.template.querySelector('.quick-group-modal lightning-input[data-field="name"]');
        if (!name?.reportValidity()) return;
        this.groupSaving = true;
        try {
            const groupId = await saveGroup({input: this.groupForm});
            this.catalog = await getCatalog();
            if (this.groupTargetField) {
                const selected = this.form[this.groupTargetField] || [];
                this.form = {...this.form, [this.groupTargetField]: [...selected, groupId]};
            }
            this.showGroupCreator = false;
            this.toast("Group created", `${this.groupForm.name} is ready and selected.`, "success");
        } catch (error) {
            this.toast("Could not create group", this.message(error), "error");
        } finally {
            this.groupSaving = false;
        }
    }

    handleCompletionMode(event) {
        this.completionMode = event.detail.value;
        const threshold = this.completionMode === "global"
            ? null
            : this.form.completionThreshold ?? this.settings.completionThreshold;
        this.form = {...this.form, completionThreshold: threshold};
    }

    handleStage(event) {
        this.activeStage = event.currentTarget.dataset.target;
    }

    async handleUpload(event) {
        const files = event.detail.files || [];
        if (!files.length) return;
        try {
            await setUploadedVideo({videoId: this.recordId, contentDocumentId: files[0].documentId});
            this.fileName = files[0].name;
            requestAnimationFrame(() => this.template.querySelectorAll("c-training-video-player").forEach((player) => player.reload()));
            this.toast("Uploaded", `${files[0].name} is ready.`, "success");
        } catch (error) {
            this.toast("Upload error", this.message(error), "error");
        }
    }

    async handleSave() {
        const inputs = [...this.template.querySelectorAll("lightning-input, lightning-textarea, lightning-combobox")];
        if (!inputs.reduce((valid, input) => input.reportValidity() && valid, true)) return;
        const titleInput = this.template.querySelector('lightning-input[data-field="title"]');
        const currentTitle = (titleInput?.value || this.draftTitle || this.form.title || "").trim();
        if (!currentTitle) {
            this.activeStage = "details";
            this.toast("Title required", "Enter a tutorial title before saving.", "error");
            return;
        }
        this.form = {...this.form, title: currentTitle};
        if (this.form.contentType === "External Link" && !this.form.externalUrl) {
            this.activeStage = "content";
            this.toast("Video link required", "Enter the external video URL before saving.", "error");
            return;
        }
        if (this.completionMode === "custom" && (!this.form.completionThreshold || this.form.completionThreshold < 1 || this.form.completionThreshold > 100)) {
            this.activeStage = "settings";
            this.toast("Completion threshold required", "Enter a threshold from 1 to 100 percent.", "error");
            return;
        }
        const visibilityCount = this.form.visibilityUsers.length + this.form.visibilityProfiles.length + this.form.visibilityGroups.length;
        if (this.form.status === "Published" && visibilityCount === 0) {
            this.activeStage = "audience";
            this.toast("Audience required", "Select at least one visibility audience before publishing.", "error");
            return;
        }
        if (this.form.contentType === "Salesforce File" && this.form.status === "Published" && !this.fileName) {
            this.activeStage = "content";
            this.toast("Video required", "Upload a video file before publishing.", "error");
            return;
        }
        this.saving = true;
        try {
            const payload = {...this.form, videoId: this.recordId, fileName: null, title: currentTitle};
            const videoId = await saveTutorial({input: payload});
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

    openVideoPreview() {
        this.showVideoPreview = true;
    }

    closeVideoPreview() {
        this.showVideoPreview = false;
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
