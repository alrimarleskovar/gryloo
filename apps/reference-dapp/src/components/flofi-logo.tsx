// SPDX-License-Identifier: AGPL-3.0-only
import Image from 'next/image';

/** The shell theme selects the supplied artwork without recoloring it. */
export function FloFiLogo() {
  return <span className="flofi-logo" role="img" aria-label="FloFi">
    {(['light', 'dark'] as const).map(theme => <span key={theme} className={`flofi-logo-variant flofi-logo-${theme}`} aria-hidden="true">
      <Image className="flofi-logo-symbol" src={`/brand/flofi-symbol-${theme}.svg`} alt="" width={370} height={345} unoptimized/>
      <Image className="flofi-logo-wordmark" src={`/brand/flofi-wordmark-${theme}.png`} alt="" width={738} height={280} unoptimized/>
    </span>)}
  </span>;
}
