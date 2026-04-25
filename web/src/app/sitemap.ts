import { MetadataRoute } from 'next';
import { tracks as tracksApi, learn } from '@/lib/api';
const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://urbangist.com.ng';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = ['/','/trending','/search','/learn','/about','/privacy','/terms','/content-policy','/contact'].map(r => ({ url:`${BASE}${r}`, lastModified: new Date() }));
  try {
    const [tracksRes, articlesRes] = await Promise.all([
      tracksApi.feed({ feed:'trending', limit: 200 }),
      learn.list({ limit: 100 }),
    ]);
    const trackRoutes    = (tracksRes.tracks ?? []).map(t => ({ url:`${BASE}/track/${t.slug}`, lastModified: new Date(t.published_at ?? Date.now()) }));
    const articleRoutes  = (articlesRes.articles ?? []).map(a => ({ url:`${BASE}/learn/${a.slug}`, lastModified: new Date(a.published_at ?? Date.now()) }));
    return [...staticRoutes, ...trackRoutes, ...articleRoutes];
  } catch { return staticRoutes; }
}
