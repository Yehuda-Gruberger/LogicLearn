import {LightningElement, wire, track} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import {refreshApex} from "@salesforce/apex";
import {deleteRecord} from "lightning/uiRecordApi";
import getFolders from "@salesforce/apex/TrainingVideoController.getFolders";
import getAdminVideos from "@salesforce/apex/TrainingVideoController.getAdminVideos";

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
                {label: "Manage (upload & assign)", name: "manage"},
                {label: "Edit details", name: "edit"},
                {label: "Delete", name: "delete"}
            ]
        }
    }
];

export default class TrainingAdminConsole extends LightningElement {
    videoColumns = VIDEO_COLUMNS;

    folders = [];
    @track videos = [];
    _wiredFolders;
    _wiredVideos;

    @track showFolderForm = false;
    @track showVideoForm = false;
    @track showManage = false;
    editingFolderId = null;
    editingVideoId = null;
    manageVideoId = null;
    folderModalTitle = "New Folder";
    videoModalTitle = "New Video";

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

    // ── Folder CRUD ──

    handleNewFolder() {
        this.editingFolderId = null;
        this.folderModalTitle = "New Folder";
        this.showFolderForm = true;
    }

    handleEditFolder(event) {
        this.editingFolderId = event.currentTarget.dataset.id;
        this.folderModalTitle = "Edit Folder";
        this.showFolderForm = true;
    }

    handleDeleteFolder(event) {
        const id = event.currentTarget.dataset.id;
        deleteRecord(id)
            .then(() => {
                this.showToast("Deleted", "Folder deleted. Its videos moved to Ungrouped.", "success");
                return Promise.all([refreshApex(this._wiredFolders), refreshApex(this._wiredVideos)]);
            })
            .catch((e) => this.showToast("Error", this.extractError(e), "error"));
    }

    closeFolderForm() {
        this.showFolderForm = false;
    }

    handleFolderSaved() {
        this.showFolderForm = false;
        this.showToast("Saved", "Folder saved.", "success");
        refreshApex(this._wiredFolders);
    }

    // ── Video CRUD ──

    handleNewVideo() {
        this.editingVideoId = null;
        this.videoModalTitle = "New Video";
        this.showVideoForm = true;
    }

    closeVideoForm() {
        this.showVideoForm = false;
    }

    handleVideoSaved(event) {
        const wasCreate = !this.editingVideoId;
        const newId = event.detail.id;
        this.showVideoForm = false;
        this.showToast("Saved", "Video saved.", "success");
        refreshApex(this._wiredVideos);
        // Straight after creating a video, open Manage so the admin can upload + assign.
        if (wasCreate && newId) {
            this.manageVideoId = newId;
            this.showManage = true;
        }
    }

    handleVideoRowAction(event) {
        const action = event.detail.action.name;
        const row = event.detail.row;
        if (action === "manage") {
            this.manageVideoId = row.id;
            this.showManage = true;
        } else if (action === "edit") {
            this.editingVideoId = row.id;
            this.videoModalTitle = "Edit Video";
            this.showVideoForm = true;
        } else if (action === "delete") {
            deleteRecord(row.id)
                .then(() => {
                    this.showToast("Deleted", "Video deleted.", "success");
                    return refreshApex(this._wiredVideos);
                })
                .catch((e) => this.showToast("Error", this.extractError(e), "error"));
        }
    }

    closeManage() {
        this.showManage = false;
        this.manageVideoId = null;
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
