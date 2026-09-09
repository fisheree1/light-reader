import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const assetsDirectory = new URL('../dist/assets/', import.meta.url);
const budgetFile = new URL('../config/bundle-budgets.json', import.meta.url);

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KiB`;
}

function assertWithinBudget(label, actual, maximum, failures) {
  if (actual <= maximum) return;
  failures.push(
    `${label} is ${formatBytes(actual)}; budget is ${formatBytes(maximum)}`,
  );
}

let fileNames;
try {
  fileNames = await readdir(assetsDirectory);
} catch (error) {
  throw new Error('dist/assets is missing; run pnpm build before checking.', {
    cause: error,
  });
}

const budget = JSON.parse(await readFile(budgetFile, 'utf8'));
const assets = await Promise.all(
  fileNames.map(async (name) => {
    const content = await readFile(new URL(name, assetsDirectory));
    return {
      name,
      bytes: content.byteLength,
      gzipBytes: gzipSync(content).byteLength,
    };
  }),
);
const failures = [];
const total = assets.reduce(
  (sum, asset) => ({
    bytes: sum.bytes + asset.bytes,
    gzipBytes: sum.gzipBytes + asset.gzipBytes,
  }),
  { bytes: 0, gzipBytes: 0 },
);

assertWithinBudget(
  'all production assets',
  total.bytes,
  budget.total.maxBytes,
  failures,
);
assertWithinBudget(
  'all production assets (gzip)',
  total.gzipBytes,
  budget.total.maxGzipBytes,
  failures,
);

for (const rule of budget.assets) {
  const pattern = new RegExp(rule.pattern);
  const matches = assets.filter((asset) => pattern.test(asset.name));
  if (matches.length !== 1) {
    failures.push(
      `${rule.name} expected one matching asset, found ${String(matches.length)}`,
    );
    continue;
  }
  const [asset] = matches;
  assertWithinBudget(rule.name, asset.bytes, rule.maxBytes, failures);
  assertWithinBudget(
    `${rule.name} (gzip)`,
    asset.gzipBytes,
    rule.maxGzipBytes,
    failures,
  );
}

if (failures.length > 0) {
  console.error(`Bundle budget failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(
    `Bundle budget passed: ${formatBytes(total.bytes)} raw, ${formatBytes(total.gzipBytes)} gzip.`,
  );
}
