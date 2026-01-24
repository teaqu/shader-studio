const { execSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..'); // Go up two levels to project root

console.log('Checking for changes in types and utils...');

try {
  const gitDiff = execSync('git diff --name-only HEAD', {
    cwd: rootDir,
    encoding: 'utf8'
  });
  
  const hasTypesChanges = gitDiff
    .split('\n')
    .filter(line => line.trim())
    .some(file => file.startsWith('types/'));
  
  const hasUtilsChanges = gitDiff
    .split('\n')
    .filter(line => line.trim())
    .some(file => file.startsWith('utils/'));
  
  // Build types if changed
  if (hasTypesChanges) {
    console.log('Building types...');
    execSync('npm run build -w types', {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true
    });
  } else {
    console.log('Skipping types build (no changes)');
  }
  
  // Build utils if changed
  if (hasUtilsChanges) {
    console.log('Building utils...');
    execSync('npm run build -w utils', {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true
    });
  } else {
    console.log('Skipping utils build (no changes)');
  }
  
} catch (error) {
  console.error('Error building types/utils:', error.message);
  process.exit(1);
}
