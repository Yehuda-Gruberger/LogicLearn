import {LightningElement, wire, track} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import LightningConfirm from "lightning/confirm";
import {refreshApex} from "@salesforce/apex";
import {deleteRecord} from "lightning/uiRecordApi";
import getFolders from "@salesforce/apex/TrainingVideoController.getFolders";
import getAdminVideos from "@salesforce/apex/TrainingVideoController.getAdminVideos";
import initializeLogicLearn from "@salesforce/apex/LogicLearnAdminController.initializeLogicLearn";
import getFolder from "@salesforce/apex/LogicLearnAdminController.getFolder";
import saveFolder from "@salesforce/apex/LogicLearnAdminController.saveFolder";

const VIDEO_COLUMNS = [
    {label: "Title", fieldName: "title", type: "text"},
    {label: "Folder", fieldName: "folderName", type: "text"},
    {label: "Category", fieldName: "category", type: "text"},
    {label: "Status", fieldName: "status", type: "text"},
    {label: "Assigned", fieldName: "assignedCount", type: "number", initialWidth: 90, cellAttributes: {alignment: "center"}},
    {label: "Completed", fieldName: "completedCount", type: "number", initialWidth: 100, cellAttributes: {alignment: "center"}},
    {
        type: "action",
        typeAttributes: {
            rowActions: [
                {label: "Edit tutorial", name: "edit"},
                {label: "Delete", name: "delete"}
            ]
        }
    }
];

export default class TrainingAdminConsole extends LightningElement {
    videoColumns = VIDEO_COLUMNS;
    activeSection = "tutorials";

    folders = [];
    @track videos = [];
    _wiredFolders;
    _wiredVideos;

    @track showFolderForm = false;
    @track showTutorialEditor = false;
    editingFolderId = null;
    editingVideoId = null;
    tutorialRecordId = null;
    folderModalTitle = "New Folder";
    videoModalTitle = "New Video";
    folderForm = {folderId: null, name: "", parentId: null, sortOrder: null, icon: "", description: ""};

    connectedCallback() {
        initializeLogicLearn()
            .then(() => Promise.all([
                this._wiredFolders ? refreshApex(this._wiredFolders) : Promise.resolve(),
                this._wiredVideos ? refreshApex(this._wiredVideos) : Promise.resolve()
            ]))
            .catch((error) => this.showToast("Setup error", this.extractError(error), "error"));
    }

    get isTutorials() { return this.activeSection === "tutorials"; }
    get isGroups() { return this.activeSection === "groups"; }
    get isTracking() { return this.activeSection === "tracking"; }
    get isSettings() { return this.activeSection === "settings"; }
    get tutorialsTabClass() { return this.activeSection === "tutorials" ? "admin-tab active" : "admin-tab"; }
    get groupsTabClass() { return this.activeSection === "groups" ? "admin-tab active" : "admin-tab"; }
    get trackingTabClass() { return this.activeSection === "tracking" ? "admin-tab active" : "admin-tab"; }
    get settingsTabClass() { return this.activeSection === "settings" ? "admin-tab active" : "admin-tab"; }
    handleSection(event) { this.activeSection = event.currentTarget.dataset.section; }

    @wire(getFolders)
    wiredFolders(result) {
        this._wiredFolders = result;
        if (result.data) {
            this.folders = result.data;
        }
    }

    @wire(getAdminVideos)
    wiredVideos(result) {
        this._wiredVideos = result;
        if (result.data) {
            this.videos = result.data;
        }
    }

    // Hierarchical, indented folder list.
    get folderList() {
        const items = [];
        const added = new Set();
        const childrenOf = (pid) => this.folders.filter((f) => (f.parentId || null) === (pid || null));
        const walk = (folder, level) => {
            if (added.has(folder.id)) {
                return;
            }
            added.add(folder.id);
            items.push({
                id: folder.id,
                name: folder.name,
                rowClass: level > 0 ? "folder-row child" : "folder-row",
                indentStyle: level > 0 ? `padding-left:${level * 1.2}rem` : ""
            });
            childrenOf(folder.id).forEach((c) => walk(c, level + 1));
        };
        this.folders.filter((f) => !f.parentId).forEach((t) => walk(t, 0));
        this.folders.forEach((f) => {
            if (!added.has(f.id)) {
                walk(f, 1);
            }
        });
        return items;
    }

