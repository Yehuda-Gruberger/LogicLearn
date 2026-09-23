import {LightningElement} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import getSettings from "@salesforce/apex/LogicLearnAdminController.getSettings";
import saveSettings from "@salesforce/apex/LogicLearnAdminController.saveSettings";
import getEmailTemplates from "@salesforce/apex/LogicLearnAdminController.getEmailTemplates";
import getEmailTemplate from "@salesforce/apex/LogicLearnAdminController.getEmailTemplate";
import saveEmailTemplate from "@salesforce/apex/LogicLearnAdminController.saveEmailTemplate";

const TEMPLATE_FIELDS = ["assignmentTemplateName", "reminderTemplateName", "firstPublishEmailTemplate", "updateEmailTemplate"];

export default class LogicLearnSettings extends LightningElement {
    settings;
    templates = [];
    originalSettings;
    loading = true;
    saving = false;
    showTemplateCreator = false;
    creatingTemplate = false;
    templateTargetField;
    editingTemplateId;
    templateOriginalName;
    templateForm = {name: "", subject: "", htmlBody: ""};
    templateFormats = ["font", "size", "bold", "italic", "underline", "strike", "list", "indent", "align", "link", "image", "header", "color", "background", "clean"];

    connectedCallback() { this.load(); }

    async load() {
        try {
            const [settings, templates] = await Promise.all([getSettings(), getEmailTemplates()]);
            this.settings = settings;
            this.originalSettings = JSON.stringify(settings);
            this.templates = templates || [];
        } catch (error) {
            this.toast("Could not load settings", this.message(error), "error");
        } finally { this.loading = false; }
    }

    get assignmentTemplateOptions() { return this.optionsWithCurrent(this.settings?.assignmentTemplateName); }
    get reminderTemplateOptions() { return this.optionsWithCurrent(this.settings?.reminderTemplateName); }
    get firstPublishTemplateOptions() { return this.optionsWithCurrent(this.settings?.firstPublishEmailTemplate); }
    get updateTemplateOptions() { return this.optionsWithCurrent(this.settings?.updateEmailTemplate); }
    get documentPageRequirementOptions() { return [{label: "Every page", value: "Every page"}, {label: "Final page only", value: "Final page only"}]; }
    get documentReadingOrderOptions() { return [{label: "In order", value: "In order"}, {label: "Any order", value: "Any order"}]; }
    get documentCompletionModeOptions() { return [{label: "Finish on last page", value: "Finish on last page"}, {label: "Automatically", value: "Automatic"}]; }
    get changeLabel() { return this.originalSettings === JSON.stringify(this.settings) ? "No changes" : "Unsaved changes"; }
    get templateModalKicker() { return this.editingTemplateId ? "Edit template" : "Create template"; }
    get templateModalTitle() { return this.editingTemplateId ? this.templateForm.name : "New LogicLearn email template"; }
    get templateSaveLabel() { return this.creatingTemplate ? "Saving…" : this.editingTemplateId ? "Save template" : "Create template"; }
    get templatePreviewSubject() { return this.previewTokens(this.templateForm.subject || "Your email subject"); }
    get templatePreviewBody() { return this.previewTokens(this.templateForm.htmlBody || "<p>Your email message will appear here.</p>"); }

    optionsWithCurrent(value) {
        const options = [...this.templates];
        if (value && !options.some((item) => item.value === value)) options.unshift({value, label: value, meta: "Configured template"});
        return options;
    }

    previewTokens(value) {
        return value.replaceAll("[USER_NAME]", "Alex Morgan").replaceAll("[VIDEO_NAME]", "Security Awareness")
            .replaceAll("[VIDEO_LINK]", "https://example.com/tutorial").replaceAll("[LIBRARY_LINK]", "https://example.com/training");
    }

    handleThreshold(event) { this.settings = {...this.settings, completionThreshold: Number(event.target.value)}; }
    handleChange(event) {
        const field = event.currentTarget.dataset.field;
        const isToggle = event.currentTarget.type === "toggle" || event.currentTarget.type === "checkbox";
        const rawValue = isToggle ? event.currentTarget.checked : event.currentTarget.value;
        this.settings = {...this.settings, [field]: field === "completionThreshold" ? Number(rawValue) : rawValue};
    }
    handleTemplateChange(event) { this.settings = {...this.settings, [event.currentTarget.dataset.field]: event.detail.value}; }
    openNewTemplate(event) { this.openTemplateCreator({currentTarget: event.currentTarget, detail: {query: ""}}); }

    openTemplateCreator(event) {
        this.templateTargetField = event.currentTarget.dataset.field;
        this.editingTemplateId = null;
        this.templateOriginalName = null;
        this.templateForm = {name: event.detail?.query || "", subject: this.defaultTemplateSubject(this.templateTargetField), htmlBody: this.defaultTemplateBody(this.templateTargetField)};
        this.showTemplateCreator = true;
        this.notifyTemplateModal(true);
    }

