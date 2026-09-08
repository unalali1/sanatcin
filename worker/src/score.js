import { CATEGORIES } from './sources.js';

const terms = {
  'kultur-sanat': ['art','artist','arts','culture','museum','exhibition','heritage','literature','book','theatre','opera','painting','sculpture','艺术','文化','博物馆','展览','遗产','文学','图书','戏剧','美术','考古'],
  sinema: ['film','cinema','movie','box office','director','actor','actress','series','television','drama','动画','电影','影院','票房','导演','演员','电视剧','纪录片'],
  'moda-tasarim': ['fashion','design','designer','style','runway','collection','brand','architecture','trend','时尚','设计','设计师','秀场','系列','品牌','潮流','建筑'],
  'sehir-yasam': ['beijing','shanghai','chengdu','hangzhou','chongqing','city','festival','event','travel','food','district','北京','上海','成都','杭州','重庆','城市','节','活动','旅游','生活','街区']
};

const interestSignals = ['first','largest','record','award','festival','opens','premiere','new','major','international','historic','首次','最大','纪录','获奖','开幕','首映','新','国际','历史'];

export function inferCategory(candidate) {
  if (candidate.source.defaultCategory) return candidate.source.defaultCategory;
  const haystack = `${candidate.title} ${candidate.summary ?? ''}`.toLowerCase();
  const ranked = CATEGORIES.map((category) => ({
    slug: category.slug,
    hits: terms[category.slug].reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0)
  })).sort((a, b) => b.hits - a.hits);
  return ranked[0].hits > 0 ? ranked[0].slug : 'kultur-sanat';
}

export function freshnessPoints(publishedAt, now = new Date()) {
  if (!publishedAt) return 18;
  const hours = Math.max(0, (now.getTime() - new Date(publishedAt).getTime()) / 3_600_000);
  if (hours <= 24) return 35;
  if (hours <= 48) return 31;
  if (hours <= 72) return 27;
  if (hours <= 120) return 20;
  if (hours <= 168) return 12;
  return 0;
}

export function scoreCandidate(candidate, now = new Date()) {
  const haystack = `${candidate.title} ${candidate.summary ?? ''}`.toLowerCase();
  const signals = interestSignals.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
  const numberBonus = /\d/.test(haystack) ? 3 : 0;
  const interest = Math.min(35, 14 + signals * 4 + numberBonus);
  const source = Math.min(10, candidate.source.quality ?? 5);
  const category = inferCategory(candidate);
  const relevance = terms[category].some((term) => haystack.includes(term)) || candidate.source.defaultCategory ? 20 : 10;
  return { ...candidate, category, score: freshnessPoints(candidate.publishedAt, now) + interest + source + relevance };
}

export function selectByCategory(candidates, maxPerCategory = 2) {
  const selected = [];
  for (const { slug } of CATEGORIES) {
    const group = candidates.filter((item) => item.category === slug).sort((a, b) => b.score - a.score);
    selected.push(...group.slice(0, maxPerCategory));
  }
  return selected.sort((a, b) => b.score - a.score);
}

