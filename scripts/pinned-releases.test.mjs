import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkedAgainst, checkedAgainstFor, pinnedCommit, pinnedReleaseProblems, showCheckedAgainst } from "./lib/pinned-releases.mjs";

const sha = "a".repeat(40);
const other = "b".repeat(40);
const tagObject = "c".repeat(40);
const repoData = () => JSON.parse(readFileSync("src/data/pinned-releases.json", "utf8"));
const repoNotes = () => JSON.parse(readFileSync("migration/source-review-notes.json", "utf8"));

const entry = (fields = {}) => ({
  product: "Bisq 1",
  release: "v1.0.0",
  tag: "v1.0.0",
  evidence: "https://api.github.com/repos/bisq-network/bisq/git/refs/tags/v1.0.0",
  checked: "2026-11-13",
  resolved: { tagObject, tagObjectType: "tag", commit: sha, tagger: "A. Tagger", taggedAt: "2026-11-01T00:00:00Z", signature: "valid", compare: "identical" },
  ...fields,
});
const data = (pins = { [`bisq-network/bisq@${sha}`]: entry() }, extra = {}) => ({ showCheckedAgainst: false, pins, ...extra });
const note = (fields = {}) => ({
  id: "n1",
  status: "verified-against-pinned-source",
  source_slugs: ["restore"],
  sources: [{ label: "Code", url: `https://github.com/bisq-network/bisq/blob/${sha}/core/Foo.java#L1-L9` }],
  ...fields,
});
const notes = (...items) => ({ items });

test("the repository's entries pass offline against the repository's notes", () => {
  assert.deepEqual(pinnedReleaseProblems(repoData(), repoNotes()), []);
});

test("the two pins the notes use resolve to the release tags recorded from the GitHub API", () => {
  const { pins } = repoData();
  const bisq1 = pins["bisq-network/bisq@ea9d5dff90c99ac462f2b0a7bf9ef92683956619"];
  const bisq2 = pins["bisq-network/bisq2@cfe8ab251f2b6579f29e9955036afc33ba36861e"];
  assert.deepEqual([bisq1.product, bisq1.release, bisq1.tag, bisq1.resolved.commit], ["Bisq 1", "v1.10.11", "v1.10.11", "ea9d5dff90c99ac462f2b0a7bf9ef92683956619"]);
  assert.deepEqual([bisq2.product, bisq2.release, bisq2.tag, bisq2.resolved.commit], ["Bisq 2", "v2.1.15", "v2.1.15", "cfe8ab251f2b6579f29e9955036afc33ba36861e"]);
});

test("a note whose commit-pinned GitHub source has no entry fails", () => {
  const unknown = note({ sources: [{ label: "Code", url: `https://github.com/bisq-network/bisq/blob/${other}/core/Foo.java` }] });
  assert.match(pinnedReleaseProblems(data(), notes(unknown)).join("\n"), new RegExp(`note n1: .* pins bisq-network/bisq@${other}, which has no entry`));
  // A pin in another repository is another key; and a failing note fails whatever its status.
  const elsewhere = note({ status: "needs-maintainer-review", sources: [{ label: "Code", url: `https://github.com/bisq-network/bisq2/tree/${sha}/x` }] });
  assert.match(pinnedReleaseProblems(data(), notes(elsewhere)).join("\n"), /pins bisq-network\/bisq2@a+, which has no entry/);
  // Blob, tree, raw, blame and commit URLs all pin a commit.
  for (const kind of ["blob", "tree", "raw", "blame", "commit"]) {
    const pinned = note({ sources: [{ label: "Code", url: `https://github.com/bisq-network/bisq/${kind}/${other}` }] });
    assert.match(pinnedReleaseProblems(data(), notes(pinned)).join("\n"), /has no entry/, kind);
  }
  assert.deepEqual(pinnedReleaseProblems(data(), notes(note())), []);
});

test("an abbreviated commit cannot be matched and fails; other URLs pin nothing", () => {
  const short = note({ sources: [{ label: "Code", url: `https://github.com/bisq-network/bisq/blob/${sha.slice(0, 10)}/core/Foo.java` }] });
  assert.match(pinnedReleaseProblems(data(), notes(short)).join("\n"), /abbreviated commit/);
  const unpinned = note({ sources: [
    { label: "Branch", url: "https://github.com/bisq-network/bisq/blob/master/core/Foo.java" },
    { label: "Tag", url: "https://github.com/bisq-network/bisq/blob/v1.10.11/core/Foo.java" },
    { label: "Wiki", url: "https://bisq.wiki/index.php?oldid=3195" },
    { label: "Press", url: "https://rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=57376" },
  ] });
  assert.deepEqual(pinnedReleaseProblems(data(), notes(unpinned)), []);
  assert.equal(pinnedCommit("https://github.com/bisq-network/bisq/blob/master/core/Foo.java"), undefined);
  assert.equal(pinnedCommit(`https://github.com/Bisq-Network/Bisq/blob/${sha.toUpperCase()}/x`).key, `bisq-network/bisq@${sha}`);
});

