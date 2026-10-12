// Converts the Vite single-file build into the shape the Artifact tool publishes:
// no doctype/html/head/body wrappers (the publisher adds its own skeleton),
// with <title> first, then stylesheets and styles, then the body content, then scripts.
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const src = 'dist/index.html';
const out = 'dist/artifact.html';
const html = readFileSync(src, 'utf8');

const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);
const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html);
const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
if (!headMatch || !bodyMatch) throw new Error('Unexpected build output: missing head or body');
const head = headMatch[1];
let body = bodyMatch[1];

const title = /<title>[\s\S]*?<\/title>/i.exec(head)?.[0];
if (!title) throw new Error('The page needs a <title>');
const links = pick(/<link\b[^>]*>/gi).filter((l) => !/rel=["']?modulepreload/i.test(l));
const styles = [...head.matchAll(/<style\b[\s\S]*?<\/style>/gi)].map((m) => m[0]);
const headScripts = [...head.matchAll(/<script\b[\s\S]*?<\/script>/gi)].map((m) => m[0]);

const parts = [title, ...links, ...styles, body.trim(), ...headScripts];
const result = parts.join('\n');
writeFileSync(out, result);

const kb = (statSync(out).size / 1024).toFixed(1);
if (statSync(out).size > 16 * 1024 * 1024) throw new Error(`Page is ${kb} KB, over the 16 MB limit`);
console.log(`Wrote ${out} (${kb} KB)`);
