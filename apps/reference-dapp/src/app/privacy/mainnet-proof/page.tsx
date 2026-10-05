// SPDX-License-Identifier: AGPL-3.0-only
import CloakOwnerDepositPanel from '../../../components/cloak-owner-deposit-panel';
import { ownerProofConfiguration } from '../../../privacy/owner-proof-configuration';
export const dynamic = 'force-dynamic';
export default async function Page() { return <CloakOwnerDepositPanel configuration={await ownerProofConfiguration()}/>; }
