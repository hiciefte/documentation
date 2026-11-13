// "Checked against <release>": src/data/pinned-releases.json says which release tag each
// commit-pinned GitHub source in migration/source-review-notes.json belongs to. An article
// shows the chip only for a release that one of its notes with the status
// verified-against-pinned-source pins through a source URL. Nothing is read from a note's
// prose, and everything here works offline: the API evidence is recorded in the data file.
// src/components/PageTitle.astro shows the chip; any problem here fails the build.
import { readFileSync } from "node:fs";

export const verifiedStatus = "verified-against-pinned-source";
export const dataPath = "src/data/pinned-releases.json";

// A GitHub URL into a repository at one commit. A full 40-character commit is a pin; an
// abbreviated one is reported, because it cannot be matched to an entry.
const pinnedSource = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/(?:blob|tree|raw|blame|commit)\/([0-9a-f]{7,40})(?=[/#?]|$)/i;
const keyPattern = /^([a-z0-9_.-]+\/[a-z0-9_.-]+)@([0-9a-f]{40})$/;
const fullCommit = /^[0-9a-f]{40}$/;
const day = /^\d{4}-\d{2}-\d{2}$/;
const productsByRepo = { "bisq-network/bisq": "Bisq 1", "bisq-network/bisq2": "Bisq 2" };
const entryFields = ["product", "release", "tag", "evidence", "checked", "resolved"];
const resolvedFields = ["tagObject", "tagObjectType", "commit", "tagger", "taggedAt", "signature", "compare"];

/** The commit a source URL pins: { repo, sha, key } for a full commit, { repo, abbreviated } for a short one, else undefined. */
export function pinnedCommit(url) {
  const match = typeof url === "string" ? pinnedSource.exec(url) : null;
  if (!match) return undefined;
  const repo = match[1].toLowerCase();
  const sha = match[2].toLowerCase();
  return sha.length === 40 ? { repo, sha, key: `${repo}@${sha}` } : { repo, abbreviated: sha };
}

const text = (value) => typeof value === "string" && value.trim() !== "";

/** Problems with one entry; `key` is its owner/repo@sha. */
function entryProblems(key, entry) {
  const problems = [];
  const match = keyPattern.exec(key);
  if (!match) return [`${key}: the key must be a lower-case owner/repo@ followed by a full 40-character commit`];
  const [, repo, sha] = match;
  const name = key;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [`${name}: the entry must be an object`];
  const extra = Object.keys(entry).filter((field) => !entryFields.includes(field));
  if (extra.length) problems.push(`${name}: unknown fields ${extra.join(", ")}`);
  for (const field of ["product", "release", "tag"]) if (!text(entry[field])) problems.push(`${name}: ${field} is missing`);
  if (repo in productsByRepo && entry.product !== productsByRepo[repo]) problems.push(`${name}: product must be ${productsByRepo[repo]} for ${repo}`);
  if (text(entry.tag) && entry.release !== entry.tag) problems.push(`${name}: release ${JSON.stringify(entry.release)} must be the tag name ${JSON.stringify(entry.tag)}`);
  const expected = `https://api.github.com/repos/${repo}/git/refs/tags/${entry.tag}`;
  if (text(entry.tag) && entry.evidence !== expected) problems.push(`${name}: evidence must be the tag ref ${expected}`);
  if (typeof entry.checked !== "string" || !day.test(entry.checked) || Number.isNaN(Date.parse(entry.checked))) problems.push(`${name}: checked must be a date (YYYY-MM-DD)`);
  const resolved = entry.resolved;
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) { problems.push(`${name}: resolved (what the API returned for the tag) is missing`); return problems; }
  const unknown = Object.keys(resolved).filter((field) => !resolvedFields.includes(field));
  if (unknown.length) problems.push(`${name}: resolved has unknown fields ${unknown.join(", ")}`);
  if (resolved.commit !== sha) problems.push(`${name}: tag ${JSON.stringify(entry.tag)} resolves to ${JSON.stringify(resolved.commit)} as recorded, not to the pinned commit`);
  if (!fullCommit.test(resolved.tagObject ?? "")) problems.push(`${name}: resolved.tagObject must be a full 40-character object id`);
  if (resolved.tagObjectType === "tag") {
    if (resolved.tagObject === resolved.commit) problems.push(`${name}: an annotated tag's object id differs from its commit`);
  } else if (resolved.tagObjectType === "commit") {
    if (resolved.tagObject !== resolved.commit) problems.push(`${name}: a lightweight tag points at its commit directly, but tagObject differs from commit`);
  } else problems.push(`${name}: resolved.tagObjectType must be "tag" (annotated) or "commit" (lightweight)`);
  for (const field of ["tagger", "taggedAt", "signature", "compare"]) if (!text(resolved[field])) problems.push(`${name}: resolved.${field} is missing`);
  return problems;
}

/**
 * Problems with the data, given the notes ({ items }): every entry must resolve its tag
 * to its own commit as recorded, and every commit-pinned GitHub source in any note must
 * have an entry. An empty list means the chip's evidence holds.
 */
export function pinnedReleaseProblems(data, notes) {
  if (!data || typeof data !== "object" || typeof data.pins !== "object" || data.pins === null || Array.isArray(data.pins)) return [`${dataPath} must hold a pins object`];
  const problems = [];
  if (typeof data.showCheckedAgainst !== "boolean") problems.push(`${dataPath}: showCheckedAgainst must be true or false`);
  for (const [key, entry] of Object.entries(data.pins)) problems.push(...entryProblems(key, entry));
  for (const note of notes.items) {
    for (const source of note.sources ?? []) {
      const pin = pinnedCommit(source.url);
      if (!pin) continue;
      if (pin.abbreviated) problems.push(`note ${note.id}: ${source.url} pins an abbreviated commit; pin the full 40-character commit`);
      else if (!Object.hasOwn(data.pins, pin.key)) problems.push(`note ${note.id}: ${source.url} pins ${pin.key}, which has no entry in ${dataPath}`);
    }
  }
  return problems;
}

/**
 * The releases an article was checked against: one { product, release, label, checks } per
 * distinct pin of a verified note that lists the article, in the data file's order.
 * `checks` are the ids of those notes. Empty when no note pins a release for the article.
 */
export function checkedAgainst(slug, notes, data) {
  const found = new Map();
  for (const note of notes.items) {
    if (note.status !== verifiedStatus || !note.source_slugs.includes(slug)) continue;
    for (const source of note.sources ?? []) {
      const pin = pinnedCommit(source.url);
      const entry = pin?.key ? data.pins[pin.key] : undefined;
      if (!entry) continue;
      if (!found.has(pin.key)) found.set(pin.key, { product: entry.product, release: entry.release, label: `${entry.product} ${entry.release}`, checks: [] });
      const release = found.get(pin.key);
      if (!release.checks.includes(note.id)) release.checks.push(note.id);
    }
  }
  const order = Object.keys(data.pins);
  return [...found.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([, release]) => release);
}

let cache;
function load() {
  if (!cache) {
    const data = JSON.parse(readFileSync(dataPath, "utf8"));
    const notes = JSON.parse(readFileSync("migration/source-review-notes.json", "utf8"));
    const problems = pinnedReleaseProblems(data, notes);
    if (problems.length) throw new Error(`Pinned releases (${dataPath}):\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    cache = { data, notes };
  }
  return cache;
}

/** Whether the chip is switched on (showCheckedAgainst). Throws on any problem with the data, switched on or not. */
export function showCheckedAgainst() {
  return load().data.showCheckedAgainst;
}

/** The releases the article was checked against (see checkedAgainst), whether or not the chip is switched on. Throws on any problem. */
export function checkedAgainstFor(slug) {
  const { data, notes } = load();
  return checkedAgainst(slug, notes, data);
}
