// SPDX-License-Identifier: AGPL-3.0-only
import Image from 'next/image';
import styles from './mascot-motion.module.css';

/** Byte-identical official blue/white artwork; all animation lives on wrappers. */
export function FloFiMascot({ white = false }: { white?: boolean }) {
  return <div className={styles.character} data-mascot-character data-variant={white ? 'white' : 'blue'} data-state="idle" aria-hidden="true">
    <span className={styles.shadow} data-mascot-shadow/>
    <span className={styles.body} data-mascot-body>
      <Image className={styles.blue} src="/brand/flofi-symbol-light.svg" alt="" width={370} height={345} draggable={false} unoptimized/>
      <Image className={styles.white} src="/brand/flofi-symbol-dark.svg" alt="" width={370} height={345} draggable={false} unoptimized/>
    </span>
  </div>;
}
