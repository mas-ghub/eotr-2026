import { parse } from 'node-html-parser';
import { fetchText, mapLimit } from './lib/http.mjs';

const SITEMAP = 'https://endoftheroadfestival.com/wp-sitemap-posts-artist-1.xml';
const FEEDS = ['music', 'comedy', 'literature'];

/**
 * Some artist pages still publish plain-http links; upgrade them to the
 * working https equivalent so the app never renders a non-https href.
 */
const LINK_NORMALIZE = {
  'http://juniorbrother.com': 'https://juniorbrother.com',
  'http://www.carsonmchonemusic.com': 'https://www.carsonmchonemusic.com',
  'http://james-k.com': 'https://www.jamesk.com'
};

async function fetchSitemapSlugs() {
  const xml = await fetchText(SITEMAP, { delay: 0 });
  const slugs = new Set();
  for (const m of xml.matchAll(/<loc>\s*(https:\/\/endoftheroadfestival\.com\/artist\/([^/]+)\/)\s*<\/loc>/g)) {
    if (m[2] === '__trashed' || m[2].startsWith('__trashed')) continue;
    slugs.add(m[2]);
  }
  return [...slugs];
}

/** Classify artists using the WordPress RSS feed for each artist-type term. */
async function fetchTypeMap() {
  const map = new Map(); // slug -> type
  for (const type of FEEDS) {
    try {
      for (let page = 1; page <= 20; page++) {
        const url = `https://endoftheroadfestival.com/artist-type/${type}/feed/?paged=${page}`;
        const xml = await fetchText(url, { delay: 400 });
        const found = new Set();
        for (const m of xml.matchAll(/<link>\s*https:\/\/endoftheroadfestival\.com\/artist\/([^/]+)\/\s*<\/link>/g)) {
          found.add(m[1]);
        }
        let newCount = 0;
        for (const slug of found) {
          if (!map.has(slug)) {
            map.set(slug, type);
            newCount++;
          }
        }
        if (found.size === 0 || newCount === 0) break; // exhausted
      }
    } catch (err) {
      console.warn(`  ! type feed "${type}" failed: ${err.message}`);
    }
  }
  return map;
}

function parseArtistPage(html, slug) {
  const root = parse(html);

  const titleEl = root.querySelector('h2.artist__title');
  const name = titleEl
    ? titleEl.text.trim()
    : root
        .querySelector('title')
        ?.text.replace(/\s*\|\s*End of the Road.*$/i, '')
        .trim() || slug;

  let image = null;
  const img = root.querySelector('img.JS--lazyLoad.banner__image');
  if (img) {
    image = img.getAttribute('data-src') || img.getAttribute('data-small-src') || null;
  }
  if (!image) {
    const og = root.querySelector('meta[property="og:image"]');
    if (og && og.getAttribute('content') && !og.getAttribute('content').includes('menu.svg')) {
      image = og.getAttribute('content');
    }
  }

  let bio = '';
  const contentEls = root.querySelectorAll('div.content');
  for (const el of contentEls) {
    if (el.classList.contains('embedMedia__container')) continue;
    const paras = el.querySelectorAll('p');
    if (paras.length) {
      bio = paras.map((p) => p.text.trim()).filter(Boolean).join('\n\n');
      break;
    }
  }

  const links = [];
  // Only the artist's own socials (the .sitewideSocialLinks block scoped INSIDE the artist
  // section). Do NOT fall back to the unscoped block: on artist pages that have no socials,
  // that unscoped block is the festival's site-wide footer, which would leak festival
  // accounts into an artist's links (e.g. DJ Crenshaw, Sunil Patel).
  const socialScope = root.querySelector('.artist .sitewideSocialLinks');
  socialScope?.querySelectorAll('a.socialLink').forEach((a) => {
    const href = a.getAttribute('href');
    const label =
      a.querySelector('.socialLink__words')?.text?.trim() ||
      a.querySelector('.socialLink__text')?.text?.trim();
    if (href && label && /^https?:\/\//i.test(href)) {
      const clean = label.toLowerCase().replace(/,$/, '');
      const url = LINK_NORMALIZE[href] || href;
      if (!links.some((l) => l.url === url)) links.push({ label: clean, url });
    }
  });

  let spotifyId = null;
  const iframe = root.querySelector('iframe[src*="open.spotify.com/embed/artist/"]');
  if (iframe) {
    const m = (iframe.getAttribute('src') || '').match(/\/artist\/([A-Za-z0-9]+)/);
    if (m) spotifyId = m[1];
  }

  return { slug, name, image, bio, links, spotifyId };
}

/**
 * Scrape all End of the Road artist pages.
 * Returns { artists: [{ slug, name, type, image, bio, links, spotifyId }] }
 */
export async function scrapeEotrArtists() {
  console.log('Fetching artist sitemap...');
  const slugs = await fetchSitemapSlugs();
  console.log(`  ${slugs.length} artists in sitemap`);

  console.log('Classifying artists (music/comedy/literature via RSS feeds)...');
  const typeMap = await fetchTypeMap();
  console.log(`  classified ${typeMap.size} artists`);

  console.log('Fetching artist pages...');
  const results = await mapLimit(slugs, 3, async (slug) => {
    const html = await fetchText(`https://endoftheroadfestival.com/artist/${slug}/`, { delay: 500 });
    const artist = parseArtistPage(html, slug);
    artist.type = typeMap.get(slug) || null;
    return artist;
  });

  const artists = results.filter(Boolean).filter((a) => a.name);
  const byType = {};
  for (const a of artists) byType[a.type || 'none'] = (byType[a.type || 'none'] || 0) + 1;
  console.log(`  parsed ${artists.length} artists: ${JSON.stringify(byType)}`);
  return { artists };
}
