import {LightningElement, wire, track} from "lwc";
import {CurrentPageReference} from "lightning/navigation";
import {refreshApex} from "@salesforce/apex";
import getLibrary from "@salesforce/apex/TrainingVideoController.getLibrary";
import getFolders from "@salesforce/apex/TrainingVideoController.getFolders";
import isLibraryAdmin from "@salesforce/apex/TrainingVideoController.isLibraryAdmin";

// Gradient backgrounds for card thumbnails, keyed by category (falls back to a neutral teal).
const CATEGORY_GRADIENTS = {
    Onboarding: "linear-gradient(135deg,#0b5563,#0e8ea0)",
    Compliance: "linear-gradient(135deg,#8f1d18,#c2453c)",
    Products: "linear-gradient(135deg,#5a3d82,#8158b0)",
    Processes: "linear-gradient(135deg,#1f6b3c,#3a9459)",
    Systems: "linear-gradient(135deg,#274b74,#3f6fa3)",
    "Professional Development": "linear-gradient(135deg,#8a5318,#c6802f)",
    Other: "linear-gradient(135deg,#334155,#475569)"
};

export default class TrainingLibrary extends LightningElement {
    @track searchTerm = "";
    @track selectedFolderId = "all";
    @track showPlayer = false;
    @track mode = "library";
    @track activeVideoId;
    @track activeAutoplay = false;
    isAdmin = false;
    _deepLinkHandled;

    sections = [];
    folders = [];
    error;
    _wired;

    @wire(isLibraryAdmin)
    wiredAdmin({data}) {
        if (data !== undefined) {
            this.isAdmin = data;
        }
    }

    // Deep link from the email notification: /lightning/n/Training_Library?c__videoId=<id>
    // opens that video's player automatically (once per distinct id).
    @wire(CurrentPageReference)
    handlePageRef(pageRef) {
        const videoId = pageRef && pageRef.state ? pageRef.state.c__videoId : null;
        if (videoId && videoId !== this._deepLinkHandled) {
            this._deepLinkHandled = videoId;
            this.mode = "library";
            this.activeVideoId = videoId;
            // Arriving via the email link: open the player but wait for the user to press play.
            this.activeAutoplay = false;
            this.showPlayer = true;
        }
    }

    // Title for the player modal header — resolved from the loaded library by the active id.
    get activeTitle() {
        if (!this.activeVideoId) {
            return "";
        }
        for (const section of this.sections) {
            const match = section.videos.find((v) => v.id === this.activeVideoId);
            if (match) {
                return match.title;
            }
        }
        return "Training video";
    }

    get isAdminMode() {
        return this.mode === "admin";
    }

    get libraryBtnClass() {
        return this.mode === "library" ? "seg-btn on" : "seg-btn";
    }

    get adminBtnClass() {
        return this.mode === "admin" ? "seg-btn on" : "seg-btn";
    }

    showLibraryMode() {
        this.mode = "library";
    }

    showAdminMode() {
        this.mode = "admin";
    }

    @wire(getLibrary, {folderId: "$apexFolderId", category: null})
    wiredLibrary(result) {
        this._wired = result;
        if (result.data) {
            this.sections = result.data;
            this.error = undefined;
        } else if (result.error) {
            this.error = this.extractError(result.error);
        }
    }

    @wire(getFolders)
    wiredFolders({data}) {
        if (data) {
            this.folders = data;
        }
    }

    // id -> folder record, for parent lookups.
    get folderIndex() {
        const idx = {};
        for (const f of this.folders) {
            idx[f.id] = f;
        }
        return idx;
    }

    // folderId (or 'none') -> number of videos, from the loaded sections.
    get countsByFolder() {
        const counts = {};
        for (const s of this.sections) {
            const key = s.folderId || "none";
            counts[key] = (counts[key] || 0) + s.videos.length;
        }
        return counts;
    }

    // We fetch the whole library once and filter client-side, so the wire always passes null.
    get apexFolderId() {
        return null;
    }

    // ───────── Folder rail ─────────

    // Hierarchical rail: top-level folders, each followed by its (indented) children.
    get folderItems() {
        const counts = this.countsByFolder;
        const items = [
            {
                id: "all",
                name: "All Training",
                count: this.totalVideoCount,
                itemClass: this.railClass("all"),
                indentStyle: ""
            }
        ];
        const added = new Set();
        const childrenOf = (pid) => this.folders.filter((f) => (f.parentId || null) === (pid || null));
        const walk = (folder, level) => {
            if (added.has(folder.id) || level > 4) {
                return;
            }
            added.add(folder.id);
            items.push(this.railItem(folder, level, counts));
            for (const child of childrenOf(folder.id)) {
                walk(child, level + 1);
            }
        };
        this.folders.filter((f) => !f.parentId).forEach((top) => walk(top, 0));
        // Safety net for any folder whose parent isn't a top-level node.
        this.folders.forEach((f) => {
            if (!added.has(f.id)) {
                walk(f, 1);
            }
        });
        return items;
    }

    railItem(folder, level, counts) {
        return {
            id: folder.id,
            name: folder.name,
            // Rolled-up count: this folder's own videos plus everything in its subfolders.
            count: this.rollupCount(folder.id, counts, 0),
            itemClass: this.railClass(folder.id) + (level > 0 ? " child" : ""),
            indentStyle: level > 0 ? `padding-left:${0.6 + level * 1}rem` : ""
        };
    }

    // Sum a folder's direct videos plus all descendants' (depth-guarded against bad data).
    rollupCount(folderId, counts, depth) {
        let total = counts[folderId] || 0;
        if (depth < 6) {
            for (const child of this.folders.filter((f) => f.parentId === folderId)) {
                total += this.rollupCount(child.id, counts, depth + 1);
            }
        }
        return total;
    }

