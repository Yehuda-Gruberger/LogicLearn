import {LightningElement} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import LightningConfirm from "lightning/confirm";
import getCatalog from "@salesforce/apex/LogicLearnAdminController.getCatalog";
import getGroups from "@salesforce/apex/LogicLearnAdminController.getGroups";
import getGroup from "@salesforce/apex/LogicLearnAdminController.getGroup";
import saveGroup from "@salesforce/apex/LogicLearnAdminController.saveGroup";
import deleteGroup from "@salesforce/apex/LogicLearnAdminController.deleteGroup";

const EMPTY = {groupId:null,name:"",description:"",users:[],profiles:[],groups:[]};
export default class LogicLearnGroupManager extends LightningElement {
    groups=[]; catalog={users:[],profiles:[],groups:[]}; form={...EMPTY}; editing=false; loading=true; saving=false;
    connectedCallback(){this.load();}
    async load(){
        this.loading=true;
        try{const [groups,catalog]=await Promise.all([getGroups(),getCatalog()]);this.groups=groups;this.catalog=catalog;}
        catch(e){this.toast("Could not load groups",this.message(e),"error");}finally{this.loading=false;}
    }
    get hasGroups(){return this.groups.length>0;}
    get availableNestedGroups(){return this.catalog.groups.filter((item)=>item.value!==this.form.groupId);}
    handleNew(){this.form={...EMPTY,users:[],profiles:[],groups:[]};this.editing=true;}
    async handleEdit(event){
        try{const value=await getGroup({groupId:event.currentTarget.dataset.id});this.form={...EMPTY,...value};this.editing=true;}
        catch(e){this.toast("Could not open group",this.message(e),"error");}
    }
    async handleDelete(event){
        const groupId=event.currentTarget.dataset.id;const groupName=this.groups.find(item=>item.id===groupId)?.name||"this group";
        const confirmed=await LightningConfirm.open({label:"Delete group?",message:`Are you sure you want to delete “${groupName}”? It will be removed from tutorial audiences.`,theme:"warning"});
        if(!confirmed)return;
        try{await deleteGroup({groupId});this.toast("Deleted",`${groupName} was deleted.`,"success");await this.load();}
        catch(e){this.toast("Could not delete",this.message(e),"error");}
    }
    handleField(event){this.form={...this.form,[event.currentTarget.dataset.field]:event.target.value};}
    handlePicker(event){this.form={...this.form,[event.currentTarget.dataset.field]:event.detail.value};}
    close(){this.editing=false;}
    stop(event){event.stopPropagation();}
    async handleSave(){
        const name=this.template.querySelector("lightning-input");if(!name.reportValidity())return;this.saving=true;
        try{await saveGroup({input:this.form});this.editing=false;this.toast("Saved","LogicLearn group saved.","success");await this.load();}
        catch(e){this.toast("Could not save",this.message(e),"error");}finally{this.saving=false;}
    }
    toast(title,message,variant){this.dispatchEvent(new ShowToastEvent({title,message,variant}));}
    message(e){return e?.body?.message||e?.message||"Something went wrong.";}
}
