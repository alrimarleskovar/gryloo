// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { randomUUID } from 'node:crypto';
import { connection } from 'next/server';
import { ProductWorkspace } from '../../components/product-workspace';
import '@xyflow/react/dist/style.css';
import '../globals.css';

/** One persistent workspace for /app, its deep links, /approve and /connections. */
export default async function ProductLayout({ children }: { children: ReactNode }) {
  await connection();
  const initialWorkflowId = `workflow-${randomUUID()}`;
  return <><ProductWorkspace initialWorkflowId={initialWorkflowId}/>{children}</>;
}
