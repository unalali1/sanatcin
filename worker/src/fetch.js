import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { chromium } from 'playwright';
import { config } from './config.js';

const parser = new Parser({ timeout: config.requestTimeoutMs });

export function sourceHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

export function normalizeUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm|from|source|ref)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export async function fetchText(url, { browser = false } = {}) {
  if (browser) {
    let instance;
    try {
      instance = await chromium.launch({ headless: true });
      const page = await instance.newPage({ userAgent: config.userAgent });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.requestTimeoutMs });
      return await page.content();
    } finally {
      await instance?.close();
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': config.userAgent, accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function cleanTitle(value = '') {
  return value.replace(/\s+/g, ' ').replace(/[|｜–—-]\s*[^|｜–—-]{2,30}$/, '').trim();
}

function dateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function looksLikeArticle(url, title) {
  const compact = title.replace(/\s+/g, '');
  if (compact.length < 8 || compact.length > 180) return false;
  if (/^(home|news|culture|arts|more|read more|video|photos?|首页|新闻|文化|更多|图片)$/i.test(compact)) return false;
  const path = new URL(url).pathname;
  return /\d{4}|article|content|news|node|\/\d{5,}/i.test(path) || path.split('/').filter(Boolean).length >= 2;
}

export async function discover(source) {
  if (source.mode === 'rss') {
    const feed = await parser.parseURL(source.feedUrl);
    return (feed.items ?? []).slice(0, 30).map((item) => ({
      id: sourceHash(normalizeUrl(item.link, source.url) ?? item.link ?? `${source.id}:${item.guid}`),
      source,
      title: cleanTitle(item.title),
      url: normalizeUrl(item.link, source.url),
      publishedAt: dateValue(item.isoDate ?? item.pubDate),
      summary: cheerio.load(item.contentSnippet ?? item.content ?? '').text().trim().slice(0, 600)
    })).filter((item) => item.url && item.title);
  }

  const html = await fetchText(source.url, { browser: source.browser });
  const $ = cheerio.load(html);
  const seen = new Set();
  const items = [];
  $('article a[href], main a[href], .content a[href], .list a[href], a[href]').each((_, element) => {
    if (items.length >= 40) return;
    const title = cleanTitle($(element).attr('title') || $(element).text());
    const url = normalizeUrl($(element).attr('href'), source.url);
    if (!url || seen.has(url) || !looksLikeArticle(url, title)) return;
    const sourceHost = new URL(source.url).hostname.replace(/^www\./, '');
    const itemHost = new URL(url).hostname.replace(/^www\./, '');
    if (!itemHost.endsWith(sourceHost) && !sourceHost.endsWith(itemHost)) return;
    seen.add(url);
    const container = $(element).closest('article, li, .item, .news-item, .card');
    const dateText = container.find('time').attr('datetime') || container.find('time, .date, .time').first().text();
    items.push({ id: sourceHash(url), source, title, url, publishedAt: dateValue(dateText), summary: container.text().replace(/\s+/g, ' ').trim().slice(0, 600) });
  });
  return items;
}

export async function extractArticle(candidate) {
  let html;
  try {
    html = await fetchText(candidate.url);
  } catch (error) {
    if (!candidate.source.browser) throw error;
    html = await fetchText(candidate.url, { browser: true });
  }

  const dom = new JSDOM(html, { url: candidate.url });
  const document = dom.window.document;
  const article = new Readability(document).parse();
  const $ = cheerio.load(html);
  const publishedAt = candidate.publishedAt || dateValue(
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="publishdate"]').attr('content') ||
    $('time').first().attr('datetime')
  );
  const leadImage = $('article img, main img, .article img, .content img').first();
  const image =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    leadImage.attr('data-src') ||
    leadImage.attr('data-lazy-src') ||
    leadImage.attr('src') ||
    null;
  const text = (article?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 300) throw new Error('Makale gövdesi güvenilir biçimde çıkarılamadı.');

  return {
    ...candidate,
    title: cleanTitle(article?.title || candidate.title),
    publishedAt,
    sourceImageUrl: image ? normalizeUrl(image, candidate.url) : null,
    text
  };
}

