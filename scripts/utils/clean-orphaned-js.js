#!/usr/bin/env node

/**
 * Clean orphaned JavaScript files from FileCabinet/SuiteScripts subdirectories
 *
 * Rules:
 * - PRESERVES all JS files in FileCabinet/SuiteScripts root (native JS files)
 * - Only processes subdirectories (compiled from TypeScript)
 * - Removes JS files that don't have corresponding TS source files
 * - Maintains directory structure consistency
 */

const fs = require('fs');
const path = require('path');

const SUITESCRIPTS_PATH = path.join(__dirname, '..', '..', 'src', 'FileCabinet', 'SuiteScripts');
const TYPESCRIPTS_PATH = path.join(__dirname, '..', '..', 'src', 'TypeScripts');

let removedCount = 0;
let preservedCount = 0;
let checkedCount = 0;

/**
 * Check if a TypeScript source file exists for a JavaScript file
 */
function hasTypeScriptSource(jsFilePath) {
  const relativePath = path.relative(SUITESCRIPTS_PATH, jsFilePath);

  // Skip root-level JS files (native JavaScript)
  if (!relativePath.includes(path.sep)) {
    return null;
  }

  const tsPath = path.join(TYPESCRIPTS_PATH, relativePath.replace(/\.js$/, '.ts'));
  return fs.existsSync(tsPath);
}

/**
 * Recursively clean orphaned JS files
 */
function cleanOrphanedFiles(dirPath, depth = 0) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (depth >= 0) {
        cleanOrphanedFiles(fullPath, depth + 1);
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      checkedCount++;

      const hasSource = hasTypeScriptSource(fullPath);
      const relativePath = path.relative(SUITESCRIPTS_PATH, fullPath);

      if (hasSource === null) {
        preservedCount++;
        if (process.env.VERBOSE) {
          console.log(`  Preserved (native JS): ${relativePath}`);
        }
      } else if (hasSource) {
        preservedCount++;
        if (process.env.VERBOSE) {
          console.log(`  Preserved (has TS): ${relativePath}`);
        }
      } else {
        fs.unlinkSync(fullPath);
        removedCount++;
        console.log(`  Removed (orphaned): ${relativePath}`);
      }
    }
  }

  // Clean up empty directories (but never remove SuiteScripts root)
  if (depth > 0) {
    const remainingEntries = fs.readdirSync(dirPath);
    if (remainingEntries.length === 0) {
      fs.rmdirSync(dirPath);
      console.log(`  Removed empty directory: ${path.relative(SUITESCRIPTS_PATH, dirPath)}`);
    }
  }
}

/**
 * Main execution
 */
function main() {
  console.log('Cleaning orphaned JavaScript files...');
  console.log('   Preserving: Root-level JS files (native JavaScript)');
  console.log('   Checking:   Subdirectory JS files (compiled from TypeScript)\n');

  if (!fs.existsSync(SUITESCRIPTS_PATH)) {
    console.log('SuiteScripts directory not found. Nothing to clean.');
    return;
  }

  if (!fs.existsSync(TYPESCRIPTS_PATH)) {
    console.log('TypeScripts directory not found. Skipping cleanup.');
    return;
  }

  cleanOrphanedFiles(SUITESCRIPTS_PATH);

  console.log('\nSummary:');
  console.log(`   Files checked:   ${checkedCount}`);
  console.log(`   Files preserved: ${preservedCount}`);
  console.log(`   Files removed:   ${removedCount}`);

  if (removedCount === 0) {
    console.log('\nNo orphaned files found.');
  } else {
    console.log(`\nCleaned ${removedCount} orphaned file(s).`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { cleanOrphanedFiles, hasTypeScriptSource };
