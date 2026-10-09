// SPDX-License-Identifier: AGPL-3.0-only
import Link from 'next/link';
import type { ReactNode } from 'react';
import { articles, type Block, type Article } from './content';
import { CopyCode, TableOfContents } from './docs-shell';
import styles from './docs.module.css';

function Inline({ text }: { text: string }) {
  return text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`)/g).map((part, i) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <Link key={i} href={link[2]!}>{link[1]}</Link>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

/** Highlight our finite TS/JSON/shell examples on the server; no executable HTML or client highlighter. */
function Highlight({ code, language }: { code: string; language: string }) {
  const matcher = language === 'bash' ? /(#[^\n]*|"[^"\n]*"|'[^'\n]*'|\$[A-Z_]+|\b(?:git|cd|pnpm|curl)\b)/g : /(\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:import|from|const|await|if|throw|new|return|true|false|null)\b|\b\d+\b)/g;
  return code.split(matcher).map((token, i) => {
    let kind: string | undefined = '';
    if (/^(\/\/|#)/.test(token)) kind = styles.comment;
    else if (/^["']/.test(token)) kind = styles.string;
    else if (/^\d+$/.test(token)) kind = styles.number;
    else if (/^\$/.test(token)) kind = styles.variable;
    else if (/^(import|from|const|await|if|throw|new|return|true|false|null|git|cd|pnpm|curl)$/.test(token)) kind = styles.keyword;
    return kind ? <span key={i} className={kind}>{token}</span> : token;
  });
}

function ContentBlock({ block }: { block: Block }) {
  if (block.type === 'text') return <p><Inline text={block.text}/></p>;
  if (block.type === 'callout') return <aside className={styles.callout} data-tone={block.tone}><span aria-hidden="true">{block.tone === 'warning' ? '!' : 'i'}</span><div><strong>{block.title}</strong><p><Inline text={block.text}/></p></div></aside>;
  if (block.type === 'code') return <div className={styles.codeBlock}><div className={styles.codeHeader}><span>{block.title}</span><CopyCode code={block.code}/></div><pre tabIndex={0} aria-label={`${block.title}, ${block.language} example`}><code><Highlight code={block.code} language={block.language}/></code></pre><span className={styles.codeLanguage}>{block.language}</span></div>;
  if (block.type === 'steps') return <ol className={styles.steps}>{block.items.map((item, i) => <li key={item}><span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><div><Inline text={item}/></div></li>)}</ol>;
  return <div className={styles.tableWrapper} tabIndex={0} role="region" aria-label={`${block.headers[0]} reference table`}><table><thead><tr>{block.headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{block.rows.map(row => <tr key={row.join("|")}>{row.map((cell, i) => <td key={i}><Inline text={cell}/></td>)}</tr>)}</tbody></table></div>;
}

export function ArticleFrame({ title, group, description, sections, children }: { title: string; group: string; description: string; sections: { id: string; title: string }[]; children: ReactNode }) {
  return <div className={styles.articleLayout}><main id="docs-content" className={styles.article} tabIndex={-1}>
    <nav aria-label="Breadcrumbs" className={styles.breadcrumbs}><Link href="/docs">Docs</Link><span aria-hidden="true">/</span><span>{group}</span><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>
    <header className={styles.articleHeader}><p className={styles.eyebrow}>{group}</p><h1>{title}</h1><p>{description}</p></header>
    <details className={styles.mobileToc}><summary>On this page</summary><nav aria-label="Article sections">{sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav></details>
    {children}
  </main><aside className={styles.tocRail}><TableOfContents sections={sections}/></aside></div>;
}

export function DocsArticle({ article }: { article: Article }) {
  const position = articles.findIndex(item => item.slug === article.slug);
  const previous = articles[position - 1]; const next = articles[position + 1];
  return <ArticleFrame title={article.title} group={article.group} description={article.description} sections={article.sections}>
    <div className={styles.articleMeta}><span className={styles.statusDot}/>{article.status}<span>Repository verified</span></div>
    {article.sections.map(section => <section key={section.id} className={styles.articleSection} aria-labelledby={section.id}><h2 id={section.id}><a href={`#${section.id}`}>{section.title}<span aria-hidden="true">#</span></a></h2>{section.blocks.map((block, i) => <ContentBlock key={i} block={block}/>)}</section>)}
    <div className={styles.sources}><strong>Primary sources</strong><p>These guides summarize the repository’s current contracts. Detailed evidence and engineering history stay in their original records.</p>{article.sources.map(source => <a key={source} href={`https://github.com/alrimarleskovar/gryloo/blob/codex/build-brand-ux-001/${source}`}>{source} <span aria-hidden="true">↗</span></a>)}</div>
    <nav className={styles.pagination} aria-label="Article navigation">{previous ? <Link href={`/docs/${previous.slug}`}><span>← Previous</span><strong>{previous.title}</strong></Link> : <Link href="/docs"><span>← Back to</span><strong>Documentation home</strong></Link>}{next && <Link href={`/docs/${next.slug}`}><span>Next →</span><strong>{next.title}</strong></Link>}</nav>
    <footer className={styles.articleFooter}>Built with FloFi. Designed for decisions you can inspect.</footer>
  </ArticleFrame>;
}
