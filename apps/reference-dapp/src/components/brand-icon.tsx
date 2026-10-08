// SPDX-License-Identifier: AGPL-3.0-only

import { useLocale } from '../i18n/locale';
/** Local brand images keep their own fills, gradients and colors, independent of theme. */
const tokenImages: Readonly<Record<string, string>> = {
  USDC: '/brand/crypto/usdc.png', devUSDC: '/brand/crypto/usdc.png',
  ETH: '/brand/crypto/ethereum.svg', WETH: '/brand/crypto/ethereum.svg',
  SOL: '/brand/crypto/solana.svg', WSOL: '/brand/crypto/solana.svg',
  USDT: '/brand/crypto/usdt.svg',
};
const networkImages: Readonly<Record<string, string>> = {
  Base: '/brand/crypto/base.svg', 'Base Sepolia': '/brand/crypto/base.svg',
  Arbitrum: '/brand/crypto/arbitrum.png', 'Arbitrum One': '/brand/crypto/arbitrum.png', 'Arbitrum Sepolia': '/brand/crypto/arbitrum.png',
  Solana: '/brand/crypto/solana.svg', 'Solana Mainnet': '/brand/crypto/solana.svg', 'Solana Devnet': '/brand/crypto/solana.svg',
  Ethereum: '/brand/crypto/ethereum.svg', Optimism: '/brand/crypto/optimism.png',
  'Robinhood Chain': '/brand/robinhood-avatar.jpg',
};
function BrandImage({ src, fallback }: { src: string | undefined; fallback: string }) {
  const { t: tr } = useLocale();
  return src ? <img className="brand-icon" src={src} alt={tr("")} aria-hidden="true" draggable={false}/>
    : <span className="brand-icon-fallback" aria-hidden="true">{tr(fallback)}</span>;
}
export function TokenBrandIcon({ symbol }: { symbol: string }) {
  return <BrandImage src={tokenImages[symbol]} fallback={symbol === '—' ? '?' : symbol.slice(0, 1)}/>;
}
export function NetworkBrandIcon({ network }: { network: string }) {
  return <BrandImage src={networkImages[network]} fallback={network.slice(0, 1)}/>;
}
