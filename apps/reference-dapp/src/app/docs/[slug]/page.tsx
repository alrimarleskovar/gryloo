// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { articles } from '../../../components/docs/content';
import { DocsArticle } from '../../../components/docs/article';

export function generateStaticParams() { return articles.map(article => ({ slug: article.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params; const article = articles.find(item => item.slug === slug);
  return article ? { title: article.title, description: article.description } : {};
}
export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const article = articles.find(item => item.slug === slug);
  if (!article) notFound();
  return <DocsArticle article={article}/>;
}
