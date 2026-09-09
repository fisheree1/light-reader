import { readFile } from 'node:fs/promises';

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error(
    'Release tag must use semantic version form, for example v0.1.0.',
  );
}

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const tauriConfig = JSON.parse(
  await readFile(
    new URL('../src-tauri/tauri.conf.json', import.meta.url),
    'utf8',
  ),
);
const cargoToml = await readFile(
  new URL('../src-tauri/Cargo.toml', import.meta.url),
  'utf8',
);
const cargoVersion = cargoToml.match(
  /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
)?.[1];
const expected = tag.slice(1);
const versions = {
  'package.json': packageJson.version,
  'src-tauri/Cargo.toml': cargoVersion,
  'src-tauri/tauri.conf.json': tauriConfig.version,
};
const mismatches = Object.entries(versions).filter(
  ([, version]) => version !== expected,
);

if (mismatches.length > 0) {
  throw new Error(
    `Release ${tag} does not match:\n${mismatches
      .map(([file, version]) => `- ${file}: ${String(version)}`)
      .join('\n')}`,
  );
}

console.log(`Release versions match ${tag}.`);
