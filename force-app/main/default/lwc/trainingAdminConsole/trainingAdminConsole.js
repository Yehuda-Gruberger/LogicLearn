import {LightningElement, api, wire, track} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import LightningConfirm from "lightning/confirm";
import {refreshApex} from "@salesforce/apex";
import {deleteRecord} from "lightning/uiRecordApi";
import getFolders from "@salesforce/apex/TrainingVideoController.getFolders";
import getAdminVideos from "@salesforce/apex/TrainingVideoController.getAdminVideos";
import initializeLogicLearn from "@salesforce/apex/LogicLearnAdminController.initializeLogicLearn";
import getFolder from "@salesforce/apex/LogicLearnAdminController.getFolder";
import saveFolder from "@salesforce/apex/LogicLearnAdminController.saveFolder";
import getTutorial from "@salesforce/apex/LogicLearnAdminController.getTutorial";
import getCatalog from "@salesforce/apex/LogicLearnAdminController.getCatalog";
import getSettings from "@salesforce/apex/LogicLearnAdminController.getSettings";
import getEngagementDetails from "@salesforce/apex/LogicLearnAdminController.getEngagementDetails";

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
    @api activeSection = "tutorials";

    folders = [];
    catalog = {users: [], profiles: [], groups: []};
    globalSettings = {completionThreshold: 90, preventSkipping: true};
    @track videos = [];
    _wiredFolders;
    _wiredVideos;

    @track showFolderForm = false;
    @track showTutorialEditor = false;
    editingFolderId = null;
    editingVideoId = null;
    tutorialRecordId = null;
    editorHighlight = null;
    showTutorialDetails = false;
    selectedTutorial;
    detailLoading = false;
    selectedVideoId;
    videoSearch = "";

    get selectedIsDocument() { return this.selectedTutorial?.contentType === "Document"; }
    folderFilter = [];
    categoryFilter = [];
    statusFilter = [];
    tutorialScope = "all";
    activitySummary = {totalOpens: 0, started: 0, completed: 0, averageWatch: 0, opensStyle: "width:0%", startedStyle: "width:0%", completedStyle: "width:0%", averageStyle: "width:0%"};
    heroOverlayVisible = true;
    engagementMetric;
    engagementRows = [];
    engagementPage = 1;
    engagementPageSize = 6;
    engagementTotal = 0;
    engagementLoading = false;
    showSettingsModal = false;
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
            this.videos = [...result.data].sort((left, right) =>
                new Date(right.createdDate || 0).getTime() - new Date(left.createdDate || 0).getTime());
            if (!this.selectedVideoId && this.videos.length) this.selectTutorial(this.videos[0].id);
            else if (this.selectedVideoId && !this.videos.some((video) => video.id === this.selectedVideoId)) {
                this.selectedVideoId = undefined;
                this.selectedTutorial = undefined;
                if (this.videos.length) this.selectTutorial(this.videos[0].id);
            }
        }
    }

    @wire(getCatalog)
    wiredCatalog({data}) {
        if (!data) return;
        this.catalog = data;
        if (this.selectedTutorial) {
            this.selectedTutorial = {
                ...this.selectedTutorial,
                visibilitySummary: this.audienceSummary(this.selectedTutorial, "visibility"),
                requiredSummary: this.audienceSummary(this.selectedTutorial, "required"),
                notificationSummary: this.notificationSummary(this.selectedTutorial)
            };
        }
    }

    @wire(getSettings)
    wiredSettings({data}) {
        if (!data) return;
        this.globalSettings = data;
        if (this.selectedTutorial) this.applyResolvedSettingLabels();
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

    get videoCount() { return this.videos.length; }
    get videoCountLabel() { return `${this.videoCount} ${this.videoCount === 1 ? "tutorial" : "tutorials"}`; }
    get publishedCount() { return this.videos.filter((video) => video.status === "Published").length; }
    get draftCount() { return this.videos.filter((video) => video.status === "Draft").length; }
    get completionCount() { return this.videos.reduce((total, video) => total + (video.completedCount || 0), 0); }
    get mineCount() { return this.videos.filter((video) => video.isMine).length; }
    get allScopeClass() { return this.tutorialScope === "all" ? "active" : ""; }
    get mineScopeClass() { return this.tutorialScope === "mine" ? "active" : ""; }

    get tutorialRows() {
        const gradients = {
            Onboarding: "linear-gradient(135deg,#0b5563,#0e8ea0)",
            Compliance: "linear-gradient(135deg,#4c3c68,#75568e)",
            Products: "linear-gradient(135deg,#3e5a82,#577da6)",
            Processes: "linear-gradient(135deg,#23614e,#3a8b70)",
            Systems: "linear-gradient(135deg,#284965,#3e6b86)"
        };
        return this.videos.map((video) => ({
            ...video,
            assignedCount: video.assignedCount || 0,
            completedCount: video.completedCount || 0,
            meta: [video.folderName, video.category].filter(Boolean).join(" / ") || "Uncategorized",
            createdLabel: video.createdDate ? new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", year: "numeric"}).format(new Date(video.createdDate)) : "",
            creatorLabel: video.isMine ? "you" : (video.createdByName || "Unknown"),
            statusClass: `status-pill ${(video.status || "Draft").toLowerCase()}`,
            thumbStyle: `background:${gradients[video.category] || "linear-gradient(135deg,#334155,#4d6e7a)"}`,
            rowClass: video.id === this.selectedVideoId ? "browser-item active" : "browser-item"
        }));
    }

    get filteredTutorialRows() {
        const search = this.videoSearch.trim().toLowerCase();
        return this.tutorialRows.filter((video) =>
            (!search || video.title?.toLowerCase().includes(search)) &&
            (!this.folderFilter.length || this.folderFilter.includes(video.folderId)) &&
            (!this.categoryFilter.length || this.categoryFilter.includes(video.category)) &&
            (!this.statusFilter.length || this.statusFilter.includes(video.status)) &&
            (this.tutorialScope !== "mine" || video.isMine)
        );
    }

    get hasFilteredVideos() { return this.filteredTutorialRows.length > 0; }
    get filteredVideoCount() { return this.filteredTutorialRows.length; }

    handleTutorialScope(event) {
        this.tutorialScope = event.currentTarget.dataset.scope;
        const visible = this.filteredTutorialRows;
        if (!visible.some((video) => video.id === this.selectedVideoId)) {
            if (visible.length) this.selectTutorial(visible[0].id);
            else { this.selectedVideoId = undefined; this.selectedTutorial = undefined; }
        }
    }

    get browserFolderOptions() {
        return this.folders.map((folder) => ({value: folder.id, label: folder.name}));
    }

    get browserCategoryOptions() {
        return ["Onboarding", "Compliance", "Products", "Processes", "Systems", "Professional Development", "Other"]
            .map((value) => ({value, label: value}));
    }

    get browserStatusOptions() {
        return ["Draft", "Published", "Archived"].map((value) => ({value, label: value}));
    }

    get selectedRow() {
        return this.tutorialRows.find((video) => video.id === this.selectedVideoId);
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
        this.editorHighlight = null;
        this.showTutorialEditor = true;
    }

    @api
    openNewTutorial() {
        this.activeSection = "tutorials";
        this.handleNewVideo();
    }

    handleVideoRowAction(event) {
        const action = event.detail.action.name;
        const row = event.detail.row;
        if (action === "edit") {
            this.tutorialRecordId = row.id;
            this.editorHighlight = null;
            this.showTutorialEditor = true;
        } else if (action === "delete") {
            this.confirmAndDeleteTutorial(row);
        }
    }

    handleEditTutorial(event) {
        this.tutorialRecordId = event.currentTarget.dataset.id;
        this.editorHighlight = null;
        this.showTutorialEditor = true;
    }

    handleVideoSelect(event) {
        this.selectTutorial(event.currentTarget.dataset.id);
    }

    async selectTutorial(videoId) {
        this.selectedVideoId = videoId;
        this.heroOverlayVisible = true;
        this.activitySummary = this.buildActivitySummary({totalOpens: 0, started: 0, completed: 0, averageWatch: 0});
        this.detailLoading = true;
        try {
            const detail = await getTutorial({videoId});
            if (this.selectedVideoId !== videoId) return;
            const row = this.videos.find((video) => video.id === videoId) || {};
            this.selectedTutorial = {
                ...detail,
                folderName: row.folderName || "Ungrouped",
                assignedCount: row.assignedCount || 0,
                completedCount: row.completedCount || 0,
                visibilitySummary: this.audienceSummary(detail, "visibility"),
                requiredSummary: this.audienceSummary(detail, "required"),
                notificationSummary: this.notificationSummary(detail),
                completionLabel: detail.completionThreshold == null ? `Watch ${this.globalSettings.completionThreshold}% of video` : `Watch ${detail.completionThreshold}% of video`,
                skipLabel: !detail.skipPrevention || detail.skipPrevention === "Use Global Default" ? (this.globalSettings.preventSkipping ? "Enabled" : "Disabled") : detail.skipPrevention,
                dueDateLabel: this.formatDate(detail.dueDate),
                requiredPeopleLabel: `${row.assignedCount || 0} ${(row.assignedCount || 0) === 1 ? "person" : "people"}`
            };
        } catch (error) {
            this.showToast("Could not load tutorial", this.extractError(error), "error");
        } finally {
            if (this.selectedVideoId === videoId) this.detailLoading = false;
        }
    }

    audienceSummary(detail, prefix) {
        const sources = [
            ["Groups", this.catalog.groups],
            ["Profiles", this.catalog.profiles],
            ["Users", this.catalog.users]
        ];
        const labels = sources.flatMap(([suffix, options]) => {
            const lookup = new Map((options || []).map((item) => [String(item.value), item.label]));
            return (detail[`${prefix}${suffix}`] || []).map((id) => lookup.get(String(id)) || String(id));
        });
        return labels.length ? labels.join(", ") : "None";
    }

    notificationSummary(detail) {
        const label = (value) => value === "None" || !value ? "Don’t notify" : value;
        return `Viewers: ${label(detail.publishNotificationChannel)} · Required: ${label(detail.assignmentNotificationChannel)}`;
    }

    applyResolvedSettingLabels() {
        this.selectedTutorial = {
            ...this.selectedTutorial,
            completionLabel: this.selectedTutorial.completionThreshold == null
                ? `Watch ${this.globalSettings.completionThreshold}% of video`
                : `Watch ${this.selectedTutorial.completionThreshold}% of video`,
            skipLabel: !this.selectedTutorial.skipPrevention || this.selectedTutorial.skipPrevention === "Use Global Default"
                ? (this.globalSettings.preventSkipping ? "Enabled" : "Disabled")
                : this.selectedTutorial.skipPrevention
        };
    }

    handleVideoSearch(event) {
        this.videoSearch = event.target.value;
    }

    handleThumbnailEnter(event) {
        const video = event.currentTarget;
        video.muted = true;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => {});
    }

    handleThumbnailLeave(event) {
        const video = event.currentTarget;
        video.pause();
        video.currentTime = 0;
    }

    handleHeroPlay() {
        this.heroOverlayVisible = false;
        this.template.querySelector(".video-hero c-training-video-player")?.play();
    }

    handlePreviewPlay() {
        this.heroOverlayVisible = false;
    }

    handlePreviewPause() {
        this.heroOverlayVisible = true;
    }

    get showEngagementPopover() { return Boolean(this.engagementMetric); }
    get hasEngagementRows() { return this.engagementRows.length > 0; }
    get engagementPageCount() { return Math.max(1, Math.ceil(this.engagementTotal / this.engagementPageSize)); }
    get engagementPageLabel() { return `${this.engagementPage} / ${this.engagementPageCount}`; }
    get engagementHasPrevious() { return this.engagementPage > 1; }
    get engagementHasNext() { return this.engagementPage < this.engagementPageCount; }
    get engagementNoPrevious() { return !this.engagementHasPrevious; }
    get engagementNoNext() { return !this.engagementHasNext; }

    async handleMetricEnter(event) {
        const metric = event.currentTarget.dataset.metric;
        if (this.engagementMetric !== metric) this.engagementPage = 1;
        this.engagementMetric = metric;
        await this.loadEngagementPage();
    }

    hideEngagementDetails() { this.engagementMetric = null; }

    async changeEngagementPage(event) {
        const nextPage = this.engagementPage + Number(event.currentTarget.dataset.direction);
        if (nextPage < 1 || nextPage > this.engagementPageCount) return;
        this.engagementPage = nextPage;
        await this.loadEngagementPage();
    }

    async loadEngagementPage() {
        const metric = this.engagementMetric;
        if (!metric || !this.selectedVideoId) return;
        this.engagementLoading = true;
        try {
            const result = await getEngagementDetails({videoId: this.selectedVideoId, metric, pageNumber: this.engagementPage, pageSize: this.engagementPageSize});
            if (this.engagementMetric !== metric) return;
            this.engagementPage = result.pageNumber;
            this.engagementTotal = result.total;
            this.engagementRows = (result.rows || []).map((row) => ({
                ...row,
                initials: (row.userName || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
                detailLabel: metric === "Total opens" ? `${row.viewCount || 0} open${row.viewCount === 1 ? "" : "s"}` :
                    metric === "Completed" ? "Completed" : `${Math.round(row.watchPercent || 0)}% viewed`
            }));
        } catch (error) {
            this.engagementRows = [];
            this.engagementTotal = 0;
        } finally {
            if (this.engagementMetric === metric) this.engagementLoading = false;
        }
    }

    handleFolderFilter(event) {
        this.folderFilter = event.detail.value || [];
    }

    handleCategoryFilter(event) {
        this.categoryFilter = event.detail.value || [];
    }

    handleStatusFilter(event) {
        this.statusFilter = event.detail.value || [];
    }

    handleEditSelected() {
        if (!this.selectedVideoId) return;
        this.tutorialRecordId = this.selectedVideoId;
        this.editorHighlight = null;
        this.showTutorialEditor = true;
    }

    handleEditAudience() {
        if (!this.selectedVideoId) return;
        this.tutorialRecordId = this.selectedVideoId;
        this.editorHighlight = "audience";
        this.showTutorialEditor = true;
    }

    handleEditSettings() {
        if (!this.selectedVideoId) return;
        this.tutorialRecordId = this.selectedVideoId;
        this.editorHighlight = "settings";
        this.showTutorialEditor = true;
    }

    handleDeleteSelected() {
        const row = this.videos.find((video) => video.id === this.selectedVideoId);
        if (row) this.confirmAndDeleteTutorial(row);
    }

    handleTrackingLoaded(event) {
        this.activitySummary = this.buildActivitySummary(event.detail);
    }

    buildActivitySummary(summary) {
        const audience = Math.max(this.selectedTutorial?.assignedCount || summary.started || summary.completed || 0, 1);
        const percent = (value) => Math.min(100, Math.max(0, Math.round((Number(value || 0) / audience) * 100)));
        return {
            ...summary,
            opensStyle: `width:${summary.totalOpens ? 100 : 0}%`,
            startedStyle: `width:${percent(summary.started)}%`,
            completedStyle: `width:${percent(summary.completed)}%`,
            averageStyle: `width:${Math.min(100, Math.max(0, Number(summary.averageWatch || 0)))}%`
        };
    }

    formatDate(value) {
        if (!value) return "None";
        return new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", year: "numeric"}).format(new Date(`${value}T00:00:00`));
    }

    handleLibraryMode() {
        this.dispatchEvent(new CustomEvent("library"));
    }

    openSettings() { this.showSettingsModal = true; }
    closeSettings() { this.showSettingsModal = false; }
    openTutorials() { this.activeSection = "tutorials"; }

    handleDeleteTutorial(event) {
        const row = this.videos.find((video) => video.id === event.currentTarget.dataset.id);
        if (row) this.confirmAndDeleteTutorial(row);
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
        this.editorHighlight = null;
    }

    async handleTutorialSaved() {
        this.closeTutorialEditor();
        await refreshApex(this._wiredVideos);
        if (this.selectedVideoId) await this.selectTutorial(this.selectedVideoId);
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
