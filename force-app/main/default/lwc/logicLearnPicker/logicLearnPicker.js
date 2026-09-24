import {LightningElement, api} from "lwc";

export default class LogicLearnPicker extends LightningElement {
    @api label = "Select";
    @api placeholder = "Search...";
    @api multiple = false;
    @api required = false;
    @api disabled = false;
    @api createLabel;
    @api hideLabel = false;
    @api showMetaInChip = false;
    @api actionMode = false;
    @api editable = false;
    @api deletable = false;
    _options = [];
    _value = [];
    _exclusions = [];
    _excludableValues = [];
    query = "";
    open = false;
    openUp = false;

    @api
    get options() {
        return this._options;
    }
    set options(value) {
        this._options = Array.isArray(value) ? value : [];
    }

    @api
    get value() {
        return this.multiple ? this._value : this._value[0] || null;
    }
    set value(value) {
        this._value = Array.isArray(value) ? [...value] : value ? [value] : [];
    }

    @api
    get exclusions() { return this._exclusions; }
    set exclusions(value) { this._exclusions = Array.isArray(value) ? [...value] : []; }

    @api
    get excludableValues() { return this._excludableValues; }
    set excludableValues(value) { this._excludableValues = Array.isArray(value) ? [...value] : []; }

    get filteredOptions() {
        const q = this.query.trim().toLowerCase();
        return this._options
            .filter((item) => !q || item.label.toLowerCase().includes(q) || (item.meta || "").toLowerCase().includes(q))
            .slice(0, 100)
            .map((item) => {
                const selected = this._value.includes(item.value);
                const excluded = this._exclusions.includes(item.value);
                const canEdit = this.editable && item.editable !== false;
                const canDelete = this.deletable && item.deletable !== false;
                return {
                    ...item,
                    rowClass: selected || excluded ? "option selected" : "option",
                    selected,
                    excluded,
                    canExclude: this.actionMode && this._excludableValues.includes(item.value),
                    canEdit,
                    canDelete,
                    hasActions: canEdit || canDelete,
                    excludeIcon: excluded ? "utility:check" : "utility:dash",
                    excludeClass: excluded ? "option-action exclude active" : "option-action exclude"
                };
            });
    }

    get selectedItems() {
        const selected = new Set(this._value);
        return this._options.filter((item) => selected.has(item.value)).map((item) => ({
            ...item,
            canEdit: this.editable && item.editable !== false
        }));
    }

    get hasSelected() {
        return this.selectedItems.length > 0;
    }

    get excludedItems() {
        const excluded = new Set(this._exclusions);
        return this._options.filter((item) => excluded.has(item.value));
    }

    get hasExcluded() { return this.excludedItems.length > 0; }

    get hasOptions() {
        return this.filteredOptions.length > 0;
    }

    get showCreateOption() {
        if (!this.createLabel) return false;
        const query = this.query.trim().toLowerCase();
        return !!query && !this._options.some((item) => item.label.toLowerCase() === query);
    }

    get createActionLabel() {
        const query = this.query.trim();
        return query ? `${this.createLabel}: “${query}”` : this.createLabel;
    }

    get inputClass() {
        return this.open ? "picker-input open" : "picker-input";
    }

    get pickerClass() {
        return this.openUp ? "picker drop-up" : "picker";
    }

    handleFocus() {
        if (!this.disabled) {
            this.chooseDirection();
            this.open = true;
        }
    }

    handleSearch(event) {
        this.query = event.target.value;
        this.chooseDirection();
        this.open = true;
    }

    handleSelect(event) {
        const selected = event.currentTarget.dataset.value;
        if (this.multiple) {
            this._value = this._value.includes(selected)
                ? this._value.filter((value) => value !== selected)
                : [...this._value, selected];
        } else {
            this._value = [selected];
            this.open = false;
        }
        this.query = "";
        this.emitChange();
    }

    handleOptionMouseDown(event) {
        // Keep focus in the search input until the click commits the row. Without
        // this, a non-focusable action row triggers focusout, closes the menu,
        // and is removed from the DOM before its click handler can run.
        event.preventDefault();
    }

    handleExclude(event) {
        event.stopPropagation();
        const selected = event.currentTarget.dataset.value;
        this._exclusions = this._exclusions.includes(selected)
            ? this._exclusions.filter((value) => value !== selected)
            : [...this._exclusions, selected];
        this.query = "";
        this.emitChange();
    }

    handleEdit(event) {
        event.preventDefault();
        event.stopPropagation();
        this.open = false;
        this.dispatchEvent(new CustomEvent("edit", {detail: {value: event.currentTarget.dataset.value}}));
    }

    handleDelete(event) {
        event.preventDefault();
        event.stopPropagation();
        this.open = false;
        this.dispatchEvent(new CustomEvent("delete", {detail: {value: event.currentTarget.dataset.value}}));
    }

    handleRemove(event) {
        event.stopPropagation();
        const selected = event.currentTarget.dataset.value;
        if (event.currentTarget.dataset.kind === "exclusion") {
            this._exclusions = this._exclusions.filter((value) => value !== selected);
        } else {
            this._value = this._value.filter((value) => value !== selected);
        }
        this.emitChange();
    }

    handleOpen() {
        if (this.disabled) return;
        this.chooseDirection();
        this.open = true;
        const input = this.template.querySelector("input");
        if (input && this.template.activeElement !== input) input.focus();
    }

    chooseDirection() {
        const picker = this.template.querySelector(".picker");
        if (!picker) return;
        const rect = picker.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        this.openUp = spaceBelow < 230 && rect.top > spaceBelow;
    }

    handleFocusOut(event) {
        const next = event.relatedTarget;
        if (!next || !this.template.contains(next)) this.open = false;
    }

    handleCreate(event) {
        event.stopPropagation();
        this.open = false;
        this.dispatchEvent(new CustomEvent("create", {detail: {query: this.query.trim()}}));
        this.query = "";
    }

    emitChange() {
        this.dispatchEvent(new CustomEvent("change", {detail: {value: this.value, exclusions: [...this._exclusions]}}));
    }

    @api
    reportValidity() {
        const valid = !this.required || this._value.length > 0;
        const input = this.template.querySelector("input");
        if (input) {
            input.setCustomValidity(valid ? "" : `Select ${this.label.toLowerCase()}.`);
            input.reportValidity();
        }
        return valid;
    }
}
