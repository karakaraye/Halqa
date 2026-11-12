import { refreshEscalations } from '../src/server/workspace';
import { deliverPending } from '../src/server/delivery';
import { cleanup } from '../src/server/maintenance';
import { closeDatabases } from '../src/server/db';
const failed=(task:string,error:unknown)=>console.error(`${task} could not complete:`,error instanceof Error?error.name:'Unknown error');
let busy=false;
const tick=async()=>{
  if(busy)return;busy=true;
  try{refreshEscalations();}catch(error){failed('Escalation scan',error);}
  try{await deliverPending();}catch(error){failed('Message delivery',error);}
  try{cleanup();}catch(error){failed('Cleanup',error);}
  busy=false;
};
void tick();
const timer=setInterval(()=>void tick(),15000);
const stop=()=>{clearInterval(timer);closeDatabases();process.exit(0);};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
