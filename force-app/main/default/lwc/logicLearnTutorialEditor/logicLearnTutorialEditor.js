import {LightningElement, api} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import LightningConfirm from "lightning/confirm";
import createTutorialDraft from "@salesforce/apex/LogicLearnAdminController.createTutorialDraft";
import discardTutorialDraft from "@salesforce/apex/LogicLearnAdminController.discardTutorialDraft";
import getFreshCatalog from "@salesforce/apex/LogicLearnAdminController.getFreshCatalog";
import getSettings from "@salesforce/apex/LogicLearnAdminController.getSettings";
import getFreshTutorial from "@salesforce/apex/LogicLearnAdminController.getFreshTutorial";
import getFreshTutorialPages from "@salesforce/apex/LogicLearnAdminController.getFreshTutorialPages";
import getAudienceMembers from "@salesforce/apex/LogicLearnAdminController.getAudienceMembers";
import getEmailTemplates from "@salesforce/apex/LogicLearnAdminController.getEmailTemplates";
import saveTutorialJson from "@salesforce/apex/LogicLearnAdminController.saveTutorialJson";
import saveTutorialPagesJson from "@salesforce/apex/LogicLearnAdminController.saveTutorialPagesJson";
import sendLifecycleNotification from "@salesforce/apex/LogicLearnAdminController.sendLifecycleNotification";
import sendLifecycleInAppNotification from "@salesforce/apex/LogicLearnAdminController.sendLifecycleInAppNotification";
import setUploadedVideo from "@salesforce/apex/TrainingVideoController.setUploadedVideo";
import saveGroupJson from "@salesforce/apex/LogicLearnAdminController.saveGroupJson";
import getGroup from "@salesforce/apex/LogicLearnAdminController.getGroup";
import deleteGroup from "@salesforce/apex/LogicLearnAdminController.deleteGroup";
import saveFolderJson from "@salesforce/apex/LogicLearnAdminController.saveFolderJson";
import getFolder from "@salesforce/apex/LogicLearnAdminController.getFolder";
import deleteFolder from "@salesforce/apex/LogicLearnAdminController.deleteFolder";
import saveCategory from "@salesforce/apex/LogicLearnAdminController.saveCategory";
import deleteCategory from "@salesforce/apex/LogicLearnAdminController.deleteCategory";

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
    documentPageRequirement: "Use Global Default",
    documentReadingOrder: "Use Global Default",
    documentCompletionMode: "Use Global Default",
    dueDate: null,
    status: "Draft",
    visibilityUsers: [],
    visibilityProfiles: [],
    visibilityGroups: [],
    requiredUsers: [],
    requiredProfiles: [],
    requiredGroups: [],
    visibilityExcludedUsers: [],
    requiredExcludedUsers: [],
    notificationUsers: [],
    notificationProfiles: [],
    notificationGroups: [],
    publishNotificationChannel: "None",
    assignmentNotificationChannel: "None"
};

export default class LogicLearnTutorialEditor extends LightningElement {
    @api recordId;
    @api highlightSection;
    @api initialContentType = "Salesforce File";
    form = {...EMPTY_FORM};
    catalog = {users: [], profiles: [], groups: [], folders: [], categories: []};
    settings = {completionThreshold: 90, preventSkipping: true, documentPageRequirement: "Every page", documentReadingOrder: "In order", documentCompletionMode: "Finish on last page", assignmentTemplateName: "", reminderTemplateName: "", firstPublishEmailTemplate: "", updateEmailTemplate: "", requiredUpdateEmailTemplate: "", firstPublishInAppMessage: "[VIDEO/DOCUMENT_NAME] is now available.", updateInAppMessage: "[VIDEO/DOCUMENT_NAME] has been updated.", assignmentInAppMessage: "[VIDEO/DOCUMENT_NAME] has been assigned to you.", requiredUpdateInAppMessage: "[VIDEO/DOCUMENT_NAME] has been updated.", reminderInAppMessage: "Reminder: complete [VIDEO/DOCUMENT_NAME]."};
    emailTemplates = [];
    completionMode = "global";
    loading = true;
    saving = false;
    createdDraft = false;
    fileName;
    inheritedAudienceUsers = {visibility: [], required: []};
    activeStage = "content";
    showGroupCreator = false;
    groupSaving = false;
    groupTargetField;
    groupForm = {groupId: null, name: "", description: "", users: [], profiles: [], groups: []};
    creatingFolder = false;
    showFolderEditor = false;
    folderSaving = false;
    folderForm = {folderId: null, name: "", parentId: null, sortOrder: null, icon: "", description: ""};
    showCategoryEditor = false;
    categorySaving = false;
    categoryForm = {originalName: "", name: ""};
    draftTitle = "";
    originalStatus = "Draft";
    lifecycleEmailTemplate = "";
    lifecycleInAppMessage = "";
    customizingLifecycleNotice = false;
    requiredEmailTemplate = "";
    requiredInAppMessage = "";
    customizingRequiredNotice = false;
    pages = [];
    activePageIndex = 0;
    showRecorder = false;
    recording = false;
    recordingStopping = false;
    recordingReady = false;
    recordingSeconds = 0;
    recordingPreviewUrl;
    recordedBlob;
    mediaRecorder;
    recordingStream;
    recordingTimer;
    richTextFormats = ["font", "size", "bold", "italic", "underline", "strike", "list", "indent", "align", "link", "image", "header", "color", "background", "clean"];