test("an entry whose tag does not resolve to its commit as recorded fails", () => {
  const key = `bisq-network/bisq@${sha}`;
  const wrongCommit = data({ [key]: entry({ resolved: { ...entry().resolved, commit: other } }) });
  assert.match(pinnedReleaseProblems(wrongCommit, notes()).join("\n"), /tag "v1.0.0" resolves to "b+" as recorded, not to the pinned commit/);
  const noResolved = entry();
  delete noResolved.resolved;
  assert.match(pinnedReleaseProblems(data({ [key]: noResolved }), notes()).join("\n"), /resolved .* is missing/);
  // An annotated tag's object is not its commit; a lightweight tag's is.
  assert.match(pinnedReleaseProblems(data({ [key]: entry({ resolved: { ...entry().resolved, tagObject: sha } }) }), notes()).join("\n"), /annotated tag's object id differs/);
  assert.match(pinnedReleaseProblems(data({ [key]: entry({ resolved: { ...entry().resolved, tagObjectType: "commit" } }) }), notes()).join("\n"), /lightweight tag points at its commit/);
  assert.deepEqual(pinnedReleaseProblems(data({ [key]: entry({ resolved: { ...entry().resolved, tagObjectType: "commit", tagObject: sha } }) }), notes()), []);
});

test("an entry must name its repository's tag ref, product and release", () => {
  const key = `bisq-network/bisq@${sha}`;
  const run = (fields) => pinnedReleaseProblems(data({ [key]: entry(fields) }), notes()).join("\n");
  assert.match(run({ evidence: "https://api.github.com/repos/bisq-network/bisq2/git/refs/tags/v1.0.0" }), /evidence must be the tag ref https:\/\/api.github.com\/repos\/bisq-network\/bisq\/git\/refs\/tags\/v1.0.0/);
  assert.match(run({ evidence: "https://api.github.com/repos/bisq-network/bisq/git/refs/tags/v1.0.1" }), /evidence must be the tag ref/);
  assert.match(run({ product: "Bisq 2" }), /product must be Bisq 1 for bisq-network\/bisq/);
  assert.match(run({ release: "v1.0.1" }), /release "v1.0.1" must be the tag name "v1.0.0"/);
  assert.match(run({ checked: "13 Nov 2026" }), /checked must be a date/);
  assert.match(run({ extra: true }), /unknown fields extra/);
  assert.match(pinnedReleaseProblems(data({ [`BISQ-network/bisq@${sha}`]: entry() }), notes()).join("\n"), /lower-case owner\/repo@/);
  assert.match(pinnedReleaseProblems(data({ "bisq-network/bisq@v1.0.0": entry() }), notes()).join("\n"), /full 40-character commit/);
  assert.match(pinnedReleaseProblems({ pins: [] }, notes()).join("\n"), /must hold a pins object/);
  assert.match(pinnedReleaseProblems(data(undefined, { showCheckedAgainst: "no" }), notes()).join("\n"), /showCheckedAgainst must be true or false/);
});

test("an article is checked against a release only through a verified note that pins it", () => {
  const second = `bisq-network/bisq2@${other}`;
  const pins = { [`bisq-network/bisq@${sha}`]: entry(), [second]: entry({ product: "Bisq 2", release: "v2.0.0", tag: "v2.0.0", evidence: "https://api.github.com/repos/bisq-network/bisq2/git/refs/tags/v2.0.0", resolved: { ...entry().resolved, commit: other } }) };
  const both = note({ id: "both", sources: [
    { label: "Bisq 2", url: `https://github.com/bisq-network/bisq2/blob/${other}/a` },
    { label: "Bisq 1", url: `https://github.com/bisq-network/bisq/blob/${sha}/b` },
    { label: "Bisq 1 again", url: `https://github.com/bisq-network/bisq/blob/${sha}/c` },
  ] });
  const review = note({ id: "review", status: "needs-maintainer-review" });
  const elsewhere = note({ id: "elsewhere", source_slugs: ["other"] });
  const noPin = note({ id: "no-pin", sources: [{ label: "Wiki", url: "https://bisq.wiki/index.php?oldid=1" }] });
  const all = notes(both, review, elsewhere, noPin);
  assert.deepEqual(pinnedReleaseProblems(data(pins), all), []);
  // Each distinct release once, in the data file's order, with the checks that pin it.
  assert.deepEqual(checkedAgainst("restore", all, data(pins)), [
    { product: "Bisq 1", release: "v1.0.0", label: "Bisq 1 v1.0.0", checks: ["both"] },
    { product: "Bisq 2", release: "v2.0.0", label: "Bisq 2 v2.0.0", checks: ["both"] },
  ]);
  // A needs-maintainer-review note, a note for another article and a note with no pin give nothing.
  assert.deepEqual(checkedAgainst("restore", notes(review, elsewhere, noPin), data(pins)), []);
  assert.deepEqual(checkedAgainst("missing", all, data(pins)), []);
  assert.deepEqual(checkedAgainst("other", all, data(pins)).map((release) => release.checks), [["elsewhere"]]);
});

test("the repository's evidence gives the chip's releases and the chip is off until decided", () => {
  assert.deepEqual(checkedAgainstFor("restoring-your-wallet-from-seed").map((release) => release.label), ["Bisq 1 v1.10.11"]);
  assert.deepEqual(checkedAgainstFor("bisq-easy").map((release) => release.label), ["Bisq 2 v2.1.15"]);
  assert.deepEqual(checkedAgainstFor("teams"), []);
  assert.equal(typeof showCheckedAgainst(), "boolean");
  assert.equal(showCheckedAgainst(), false, "the chip stays off until the maintainers decide its wording; switch it in src/data/pinned-releases.json and update this test");
});
