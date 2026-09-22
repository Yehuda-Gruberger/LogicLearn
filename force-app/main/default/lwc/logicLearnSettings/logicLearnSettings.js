import {LightningElement} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import getSettings from "@salesforce/apex/LogicLearnAdminController.getSettings";
import saveSettings from "@salesforce/apex/LogicLearnAdminController.saveSettings";

export default class LogicLearnSettings extends LightningElement {
    settings;
    loading = true;
    saving = false;
    connectedCallback() { this.load(); }
    async load() {
        try { this.settings = await getSettings(); }
        catch (e) { this.toast("Could not load settings", this.message(e), "error"); }
        finally { this.loading = false; }
    }
    handleChange(event) {
        const field = event.currentTarget.dataset.field;
        const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
        this.settings = {...this.settings, [field]: value};
    }
    async handleSave() {
        const fields = [...this.template.querySelectorAll("lightning-input")];
        if (!fields.reduce((ok, field) => field.reportValidity() && ok, true)) return;
        this.saving = true;
        try { await saveSettings({input: this.settings}); this.toast("Saved", "LogicLearn settings updated.", "success"); }
        catch (e) { this.toast("Could not save", this.message(e), "error"); }
        finally { this.saving = false; }
    }
    toast(title,message,variant){this.dispatchEvent(new ShowToastEvent({title,message,variant}));}
    message(e){return e?.body?.message||e?.message||"Something went wrong.";}
}
