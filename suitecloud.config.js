const SuiteCloudJestUnitTestRunner = require('@oracle/suitecloud-unit-testing/services/SuiteCloudJestUnitTestRunner');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);

module.exports = {
	defaultProjectFolder: 'src',
	commands: {
		"project:deploy": {
			beforeExecuting: async args => {
				console.log('Preparing deployment...\n');

				// 1. Clean orphaned JavaScript files
				try {
					console.log('Cleaning orphaned JavaScript files...');
					require('./scripts/utils/clean-orphaned-js.js').cleanOrphanedFiles(
						path.join(__dirname, 'src', 'FileCabinet', 'SuiteScripts')
					);
					console.log('Cleanup complete\n');
				} catch (error) {
					console.warn('Cleanup failed:', error.message);
				}

				// 2. Compile TypeScript
				try {
					console.log('Compiling TypeScript...');
					const { stdout, stderr } = await execAsync('tsc');
					if (stderr) {
						console.error('TypeScript compilation warnings/errors:', stderr);
					}
					console.log('TypeScript compilation complete\n');
				} catch (error) {
					console.error('TypeScript compilation failed:', error.message);
					throw error;
				}

				// 3. Run tests
				if (process.env.SKIP_TESTS !== 'true') {
					console.log('Running tests...');
					await SuiteCloudJestUnitTestRunner.run({});
					console.log('Tests passed\n');
				} else {
					console.log('Skipping tests (SKIP_TESTS=true)\n');
				}

				console.log('Ready to deploy!\n');
				return args;
			},
		},
	},
};
