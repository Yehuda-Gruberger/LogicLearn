import {LightningElement, api, track} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import getPlayback from "@salesforce/apex/TrainingVideoController.getPlayback";
import getAdminPreview from "@salesforce/apex/TrainingVideoController.getAdminPreview";
import recordProgress from "@salesforce/apex/TrainingVideoController.recordProgress";
import markExternalComplete from "@salesforce/apex/TrainingVideoController.markExternalComplete";

// How often (seconds of playback) to persist progress, so we don't DML on every timeupdate tick.
const REPORT_INTERVAL_SECONDS = 5;
const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

export default class TrainingVideoPlayer extends LightningElement {
    // recordId is set automatically on a Training Video record page; videoId can be passed
    // explicitly when the player is placed on an app page.
    @api recordId;
    @api videoId;
    // When true, start playing once the video is ready (used for click-to-open in the library;
    // deep links from the email pass this as false so the video waits for the user).
    @api autoplay = false;
    @api previewOnly = false;
    @api compact = false;

    @track isLoading = true;
    @track error;
    @track title;
    videoUrl;
    resumePercent = 0;
    completed = false;
    isMandatory = false;
    isExternal = false;
    externalUrl;
    preventSkipping = false;

    @track currentSpeed = 1;

    _loaded = false;
    _lastReportedAt = 0;
    _resumeApplied = false;
    // Furthest point (seconds) actually watched — the ceiling for seeking on a no-skip video.
    _maxWatchedTime = 0;
    // Previous playhead position, used to tell continuous playback from a seek jump.
    _lastPlayTime = 0;

    get effectiveVideoId() {
        return this.videoId || this.recordId;
    }

    get speedOptions() {
        return SPEEDS.map((s) => ({
            value: String(s),
            label: s === 1 ? "1× (Normal)" : `${s}×`,
            variant: s === this.currentSpeed ? "brand" : "neutral"
        }));
    }

    renderedCallback() {
        if (!this._loaded && this.effectiveVideoId) {
            this._loaded = true;
            this.loadPlayback();
        }
    }

    async loadPlayback() {
        this.isLoading = true;
        this.error = null;
        try {
            const info = this.previewOnly
                ? await getAdminPreview({videoId: this.effectiveVideoId})
                : await getPlayback({videoId: this.effectiveVideoId});
            this.title = info.title;
            this.videoUrl = info.videoUrl;
            this.resumePercent = info.resumePercent || 0;
            this.completed = info.viewStatus === "Completed";
            this.isMandatory = info.isMandatory === true;
            this.isExternal = info.isExternal === true;
            this.externalUrl = info.externalUrl;
            this.preventSkipping = info.preventSkipping === true;
            if (!this.isExternal && !this.videoUrl) {
                this.error = "No video file has been uploaded for this record yet.";
            } else if (this.isExternal && !this.externalUrl) {
                this.error = "No external video link has been configured for this tutorial.";
            }
        } catch (err) {
            this.error = this.extractError(err);
        } finally {
            this.isLoading = false;
        }
    }

    get videoElement() {
        return this.template.querySelector("video");
    }

    // On a mandatory, not-yet-completed video the user can't skip past what they've watched.
    get noSkip() {
        return this.preventSkipping && !this.completed;
    }

    // Resume from where the user left off (unless already completed) once we know the duration.
    handleLoadedMetadata() {
        const video = this.videoElement;
        if (!video || this._resumeApplied) {
            return;
        }
        this._resumeApplied = true;
        if (this.completed) {
            // Already completed → no seek restriction; the whole timeline is available.
            this._maxWatchedTime = video.duration || 0;
        } else if (this.resumePercent > 0 && this.resumePercent < 100 && video.duration) {
            // They watched up to here before, so this is their seek ceiling on resume.
            const resumeTime = (this.resumePercent / 100) * video.duration;
            this._maxWatchedTime = resumeTime;
            video.currentTime = resumeTime;
        }
        this._lastPlayTime = this._maxWatchedTime;

        // Click-to-open autoplays; a blocked autoplay (browser policy) just leaves it paused.
        if (this.autoplay) {
            const playPromise = video.play();
            if (playPromise && typeof playPromise.catch === "function") {
                playPromise.catch(() => {});
            }
        }
    }

