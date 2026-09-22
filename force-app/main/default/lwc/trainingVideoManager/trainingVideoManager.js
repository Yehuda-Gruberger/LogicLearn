import {LightningElement, api, wire, track} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import LightningConfirm from "lightning/confirm";
import {refreshApex} from "@salesforce/apex";
import getProfiles from "@salesforce/apex/TrainingVideoController.getProfiles";
import searchUsers from "@salesforce/apex/TrainingVideoController.searchUsers";
import assignToAudience from "@salesforce/apex/TrainingVideoController.assignToAudience";
import getAssignments from "@salesforce/apex/TrainingVideoController.getAssignments";
import removeAssignment from "@salesforce/apex/TrainingVideoController.removeAssignment";
import getCurrentVideoFile from "@salesforce/apex/TrainingVideoController.getCurrentVideoFile";
import setUploadedVideo from "@salesforce/apex/TrainingVideoController.setUploadedVideo";
import removeAllAssignments from "@salesforce/apex/TrainingVideoController.removeAllAssignments";

const COLUMNS = [
    {label: "User", fieldName: "userName", type: "text", sortable: true},
    {label: "Status", fieldName: "status", type: "text", sortable: true, cellAttributes: {class: {fieldName: "statusClass"}}},
    {label: "Watched", fieldName: "watchLabel", type: "text", initialWidth: 100, sortable: true},
    {
        label: "Completed",
        fieldName: "completedAt",
        type: "date",
        sortable: true,
        typeAttributes: {year: "numeric", month: "short", day: "numeric"}
    },
    {label: "Assigned Via", fieldName: "assignedVia", type: "text", sortable: true},
    {
        label: "Notified",
        fieldName: "notifiedAt",
        type: "date",
        sortable: true,
        typeAttributes: {year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"}
    },
    {
        type: "button-icon",
        initialWidth: 60,
        typeAttributes: {
            iconName: "utility:close",
            name: "remove",
            title: "Remove assignment",
            alternativeText: "Remove",
            variant: "bare"
        }
    }
];

export default class TrainingVideoManager extends LightningElement {
    @api recordId;
    columns = COLUMNS;
    acceptedFormats = [".mp4", ".mov", ".m4v", ".webm"];

    @track selectedProfileIds = [];
    profileOptions = [];

    @track userTerm = "";
    @track userResults = [];
    @track selectedUsers = [];
    @track isAssigning = false;
    @track notifyByEmail = false;

    @track assignments = [];
    @track assigneeSearch = "";
    @track sortedBy;
    @track sortedDirection = "asc";
    @track pageNumber = 1;
    pageSize = 10;
    currentFileLabel;
    _wiredFile;
    _wiredAssignments;
    _searchTimer;

    @wire(getProfiles)
    wiredProfiles({data}) {
        if (data) {
            this.profileOptions = data.map((o) => ({label: o.label, value: o.id}));
        }
    }

    @wire(getCurrentVideoFile, {videoId: "$recordId"})
    wiredFile(result) {
        this._wiredFile = result;
        if (result.data !== undefined) {
            this.currentFileLabel = result.data ? result.data.label : null;
        }
    }

    @wire(getAssignments, {videoId: "$recordId"})
    wiredAssignments(result) {
        this._wiredAssignments = result;
        if (result.data) {
            this.assignments = result.data.map((r) => ({
                ...r,
                watchLabel: `${r.watchPercent != null ? Math.round(r.watchPercent) : 0}%`,
                statusClass:
                    r.status === "Completed"
                        ? "slds-text-color_success"
                        : r.status === "In Progress"
                        ? "slds-text-color_default"
                        : "slds-text-color_weak"
            }));
        }
    }

    // ── Video file ──

    get hasFile() {
        return !!this.currentFileLabel;
    }

    get uploadLabel() {
        return this.hasFile ? "Replace video" : "Upload video";
    }

    handleUploadFinished(event) {
        const files = event.detail.files;
        if (!files || !files.length) {
            return;
        }
        setUploadedVideo({videoId: this.recordId, contentDocumentId: files[0].documentId})
            .then(() => {
                this.showToast("Video uploaded", "This is now the video for this record.", "success");
                return refreshApex(this._wiredFile);
            })
            .catch((e) => this.showToast("Upload error", this.extractError(e), "error"));
    }

    // ── Audience ──

    handleProfileChange(event) {
        this.selectedProfileIds = event.detail.value;
    }

    handleUserSearch(event) {
        this.userTerm = event.target.value;
        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
        }
        this._searchTimer = setTimeout(() => {
            if (!this.userTerm || this.userTerm.length < 2) {
                this.userResults = [];
                return;
            }
            searchUsers({term: this.userTerm})
                .then((r) => {
                    // Hide already-selected users from the results.
                    const chosen = new Set(this.selectedUsers.map((u) => u.id));
                    this.userResults = r.filter((o) => !chosen.has(o.id));
                })
                .catch(() => {
                    this.userResults = [];
                });
        }, 300);
    }

    handleAddUser(event) {
        const id = event.currentTarget.dataset.id;
        const label = event.currentTarget.dataset.label;
        if (!this.selectedUsers.some((u) => u.id === id)) {
            this.selectedUsers = [...this.selectedUsers, {id, label}];
        }
        this.userResults = [];
        this.userTerm = "";
    }

    handleRemoveUser(event) {
        const id = event.currentTarget.dataset.id;
        this.selectedUsers = this.selectedUsers.filter((u) => u.id !== id);
    }

    get hasUserResults() {
        return this.userResults.length > 0;
    }

    get canAssign() {
        return !this.isAssigning && (this.selectedProfileIds.length > 0 || this.selectedUsers.length > 0);
    }

    get assignDisabled() {
        return !this.canAssign;
    }

    handleNotifyToggle(event) {
        this.notifyByEmail = event.target.checked;
    }

    handleAssign() {
        this.isAssigning = true;
        const wantedEmail = this.notifyByEmail;
        assignToAudience({
            videoId: this.recordId,
            profileIds: this.selectedProfileIds,
            userIds: this.selectedUsers.map((u) => u.id),
            notify: wantedEmail
        })
            .then((res) => {
                let msg = `${res.assigned} user${res.assigned === 1 ? "" : "s"} assigned as mandatory.`;
                if (wantedEmail) {
                    msg +=
                        res.notified > 0
                            ? ` ${res.notified} newly notified by email.`
                            : " No new emails sent — those users were already notified (or email delivery is off).";
                }
                this.showToast("Assigned", msg, "success");
                this.selectedUsers = [];
                this.selectedProfileIds = [];
                this.notifyByEmail = false;
                return refreshApex(this._wiredAssignments);
            })
            .catch((e) => this.showToast("Assignment error", this.extractError(e), "error"))
            .finally(() => {
                this.isAssigning = false;
            });
    }

    // ── Tracking table ──

    get hasAssignments() {
        return this.assignments.length > 0;
    }

    get summaryLabel() {
        const assigned = this.assignments.filter((a) => a.assigned);
        const done = assigned.filter((a) => a.status === "Completed").length;
        return assigned.length
            ? `${done} of ${assigned.length} assigned ${assigned.length === 1 ? "user has" : "users have"} completed`
            : "No one is assigned yet";
    }

    // Search → sort → paginate pipeline over the assignee rows.
    get filteredAssignments() {
        const term = this.assigneeSearch.trim().toLowerCase();
        let rows = term
            ? this.assignments.filter((r) => r.userName && r.userName.toLowerCase().includes(term))
            : this.assignments;

        if (this.sortedBy) {
            const dir = this.sortedDirection === "asc" ? 1 : -1;
            const key = this.sortedBy;
            rows = [...rows].sort((a, b) => {
                // Sort the "Watched" column by its numeric percent, not the "42%" label.
                let av = key === "watchLabel" ? a.watchPercent || 0 : a[key];
                let bv = key === "watchLabel" ? b.watchPercent || 0 : b[key];
                if (typeof av === "string" || typeof bv === "string") {
                    av = (av || "").toString().toLowerCase();
                    bv = (bv || "").toString().toLowerCase();
                }
                if (av > bv) return dir;
                if (av < bv) return -dir;
                return 0;
            });
        }
        return rows;
    }

    get totalPages() {
        return Math.max(1, Math.ceil(this.filteredAssignments.length / this.pageSize));
    }

    get pagedAssignments() {
        const start = (this.pageNumber - 1) * this.pageSize;
        return this.filteredAssignments.slice(start, start + this.pageSize);
    }

    get showPagination() {
        return this.filteredAssignments.length > this.pageSize;
    }

    get pageInfo() {
        const total = this.filteredAssignments.length;
        if (total === 0) {
            return "No matches";
        }
        const start = (this.pageNumber - 1) * this.pageSize + 1;
        const end = Math.min(this.pageNumber * this.pageSize, total);
        return `${start}–${end} of ${total}`;
    }

    get isFirstPage() {
        return this.pageNumber <= 1;
    }

    get isLastPage() {
        return this.pageNumber >= this.totalPages;
    }

    handleAssigneeSearch(event) {
        this.assigneeSearch = event.target.value;
        this.pageNumber = 1;
    }

    handleSort(event) {
        this.sortedBy = event.detail.fieldName;
        this.sortedDirection = event.detail.sortDirection;
        this.pageNumber = 1;
    }

    handlePrevPage() {
        if (this.pageNumber > 1) {
            this.pageNumber -= 1;
        }
    }

    handleNextPage() {
        if (this.pageNumber < this.totalPages) {
            this.pageNumber += 1;
        }
    }

    async handleRemoveAll() {
        const confirmed = await LightningConfirm.open({
            message:
                "Remove all assignments for this video? People who've already watched keep their history (they're just un-assigned); those who haven't started are cleared.",
            label: "Remove all assignments",
            theme: "warning"
        });
        if (!confirmed) {
            return;
        }
        removeAllAssignments({videoId: this.recordId})
            .then(() => {
                this.showToast("Removed", "All assignments removed.", "success");
                return refreshApex(this._wiredAssignments);
            })
            .catch((e) => this.showToast("Error", this.extractError(e), "error"));
    }

    handleRowAction(event) {
        if (event.detail.action.name === "remove") {
            removeAssignment({trainingViewId: event.detail.row.id})
                .then(() => {
                    this.showToast("Removed", "Assignment removed.", "success");
                    return refreshApex(this._wiredAssignments);
                })
                .catch((e) => this.showToast("Error", this.extractError(e), "error"));
        }
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