    async openEditTemplate(event) {
        const field = event.currentTarget.dataset.field;
        const selected = event.detail?.value || this.settings?.[field];
        if (!selected) { this.toast("Choose a template", "Select an email template before editing it.", "info"); return; }
        this.creatingTemplate = true;
        try {
            const template = await getEmailTemplate({templateName: selected});
            this.templateTargetField = field;
            this.editingTemplateId = template.templateId;
            this.templateOriginalName = template.name;
            this.templateForm = {name: template.name, subject: template.subject, htmlBody: template.htmlBody};
            this.showTemplateCreator = true;
            this.notifyTemplateModal(true);
        } catch (error) { this.toast("Could not open template", this.message(error), "error"); }
        finally { this.creatingTemplate = false; }
    }

    defaultTemplateSubject(field) {
        if (field === "reminderTemplateName") return "Reminder: [VIDEO_NAME]";
        if (field === "updateEmailTemplate") return "Updated training: [VIDEO_NAME]";
        if (field === "assignmentTemplateName") return "You have been assigned [VIDEO_NAME]";
        return "New training: [VIDEO_NAME]";
    }

    defaultTemplateBody(field) {
        if (field === "reminderTemplateName") return '<p>Hi <strong>[USER_NAME]</strong>,</p><p>This is a reminder to complete <strong>[VIDEO_NAME]</strong>.</p><p><a href="[VIDEO_LINK]">Open the tutorial</a></p><p>You can also visit your <a href="[LIBRARY_LINK]">training library</a>.</p>';
        if (field === "updateEmailTemplate") return '<p>Hi <strong>[USER_NAME]</strong>,</p><p><strong>[VIDEO_NAME]</strong> has been updated.</p><p><a href="[VIDEO_LINK]">Review the updated tutorial</a></p>';
        if (field === "assignmentTemplateName") return '<p>Hi <strong>[USER_NAME]</strong>,</p><p>You have been assigned <strong>[VIDEO_NAME]</strong>.</p><p><a href="[VIDEO_LINK]">Start the tutorial</a></p><p>View all assignments in your <a href="[LIBRARY_LINK]">training library</a>.</p>';
        return '<p>Hi <strong>[USER_NAME]</strong>,</p><p>A new tutorial, <strong>[VIDEO_NAME]</strong>, is ready for you.</p><p><a href="[VIDEO_LINK]">Open the tutorial</a></p>';
    }

    closeTemplateCreator() {
        if (!this.creatingTemplate) {
            this.showTemplateCreator = false;
            this.notifyTemplateModal(false);
        }
    }
    handleTemplateField(event) { this.templateForm = {...this.templateForm, [event.currentTarget.dataset.field]: event.currentTarget.value}; }
    handleTemplateBody(event) { this.templateForm = {...this.templateForm, htmlBody: event.detail.value}; }
    handleInsertToken(event) { this.templateForm = {...this.templateForm, htmlBody: `${this.templateForm.htmlBody || ""}<p>${event.currentTarget.dataset.token}</p>`}; }

    async handleSaveTemplate() {
        const fields = [...this.template.querySelectorAll(".template-modal lightning-input")];
        if (!fields.reduce((valid, field) => field.reportValidity() && valid, true)) return;
        if (!(this.templateForm.htmlBody || "").replace(/<[^>]*>/g, "").trim()) { this.toast("Message required", "Write the email message before saving.", "error"); return; }
        this.creatingTemplate = true;
        try {
            const created = await saveEmailTemplate({templateId: this.editingTemplateId, name: this.templateForm.name, subject: this.templateForm.subject, htmlBody: this.templateForm.htmlBody});
            const originalName = this.templateOriginalName;
            this.templates = [...this.templates.filter((item) => item.value !== originalName && item.value !== created.value), created].sort((left, right) => left.label.localeCompare(right.label));
            const updatedSettings = {...this.settings};
            if (originalName) TEMPLATE_FIELDS.forEach((field) => { if (updatedSettings[field] === originalName) updatedSettings[field] = created.value; });
            updatedSettings[this.templateTargetField] = created.value;
            this.settings = updatedSettings;
            this.showTemplateCreator = false;
            this.notifyTemplateModal(false);
            this.toast(this.editingTemplateId ? "Template updated" : "Template created", `${created.label} is selected. Save settings to keep it as the default.`, "success");
        } catch (error) { this.toast("Could not save template", this.message(error), "error"); }
        finally { this.creatingTemplate = false; }
    }

    handleCancel() { this.dispatchEvent(new CustomEvent("close")); }
    async handleSave() {
        const fields = [...this.template.querySelectorAll(".settings-content lightning-input, .settings-content lightning-textarea")];
        if (!fields.reduce((valid, field) => field.reportValidity() && valid, true)) return;
        this.saving = true;
        try {
            await saveSettings({input: this.settings});
            this.originalSettings = JSON.stringify(this.settings);
            this.toast("Saved", "LogicLearn settings updated.", "success");
            this.dispatchEvent(new CustomEvent("close"));
        } catch (error) { this.toast("Could not save", this.message(error), "error"); }
        finally { this.saving = false; }
    }

    stopPropagation(event) { event.stopPropagation(); }
    notifyTemplateModal(open) {
        this.dispatchEvent(new CustomEvent("templatemodalchange", {detail: {open}, bubbles: true, composed: true}));
    }
    toast(title, message, variant) { this.dispatchEvent(new ShowToastEvent({title, message, variant})); }
    message(error) { return error?.body?.message || error?.message || "Something went wrong."; }
}
