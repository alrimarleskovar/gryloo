// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: the one rasterizer of a workflow visual — the shared layout (`workflowVisualLayout`) drawn to a
 * PNG with Next's own `next/og` (Satori lays the tree out with the bundled Geist font, resvg or sharp encodes the PNG). No new
 * dependency, no rendering service, no generative model: the same model and language give the same PNG bytes.
 *
 * MCP (image content), Telegram (sendPhoto) and WhatsApp (media upload) all receive this PNG; none of them lays anything out. The
 * renderer reads only the presentation model: no wallet, session, handoff, runtime, flow or secret, and it never reaches the network
 * (every glyph is one the bundled font covers, so Satori never fetches a fallback font). A failure here is presentation only: callers
 * fall back to text, and nothing financial depends on it.
 */
import type { ReactElement } from 'react';
// `next/og` by its file name: Next's bundler, Vitest and plain Node ESM (the browser suite's processes) all resolve it.
import { ImageResponse } from 'next/og.js';
import { workflowVisualLayout, VISUAL_BASE_WIDTH, type VisualLanguage } from '../platform/workflow-visual-layout.ts';
import type { WorkflowVisualModel } from '../platform/workflow-visual.ts';

/** 1080 px wide: sharp in a chat bubble, under every provider's photo limits. */
export const VISUAL_PNG_WIDTH = 1080;
export const VISUAL_PNG_SCALE = VISUAL_PNG_WIDTH / VISUAL_BASE_WIDTH;
/** Above this the picture is refused (a 24-step compact list is ~5,200 px tall). Telegram allows width + height ≤ 10,000. */
const MAX_HEIGHT = 8_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export type WorkflowVisualImage = { readonly mimeType: 'image/png'; readonly bytes: Uint8Array; readonly width: number; readonly height: number;
  readonly alt: string; readonly language: VisualLanguage };

export const isPng = (bytes: Uint8Array) => bytes.length > 64 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);

/** The workflow visual as a PNG, or a closed error (`WORKFLOW_VISUAL_*`). */
export async function workflowVisualPng(model: WorkflowVisualModel, language: VisualLanguage): Promise<WorkflowVisualImage> {
  if (!model.steps.length) throw new Error('WORKFLOW_VISUAL_EMPTY');
  const layout = workflowVisualLayout(model, language, VISUAL_PNG_SCALE);
  if (layout.height > MAX_HEIGHT) throw new Error('WORKFLOW_VISUAL_TOO_LARGE');
  // Satori takes React-element-shaped objects; the layout tree is exactly that shape (`div` + style + children), with no React runtime.
  const response = new ImageResponse(layout.tree as unknown as ReactElement, { width: layout.width, height: layout.height });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isPng(bytes)) throw new Error('WORKFLOW_VISUAL_RENDER_FAILED');
  return { mimeType: 'image/png', bytes, width: layout.width, height: layout.height, alt: layout.alt, language };
}

/** The same, for presentation surfaces that must never fail because of a picture: null instead of an error. */
export async function workflowVisualPngOrNull(model: WorkflowVisualModel, language: VisualLanguage): Promise<WorkflowVisualImage | null> {
  try { return await workflowVisualPng(model, language); } catch { return null; }
}
