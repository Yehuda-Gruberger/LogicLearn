import {LightningElement} from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import getAdminVideos from "@salesforce/apex/TrainingVideoController.getAdminVideos";
import getTracking from "@salesforce/apex/LogicLearnAdminController.getTracking";
import sendNotification from "@salesforce/apex/LogicLearnAdminController.sendNotification";
import sendInAppNotification from "@salesforce/apex/LogicLearnAdminController.sendInAppNotification";

const COLUMNS=[
    {label:"Learner",fieldName:"userName"},{label:"Status",fieldName:"status"},
    {label:"Watched %",fieldName:"watchPercent",type:"number"},{label:"Opens",fieldName:"viewCount",type:"number"},
    {label:"First opened",fieldName:"firstViewedAt",type:"date"},{label:"Last opened",fieldName:"lastViewedAt",type:"date"},
    {label:"Due",fieldName:"dueDate",type:"date"},{label:"Overdue",fieldName:"overdue",type:"boolean"},
    {label:"Completed",fieldName:"completedAt",type:"date"},{label:"Method",fieldName:"completionMethod"}
];
export default class LogicLearnTracking extends LightningElement{
    columns=COLUMNS;videos=[];videoId;rows=[];loading=true;reminderChannel="In-app";sending=false;
    connectedCallback(){this.loadVideos();}
    async loadVideos(){try{const rows=await getAdminVideos();this.videos=rows.map(v=>({value:v.id,label:v.title,meta:`${v.status} • ${v.folderName||"Ungrouped"}`}));}catch(e){this.toast("Could not load tutorials",this.message(e),"error");}finally{this.loading=false;}}
    get hasRows(){return this.rows.length>0;}
    get channelOptions(){return ["In-app","Email","Both"].map(value=>({label:value,value}));}
    async handleVideo(event){this.videoId=event.detail.value;this.loading=true;try{this.rows=await getTracking({videoId:this.videoId});}catch(e){this.toast("Could not load tracking",this.message(e),"error");}finally{this.loading=false;}}
    handleChannel(event){this.reminderChannel=event.detail.value;}
    async sendReminder(){if(!this.videoId)return;this.sending=true;try{const jobs=[];if(["Email","Both"].includes(this.reminderChannel))jobs.push(sendNotification({videoId:this.videoId,notificationType:"Reminder"}));if(["In-app","Both"].includes(this.reminderChannel))jobs.push(sendInAppNotification({videoId:this.videoId,notificationType:"Reminder"}));const counts=await Promise.all(jobs);const count=counts.reduce((sum,value)=>sum+value,0);this.toast("Reminders sent",`${count} notification${count===1?"":"s"} sent to incomplete learners.`,"success");}catch(e){this.toast("Could not send reminders",this.message(e),"error");}finally{this.sending=false;}}
    exportCsv(){if(!this.rows.length)return;const cols=["Learner","Status","Watch Percent","Opens","First Viewed","Last Viewed","Due Date","Overdue","Completed","Method"];const clean=value=>`"${String(value??"").replaceAll('"','""')}"`;const lines=[cols.map(clean).join(","),...this.rows.map(r=>[r.userName,r.status,r.watchPercent,r.viewCount,r.firstViewedAt,r.lastViewedAt,r.dueDate,r.overdue,r.completedAt,r.completionMethod].map(clean).join(","))];const link=document.createElement("a");link.href=`data:text/csv;charset=utf-8,${encodeURIComponent(lines.join("\n"))}`;link.download="logiclearn-tracking.csv";link.click();}
    toast(title,message,variant){this.dispatchEvent(new ShowToastEvent({title,message,variant}));}message(e){return e?.body?.message||e?.message||"Something went wrong.";}
}