    async connectedCallback() {
        try {
            const [catalog, settings, templates, id] = await Promise.all([
                getFreshCatalog(),
                getSettings(),
                getEmailTemplates(),
                this.recordId ? Promise.resolve(this.recordId) : createTutorialDraft()
            ]);
            this.catalog = catalog;
            this.settings = settings;
            this.emailTemplates = templates || [];
            this.createdDraft = !this.recordId;
            this.recordId = id;
            const tutorial = await getFreshTutorial({videoId: id});
            this.fileName = tutorial.fileName;
            this.form = this.normalize({...EMPTY_FORM, ...tutorial, videoId: id});
            if (this.createdDraft && this.initialContentType) this.form = {...this.form, contentType: this.initialContentType};
            const savedPages = await getFreshTutorialPages({videoId: id});
            this.pages = savedPages?.length ? savedPages.map((page, index) => ({...page, clientKey: page.pageId || `page-${index + 1}`})) : [this.newPage(1)];
            this.originalStatus = tutorial.status || "Draft";
            this.resetLifecycleNoticeDefaults();
            this.draftTitle = this.form.title || "";
            this.completionMode = tutorial.completionThreshold == null ? "global" : "custom";
            await Promise.all([this.refreshInheritedAudience("visibility"), this.refreshInheritedAudience("required")]);
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
            "requiredGroups", "visibilityExcludedUsers", "requiredExcludedUsers",
            "notificationUsers", "notificationProfiles", "notificationGroups"].forEach((key) => {
            result[key] = Array.isArray(result[key]) ? result[key] : [];
        });
        return result;
    }

    get title() {
        if (this.isDocument) return this.createdDraft ? "Create document tutorial" : "Edit document tutorial";
        return this.createdDraft ? "Create video tutorial" : "Edit video tutorial";
    }

    get saveLabel() {
        return this.form.status === "Published" ? "Publish tutorial" : "Save tutorial";
    }

    get showPublishActions() { return this.form.status === "Published"; }
    get quietPublishLabel() { return !this.createdDraft && this.originalStatus === "Published" ? "Save changes" : "Publish"; }

    get fileDisplayName() {
        return this.fileName || "No video selected yet";
    }
    get uploadLabel() { return this.hasFile ? "Replace" : "Upload file"; }
    get recordingTime() {
        const minutes = Math.floor(this.recordingSeconds / 60);
        const seconds = String(this.recordingSeconds % 60).padStart(2, "0");
        return `${minutes}:${seconds}`;
    }
    get uploadTrayClass() { return this.hasFile ? "upload-tray has-file" : "upload-tray empty-file"; }

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

    get isDocument() { return this.form.contentType === "Document"; }
    get isVideoTutorial() { return !this.isDocument; }
    get showVideoRules() { return !this.isDocument; }
    get studioIcon() { return this.isDocument ? "utility:knowledge_base" : "utility:video"; }
    get setupGridClass() { return this.isDocument ? "setup-grid document-layout" : "setup-grid"; }
    get publishingGridClass() { return this.isDocument ? "publishing-grid document-publishing" : "publishing-grid"; }
    get descriptionPlaceholder() { return this.isDocument ? "What will learners learn from this document?" : "What will learners be able to do after watching?"; }
    get contentPanelTitle() { return this.isDocument ? "Read tutorial" : "Video"; }
    get contentHelp() { return this.isDocument ? "What learners will read, one page at a time." : "What learners will watch."; }
    get activePage() { return this.pages[this.activePageIndex] || this.newPage(1); }
    get pageTabs() {
        return this.pages.map((page, index) => ({
            ...page,
            index,
            label: page.title?.trim() || `Page ${index + 1}`,
            className: index === this.activePageIndex ? "page-tab active" : "page-tab"
        }));
    }
    get canRemovePage() { return this.pages.length > 1; }
    get canMovePageUp() { return this.activePageIndex > 0; }
    get canMovePageDown() { return this.activePageIndex < this.pages.length - 1; }
    get cannotRemovePage() { return !this.canRemovePage; }
    get cannotMovePageUp() { return !this.canMovePageUp; }
    get cannotMovePageDown() { return !this.canMovePageDown; }

