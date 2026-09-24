// SPDX-License-Identifier: AGPL-3.0-only
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { AppShell } from '../components/app-shell';
import { WorkflowProvider } from '../state/workflow-store';

const initialContext = {
  registryId: referenceRegistry.registryId,
  capabilityId: referenceRegistry.capabilities[0]!.id,
  actionId: referenceRegistry.actions[0]!.id,
  assets: baseAssetRegistry,
};
export default function Page() { return <WorkflowProvider initialContext={initialContext}><AppShell/></WorkflowProvider>; }
