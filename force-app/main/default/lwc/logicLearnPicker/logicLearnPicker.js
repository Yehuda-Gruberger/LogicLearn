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
    _options = [];
    _value = [];
    query = "";
    open = false;

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

    get filteredOptions() {
        const q = this.query.trim().toLowerCase();
        return this._options
            .filter((item) => !q || item.label.toLowerCase().includes(q) || (item.meta || "").toLowerCase().includes(q))
            .slice(0, 100)
            .map((item) => ({
                ...item,
                rowClass: this._value.includes(item.value) ? "option selected" : "option",
                icon: this._value.includes(item.value) ? "utility:check" : "utility:add"
            }));
    }

    get selectedItems() {
        const selected = new Set(this._value);
        return this._options.filter((item) => selected.has(item.value));
    }

    get hasSelected() {
        return this.selectedItems.length > 0;
    }

    get hasOptions() {
        return this.filteredOptions.length > 0;
    }

    get inputClass() {
        return this.open ? "picker-input open" : "picker-input";
    }

    handleFocus() {
        if (!this.disabled) this.open = true;
    }

    handleSearch(event) {
        this.query = event.target.value;
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
            this.query = "";
        }
        this.emitChange();
    }

    handleRemove(event) {
        event.stopPropagation();
        const selected = event.currentTarget.dataset.value;
        this._value = this._value.filter((value) => value !== selected);
        this.emitChange();
    }

    handleOpen() {
        if (this.disabled) return;
        this.open = true;
        const input = this.template.querySelector("input");
        if (input && this.template.activeElement !== input) input.focus();
    }

    handleFocusOut(event) {
        const next = event.relatedTarget;
        if (!next || !this.template.contains(next)) this.open = false;
    }

    handleCreate(event) {
        event.stopPropagation();
        this.open = false;
        this.dispatchEvent(new CustomEvent("create"));
    }

    emitChange() {
        this.dispatchEvent(new CustomEvent("change", {detail: {value: this.value}}));
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
