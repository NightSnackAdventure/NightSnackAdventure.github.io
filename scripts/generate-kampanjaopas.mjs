// Regenerates kampanjaopas/data.json + kampanjaopas/assets/* from the Obsidian vault.
// Run: node scripts/generate-kampanjaopas.mjs
// Source: every subfolder of VAULT_KAMPANJAOPAS becomes a tab; every .md file in it becomes a card.

import { readdirSync, readFileSync, statSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VAULT_ROOT = 'A:/Obsidian/DnD';
const KAMPANJAOPAS_DIR = join(VAULT_ROOT, '2026 Dragon Heist', 'Kampanjaopas');
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(REPO_ROOT, 'kampanjaopas');
const ASSETS_DIR = join(OUT_DIR, 'assets');
const SKIP_DIRS = new Set(['.obsidian', '.git', 'node_modules']);

const COMBINING_MARKS = new RegExp('[̀-ͯ]', 'g');

function slugify(str) {
  return str
    .normalize('NFKD').replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else out.push(full);
  }
  return out;
}

let vaultFileIndex = null;
function findVaultFile(name) {
  if (!vaultFileIndex) {
    vaultFileIndex = new Map();
    for (const f of walk(VAULT_ROOT)) {
      vaultFileIndex.set(basename(f).toLowerCase(), f);
    }
  }
  return vaultFileIndex.get(name.toLowerCase()) || null;
}

// Pulls a leading ``` ... ``` block of `key: value` lines off the front of the note, if present.
function extractMetaBlock(text) {
  const m = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```\s*\n?/);
  if (!m) return { meta: {}, rest: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, rest: text.slice(m[0].length) };
}

// Pulls the first ![[embed]] (image) off the note, if present near the top.
function extractCoverImage(text) {
  const m = text.match(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\n?/);
  if (!m) return { image: null, rest: text };
  const raw = m[1].trim();
  const found = findVaultFile(basename(raw));
  let image = null;
  if (found) {
    mkdirSync(ASSETS_DIR, { recursive: true });
    const ext = extname(found);
    const assetName = slugify(basename(found, ext)) + ext;
    copyFileSync(found, join(ASSETS_DIR, assetName));
    image = 'kampanjaopas/assets/' + assetName;
  }
  return { image, rest: text.slice(0, m.index) + text.slice(m.index + m[0].length) };
}

// Replaces [[path|alias]] / [[path]] with plain display text, and returns the raw link targets found.
function stripWikilinks(text) {
  const links = [];
  const body = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
    links.push(target.trim());
    return (alias || basename(target.trim())).trim();
  });
  return { body, links };
}

function parseNote(filePath, category) {
  const raw = readFileSync(filePath, 'utf-8');
  const title = basename(filePath, extname(filePath));
  const { meta, rest: afterMeta } = extractMetaBlock(raw);
  const { image, rest: afterImage } = extractCoverImage(afterMeta);
  const { body, links } = stripWikilinks(afterImage);

  return {
    id: slugify(title),
    title,
    type: meta.tags || '',
    subtitle: meta.sijainti || '',
    image,
    body: body.trim().replace(/\n{3,}/g, '\n\n'),
    linkTargets: links,
  };
}

function main() {
  const categories = readdirSync(KAMPANJAOPAS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory());

  const tabs = [];
  const titleIndex = new Map(); // lowercase title -> {tab, id}

  for (const cat of categories) {
    const dir = join(KAMPANJAOPAS_DIR, cat.name);
    const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'));
    const entries = files.map(f => parseNote(join(dir, f), cat.name));
    const tabKey = slugify(cat.name);
    tabs.push({ key: tabKey, label: cat.name, entries });
    for (const e of entries) titleIndex.set(e.title.toLowerCase(), { tab: tabKey, id: e.id });
  }

  // Resolve cross-reference links now that every note's tab/id is known.
  for (const tab of tabs) {
    for (const entry of tab.entries) {
      const resolved = [];
      for (const target of entry.linkTargets) {
        const key = basename(target).toLowerCase();
        const hit = titleIndex.get(key);
        if (hit && !(hit.tab === tab.key && hit.id === entry.id)) resolved.push(hit);
      }
      entry.links = resolved;
      delete entry.linkTargets;
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'data.json'), JSON.stringify({ tabs }, null, 2));

  const counts = tabs.map(t => `${t.label}: ${t.entries.length}`).join(', ');
  console.log(`Wrote kampanjaopas/data.json (${counts})`);
}

main();
