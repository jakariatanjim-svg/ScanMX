import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const validVersion = /^(0|[1-9]\d*)\.([0-9])$/;

function parseVersion(value) {
  const match = validVersion.exec(value);
  if (!match || BigInt(match[1]) < 1n) return null;
  return { major: BigInt(match[1]), minor: Number(match[2]) };
}

function compareVersions(left, right) {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  return 0;
}

function formatVersion(version) {
  return `${version.major}.${version.minor}`;
}

const tags = execFileSync('git', ['tag', '--list'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((tag) => tag.match(/^v(.+)$/)?.[1])
  .filter(Boolean)
  .map(parseVersion)
  .filter(Boolean)
  .sort(compareVersions);

const highest = tags.at(-1) ?? null;
const requested = process.env.VERSION_OVERRIDE?.trim() ?? '';
let selected;

if (requested) {
  const match = /^(0|[1-9]\d*)(?:\.([0-9]))?$/.exec(requested);
  if (!match || BigInt(match[1]) < 1n) {
    console.log('::error::Invalid version override. Use a positive major such as 3, or MAJOR.MINOR with a minor from 0 to 9, such as 1.4.');
    process.exit(1);
  }

  selected = { major: BigInt(match[1]), minor: Number(match[2] ?? 0) };
  if (highest && compareVersions(selected, highest) < 0) {
    console.log(`::warning::Version override v${formatVersion(selected)} is lower than the highest valid tag v${formatVersion(highest)}.`);
  }
} else if (!highest) {
  selected = { major: 1n, minor: 0 };
} else if (highest.minor < 9) {
  selected = { major: highest.major, minor: highest.minor + 1 };
} else {
  selected = { major: highest.major + 1n, minor: 0 };
}

const version = formatVersion(selected);
const outputs = `version=${version}\ntag=v${version}\n`;

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, outputs);
} else {
  process.stdout.write(outputs);
}
