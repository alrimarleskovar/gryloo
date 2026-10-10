// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: the channels' binding to FloFi's one workflow renderer (`src/server/workflow-visual-image.ts`,
 * shared with MCP). Channel Core asks for a reply's picture through this function; adapters only receive the PNG. Model-free and
 * authority-free: it draws the presentation model and nothing else, and a failure is a null picture (the message goes out as text).
 */
import { workflowVisualPngOrNull } from '../server/workflow-visual-image.ts';
import type { ChannelVisualRenderer } from './core/types.ts';

export const channelVisualRenderer: ChannelVisualRenderer = async visual => {
  const image = await workflowVisualPngOrNull(visual.model, visual.language);
  return image && { mimeType: image.mimeType, bytes: image.bytes, alt: image.alt };
};
