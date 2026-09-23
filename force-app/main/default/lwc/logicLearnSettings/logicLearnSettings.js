import {LightningElement} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import getSettings from "@salesforce/apex/LogicLearnAdminController.getSettings";
import saveSettings from "@salesforce/apex/LogicLearnAdminController.saveSettings";
import getEmailTemplates from "@salesforce/apex/LogicLearnAdminController.getEmailTemplates";
import createEmailTemplate from "@salesforce/apex/LogicLearnAdminController.createEmailTemplate";

export default class LogicLearnSettings extends LightningElement {
    settings;
    templates = [];
    originalSettings;
    loading = true;
    saving = false;
    showTemplateCreator = false;
    creatingTemplate = false;
    templateTargetField;
    templateForm = {name: "", subject: "", htmlBody: ""};

    connectedCallback() {
        this.load();
    }

    async load() {
        try {
            const [settings, templates] = await Promise.all([getSettings(), getEmailTemplates()]);
            this.settings = settings;
            this.originalSettings = JSON.stringify(settings);
            this.templates = templates || [];
        } catch (error) {
            this.toast("Could not load settings", this.message(error), "error");
        } finally {
            this.loading = false;
        }
    }

    get assignmentTemplateOptions() {
        return this.optionsWithCurrent(this.settings?.assignmentTemplateName);
    }

    get reminderTemplateOptions() {
        return this.optionsWithCurrent(this.settings?.reminderTemplateName);
    }

    get changeLabel() {
        return this.originalSettings === JSON.stringify(this.settings) ? "No changes" : "Unsaved changes";
    }

    get createTemplateLabel() {
        return this.creatingTemplate ? "Creating…" : "Create template";
    }

    optionsWithCurrent(value) {
        const options = [...this.templates];
        if (value && !options.some((item) => item.value === value)) {
            options.unshift({value, label: value, meta: "Configured template"});
        }
        return options;
    }

    handleThreshold(event) {
        this.settings = {...this.settings, completionThreshold: Number(event.target.value)};
    }

    handleChange(event) {
        const field = event.currentTarget.dataset.field;
        const isToggle = event.currentTarget.type === "toggle" || event.currentTarget.type === "checkbox";
        const rawValue = isToggle ? event.currentTarget.checked : event.currentTarget.value;
        const value = field === "completionThreshold" ? Number(rawValue) : rawValue;
        this.settings = {...this.settings, [field]: value};
    }

    handleTemplateChange(event) {
        const field = event.currentTarget.dataset.field;
        this.settings = {...this.settings, [field]: event.detail.value};
    }

    openTemplateCreator(event) {
        this.templateTargetField = event.currentTarget.dataset.field;
        const suggestedName = event.detail?.query || "";
        this.templateForm = {
            name: suggestedName,
            subject: this.templateTargetField === "reminderTemplateName" ? "Reminder: [VIDEO_NAME]" : "New training: [VIDEO_NAME]",
            htmlBody: this.defaultTemplateBody(this.templateTargetField)
        };
        this.showTemplateCreator = true;
    }

    defaultTemplateBody(targetField) {
        if (targetField === "reminderTemplateName") {
            return "Hi [USER_NAME],\n\nThis is a reminder to complete [VIDEO_NAME].\n\nOpen the tutorial: [VIDEO_LINK]\nView your training library: [LIBRARY_LINK]";
        }
        return "Hi [USER_NAME],\n\nA new tutorial, [VIDEO_NAME], is ready for you.\n\nOpen the tutorial: [VIDEO_LINK]\nView your training library: [LIBRARY_LINK]";
    }

    closeTemplateCreator() {
        if (!this.creatingTemplate) this.showTemplateCreator = false;
    }

    handleTemplateField(event) {
        const field = event.currentTarget.dataset.field;
        this.templateForm = {...this.templateForm, [field]: event.currentTarget.value};
    }

    async handleCreateTemplate() {
        const fields = [...this.template.querySelectorAll(".template-modal lightning-input, .template-modal lightning-textarea")];
        if (!fields.reduce((valid, field) => field.reportValidity() && valid, true)) return;
        this.creatingTemplate = true;
        try {
            const created = await createEmailTemplate({
                name: this.templateForm.name,
                subject: this.templateForm.subject,
                htmlBody: this.templateForm.htmlBody
            });
            this.templates = [...this.templates, created].sort((left, right) => left.label.localeCompare(right.label));
            this.settings = {...this.settings, [this.templateTargetField]: created.value};
            this.showTemplateCreator = false;
            this.toast("Template created", `${created.label} is selected. Save settings to make it the default.`, "success");
        } catch (error) {
            this.toast("Could not create template", this.message(error), "error");
        } finally {
            this.creatingTemplate = false;
        }
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent("close"));
    }

    async handleSave() {
        const fields = [...this.template.querySelectorAll(".settings-content lightning-input")];
        if (!fields.reduce((valid, field) => field.reportValidity() && valid, true)) return;
        this.saving = true;
        try {
            await saveSettings({input: this.settings});
            this.originalSettings = JSON.stringify(this.settings);
            this.toast("Saved", "LogicLearn settings updated.", "success");
            this.dispatchEvent(new CustomEvent("close"));
        } catch (error) {
            this.toast("Could not save", this.message(error), "error");
        } finally {
            this.saving = false;
        }
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
