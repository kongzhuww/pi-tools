#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const packagesDir = path.resolve('packages');
const packages = fs.readdirSync(packagesDir);

console.log('🔍 Checking workspace packages for unreleased versions...');

let publishedCount = 0;

for (const pkgName of packages) {
  const pkgJsonPath = path.join(packagesDir, pkgName, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) continue;

  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const { name, version } = pkgJson;

  try {
    const publishedVersionsRaw = execSync(`npm view ${name} versions --json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const publishedVersions = JSON.parse(publishedVersionsRaw);
    const versionsList = Array.isArray(publishedVersions) ? publishedVersions : [publishedVersions];

    if (versionsList.includes(version)) {
      console.log(`⏩ ${name}@${version} is already published on npm. Skipping.`);
      continue;
    }
  } catch (err) {
    console.log(`✨ ${name} appears to be new or version check failed. Proceeding to publish.`);
  }

  console.log(`🚀 Publishing ${name}@${version}...`);
  try {
    execSync(`npm publish --workspace=packages/${pkgName} --access public`, { stdio: 'inherit' });
    console.log(`✅ Successfully published ${name}@${version}`);
    publishedCount++;
  } catch (err) {
    console.error(`❌ Failed to publish ${name}@${version}`);
    process.exit(1);
  }
}

if (publishedCount === 0) {
  console.log('ℹ️ All packages are already up-to-date on npm.');
} else {
  console.log(`🎉 Successfully published ${publishedCount} package(s).`);
}
