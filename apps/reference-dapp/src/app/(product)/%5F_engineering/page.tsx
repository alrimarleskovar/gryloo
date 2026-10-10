// SPDX-License-Identifier: AGPL-3.0-only
import { notFound } from 'next/navigation';
import { engineeringUiAllowed } from '../../../server/engineering-ui';
/** Explicit local engineering harness. Never linked in product navigation. */
export default async function EngineeringPage() { if (!await engineeringUiAllowed()) notFound(); return null; }
