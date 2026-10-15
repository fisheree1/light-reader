import { describe, expect, it } from 'vitest';

import {
  findBuildOutputIssues,
  requiredLazyChunks,
} from './check-build-output.mjs';

const loaderChunks = requiredLazyChunks.map((chunk) => ({
  name: `${chunk}-AbCd1234.js`,
  content: 'export{}',
}));

describe('findBuildOutputIssues', () => {
  it('accepts output with all format loaders and relative chunk imports', () => {
    expect(
      findBuildOutputIssues([
        ...loaderChunks,
        { name: 'view-AbCd1234.js', content: 'import(`./mobi-AbCd1234.js`)' },
      ]),
    ).toEqual([]);
  });

  it('rejects dynamic imports into node_modules or absolute local paths', () => {
    for (const content of [
      'await import(`../node_modules/.pnpm/foliate-js/mobi.js`)',
      "import('/Users/dev/project/src/x.js')",
      'import("/home/ci/work/x.js")',
      "import('C:\\\\work\\\\x.js')",
    ]) {
      expect(
        findBuildOutputIssues([
          ...loaderChunks,
          { name: 'view-AbCd1234.js', content },
        ]),
      ).toEqual(['view-AbCd1234.js imports a path on the build machine']);
    }
  });

  it('reports each missing format loader chunk', () => {
    expect(
      findBuildOutputIssues(
        loaderChunks.filter((asset) => !asset.name.startsWith('mobi-')),
      ),
    ).toEqual(['missing lazy chunk for Foliate "mobi" loader']);
  });
});
