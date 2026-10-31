import { join } from 'path';
import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { parseProblemHtml } from '../src/extractor';

const ROOT = process.cwd();
const PROBLEMS_DIR = join(ROOT, 'data', 'problems');

const INITIAL_PROBLEMS = [
  'braze-find-lowest-price',
  'uber-first-unique-ip-hitting-server',
  'amazon-first-non-repeating-character',
  'amazon-root-to-leaf-target-sum-paths',
  'google-horse-genetic-relatedness',
  'amazon-reorganize-string',
  'amazon-container-with-most-water',
  'amazon-trapping-rain-water',
  'amazon-course-schedule',
  'amazon-merge-intervals'
];

async function precache() {
  console.log(`Pre-caching ${INITIAL_PROBLEMS.length} popular OA problems...`);
  for (const id of INITIAL_PROBLEMS) {
    const dest = join(PROBLEMS_DIR, `${id}.json`);
    try {
      const url = `https://www.fastprep.io/problems/${id}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.ok) {
        const html = await res.text();
        const parsed = parseProblemHtml(id, html);
        await writeFile(dest, JSON.stringify(parsed, null, 2), 'utf-8');
        console.log(`Cached: ${id} (${parsed.title}) - ${parsed.testCases.length} test cases`);
      } else {
        console.log(`Failed to fetch ${id}: HTTP ${res.status}`);
      }
    } catch (err: any) {
      console.log(`Error caching ${id}:`, err.message);
    }
  }
  console.log('Pre-caching complete.');
}

precache();
