// SPDX-License-Identifier: AGPL-3.0-only
import { open, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { supplyHash, type SupplyTransaction } from '@defi-workflow-engine/reference-compiler';
import { writeExtendingFile } from './file-store.js';
/** Shared by isolated Aave and composed entry points. A new nonce or workflow ID cannot erase an uncertain intent. */
export async function reserveEconomicIntent(directory: string, tx: SupplyTransaction, id: string, recoveryOf?: string): Promise<void> {
  await mkdir(directory, {recursive:true,mode:0o700});
  const path=join(directory,'economic-'+supplyHash(tx).slice(2)+'.intent'), entry={id,transaction:tx};
  const validate=(bytes:Uint8Array)=>{const rows=new TextDecoder().decode(bytes).trimEnd().split('\n').map(line=>JSON.parse(line));
    if(rows.some(r=>supplyHash(r.transaction)!==supplyHash(tx)||typeof r.id!=='string'))throw Error('ECONOMIC_RESERVATION_CORRUPT');};
  try { const handle=await open(path,'wx',0o600);try{await handle.writeFile(JSON.stringify(entry)+'\n');await handle.sync();}finally{await handle.close();} }
  catch(cause) {
    if((cause as NodeJS.ErrnoException).code!=='EEXIST')throw cause;
    const prior=await readFile(path,'utf8'); validate(new TextEncoder().encode(prior));
    const last=JSON.parse(prior.trimEnd().split('\n').at(-1)!);
    if(last.id===id)return;
    if(!recoveryOf||last.id!==recoveryOf)throw Error('ECONOMIC_EXISTING_INTENT_OBSERVE_ONLY',{cause});
    // Caller must independently prove a positively known pre-submission refusal.
    await writeExtendingFile(path,new TextEncoder().encode(prior+JSON.stringify(entry)+'\n'),validate);
  }
  const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}
}