    get hasFile() {
        return Boolean(this.fileName);
    }

    get busy() {
        return this.loading || this.saving;
    }

    get categoryOptions() {
        return this.catalog.categories?.length
            ? this.catalog.categories
            : ["Onboarding", "Compliance", "Products", "Processes", "Systems", "Professional Development", "Other"]
                .map((value) => ({label: value, value}));
    }

    get audienceOptions() {
        const typed = (items, type, meta) => (items || []).map((item) => ({
            ...item,
            value: `${type}:${item.value}`,
            meta,
            editable: type === "Group",
            deletable: type === "Group"
        }));
        return [
            ...typed(this.catalog.groups, "Group", "Group"),
            ...typed(this.catalog.profiles, "Profile", "Profile"),
            ...typed(this.catalog.users, "User", "User")
        ];
    }

    get folderParentOptions() {
        return (this.catalog.folders || []).filter((folder) => folder.value !== this.folderForm.folderId);
    }

    get availableNestedGroupOptions() {
        return (this.catalog.groups || []).filter((group) => group.value !== this.groupForm.groupId);
    }

    get groupModalTitle() { return this.groupForm.groupId ? "Edit LogicLearn group" : "New LogicLearn group"; }
    get groupSaveLabel() { return this.groupForm.groupId ? "Save group" : "Create group"; }
    get folderModalTitle() { return this.folderForm.folderId ? "Edit folder" : "New folder"; }

    combinedAudience(prefix) {
        return [
            ...(this.form[`${prefix}Groups`] || []).map((value) => `Group:${value}`),
            ...(this.form[`${prefix}Profiles`] || []).map((value) => `Profile:${value}`),
            ...(this.form[`${prefix}Users`] || []).map((value) => `User:${value}`)
        ];
    }

    get visibilityAudience() { return this.combinedAudience("visibility"); }
    get requiredAudience() { return this.combinedAudience("required"); }
    get visibilityExcludedAudience() { return (this.form.visibilityExcludedUsers || []).map((value) => `User:${value}`); }
    get requiredExcludedAudience() { return (this.form.requiredExcludedUsers || []).map((value) => `User:${value}`); }
    get visibilityExcludableAudience() { return (this.inheritedAudienceUsers.visibility || []).map((value) => `User:${value}`); }
    get requiredExcludableAudience() { return (this.inheritedAudienceUsers.required || []).map((value) => `User:${value}`); }
    get hasVisibilityAudience() { return this.visibilityAudience.length > 0; }
    get hasRequiredAudience() { return this.requiredAudience.length > 0; }
    get videoCardClass() { return this.cardClass("video", "panel-card video-card"); }
    get detailsCardClass() { return this.cardClass("details", "panel-card details-card"); }
    get publishingCardClass() { return this.cardClass("settings", "panel-card publishing-card"); }
    get audienceCardClass() { return this.cardClass("audience", "panel-card audience-card"); }

    cardClass(section, baseClass) {
        return this.highlightSection === section ? `${baseClass} section-highlight` : baseClass;
    }
    get draftStatusClass() { return this.form.status === "Draft" ? "status-option active" : "status-option"; }
    get publishedStatusClass() { return this.form.status === "Published" ? "status-option active" : "status-option"; }
    get archivedStatusClass() { return this.form.status === "Archived" ? "status-option active" : "status-option"; }

    get contentOptions() {
        return [
            {label: "Salesforce File (tracked)", value: "Salesforce File"},
            {label: "External link (manual completion)", value: "External Link"}
        ];
    }

    newPage(number) { return {pageId: null, clientKey: `new-${Date.now()}-${number}`, title: `Page ${number}`, body: "", pageNumber: number}; }

