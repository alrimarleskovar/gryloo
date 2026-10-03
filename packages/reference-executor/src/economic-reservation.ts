// SPDX-License-Identifier: AGPL-3.0-only
import { supplyHash, type SupplyTransaction } from '@defi-workflow-engine/reference-compiler';
import { createFileLogStore, utf8, type DurableLogStore } from './durable-storage.js';
/** Shared by isolated Aave and composed entry points. A new nonce or workflow ID cannot erase an uncertain intent. */
export async function reserveEconomicIntent(directory: string, tx: SupplyTransaction, id: string, recoveryOf?: string): Promise<void> {
  return reserveEconomicIntentIn(createFileLogStore(directory), tx, id, recoveryOf);
}
/** The same reservation through any durable log store: creation is exclusive across every process sharing it. */
export async function reserveEconomicIntentIn(log: DurableLogStore, tx: SupplyTransaction, id: string, recoveryOf?: string): Promise<void> {
  const name='economic-'+supplyHash(tx).slice(2)+'.intent', entry={id,transaction:tx};
  const validate=(bytes:Uint8Array)=>{const rows=new TextDecoder().decode(bytes).trimEnd().split('\n').map(line=>JSON.parse(line));
    if(rows.some(r=>supplyHash(r.transaction)!==supplyHash(tx)||typeof r.id!=='string'))throw Error('ECONOMIC_RESERVATION_CORRUPT');};
  if (await log.create(name, new TextEncoder().encode(JSON.stringify(entry)+'\n'))) return;
  const prior=utf8(await log.read(name)); validate(new TextEncoder().encode(prior));
  const last=JSON.parse(prior.trimEnd().split('\n').at(-1)!);
  if(last.id===id)return;
  if(!recoveryOf||last.id!==recoveryOf)throw Error('ECONOMIC_EXISTING_INTENT_OBSERVE_ONLY');
  // Caller must independently prove a positively known pre-submission refusal.
  await log.extend(name,new TextEncoder().encode(prior+JSON.stringify(entry)+'\n'),validate);
}
