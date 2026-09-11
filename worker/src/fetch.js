import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { chromium } from 'playwright';
import { config } from './config.js';
import { assertSourceContentQuality, isUsableImageUrl } from './quality.js';

const parser = new Parser({ timeout: config.requestTimeoutMs });
const defaultItemSelector = 'article, li, .item, .news-item, .card, .story, .post';
const defaultLinkSelector = 'article a[href], main a[href], .content a[href], .list a[href], a[href]';

export function sourceHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

export function normalizeUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm|from|source|ref)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/{2,}/g, '/');
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function challengePage(html = '') {
  return /cf-chl-|cloudflare.*(?:challenge|verification)|verify you are human|captcha/i.test(html.slice(0, 80_000));
}

export async function fetchText(url, { browser = false, waitSelector = null } = {}) {
  if (browser) {
    let instance;
    try {
      instance = await chromium.launch({ headless: true });
      const page = await instance.newPage({ userAgent: config.userAgent });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.requestTimeoutMs });
      if (waitSelector) {
        await page.waitForSelector(waitSelector, { timeout: Math.min(10_000, config.requestTimeoutMs) }).catch(() => null);
      }
      const html = await page.content();
      if (challengePage(html)) throw new Error('İnsan doğrulaması/CAPTCHA nedeniyle kaynak atlandı.');
      return html;
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
      headers: {
        'user-agent': config.userAgent,
        accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (challengePage(text)) throw new Error('İnsan doğrulaması/CAPTCHA nedeniyle kaynak atlandı.');
    return text;
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

export function dateFromText(value = '') {
  const normalized = String(value).replace(/年|\//g, '-').replace(/月/g, '-').replace(/日/g, ' ');
  const match = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour = '00', minute = '00'] = match;
  return dateValue(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00+08:00`);
}

export function dateFromUrl(value = '') {
  let pathname;
  try {
    pathname = new URL(value).pathname;
  } catch {
    return null;
  }
  const compact = pathname.match(/\/(20\d{2})(\d{2})(\d{2})(?:\/|$)/);
  const chinaDaily = pathname.match(/\/a\/(20\d{2})(\d{2})\/(\d{2})(?:\/|$)/);
  const divided = pathname.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/);
  const match = compact || chinaDaily || divided;
  if (!match) return null;
  return dateValue(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T00:00:00+08:00`);
}

function looksLikeArticle(url, title) {
  const compact = title.replace(/\s+/g, '');
  if (compact.length < 8 || compact.length > 180) return false;
  if (/^(home|news|culture|arts|more|read more|video|photos?|subscribe|首页|新闻|文化|更多|图片)$/i.test(compact)) return false;
  const path = new URL(url).pathname;
  return /\d{4}|article|content|news|node|post|event|\/\d{5,}/i.test(path) || path.split('/').filter(Boolean).length >= 2;
}

function samePublisher(url, sourceUrl) {
  const sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, '');
  const itemHost = new URL(url).hostname.replace(/^www\./, '');
  return itemHost.endsWith(sourceHost) || sourceHost.endsWith(itemHost);
}

export function matchesSourceFilter(source, title, summary = '') {
  const haystack = `${title} ${summary}`.toLowerCase();
  if (source.excludeTerms?.some((term) => haystack.includes(term.toLowerCase()))) return false;
  if (source.includeTerms?.length && !source.includeTerms.some((term) => haystack.includes(term.toLowerCase()))) return false;
  return true;
}

export async function discoverFromFeedXml(xml, source) {
  const feed = await parser.parseString(xml);
  return (feed.items ?? []).slice(0, 40).map((item) => {
    const url = normalizeUrl(item.link, source.url);
    const summary = cheerio.load(item.contentSnippet ?? item.content ?? item.summary ?? '').text().replace(/\s+/g, ' ').trim().slice(0, 600);
    return {
      id: sourceHash(url ?? item.link ?? `${source.id}:${item.guid}`),
      source,
      title: cleanTitle(item.title),
      url,
      publishedAt: dateValue(item.isoDate ?? item.pubDate ?? item.updated),
      summary
    };
  }).filter((item) => item.url && item.title && matchesSourceFilter(source, item.title, item.summary));
}

function closestItem($, link, source) {
  const selector = source.itemSelector || defaultItemSelector;
  const container = link.closest(selector);
  return container.length ? container.first() : link.parent();
}

function titleFromItem($, link, container, source) {
  if (source.titleSelector) {
    const selected = container.find(source.titleSelector).first();
    if (selected.length) return cleanTitle(selected.attr('title') || selected.text());
  }
  const heading = container.find('h1, h2, h3, h4, h5').first();
  return cleanTitle(link.attr('title') || heading.text() || link.text());
}

function summaryFromItem(container) {
  const selected = container.find('.summary, .excerpt, .description, .dek, p').first().text();
  const fallback = container.text();
  return String(selected || fallback).replace(/\s+/g, ' ').trim().slice(0, 600);
}

function dateFromItem(container, url, source) {
  const dateRoot = source.dateSelector ? container.find(source.dateSelector).first() : container.find('time, .date, .time, .published, .post-date').first();
  const value = dateRoot.attr('datetime') || dateRoot.attr('content') || dateRoot.text();
  return dateValue(value) || dateFromText(value) || dateFromText(container.text().slice(0, 500)) || dateFromUrl(url);
}

export function discoverFromHtml(html, source) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const items = [];
  const limit = source.articleLimit ?? 40;
  const selector = source.linkSelector || defaultLinkSelector;

  $(selector).each((_, element) => {
    if (items.length >= limit) return false;
    const link = $(element).is('a[href]') ? $(element) : $(element).find('a[href]').first();
    if (!link.length) return;
    const url = normalizeUrl(link.attr('href'), source.url);
    if (!url || seen.has(url) || !samePublisher(url, source.url)) return;
    if (source.pathPattern && !source.pathPattern.test(new URL(url).pathname)) return;
    const container = closestItem($, link, source);
    const title = titleFromItem($, link, container, source);
    const summary = summaryFromItem(container);
    if (!looksLikeArticle(url, title) || !matchesSourceFilter(source, title, summary)) return;
    seen.add(url);
    items.push({
      id: sourceHash(url),
      source,
      title,
      url,
      publishedAt: dateFromItem(container, url, source),
      summary
    });
  });
  return items;
}

