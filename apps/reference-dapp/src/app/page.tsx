// SPDX-License-Identifier: AGPL-3.0-only
import { AppShell } from '../components/app-shell';
import { WorkflowProvider } from '../state/workflow-store';

export default function Page() { return <WorkflowProvider><AppShell/></WorkflowProvider>; }
