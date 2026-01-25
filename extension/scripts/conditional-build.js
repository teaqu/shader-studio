const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const workspace = process.argv[2];
const rootDir = path.resolve(__dirname, '..', '..'); // Go up two levels to project root
const workspaceDir = path.join(rootDir, workspace);

console.log(`Checking for changes in ${workspace}...`);

try {
  const gitDiff = execSync('git diff --name-only HEAD', {
    cwd: rootDir,
    encoding: 'utf8'
  });
  
  const hasChanges = gitDiff
    .split('\n')
    .filter(line => line.trim())
    .some(file => file.startsWith(`${workspace}/`));
  
  if (hasChanges) {
    console.log(`Building ${workspace}...`);
    
    // Read the package.json to get the build script
    const packageJsonPath = path.join(workspaceDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    if (!packageJson.scripts.build) {
      console.error(`No build script found in ${workspace}/package.json`);
      process.exit(1);
    }
    
    // Execute the build script directly, replacing vite with npx vite
    let buildScript = packageJson.scripts.build;
    buildScript = buildScript.replace(/\bvite\b/g, 'npx vite');
    
    execSync(buildScript, {
      cwd: workspaceDir,
      stdio: 'inherit',
      shell: true
    });
    
    // Check for copy-to-extension script
    if (['ui', 'config-ui', 'shader-explorer', 'electron'].includes(workspace)) {
      let copyScript = packageJson.scripts['copy-to-extension'];
      if (copyScript) {
        // Check if target directories already exist
        const targetDir = path.join(rootDir, 'extension', `${workspace}-dist`);
        const sourceDir = path.join(workspaceDir, 'dist');
        
        let shouldCopy = true;
        if (fs.existsSync(targetDir) && fs.existsSync(sourceDir)) {
          // Compare modification times - only copy if source is newer
          const targetStats = fs.statSync(targetDir);
          const sourceStats = fs.statSync(sourceDir);
          
          if (sourceStats.mtime <= targetStats.mtime) {
            console.log(`Skipping copy-to-extension (target folder is up to date)`);
            shouldCopy = false;
          }
        }
        
        if (shouldCopy) {
          copyScript = copyScript.replace(/\bvite\b/g, 'npx vite');
          copyScript = copyScript.replace(/\bcpx\b/g, 'npx cpx');
          copyScript = copyScript.replace(/\brimraf\b/g, 'npx rimraf');
          
          execSync(copyScript, {
            cwd: workspaceDir,
            stdio: 'inherit',
            shell: true
          });
        }
      }
    }
  } else {
    console.log(`Skipping ${workspace} build (no changes)`);
  }
} catch (error) {
  console.error(`Error building ${workspace}:`, error.message);
  process.exit(1);
}
