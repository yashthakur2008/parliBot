import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const read = path => existsSync(path) ? readFileSync(path, 'utf8') : '';
const html = read('site/index.html');
const css = read('site/styles.css');
const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const repo = 'https://github.com/yashthakur2008/parliBot';

test('landing page links to the stable release asset, source and issues', () => {
  for (const url of [`${repo}/releases/latest/download/ParliBot-macOS.zip`, repo, `${repo}/issues`]) {
    assert.ok(html.includes(`href="${url}"`), `Missing link: ${url}`);
  }
});
test('download explains platform, prerequisites, installation and signing limits', () => {
  for (const claim of [/Apple Silicon/, /macOS/, /Node\.js 22\+/, /Ollama/, /unzip/i,
    /Install ParliBot\.command/, /~\/Applications\/ParliBot\.app/, /browser-based/i,
    /unsigned/i, /ad-hoc/i, /not notarized/i, /not a signed installer/i]) assert.match(text, claim);
});
test('privacy and practice claims disclose limitations without invented validation', () => {
  for (const claim of [/local-only by default/i, /vendor recognition/i, /explicit opt-in/i,
    /send audio/i, /local helper/i, /typed/i, /no guarantee/i, /verify factual claims/i]) assert.match(text, claim);
  assert.doesNotMatch(text, /microphone.{0,20}(tested|verified)|guaranteed champion|champion-equivalent/i);
});
test('page has accessible landmarks, mobile viewport and local-only assets', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  for (const tag of ['header', 'nav', 'main', 'footer']) assert.match(html, new RegExp(`<${tag}\\b`));
  assert.match(html, /href="#main"/);
  assert.match(html, /id="main"/);
  assert.match(html, /href="\.\/styles\.css"/);
  assert.doesNotMatch(html, /<script\b|<(?:iframe|img)\b|(?:src|href)="(?:https?:)?\/\/(?!github\.com\/)/i);
  assert.doesNotMatch(css, /@import|url\s*\(/i);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(max-width:/);
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`), match[1]);
});
