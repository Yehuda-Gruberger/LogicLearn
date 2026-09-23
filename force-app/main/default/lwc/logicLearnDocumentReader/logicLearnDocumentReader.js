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
    pageRequirement = "Every page";
    readingOrder = "In order";
    completionMode = "Finish on last page";
    pagesRead = [];
    saving = false;

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
                this.pageRequirement = result.pageRequirement || "Every page";
                this.readingOrder = result.readingOrder || "In order";
                this.completionMode = result.completionMode || "Finish on last page";
                this.pagesRead = result.pagesRead || [];
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
    get isAnyOrder() { return this.readingOrder === "Any order"; }
    get showPagePicker() { return !this.previewOnly && this.isAnyOrder && this.pages.length > 1; }
    get currentPageValue() { return String(this.currentIndex); }
    get pageOptions() { return this.pages.map((page, index) => ({label: `${index + 1}. ${page.title || `Page ${index + 1}`}`, value: String(index)})); }
    get nextLabel() { return this.isLast ? (this.completed ? "Completed" : "Finish tutorial") : "Next page"; }
    get nextDisabled() { return this.saving || !this.hasPages || (this.isLast && this.completed) || this.previewOnly && this.isLast; }

    async handlePrevious(event) {
        event?.stopPropagation();
        if (this.isFirst || this.saving) return;
        if (!this.previewOnly) await this.savePage(this.currentIndex + 1, false, this.currentIndex);
        if (!this.error) this.currentIndex -= 1;
    }

    async handleNext(event) {
        event?.stopPropagation();
        if (!this.hasPages || this.saving) return;
        const wasLast = this.isLast;
        const destinationPage = wasLast ? this.currentIndex + 1 : this.currentIndex + 2;
        const result = this.previewOnly ? null : await this.savePage(this.currentIndex + 1, wasLast, destinationPage);
        if (this.error) return;
        if (!wasLast) this.currentIndex += 1;
        if (result?.completed) this.notifyCompleted();
    }

    async handlePageJump(event) {
        const destination = Number(event.detail.value);
        if (destination === this.currentIndex || this.saving) return;
        const result = await this.savePage(this.currentIndex + 1, false, destination + 1);
        if (this.error) return;
        this.currentIndex = destination;
        if (result?.completed) this.notifyCompleted();
    }

    async savePage(pageNumber, finishRequested, currentPageNumber) {
        this.saving = true;
        this.error = null;
        try {
            const result = await recordDocumentProgress({videoId: this.videoId, pageNumber, totalPages: this.pages.length, finishRequested, currentPageNumber});
            this.pagesRead = result?.pagesRead || this.pagesRead;
            this.completed = result?.completed === true;
            return result;
        } catch (error) {
            this.error = error?.body?.message || "Progress could not be saved.";
            return null;
        } finally {
            this.saving = false;
        }
    }

    notifyCompleted() {
        this.completed = true;
        this.dispatchEvent(new CustomEvent("progresschange", {detail: {completed: true, percent: 100}}));
    }
}
