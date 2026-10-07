// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FloFiLogo } from './flofi-logo';

describe('shared FloFi identity', () => {
  it('exposes one accessible identity while both supplied variants remain decorative', () => {
    const html = renderToStaticMarkup(createElement(FloFiLogo));
    expect(html.match(/role="img" aria-label="FloFi"/g)).toHaveLength(1);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html.match(/alt=""/g)).toHaveLength(4);
    expect(html).not.toContain('/brand/flofi-logo.png');
    for (const theme of ['light', 'dark']) {
      expect(html).toContain(`class="flofi-logo-variant flofi-logo-${theme}"`);
      expect(html).toContain(`src="/brand/flofi-symbol-${theme}.svg"`);
      expect(html).toContain(`src="/brand/flofi-wordmark-${theme}.png"`);
    }
    expect(html.match(/width="370" height="345"/g)).toHaveLength(2);
    expect(html.match(/width="738" height="280"/g)).toHaveLength(2);
  });
});
