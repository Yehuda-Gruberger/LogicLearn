import {LightningElement, api} from "lwc";
import getDocument from "@salesforce/apex/TrainingVideoController.getDocument";
import recordDocumentProgress from "@salesforce/apex/TrainingVideoController.recordDocumentProgress";
import getTutorialPages from "@salesforce/apex/LogicLearnAdminController.getTutorialPages";

export default class LogicLearnDocumentReader extends LightningElement {
    @api videoId;
    @api previewOnly = false;
    pages = [];
    title = "Read tutorial";
    currentIndex = 0;
    loading = true;
    error;
    completed = false;

    connectedCallback() { this.load(); }

    @api async reload() { await this.load(); }

    async load() {
        this.loading = true;
        this.error = null;
        try {
            if (this.previewOnly) {
                this.pages = (await getTutorialPages({videoId: this.videoId})) || [];
                this.currentIndex = 0;
            } else {
                const result = await getDocument({videoId: this.videoId});
                this.pages = result.pages || [];
                this.title = result.title || this.title;
                this.currentIndex = Math.max(0, (result.currentPage || 1) - 1);
                this.completed = result.viewStatus === "Completed";
            }
        } catch (error) {
            this.error = error?.body?.message || error?.message || "This tutorial could not be opened.";
        } finally {
            this.loading = false;
        }
    }

    get hasPages() { return this.pages.length > 0; }
    get currentPage() { return this.pages[this.currentIndex] || {}; }
    get pageLabel() { return this.hasPages ? `Page ${this.currentIndex + 1} of ${this.pages.length}` : "No pages"; }
    get progressStyle() { return `width:${this.pages.length ? ((this.currentIndex + 1) / this.pages.length) * 100 : 0}%`; }
    get isFirst() { return this.currentIndex === 0; }
    get isLast() { return this.currentIndex >= this.pages.length - 1; }
    get nextLabel() { return this.isLast ? (this.completed ? "Completed" : "Finish tutorial") : "Next page"; }
    get nextDisabled() { return !this.hasPages || (this.isLast && this.completed) || this.previewOnly && this.isLast; }

    handlePrevious() {
        if (!this.isFirst) this.currentIndex -= 1;
    }

    async handleNext() {
        if (!this.hasPages) return;
        const reached = Math.min(this.currentIndex + 2, this.pages.length);
        if (!this.previewOnly) {
            try {
                await recordDocumentProgress({videoId: this.videoId, pageNumber: reached, totalPages: this.pages.length});
            } catch (error) {
                this.error = error?.body?.message || "Progress could not be saved.";
                return;
            }
        }
        if (!this.isLast) this.currentIndex += 1;
        else {
            this.completed = true;
            this.dispatchEvent(new CustomEvent("progresschange", {detail: {completed: true, percent: 100}}));
        }
    }
}
