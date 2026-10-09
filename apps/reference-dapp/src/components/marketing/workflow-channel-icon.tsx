// SPDX-License-Identifier: AGPL-3.0-only
import Image from 'next/image';
import styles from './landing.module.css';

export const workflowChannels = ['Chat', 'Canvas', 'GPT', 'Claude', 'WhatsApp', 'Telegram'] as const;
type Channel = typeof workflowChannels[number];
const marks = {
  GPT: '/brand/providers/openai-blossom-black.svg',
  Claude: '/brand/providers/claude-spark.svg',
  WhatsApp: '/brand/channels/whatsapp.svg',
  Telegram: '/brand/channels/telegram.svg',
} as const;

/** Decorative beside the channel label; intact local brand artwork, never a connection badge. */
export function WorkflowChannelIcon({ channel }: { channel: Channel }) {
  return <span className={styles.workflowChannelIcon} data-channel-icon={channel} aria-hidden="true">
    {channel === 'Chat' || channel === 'Canvas' ? <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {channel === 'Chat' ? <><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z"/><path d="M7 10h8M7 14h5"/></> : <><rect x="3" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="16" width="7" height="5" rx="1.5"/><path d="M6.5 8v7a3.5 3.5 0 0 0 3.5 3.5h4M14 5.5h7m-3-3 3 3-3 3"/></>}
    </svg> : <Image src={marks[channel]} alt="" width={channel === 'GPT' ? 40 : 20} height={channel === 'GPT' ? 40 : 20} unoptimized draggable={false}/>}
  </span>;
}
