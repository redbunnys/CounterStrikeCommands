/**
 * Fetch the Valve Developer Wiki CS2 console command page through the
 * Anubis proof-of-work gate and save the raw HTML + the pretty-printed
 * article HTML to disk.
 *
 * Anubis "fast" algorithm: hash = SHA-256(challenge.randomData + nonce),
 * valid when the hash's leading `difficulty` bits are zero.
 * Submit at /.within.website/x/cmd/anubis/api/pass-challenge?id&response&nonce&redir&elapsedTime
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const TARGET =
  'https://developer.valvesoftware.com/wiki/List_of_Counter-Strike_2_console_commands_and_variables';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const OUT_DIR = resolve(process.argv[2] ?? 'data/raw');

function solve(randomData, difficulty) {
  const started = Date.now();
  // NOTE: Anubis' server-side validator checks for `difficulty` leading *hex zero
  // characters* of the hex digest (proofofwork.go: strings.HasPrefix(response,
  // strings.Repeat("0", difficulty))). Its own browser worker checks leading
  // zero *bits*, which is why difficulty 4 needs "0000" here, not one 0 nibble.
  const prefix = '0'.repeat(difficulty);
  for (let nonce = 0; ; nonce++) {
    const hash = createHash('sha256').update(randomData + nonce).digest('hex');
    if (hash.startsWith(prefix)) {
      return { hash, nonce, elapsed: Date.now() - started };
    }
    if (nonce > 500_000_000) throw new Error('nonce search exceeded limit');
  }
}

function extractJson(html, id) {
  const re = new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`);
  const m = html.match(re);
  if (!m) return null;
  // The payload is a JSON-encoded string for scalar values, raw object for objects.
  const raw = m[1].trim();
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Minimal per-host cookie jar: later Set-Cookie values replace earlier ones by name. */
class CookieJar {
  constructor() {
    this.store = new Map();
  }
  absorb(res) {
    const raw =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie')].filter(Boolean);
    for (const line of raw) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') this.store.delete(name);
      else this.store.set(name, value);
    }
    return this;
  }
  header() {
    return [...this.store].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  has(name) {
    return this.store.has(name);
  }
  names() {
    return [...this.store.keys()].join(', ');
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const jar = new CookieJar();

  console.log('[1/4] requesting challenge page...');
  let res = await fetch(TARGET, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  jar.absorb(res);
  let html = await res.text();

  if (html.includes('anubis_challenge')) {
    const challengeDoc = extractJson(html, 'anubis_challenge');
    if (!challengeDoc) throw new Error('could not parse anubis_challenge');
    const { challenge, rules } = challengeDoc;
    console.log(
      `[2/4] solving proof-of-work: algorithm=${rules.algorithm} difficulty=${rules.difficulty}`
    );
    const { hash, nonce, elapsed } = solve(challenge.randomData, rules.difficulty);
    console.log(`      solution nonce=${nonce} hash=${hash} (${elapsed} ms)`);

    const passUrl = new URL(
      '/.within.website/x/cmd/anubis/api/pass-challenge',
      'https://developer.valvesoftware.com'
    );
    passUrl.searchParams.set('id', challenge.id);
    passUrl.searchParams.set('response', hash);
    passUrl.searchParams.set('nonce', String(nonce));
    passUrl.searchParams.set('redir', TARGET);
    passUrl.searchParams.set('elapsedTime', String(elapsed));

    console.log('[3/4] submitting solution...');
    const passRes = await fetch(passUrl, {
      headers: {
        'User-Agent': UA,
        Cookie: jar.header(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: TARGET,
      },
      redirect: 'manual',
    });
    jar.absorb(passRes);
    await passRes.text();
    console.log(`      HTTP ${passRes.status}; jar now holds: ${jar.names()}`);
    if (passRes.status !== 302 && passRes.status !== 200) {
      throw new Error(`pass-challenge rejected with HTTP ${passRes.status}`);
    }

    console.log('[4/4] re-requesting the article with the auth cookie...');
    res = await fetch(TARGET, {
      headers: {
        'User-Agent': UA,
        Cookie: jar.header(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    jar.absorb(res);
    html = await res.text();
  } else {
    console.log('[2/4] no challenge presented; served directly.');
  }

  const stillGated = html.includes('anubis_challenge');
  const article = resolve(OUT_DIR, 'cs2_wiki.html');
  writeFileSync(article, html, 'utf8');
  writeFileSync(resolve(OUT_DIR, 'fetch-meta.json'), JSON.stringify({
    target: TARGET,
    finalUrl: res.url,
    status: res.status,
    gated: stillGated,
    bytes: html.length,
    fetchedAt: new Date().toISOString(),
  }, null, 2), 'utf8');

  console.log(`DONE status=${res.status} gated=${stillGated} bytes=${html.length}`);
  console.log(`saved: ${article}`);
  if (stillGated) process.exitCode = 2;
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
});
