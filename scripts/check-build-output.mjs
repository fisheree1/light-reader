import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Foliate loaders that must ship because the product imports these formats. */
export const requiredLazyChunks = ['mobi', 'fb2', 'comic-book', 'fflate'];

const buildMachinePath =
  /\bimport\(\s*[`'"][^`'"]*(?:node_modules\/|\/Users\/|\/home\/|[A-Za-z]:\\\\)/;

/**
 * Finds production-build problems that bundle size checks cannot see:
 * dynamic imports that point into the build machine's file system, and
 * missing lazy chunks for supported book formats.
 *
 * @param {{ name: string; content: string }[]} assets
 * @returns {string[]}
 */
export function findBuildOutputIssues(assets) {
  const issues = [];
  for (const asset of assets) {
    if (asset.name.endsWith('.js') && buildMachinePath.test(asset.content)) {
      issues.push(`${asset.name} imports a path on the build machine`);
    }
  }
  for (const chunk of requiredLazyChunks) {
    const pattern = new RegExp(`^${chunk}-[\\w-]{8}\\.js$`);
    if (!assets.some((asset) => pattern.test(asset.name))) {
      issues.push(`missing lazy chunk for Foliate "${chunk}" loader`);
    }
  }
  return issues;
}

async function main() {
  const directory = new URL('../dist/assets/', import.meta.url);
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    throw new Error('dist/assets is missing; run pnpm build before checking.', {
      cause: error,
    });
  }
  const assets = await Promise.all(
    names.map(async (name) => ({
      name,
      content: name.endsWith('.js')
        ? await readFile(new URL(name, directory), 'utf8')
        : '',
    })),
  );
  const issues = findBuildOutputIssues(assets);
  if (issues.length) {
    console.error(`Build output check failed:\n- ${issues.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Build output check passed: ${String(assets.length)} assets.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
