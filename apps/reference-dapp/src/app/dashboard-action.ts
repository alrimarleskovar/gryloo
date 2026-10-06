// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { loadDashboardRunDetail, loadDashboardSnapshot } from '../lib/dashboard/data-service';

export async function dashboardSnapshot(account: string) { return loadDashboardSnapshot(account); }
export async function dashboardRunDetail(account: string, runId: string) { return loadDashboardRunDetail(account, runId); }