    get hasFolders() {
        return this.folders.length > 0;
    }

    get hasVideos() {
        return this.videos.length > 0;
    }

    get folderOptions() {
        return this.folders.filter((folder) => folder.id !== this.folderForm.folderId)
            .map((folder) => ({value: folder.id, label: folder.name, meta: "Folder"}));
    }

    // ── Folder CRUD ──

    handleNewFolder() {
        this.editingFolderId = null;
        this.folderModalTitle = "New Folder";
        this.folderForm = {folderId: null, name: "", parentId: null, sortOrder: null, icon: "", description: ""};
        this.showFolderForm = true;
    }

    async handleEditFolder(event) {
        this.editingFolderId = event.currentTarget.dataset.id;
        this.folderModalTitle = "Edit Folder";
        try {
            this.folderForm = await getFolder({folderId: this.editingFolderId});
            this.showFolderForm = true;
        } catch (error) {
            this.showToast("Error", this.extractError(error), "error");
        }
    }

    async handleDeleteFolder(event) {
        const id = event.currentTarget.dataset.id;
        const folderName = this.folders.find((folder) => folder.id === id)?.name || "this folder";
        const confirmed = await LightningConfirm.open({
            label: "Delete folder?",
            message: `Are you sure you want to delete “${folderName}”? Its tutorials will move to Ungrouped.`,
            theme: "warning"
        });
        if (!confirmed) return;
        try {
            await deleteRecord(id);
            this.showToast("Deleted", `${folderName} was deleted. Its tutorials moved to Ungrouped.`, "success");
            await Promise.all([refreshApex(this._wiredFolders), refreshApex(this._wiredVideos)]);
        } catch (error) {
            this.showToast("Error", this.extractError(error), "error");
        }
    }

    closeFolderForm() {
        this.showFolderForm = false;
    }

    handleFolderField(event) {
        this.folderForm = {...this.folderForm, [event.currentTarget.dataset.field]: event.target.value};
    }

    handleFolderParent(event) {
        this.folderForm = {...this.folderForm, parentId: event.detail.value};
    }

    async handleFolderSaved() {
        const name = this.template.querySelector('[data-field="name"]');
        if (!name.reportValidity()) return;
        try {
            await saveFolder({input: this.folderForm});
            this.showFolderForm = false;
            this.showToast("Saved", "Folder saved.", "success");
            await refreshApex(this._wiredFolders);
        } catch (error) {
            this.showToast("Error", this.extractError(error), "error");
        }
    }

    // ── Video CRUD ──

    handleNewVideo() {
        this.tutorialRecordId = null;
        this.showTutorialEditor = true;
    }

    handleVideoRowAction(event) {
        const action = event.detail.action.name;
        const row = event.detail.row;
        if (action === "edit") {
            this.tutorialRecordId = row.id;
            this.showTutorialEditor = true;
        } else if (action === "delete") {
            this.confirmAndDeleteTutorial(row);
        }
    }

    async confirmAndDeleteTutorial(row) {
        const confirmed = await LightningConfirm.open({
            label: "Delete tutorial?",
            message: `Are you sure you want to delete “${row.title}”? Its video and tracking relationship cannot be restored.`,
            theme: "warning"
        });
        if (!confirmed) return;
        try {
            await deleteRecord(row.id);
            this.showToast("Deleted", `${row.title} was deleted.`, "success");
            await refreshApex(this._wiredVideos);
        } catch (error) {
            this.showToast("Error", this.extractError(error), "error");
        }
    }

    closeTutorialEditor() {
        this.showTutorialEditor = false;
        this.tutorialRecordId = null;
    }

    handleTutorialSaved() {
        this.closeTutorialEditor();
        refreshApex(this._wiredVideos);
    }

    stopPropagation(event) {
        event.stopPropagation();
    }

    // ── Utils ──

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({title, message, variant}));
    }

    extractError(error) {
        if (error && error.body && error.body.message) {
            return error.body.message;
        }
        return "Something went wrong.";
    }
}