    // Fired when the user (or code) moves the playhead. Block forward jumps past the watched
    // ceiling on no-skip videos; backward seeks (re-watching) are always allowed.
    handleSeeking() {
        const video = this.videoElement;
        if (!video || !this.noSkip) {
            return;
        }
        const TOLERANCE = 1.0; // seconds — don't fight normal playback drift
        if (video.currentTime > this._maxWatchedTime + TOLERANCE) {
            // Silently snap back — the skip simply doesn't take.
            video.currentTime = this._maxWatchedTime;
        }
    }

    handleTimeUpdate() {
        const video = this.videoElement;
        if (!video || !video.duration) {
            return;
        }
        const t = video.currentTime;
        const delta = t - this._lastPlayTime;
        this._lastPlayTime = t;
        // Grow the watched ceiling ONLY on continuous playback (a small forward step). A forward
        // seek produces a large jump, so its timeupdate can't raise the ceiling ahead of the
        // seeking handler that blocks it.
        if (delta >= 0 && delta < 1.5 && t > this._maxWatchedTime) {
            this._maxWatchedTime = t;
        }
        // Persist from the watched ceiling, NOT the raw playhead — so a blocked forward seek
        // (whose playhead briefly sits ahead) can't inflate saved progress or resume position,
        // nor trigger completion. The ceiling only moves on real playback.
        if (this._maxWatchedTime - this._lastReportedAt < REPORT_INTERVAL_SECONDS) {
            return;
        }
        this._lastReportedAt = this._maxWatchedTime;
        const percent = Math.min(100, Math.round((this._maxWatchedTime / video.duration) * 100));
        this.persist(percent, false);
    }

    handleEnded() {
        this.persist(100, true);
        this.completed = true;
    }

    handlePause() {
        const video = this.videoElement;
        if (video && video.duration) {
            // Save the watched ceiling, not the current playhead (which may be a paused seek).
            const percent = Math.min(100, Math.round((this._maxWatchedTime / video.duration) * 100));
            this.persist(percent, false);
        }
        this.dispatchEvent(new CustomEvent("pause"));
    }

    get showControlbar() {
        return !this.compact;
    }

    handlePlay() {
        this.dispatchEvent(new CustomEvent("play"));
    }

    async persist(percent, ended) {
        if (this.previewOnly) return;
        try {
            await recordProgress({videoId: this.effectiveVideoId, percent, ended});
            if (ended) {
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: "Training complete",
                        message: `You've completed "${this.title}".`,
                        variant: "success"
                    })
                );
            }
        } catch (err) {
            // Progress persistence is best-effort — don't interrupt playback with an error toast.
            // eslint-disable-next-line no-console
            console.error("Failed to record training progress", err);
        }
    }

    handleSpeedChange(event) {
        const speed = parseFloat(event.currentTarget.dataset.speed);
        this.currentSpeed = speed;
        const video = this.videoElement;
        if (video) {
            video.playbackRate = speed;
        }
    }

    handleOpenExternal() {
        window.open(this.externalUrl, "_blank", "noopener,noreferrer");
    }

    async handleManualComplete() {
        if (this.previewOnly) return;
        try {
            await markExternalComplete({videoId: this.effectiveVideoId});
            this.completed = true;
            this.dispatchEvent(new ShowToastEvent({
                title: "Tutorial complete",
                message: `You've marked "${this.title}" complete.`,
                variant: "success"
            }));
        } catch (error) {
            this.dispatchEvent(new ShowToastEvent({title: "Could not complete", message: this.extractError(error), variant: "error"}));
        }
    }

    extractError(error) {
        if (error && error.body && error.body.message) {
            return error.body.message;
        }
        if (error && error.message) {
            return error.message;
        }
        return "Unable to load this video.";
    }

    @api
    reload() {
        this._loaded = true;
        this._resumeApplied = false;
        this._lastReportedAt = 0;
        this._maxWatchedTime = 0;
        this.videoUrl = undefined;
        this.loadPlayback();
    }

    @api
    play() {
        const video = this.videoElement;
        if (!video) return;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => {});
        }
    }
}