    handlePageSelect(event) { this.activePageIndex = Number(event.currentTarget.dataset.index); }
    handlePageTitle(event) {
        const pages = this.pages.map((page, index) => index === this.activePageIndex ? {...page, title: event.target.value} : page);
        this.pages = pages;
    }
    handlePageBody(event) {
        const value = event.detail?.value ?? event.target.value;
        this.pages = this.pages.map((page, index) => index === this.activePageIndex ? {...page, body: value} : page);
    }
    addPage() {
        this.pages = [...this.pages, this.newPage(this.pages.length + 1)];
        this.activePageIndex = this.pages.length - 1;
    }
    removePage() {
        if (!this.canRemovePage) return;
        this.pages = this.pages.filter((page, index) => index !== this.activePageIndex);
        this.activePageIndex = Math.min(this.activePageIndex, this.pages.length - 1);
    }
    movePage(event) {
        const direction = Number(event.currentTarget.dataset.direction);
        const destination = this.activePageIndex + direction;
        if (destination < 0 || destination >= this.pages.length) return;
        const pages = [...this.pages];
        [pages[this.activePageIndex], pages[destination]] = [pages[destination], pages[this.activePageIndex]];
        this.pages = pages;
        this.activePageIndex = destination;
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

    get documentPageRequirementOptions() {
        return [
            {label: `Use global default (${this.settings.documentPageRequirement})`, value: "Use Global Default"},
            {label: "Every page", value: "Every page"},
            {label: "Final page only", value: "Final page only"}
        ];
    }

    get documentReadingOrderOptions() {
        return [
            {label: `Use global default (${this.settings.documentReadingOrder})`, value: "Use Global Default"},
            {label: "In order", value: "In order"},
            {label: "Any order", value: "Any order"}
        ];
    }

    get documentCompletionModeOptions() {
        return [
            {label: `Use global default (${this.settings.documentCompletionMode === "Automatic" ? "Automatically" : this.settings.documentCompletionMode})`, value: "Use Global Default"},
            {label: "Finish on last page", value: "Finish on last page"},
            {label: "Automatically", value: "Automatic"}
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

    channelChoices(field) {
        return [
            {label: "Don’t notify", value: "None"},
            {label: "In-app", value: "In-app"},
            {label: "Email", value: "Email"},
            {label: "Both", value: "Both"}
        ].map((option) => ({...option, className: this.form[field] === option.value ? "channel-option active" : "channel-option"}));
    }

    get publishChannelOptions() { return this.channelChoices("publishNotificationChannel"); }
    get assignmentChannelOptions() { return this.channelChoices("assignmentNotificationChannel"); }
    get lifecycleNotificationType() { return this.createdDraft || this.originalStatus !== "Published" ? "First Publish" : "Update"; }
    get isUpdateNotification() { return this.lifecycleNotificationType === "Update"; }
    get publicationNoticeLabel() { return this.isUpdateNotification ? "Notify when updated" : "Notify when first published"; }
    get requiredNoticeLabel() { return this.isUpdateNotification ? "Notify when updated" : "Notify when first published"; }
    get lifecycleNoticeTitle() { return this.isUpdateNotification ? "Tutorial updated notification template" : "First publish notification template"; }
    get lifecycleEmailDefault() { return this.isUpdateNotification ? this.settings.updateEmailTemplate : this.settings.firstPublishEmailTemplate; }
    get lifecycleMessageDefault() { return this.isUpdateNotification ? this.settings.updateInAppMessage : this.settings.firstPublishInAppMessage; }
    get requiredEmailDefault() { return this.isUpdateNotification ? this.settings.requiredUpdateEmailTemplate : this.settings.assignmentTemplateName; }
    get requiredMessageDefault() { return this.isUpdateNotification ? this.settings.requiredUpdateInAppMessage : this.settings.assignmentInAppMessage; }
    get lifecycleTemplateOptions() {
        const options = [...this.emailTemplates];
        if (this.lifecycleEmailTemplate && !options.some((item) => item.value === this.lifecycleEmailTemplate)) options.unshift({value: this.lifecycleEmailTemplate, label: this.lifecycleEmailTemplate});
        return options;
    }
    get requiredTemplateOptions() {
        const options = [...this.emailTemplates];
        if (this.requiredEmailTemplate && !options.some((item) => item.value === this.requiredEmailTemplate)) options.unshift({value: this.requiredEmailTemplate, label: this.requiredEmailTemplate});
        return options;
    }
    get showLifecycleNotice() { return this.form.publishNotificationChannel !== "None"; }
    get showLifecycleEmail() { return ["Email", "Both"].includes(this.form.publishNotificationChannel); }
    get showLifecycleInApp() { return ["In-app", "Both"].includes(this.form.publishNotificationChannel); }
    get lifecycleCustomizationLabel() { return this.customizingLifecycleNotice ? "Use defaults" : "Override"; }
    get lifecycleNoticeClass() { return this.customizingLifecycleNotice ? "notice-defaults editing" : "notice-defaults"; }
    get showRequiredNotice() { return this.form.assignmentNotificationChannel !== "None"; }
    get showRequiredEmail() { return ["Email", "Both"].includes(this.form.assignmentNotificationChannel); }
    get showRequiredInApp() { return ["In-app", "Both"].includes(this.form.assignmentNotificationChannel); }
    get requiredCustomizationLabel() { return this.customizingRequiredNotice ? "Use defaults" : "Override"; }
    get requiredNoticeClass() { return this.customizingRequiredNotice ? "notice-defaults editing" : "notice-defaults"; }

    resetLifecycleNoticeDefaults() {
        this.lifecycleEmailTemplate = this.lifecycleEmailDefault || "";
        this.lifecycleInAppMessage = this.lifecycleMessageDefault || "";
        this.requiredEmailTemplate = this.requiredEmailDefault || "";
        this.requiredInAppMessage = this.requiredMessageDefault || "";
    }

    toggleLifecycleCustomization() {
        if (this.customizingLifecycleNotice) this.resetLifecycleNoticeDefaults();
        this.customizingLifecycleNotice = !this.customizingLifecycleNotice;
    }

    handleLifecycleTemplate(event) { this.lifecycleEmailTemplate = event.detail.value; }
    handleLifecycleMessage(event) { this.lifecycleInAppMessage = event.currentTarget.value; }
    toggleRequiredCustomization() {
        if (this.customizingRequiredNotice) {
            this.requiredEmailTemplate = this.requiredEmailDefault || "";
            this.requiredInAppMessage = this.requiredMessageDefault || "";
        }
        this.customizingRequiredNotice = !this.customizingRequiredNotice;
    }
    handleRequiredTemplate(event) { this.requiredEmailTemplate = event.detail.value; }
    handleRequiredMessage(event) { this.requiredInAppMessage = event.currentTarget.value; }

    handleField(event) {
        const field = event.currentTarget.dataset.field;
        const value = event.target.type === "checkbox" ? event.target.checked : event.detail?.value ?? event.target.value;
        this.form = {...this.form, [field]: value === "" ? null : value};
    }

    handleChannelSelect(event) {
        this.form = {...this.form, [event.currentTarget.dataset.field]: event.currentTarget.dataset.value};
    }

    handleTitleInput(event) {
        this.draftTitle = event.currentTarget.value || "";
    }

    handlePicker(event) {
        const field = event.currentTarget.dataset.field;
        this.form = {...this.form, [field]: event.detail.value};
    }

    async handleAudiencePicker(event) {
        const prefix = event.currentTarget.dataset.purpose;
        const selected = event.detail.value || [];
        const excluded = event.detail.exclusions || [];
        const valuesFor = (type) => selected.filter((value) => value.startsWith(`${type}:`)).map((value) => value.slice(type.length + 1));
        this.form = {
            ...this.form,
            [`${prefix}Users`]: valuesFor("User"),
            [`${prefix}Profiles`]: valuesFor("Profile"),
            [`${prefix}Groups`]: valuesFor("Group"),
            [`${prefix}ExcludedUsers`]: excluded.filter((value) => value.startsWith("User:")).map((value) => value.slice(5))
        };
        await this.refreshInheritedAudience(prefix);
    }

    async refreshInheritedAudience(prefix) {
        const users = await getAudienceMembers({
            profileIds: this.form[`${prefix}Profiles`] || [],
            groupIds: this.form[`${prefix}Groups`] || []
        });
        const eligible = users || [];
        const eligibleSet = new Set(eligible);
        this.inheritedAudienceUsers = {...this.inheritedAudienceUsers, [prefix]: eligible};
        this.form = {...this.form, [`${prefix}ExcludedUsers`]:
            (this.form[`${prefix}ExcludedUsers`] || []).filter((id) => eligibleSet.has(id))};
    }

    async handleCreateFolder(event) {
        const name = event.detail?.query?.trim();
        if (!name || this.creatingFolder) return;
        this.creatingFolder = true;
        try {
            const folderId = await saveFolderJson({inputJson: JSON.stringify({name})});
            this.catalog = await getFreshCatalog();
            this.form = {...this.form, folderId};
            this.toast("Folder created", `${name} is ready and selected.`, "success");
        } catch (error) {
            this.toast("Could not create folder", this.message(error), "error");
        } finally {
            this.creatingFolder = false;
        }
    }

    async handleEditFolder(event) {
        try {
            this.folderForm = await getFolder({folderId: event.detail.value});
            this.showFolderEditor = true;
        } catch (error) {
            this.toast("Could not open folder", this.message(error), "error");
        }
    }

    async handleDeleteFolder(event) {
        const folderId = event.detail.value;
        const folderName = this.catalog.folders.find((folder) => folder.value === folderId)?.label || "this folder";
        const confirmed = await LightningConfirm.open({
            label: "Delete folder?",
            message: `Delete "${folderName}"? Tutorials in it will move to All Training, and subfolders will become top-level folders.`,
            theme: "warning"
        });
        if (!confirmed) return;
        try {
            const movedCount = await deleteFolder({folderId});
            if (this.form.folderId === folderId) this.form = {...this.form, folderId: null};
            this.catalog = await getFreshCatalog();
            this.toast("Folder deleted", `${folderName} was deleted. ${movedCount || 0} tutorial(s) moved to All Training.`, "success");
        } catch (error) {
            this.toast("Could not delete folder", this.message(error), "error");
        }
    }

    closeFolderEditor() { this.showFolderEditor = false; }
    handleFolderField(event) { this.folderForm = {...this.folderForm, [event.currentTarget.dataset.field]: event.target.value}; }
    handleFolderParent(event) { this.folderForm = {...this.folderForm, parentId: event.detail.value}; }

    async handleFolderSave() {
        const name = this.template.querySelector('.quick-folder-modal lightning-input[data-field="name"]');
        if (!name?.reportValidity()) return;
        this.folderSaving = true;
        try {
            const folderId = await saveFolderJson({inputJson: JSON.stringify(this.folderForm)});
            this.catalog = await getFreshCatalog();
            if (this.form.folderId === this.folderForm.folderId) this.form = {...this.form, folderId};
            this.showFolderEditor = false;
            this.toast("Folder saved", `${this.folderForm.name} was updated.`, "success");
        } catch (error) {
            this.toast("Could not save folder", this.message(error), "error");
        } finally {
            this.folderSaving = false;
        }
    }

    async handleCreateCategory(event) {
        const category = event.detail?.query?.trim();
        if (!category) return;
        try {
            const savedName = await saveCategory({originalName: null, name: category});
            this.catalog = await getFreshCatalog();
            this.form = {...this.form, category: savedName};
            this.toast("Category created", `${savedName} is ready and selected.`, "success");
        } catch (error) {
            this.toast("Could not create category", this.message(error), "error");
        }
    }

    handleEditCategory(event) {
        this.categoryForm = {originalName: event.detail.value, name: event.detail.value};
        this.showCategoryEditor = true;
    }

    async handleDeleteCategory(event) {
        const category = event.detail.value;
        const confirmed = await LightningConfirm.open({
            label: "Delete category?",
            message: `Delete "${category}"? Tutorials using it will move to Other, or become uncategorized if Other is deleted.`,
            theme: "warning"
        });
        if (!confirmed) return;
        try {
            const movedCount = await deleteCategory({name: category});
            this.catalog = await getFreshCatalog();
            if (this.form.category === category) {
                const replacement = category !== "Other" && this.catalog.categories.some((item) => item.value === "Other") ? "Other" : null;
                this.form = {...this.form, category: replacement};
            }
            this.toast("Category deleted", `${category} was deleted. ${movedCount || 0} tutorial(s) were updated.`, "success");
        } catch (error) {
            this.toast("Could not delete category", this.message(error), "error");
        }
    }

    closeCategoryEditor() { this.showCategoryEditor = false; }
    handleCategoryName(event) { this.categoryForm = {...this.categoryForm, name: event.target.value}; }

    async handleCategorySave() {
        const input = this.template.querySelector('.quick-category-modal lightning-input[data-field="name"]');
        if (!input?.reportValidity()) return;
        this.categorySaving = true;
        try {
            const savedName = await saveCategory(this.categoryForm);
            if (this.form.category === this.categoryForm.originalName) this.form = {...this.form, category: savedName};
            this.catalog = await getFreshCatalog();
            this.showCategoryEditor = false;
            this.toast("Category saved", `${savedName} was updated.`, "success");
        } catch (error) {
            this.toast("Could not save category", this.message(error), "error");
        } finally {
            this.categorySaving = false;
        }
    }

    async handleCopyAudience(event) {
        const source = event.currentTarget.dataset.source;
        const target = event.currentTarget.dataset.target;
        const additions = {};
        ["Users", "Profiles", "Groups", "ExcludedUsers"].forEach((suffix) => {
            additions[`${target}${suffix}`] = [
                ...new Set([...(this.form[`${target}${suffix}`] || []), ...(this.form[`${source}${suffix}`] || [])])
            ];
        });
        this.form = {...this.form, ...additions};
        await this.refreshInheritedAudience(target);
    }

    handleStatusSelect(event) {
        this.form = {...this.form, status: event.currentTarget.dataset.value};
    }

    handleCreateGroup(event) {
        this.groupTargetField = event.currentTarget.dataset.field || `${event.currentTarget.dataset.purpose}Groups`;
        this.groupForm = {groupId: null, name: event.detail?.query || "", description: "", users: [], profiles: [], groups: []};
        this.showGroupCreator = true;
    }

    async handleEditGroup(event) {
        const [type, groupId] = (event.detail.value || "").split(":");
        if (type !== "Group" || !groupId) return;
        this.groupTargetField = event.currentTarget.dataset.field || `${event.currentTarget.dataset.purpose}Groups`;
        try {
            this.groupForm = await getGroup({groupId});
            this.showGroupCreator = true;
        } catch (error) {
            this.toast("Could not open group", this.message(error), "error");
        }
    }

    async handleDeleteGroup(event) {
        const [type, groupId] = (event.detail.value || "").split(":");
        if (type !== "Group" || !groupId) return;
        const groupName = this.catalog.groups.find((group) => group.value === groupId)?.label || "this group";
        const confirmed = await LightningConfirm.open({
            label: "Delete group?",
            message: `Delete "${groupName}"? It will be removed from all tutorial audiences and nested groups.`,
            theme: "warning"
        });
        if (!confirmed) return;
        try {
            await deleteGroup({groupId});
            const removeGroup = (values) => (values || []).filter((value) => value !== groupId);
            this.form = {
                ...this.form,
                visibilityGroups: removeGroup(this.form.visibilityGroups),
                requiredGroups: removeGroup(this.form.requiredGroups),
                notificationGroups: removeGroup(this.form.notificationGroups)
            };
            this.catalog = await getFreshCatalog();
            await Promise.all([this.refreshInheritedAudience("visibility"), this.refreshInheritedAudience("required")]);
            this.toast("Group deleted", `${groupName} was removed from tutorial audiences.`, "success");
        } catch (error) {
            this.toast("Could not delete group", this.message(error), "error");
        }
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
            const editing = !!this.groupForm.groupId;
            const groupId = await saveGroupJson({inputJson: JSON.stringify(this.groupForm)});
            const createdGroup = {value: groupId, label: this.groupForm.name, meta: this.groupForm.description || "Group"};
            this.catalog = {
                ...this.catalog,
                groups: [...(this.catalog.groups || []).filter((group) => group.value !== groupId), createdGroup]
                    .sort((left, right) => left.label.localeCompare(right.label))
            };
            if (this.groupTargetField && !editing) {
                const selected = this.form[this.groupTargetField] || [];
                this.form = {...this.form, [this.groupTargetField]: [...new Set([...selected, groupId])]};
            }
            this.showGroupCreator = false;
            this.toast(editing ? "Group saved" : "Group created", editing ? `${this.groupForm.name} was updated.` : `${this.groupForm.name} is ready and selected.`, "success");
            try { this.catalog = await getFreshCatalog(); }
            catch (refreshError) { this.toast("Refresh needed", "The group was created and selected, but the audience list could not be refreshed.", "warning"); }
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

    async handleRecordScreen() {
        if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") {
            this.toast("Screen recording unavailable", "This browser does not support screen recording.", "error");
            return;
        }
        this.discardRecording();
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
            const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
                .find((type) => MediaRecorder.isTypeSupported(type));
            const chunks = [];
            this.recordingStream = stream;
            this.mediaRecorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
            const recordingMimeType = this.mediaRecorder.mimeType || mimeType || "video/webm";
            this.mediaRecorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
            this.mediaRecorder.onstop = () => this.finishRecording(chunks, recordingMimeType);
            this.mediaRecorder.onerror = () => {
                this.recording = false;
                this.recordingStopping = false;
                this.recordingStream?.getTracks().forEach((track) => track.stop());
                this.toast("Recording failed", "The browser could not finish this recording. Please try again.", "error");
            };
            stream.getVideoTracks()[0].onended = () => this.stopRecording();
            this.showRecorder = true;
            this.recording = true;
            this.recordingStopping = false;
            this.recordingReady = false;
            this.recordingSeconds = 0;
            this.mediaRecorder.start(1000);
            this.recordingTimer = window.setInterval(() => { this.recordingSeconds += 1; }, 1000);
            requestAnimationFrame(() => {
                const preview = this.template.querySelector(".recording-live");
                if (preview) { preview.srcObject = stream; preview.play().catch(() => {}); }
            });
        } catch (error) {
            if (error?.name !== "NotAllowedError") this.toast("Could not start recording", this.message(error), "error");
            this.closeRecorder();
        }
    }

    stopRecording() {
        if (this.mediaRecorder?.state !== "recording") return;
        this.recordingStopping = true;
        window.clearInterval(this.recordingTimer);
        this.recording = false;
        try {
            this.mediaRecorder.stop();
        } catch (error) {
            this.recordingStopping = false;
            this.toast("Recording failed", "The browser could not stop this recording. Please try again.", "error");
        }
        this.recordingStream?.getTracks().forEach((track) => track.stop());
    }

    finishRecording(chunks, mimeType) {
        window.clearInterval(this.recordingTimer);
        this.recordedBlob = new Blob(chunks, {type: mimeType});
        this.recordingStopping = false;
        if (!this.recordedBlob.size) {
            this.recordingReady = false;
            this.toast("Recording unavailable", "No video was captured. Select Record again and retry.", "error");
            return;
        }
        if (this.recordingPreviewUrl) URL.revokeObjectURL(this.recordingPreviewUrl);
        this.recordingPreviewUrl = URL.createObjectURL(this.recordedBlob);
        this.recordingReady = true;
        this.recording = false;
    }

    downloadRecording() {
        if (!this.recordingPreviewUrl) return;
        const link = document.createElement("a");
        link.href = this.recordingPreviewUrl;
        link.download = `LogicLearn-recording-${new Date().toISOString().replaceAll(":", "-")}.webm`;
        link.click();
    }

    recordAgain() {
        this.showRecorder = false;
        this.handleRecordScreen();
    }

    discardRecording() {
        if (this.mediaRecorder?.state === "recording") this.mediaRecorder.stop();
        this.recordingStream?.getTracks().forEach((track) => track.stop());
        this.resetRecordedMedia();
        this.showRecorder = false;
    }

    resetRecordedMedia() {
        if (this.recordingPreviewUrl) URL.revokeObjectURL(this.recordingPreviewUrl);
        this.recordingPreviewUrl = undefined;
        this.recordedBlob = undefined;
        this.recordingStopping = false;
        this.recordingReady = false;
    }

    closeRecorder() {
        if (this.recordingStopping) return;
        if (this.recording) {
            this.stopRecording();
            return;
        }
        this.showRecorder = false;
    }

    async handleSave(event) {
        const shouldSendNotifications = event?.currentTarget?.dataset.notify !== "false";
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
        if (this.isDocument && this.form.status === "Published" && !this.pages.some((page) => (page.body || "").replace(/<[^>]*>/g, "").trim())) {
            this.activeStage = "content";
            this.toast("Page content required", "Add content to at least one page before publishing.", "error");
            return;
        }
        this.saving = true;
        try {
            if (this.isDocument) {
                const pagePayload = this.pages.map((page, index) => ({pageId: page.pageId, title: page.title, body: page.body, pageNumber: index + 1}));
                await saveTutorialPagesJson({videoId: this.recordId, pagesJson: JSON.stringify(pagePayload)});
            }
            const payload = {...this.form, videoId: this.recordId, fileName: null, title: currentTitle};
            const videoId = await saveTutorialJson({inputJson: JSON.stringify(payload), title: currentTitle});
            const notices = [];
            const isLifecycleEvent = this.form.status === "Published";
            if (shouldSendNotifications && isLifecycleEvent && ["Email", "Both"].includes(this.form.publishNotificationChannel)) notices.push(sendLifecycleNotification({videoId, notificationType: this.lifecycleNotificationType, templateName: this.lifecycleEmailTemplate}));
            if (shouldSendNotifications && isLifecycleEvent && ["In-app", "Both"].includes(this.form.publishNotificationChannel)) notices.push(sendLifecycleInAppNotification({videoId, notificationType: this.lifecycleNotificationType, messageTemplate: this.lifecycleInAppMessage}));
            const requiredNotificationType = this.isUpdateNotification ? "Required Update" : "Assignment";
            if (shouldSendNotifications && ["Email", "Both"].includes(this.form.assignmentNotificationChannel)) notices.push(sendLifecycleNotification({videoId, notificationType: requiredNotificationType, templateName: this.requiredEmailTemplate}));
            if (shouldSendNotifications && ["In-app", "Both"].includes(this.form.assignmentNotificationChannel)) notices.push(sendLifecycleInAppNotification({videoId, notificationType: requiredNotificationType, messageTemplate: this.requiredInAppMessage}));
            let notificationFailed = false;
            const counts = notices.length ? await Promise.all(notices.map((notice) => notice.catch(() => {
                notificationFailed = true;
                return 0;
            }))) : [];
            const emailed = counts.reduce((sum, count) => sum + count, 0);
            this.createdDraft = false;
            const saveMessage = !shouldSendNotifications
                ? "Tutorial changes saved without notifications."
                : notificationFailed
                ? "Tutorial saved, but one or more notifications could not be sent."
                : emailed ? `Tutorial saved and ${emailed} email${emailed === 1 ? " was" : "s were"} sent.` : "Tutorial saved.";
            this.toast("Saved", saveMessage, notificationFailed ? "warning" : "success");
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