async function discoverRss(source) {
  const xml = await fetchText(source.feedUrl);
  return discoverFromFeedXml(xml, source);
}

function freshDatedItems(items, days = 14) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return items.filter((item) => item.publishedAt && new Date(item.publishedAt).getTime() >= cutoff);
}

export async function discover(source) {
  if (source.mode === 'rss') return discoverRss(source);
  if (source.mode === 'hybrid') {
    try {
      const items = await discoverRss(source);
      if (freshDatedItems(items).length >= (source.feedMinimumFreshItems ?? 1)) return items;
    } catch {
      // The approved fallback is the public HTML section; no paywall or challenge is bypassed.
    }
  }
  const html = await fetchText(source.url, { browser: source.browser, waitSelector: source.waitSelector });
  return discoverFromHtml(html, source);
}

export async function extractArticle(candidate) {
  let html;
  try {
    html = await fetchText(candidate.url);
  } catch (error) {
    if (!candidate.source.browser) throw error;
    html = await fetchText(candidate.url, { browser: true, waitSelector: 'article, main' });
  }

  const dom = new JSDOM(html, { url: candidate.url });
  const document = dom.window.document;
  const article = new Readability(document).parse();
  const $ = cheerio.load(html);
  const publishedAt = candidate.publishedAt || dateValue(
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="publishdate"]').attr('content') ||
    $('meta[name="publish_date"]').attr('content') ||
    $('meta[itemprop="datePublished"]').attr('content') ||
    $('time').first().attr('datetime')
  ) || dateFromText($('body').text().slice(0, 5000)) || dateFromUrl(candidate.url);
  const text = (article?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  if (candidate.source.rejectBodyPatterns?.some((pattern) => pattern.test(text))) {
    throw new Error('Ödeme duvarlı veya üyelik gerektiren haber gövdesi atlandı.');
  }
  assertSourceContentQuality(text);

  const readable = cheerio.load(article?.content ?? '');
  const rawImages = [
    ...readable('img').map((_, element) => readable(element).attr('data-src') || readable(element).attr('data-lazy-src') || readable(element).attr('data-original') || readable(element).attr('src')).get(),
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    ...$('article img, main img, .article img, .content img').map((_, element) => $(element).attr('data-src') || $(element).attr('data-lazy-src') || $(element).attr('data-original') || $(element).attr('src')).get()
  ];
  const sourceImageUrls = [...new Set(rawImages
    .filter(Boolean)
    .map((image) => normalizeUrl(image, candidate.url))
    .filter((image) => image && isUsableImageUrl(image)))];

  return {
    ...candidate,
    title: cleanTitle(article?.title || candidate.title),
    publishedAt,
    sourceImageUrl: sourceImageUrls[0] ?? null,
    sourceImageUrls,
    text
  };
}
