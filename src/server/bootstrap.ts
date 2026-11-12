import { randomBytes } from 'node:crypto';
import { transaction } from './db';
import { hashPassword } from './auth';
import { seedWorkspace } from './workspace';
import { PEOPLE, SPECIALIST_SERVICES } from '@/lib/pathways';
import { insertService } from './directory';
import { Person, Case } from '@/types/halqa';

export function bootstrap(passwordOverride?:string) {
  if(passwordOverride && passwordOverride.length<12) throw new Error('Bootstrap passwords must have at least 12 characters.');
  const credentials:{email:string;password:string;name:string;role:string}[]=[];
  transaction(db=>{
    if(db.prepare('SELECT id FROM users LIMIT 1').get()) throw new Error('Accounts already exist. Bootstrap will not reset credentials.');
    const network='halqa-network'; seedWorkspace(db,network);
    function account(person:Person,patientCase?:string) {
      const email=`${person.id}@halqa.test`; const password=passwordOverride??randomBytes(18).toString('base64url');
      db.prepare('INSERT INTO users(id,email,password_hash,person,network,patient_case) VALUES (?,?,?,?,?,?)').run(person.id,email,hashPassword(password),JSON.stringify(person),network,patientCase??null);
      credentials.push({email,password,name:person.name,role:person.role});
    }
    Object.values(PEOPLE).forEach(p=>account(p));
    for(const row of db.prepare('SELECT data FROM cases').all() as {data:string}[]) {
      const c=JSON.parse(row.data) as Case;
      if(!c.historical) account({id:`patient_${c.id.toLowerCase()}`,name:c.patient.name,role:'PATIENT',org:'Patient portal'},c.id);
    }
    // Receiving services of the development workspace, from the same constants as its staff.
    for(const s of SPECIALIST_SERVICES) insertService(db,{facility:s.facility,specialty:s.specialty,pathway:s.pathway,specialistUserId:s.specialist},network);
  });
  return credentials;
}
