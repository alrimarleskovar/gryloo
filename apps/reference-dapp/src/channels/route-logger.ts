// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-CHANNELS-001: the structured log sink of the channel routes (one per process; Channel Core keeps its fields content-free). */
import type { ChannelLogSink } from './core/log.ts';

let logger: Promise<ChannelLogSink> | null = null;
export const channelRouteLogger = () => logger ??= import('@defi-workflow-engine/cloud-runtime').then(runtime => runtime.createLogger({ service: 'flofi-channels' }));
