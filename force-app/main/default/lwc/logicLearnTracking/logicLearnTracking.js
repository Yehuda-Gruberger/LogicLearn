import {LightningElement, api} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import getAdminVideos from "@salesforce/apex/TrainingVideoController.getAdminVideos";
import getTracking from "@salesforce/apex/LogicLearnAdminController.getTracking";
import sendNotification from "@salesforce/apex/LogicLearnAdminController.sendNotification";
import sendInAppNotification from "@salesforce/apex/LogicLearnAdminController.sendInAppNotification";

const COLUMNS = [
    {label: "Learner", fieldName: "userName"}, {label: "Status", fieldName: "status"},
    {label: "Watched %", fieldName: "watchPercent", type: "number"}, {label: "Opens", fieldName: "viewCount", type: "number"},
    {label: "First opened", fieldName: "firstViewedAt", type: "date"}, {label: "Last opened", fieldName: "lastViewedAt", type: "date"},
    {label: "Due", fieldName: "dueDate", type: "date"}, {label: "Overdue", fieldName: "overdue", type: "boolean"},
    {label: "Completed", fieldName: "completedAt", type: "date"}, {label: "Method", fieldName: "completionMethod"}
];

export default class LogicLearnTracking extends LightningElement {
    columns = COLUMNS;
    videos = [];
    _videoId;
    _connected = false;
    @api compact = false;
    @api people = false;
    rows = [];
    peopleSearch = "";
    loading = true;
    reminderChannel = "In-app";
    sending = false;

    @api
    get videoId() { return this._videoId; }
    set videoId(value) {
        if (value === this._videoId) return;
        this._videoId = value;
        if (this._connected && value) this.loadTracking();
    }

    connectedCallback() { this._connected = true; this.loadVideos(); }

    async loadVideos() {
        try {
            const rows = await getAdminVideos();
            this.videos = rows.map((video) => ({value: video.id, label: video.title, meta: `${video.status} / ${video.folderName || "Ungrouped"}`}));
            if (this.videoId) await this.loadTracking();
        } catch (error) {
            this.toast("Could not load tutorials", this.message(error), "error");
        } finally {
            this.loading = false;
        }
    }

    get hasRows() { return this.rows.length > 0; }
    get toolbarClass() { return this.compact ? "toolbar compact" : "toolbar"; }
    get channelOptions() { return ["In-app", "Email", "Both"].map((value) => ({label: value, value})); }
    get filteredPeople() {
        const search = this.peopleSearch.trim().toLowerCase();
        return this.rows
            .filter((row) => !search || row.userName?.toLowerCase().includes(search) || row.status?.toLowerCase().includes(search))
            .map((row, index) => ({
                ...row,
                initials: (row.userName || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
                avatarClass: `person-avatar tone-${index % 5}`,
                displayStatus: row.overdue ? "Overdue" : row.status,
                statusClass: `person-status ${(row.overdue ? "overdue" : row.status || "not-started").toLowerCase().replaceAll(" ", "-")}`,
                progressStyle: `width:${Math.min(100, Math.max(0, Number(row.watchPercent || 0)))}%`,
                activityLabel: row.viewCount ? `${row.watchPercent || 0}% watched · ${row.viewCount} open${row.viewCount === 1 ? "" : "s"}` : "Not opened yet"
            }));
    }
    get peopleCountLabel() { return `${this.rows.length} ${this.rows.length === 1 ? "learner" : "learners"}`; }

    async handleVideo(event) {
        this.videoId = event.detail.value;
        await this.loadTracking();
    }

    async loadTracking() {
        this.loading = true;
        try {
            this.rows = await getTracking({videoId: this.videoId});
            const totalWatch = this.rows.reduce((sum, row) => sum + Number(row.watchPercent || 0), 0);
            this.dispatchEvent(new CustomEvent("trackingloaded", {detail: {
                totalOpens: this.rows.reduce((sum, row) => sum + Number(row.viewCount || 0), 0),
                started: this.rows.filter((row) => Number(row.viewCount || 0) > 0).length,
                completed: this.rows.filter((row) => row.status === "Completed").length,
                averageWatch: this.rows.length ? Math.round(totalWatch / this.rows.length) : 0
            }}));
        }
        catch (error) { this.toast("Could not load tracking", this.message(error), "error"); }
        finally { this.loading = false; }
    }

    handleChannel(event) { this.reminderChannel = event.detail.value; }
    handlePeopleSearch(event) { this.peopleSearch = event.target.value; }
    handleAddGroup() { this.dispatchEvent(new CustomEvent("addgroup")); }
    handleAssignPeople() { this.dispatchEvent(new CustomEvent("assignpeople")); }

    async sendReminder() {
        if (!this.videoId) return;
        this.sending = true;
        try {
            const jobs = [];
            if (["Email", "Both"].includes(this.reminderChannel)) jobs.push(sendNotification({videoId: this.videoId, notificationType: "Reminder"}));
            if (["In-app", "Both"].includes(this.reminderChannel)) jobs.push(sendInAppNotification({videoId: this.videoId, notificationType: "Reminder"}));
            const counts = await Promise.all(jobs);
            const count = counts.reduce((sum, value) => sum + value, 0);
            this.toast("Reminders sent", `${count} notification${count === 1 ? "" : "s"} sent to incomplete learners.`, "success");
        } catch (error) { this.toast("Could not send reminders", this.message(error), "error"); }
        finally { this.sending = false; }
    }

    exportCsv() {
        if (!this.rows.length) return;
        const cols = ["Learner", "Status", "Watch Percent", "Opens", "First Viewed", "Last Viewed", "Due Date", "Overdue", "Completed", "Method"];
        const clean = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const lines = [cols.map(clean).join(","), ...this.rows.map((row) => [row.userName, row.status, row.watchPercent, row.viewCount, row.firstViewedAt, row.lastViewedAt, row.dueDate, row.overdue, row.completedAt, row.completionMethod].map(clean).join(","))];
        const link = document.createElement("a");
        link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(lines.join("\n"))}`;
        link.download = "logiclearn-tracking.csv";
        link.click();
    }

    toast(title, message, variant) { this.dispatchEvent(new ShowToastEvent({title, message, variant})); }
    message(error) { return error?.body?.message || error?.message || "Something went wrong."; }
}
