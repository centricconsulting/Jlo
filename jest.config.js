const SuiteCloudJestConfiguration = require("@oracle/suitecloud-unit-testing/jest-configuration/SuiteCloudJestConfiguration");
const cliConfig = require("./suitecloud.config");

const baseConfig = SuiteCloudJestConfiguration.build({
	projectFolder: cliConfig.defaultProjectFolder,
	projectType: SuiteCloudJestConfiguration.ProjectType.ACP,
	verbose: true,
});

module.exports = {
	...baseConfig,
	projects: [
		{
			displayName: 'unit',
			testMatch: ['<rootDir>/__tests__/**/*.test.js'],
			testPathIgnorePatterns: ['/node_modules/', '/scenarios/'],
			...baseConfig,
			coverageDirectory: 'coverage/unit'
		},
		{
			displayName: 'scenarios',
			testMatch: ['<rootDir>/__tests__/**/scenarios/**/*.test.js'],
			...baseConfig,
			coverageThreshold: {}
		}
	],
	collectCoverageFrom: [
		'src/FileCabinet/SuiteScripts/**/*.js',
		'!src/FileCabinet/SuiteScripts/*.js'
	],
	coveragePathIgnorePatterns: [
		'/node_modules/',
		'/__tests__/',
	],
	reporters: [
		'default',
		['jest-junit', { outputDirectory: 'reports', outputName: 'junit.xml' }]
	]
};