    // Folder ids in the same top-to-bottom order the rail shows, so main sections match.
    get orderedFolderIds() {
        return this.folderItems.filter((i) => i.id !== "all").map((i) => i.id);
    }

    railClass(id) {
        return this.selectedFolderId === id ? "rail-item active" : "rail-item";
    }

    // A section belongs to the current selection if it's the selected folder itself or a
    // direct child of it (selecting a parent shows its subfolders' videos too).
    isInSelection(folderId) {
        if (this.selectedFolderId === "all") {
            return true;
        }
        const key = folderId || "none";
        if (key === this.selectedFolderId) {
            return true;
        }
        const folder = this.folderIndex[folderId];
        return !!(folder && folder.parentId === this.selectedFolderId);
    }

    // Section heading shows "Parent › Child" for nested folders.
    sectionName(section) {
        const folder = this.folderIndex[section.folderId];
        if (folder && folder.parentId && this.folderIndex[folder.parentId]) {
            return `${this.folderIndex[folder.parentId].name} › ${section.folderName}`;
        }
        return section.folderName;
    }

    get totalVideoCount() {
        return this.sections.reduce((sum, s) => sum + s.videos.length, 0);
    }

    get overallProgressLabel() {
        const total = this.totalVideoCount;
        const done = this.sections.reduce(
            (sum, s) => sum + s.videos.filter((v) => v.viewStatus === "Completed").length,
            0
        );
        return {done, total, percent: total ? Math.round((done / total) * 100) : 0};
    }

    get progressStyle() {
        return `width:${this.overallProgressLabel.percent}%`;
    }

    get progressCountLabel() {
        const p = this.overallProgressLabel;
        return `${p.done} / ${p.total}`;
    }

    // ───────── Sections + cards ─────────

    get displaySections() {
        const term = this.searchTerm.trim().toLowerCase();
        const order = this.orderedFolderIds;
        const rank = (folderId) => {
            const idx = order.indexOf(folderId || "none");
            return idx === -1 ? 9999 : idx; // ungrouped / unknown sort last
        };
        return this.sections
            .filter((s) => this.isInSelection(s.folderId))
            .map((s) => {
                const videos = s.videos
                    .filter((v) => !term || (v.title && v.title.toLowerCase().includes(term)))
                    .map((v) => this.decorate(v));
                const doneCount = videos.filter((v) => v.viewStatus === "Completed").length;
                return {
                    key: s.folderId || "none",
                    folderName: this.sectionName(s),
                    description: s.description,
                    videos,
                    countLabel: `${videos.length} ${videos.length === 1 ? "video" : "videos"}`,
                    doneLabel: `${doneCount} of ${videos.length} complete`,
                    hasVideos: videos.length > 0,
                    _rank: rank(s.folderId)
                };
            })
            .filter((s) => s.hasVideos)
            .sort((a, b) => a._rank - b._rank);
    }

    get hasResults() {
        return this.displaySections.length > 0;
    }

    decorate(video) {
        const meta = this.statusMeta(video);
        // Highlight mandatory videos that still need attention (not yet completed).
        const emphasize = video.isMandatory && video.viewStatus !== "Completed";
        return {
            ...video,
            pillClass: meta.pillClass,
            pillLabel: meta.pillLabel,
            footNote: meta.footNote,
            showProgressBar: meta.showProgressBar,
            progressBarStyle: `width:${video.watchPercent || 0}%`,
            thumbStyle: `background:${CATEGORY_GRADIENTS[video.category] || CATEGORY_GRADIENTS.Other}`,
            durationLabel: this.formatDuration(video.durationSeconds),
            cardClass: emphasize ? "card mandatory" : "card"
        };
    }

    statusMeta(video) {
        // The status pill always reflects progress. "Mandatory" is a separate, persistent
        // marker (see the ribbon in the template) so it stays visible at every status.
        if (video.viewStatus === "Completed") {
            return {pillClass: "pill done", pillLabel: "Completed", footNote: "", showProgressBar: true};
        }
        if (video.viewStatus === "In Progress") {
            return {
                pillClass: "pill prog",
                pillLabel: "In progress",
                footNote: `${Math.round(video.watchPercent || 0)}%`,
                showProgressBar: true
            };
        }
        return {pillClass: "pill pend", pillLabel: "Not started", footNote: "", showProgressBar: false};
    }

    // ───────── Events ─────────

    handleSearch(event) {
        this.searchTerm = event.target.value;
    }

    handleFolderSelect(event) {
        this.selectedFolderId = event.currentTarget.dataset.id;
    }

    handleCardClick(event) {
        this.activeVideoId = event.currentTarget.dataset.id;
        // Clicking a card is a user gesture, so start playing immediately.
        this.activeAutoplay = true;
        this.showPlayer = true;
    }

    async handleClosePlayer() {
        this.showPlayer = false;
        this.activeVideoId = undefined;
        // Refresh so the card reflects any new In Progress / Completed status from this watch.
        await refreshApex(this._wired);
    }

    // Keep clicks inside the modal from bubbling to the backdrop (which closes it).
    stopPropagation(event) {
        event.stopPropagation();
    }

    handleRefresh() {
        return refreshApex(this._wired);
    }

    // ───────── Utils ─────────

    formatDuration(seconds) {
        if (!seconds || seconds <= 0) {
            return "";
        }
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${String(s).padStart(2, "0")}`;
    }

    extractError(error) {
        if (error && error.body && error.body.message) {
            return error.body.message;
        }
        return "Unable to load the training library.";
    }
}
