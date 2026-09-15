/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 */

/*
 * ============================================================================
 * SuiteQL Query Tool
 * ============================================================================
 *
 * A modern utility for running SuiteQL queries in NetSuite.
 *
 * Version: 2026.1
 *
 * License: MIT
 * Copyright (c) 2021-2026 Timothy Dietrich
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * ============================================================================
 * Developer
 * ============================================================================
 *
 * Tim Dietrich
 * - Email: timdietrich@me.com
 * - Web: https://timdietrich.me
 *
 * ============================================================================
 * History
 * ============================================================================
 *
 * For detailed version history, see documentation/changelog.html
 *
 * 2026.1 Highlights:
 * - Complete UI modernization with SQL Studio-inspired design
 * - AI-powered query generation, validation, and optimization
 * - Schema Explorer with ERD generation and multi-format export
 * - Plugin architecture for extensibility
 * - Data visualization with Chart.js
 * - Google Sheets export, Document Generator, and more
 *
 * ============================================================================
 */

// =============================================================================
// SECTION 1: CONFIGURATION
// =============================================================================

/**
 * Application configuration settings.
 * Modify these values to customize the tool's behavior.
 */
const CONFIG = Object.freeze({
    /** Application version */
    VERSION: '2026.1',

    /** Enable DataTables for enhanced table functionality */
    DATATABLES_ENABLED: true,

    /** Enable access to the remote query library */
    REMOTE_LIBRARY_ENABLED: true,

    /** Default number of rows to return */
    ROWS_RETURNED_DEFAULT: 100,

    /** File Cabinet folder ID for local query library (null = disabled) */
    QUERY_FOLDER_ID: null,

    /** Enable NetSuite Workbooks integration */
    WORKBOOKS_ENABLED: false,

    /** Maximum query history entries to store */
    MAX_HISTORY_ENTRIES: 50,

    /** Slow query threshold in milliseconds - shows optimization banner when exceeded */
    SLOW_QUERY_THRESHOLD_MS: 3000,

    /** Remote library base URL */
    REMOTE_LIBRARY_URL: 'https://suiteql.s3.us-east-1.amazonaws.com/queries/',

    /**
     * Enable AI-powered features throughout the application.
     * When disabled, hides all AI-related UI elements including:
     * - AI Query Generator (chat modal)
     * - Natural Language Query Bar
     * - Explain Query feature
     * - Validate Query feature
     * - Query optimization suggestions
     * - AI features in Tables Reference (AI Find, Ask AI, Generate Query)
     *
     * Default: true (enabled)
     */
    AI_ENABLED: true,

    /**
     * Allow users to ask AI about query results.
     *
     * IMPORTANT: Enable this option only after careful consideration of the following risks:
     * - Query results containing sensitive or confidential business data will be sent to
     *   external AI services (Anthropic or OpenAI) for processing.
     * - Data transmitted may include customer information, financial figures, employee
     *   details, or other proprietary information depending on the queries executed.
     * - While these AI providers have data handling policies, transmitted data leaves
     *   your organization's direct control.
     * - Consider your organization's data governance policies and any regulatory
     *   requirements (GDPR, HIPAA, SOC2, etc.) before enabling this feature.
     *
     * Default: false (disabled)
     */
    AI_RESULTS_CHAT_ENABLED: false,

    /**
     * Plugin Configuration
     *
     * File Cabinet folder ID containing plugin files.
     * Plugins are JavaScript files with a specific structure that extend the tool's functionality.
     * Set to null to disable the plugin system.
     *
     * Default: null (disabled)
     */
    PLUGIN_FOLDER_ID: null
});

// =============================================================================
// SECTION 2: NETSUITE MODULE DEFINITION
// =============================================================================

/** @type {Object} NetSuite module references */
let modules = {};

define([
    'N/file',
    'N/https',
    'N/log',
    'N/query',
    'N/record',
    'N/render',
    'N/runtime',
    'N/ui/serverWidget',
    'N/url',
    'N/encode'
], (file, https, log, query, record, render, runtime, serverWidget, url, encode) => {

    // Store module references
    modules = { file, https, log, query, record, render, runtime, serverWidget, url, encode };

    return {
        /**
         * Main entry point for the Suitelet.
         * @param {Object} context - The request/response context
         */
        onRequest: (context) => {
            const scriptUrl = modules.url.resolveScript({
                scriptId: modules.runtime.getCurrentScript().id,
                deploymentId: modules.runtime.getCurrentScript().deploymentId,
                returnExternalURL: false
            });

            if (context.request.method === 'POST') {
                handlePostRequest(context, scriptUrl);
            } else {
                handleGetRequest(context, scriptUrl);
            }
        }
    };
});

// =============================================================================
// SECTION 2B: PLUGIN LOADING
// =============================================================================

/**
 * Module-level storage for loaded plugins.
 * Populated by loadPlugins() and used throughout the application.
 */
let loadedPlugins = [];

/**
 * Loads plugins from the configured File Cabinet folder.
 * Plugins are JavaScript files with a specific structure defining:
 * - name: Unique identifier
 * - version: Plugin version string
 * - minAppVersion: Minimum SQT version required
 * - dependencies: Array of plugin names this plugin depends on
 * - disables: Array of built-in features to disable
 * - server: Server-side hooks and handlers
 * - client: Client-side code and hooks
 * - ui: UI injection content for various injection points
 * - settings: Optional settings schema for user configuration
 *
 * @returns {Array} Array of validated plugin objects
 */
function loadPlugins() {
    // Return cached plugins if already loaded
    if (loadedPlugins.length > 0) {
        return loadedPlugins;
    }

    // Check if plugin system is enabled
    if (!CONFIG.PLUGIN_FOLDER_ID) {
        return [];
    }

    const plugins = [];

    try {
        // Search for plugin files in the configured folder
        const folderSearch = modules.query.runSuiteQL({
            query: `
                SELECT id, name, filetype
                FROM file
                WHERE folder = ?
                AND (name LIKE '%.sqt-plugin.js' OR name LIKE '%.sqt-plugin.json')
            `,
            params: [CONFIG.PLUGIN_FOLDER_ID]
        }).asMappedResults();

        // Load and parse each plugin file
        for (const fileRecord of folderSearch) {
            try {
                const pluginFile = modules.file.load({ id: fileRecord.id });
                const pluginContent = pluginFile.getContents();

                // Parse plugin definition
                let pluginDef;
                if (fileRecord.name.endsWith('.json')) {
                    pluginDef = JSON.parse(pluginContent);
                } else {
                    // For .js files, evaluate the plugin definition
                    // Plugin files should export an object via: (function() { return { ... }; })()
                    pluginDef = eval('(' + pluginContent + ')');
                }

                // Validate required fields
                if (!pluginDef.name || !pluginDef.version) {
                    modules.log.error({
                        title: 'Invalid Plugin',
                        details: 'Plugin missing required name or version: ' + fileRecord.name
                    });
                    continue;
                }

                // Check version compatibility
                if (!validatePluginCompatibility(pluginDef)) {
                    modules.log.audit({
                        title: 'Plugin Incompatible',
                        details: 'Plugin ' + pluginDef.name + ' requires app version ' + pluginDef.minAppVersion
                    });
                    continue;
                }

                // Add file metadata
                pluginDef._fileId = fileRecord.id;
                pluginDef._fileName = fileRecord.name;
                pluginDef._loadedAt = new Date().toISOString();

                plugins.push(pluginDef);

                modules.log.audit({
                    title: 'Plugin Loaded',
                    details: pluginDef.name + ' v' + pluginDef.version
                });

            } catch (e) {
                modules.log.error({
                    title: 'Plugin Load Error',
                    details: 'Failed to load ' + fileRecord.name + ': ' + e.message
                });
            }
        }

        // Sort plugins by dependencies
        loadedPlugins = sortPluginsByDependencies(plugins);

    } catch (e) {
        modules.log.error({
            title: 'Plugin System Error',
            details: e.message
        });
    }

    return loadedPlugins;
}

/**
 * Sorts plugins by their dependencies using topological sort.
 * Ensures plugins are initialized in the correct order.
 *
 * @param {Array} plugins - Array of plugin objects
 * @returns {Array} Sorted array of plugins
 */
function sortPluginsByDependencies(plugins) {
    const sorted = [];
    const visited = new Set();
    const visiting = new Set();
    const pluginMap = {};

    // Build lookup map
    plugins.forEach(p => { pluginMap[p.name] = p; });

    function visit(plugin) {
        if (visited.has(plugin.name)) return true;
        if (visiting.has(plugin.name)) {
            modules.log.error({
                title: 'Plugin Dependency Cycle',
                details: 'Circular dependency detected for: ' + plugin.name
            });
            return false;
        }

        visiting.add(plugin.name);

        // Visit dependencies first
        const deps = plugin.dependencies || [];
        for (const depName of deps) {
            const dep = pluginMap[depName];
            if (!dep) {
                modules.log.error({
                    title: 'Missing Plugin Dependency',
                    details: plugin.name + ' requires ' + depName + ' which is not loaded'
                });
                return false;
            }
            if (!visit(dep)) return false;
        }

        visiting.delete(plugin.name);
        visited.add(plugin.name);
        sorted.push(plugin);
        return true;
    }

    // Visit all plugins
    for (const plugin of plugins) {
        if (!visited.has(plugin.name)) {
            visit(plugin);
        }
    }

    return sorted;
}

/**
 * Validates that a plugin is compatible with the current app version.
 *
 * @param {Object} plugin - Plugin object with minAppVersion property
 * @returns {boolean} True if compatible
 */
function validatePluginCompatibility(plugin) {
    if (!plugin.minAppVersion) {
        return true; // No version requirement
    }

    // Parse version strings (format: YYYY.MM or YYYY.MM.patch)
    const parseVersion = (v) => {
        const parts = String(v).split('.');
        return {
            year: parseInt(parts[0]) || 0,
            month: parseInt(parts[1]) || 0,
            patch: parseInt(parts[2]) || 0
        };
    };

    const current = parseVersion(CONFIG.VERSION);
    const required = parseVersion(plugin.minAppVersion);

    // Compare year first, then month, then patch
    if (current.year > required.year) return true;
    if (current.year < required.year) return false;
    if (current.month > required.month) return true;
    if (current.month < required.month) return false;
    return current.patch >= required.patch;
}

/**
 * Invokes server-side hooks for all loaded plugins.
 *
 * @param {string} hookName - Name of the hook (onBeforeQuery, onAfterQuery, onError)
 * @param {Object} data - Data to pass to hook functions
 * @param {Array} plugins - Array of plugin objects
 * @returns {Object} Potentially modified data object
 */
function invokeServerHooks(hookName, data, plugins) {
    let result = data;

    for (const plugin of plugins) {
        if (plugin.server && plugin.server.hooks && typeof plugin.server.hooks[hookName] === 'function') {
            try {
                const hookResult = plugin.server.hooks[hookName](result, plugin);
                if (hookResult !== undefined) {
                    result = hookResult;
                }
            } catch (e) {
                modules.log.error({
                    title: 'Plugin Hook Error',
                    details: 'Plugin ' + plugin.name + ' hook ' + hookName + ' failed: ' + e.message
                });
            }
        }
    }

    return result;
}

/**
 * Gets server-side handlers from all loaded plugins.
 *
 * @param {Array} plugins - Array of plugin objects
 * @returns {Object} Map of handler names to handler functions
 */
function getPluginServerHandlers(plugins) {
    const handlers = {};

    for (const plugin of plugins) {
        if (plugin.server && plugin.server.handlers) {
            for (const [name, handler] of Object.entries(plugin.server.handlers)) {
                // Prefix handler name with plugin name to avoid conflicts
                const handlerName = 'plugin_' + plugin.name + '_' + name;
                handlers[handlerName] = (context, payload) => {
                    try {
                        return handler(context, payload, modules, plugin);
                    } catch (e) {
                        modules.log.error({
                            title: 'Plugin Handler Error',
                            details: 'Plugin ' + plugin.name + ' handler ' + name + ' failed: ' + e.message
                        });
                        context.response.write(JSON.stringify({
                            error: { message: 'Plugin handler error: ' + e.message }
                        }));
                    }
                };
            }
        }
    }

    return handlers;
}

// =============================================================================
// SECTION 3: REQUEST HANDLERS
// =============================================================================

/**
 * Handles GET requests - renders the main UI or specific views.
 * @param {Object} context - The request/response context
 * @param {string} scriptUrl - The script URL for AJAX calls
 */
function handleGetRequest(context, scriptUrl) {
    const params = context.request.parameters;

    if (params.function === 'tablesReference') {
        renderTablesReference(context, scriptUrl);
        return;
    }

    if (params.function === 'schemaExplorer') {
        renderSchemaExplorer(context, scriptUrl);
        return;
    }

    if (params.function === 'documentGenerate') {
        generateDocument(context);
        return;
    }

    // Render main application
    const form = modules.serverWidget.createForm({
        title: 'SuiteQL Query Tool',
        hideNavBar: false
    });

    const htmlField = form.addField({
        id: 'custpage_field_html',
        type: modules.serverWidget.FieldType.INLINEHTML,
        label: 'HTML'
    });

    htmlField.defaultValue = generateMainHtml(scriptUrl);
    context.response.writePage(form);
}

/**
 * Handles POST requests - API endpoints for AJAX calls.
 * @param {Object} context - The request/response context
 * @param {string} scriptUrl - The script URL
 */
function handlePostRequest(context, scriptUrl) {
    const requestPayload = JSON.parse(context.request.body);
    context.response.setHeader('Content-Type', 'application/json');

    // Load plugins and get plugin handlers
    const plugins = loadPlugins();
    const pluginHandlers = getPluginServerHandlers(plugins);

    // Built-in handlers
    const handlers = {
        'queryExecute': () => executeQuery(context, requestPayload, plugins),
        'documentSubmit': () => submitDocument(context, requestPayload),
        'sqlFileExists': () => checkSqlFileExists(context, requestPayload),
        'sqlFileLoad': () => loadSqlFile(context, requestPayload),
        'sqlFileSave': () => saveSqlFile(context, requestPayload),
        'localLibraryFilesGet': () => getLocalLibraryFiles(context),
        'workbookLoad': () => loadWorkbook(context, requestPayload),
        'workbooksGet': () => getWorkbooks(context),
        'aiGenerateQuery': () => generateAIQuery(context, requestPayload),
        // Airtable handlers
        'airtableListTables': () => listAirtableTables(context, requestPayload),
        'airtableCreateTable': () => createAirtableTable(context, requestPayload),
        'airtableCreateRecords': () => createAirtableRecords(context, requestPayload),
        'googleSheetsGetToken': () => getGoogleSheetsToken(context, requestPayload),
        'googleSheetsCreateSpreadsheet': () => createGoogleSpreadsheet(context, requestPayload),
        'googleSheetsAppendData': () => appendToGoogleSheet(context, requestPayload),
        // Plugin settings handler
        'pluginSettingsSave': () => savePluginSettings(context, requestPayload),
        'pluginSettingsLoad': () => loadPluginSettings(context, requestPayload),
        // Merge plugin handlers
        ...pluginHandlers
    };

    const handler = handlers[requestPayload.function];

    if (handler) {
        handler();
    } else {
        modules.log.error({
            title: 'Unknown Function',
            details: requestPayload.function
        });
        context.response.write(JSON.stringify({ error: 'Unknown function' }));
    }
}

// =============================================================================
// SECTION 4: QUERY EXECUTION
// =============================================================================

/**
 * Executes a SuiteQL query and returns results.
 * @param {Object} context - The request/response context
 * @param {Object} payload - The request payload containing query details
 * @param {Array} plugins - Array of loaded plugins for hook invocation
 */
function executeQuery(context, payload, plugins) {
    let responsePayload;
    plugins = plugins || [];

    try {
        const beginTime = Date.now();
        let records = [];
        let sqlToExecute = payload.query + '\n';

        // Process virtual views if enabled
        if (payload.viewsEnabled && CONFIG.QUERY_FOLDER_ID) {
            sqlToExecute = processVirtualViews(sqlToExecute);
        }

        // Plugin hook: onBeforeQuery
        // Allows plugins to modify the query or payload before execution
        const beforeQueryData = invokeServerHooks('onBeforeQuery', {
            query: sqlToExecute,
            payload: payload,
            originalQuery: payload.query
        }, plugins);

        // Use potentially modified query from plugin
        if (beforeQueryData && beforeQueryData.query) {
            sqlToExecute = beforeQueryData.query;
        }

        if (payload.paginationEnabled) {
            records = executePaginatedQuery(sqlToExecute, payload.rowBegin, payload.rowEnd);
        } else {
            records = modules.query.runSuiteQL({
                query: sqlToExecute,
                params: []
            }).asMappedResults();
        }

        const elapsedTime = Date.now() - beginTime;

        responsePayload = {
            records,
            elapsedTime,
            rowCount: records.length
        };

        // Get total count if requested
        if (payload.returnTotals && records.length > 0) {
            const countSql = `SELECT COUNT(*) AS TotalRecordCount FROM (${sqlToExecute})`;
            const countResult = modules.query.runSuiteQL({
                query: countSql,
                params: []
            }).asMappedResults();
            responsePayload.totalRecordCount = countResult[0]?.totalrecordcount || 0;
        }

        // Plugin hook: onAfterQuery
        // Allows plugins to process or modify results after execution
        const afterQueryData = invokeServerHooks('onAfterQuery', {
            query: sqlToExecute,
            payload: payload,
            response: responsePayload
        }, plugins);

        // Use potentially modified response from plugin
        if (afterQueryData && afterQueryData.response) {
            responsePayload = afterQueryData.response;
        }

    } catch (e) {
        modules.log.error({ title: 'Query Execution Error', details: e });
        responsePayload = { error: { message: e.message, name: e.name } };

        // Plugin hook: onError
        // Allows plugins to handle or log errors
        invokeServerHooks('onError', {
            query: payload.query,
            payload: payload,
            error: e
        }, plugins);
    }

    context.response.write(JSON.stringify(responsePayload, null, 2));
}

/**
 * Executes a paginated query with ROWNUM support.
 * @param {string} sql - The SQL query
 * @param {number} rowBegin - Starting row number
 * @param {number} rowEnd - Ending row number
 * @returns {Array} Query results
 */
function executePaginatedQuery(sql, rowBegin, rowEnd) {
    let records = [];
    let moreRecords = true;
    let currentBegin = rowBegin;

    while (moreRecords) {
        const paginatedSql = `
            SELECT * FROM (
                SELECT ROWNUM AS ROWNUMBER, * FROM (${sql})
            ) WHERE ROWNUMBER BETWEEN ${currentBegin} AND ${rowEnd}
        `;

        const results = modules.query.runSuiteQL({
            query: paginatedSql,
            params: []
        }).asMappedResults();

        records = records.concat(results);

        if (results.length < 5000) {
            moreRecords = false;
        }

        currentBegin += 5000;
    }

    return records;
}

/**
 * Processes virtual view references in SQL.
 * @param {string} sql - The SQL with potential view references
 * @returns {string} Processed SQL with views expanded
 */
function processVirtualViews(sql) {
    const viewPattern = /(?:^|\s)#(\w+)\b/gi;
    const views = sql.match(viewPattern);

    if (!views || views.length === 0) {
        return sql;
    }

    let processedSql = sql;

    for (const view of views) {
        const cleanView = view.replace(/\s+/g, '');
        const viewFileName = cleanView.substring(1) + '.sql';

        const fileSql = 'SELECT ID FROM File WHERE Folder = ? AND Name = ?';
        const files = modules.query.runSuiteQL({
            query: fileSql,
            params: [CONFIG.QUERY_FOLDER_ID, viewFileName]
        }).asMappedResults();

        if (files.length === 1) {
            const fileObj = modules.file.load({ id: files[0].id });
            const viewSql = fileObj.getContents();
            processedSql = processedSql.replace(
                cleanView,
                `(${viewSql}) AS ${cleanView.substring(1)}`
            );
        } else {
            throw new Error(`Unresolved view: ${viewFileName}`);
        }
    }

    return processedSql;
}

// =============================================================================
// SECTION 5: FILE OPERATIONS
// =============================================================================

/**
 * Gets list of SQL files from local library.
 * @param {Object} context - The request/response context
 */
function getLocalLibraryFiles(context) {
    try {
        if (!CONFIG.QUERY_FOLDER_ID) {
            context.response.write(JSON.stringify({
                error: 'Local library not configured (QUERY_FOLDER_ID is not set)'
            }));
            return;
        }

        const sql = `
            SELECT ID, Name, Description
            FROM File
            WHERE Folder = ?
            ORDER BY Name
        `;

        const records = modules.query.runSuiteQL({
            query: sql,
            params: [CONFIG.QUERY_FOLDER_ID]
        }).asMappedResults();

        const response = records.length > 0
            ? { records }
            : { error: 'No SQL Files' };

        context.response.write(JSON.stringify(response, null, 2));
    } catch (e) {
        modules.log.error({ title: 'Get Local Library Files Error', details: e });
        context.response.write(JSON.stringify({ error: e.message }));
    }
}

/**
 * Checks if a SQL file exists in the local library.
 * @param {Object} context - The request/response context
 * @param {Object} payload - The request payload
 */
function checkSqlFileExists(context, payload) {
    try {
        if (!CONFIG.QUERY_FOLDER_ID) {
            context.response.write(JSON.stringify({
                error: 'Local library not configured (QUERY_FOLDER_ID is not set)'
            }));
            return;
        }

        const sql = `
            SELECT ID FROM File
            WHERE Folder = ? AND Name = ?
        `;

        const records = modules.query.runSuiteQL({
            query: sql,
            params: [CONFIG.QUERY_FOLDER_ID, payload.filename]
        }).asMappedResults();

        context.response.write(JSON.stringify({
            exists: records.length > 0
        }));
    } catch (e) {
        modules.log.error({ title: 'Check SQL File Exists Error', details: e });
        context.response.write(JSON.stringify({ error: e.message }));
    }
}

/**
 * Loads a SQL file from the file cabinet.
 * @param {Object} context - The request/response context
 * @param {Object} payload - The request payload
 */
function loadSqlFile(context, payload) {
    try {
        const fileObj = modules.file.load({ id: payload.fileID });

        context.response.write(JSON.stringify({
            file: {
                id: fileObj.id,
                name: fileObj.name,
                description: fileObj.description
            },
            sql: fileObj.getContents()
        }));
    } catch (e) {
        modules.log.error({ title: 'Load SQL File Error', details: e });
        context.response.write(JSON.stringify({ error: e.message }));
    }
}

/**
 * Saves a SQL file to the file cabinet.
 * @param {Object} context - The request/response context
 * @param {Object} payload - The request payload
 */
function saveSqlFile(context, payload) {
    try {
        if (!CONFIG.QUERY_FOLDER_ID) {
            context.response.write(JSON.stringify({
                error: 'Local library not configured (QUERY_FOLDER_ID is not set)'
            }));
            return;
        }

        const fileObj = modules.file.create({
            name: payload.filename,
            contents: payload.contents,
            description: payload.description,
            fileType: modules.file.Type.PLAINTEXT,
            folder: CONFIG.QUERY_FOLDER_ID,
            isOnline: false
        });

        const fileId = fileObj.save();

        context.response.write(JSON.stringify({ fileID: fileId }));
    } catch (e) {
        modules.log.error({ title: 'Save SQL File Error', details: e });
        context.response.write(JSON.stringify({ error: e.message }));
    }
}

/**
 * Saves plugin settings for a specific plugin.
 * Settings are stored in a JSON file in the plugin folder.
 * @param {Object} context - The request/response context
 * @param {Object} payload - Contains pluginName and settings object
 */
function savePluginSettings(context, payload) {
    try {
        if (!CONFIG.PLUGIN_FOLDER_ID) {
            context.response.write(JSON.stringify({
                error: 'Plugin system not configured'
            }));
            return;
        }

        const settingsFileName = payload.pluginName + '.settings.json';
        const settingsContent = JSON.stringify(payload.settings, null, 2);

        // Check if settings file already exists
        const existingFile = modules.query.runSuiteQL({
            query: 'SELECT id FROM file WHERE folder = ? AND name = ?',
            params: [CONFIG.PLUGIN_FOLDER_ID, settingsFileName]
        }).asMappedResults();

        let fileId;
        if (existingFile.length > 0) {
            // Delete old file and create new one
            modules.file.delete({ id: existingFile[0].id });
        }

        // Create new file
        const fileObj = modules.file.create({
            name: settingsFileName,
            contents: settingsContent,
            fileType: modules.file.Type.JSON,
            folder: CONFIG.PLUGIN_FOLDER_ID
        });
        fileId = fileObj.save();

        context.response.write(JSON.stringify({ success: true, fileId: fileId }));
    } catch (e) {
        modules.log.error({ title: 'Save Plugin Settings Error', details: e });
        context.response.write(JSON.stringify({ error: e.message }));
    }
}

/**
 * Loads plugin settings for a specific plugin.
 * @param {Object} context - The request/response context
 * @param {Object} payload - Contains pluginName
 */
function loadPluginSettings(context, payload) {
    try {
        if (!CONFIG.PLUGIN_FOLDER_ID) {
            context.response.write(JSON.stringify({ settings: null }));
            return;
        }

        const settingsFileName = payload.pluginName + '.settings.json';

        // Find settings file
        const fileSearch = modules.query.runSuiteQL({
            query: 'SELECT id FROM file WHERE folder = ? AND name = ?',
            params: [CONFIG.PLUGIN_FOLDER_ID, settingsFileName]
        }).asMappedResults();

        if (fileSearch.length === 0) {
            context.response.write(JSON.stringify({ settings: null }));
            return;
        }

        const file = modules.file.load({ id: fileSearch[0].id });
        const settings = JSON.parse(file.getContents());

        context.response.write(JSON.stringify({ settings: settings }));
    } catch (e) {
        modules.log.error({ title: 'Load Plugin Settings Error', details: e });
        context.response.write(JSON.stringify({ settings: null, error: e.message }));
    }
}

// =============================================================================
// SECTION 6: WORKBOOKS
// =============================================================================

/**
 * Gets list of available workbooks.
 * @param {Object} context - The request/response context
 */
function getWorkbooks(context) {
    const sql = `
        SELECT ScriptID, Name, Description, BUILTIN.DF(Owner) AS Owner
        FROM UsrSavedSearch
        ORDER BY Name
    `;

    const records = modules.query.runSuiteQL({
        query: sql,
        params: []
    }).asMappedResults();

    const response = records.length > 0
        ? { records }
        : { error: 'No Workbooks' };

    context.response.write(JSON.stringify(response, null, 2));
}

/**
 * Loads a workbook and converts to SuiteQL.
 * @param {Object} context - The request/response context
 * @param {Object} payload - The request payload
 */
function loadWorkbook(context, payload) {
    try {
        const loadedQuery = modules.query.load({ id: payload.scriptID });

        context.response.write(JSON.stringify({
            sql: loadedQuery.toSuiteQL().query
        }));
    } catch (e) {
        modules.log.error({ title: 'Load Workbook Error', details: e });
        context.response.write(JSON.stringify({ error: e.message }));
    }
}

// =============================================================================
// SECTION 6.5: AI QUERY GENERATION
// =============================================================================

/**
 * System prompt optimized for SuiteQL generation.
 * This is hardcoded and not user-customizable.
 */
const AI_SYSTEM_PROMPT = `You are a SuiteQL expert assistant for NetSuite. Your role is to help users write SuiteQL queries.

SuiteQL Key Points:
- SuiteQL is NetSuite's SQL-like query language based on Oracle SQL syntax
- Tables use internal IDs (e.g., "Transaction", "Customer", "Employee", "Item")
- Use BUILTIN.DF() function to get display values for reference fields: BUILTIN.DF(fieldname)
- Common joins: Transaction to TransactionLine, Customer to Transaction, Employee to Department
- Date functions: TO_DATE(), TO_CHAR(), ADD_MONTHS(), TRUNC()
- String functions: UPPER(), LOWER(), SUBSTR(), INSTR(), NVL()
- Use NVL(field, default) for null handling
- ROWNUM for limiting results (no LIMIT keyword)
- Use single quotes for string literals
- Boolean fields use 'T' and 'F' values

Common Table Names:
- Transaction (sales orders, invoices, etc.) with type field for filtering
- TransactionLine for line items
- Customer, Vendor, Employee, Partner
- Item, InventoryItem, ServiceItem, NonInventoryItem
- Account, Department, Location, Subsidiary, Classification
- EntityAddress for addresses
- File for file cabinet files

When generating queries:
1. Always include relevant fields the user would need
2. Use meaningful aliases for complex expressions
3. Add ORDER BY when it makes sense
4. Include comments explaining complex logic
5. Format queries for readability

If the user's request is unclear, ask clarifying questions.
If you generate a query, wrap it in a SQL code block using triple backticks with 'sql' language identifier.

Example response format:
\`\`\`sql
SELECT
    Customer.entityid AS customer_id,
    Customer.companyname,
    BUILTIN.DF(Customer.salesrep) AS sales_rep
FROM Customer
WHERE Customer.isinactive = 'F'
ORDER BY Customer.companyname
\`\`\``;

/**
 * System prompt for table-related AI queries in the Tables Reference.
 * Optimized for helping users understand NetSuite tables and find the right tables.
 */
const AI_TABLE_SYSTEM_PROMPT = `You are a NetSuite SuiteQL tables expert. Your role is to help users understand NetSuite database tables and find the right tables for their needs.

NetSuite Database Knowledge:
- NetSuite has hundreds of tables accessible via SuiteQL
- Tables use internal IDs (e.g., "Transaction", "Customer", "Employee")
- BUILTIN.DF() returns display values for foreign key fields
- Common transaction types are filtered via the "type" field in the Transaction table
- Many tables support joins through foreign key relationships

Common Table Categories:
1. **Core Entities**: Customer, Vendor, Employee, Partner, Contact, Lead, Prospect
2. **Transactions**: Transaction (header), TransactionLine (lines), TransactionAccountingLine
3. **Items**: Item, InventoryItem, ServiceItem, NonInventoryItem, AssemblyItem, KitItem
4. **Accounting**: Account, AccountingPeriod, Currency, ExchangeRate
5. **Organization**: Subsidiary, Department, Location, Classification
6. **CRM**: Opportunity, Case (supportcase), Campaign, PhoneCall, Task, Event
7. **Addresses**: EntityAddress, TransactionAddress
8. **Files**: File, Folder
9. **Users/Roles**: Employee, Role, SystemNote
10. **Custom**: Custom records use format customrecord_*

Transaction Type Values (for Transaction.type):
- SalesOrd (Sales Order), Invoice (Invoice), CustInvc (Customer Invoice)
- PurchOrd (Purchase Order), VendBill (Vendor Bill)
- CashSale, CustPymt (Customer Payment), VendPymt (Vendor Payment)
- Journal, Check, Deposit, Transfer
- ItemRcpt (Item Receipt), ItemShip (Item Fulfillment)
- RtnAuth (Return Authorization), CustCred (Credit Memo)

Key Relationships:
- Transaction → TransactionLine: Transaction.id = TransactionLine.transaction
- Transaction → Customer: Transaction.entity = Customer.id
- TransactionLine → Item: TransactionLine.item = Item.id
- Customer → EntityAddress: Through Customer.defaultbillingaddress/defaultshippingaddress
- Employee → Department: Employee.department = Department.id

Important Columns by Table:
- **Customer**: id, entityid, companyname, email, phone, salesrep, terms, creditlimit, isinactive
- **Transaction**: id, tranid, type, entity, trandate, status, total, subsidiary, postingperiod
- **TransactionLine**: id, transaction, linesequencenumber, item, quantity, amount, rate
- **Item**: id, itemid, displayname, baseprice, itemtype, isinactive
- **Employee**: id, entityid, firstname, lastname, email, department, location, supervisor

When helping users:
1. If asked about a specific table, explain its purpose and common use cases
2. If asked to find tables, suggest multiple relevant options with explanations
3. If generating queries, use proper joins and include helpful comments
4. Format SQL in code blocks with the 'sql' language identifier
5. Explain why certain columns or joins are important
6. Mention BUILTIN.DF() when reference fields would benefit from display values

When suggesting tables for a user's needs:
- Consider what data they're trying to access
- Suggest primary tables AND related tables they might need
- Explain how tables connect via joins`;

/**
 * System prompt for FreeMarker template generation for NetSuite Advanced PDF/HTML templates.
 * Used by the Document Generator AI feature.
 */
const AI_TEMPLATE_SYSTEM_PROMPT = `You are an expert at creating NetSuite Advanced PDF/HTML templates using FreeMarker. Your role is to generate professional document templates based on user descriptions.

CRITICAL: NetSuite uses an OLD version of FreeMarker with the BFO PDF renderer. Many modern FreeMarker features DO NOT WORK. Follow these rules exactly.

## Template Structure
\`\`\`xml
<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
    <head>
        <style type="text/css">
            /* CSS styles here */
        </style>
    </head>
    <body>
        <!-- Content here -->
    </body>
</pdf>
\`\`\`

## FreeMarker Syntax That WORKS in NetSuite
- Variables: \${row.fieldname!""}  (ALWAYS use !"" for null safety)
- Lists: <#list results.records as row>...</#list>  (NOTE: use .records!)
- Conditionals: <#if condition>...<#elseif condition>...<#else>...</#if>
- Assignments: <#assign varName = value>
- Check if has value: <#if row.fieldname?has_content>
- String length: \${row.fieldname?length}
- Upper/lower case: \${row.fieldname?upper_case} \${row.fieldname?lower_case}
- Record count: \${results.count} (NOT ?size - data source is an object)
- Loop index: \${row?index} (0-based) or \${row?counter} (1-based)
- Current date: \${.now?string["MM/dd/yyyy"]}

## Things That DO NOT WORK in NetSuite (NEVER USE THESE)
- ?string.currency (use manual formatting instead)
- ?string["#,##0.00"] on numbers (format manually)
- ?item_parity (use ?index % 2 instead)
- ?then() ternary operator (use <#if> instead)
- ?date, ?datetime on strings (SuiteQL returns dates as strings already)
- ?number on already-numeric values
- ?switch() function
- transform CSS property
- :hover, :nth-child(), :first-child CSS selectors
- flexbox or grid CSS
- position: fixed (limited support)

## CORRECT Patterns for NetSuite

### Iterating with alternating row colors:
\`\`\`xml
<#list results.records as row>
    <#if row?index % 2 == 0>
        <tr style="background-color: #ffffff;">
    <#else>
        <tr style="background-color: #f5f5f5;">
    </#if>
        <td>\${row.fieldname!""}</td>
    </tr>
</#list>
\`\`\`

### Conditional display (NOT using ?then):
\`\`\`xml
<#if row.status?has_content && row.status == "Active">
    <span style="color: green;">Active</span>
<#else>
    <span style="color: red;">Inactive</span>
</#if>
\`\`\`

### Number formatting (manual):
\`\`\`xml
<#-- For currency, just output the value - it comes formatted from SuiteQL -->
\${row.amount!"0.00"}

<#-- Or use assign for calculations -->
<#assign total = 0>
<#list results.records as row>
    <#if row.amount?has_content>
        <#assign total = total + row.amount?number>
    </#if>
</#list>
Total: \${total}
\`\`\`

### Date display (dates from SuiteQL are already strings):
\`\`\`xml
<#-- Just output directly - SuiteQL dates are already formatted strings -->
\${row.trandate!""}

<#-- For current date/time -->
\${.now?string["MM/dd/yyyy"]}
\`\`\`

### Checking for true/false (NetSuite uses 'T' and 'F' strings):
\`\`\`xml
<#list results.records as row>
    <#if row.isinactive?has_content && row.isinactive == "T">
        <span>Inactive</span>
    <#else>
        <span>Active</span>
    </#if>
</#list>
\`\`\`

## CSS That Works in BFO PDF Renderer
SUPPORTED:
- font-family, font-size, font-weight, font-style
- color, background-color
- text-align, vertical-align
- padding, margin (use pt units)
- border, border-collapse
- width, height (use % or pt)
- page-break-before, page-break-after
- line-height

NOT SUPPORTED:
- flexbox, grid
- transform, transition
- :hover, :nth-child, :first-child
- position: fixed (limited)
- box-shadow, border-radius (limited)

## Response Format
1. Wrap template in \`\`\`xml code block
2. Use ONLY the FreeMarker syntax that works in NetSuite (listed above)
3. ALWAYS use null-safe operators: \${field!""}
4. For booleans, check for "T" or "F" strings, not true/false
5. Keep CSS simple - tables for layout, basic styling only

## Data Source Structure (CRITICAL)
Each data source is passed as an OBJECT with these properties:
- alias.records - Array of record objects (USE THIS IN #list)
- alias.columns - Array of column names
- alias.count - Number of records

CORRECT way to iterate:
\`\`\`xml
<#list results.records as row>
    <td>\${row.fieldname!""}</td>
</#list>
\`\`\`

WRONG (will show nothing):
\`\`\`xml
<#list results as row>  <#-- WRONG - results is an object, not an array -->
\`\`\`

To get record count: \${results.count} (NOT \${results?size})
To loop through column names: <#list results.columns as col>\${col}</#list>

The user will provide data source aliases and column names.
- Use the exact alias name with .records: <#list alias.records as row>
- Use exact column names as row.columnname
- All values should use !"" for null safety`;

/**
 * Generates a query using AI API (Anthropic or OpenAI).
 * @param {Object} context - The request/response context
 * @param {Object} payload - The request payload containing:
 *   - provider: 'anthropic' or 'openai'
 *   - apiKey: The API key
 *   - model: The model to use
 *   - messages: Array of conversation messages
 *   - mode: 'query' (default) or 'tables' for table reference assistance
 */
// Module-level variable to store debug info (needed because SuiteScript may not preserve custom Error properties)
let lastAPIDebugInfo = null;

function generateAIQuery(context, payload) {
    let responsePayload;
    lastAPIDebugInfo = null; // Reset at start of each request

    // Check if AI features are enabled
    if (!CONFIG.AI_ENABLED) {
        context.response.write(JSON.stringify({
            success: false,
            error: { message: 'AI features are disabled in this deployment.' }
        }));
        return;
    }

    try {
        const { provider, apiKey, model, messages, mode, customBaseUrl } = payload;

        if (!provider || !apiKey || !model || !messages) {
            throw new Error('Missing required parameters: provider, apiKey, model, or messages');
        }

        // Select system prompt based on mode
        let systemPrompt;
        if (mode === 'tables') {
            systemPrompt = AI_TABLE_SYSTEM_PROMPT;
        } else if (mode === 'template') {
            systemPrompt = AI_TEMPLATE_SYSTEM_PROMPT;
        } else {
            systemPrompt = AI_SYSTEM_PROMPT;
        }

        let aiResponse;

        if (provider === 'anthropic') {
            aiResponse = callAnthropicAPI(apiKey, model, messages, systemPrompt);
        } else if (provider === 'openai') {
            aiResponse = callOpenAIAPI(apiKey, model, messages, systemPrompt);
        } else if (provider === 'openai-compatible') {
            // OpenAI-compatible API with custom base URL
            if (!customBaseUrl) {
                throw new Error('Custom base URL is required for OpenAI-compatible provider');
            }
            aiResponse = callOpenAIAPI(apiKey, model, messages, systemPrompt, customBaseUrl);
        } else if (provider === 'xai') {
            aiResponse = callXAIAPI(apiKey, model, messages, systemPrompt);
        } else if (provider === 'gemini') {
            aiResponse = callGeminiAPI(apiKey, model, messages, systemPrompt);
        } else if (provider === 'mistral') {
            aiResponse = callMistralAPI(apiKey, model, messages, systemPrompt);
        } else if (provider === 'cohere') {
            aiResponse = callCohereAPI(apiKey, model, messages, systemPrompt);
        } else {
            throw new Error(`Unsupported provider: ${provider}`);
        }

        responsePayload = {
            success: true,
            response: aiResponse.content,
            usage: aiResponse.usage
        };

    } catch (e) {
        modules.log.error({ title: 'AI Query Generation Error', details: e });

        // Parse specific error types for better user feedback
        let errorMessage = e.message;
        let errorType = 'error';

        if (e.message.includes('401') || e.message.includes('invalid_api_key') || e.message.includes('Unauthorized')) {
            errorMessage = 'Invalid API key. Please check your API key in settings.';
            errorType = 'auth_error';
        } else if (e.message.includes('429') || e.message.includes('rate_limit')) {
            errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
            errorType = 'rate_limit';
        } else if (e.message.includes('500') || e.message.includes('502') || e.message.includes('503')) {
            errorMessage = 'AI service is temporarily unavailable. Please try again later.';
            errorType = 'service_error';
        }

        responsePayload = {
            error: {
                message: errorMessage,
                type: errorType,
                details: e.message,
                debugInfo: lastAPIDebugInfo || e.debugInfo || null
            }
        };
    }

    context.response.write(JSON.stringify(responsePayload, null, 2));
}

/**
 * Calls the Anthropic Claude API.
 * @param {string} apiKey - The Anthropic API key
 * @param {string} model - The model ID
 * @param {Array} messages - Array of conversation messages
 * @param {string} systemPrompt - The system prompt to use
 * @returns {Object} Response with content and usage
 */
function callAnthropicAPI(apiKey, model, messages, systemPrompt) {
    const requestBody = {
        model: model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages.map(m => ({
            role: m.role,
            content: m.content
        }))
    };

    const response = modules.https.post({
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(requestBody)
    });

    const responseBody = JSON.parse(response.body);

    if (response.code !== 200) {
        throw new Error(responseBody.error?.message || `Anthropic API error: ${response.code}`);
    }

    return {
        content: responseBody.content[0].text,
        usage: responseBody.usage
    };
}

/**
 * Calls the OpenAI API (or OpenAI-compatible API).
 * @param {string} apiKey - The API key
 * @param {string} model - The model ID
 * @param {Array} messages - Array of conversation messages
 * @param {string} systemPrompt - The system prompt to use
 * @param {string} [customBaseUrl] - Optional custom base URL for OpenAI-compatible APIs
 * @returns {Object} Response with content and usage
 */
function callOpenAIAPI(apiKey, model, messages, systemPrompt, customBaseUrl) {
    // Prepend system message for OpenAI
    const openAIMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({
            role: m.role,
            content: m.content
        }))
    ];

    const requestBody = {
        model: model,
        max_tokens: 4096,
        messages: openAIMessages
    };

    // Use custom base URL if provided, otherwise default to OpenAI
    let baseUrl = customBaseUrl || 'https://api.openai.com/v1';
    // Ensure base URL doesn't end with a slash
    if (baseUrl.endsWith('/')) {
        baseUrl = baseUrl.slice(0, -1);
    }
    const url = baseUrl + '/chat/completions';

    const response = modules.https.post({
        url: url,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    const responseBody = JSON.parse(response.body);

    if (response.code !== 200) {
        throw new Error(responseBody.error?.message || `API error: ${response.code}`);
    }

    return {
        content: responseBody.choices[0].message.content,
        usage: responseBody.usage
    };
}

/**
 * Calls the xAI API (Grok models).
 * @param {string} apiKey - The xAI API key
 * @param {string} model - The model ID
 * @param {Array} messages - Array of conversation messages
 * @param {string} systemPrompt - The system prompt to use
 * @returns {Object} Response with content and usage
 */
function callXAIAPI(apiKey, model, messages, systemPrompt) {
    // xAI uses OpenAI-compatible format
    const xaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({
            role: m.role,
            content: m.content
        }))
    ];

    const requestBody = {
        model: model,
        max_tokens: 4096,
        messages: xaiMessages
    };

    const url = 'https://api.x.ai/v1/chat/completions';
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    const response = modules.https.post({
        url: url,
        headers: headers,
        body: JSON.stringify(requestBody)
    });

    let responseBody;
    try {
        responseBody = JSON.parse(response.body);
    } catch (e) {
        responseBody = { raw: response.body };
    }

    if (response.code !== 200) {
        // Store debug info in module-level variable (SuiteScript may not preserve custom Error properties)
        lastAPIDebugInfo = {
            provider: 'xai',
            url: url,
            headers: { ...headers, 'Authorization': 'Bearer [REDACTED]' },
            requestBody: requestBody,
            responseCode: response.code,
            responseBody: responseBody
        };
        throw new Error(responseBody.error?.message || `xAI API error: ${response.code}`);
    }

    return {
        content: responseBody.choices[0].message.content,
        usage: responseBody.usage
    };
}

/**
 * Calls the Google Gemini API.
 * @param {string} apiKey - The Google AI API key
 * @param {string} model - The model ID
 * @param {Array} messages - Array of conversation messages
 * @param {string} systemPrompt - The system prompt to use
 * @returns {Object} Response with content and usage
 */
function callGeminiAPI(apiKey, model, messages, systemPrompt) {
    // Gemini uses OpenAI-compatible format
    const geminiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({
            role: m.role,
            content: m.content
        }))
    ];

    const requestBody = {
        model: model,
        max_tokens: 4096,
        messages: geminiMessages
    };

    const url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    const response = modules.https.post({
        url: url,
        headers: headers,
        body: JSON.stringify(requestBody)
    });

    let responseBody;
    try {
        responseBody = JSON.parse(response.body);
    } catch (e) {
        responseBody = { raw: response.body };
    }

    if (response.code !== 200) {
        // Store debug info in module-level variable (SuiteScript may not preserve custom Error properties)
        lastAPIDebugInfo = {
            provider: 'gemini',
            url: url,
            headers: { ...headers, 'Authorization': 'Bearer [REDACTED]' },
            requestBody: requestBody,
            responseCode: response.code,
            responseBody: responseBody
        };
        throw new Error(responseBody.error?.message || `Gemini API error: ${response.code}`);
    }

    return {
        content: responseBody.choices[0].message.content,
        usage: responseBody.usage
    };
}

/**
 * Calls the Mistral AI API.
 * @param {string} apiKey - The Mistral API key
 * @param {string} model - The model ID
 * @param {Array} messages - Array of conversation messages
 * @param {string} systemPrompt - The system prompt to use
 * @returns {Object} Response with content and usage
 */
function callMistralAPI(apiKey, model, messages, systemPrompt) {
    // Mistral uses OpenAI-compatible format
    const mistralMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({
            role: m.role,
            content: m.content
        }))
    ];

    const requestBody = {
        model: model,
        max_tokens: 4096,
        messages: mistralMessages
    };

    const url = 'https://api.mistral.ai/v1/chat/completions';
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    const response = modules.https.post({
        url: url,
        headers: headers,
        body: JSON.stringify(requestBody)
    });

    let responseBody;
    try {
        responseBody = JSON.parse(response.body);
    } catch (e) {
        responseBody = { raw: response.body };
    }

    if (response.code !== 200) {
        // Store debug info in module-level variable (SuiteScript may not preserve custom Error properties)
        lastAPIDebugInfo = {
            provider: 'mistral',
            url: url,
            headers: { ...headers, 'Authorization': 'Bearer [REDACTED]' },
            requestBody: requestBody,
            responseCode: response.code,
            responseBody: responseBody
        };
        throw new Error(responseBody.error?.message || `Mistral API error: ${response.code}`);
    }

    return {
        content: responseBody.choices[0].message.content,
        usage: responseBody.usage
    };
}

/**
 * Calls the Cohere API.
 * @param {string} apiKey - The Cohere API key
 * @param {string} model - The model ID
 * @param {Array} messages - Array of conversation messages
 * @param {string} systemPrompt - The system prompt to use
 * @returns {Object} Response with content and usage
 */
function callCohereAPI(apiKey, model, messages, systemPrompt) {
    // Prepend system message for Cohere (same format as OpenAI)
    const cohereMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({
            role: m.role,
            content: m.content
        }))
    ];

    const requestBody = {
        model: model,
        messages: cohereMessages
    };

    const response = modules.https.post({
        url: 'https://api.cohere.ai/v2/chat',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    const responseBody = JSON.parse(response.body);

    if (response.code !== 200) {
        throw new Error(responseBody.message || `Cohere API error: ${response.code}`);
    }

    return {
        content: responseBody.message.content[0].text,
        usage: responseBody.usage
    };
}

// =============================================================================
// SECTION 6B: AIRTABLE INTEGRATION
// =============================================================================

// Debug info storage for Airtable API calls
let lastAirtableDebugInfo = null;

/**
 * Makes a request to the Airtable API.
 * @param {string} method - HTTP method (GET, POST)
 * @param {string} endpoint - API endpoint path
 * @param {string} apiToken - Airtable Personal Access Token
 * @param {Object} body - Request body (for POST requests)
 * @returns {Object} Parsed response body
 */
function callAirtableAPI(method, endpoint, apiToken, body = null) {
    const url = 'https://api.airtable.com/v0' + endpoint;
    const headers = {
        'Authorization': 'Bearer ' + apiToken,
        'Content-Type': 'application/json'
    };

    let response;
    try {
        if (method === 'GET') {
            response = modules.https.get({ url, headers });
        } else {
            response = modules.https.post({
                url,
                headers,
                body: body ? JSON.stringify(body) : null
            });
        }
    } catch (e) {
        lastAirtableDebugInfo = {
            provider: 'airtable',
            url: url,
            headers: { ...headers, 'Authorization': 'Bearer [REDACTED]' },
            requestBody: body,
            error: e.message
        };
        throw e;
    }

    let responseBody;
    try {
        responseBody = JSON.parse(response.body);
    } catch (e) {
        responseBody = { raw: response.body };
    }

    // Store debug info
    lastAirtableDebugInfo = {
        provider: 'airtable',
        url: url,
        headers: { ...headers, 'Authorization': 'Bearer [REDACTED]' },
        requestBody: body,
        responseCode: response.code,
        responseBody: responseBody
    };

    if (response.code !== 200) {
        const errorMessage = responseBody.error?.message || responseBody.error?.type || 'Airtable API error: ' + response.code;
        throw new Error(errorMessage);
    }

    return responseBody;
}

/**
 * Lists all tables in an Airtable base.
 * @param {Object} context - The request/response context
 * @param {Object} payload - Contains apiToken and baseId
 */
function listAirtableTables(context, payload) {
    let responsePayload;

    try {
        const { apiToken, baseId } = payload;

        if (!apiToken || !baseId) {
            throw new Error('Missing required parameters: apiToken and baseId');
        }

        const result = callAirtableAPI('GET', '/meta/bases/' + baseId + '/tables', apiToken);

        responsePayload = {
            success: true,
            tables: result.tables.map(t => ({
                id: t.id,
                name: t.name,
                fields: t.fields ? t.fields.map(f => ({
                    id: f.id,
                    name: f.name,
                    type: f.type
                })) : []
            }))
        };
    } catch (e) {
        modules.log.error({ title: 'Airtable List Tables Error', details: e });

        let errorMessage = e.message;
        let errorType = 'error';

        // Categorize errors
        if (e.message.includes('401') || e.message.includes('INVALID_API_KEY') || e.message.includes('AUTHENTICATION_REQUIRED')) {
            errorMessage = 'Invalid API token. Please check your Airtable settings.';
            errorType = 'auth_error';
        } else if (e.message.includes('403') || e.message.includes('INVALID_PERMISSIONS')) {
            errorMessage = 'Access denied. Ensure your token has schema.bases:read scope.';
            errorType = 'auth_error';
        } else if (e.message.includes('404') || e.message.includes('NOT_FOUND')) {
            errorMessage = 'Base not found. Please check the Base ID.';
            errorType = 'not_found';
        } else if (e.message.includes('429')) {
            errorMessage = 'Rate limit exceeded. Please wait and try again.';
            errorType = 'rate_limit';
        }

        responsePayload = {
            error: {
                message: errorMessage,
                type: errorType,
                debugInfo: lastAirtableDebugInfo
            }
        };
    }

    context.response.write(JSON.stringify(responsePayload, null, 2));
}

/**
 * Creates a new table in an Airtable base.
 * @param {Object} context - The request/response context
 * @param {Object} payload - Contains apiToken, baseId, tableName, and fields
 */
function createAirtableTable(context, payload) {
    let responsePayload;

    try {
        const { apiToken, baseId, tableName, fields } = payload;

        if (!apiToken || !baseId || !tableName || !fields) {
            throw new Error('Missing required parameters');
        }

        // Airtable requires at least one field, and the first field must be single line text
        // or have a special type. We ensure the first field is valid.
        const airtableFields = fields.map((f, idx) => {
            const field = {
                name: f.name,
                type: f.type || 'singleLineText'
            };

            // Airtable has specific requirements for certain field types
            if (field.type === 'number') {
                field.options = { precision: 8 };
            } else if (field.type === 'checkbox') {
                field.options = { icon: 'check', color: 'greenBright' };
            } else if (field.type === 'date') {
                field.options = { dateFormat: { name: 'iso' } };
            } else if (field.type === 'dateTime') {
                field.options = {
                    dateFormat: { name: 'iso' },
                    timeFormat: { name: '24hour' },
                    timeZone: 'utc'
                };
            }

            return field;
        });

        const requestBody = {
            name: tableName,
            fields: airtableFields
        };

        const result = callAirtableAPI('POST', '/meta/bases/' + baseId + '/tables', apiToken, requestBody);

        responsePayload = {
            success: true,
            tableId: result.id,
            tableName: result.name
        };
    } catch (e) {
        modules.log.error({ title: 'Airtable Create Table Error', details: e });

        let errorMessage = e.message;
        let errorType = 'error';

        if (e.message.includes('401') || e.message.includes('AUTHENTICATION')) {
            errorMessage = 'Invalid API token. Please check your Airtable settings.';
            errorType = 'auth_error';
        } else if (e.message.includes('403') || e.message.includes('INVALID_PERMISSIONS')) {
            errorMessage = 'Access denied. Ensure your token has schema.bases:write scope.';
            errorType = 'auth_error';
        } else if (e.message.includes('DUPLICATE_TABLE_NAME')) {
            errorMessage = 'A table with this name already exists. Please choose a different name.';
            errorType = 'validation_error';
        } else if (e.message.includes('429')) {
            errorMessage = 'Rate limit exceeded. Please wait and try again.';
            errorType = 'rate_limit';
        }

        responsePayload = {
            error: {
                message: errorMessage,
                type: errorType,
                debugInfo: lastAirtableDebugInfo
            }
        };
    }

    context.response.write(JSON.stringify(responsePayload, null, 2));
}

/**
 * Creates records in an Airtable table.
 * @param {Object} context - The request/response context
 * @param {Object} payload - Contains apiToken, baseId, tableId, and records
 */
function createAirtableRecords(context, payload) {
    let responsePayload;

    try {
        const { apiToken, baseId, tableId, records } = payload;

        if (!apiToken || !baseId || !tableId || !records) {
            throw new Error('Missing required parameters');
        }

        // Airtable allows max 10 records per request
        if (records.length > 10) {
            throw new Error('Maximum 10 records per request. Please batch your requests.');
        }

        const requestBody = {
            records: records,
            typecast: true  // Automatically convert values to appropriate types
        };

        const result = callAirtableAPI('POST', '/' + baseId + '/' + tableId, apiToken, requestBody);

        responsePayload = {
            success: true,
            recordsCreated: result.records ? result.records.length : 0,
            records: result.records ? result.records.map(r => ({
                id: r.id,
                createdTime: r.createdTime
            })) : []
        };
    } catch (e) {
        modules.log.error({ title: 'Airtable Create Records Error', details: e });

        let errorMessage = e.message;
        let errorType = 'error';

        if (e.message.includes('401') || e.message.includes('AUTHENTICATION')) {
            errorMessage = 'Invalid API token. Please check your Airtable settings.';
            errorType = 'auth_error';
        } else if (e.message.includes('403') || e.message.includes('INVALID_PERMISSIONS')) {
            errorMessage = 'Access denied. Ensure your token has data.records:write scope.';
            errorType = 'auth_error';
        } else if (e.message.includes('404') || e.message.includes('TABLE_NOT_FOUND') || e.message.includes('NOT_FOUND')) {
            errorMessage = 'Table not found. It may have been deleted.';
            errorType = 'not_found';
        } else if (e.message.includes('INVALID_VALUE_FOR_COLUMN') || e.message.includes('UNKNOWN_FIELD_NAME')) {
            errorMessage = 'Field mismatch: ' + e.message;
            errorType = 'field_mismatch';
        } else if (e.message.includes('429')) {
            errorMessage = 'Rate limit exceeded. The export will resume automatically.';
            errorType = 'rate_limit';
        }

        responsePayload = {
            error: {
                message: errorMessage,
                type: errorType,
                debugInfo: lastAirtableDebugInfo
            }
        };
    }

    context.response.write(JSON.stringify(responsePayload, null, 2));
}

// =============================================================================
// SECTION 6C: GOOGLE SHEETS INTEGRATION
// =============================================================================

let cachedGoogleToken = null;

function base64UrlEncode(str) {
    var base64 = modules.encode.convert({
        string: str,
        inputEncoding: modules.encode.Encoding.UTF_8,
        outputEncoding: modules.encode.Encoding.BASE_64
    });
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeBytes(bytes) {
    // Manual base64 encoding to avoid NetSuite encode module issues with binary data
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    var result = '';
    var i = 0;
    while (i < bytes.length) {
        var b1 = bytes[i++] || 0;
        var b2 = bytes[i++];
        var b3 = bytes[i++];
        result += chars[b1 >> 2];
        result += chars[((b1 & 3) << 4) | ((b2 !== undefined ? b2 : 0) >> 4)];
        if (b2 !== undefined) {
            result += chars[((b2 & 15) << 2) | ((b3 !== undefined ? b3 : 0) >> 6)];
            if (b3 !== undefined) {
                result += chars[b3 & 63];
            }
        }
    }
    return result;
}

function parsePEMPrivateKey(pem) {
    var isPKCS8 = pem.indexOf('BEGIN PRIVATE KEY') !== -1;
    var pemContents = pem
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
        .replace(/-----END RSA PRIVATE KEY-----/g, '')
        .replace(/\s/g, '');

    // Decode Base64 to hex, then parse hex to bytes (avoids UTF-8 corruption of binary data)
    var hexString = modules.encode.convert({
        string: pemContents,
        inputEncoding: modules.encode.Encoding.BASE_64,
        outputEncoding: modules.encode.Encoding.BASE_16
    });

    var bytes = [];
    for (var i = 0; i < hexString.length; i += 2) {
        bytes.push(parseInt(hexString.substr(i, 2), 16));
    }

    var idx = 0;

    function skipTag(expectedTag) {
        if (bytes[idx] !== expectedTag) throw new Error('Expected tag 0x' + expectedTag.toString(16) + ' at ' + idx + ', got 0x' + bytes[idx].toString(16));
        idx++;
        var len = getLength(bytes, idx);
        idx += getLengthBytes(bytes, idx);
        return len;
    }

    function skipSequence() {
        return skipTag(0x30);
    }

    function skipInteger() {
        var len = skipTag(0x02);
        idx += len;
    }

    function skipOctetString() {
        return skipTag(0x04);
    }

    // Outer SEQUENCE
    skipSequence();

    if (isPKCS8) {
        // PKCS#8: version INTEGER, algorithm SEQUENCE, then OCTET STRING containing PKCS#1 key
        skipInteger(); // version
        var algLen = skipSequence(); // algorithm identifier
        idx += algLen; // skip algorithm contents
        skipOctetString(); // octet string wrapper
        skipSequence(); // inner PKCS#1 sequence
    }

    // Now we're at the PKCS#1 RSAPrivateKey contents
    skipInteger(); // version

    // Read n, e, d
    var n = readInteger(bytes, idx);
    idx = n.nextIdx;
    var e = readInteger(bytes, idx);
    idx = e.nextIdx;
    var d = readInteger(bytes, idx);

    return { n: n.value, e: e.value, d: d.value, keyLength: Math.ceil(n.value.toString(16).length / 2) };
}

function getLength(bytes, idx) {
    if (bytes[idx] < 0x80) return bytes[idx];
    var numBytes = bytes[idx] & 0x7f;
    var len = 0;
    for (var i = 0; i < numBytes; i++) {
        len = (len << 8) | bytes[idx + 1 + i];
    }
    return len;
}

function getLengthBytes(bytes, idx) {
    if (bytes[idx] < 0x80) return 1;
    return 1 + (bytes[idx] & 0x7f);
}

function readInteger(bytes, idx) {
    if (bytes[idx] !== 0x02) throw new Error('Expected INTEGER tag at position ' + idx + ', got 0x' + bytes[idx].toString(16));
    idx++;
    var len = getLength(bytes, idx);
    idx += getLengthBytes(bytes, idx);
    var hex = '';
    for (var i = 0; i < len; i++) {
        hex += bytes[idx + i].toString(16).padStart(2, '0');
    }
    if (hex.length === 0) hex = '00';
    if (hex[0] >= '8') hex = '00' + hex;
    return { value: BigInt('0x' + hex), nextIdx: idx + len };
}

function sha256(message) {
    var K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

    var bytes = [];
    for (var i = 0; i < message.length; i++) {
        bytes.push(message.charCodeAt(i));
    }

    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) {
        bytes.push(0x00);
    }

    for (var i = 7; i >= 0; i--) {
        bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
    }

    for (var i = 0; i < bytes.length; i += 64) {
        var W = [];
        for (var t = 0; t < 16; t++) {
            W[t] = (bytes[i + t * 4] << 24) | (bytes[i + t * 4 + 1] << 16) | (bytes[i + t * 4 + 2] << 8) | bytes[i + t * 4 + 3];
        }

        for (var t = 16; t < 64; t++) {
            var s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
            var s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
            W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
        }

        var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

        for (var t = 0; t < 64; t++) {
            var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            var ch = (e & f) ^ (~e & g);
            var temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
            var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            var maj = (a & b) ^ (a & c) ^ (b & c);
            var temp2 = (S0 + maj) >>> 0;

            h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }

        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    var result = [];
    for (var i = 0; i < 8; i++) {
        result.push((H[i] >> 24) & 0xff, (H[i] >> 16) & 0xff, (H[i] >> 8) & 0xff, H[i] & 0xff);
    }
    return result;
}

function rotr(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function modPow(base, exp, mod) {
    var result = BigInt(1);
    base = base % mod;
    while (exp > 0) {
        if (exp % BigInt(2) === BigInt(1)) {
            result = (result * base) % mod;
        }
        exp = exp / BigInt(2);
        base = (base * base) % mod;
    }
    return result;
}

function pkcs1v15Pad(hash, keyLength) {
    var digestInfo = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20];
    var tLen = digestInfo.length + hash.length;
    var psLen = keyLength - tLen - 3;
    if (psLen < 8) throw new Error('Key too short for PKCS#1 v1.5 padding');
    var padded = [0x00, 0x01];
    for (var i = 0; i < psLen; i++) padded.push(0xff);
    padded.push(0x00);
    for (var i = 0; i < digestInfo.length; i++) padded.push(digestInfo[i]);
    for (var i = 0; i < hash.length; i++) padded.push(hash[i]);
    return padded;
}

function signRS256(data, pemKey) {
    var key = parsePEMPrivateKey(pemKey);
    var hash = sha256(data);
    var padded = pkcs1v15Pad(hash, key.keyLength);
    var hex = '';
    for (var i = 0; i < padded.length; i++) {
        hex += padded[i].toString(16).padStart(2, '0');
    }
    var m = BigInt('0x' + hex);
    var s = modPow(m, key.d, key.n);
    var sigHex = s.toString(16);
    while (sigHex.length < key.keyLength * 2) {
        sigHex = '0' + sigHex;
    }
    var sigBytes = [];
    for (var i = 0; i < sigHex.length; i += 2) {
        sigBytes.push(parseInt(sigHex.substr(i, 2), 16));
    }
    return base64UrlEncodeBytes(sigBytes);
}

function createGoogleJWT(serviceAccount) {
    var now = Math.floor(Date.now() / 1000);
    var header = { alg: 'RS256', typ: 'JWT' };
    var payload = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
    };
    var headerB64 = base64UrlEncode(JSON.stringify(header));
    var payloadB64 = base64UrlEncode(JSON.stringify(payload));
    var signatureInput = headerB64 + '.' + payloadB64;
    var signature = signRS256(signatureInput, serviceAccount.private_key);
    return signatureInput + '.' + signature;
}

function getGoogleSheetsToken(context, payload) {
    var serviceAccount = payload.serviceAccount;
    if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) {
        context.response.write(JSON.stringify({ error: 'Invalid service account configuration' }));
        return;
    }

    if (cachedGoogleToken && cachedGoogleToken.email === serviceAccount.client_email && cachedGoogleToken.expiresAt > Date.now() + 300000) {
        context.response.write(JSON.stringify({ accessToken: cachedGoogleToken.accessToken, expiresIn: Math.floor((cachedGoogleToken.expiresAt - Date.now()) / 1000) }));
        return;
    }

    try {
        var jwt = createGoogleJWT(serviceAccount);
        var response = modules.https.post({
            url: 'https://oauth2.googleapis.com/token',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
        });

        var data = JSON.parse(response.body);
        if (data.error) {
            context.response.write(JSON.stringify({ error: data.error_description || data.error }));
            return;
        }

        cachedGoogleToken = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in * 1000), email: serviceAccount.client_email };
        context.response.write(JSON.stringify({ accessToken: data.access_token, expiresIn: data.expires_in }));
    } catch (e) {
        context.response.write(JSON.stringify({ error: e.message }));
    }
}

function createGoogleSpreadsheet(context, payload) {
    var accessToken = payload.accessToken;
    var title = payload.title;
    if (!accessToken || !title) {
        context.response.write(JSON.stringify({ error: 'Missing required parameters' }));
        return;
    }

    try {
        var response = modules.https.post({
            url: 'https://sheets.googleapis.com/v4/spreadsheets',
            headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ properties: { title: title } })
        });

        var data = JSON.parse(response.body);
        if (data.error) {
            var errMsg = data.error.message || data.error.status || JSON.stringify(data.error);
            context.response.write(JSON.stringify({ error: 'Google API: ' + errMsg }));
            return;
        }

        if (!data.spreadsheetId) {
            context.response.write(JSON.stringify({ error: 'No spreadsheetId in response: ' + response.body.substring(0, 200) }));
            return;
        }

        context.response.write(JSON.stringify({ spreadsheetId: data.spreadsheetId, spreadsheetUrl: data.spreadsheetUrl }));
    } catch (e) {
        context.response.write(JSON.stringify({ error: 'Exception: ' + e.message }));
    }
}

function appendToGoogleSheet(context, payload) {
    var accessToken = payload.accessToken;
    var spreadsheetId = payload.spreadsheetId;
    var range = payload.range;
    var values = payload.values;
    if (!accessToken || !spreadsheetId || !values) {
        context.response.write(JSON.stringify({ error: 'Missing required parameters' }));
        return;
    }

    try {
        var targetRange = range || 'Sheet1!A:A';
        var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId + '/values/' + encodeURIComponent(targetRange) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
        var response = modules.https.post({
            url: url,
            headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: values })
        });

        var data = JSON.parse(response.body);
        if (data.error) {
            context.response.write(JSON.stringify({ error: data.error.message }));
            return;
        }

        context.response.write(JSON.stringify({ success: true, updatedRows: data.updates ? data.updates.updatedRows : 0 }));
    } catch (e) {
        context.response.write(JSON.stringify({ error: e.message }));
    }
}

// =============================================================================
// SECTION 7: DOCUMENT GENERATION
// =============================================================================

/**
 * Submits document info to session for generation.
 * @param {Object} context - The request/response context
 * @param {Object} payload - The request payload
 */
function submitDocument(context, payload) {
    try {
        const session = modules.runtime.getCurrentSession();
        session.set({
            name: 'suiteQLDocumentInfo',
            value: JSON.stringify(payload)
        });

        context.response.write(JSON.stringify({ submitted: true }));
    } catch (e) {
        modules.log.error({ title: 'Document Submit Error', details: e });
        context.response.write(JSON.stringify({ error: e.message }));
    }
}

/**
 * Generates a PDF or HTML document from query results.
 * Supports multiple data sources for master-detail and complex reports.
 * @param {Object} context - The request/response context
 */
function generateDocument(context) {
    try {
        const session = modules.runtime.getCurrentSession();
        const docInfo = JSON.parse(session.get({ name: 'suiteQLDocumentInfo' }));

        // Sanitize template - escape lone & characters that aren't valid XML entities
        let template = docInfo.template || '';

        // Log template for debugging (first 500 chars)
        modules.log.debug({
            title: 'Template Before Sanitization',
            details: template.substring(0, 500)
        });

        // Replace & that isn't followed by a valid entity pattern (name + ;)
        // Valid entities: &amp; &lt; &gt; &apos; &quot; or numeric like &#123; or &#x1F;
        if (template) {
            template = template.replace(/&(?!(amp|lt|gt|apos|quot|#[0-9]+|#x[0-9a-fA-F]+);)/g, '&amp;');
        }

        modules.log.debug({
            title: 'Template After Sanitization',
            details: template.substring(0, 500)
        });

        // Create renderer
        const renderer = modules.render.create();

        /**
         * Escapes XML special characters in a string value.
         */
        function escapeXmlValue(value) {
            if (value === null || value === undefined) return '';
            if (typeof value !== 'string') return value;
            return value
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }

        /**
         * Escapes all string values in a records array for XML safety.
         */
        function escapeRecordsForXml(records) {
            return records.map(record => {
                const escaped = {};
                for (const key in record) {
                    escaped[key] = escapeXmlValue(record[key]);
                }
                return escaped;
            });
        }

        // Handle multiple data sources (new format) or single query (legacy format)
        if (docInfo.dataSources && Array.isArray(docInfo.dataSources)) {
            // New multi-data-source format
            for (const ds of docInfo.dataSources) {
                const rawRecords = executePaginatedQuery(
                    ds.query,
                    ds.rowBegin || 1,
                    ds.rowEnd || 1000
                );

                // Escape XML special characters in data values
                const records = escapeRecordsForXml(rawRecords);

                // Extract column names from first record (excluding rownumber)
                const columns = records.length > 0
                    ? Object.keys(records[0]).filter(k => k !== 'rownumber')
                    : [];

                renderer.addCustomDataSource({
                    alias: ds.alias || 'results',
                    format: modules.render.DataSource.OBJECT,
                    data: {
                        records: records,
                        columns: columns,
                        count: records.length
                    }
                });

                modules.log.debug({
                    title: 'Data Source Added',
                    details: `Alias: ${ds.alias}, Records: ${records.length}`
                });
            }
        } else {
            // Legacy single-query format (backwards compatibility)
            const rawRecords = executePaginatedQuery(
                docInfo.query,
                docInfo.rowBegin,
                docInfo.rowEnd
            );

            // Escape XML special characters in data values
            const records = escapeRecordsForXml(rawRecords);

            const columns = records.length > 0
                ? Object.keys(records[0]).filter(k => k !== 'rownumber')
                : [];

            renderer.addCustomDataSource({
                alias: 'results',
                format: modules.render.DataSource.OBJECT,
                data: {
                    records: records,
                    columns: columns,
                    count: records.length
                }
            });
        }

        renderer.templateContent = template;

        if (docInfo.docType === 'pdf') {
            const pdfObj = renderer.renderAsPdf();
            context.response.setHeader('Content-Type', 'application/pdf');
            context.response.write(pdfObj.getContents());
        } else {
            const htmlString = renderer.renderAsString();
            context.response.setHeader('Content-Type', 'text/html');
            context.response.write(htmlString);
        }

    } catch (e) {
        modules.log.error({ title: 'Document Generation Error', details: e });
        context.response.write(`Error: ${e.message}`);
    }
}

// =============================================================================
// SECTION 8: TABLES REFERENCE
// =============================================================================

/**
 * Renders the Tables Reference page.
 * @param {Object} context - The request/response context
 * @param {string} scriptUrl - The script URL
 */
function renderTablesReference(context, scriptUrl) {
    const form = modules.serverWidget.createForm({
        title: 'SuiteQL Tables Reference',
        hideNavBar: false
    });

    const htmlField = form.addField({
        id: 'custpage_field_html',
        type: modules.serverWidget.FieldType.INLINEHTML,
        label: 'HTML'
    });

    htmlField.defaultValue = generateTablesReferenceHtml(scriptUrl);
    context.response.writePage(form);
}

/**
 * Renders the Schema Explorer page.
 * @param {Object} context - The request/response context
 * @param {string} scriptUrl - The script URL
 */
function renderSchemaExplorer(context, scriptUrl) {
    const form = modules.serverWidget.createForm({
        title: 'NetSuite Schema Explorer',
        hideNavBar: false
    });

    const htmlField = form.addField({
        id: 'custpage_field_html',
        type: modules.serverWidget.FieldType.INLINEHTML,
        label: 'HTML'
    });

    htmlField.defaultValue = generateSchemaExplorerHtml(scriptUrl);
    context.response.writePage(form);
}

// =============================================================================
// SECTION 9: HTML GENERATION - MAIN APPLICATION
// =============================================================================

/**
 * Generates the main application HTML.
 * @param {string} scriptUrl - The script URL for AJAX calls
 * @returns {string} Complete HTML for the application
 */
function generateMainHtml(scriptUrl) {
    // Load plugins for UI generation
    const plugins = loadPlugins();

    // Generate the base HTML
    let html = `
        <!DOCTYPE html>
        <html lang="en" data-bs-theme="light">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${generateExternalResources()}
            ${generateStyles()}
            ${generateDisabledFeaturesCSS(plugins)}
        </head>
        <body>
            ${generateMainLayout(scriptUrl)}
            ${generateModals()}
            ${generateClientScript(scriptUrl, plugins)}
            ${generateToastContainer()}
        </body>
        </html>
    `;

    // Inject plugin UI at designated markers
    html = injectPluginUI(html, plugins);

    return html;
}

/**
 * Generates CSS to hide features disabled by plugins.
 * Plugins can specify features to disable in their disables[] array.
 *
 * @param {Array} plugins - Array of loaded plugins
 * @returns {string} Style tag with CSS rules to hide disabled features
 */
function generateDisabledFeaturesCSS(plugins) {
    const disabledFeatures = new Set();

    // Collect all disabled features from plugins
    for (const plugin of plugins) {
        if (Array.isArray(plugin.disables)) {
            plugin.disables.forEach(feature => disabledFeatures.add(feature));
        }
    }

    if (disabledFeatures.size === 0) {
        return '';
    }

    // Map feature names to CSS selectors
    const featureSelectors = {
        'ai': '#toolbarAI, .sqt-nl-bar, [data-feature="ai"]',
        'ai-chat': '[onclick*="showAIModal"]',
        'ai-explain': '[onclick*="explainQuery"]',
        'ai-validate': '[onclick*="validateQuery"]',
        'ai-nlbar': '.sqt-nl-bar',
        'export': '[onclick*="showExportModal"], [onclick*="exportAs"]',
        'export-airtable': '[onclick*="showAirtableExportModal"]',
        'export-google-sheets': '[onclick*="showGoogleSheetsExportModal"]',
        'local-library': '[onclick*="showLocalLibrary"], [onclick*="showSaveModal"]',
        'remote-library': '[onclick*="showRemoteLibrary"]',
        'workbooks': '[onclick*="showWorkbooks"]',
        'tables-reference': '[onclick*="openTablesReference"]',
        'schema-explorer': '[onclick*="openSchemaExplorer"]',
        'doc-generator': '[onclick*="showDocGenModal"]',
        'share': '[onclick*="showShareModal"]',
        'history': '[onclick*="toggleSidebar"], #sidebar',
        'dark-mode': '[onclick*="toggleTheme"]',
        'focus-mode': '[onclick*="toggleFocusMode"]',
        'format': '#toolbarFormat, [onclick*="formatQuery"]',
        'options': '[onclick*="toggleOptions"], #optionsPanel'
    };

    let cssRules = [];
    for (const feature of disabledFeatures) {
        if (featureSelectors[feature]) {
            cssRules.push(featureSelectors[feature] + ' { display: none !important; }');
        }
    }

    if (cssRules.length === 0) {
        return '';
    }

    return '<style id="sqt-disabled-features">\n' + cssRules.join('\n') + '\n</style>';
}

/**
 * Injects plugin UI content at designated marker points in the HTML.
 * Markers are HTML comments in the format: <!-- SQT-PLUGIN:point-name -->
 *
 * @param {string} html - The base HTML string
 * @param {Array} plugins - Array of loaded plugins
 * @returns {string} HTML with plugin UI injected
 */
function injectPluginUI(html, plugins) {
    const injectionPoints = [
        // Toolbar
        'toolbar-start',
        'toolbar-end',
        'more-dropdown',
        'ai-dropdown',
        // Header
        'header-right',
        // Editor
        'before-editor',
        'editor-toolbar',
        'nl-bar',
        // Results
        'results-header',
        'results-footer',
        // Sidebar
        'sidebar-section',
        // Modals
        'export-menu',
        'local-library-actions',
        'modals',
        // Other
        'options-panel',
        'status-bar'
    ];

    for (const point of injectionPoints) {
        const marker = '<!-- SQT-PLUGIN:' + point + ' -->';
        let injectedContent = '';

        for (const plugin of plugins) {
            if (plugin.ui && plugin.ui[point]) {
                // Wrap plugin UI in a container for debugging/styling
                injectedContent += '\n<!-- Plugin: ' + plugin.name + ' -->\n';
                injectedContent += '<div data-sqt-plugin="' + plugin.name + '" data-sqt-injection="' + point + '">';
                injectedContent += plugin.ui[point];
                injectedContent += '</div>\n';
            }
        }

        if (injectedContent) {
            html = html.replace(marker, injectedContent + marker);
        }
    }

    return html;
}

/**
 * Generates external resource links (CSS/JS libraries).
 * @returns {string} HTML for external resources
 */
function generateExternalResources() {
    return `
        <!-- Bootstrap 5.3 -->
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">

        <!-- CodeMirror -->
        <link href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/dracula.min.css" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/eclipse.min.css" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/show-hint.min.css" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/dialog/dialog.min.css" rel="stylesheet">

        <!-- DataTables -->
        <link href="https://cdn.datatables.net/2.0.0/css/dataTables.dataTables.min.css" rel="stylesheet">

        <!-- Scripts -->
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"><\/script>

        <!-- Safari/WebKit fix for MouseEvent.buttons - must load before CodeMirror -->
        <script>
        (function() {
            var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
            if (!isSafari) return;

            // Map to track original listeners to their wrapped versions
            var listenerMap = new WeakMap();

            // Patch addEventListener to fix buttons property on mouse events
            var originalAddEventListener = EventTarget.prototype.addEventListener;
            EventTarget.prototype.addEventListener = function(type, listener, options) {
                if (type === 'mousemove' || type === 'mouseup' || type === 'mousedown') {
                    var wrappedListener = function(e) {
                        if (e.buttons === 0 && e.which > 0 && e.type !== 'mouseup') {
                            Object.defineProperty(e, 'buttons', {
                                get: function() {
                                    if (e.which === 1) return 1;
                                    if (e.which === 2) return 4;
                                    if (e.which === 3) return 2;
                                    return 0;
                                }
                            });
                        }
                        return listener.call(this, e);
                    };
                    // Store mapping from original to wrapped listener (per element and type)
                    if (!listenerMap.has(this)) {
                        listenerMap.set(this, {});
                    }
                    var elementMap = listenerMap.get(this);
                    if (!elementMap[type]) {
                        elementMap[type] = new Map();
                    }
                    elementMap[type].set(listener, wrappedListener);
                    return originalAddEventListener.call(this, type, wrappedListener, options);
                }
                return originalAddEventListener.call(this, type, listener, options);
            };

            // Patch removeEventListener to use the wrapped listener
            var originalRemoveEventListener = EventTarget.prototype.removeEventListener;
            EventTarget.prototype.removeEventListener = function(type, listener, options) {
                if (type === 'mousemove' || type === 'mouseup' || type === 'mousedown') {
                    var elementMap = listenerMap.get(this);
                    if (elementMap && elementMap[type] && elementMap[type].has(listener)) {
                        var wrappedListener = elementMap[type].get(listener);
                        elementMap[type].delete(listener);
                        return originalRemoveEventListener.call(this, type, wrappedListener, options);
                    }
                }
                return originalRemoveEventListener.call(this, type, listener, options);
            };

        })();
        <\/script>

        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/sql/sql.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/mode/overlay.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/xml/xml.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/show-hint.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/sql-hint.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/closetag.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/matchtags.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/matchbrackets.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/xml-fold.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/foldcode.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/foldgutter.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/search/search.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/search/searchcursor.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/search/jump-to-line.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/dialog/dialog.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/selection/active-line.min.js"><\/script>
        <script src="https://cdn.datatables.net/2.0.0/js/dataTables.min.js"><\/script>
        <script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"><\/script>
        <!-- Chart.js for data visualization -->
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
    `;
}

/**
 * Generates CSS styles for the application.
 * @returns {string} CSS styles in a style tag
 */
function generateStyles() {
    return `
        <style>
            /* ============================================
               CSS VARIABLES & THEMING
               ============================================ */
            :root {
                --sqt-primary: #2563eb;
                --sqt-primary-hover: #1d4ed8;
                --sqt-success: #10b981;
                --sqt-warning: #f59e0b;
                --sqt-danger: #ef4444;
                --sqt-bg-primary: #ffffff;
                --sqt-bg-secondary: #f8fafc;
                --sqt-bg-tertiary: #f1f5f9;
                --sqt-border: #e2e8f0;
                --sqt-text-primary: #1e293b;
                --sqt-text-secondary: #64748b;
                --sqt-text-muted: #94a3b8;
                --sqt-sidebar-width: 280px;
                --sqt-header-height: 56px;
                --sqt-editor-font: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
            }

            [data-bs-theme="dark"] {
                --sqt-primary: #3b82f6;
                --sqt-primary-hover: #60a5fa;
                --sqt-bg-primary: #0f172a;
                --sqt-bg-secondary: #1e293b;
                --sqt-bg-tertiary: #334155;
                --sqt-border: #334155;
                --sqt-text-primary: #f1f5f9;
                --sqt-text-secondary: #94a3b8;
                --sqt-text-muted: #64748b;
            }

            /* ============================================
               BASE STYLES
               ============================================ */
            * {
                box-sizing: border-box;
            }

            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                font-size: 14px;
                background-color: var(--sqt-bg-secondary);
                color: var(--sqt-text-primary);
                margin: 0;
                padding: 0;
                overflow: hidden;
            }

            /* ============================================
               LAYOUT
               ============================================ */
            .sqt-app {
                display: flex;
                flex-direction: column;
                height: 100vh;
                overflow: hidden;
                max-width: 100vw;
            }

            .sqt-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                height: var(--sqt-header-height);
                padding: 0 24px;
                background: var(--sqt-bg-primary);
                border-bottom: 1px solid var(--sqt-border);
                flex-shrink: 0;
                position: relative;
                z-index: 100;
                min-width: 0;
            }

            .sqt-header-title {
                display: flex;
                align-items: center;
                gap: 12px;
                font-weight: 600;
                font-size: 16px;
                color: var(--sqt-text-primary);
            }

            .sqt-header-title i {
                color: var(--sqt-primary);
                font-size: 20px;
            }

            .sqt-header-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                padding-right: 8px;
                flex-shrink: 0;
            }

            .sqt-main {
                display: flex;
                flex: 1;
                overflow: hidden;
                min-width: 0;
                max-width: 100%;
            }

            /* ============================================
               SIDEBAR
               ============================================ */
            .sqt-sidebar {
                width: var(--sqt-sidebar-width);
                background: var(--sqt-bg-primary);
                border-right: 1px solid var(--sqt-border);
                display: flex;
                flex-direction: column;
                flex-shrink: 0;
                transition: width 0.2s ease;
            }

            .sqt-sidebar.collapsed {
                width: 0;
                border-right: none;
                overflow: hidden;
            }

            .sqt-sidebar-header {
                padding: 12px 16px;
                border-bottom: 1px solid var(--sqt-border);
                display: flex;
                align-items: center;
                justify-content: space-between;
                min-width: var(--sqt-sidebar-width);
            }

            .sqt-sidebar-title {
                font-weight: 600;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--sqt-text-secondary);
            }

            .sqt-history-list {
                flex: 1;
                overflow-y: auto;
                padding: 8px;
                min-width: var(--sqt-sidebar-width);
            }

            .sqt-history-item {
                padding: 10px 12px;
                border-radius: 6px;
                cursor: pointer;
                margin-bottom: 4px;
                transition: background-color 0.15s ease;
            }

            .sqt-history-item:hover {
                background: var(--sqt-bg-tertiary);
            }

            .sqt-history-item-query {
                font-family: var(--sqt-editor-font);
                font-size: 11px;
                color: var(--sqt-text-primary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-bottom: 4px;
            }

            .sqt-history-item-meta {
                font-size: 10px;
                color: var(--sqt-text-muted);
                display: flex;
                gap: 8px;
            }

            /* ============================================
               FLOATING HISTORY BUTTON
               ============================================ */
            .sqt-history-float-btn {
                position: absolute;
                left: 0;
                top: 50%;
                transform: translateY(-50%);
                width: 24px;
                height: 64px;
                background: var(--sqt-bg-secondary);
                border: 1px solid var(--sqt-border);
                border-left: none;
                border-radius: 0 6px 6px 0;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                z-index: 100;
                transition: all 0.2s ease;
                color: var(--sqt-text-secondary);
            }

            .sqt-history-float-btn:hover {
                background: var(--sqt-bg-tertiary);
                color: var(--sqt-text-primary);
                width: 28px;
            }

            .sqt-history-float-btn i {
                font-size: 14px;
            }

            /* Hide floating button when sidebar is open */
            .sqt-sidebar:not(.collapsed) ~ .sqt-content .sqt-history-float-btn {
                opacity: 0;
                pointer-events: none;
            }

            /* ============================================
               CONTENT AREA
               ============================================ */
            .sqt-content {
                position: relative;
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                min-width: 0;
                max-width: 100%;
            }

            /* ============================================
               TOOLBAR
               ============================================ */
            .sqt-toolbar {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                background: var(--sqt-bg-primary);
                border-bottom: 1px solid var(--sqt-border);
                flex-wrap: wrap;
                flex-shrink: 0;
                min-width: 0;
            }

            .sqt-toolbar-group {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .sqt-toolbar-divider {
                width: 1px;
                height: 24px;
                background: var(--sqt-border);
                margin: 0 8px;
            }

            /* Compact toolbar mode - hide button labels */
            .sqt-toolbar-compact .sqt-btn:not(.sqt-btn-icon) > span:not(.bi) {
                display: none;
            }

            .sqt-toolbar-compact .sqt-btn-dropdown > span:not(.bi):not(.bi-chevron-down) {
                display: none;
            }

            .sqt-toolbar-compact .sqt-btn-dropdown {
                gap: 2px;
            }

            /* ============================================
               BUTTONS
               ============================================ */
            .sqt-btn {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 6px 12px;
                font-size: 13px;
                font-weight: 500;
                border-radius: 6px;
                border: 1px solid transparent;
                cursor: pointer;
                transition: all 0.15s ease;
                white-space: nowrap;
            }

            .sqt-btn i {
                font-size: 14px;
            }

            .sqt-btn-primary {
                background: var(--sqt-primary);
                color: white;
            }

            .sqt-btn-primary:hover {
                background: var(--sqt-primary-hover);
            }

            .sqt-btn-secondary {
                background: var(--sqt-bg-tertiary);
                color: var(--sqt-text-primary);
                border-color: var(--sqt-border);
            }

            .sqt-btn-secondary:hover {
                background: var(--sqt-border);
            }

            .sqt-btn-secondary.active {
                background: var(--sqt-primary);
                color: white;
                border-color: var(--sqt-primary);
            }

            .sqt-btn-icon {
                padding: 6px 8px;
            }

            .sqt-btn-sm {
                padding: 4px 8px;
                font-size: 12px;
            }

            /* ============================================
               DATATABLES OVERRIDES
               ============================================ */
            .dt-length,
            .dt-length select,
            .dt-length label,
            .dt-search,
            .dt-search input,
            .dt-search label,
            .dt-info,
            .dt-paging {
                font-size: 12px !important;
            }

            .dt-length select {
                padding: 4px 28px 4px 8px;
                min-width: 70px;
            }

            .dt-search input {
                padding: 4px 8px;
            }

            /* DataTables pagination styling */
            .dt-paging {
                padding-top: 10px;
            }

            .dt-paging button {
                padding: 4px 10px !important;
                margin: 0 2px !important;
                border: 1px solid var(--sqt-border) !important;
                border-radius: 4px !important;
                background: var(--sqt-bg-primary) !important;
                color: var(--sqt-text-primary) !important;
                cursor: pointer;
                font-size: 12px !important;
            }

            .dt-paging button:hover:not(.disabled) {
                background: var(--sqt-bg-secondary) !important;
            }

            .dt-paging button.current {
                background: var(--sqt-primary) !important;
                border-color: var(--sqt-primary) !important;
                color: white !important;
            }

            .dt-paging button.disabled {
                opacity: 0.5 !important;
                cursor: not-allowed !important;
            }

            /* ============================================
               EDITOR PANEL
               ============================================ */
            .sqt-editor-panel {
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 200px;
                overflow: hidden;
            }

            .sqt-editor-container {
                flex: 1;
                overflow: hidden;
                border-bottom: 1px solid var(--sqt-border);
                display: flex;
                flex-direction: column;
            }

            /* Query Editor Toolbar */
            .sqt-editor-toolbar {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 4px 8px;
                background: var(--sqt-bg-tertiary);
                border-bottom: 1px solid var(--sqt-border);
                flex-shrink: 0;
            }

            .sqt-editor-toolbar .btn-group {
                gap: 1px;
            }

            .sqt-editor-toolbar .btn {
                padding: 2px 8px;
                font-size: 12px;
                line-height: 1.4;
            }

            .sqt-editor-toolbar .toolbar-separator {
                width: 1px;
                height: 20px;
                background: var(--sqt-border);
                margin: 0 4px;
            }

            .sqt-editor-toolbar .font-size-display {
                font-size: 11px;
                color: var(--sqt-text-secondary);
                min-width: 32px;
                text-align: center;
            }

            .sqt-editor-toolbar .toolbar-label {
                font-size: 11px;
                color: var(--sqt-text-secondary);
                margin-right: 4px;
            }

            /* CodeMirror dialog styling for Query Editor */
            .sqt-editor-container .CodeMirror-dialog {
                position: absolute;
                left: 0;
                right: 0;
                background: var(--sqt-bg-primary);
                border-bottom: 1px solid var(--sqt-border);
                padding: 8px 12px;
                z-index: 15;
                font-size: 13px;
            }

            .sqt-editor-container .CodeMirror-dialog input {
                font-family: inherit;
                font-size: 13px;
                padding: 4px 8px;
                border: 1px solid var(--sqt-border);
                border-radius: 4px;
                background: var(--sqt-bg-secondary);
                color: var(--sqt-text-primary);
                margin-left: 8px;
            }

            .sqt-editor-container .CodeMirror-dialog button {
                font-size: 12px;
                padding: 4px 12px;
                margin-left: 8px;
                border: 1px solid var(--sqt-border);
                border-radius: 4px;
                background: var(--sqt-bg-secondary);
                color: var(--sqt-text-primary);
                cursor: pointer;
            }

            .sqt-editor-container .CodeMirror-dialog button:hover {
                background: var(--sqt-bg-tertiary);
            }

            .sqt-editor-wrapper {
                flex: 1;
                overflow: hidden;
                position: relative;
            }

            .CodeMirror {
                height: 100%;
                font-family: var(--sqt-editor-font);
                font-size: 12px;
                line-height: 1.6;
            }

            .CodeMirror-gutters {
                background: var(--sqt-bg-secondary);
                border-right: 1px solid var(--sqt-border);
            }

            [data-bs-theme="light"] .CodeMirror {
                background: var(--sqt-bg-primary);
            }

            /* NetSuite BUILTIN function highlighting */
            .cm-builtin {
                color: #0891b2;
                font-weight: 600;
            }

            [data-bs-theme="dark"] .cm-builtin {
                color: #22d3ee;
            }

            /* ============================================
               RESULTS PANEL
               ============================================ */
            .sqt-results-panel {
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 200px;
                background: var(--sqt-bg-primary);
                overflow: hidden;
                min-width: 0;
                max-width: 100%;
            }

            .sqt-results-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 16px;
                background: var(--sqt-bg-secondary);
                border-bottom: 1px solid var(--sqt-border);
                flex-shrink: 0;
                min-width: 0;
                gap: 16px;
            }

            .sqt-results-info {
                font-size: 12px;
                color: var(--sqt-text-secondary);
                display: flex;
                align-items: center;
                gap: 16px;
            }

            .sqt-results-info-item {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .sqt-results-info-item i {
                color: var(--sqt-text-muted);
            }

            .sqt-cache-miss-badge {
                font-size: 10px;
                padding: 2px 6px;
                background: var(--sqt-warning);
                color: #000;
                border-radius: 4px;
                margin-left: 6px;
                font-weight: 500;
            }

            .sqt-results-actions {
                display: flex;
                gap: 8px;
                align-items: center;
            }

            .sqt-view-toggle {
                display: flex;
                border: 1px solid var(--sqt-border);
                border-radius: 6px;
                overflow: hidden;
            }

            .sqt-view-toggle-btn {
                padding: 4px 10px;
                font-size: 12px;
                font-weight: 500;
                background: var(--sqt-bg-secondary);
                color: var(--sqt-text-secondary);
                border: none;
                cursor: pointer;
                transition: all 0.15s ease;
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .sqt-view-toggle-btn:not(:last-child) {
                border-right: 1px solid var(--sqt-border);
            }

            .sqt-view-toggle-btn:hover {
                background: var(--sqt-bg-tertiary);
                color: var(--sqt-text-primary);
            }

            .sqt-view-toggle-btn.active {
                background: var(--sqt-primary);
                color: white;
            }

            .sqt-json-container {
                flex: 1;
                overflow: auto;
                padding: 16px;
                background: var(--sqt-bg-secondary);
            }

            .sqt-json-pre {
                margin: 0;
                padding: 16px;
                background: var(--sqt-bg-primary);
                border: 1px solid var(--sqt-border);
                border-radius: 6px;
                font-family: var(--sqt-editor-font);
                font-size: 12px;
                line-height: 1.5;
                white-space: pre-wrap;
                word-break: break-word;
                color: var(--sqt-text-primary);
            }

            .sqt-results-container {
                flex: 1;
                overflow: auto;
                padding: 0;
                min-width: 0;
                max-width: 100%;
            }

            .sqt-results-table {
                width: max-content;
                min-width: 100%;
                border-collapse: separate;
                border-spacing: 0;
                font-size: 12px;
            }

            .sqt-results-table th {
                position: sticky;
                top: 0;
                background: var(--sqt-bg-secondary);
                padding: 10px 12px;
                text-align: left;
                font-weight: 600;
                color: var(--sqt-text-secondary);
                border-bottom: 2px solid var(--sqt-border);
                white-space: nowrap;
                z-index: 1;
            }

            .sqt-results-table td {
                padding: 8px 12px;
                border-bottom: 1px solid var(--sqt-border);
                color: var(--sqt-text-primary);
                max-width: 300px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .sqt-results-table tr:hover td {
                background: var(--sqt-bg-tertiary);
            }

            .sqt-results-table .row-number {
                color: var(--sqt-text-muted);
                text-align: center;
                font-size: 11px;
                background: var(--sqt-bg-secondary);
                width: 50px;
            }

            .sqt-null-value {
                color: var(--sqt-text-muted);
                font-style: italic;
            }

            .sqt-results-table tfoot {
                position: sticky;
                bottom: 0;
                background: var(--sqt-bg-secondary);
                border-top: 2px solid var(--sqt-border);
            }

            .sqt-results-table tfoot td {
                padding: 6px 12px;
                font-size: 10px;
                color: var(--sqt-text-secondary);
                white-space: nowrap;
            }

            .sqt-stats-row td {
                font-weight: 500;
                font-size: 11px;
                background: var(--sqt-bg-secondary) !important;
            }

            .sqt-stats-row td.row-number {
                font-weight: 600;
                color: var(--sqt-primary);
            }

            /* ============================================
               PINNED COLUMNS
               ============================================ */
            .sqt-results-table th.sqt-pinned,
            .sqt-results-table td.sqt-pinned {
                position: sticky !important;
                z-index: 2;
                background: var(--sqt-bg-primary);
            }

            .sqt-results-table th.sqt-pinned {
                z-index: 4;
                background: var(--sqt-bg-secondary);
            }

            .sqt-results-table tr:nth-child(odd) td.sqt-pinned {
                background: var(--sqt-bg-primary);
            }

            .sqt-results-table tr:nth-child(even) td.sqt-pinned {
                background: var(--sqt-bg-secondary);
            }

            .sqt-results-table .sqt-pinned-last {
                border-right: 2px solid var(--sqt-primary) !important;
            }

            .sqt-row-clickable:hover td.sqt-pinned {
                background: var(--sqt-primary) !important;
            }

            .sqt-stats-row td.sqt-pinned {
                background: var(--sqt-bg-secondary) !important;
            }

            .sqt-row-clickable {
                cursor: pointer;
            }

            .sqt-row-clickable:hover td {
                background: var(--sqt-primary) !important;
                color: white !important;
            }

            .sqt-row-clickable:hover .sqt-null-value {
                color: rgba(255,255,255,0.7);
            }

            /* ============================================
               RESULTS MAXIMIZED MODE
               ============================================ */
            .sqt-app.sqt-results-maximized {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 99999;
                width: 100vw;
                height: 100vh;
                max-width: 100vw;
                max-height: 100vh;
            }

            .sqt-results-maximized .sqt-main {
                height: calc(100vh - 28px); /* Account for status bar */
            }

            .sqt-results-maximized .sqt-toolbar {
                display: none !important;
            }

            .sqt-results-maximized .sqt-editor-panel {
                display: none !important;
            }

            .sqt-results-maximized .sqt-resizer {
                display: none !important;
            }

            .sqt-results-maximized .sqt-nl-bar {
                display: none !important;
            }

            .sqt-results-maximized .sqt-validation-panel {
                display: none !important;
            }

            .sqt-results-maximized .sqt-explain-panel {
                display: none !important;
            }

            .sqt-results-maximized .sqt-optimize-banner {
                display: none !important;
            }

            .sqt-results-maximized .sqt-history-float-btn {
                display: none !important;
            }

            .sqt-results-maximized .sqt-results-panel {
                flex: 1;
                min-height: 0;
                height: calc(100vh - 28px); /* Explicit height for scroll to work */
                overflow: hidden;
            }

            .sqt-results-maximized .sqt-results-container {
                flex: 1;
                min-height: 0;
                max-height: 100%;
                overflow: auto;
            }

            .sqt-results-maximize-btn {
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .sqt-results-maximize-btn i {
                transition: transform 0.2s ease;
            }

            .sqt-results-maximized .sqt-results-maximize-btn i {
                transform: rotate(180deg);
            }

            /* ============================================
               DRAG & DROP OVERLAY
               ============================================ */
            .sqt-drop-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(var(--sqt-primary-rgb, 37, 99, 235), 0.9);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 1000;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s;
            }

            .sqt-drop-overlay.active {
                opacity: 1;
            }

            .sqt-drop-overlay i {
                font-size: 48px;
                color: white;
                margin-bottom: 16px;
            }

            .sqt-drop-overlay span {
                font-size: 18px;
                color: white;
                font-weight: 500;
            }

            /* ============================================
               COLUMN REORDERING
               ============================================ */
            .sqt-results-table th.sqt-draggable {
                cursor: grab;
                user-select: none;
            }

            .sqt-results-table th.sqt-draggable:active {
                cursor: grabbing;
            }

            .sqt-results-table th.sqt-drag-over {
                background: var(--sqt-primary) !important;
                color: white !important;
            }

            .sqt-results-table th.sqt-dragging {
                opacity: 0.5;
            }

            /* ============================================
               KEYBOARD SHORTCUTS
               ============================================ */
            .sqt-shortcuts-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
            }

            .sqt-shortcut-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
                border-bottom: 1px solid var(--sqt-border);
            }

            .sqt-shortcut-keys {
                display: flex;
                gap: 4px;
            }

            .sqt-shortcut-key {
                display: inline-block;
                padding: 4px 8px;
                background: var(--sqt-bg-tertiary);
                border: 1px solid var(--sqt-border);
                border-radius: 4px;
                font-family: var(--sqt-editor-font);
                font-size: 11px;
                font-weight: 500;
            }

            /* ============================================
               PARAMETERS MODAL
               ============================================ */
            .sqt-param-input {
                margin-bottom: 12px;
            }

            .sqt-param-input label {
                display: block;
                font-weight: 500;
                margin-bottom: 4px;
                font-family: var(--sqt-editor-font);
            }

            .sqt-param-input input {
                width: 100%;
                padding: 8px 12px;
                border: 1px solid var(--sqt-border);
                border-radius: 4px;
                font-size: 14px;
                background: var(--sqt-bg-secondary);
                color: var(--sqt-text-primary);
            }

            .sqt-param-input input:focus {
                outline: none;
                border-color: var(--sqt-primary);
                box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
            }

            /* ============================================
               UNDO/REDO HISTORY
               ============================================ */
            .sqt-history-dropdown {
                position: absolute;
                top: 100%;
                right: 0;
                width: 300px;
                max-height: 400px;
                overflow-y: auto;
                background: var(--sqt-bg-primary);
                border: 1px solid var(--sqt-border);
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 1000;
                display: none;
            }

            .sqt-history-dropdown.show {
                display: block;
            }

            .sqt-history-dropdown-header {
                padding: 12px 16px;
                border-bottom: 1px solid var(--sqt-border);
                font-weight: 600;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .sqt-history-dropdown-item {
                padding: 8px 16px;
                cursor: pointer;
                font-family: var(--sqt-editor-font);
                font-size: 11px;
                border-bottom: 1px solid var(--sqt-border);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .sqt-history-dropdown-item:hover {
                background: var(--sqt-bg-tertiary);
            }

            .sqt-history-dropdown-item.active {
                background: var(--sqt-primary);
                color: white;
            }

            .sqt-history-dropdown-item-preview {
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-right: 8px;
            }

            .sqt-history-dropdown-item-time {
                color: var(--sqt-text-muted);
                font-size: 10px;
            }

            /* ============================================
               TOOLBAR DROPDOWN MENUS
               ============================================ */
            .sqt-toolbar-dropdown-wrapper {
                position: relative;
            }

            .sqt-toolbar-dropdown {
                position: absolute;
                top: 100%;
                left: 0;
                min-width: 220px;
                background: var(--sqt-bg-primary);
                border: 1px solid var(--sqt-border);
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 1000;
                display: none;
                padding: 4px 0;
                margin-top: 4px;
            }

            .sqt-toolbar-dropdown.show {
                display: block;
            }

            .sqt-toolbar-dropdown-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 16px;
                cursor: pointer;
                font-size: 13px;
                color: var(--sqt-text-primary);
                transition: background 0.15s;
            }

            .sqt-toolbar-dropdown-item:hover {
                background: var(--sqt-bg-tertiary);
            }

            .sqt-toolbar-dropdown-item i {
                font-size: 14px;
                width: 18px;
                text-align: center;
                color: var(--sqt-text-secondary);
            }

            .sqt-toolbar-dropdown-divider {
                height: 1px;
                background: var(--sqt-border);
                margin: 4px 0;
            }

            .sqt-btn-dropdown {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .sqt-btn-dropdown .bi-chevron-down {
                font-size: 10px;
                opacity: 0.7;
            }

            /* ============================================
               RESIZER
               ============================================ */
            .sqt-resizer {
                height: 6px;
                background: var(--sqt-bg-secondary);
                cursor: row-resize;
                display: flex;
                align-items: center;
                justify-content: center;
                border-top: 1px solid var(--sqt-border);
                border-bottom: 1px solid var(--sqt-border);
            }

            .sqt-resizer:hover {
                background: var(--sqt-primary);
            }

            .sqt-resizer-handle {
                width: 40px;
                height: 3px;
                background: var(--sqt-border);
                border-radius: 2px;
            }

            .sqt-resizer:hover .sqt-resizer-handle {
                background: white;
            }

            /* ============================================
               STATUS BAR
               ============================================ */
            .sqt-statusbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 4px 16px;
                background: var(--sqt-bg-secondary);
                border-top: 1px solid var(--sqt-border);
                font-size: 11px;
                color: var(--sqt-text-muted);
                flex-shrink: 0;
            }

            .sqt-statusbar-left,
            .sqt-statusbar-right,
            .sqt-statusbar-center {
                display: flex;
                align-items: center;
                gap: 16px;
            }

            .sqt-statusbar-center {
                gap: 8px;
            }

            .sqt-statusbar-separator {
                color: var(--sqt-border);
            }

            .sqt-statusbar a {
                color: var(--sqt-text-muted);
                text-decoration: none;
            }

            .sqt-statusbar a:hover {
                color: var(--sqt-primary);
                text-decoration: underline;
            }

            .sqt-status-indicator {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .sqt-status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: var(--sqt-success);
            }

            .sqt-status-dot.running {
                background: var(--sqt-warning);
                animation: pulse 1s infinite;
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }

            /* ============================================
               LOADING STATE
               ============================================ */
            .sqt-loading {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 48px;
                color: var(--sqt-text-secondary);
            }

            .sqt-spinner {
                width: 32px;
                height: 32px;
                border: 3px solid var(--sqt-border);
                border-top-color: var(--sqt-primary);
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                margin-bottom: 12px;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            /* ============================================
               EMPTY STATE
               ============================================ */
            .sqt-empty-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 48px;
                color: var(--sqt-text-secondary);
                text-align: center;
            }

            .sqt-empty-state i {
                font-size: 48px;
                color: var(--sqt-text-muted);
                margin-bottom: 16px;
            }

            .sqt-empty-state h3 {
                font-size: 16px;
                font-weight: 600;
                margin-bottom: 8px;
                color: var(--sqt-text-primary);
            }

            .sqt-empty-state p {
                font-size: 13px;
                margin: 0;
            }

            /* ============================================
               TOAST NOTIFICATIONS
               ============================================ */
            .sqt-toast-container {
                position: fixed !important;
                top: 16px !important;
                right: 16px !important;
                z-index: 99999 !important;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: auto;
            }

            .sqt-toast {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 12px 16px;
                background: var(--sqt-bg-primary);
                border: 1px solid var(--sqt-border);
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                min-width: 300px;
                max-width: 400px;
                animation: slideIn 0.2s ease;
            }

            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateX(20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }

            .sqt-toast-icon {
                font-size: 18px;
                flex-shrink: 0;
            }

            .sqt-toast-success .sqt-toast-icon { color: var(--sqt-success); }
            .sqt-toast-error .sqt-toast-icon { color: var(--sqt-danger); }
            .sqt-toast-warning .sqt-toast-icon { color: var(--sqt-warning); }
            .sqt-toast-info .sqt-toast-icon { color: var(--sqt-primary); }

            .sqt-toast-content {
                flex: 1;
            }

            .sqt-toast-title {
                font-weight: 600;
                font-size: 13px;
                margin-bottom: 2px;
            }

            .sqt-toast-message {
                font-size: 12px;
                color: var(--sqt-text-secondary);
            }

            .sqt-toast-close {
                background: none;
                border: none;
                color: var(--sqt-text-muted);
                cursor: pointer;
                padding: 0;
                font-size: 16px;
            }

            .sqt-toast-close:hover {
                color: var(--sqt-text-primary);
            }

            /* ============================================
               MODALS
               ============================================ */
            .modal-content {
                background: var(--sqt-bg-primary);
                border: 1px solid var(--sqt-border);
            }

            .modal-header {
                border-bottom-color: var(--sqt-border);
            }

            .modal-footer {
                border-top-color: var(--sqt-border);
            }

            /* ============================================
               OPTIONS PANEL
               ============================================ */
            .sqt-options-panel {
                position: absolute;
                top: 100%;
                right: 0;
                background: var(--sqt-bg-primary);
                border: 1px solid var(--sqt-border);
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                padding: 16px;
                min-width: 280px;
                z-index: 100;
                display: none;
            }

            .sqt-options-panel.show {
                display: block;
            }

            .sqt-options-section {
                margin-bottom: 16px;
            }

            .sqt-options-section:last-child {
                margin-bottom: 0;
            }

            .sqt-options-label {
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--sqt-text-secondary);
                margin-bottom: 8px;
            }

            .sqt-option-row {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 8px;
            }

            .sqt-option-row input[type="number"] {
                width: 80px;
                padding: 4px 8px;
                border: 1px solid var(--sqt-border);
                border-radius: 4px;
                background: var(--sqt-bg-secondary);
                color: var(--sqt-text-primary);
                font-size: 12px;
            }

            .sqt-option-row label {
                font-size: 12px;
                color: var(--sqt-text-primary);
            }

            /* ============================================
               KEYBOARD SHORTCUTS
               ============================================ */
            .sqt-kbd {
                display: inline-flex;
                align-items: center;
                padding: 2px 6px;
                font-family: var(--sqt-editor-font);
                font-size: 11px;
                background: var(--sqt-bg-tertiary);
                border: 1px solid var(--sqt-border);
                border-radius: 4px;
                color: var(--sqt-text-secondary);
            }

            /* ============================================
               FOCUS MODE
               ============================================ */
            .sqt-app.sqt-focus-mode {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 99999;
                width: 100vw;
                height: 100vh;
                max-width: 100vw;
                max-height: 100vh;
            }

            .sqt-focus-mode .sqt-main {
                height: calc(100vh - 28px); /* Account for status bar */
            }

            /* Ensure modals appear above focus mode */
            .modal {
                z-index: 100000 !important;
            }

            .modal-backdrop {
                z-index: 99999 !important;
            }

            /* Row Details Panel */
            .sqt-row-details {
                max-height: 400px;
                overflow-y: auto;
            }

            .sqt-row-details-table {
                width: 100%;
                font-size: 13px;
            }

            .sqt-row-details-table th {
                text-align: right;
                padding: 6px 12px 6px 6px;
                color: var(--sqt-text-secondary);
                font-weight: 500;
                width: 40%;
                vertical-align: top;
                border-bottom: 1px solid var(--sqt-border);
            }

            .sqt-row-details-table td {
                padding: 6px;
                color: var(--sqt-text-primary);
                word-break: break-word;
                border-bottom: 1px solid var(--sqt-border);
            }

            /* Execution Time Chart */
            .sqt-time-chart {
                display: flex;
                align-items: flex-end;
                gap: 2px;
                height: 40px;
                padding: 4px 0;
            }

            .sqt-time-bar {
                flex: 1;
                min-width: 8px;
                max-width: 20px;
                background: var(--sqt-primary);
                border-radius: 2px 2px 0 0;
                opacity: 0.6;
                transition: opacity 0.15s;
            }

            .sqt-time-bar:hover {
                opacity: 1;
            }

            .sqt-time-bar:last-child {
                opacity: 1;
            }

            /* Share URL */
            .sqt-share-url {
                font-family: var(--sqt-editor-font);
                font-size: 11px;
                padding: 8px;
                background: var(--sqt-bg-secondary);
                border: 1px solid var(--sqt-border);
                border-radius: 4px;
                word-break: break-all;
                max-height: 100px;
                overflow-y: auto;
            }

            /* Record Links */
            .sqt-record-link {
                color: var(--sqt-primary);
                text-decoration: none;
                white-space: nowrap;
                padding: 2px 4px;
                border-radius: 3px;
                transition: background-color 0.15s, color 0.15s;
            }

            .sqt-record-link:hover {
                background-color: var(--sqt-primary);
                color: white;
                text-decoration: none;
            }

            .sqt-link-icon {
                font-size: 10px;
                opacity: 0.6;
                margin-left: 3px;
                vertical-align: middle;
            }

            .sqt-record-link:hover .sqt-link-icon {
                opacity: 1;
            }

            /* ============================================
               CHART VISUALIZATION
               ============================================ */
            .sqt-chart-type-selector {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }

            .sqt-chart-type-btn {
                padding: 8px 16px;
                border: 1px solid var(--sqt-border);
                background: var(--sqt-bg-secondary);
                color: var(--sqt-text-primary);
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 13px;
            }

            .sqt-chart-type-btn:hover {
                border-color: var(--sqt-primary);
                color: var(--sqt-primary);
            }

            .sqt-chart-type-btn.active {
                background: var(--sqt-primary);
                border-color: var(--sqt-primary);
                color: white;
            }

            .sqt-chart-value-list {
                max-height: 150px;
                overflow-y: auto;
                border: 1px solid var(--sqt-border);
                border-radius: 6px;
                padding: 8px;
                background: var(--sqt-bg-secondary);
            }

            .sqt-chart-value-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 4px 0;
            }

            .sqt-chart-value-item label {
                font-size: 13px;
                cursor: pointer;
            }

            .sqt-chart-preview {
                height: 350px;
                border: 1px solid var(--sqt-border);
                border-radius: 8px;
                padding: 16px;
                background: var(--sqt-bg-secondary);
                position: relative;
            }

            .sqt-chart-preview canvas {
                max-width: 100%;
                max-height: 100%;
            }

            .sqt-chart-empty {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                text-align: center;
                color: var(--sqt-text-secondary);
            }

            .sqt-chart-empty i {
                font-size: 48px;
                opacity: 0.3;
                margin-bottom: 12px;
                display: block;
            }

            /* Autocomplete */
            .CodeMirror-hints {
                z-index: 100001 !important;
                font-family: var(--sqt-editor-font);
                font-size: 12px;
                background: var(--sqt-bg-primary);
                border: 1px solid var(--sqt-border);
                border-radius: 4px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                max-height: 200px;
                overflow-y: auto;
            }

            .CodeMirror-hint {
                padding: 4px 8px;
                color: var(--sqt-text-primary);
            }

            .CodeMirror-hint-active {
                background: var(--sqt-primary);
                color: white;
            }

            /* ============================================
               AI QUERY GENERATOR
               ============================================ */
            .sqt-ai-modal .modal-content {
                height: 80vh;
                max-height: 700px;
            }

            .sqt-ai-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex: 1;
                margin-right: 16px;
            }

            .sqt-ai-header-controls {
                display: flex;
                gap: 8px;
            }

            .sqt-ai-body {
                flex: 1;
                overflow-y: auto;
                padding: 0;
                background: var(--sqt-bg-secondary);
            }

            .sqt-ai-messages {
                min-height: 100%;
                padding: 16px;
                display: flex;
                flex-direction: column;
                gap: 16px;
            }

            .sqt-ai-welcome {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 48px 24px;
                text-align: center;
                color: var(--sqt-text-secondary);
            }

            .sqt-ai-welcome i {
                font-size: 48px;
                color: var(--sqt-primary);
                margin-bottom: 16px;
            }

            .sqt-ai-welcome h4 {
                font-size: 18px;
                font-weight: 600;
                color: var(--sqt-text-primary);
                margin-bottom: 8px;
            }

            .sqt-ai-welcome p {
                font-size: 14px;
                margin-bottom: 24px;
            }

            .sqt-ai-examples {
                display: flex;
                flex-direction: column;
                gap: 8px;
                max-width: 400px;
            }

            .sqt-ai-example {
                padding: 12px 16px;
                border: 1px solid var(--sqt-border);
                border-radius: 8px;
                background: var(--sqt-bg-primary);
                color: var(--sqt-text-primary);
                font-size: 13px;
                text-align: left;
                cursor: pointer;
                transition: all 0.15s ease;
            }

            .sqt-ai-example:hover {
                border-color: var(--sqt-primary);
                background: var(--sqt-bg-tertiary);
            }

            .sqt-ai-message {
                display: flex;
                gap: 12px;
                max-width: 85%;
            }

            .sqt-ai-message.user {
                align-self: flex-end;
                flex-direction: row-reverse;
            }

            .sqt-ai-message.assistant {
                align-self: flex-start;
            }

            .sqt-ai-avatar {
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                font-size: 14px;
            }

            .sqt-ai-message.user .sqt-ai-avatar {
                background: var(--sqt-primary);
                color: white;
            }

            .sqt-ai-message.assistant .sqt-ai-avatar {
                background: var(--sqt-bg-tertiary);
                color: var(--sqt-text-primary);
            }

            .sqt-ai-content {
                background: var(--sqt-bg-primary);
                border: 1px solid var(--sqt-border);
                border-radius: 12px;
                padding: 12px 16px;
                font-size: 14px;
                line-height: 1.5;
            }

            .sqt-ai-message.user .sqt-ai-content {
                background: var(--sqt-primary);
                color: white;
                border-color: var(--sqt-primary);
            }

            .sqt-ai-content pre {
                background: var(--sqt-bg-tertiary) !important;
                border: 1px solid var(--sqt-border) !important;
                border-radius: 8px;
                padding: 12px;
                margin: 12px 0;
                overflow-x: auto;
                font-family: var(--sqt-editor-font);
                font-size: 12px;
                color: var(--sqt-text-primary) !important;
            }

            .sqt-ai-content pre code {
                font-family: var(--sqt-editor-font);
                font-size: 12px;
                background: transparent !important;
                color: var(--sqt-text-primary) !important;
                padding: 0;
                white-space: pre-wrap;
                word-break: break-word;
            }

            .sqt-ai-content code {
                font-family: var(--sqt-editor-font);
                font-size: 12px;
                background: var(--sqt-bg-tertiary);
                padding: 2px 6px;
                border-radius: 4px;
            }

            .sqt-ai-timestamp {
                font-size: 10px;
                color: var(--sqt-text-muted);
                margin-top: 8px;
                text-align: right;
            }

            .sqt-ai-message.user .sqt-ai-timestamp {
                color: rgba(255, 255, 255, 0.7);
            }

            .sqt-ai-query-actions {
                display: flex;
                gap: 8px;
                margin-top: 12px;
            }

            .sqt-ai-footer {
                padding: 16px;
                border-top: 1px solid var(--sqt-border);
                background: var(--sqt-bg-primary);
            }

            .sqt-ai-input-container {
                display: flex;
                flex-direction: column;
                gap: 12px;
                width: 100%;
            }

            .sqt-ai-input {
                width: 100%;
                padding: 12px;
                border: 1px solid var(--sqt-border);
                border-radius: 8px;
                background: var(--sqt-bg-secondary);
                color: var(--sqt-text-primary);
                font-family: inherit;
                font-size: 14px;
                resize: none;
            }

            .sqt-ai-input:focus {
                outline: none;
                border-color: var(--sqt-primary);
            }

            .sqt-ai-input-actions {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .sqt-ai-toggle {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                color: var(--sqt-text-secondary);
            }

            .sqt-ai-toggle input {
                margin: 0;
            }

            .sqt-ai-loading {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 12px 16px;
                background: var(--sqt-bg-primary);
                border: 1px solid var(--sqt-border);
                border-radius: 12px;
                color: var(--sqt-text-secondary);
                font-size: 14px;
            }

            .sqt-ai-loading .sqt-spinner {
                width: 16px;
                height: 16px;
                border-width: 2px;
                margin: 0;
            }

            .sqt-ai-error {
                background: rgba(239, 68, 68, 0.1);
                border: 1px solid var(--sqt-danger);
                border-radius: 8px;
                padding: 12px 16px;
                color: var(--sqt-danger);
                font-size: 13px;
            }

            .sqt-ai-error i {
                margin-right: 8px;
            }

            #aiApiKey {
                font-family: var(--sqt-editor-font);
            }

            /* ============================================
               AI ENHANCED FEATURES
               ============================================ */

            /* Natural Language Query Bar */
            .sqt-nl-bar {
                display: flex;
                gap: 8px;
                padding: 12px 16px;
                background: linear-gradient(135deg, rgba(37, 99, 235, 0.05), rgba(124, 58, 237, 0.05));
                border-bottom: 1px solid var(--sqt-border);
            }

            .sqt-nl-bar.hidden {
                display: none;
            }

            .sqt-nl-input {
                flex: 1;
                padding: 10px 14px;
                border: 1px solid var(--sqt-border);
                border-radius: 8px;
                background: var(--sqt-bg-primary);
                color: var(--sqt-text-primary);
                font-size: 13px;
            }

            .sqt-nl-input:focus {
                outline: none;
                border-color: var(--sqt-primary);
            }

            .sqt-nl-input::placeholder {
                color: var(--sqt-text-muted);
            }

            .sqt-nl-btn {
                padding: 10px 16px;
                background: var(--sqt-primary);
                border: none;
                border-radius: 8px;
                color: white;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: background 0.15s;
                white-space: nowrap;
            }

            .sqt-nl-btn:hover {
                background: var(--sqt-primary-hover);
            }

            .sqt-nl-btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            .sqt-nl-toggle {
                padding: 6px 10px;
                background: transparent;
                border: 1px solid var(--sqt-border);
                border-radius: 6px;
                color: var(--sqt-text-secondary);
                font-size: 12px;
                cursor: pointer;
                transition: all 0.15s;
            }

            .sqt-nl-toggle:hover {
                background: var(--sqt-bg-tertiary);
            }

            .sqt-nl-toggle.active {
                background: var(--sqt-primary);
                border-color: var(--sqt-primary);
                color: white;
            }

            /* Query Validation Panel */
            .sqt-validation-panel {
                display: none;
                padding: 12px 16px;
                background: rgba(245, 158, 11, 0.1);
                border-bottom: 1px solid rgba(245, 158, 11, 0.3);
            }

            .sqt-validation-panel.visible {
                display: block;
            }

            .sqt-validation-panel.error {
                background: rgba(239, 68, 68, 0.1);
                border-color: rgba(239, 68, 68, 0.3);
            }

            .sqt-validation-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 8px;
            }

            .sqt-validation-title {
                font-weight: 600;
                font-size: 13px;
                color: var(--sqt-warning);
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .sqt-validation-panel.error .sqt-validation-title {
                color: var(--sqt-danger);
            }

            .sqt-validation-content {
                font-size: 13px;
                color: var(--sqt-text-primary);
                line-height: 1.5;
            }

            .sqt-validation-content ul {
                margin: 8px 0 0 0;
                padding-left: 20px;
            }

            .sqt-validation-content li {
                margin-bottom: 4px;
            }

            .sqt-validation-actions {
                display: flex;
                gap: 8px;
                margin-top: 12px;
            }

            /* Optimization Suggestion Banner */
            .sqt-optimize-banner {
                display: none;
                padding: 12px 16px;
                background: linear-gradient(135deg, rgba(37, 99, 235, 0.1), rgba(124, 58, 237, 0.1));
                border-bottom: 1px solid rgba(37, 99, 235, 0.2);
            }

            .sqt-optimize-banner.visible {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .sqt-optimize-message {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                color: var(--sqt-text-primary);
            }

            .sqt-optimize-message i {
                color: var(--sqt-primary);
                font-size: 16px;
            }

            .sqt-optimize-actions {
                display: flex;
                gap: 8px;
            }

            /* Explain Query Panel */
            .sqt-explain-panel {
                display: none;
                padding: 16px;
                background: var(--sqt-bg-secondary);
                border-bottom: 1px solid var(--sqt-border);
                max-height: 300px;
                overflow-y: auto;
            }

            .sqt-explain-panel.visible {
                display: block;
            }

            .sqt-explain-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 12px;
            }

            .sqt-explain-title {
                font-weight: 600;
                font-size: 14px;
                color: var(--sqt-text-primary);
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .sqt-explain-title i {
                color: var(--sqt-primary);
            }

            .sqt-explain-content {
                font-size: 13px;
                line-height: 1.6;
                color: var(--sqt-text-primary);
            }

            .sqt-explain-content ul {
                margin: 8px 0;
                padding-left: 20px;
            }

            .sqt-explain-content li {
                margin-bottom: 6px;
            }

            .sqt-explain-content code {
                background: var(--sqt-bg-tertiary);
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 12px;
            }

            .sqt-explain-content strong {
                color: var(--sqt-primary);
            }

            /* ============================================
               DOCUMENT GENERATOR
               ============================================ */
            #docGenModal .modal-body {
                display: flex;
                flex-direction: column;
                max-height: calc(100vh - 180px);
                overflow: hidden;
            }

            #docGenModal .modal-body > .row {
                flex: 1;
                min-height: 0;
                display: flex;
            }

            #docGenModal .modal-body > .row > .col-md-4 {
                overflow-y: auto;
                max-height: 100%;
            }

            #docGenModal .modal-body > .row > .col-md-8 {
                display: flex;
                flex-direction: column;
                min-height: 0;
            }

            .docgen-editor-wrapper {
                border: 1px solid var(--sqt-border);
                border-radius: 6px;
                overflow: hidden;
                flex: 1;
                min-height: 0;
                display: flex;
                flex-direction: column;
            }

            .docgen-editor-wrapper .CodeMirror {
                height: 100%;
                flex: 1;
                font-size: 12px;
                font-family: var(--sqt-font-mono);
            }

            .docgen-editor-wrapper .CodeMirror-gutters {
                background: var(--sqt-bg-tertiary);
                border-right: 1px solid var(--sqt-border);
            }

            /* FreeMarker directive highlighting */
            .cm-freemarker-directive {
                color: #9333ea;
                font-weight: 500;
            }

            .cm-freemarker-variable {
                color: #0891b2;
            }

            /* CodeMirror editor toolbar */
            .docgen-editor-toolbar {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 8px;
                background: var(--sqt-bg-tertiary);
                border-bottom: 1px solid var(--sqt-border);
                flex-shrink: 0;
            }

            .docgen-editor-toolbar .btn-group {
                gap: 1px;
            }

            .docgen-editor-toolbar .btn {
                padding: 2px 8px;
                font-size: 12px;
                line-height: 1.4;
            }

            .docgen-editor-toolbar .toolbar-separator {
                width: 1px;
                height: 20px;
                background: var(--sqt-border);
                margin: 0 4px;
            }

            .docgen-editor-toolbar .font-size-display {
                font-size: 11px;
                color: var(--sqt-text-secondary);
                min-width: 32px;
                text-align: center;
            }

            .docgen-editor-toolbar .toolbar-label {
                font-size: 11px;
                color: var(--sqt-text-secondary);
                margin-right: 4px;
            }

            /* CodeMirror dialog styling - scoped to Document Generator */
            .docgen-editor-wrapper .CodeMirror-dialog {
                position: absolute;
                left: 0;
                right: 0;
                background: var(--sqt-bg-secondary);
                border-bottom: 1px solid var(--sqt-border);
                padding: 6px 10px;
                z-index: 15;
                font-size: 12px;
                font-family: var(--sqt-font-mono);
            }

            .docgen-editor-wrapper .CodeMirror-dialog-top {
                top: 0;
            }

            .docgen-editor-wrapper .CodeMirror-dialog-bottom {
                bottom: 0;
            }

            .docgen-editor-wrapper .CodeMirror-dialog input {
                font-family: var(--sqt-font-mono);
                font-size: 12px;
                padding: 3px 8px;
                border: 1px solid var(--sqt-border);
                border-radius: 4px;
                background: var(--sqt-bg-primary);
                color: var(--sqt-text-primary);
                margin-right: 8px;
                width: 200px;
            }

            .docgen-editor-wrapper .CodeMirror-dialog input:focus {
                outline: none;
                border-color: var(--sqt-primary);
            }

            .docgen-editor-wrapper .CodeMirror-dialog button {
                font-size: 11px;
                padding: 2px 8px;
                margin-left: 4px;
                background: var(--sqt-bg-tertiary);
                border: 1px solid var(--sqt-border);
                border-radius: 4px;
                cursor: pointer;
            }

            .docgen-editor-wrapper .CodeMirror-dialog button:hover {
                background: var(--sqt-bg-secondary);
            }

            /* CodeMirror fold gutter - scoped to Document Generator */
            .docgen-editor-wrapper .CodeMirror-foldgutter {
                width: 14px;
            }

            .docgen-editor-wrapper .CodeMirror-foldgutter-open,
            .docgen-editor-wrapper .CodeMirror-foldgutter-folded {
                cursor: pointer;
                color: var(--sqt-text-secondary);
            }

            .docgen-editor-wrapper .CodeMirror-foldgutter-open:after {
                content: "\\25BE";
            }

            .docgen-editor-wrapper .CodeMirror-foldgutter-folded:after {
                content: "\\25B8";
            }

            /* Active line highlighting - scoped to Document Generator */
            .docgen-editor-wrapper .CodeMirror-activeline-background {
                background: rgba(0, 0, 0, 0.05);
            }

            .docgen-editor-wrapper textarea {
                border: none;
                resize: vertical;
                min-height: 400px;
            }

            /* Snippet dropdown styling - custom dropdown with proper styling */
            #docGenSnippetsDropdown {
                position: static;
            }

            #docGenSnippetsDropdown .dropdown-menu {
                display: none !important;
                position: fixed !important;
                z-index: 99999;
                max-height: 350px;
                overflow-y: auto;
                width: 280px;
                transform: none !important;
                inset: auto !important;
                /* Restore Bootstrap dropdown styling */
                background-color: var(--bs-dropdown-bg, #fff);
                border: 1px solid var(--bs-dropdown-border-color, rgba(0,0,0,.15));
                border-radius: 0.375rem;
                box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);
                padding: 0.5rem 0;
                margin: 0;
                list-style: none;
            }

            #docGenSnippetsDropdown .dropdown-menu.show {
                display: block !important;
            }

            #docGenSnippetsDropdown .dropdown-item {
                display: block;
                width: 100%;
                padding: 0.25rem 1rem;
                clear: both;
                font-weight: 400;
                color: var(--bs-dropdown-link-color, #212529);
                text-align: inherit;
                text-decoration: none;
                white-space: nowrap;
                background-color: transparent;
                border: 0;
            }

            #docGenSnippetsDropdown .dropdown-item:hover {
                background-color: var(--bs-dropdown-link-hover-bg, #e9ecef);
                color: var(--bs-dropdown-link-hover-color, #1e2125);
            }

            #docGenSnippetsDropdown .dropdown-header {
                display: block;
                padding: 0.5rem 1rem;
                margin-bottom: 0;
                font-size: 0.875rem;
                color: var(--bs-dropdown-header-color, #6c757d);
                white-space: nowrap;
            }

            #docGenSnippetsDropdown .dropdown-divider {
                height: 0;
                margin: 0.5rem 0;
                overflow: hidden;
                border-top: 1px solid var(--bs-dropdown-divider-bg, #e9ecef);
            }

            #docGenModal .dropdown-menu code {
                background: var(--sqt-bg-tertiary);
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 11px;
            }

            .docgen-columns-list {
                max-height: 200px;
                overflow-y: auto;
                padding: 8px;
                background: var(--sqt-bg-tertiary);
                border-radius: 6px;
                border: 1px solid var(--sqt-border);
            }

            #docGenModal .modal-body {
                max-height: calc(100vh - 200px);
                overflow-y: auto;
            }

            /* Fullscreen mode for Document Generator */
            #docGenModal .modal-dialog.modal-fullscreen {
                max-width: 100%;
                width: 100%;
                height: 100%;
                margin: 0;
            }

            #docGenModal .modal-dialog.modal-fullscreen .modal-content {
                height: 100%;
                border-radius: 0;
            }

            #docGenModal .modal-dialog.modal-fullscreen .modal-body {
                max-height: calc(100vh - 130px);
            }

            #docGenModal .modal-dialog.modal-fullscreen .docgen-editor-wrapper .CodeMirror {
                height: calc(100vh - 220px);
            }

            #docGenModal .alert code {
                font-size: 11px;
                word-break: break-all;
            }

            /* Ensure toasts appear above modals */
            .toast-container {
                z-index: 1090 !important;
            }

            .docgen-datasources {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .docgen-datasource-card {
                background: var(--sqt-bg-tertiary);
                border: 1px solid var(--sqt-border);
                border-radius: 6px;
                padding: 10px;
                position: relative;
            }

            .docgen-datasource-card.primary {
                border-color: var(--bs-primary);
                border-width: 2px;
            }

            .docgen-datasource-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }

            .docgen-datasource-header .alias-input {
                width: 100px;
                font-size: 12px;
                font-weight: 600;
                padding: 2px 6px;
            }

            .docgen-datasource-header .badge {
                font-size: 10px;
            }

            .docgen-datasource-body {
                font-size: 12px;
            }

            .docgen-datasource-body .form-label {
                font-size: 11px;
                margin-bottom: 2px;
                color: var(--sqt-text-muted);
            }

            .docgen-datasource-body .form-control,
            .docgen-datasource-body .form-select {
                font-size: 12px;
                padding: 4px 8px;
            }

            .docgen-datasource-body .input-group-text {
                font-size: 11px;
                padding: 4px 8px;
            }

            .docgen-datasource-query {
                font-family: var(--sqt-font-mono);
                font-size: 11px;
                background: var(--sqt-bg-secondary);
                border-radius: 4px;
                padding: 6px 8px;
                margin-top: 6px;
                max-height: 60px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: var(--sqt-text-muted);
            }

            .docgen-datasource-query.custom-query {
                max-height: 80px;
                overflow-y: auto;
                white-space: pre-wrap;
            }

            .docgen-datasource-remove {
                position: absolute;
                top: 4px;
                right: 4px;
                padding: 0;
                width: 20px;
                height: 20px;
                font-size: 12px;
                line-height: 1;
                border-radius: 50%;
            }

            /* ============================================
               RESPONSIVE ADJUSTMENTS
               ============================================ */
            @media (max-width: 768px) {
                .sqt-sidebar {
                    display: none;
                }

                .sqt-toolbar {
                    padding: 8px;
                }

                .sqt-btn span {
                    display: none;
                }
            }
        </style>
    `;
}

/**
 * Generates the toast notification container.
 * @returns {string} HTML for toast container
 */
function generateToastContainer() {
    return `<div id="toastContainer" class="sqt-toast-container"></div>`;
}

/**
 * Generates the main application layout.
 * @param {string} scriptUrl - The script URL
 * @returns {string} HTML for main layout
 */
function generateMainLayout(scriptUrl) {
    // AI-related UI elements (only rendered when AI_ENABLED is true)
    const nlQueryBar = CONFIG.AI_ENABLED ? `
                    <!-- Natural Language Query Bar -->
                    <div class="sqt-nl-bar" id="nlQueryBar">
                        <input type="text" class="sqt-nl-input" id="nlQueryInput"
                               placeholder="Describe what you want in plain English... (e.g., 'Show me overdue invoices over $1000')"
                               onkeydown="if(event.key==='Enter') SQT.generateFromNaturalLanguage()">
                        <button type="button" class="sqt-nl-btn" onclick="SQT.generateFromNaturalLanguage()" id="nlGenerateBtn">
                            <i class="bi bi-stars"></i>
                            <span>Generate</span>
                        </button>
                        <button type="button" class="sqt-nl-toggle" onclick="SQT.toggleNLBar()" title="Hide natural language bar">
                            <i class="bi bi-chevron-up"></i>
                        </button>
                    </div>
    ` : '';

    const validationPanel = CONFIG.AI_ENABLED ? `
                    <!-- Validation Panel -->
                    <div class="sqt-validation-panel" id="validationPanel">
                        <div class="sqt-validation-header">
                            <div class="sqt-validation-title">
                                <i class="bi bi-exclamation-triangle"></i>
                                <span id="validationTitle">Query Review</span>
                            </div>
                            <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.hideValidation()">
                                <i class="bi bi-x"></i>
                            </button>
                        </div>
                        <div class="sqt-validation-content" id="validationContent"></div>
                        <div class="sqt-validation-actions" id="validationActions"></div>
                    </div>
    ` : '';

    const explainPanel = CONFIG.AI_ENABLED ? `
                    <!-- Explain Query Panel -->
                    <div class="sqt-explain-panel" id="explainPanel">
                        <div class="sqt-explain-header">
                            <div class="sqt-explain-title">
                                <i class="bi bi-lightbulb"></i>
                                <span>Query Explanation</span>
                            </div>
                            <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.hideExplain()">
                                <i class="bi bi-x"></i>
                            </button>
                        </div>
                        <div class="sqt-explain-content" id="explainContent">
                            <div class="sqt-loading">
                                <div class="sqt-spinner"></div>
                                <span>Analyzing query...</span>
                            </div>
                        </div>
                    </div>
    ` : '';

    const optimizeBanner = CONFIG.AI_ENABLED ? `
                    <!-- Optimization Suggestion Banner -->
                    <div class="sqt-optimize-banner" id="optimizeBanner">
                        <div class="sqt-optimize-message">
                            <i class="bi bi-lightning-charge"></i>
                            <span id="optimizeMessage">This query took a while. Would you like AI to suggest optimizations?</span>
                        </div>
                        <div class="sqt-optimize-actions">
                            <button type="button" class="sqt-btn sqt-btn-primary sqt-btn-sm" onclick="SQT.askAIToOptimize()">
                                <i class="bi bi-stars"></i> Optimize
                            </button>
                            <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.hideOptimizeBanner()">
                                Dismiss
                            </button>
                        </div>
                    </div>
    ` : '';

    return `
        <div class="sqt-app">
            <div class="sqt-main">
                ${generateSidebar()}
                <div class="sqt-content">
                    <!-- Floating History Button -->
                    <button type="button" class="sqt-history-float-btn" onclick="SQT.toggleSidebar()" title="Toggle query history">
                        <i class="bi bi-clock-history"></i>
                    </button>

                    ${generateToolbar(scriptUrl)}
                    ${nlQueryBar}
                    <!-- SQT-PLUGIN:nl-bar -->
                    ${validationPanel}
                    ${explainPanel}
                    ${optimizeBanner}

                    <!-- SQT-PLUGIN:before-editor -->
                    <div class="sqt-editor-panel" style="position: relative;">
                        <div class="sqt-editor-container">
                            <div class="sqt-editor-toolbar">
                                <div class="btn-group btn-group-sm">
                                    <button type="button" class="btn btn-outline-secondary" onclick="SQT.editorUndo()" title="Undo (Ctrl+Z)">
                                        <i class="bi bi-arrow-counterclockwise"></i>
                                    </button>
                                    <button type="button" class="btn btn-outline-secondary" onclick="SQT.editorRedo()" title="Redo (Ctrl+Y)">
                                        <i class="bi bi-arrow-clockwise"></i>
                                    </button>
                                </div>
                                <div class="toolbar-separator"></div>
                                <div class="btn-group btn-group-sm">
                                    <button type="button" class="btn btn-outline-secondary" onclick="SQT.editorFind()" title="Find (Ctrl+F)">
                                        <i class="bi bi-search"></i>
                                    </button>
                                    <button type="button" class="btn btn-outline-secondary" onclick="SQT.editorReplace()" title="Find & Replace (Ctrl+Shift+F)">
                                        <i class="bi bi-arrow-left-right"></i>
                                    </button>
                                </div>
                                <div class="toolbar-separator"></div>
                                <span class="toolbar-label">Font:</span>
                                <div class="btn-group btn-group-sm">
                                    <button type="button" class="btn btn-outline-secondary" onclick="SQT.editorFontSize(-1)" title="Decrease font size">
                                        <i class="bi bi-dash"></i>
                                    </button>
                                    <span class="font-size-display" id="editorFontSizeDisplay">12px</span>
                                    <button type="button" class="btn btn-outline-secondary" onclick="SQT.editorFontSize(1)" title="Increase font size">
                                        <i class="bi bi-plus"></i>
                                    </button>
                                </div>
                                <div class="toolbar-separator"></div>
                                <div class="btn-group btn-group-sm">
                                    <button type="button" class="btn btn-outline-secondary" onclick="SQT.editorToggleWrap()" title="Toggle word wrap" id="editorWrapBtn">
                                        <i class="bi bi-text-wrap"></i>
                                    </button>
                                </div>
                                <div class="toolbar-separator"></div>
                                <button type="button" class="btn btn-outline-secondary btn-sm" onclick="SQT.editorGoToLine()" title="Go to line (Ctrl+G)">
                                    <i class="bi bi-123 me-1"></i>Go to Line
                                </button>
                                <!-- SQT-PLUGIN:editor-toolbar -->
                            </div>
                            <div class="sqt-editor-wrapper">
                                <textarea id="queryEditor"></textarea>
                            </div>
                        </div>
                        <div class="sqt-drop-overlay" id="dropOverlay">
                            <i class="bi bi-file-earmark-code"></i>
                            <span>Drop SQL file here</span>
                        </div>
                    </div>
                    <div class="sqt-resizer" id="resizer">
                        <div class="sqt-resizer-handle"></div>
                    </div>
                    <div class="sqt-results-panel" id="resultsPanel">
                        ${generateEmptyState()}
                    </div>
                </div>
            </div>
            ${generateStatusBar()}
        </div>
    `;
}

/**
 * Generates the header section.
 * @returns {string} HTML for header
 */
function generateHeader() {
    return `
        <header class="sqt-header">
            <div class="sqt-header-title">
                <i class="bi bi-database"></i>
                <span>SuiteQL Query Tool</span>
                <span style="font-weight: 400; color: var(--sqt-text-muted); font-size: 12px;">v${CONFIG.VERSION}</span>
            </div>
            <div class="sqt-header-actions">
                <!-- SQT-PLUGIN:header-right -->
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-icon" onclick="SQT.toggleSidebar()" title="Toggle query history">
                    <i class="bi bi-layout-sidebar" id="sidebarIcon"></i>
                </button>
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-icon" onclick="SQT.toggleTheme()" title="Toggle dark mode">
                    <i class="bi bi-moon-stars" id="themeIcon"></i>
                </button>
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-icon" onclick="SQT.showHelp()" title="Help">
                    <i class="bi bi-question-circle"></i>
                </button>
            </div>
        </header>
    `;
}

/**
 * Generates the sidebar with query history.
 * @returns {string} HTML for sidebar
 */
function generateSidebar() {
    return `
        <aside class="sqt-sidebar collapsed" id="sidebar">
            <div class="sqt-sidebar-header">
                <span class="sqt-sidebar-title">Query History</span>
                <div style="display: flex; gap: 4px;">
                    <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-icon sqt-btn-sm" onclick="SQT.clearHistory()" title="Clear history">
                        <i class="bi bi-trash"></i>
                    </button>
                    <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-icon sqt-btn-sm" onclick="SQT.toggleSidebar()" title="Close history">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
            </div>
            <div class="sqt-history-list" id="historyList">
                <div class="sqt-empty-state" style="padding: 24px;">
                    <i class="bi bi-clock-history" style="font-size: 24px;"></i>
                    <p style="margin-top: 8px;">No query history yet</p>
                </div>
            </div>
            <!-- SQT-PLUGIN:sidebar-section -->
        </aside>
    `;
}

/**
 * Generates the toolbar section.
 * @param {string} scriptUrl - The script URL
 * @returns {string} HTML for toolbar
 */
function generateToolbar(scriptUrl) {
    const localLibraryButtons = CONFIG.QUERY_FOLDER_ID ? `
        <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.showLocalLibrary()">
            <i class="bi bi-folder"></i>
            <span>Local Library</span>
        </button>
        <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.showSaveModal()">
            <i class="bi bi-save"></i>
            <span>Save</span>
        </button>
    ` : '';

    const workbooksButton = CONFIG.WORKBOOKS_ENABLED ? `
        <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.showWorkbooks()">
            <i class="bi bi-journal-text"></i>
            <span>Workbooks</span>
        </button>
    ` : '';

    const aiToolbarSection = CONFIG.AI_ENABLED ? `
                <div class="sqt-toolbar-dropdown-wrapper" id="toolbarAI">
                    <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm sqt-btn-dropdown" onclick="SQT.toggleAIDropdown()" title="AI-powered features">
                        <i class="bi bi-robot"></i>
                        <span>AI</span>
                        <i class="bi bi-chevron-down"></i>
                    </button>
                    <div class="sqt-toolbar-dropdown" id="aiDropdown">
                        <div class="sqt-toolbar-dropdown-item" onclick="SQT.showAIModal(); SQT.closeAllDropdowns();">
                            <i class="bi bi-chat-dots"></i>
                            <span>AI Chat</span>
                        </div>
                        <div class="sqt-toolbar-dropdown-item" onclick="SQT.toggleNLBar(); SQT.closeAllDropdowns();">
                            <i class="bi bi-chat-text"></i>
                            <span>Quick Ask Bar</span>
                        </div>
                        <div class="sqt-toolbar-dropdown-divider"></div>
                        <div class="sqt-toolbar-dropdown-item" onclick="SQT.explainQuery(); SQT.closeAllDropdowns();">
                            <i class="bi bi-lightbulb"></i>
                            <span>Explain Query</span>
                        </div>
                        <div class="sqt-toolbar-dropdown-item" onclick="SQT.validateQuery(); SQT.closeAllDropdowns();">
                            <i class="bi bi-shield-check"></i>
                            <span>Validate Query</span>
                        </div>
                        <div class="sqt-toolbar-dropdown-divider"></div>
                        <div class="sqt-toolbar-dropdown-item" onclick="SQT.showAISettings(); SQT.closeAllDropdowns();">
                            <i class="bi bi-gear"></i>
                            <span>AI Settings</span>
                        </div>
                        <!-- SQT-PLUGIN:ai-dropdown -->
                    </div>
                </div>
    ` : '';

    return `
        <div class="sqt-toolbar">
            <!-- SQT-PLUGIN:toolbar-start -->
            <div class="sqt-toolbar-group">
                <button type="button" class="sqt-btn sqt-btn-primary sqt-btn-sm" onclick="SQT.runQuery()" id="runButton">
                    <i class="bi bi-play-fill"></i>
                    <span>Run</span>
                </button>
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.formatQuery()" id="toolbarFormat" title="Format SQL (Ctrl+Shift+F)">
                    <i class="bi bi-code-slash"></i>
                    <span>Format</span>
                </button>
                ${aiToolbarSection}
                <div class="sqt-toolbar-dropdown-wrapper" id="toolbarMore">
                    <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm sqt-btn-dropdown" onclick="SQT.toggleMoreDropdown()" title="More actions">
                        <i class="bi bi-three-dots"></i>
                        <span>More</span>
                        <i class="bi bi-chevron-down"></i>
                    </button>
                    <div class="sqt-toolbar-dropdown" id="moreDropdown">
                        ${CONFIG.REMOTE_LIBRARY_ENABLED ? `
                        <div class="sqt-toolbar-dropdown-item" onclick="SQT.showRemoteLibrary(); SQT.closeAllDropdowns();">
                            <i class="bi bi-collection"></i>
                            <span>Query Library</span>
                        </div>
                        <div class="sqt-toolbar-dropdown-divider"></div>
                        ` : ''}
                        <div class="sqt-toolbar-dropdown-item" onclick="SQT.showShareModal(); SQT.closeAllDropdowns();">
                            <i class="bi bi-share"></i>
                            <span>Share Query</span>
                        </div>
                        <div class="sqt-toolbar-dropdown-divider"></div>
                        <div class="sqt-toolbar-dropdown-item" onclick="SQT.importSqlFile(); SQT.closeAllDropdowns();">
                            <i class="bi bi-upload"></i>
                            <span>Import SQL File</span>
                        </div>
                        <div class="sqt-toolbar-dropdown-item" onclick="SQT.downloadQuery(); SQT.closeAllDropdowns();">
                            <i class="bi bi-download"></i>
                            <span>Download SQL File</span>
                        </div>
                        <div class="sqt-toolbar-dropdown-divider"></div>
                        <div class="sqt-toolbar-dropdown-item" onclick="SQT.showDocGenModal(); SQT.closeAllDropdowns();">
                            <i class="bi bi-file-earmark-pdf"></i>
                            <span>Generate Document</span>
                        </div>
                        <!-- SQT-PLUGIN:more-dropdown -->
                    </div>
                </div>
                <input type="file" id="sqlFileInput" accept=".sql,.txt" style="display: none;" onchange="SQT.handleFileSelect(event)">
            </div>

            <div class="sqt-toolbar-divider" id="toolbarTablesDivider"></div>

            <div class="sqt-toolbar-group" id="toolbarTablesGroup">
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.openTablesReference()">
                    <i class="bi bi-table"></i>
                    <span>Tables</span>
                </button>
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.openSchemaExplorer()">
                    <i class="bi bi-diagram-3"></i>
                    <span>Schema</span>
                </button>
                ${localLibraryButtons}
                ${workbooksButton}
            </div>
            <!-- SQT-PLUGIN:toolbar-end -->

            <div style="flex: 1;"></div>

            <div class="sqt-toolbar-group" style="position: relative;">
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm sqt-btn-icon" onclick="SQT.toggleOptions()" title="Query options">
                    <i class="bi bi-gear"></i>
                </button>
                ${generateOptionsPanel()}
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm sqt-btn-icon" onclick="SQT.showUndoHistory()" title="Edit history">
                    <i class="bi bi-clock-history"></i>
                </button>
                <div class="sqt-history-dropdown" id="undoHistoryDropdown">
                    <div class="sqt-history-dropdown-header">
                        <span>Edit History</span>
                        <button type="button" class="btn btn-sm btn-link p-0" onclick="SQT.closeUndoHistory()">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>
                    <div id="undoHistoryList"></div>
                </div>
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm sqt-btn-icon" onclick="SQT.toggleFocusMode()" title="Toggle focus mode (hide NetSuite chrome)">
                    <i class="bi bi-arrows-fullscreen" id="focusModeIcon"></i>
                </button>
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm sqt-btn-icon" onclick="SQT.toggleSidebar()" title="Toggle query history">
                    <i class="bi bi-layout-sidebar-inset" id="sidebarIcon"></i>
                </button>
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm sqt-btn-icon" onclick="SQT.toggleTheme()" title="Toggle dark mode">
                    <i class="bi bi-moon-stars" id="themeIcon"></i>
                </button>
                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm sqt-btn-icon" onclick="SQT.showShortcuts()" title="Keyboard shortcuts (?)">
                    <i class="bi bi-question-circle"></i>
                </button>
            </div>
        </div>
    `;
}

/**
 * Generates the options dropdown panel.
 * @returns {string} HTML for options panel
 */
function generateOptionsPanel() {
    return `
        <div class="sqt-options-panel" id="optionsPanel">
            <div class="sqt-options-section">
                <div class="sqt-options-label">Pagination</div>
                <div class="sqt-option-row">
                    <input type="checkbox" id="optPagination" onchange="SQT.updateOptions()">
                    <label for="optPagination">Enable pagination</label>
                </div>
                <div class="sqt-option-row" id="rowRangeOptions" style="display: none;">
                    <span style="font-size: 12px;">Rows:</span>
                    <input type="number" id="optRowBegin" value="1" min="1">
                    <span style="font-size: 12px;">to</span>
                    <input type="number" id="optRowEnd" value="${CONFIG.ROWS_RETURNED_DEFAULT}">
                </div>
                <div class="sqt-option-row" id="returnAllOption" style="display: none;">
                    <input type="checkbox" id="optReturnAll" onchange="SQT.updateOptions()">
                    <label for="optReturnAll">Return all rows</label>
                </div>
                <div class="sqt-option-row" id="showTotalsOption" style="display: none;">
                    <input type="checkbox" id="optShowTotals">
                    <label for="optShowTotals">Show total row count</label>
                </div>
            </div>

            <div class="sqt-options-section">
                <div class="sqt-options-label">Display</div>
                <div class="sqt-option-row">
                    <input type="checkbox" id="optHideRowNumbers" onchange="SQT.refreshResults()">
                    <label for="optHideRowNumbers">Hide row numbers</label>
                </div>
                <div class="sqt-option-row">
                    <input type="checkbox" id="optShowStats" onchange="SQT.refreshResults()">
                    <label for="optShowStats">Show column statistics</label>
                </div>
                <div class="sqt-option-row">
                    <input type="checkbox" id="optAllowHtml" onchange="SQT.refreshResults()">
                    <label for="optAllowHtml">Render HTML in results</label>
                </div>
                <div class="sqt-option-row">
                    <input type="checkbox" id="optRecordLinks" checked onchange="SQT.toggleRecordLinks()">
                    <label for="optRecordLinks">Link IDs to records</label>
                </div>
                <div class="sqt-option-row" style="margin-top: 8px;">
                    <label for="optPinColumns" style="font-size: 12px; margin-right: 8px;">Pin columns:</label>
                    <select id="optPinColumns" onchange="SQT.refreshResults()" style="padding: 4px 8px; border: 1px solid var(--sqt-border); border-radius: 4px; background: var(--sqt-bg-secondary); color: var(--sqt-text-primary); font-size: 12px;">
                        <option value="0">None</option>
                        <option value="1">First 1</option>
                        <option value="2">First 2</option>
                        <option value="3">First 3</option>
                    </select>
                </div>
            </div>

            <div class="sqt-options-section">
                <div class="sqt-options-label">NULL Values</div>
                <div class="sqt-option-row">
                    <select id="optNullDisplay" onchange="SQT.refreshResults()" style="width: 100%; padding: 4px 8px; border: 1px solid var(--sqt-border); border-radius: 4px; background: var(--sqt-bg-secondary); color: var(--sqt-text-primary); font-size: 12px;">
                        <option value="dimmed">Show dimmed</option>
                        <option value="null">Show "null"</option>
                        <option value="blank">Show blank</option>
                    </select>
                </div>
            </div>

            <div class="sqt-options-section">
                <div class="sqt-options-label">Editor</div>
                <div class="sqt-option-row">
                    <input type="checkbox" id="optAutocomplete" onchange="SQT.toggleAutocomplete()">
                    <label for="optAutocomplete">Enable table/column autocomplete</label>
                </div>
                <div class="sqt-option-row" id="schemaAutocompleteRow" style="margin-left: 20px; display: none;">
                    <input type="checkbox" id="optSchemaAutocomplete" onchange="SQT.toggleSchemaAutocomplete()">
                    <label for="optSchemaAutocomplete">Use full schema <span style="opacity: 0.7; font-size: 11px;">(from Schema Explorer)</span></label>
                </div>
                <div class="sqt-option-row" style="margin-top: 8px;">
                    <label for="optFontSize" style="font-size: 12px; margin-right: 8px;">Font size:</label>
                    <select id="optFontSize" onchange="SQT.changeEditorFontSize()" style="padding: 4px 8px; border: 1px solid var(--sqt-border); border-radius: 4px; background: var(--sqt-bg-secondary); color: var(--sqt-text-primary); font-size: 12px;">
                        <option value="10">Extra Small (10px)</option>
                        <option value="11">Small (11px)</option>
                        <option value="12" selected>Medium (12px)</option>
                        <option value="14">Large (14px)</option>
                        <option value="16">Extra Large (16px)</option>
                    </select>
                </div>
            </div>

            <div class="sqt-options-section">
                <div class="sqt-options-label">Toolbar</div>
                <div class="sqt-option-row">
                    <input type="checkbox" id="optCompactToolbar" onchange="SQT.toggleCompactToolbar()">
                    <label for="optCompactToolbar">Compact mode (icons only)</label>
                </div>
                <div class="sqt-options-label" style="margin-top: 12px; font-size: 10px;">Show/Hide Items</div>
                <div class="sqt-option-row">
                    <input type="checkbox" id="optShowFormat" checked onchange="SQT.updateToolbarVisibility()">
                    <label for="optShowFormat">Format</label>
                </div>
                ${CONFIG.AI_ENABLED ? `
                <div class="sqt-option-row">
                    <input type="checkbox" id="optShowAI" checked onchange="SQT.updateToolbarVisibility()">
                    <label for="optShowAI">AI</label>
                </div>
                ` : ''}
                <div class="sqt-option-row">
                    <input type="checkbox" id="optShowMore" checked onchange="SQT.updateToolbarVisibility()">
                    <label for="optShowMore">More</label>
                </div>
                <div class="sqt-option-row">
                    <input type="checkbox" id="optShowTables" checked onchange="SQT.updateToolbarVisibility()">
                    <label for="optShowTables">Tables</label>
                </div>
            </div>

            ${CONFIG.QUERY_FOLDER_ID ? `
            <div class="sqt-options-section">
                <div class="sqt-options-label">Virtual Views</div>
                <div class="sqt-option-row">
                    <input type="checkbox" id="optEnableViews" checked>
                    <label for="optEnableViews">Enable virtual views</label>
                </div>
            </div>
            ` : ''}

            <div class="sqt-options-section">
                <div class="sqt-options-label">Advanced</div>
                <div class="sqt-option-row">
                    <input type="checkbox" id="optDisableCache">
                    <label for="optDisableCache" title="Injects a unique identifier into each query to bypass Oracle's query cache, ensuring fresh results from the database. Helpful when benchmarking query performance to ensure caching isn't impacting execution times.">Force cache miss</label>
                </div>
            </div>

            <!-- SQT-PLUGIN:options-panel -->
        </div>
    `;
}

/**
 * Generates the empty state for results panel.
 * @returns {string} HTML for empty state
 */
function generateEmptyState() {
    return `
        <div class="sqt-empty-state" id="emptyState">
            <i class="bi bi-terminal"></i>
            <h3>Ready to query</h3>
            <p>Write a SuiteQL query above and click <strong>Run Query</strong> or press <span class="sqt-kbd">Ctrl</span> + <span class="sqt-kbd">Enter</span></p>
        </div>
    `;
}

/**
 * Generates the status bar.
 * @returns {string} HTML for status bar
 */
function generateStatusBar() {
    return `
        <footer class="sqt-statusbar">
            <div class="sqt-statusbar-left">
                <div class="sqt-status-indicator">
                    <div class="sqt-status-dot" id="statusDot"></div>
                    <span id="statusText">Ready</span>
                </div>
                <!-- SQT-PLUGIN:status-bar -->
            </div>
            <div class="sqt-statusbar-center">
                <span>SuiteQL Query Tool v${CONFIG.VERSION}</span>
                <span class="sqt-statusbar-separator">|</span>
                <span>Developed by <a href="https://timdietrich.me" target="_blank" rel="noopener">Tim Dietrich</a></span>
            </div>
            <div class="sqt-statusbar-right">
                <span id="cursorPosition">Ln 1, Col 1</span>
            </div>
        </footer>
    `;
}

/**
 * Generates modal dialogs.
 * @returns {string} HTML for modals
 */
function generateModals() {
    return `
        <!-- Local Library Modal -->
        <div class="modal fade" id="localLibraryModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h4 class="modal-title" style="font-size: 1.35rem;">Local Query Library</h4>
                        <!-- SQT-PLUGIN:local-library-actions -->
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="localLibraryContent">
                        <div class="sqt-loading">
                            <div class="sqt-spinner"></div>
                            <span>Loading queries...</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Remote Library Modal -->
        <div class="modal fade" id="remoteLibraryModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h4 class="modal-title" style="font-size: 1.35rem;">SuiteQL Query Library</h4>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="remoteLibraryContent">
                        <div class="sqt-loading">
                            <div class="sqt-spinner"></div>
                            <span>Loading query library...</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Save Query Modal -->
        <div class="modal fade" id="saveModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Save Query</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="saveFileName" class="form-label">File Name</label>
                            <input type="text" class="form-control" id="saveFileName" placeholder="my-query.sql">
                        </div>
                        <div class="mb-3">
                            <label for="saveDescription" class="form-label">Description</label>
                            <input type="text" class="form-control" id="saveDescription" placeholder="Optional description">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="SQT.saveQuery()">Save Query</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Workbooks Modal -->
        <div class="modal fade" id="workbooksModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Workbooks</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="workbooksContent">
                        <div class="sqt-loading">
                            <div class="sqt-spinner"></div>
                            <span>Loading workbooks...</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Help Modal -->
        <div class="modal fade" id="helpModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Keyboard Shortcuts</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <table class="table table-sm">
                            <tbody>
                                <tr>
                                    <td><span class="sqt-kbd">Ctrl</span> + <span class="sqt-kbd">Enter</span></td>
                                    <td>Run query</td>
                                </tr>
                                <tr>
                                    <td><span class="sqt-kbd">Ctrl</span> + <span class="sqt-kbd">S</span></td>
                                    <td>Save query</td>
                                </tr>
                                <tr>
                                    <td><span class="sqt-kbd">Ctrl</span> + <span class="sqt-kbd">Shift</span> + <span class="sqt-kbd">F</span></td>
                                    <td>Format query</td>
                                </tr>
                                <tr>
                                    <td><span class="sqt-kbd">Ctrl</span> + <span class="sqt-kbd">/</span></td>
                                    <td>Toggle comment</td>
                                </tr>
                                <tr>
                                    <td><span class="sqt-kbd">Esc</span></td>
                                    <td>Exit focus mode</td>
                                </tr>
                            </tbody>
                        </table>
                        <hr>
                        <p class="text-muted small mb-0">
                            SuiteQL Query Tool v${CONFIG.VERSION}<br>
                            Developed by <a href="https://timdietrich.me" target="_blank">Tim Dietrich</a>
                        </p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Export Options Modal -->
        <div class="modal fade" id="exportModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Export Results</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="d-grid gap-2">
                            <button type="button" class="btn btn-outline-primary" onclick="SQT.exportAs('xlsx')">
                                <i class="bi bi-file-earmark-excel me-2"></i>Export as Excel (.xlsx)
                            </button>
                            <button type="button" class="btn btn-outline-primary" onclick="SQT.exportAs('csv')">
                                <i class="bi bi-filetype-csv me-2"></i>Export as CSV
                            </button>
                            <button type="button" class="btn btn-outline-primary" onclick="SQT.exportAs('json')">
                                <i class="bi bi-filetype-json me-2"></i>Export as JSON
                            </button>
                            <button type="button" class="btn btn-outline-primary" onclick="SQT.copyToClipboard()">
                                <i class="bi bi-clipboard me-2"></i>Copy to Clipboard
                            </button>
                            <hr class="my-2">
                            <button type="button" class="btn btn-outline-primary" onclick="SQT.showAirtableExportModal()">
                                <i class="bi bi-cloud-upload me-2"></i>Export to Airtable
                            </button>
                            <button type="button" class="btn btn-outline-primary" onclick="SQT.showGoogleSheetsExportModal()">
                                <i class="bi bi-file-earmark-spreadsheet me-2"></i>Export to Google Sheets
                            </button>
                            <!-- SQT-PLUGIN:export-menu -->
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Chart Visualization Modal -->
        <div class="modal fade" id="chartModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 18px; font-weight: 600;"><i class="bi bi-bar-chart-line me-2"></i>Visualize Results</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        ${CONFIG.AI_ENABLED ? `
                        <!-- AI Description Input -->
                        <div class="mb-3">
                            <label class="form-label">Describe your chart (AI-assisted)</label>
                            <div class="input-group">
                                <input type="text" id="chartAIInput" class="form-control"
                                       placeholder="e.g., pie chart of sales by region"
                                       onkeydown="if(event.key==='Enter'){SQT.generateChartFromDescription();}">
                                <button type="button" id="chartAIBtn" class="btn btn-primary"
                                        onclick="SQT.generateChartFromDescription()">
                                    <i class="bi bi-stars"></i> Generate
                                </button>
                            </div>
                        </div>
                        <hr>
                        ` : ''}

                        <!-- Manual Configuration -->
                        <div class="row mb-3">
                            <!-- Chart Type -->
                            <div class="col-12 mb-3">
                                <label class="form-label">Chart Type</label>
                                <div class="sqt-chart-type-selector">
                                    <button type="button" class="sqt-chart-type-btn active" data-type="bar" onclick="SQT.setChartType('bar')">
                                        <i class="bi bi-bar-chart"></i> Bar
                                    </button>
                                    <button type="button" class="sqt-chart-type-btn" data-type="line" onclick="SQT.setChartType('line')">
                                        <i class="bi bi-graph-up"></i> Line
                                    </button>
                                    <button type="button" class="sqt-chart-type-btn" data-type="pie" onclick="SQT.setChartType('pie')">
                                        <i class="bi bi-pie-chart"></i> Pie
                                    </button>
                                    <button type="button" class="sqt-chart-type-btn" data-type="doughnut" onclick="SQT.setChartType('doughnut')">
                                        <i class="bi bi-circle"></i> Doughnut
                                    </button>
                                    <button type="button" class="sqt-chart-type-btn" data-type="polarArea" onclick="SQT.setChartType('polarArea')">
                                        <i class="bi bi-bullseye"></i> Polar
                                    </button>
                                </div>
                            </div>

                            <!-- Label Column -->
                            <div class="col-md-6 mb-3">
                                <label class="form-label">Labels (X-Axis)</label>
                                <select id="chartLabelColumn" class="form-select" onchange="SQT.onLabelColumnChange(this)">
                                    <option value="">Select column...</option>
                                </select>
                            </div>

                            <!-- Value Columns -->
                            <div class="col-md-6 mb-3">
                                <label class="form-label">Values (Y-Axis)</label>
                                <div id="chartValueColumns" class="sqt-chart-value-list">
                                    <!-- Checkboxes populated dynamically -->
                                </div>
                            </div>
                        </div>

                        <!-- Chart Preview -->
                        <div class="sqt-chart-preview">
                            <canvas id="chartCanvas"></canvas>
                            <div class="sqt-chart-empty" id="chartEmpty">
                                <i class="bi bi-bar-chart-line"></i>
                                <p>Select columns to generate chart</p>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" onclick="SQT.exportChartPNG()" id="chartExportBtn" disabled>
                            <i class="bi bi-download me-1"></i>Export PNG
                        </button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Row Details Modal -->
        <div class="modal fade" id="rowDetailsModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Row Details</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body sqt-row-details" id="rowDetailsContent">
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="SQT.prevRow()">
                            <i class="bi bi-chevron-left"></i> Previous
                        </button>
                        <span class="mx-2" id="rowDetailsIndex">Row 1 of 1</span>
                        <button type="button" class="btn btn-secondary" onclick="SQT.nextRow()">
                            Next <i class="bi bi-chevron-right"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Share Query Modal -->
        <div class="modal fade" id="shareModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Share Query</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="text-muted small">Copy this URL to share your query. Anyone with access to this tool can open it.</p>
                        <div class="sqt-share-url" id="shareUrl"></div>
                        <button type="button" class="btn btn-primary mt-3 w-100" onclick="SQT.copyShareUrl()">
                            <i class="bi bi-clipboard me-2"></i>Copy URL
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Keyboard Shortcuts Modal -->
        <div class="modal fade" id="shortcutsModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h4 class="modal-title" style="font-size: 1.35rem;"><i class="bi bi-keyboard me-2"></i>Keyboard Shortcuts</h4>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="sqt-shortcuts-grid">
                            <div>
                                <h6 class="mb-3">Query Execution</h6>
                                <div class="sqt-shortcut-item">
                                    <span>Run Query</span>
                                    <div class="sqt-shortcut-keys">
                                        <span class="sqt-shortcut-key">Ctrl</span>
                                        <span class="sqt-shortcut-key">Enter</span>
                                    </div>
                                </div>
                                <div class="sqt-shortcut-item">
                                    <span>Format Query</span>
                                    <div class="sqt-shortcut-keys">
                                        <span class="sqt-shortcut-key">Ctrl</span>
                                        <span class="sqt-shortcut-key">Shift</span>
                                        <span class="sqt-shortcut-key">F</span>
                                    </div>
                                </div>
                                <div class="sqt-shortcut-item">
                                    <span>Save Query</span>
                                    <div class="sqt-shortcut-keys">
                                        <span class="sqt-shortcut-key">Ctrl</span>
                                        <span class="sqt-shortcut-key">S</span>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <h6 class="mb-3">Editor</h6>
                                <div class="sqt-shortcut-item">
                                    <span>Undo</span>
                                    <div class="sqt-shortcut-keys">
                                        <span class="sqt-shortcut-key">Ctrl</span>
                                        <span class="sqt-shortcut-key">Z</span>
                                    </div>
                                </div>
                                <div class="sqt-shortcut-item">
                                    <span>Redo</span>
                                    <div class="sqt-shortcut-keys">
                                        <span class="sqt-shortcut-key">Ctrl</span>
                                        <span class="sqt-shortcut-key">Shift</span>
                                        <span class="sqt-shortcut-key">Z</span>
                                    </div>
                                </div>
                                <div class="sqt-shortcut-item">
                                    <span>Autocomplete</span>
                                    <div class="sqt-shortcut-keys">
                                        <span class="sqt-shortcut-key">Ctrl</span>
                                        <span class="sqt-shortcut-key">Space</span>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <h6 class="mb-3">Navigation</h6>
                                <div class="sqt-shortcut-item">
                                    <span>Maximize Results</span>
                                    <div class="sqt-shortcut-keys">
                                        <span class="sqt-shortcut-key">Shift</span>
                                        <span class="sqt-shortcut-key">R</span>
                                    </div>
                                </div>
                                <div class="sqt-shortcut-item">
                                    <span>Exit Focus/Maximized</span>
                                    <div class="sqt-shortcut-keys">
                                        <span class="sqt-shortcut-key">Esc</span>
                                    </div>
                                </div>
                                <div class="sqt-shortcut-item">
                                    <span>Previous Row (in details)</span>
                                    <div class="sqt-shortcut-keys">
                                        <span class="sqt-shortcut-key">←</span>
                                    </div>
                                </div>
                                <div class="sqt-shortcut-item">
                                    <span>Next Row (in details)</span>
                                    <div class="sqt-shortcut-keys">
                                        <span class="sqt-shortcut-key">→</span>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <h6 class="mb-3">Other</h6>
                                <div class="sqt-shortcut-item">
                                    <span>Show Shortcuts</span>
                                    <div class="sqt-shortcut-keys">
                                        <span class="sqt-shortcut-key">?</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="mt-3 text-muted small">
                            <i class="bi bi-info-circle me-1"></i>
                            On Mac, use <span class="sqt-shortcut-key">Cmd</span> instead of <span class="sqt-shortcut-key">Ctrl</span>
                        </div>
                        <hr class="my-3">
                        <p class="text-muted small mb-0">
                            SuiteQL Query Tool v${CONFIG.VERSION}<br>
                            Developed by <a href="https://timdietrich.me" target="_blank">Tim Dietrich</a>
                        </p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Parameters Modal -->
        <div class="modal fade" id="parametersModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 18px; font-weight: 600;"><i class="bi bi-input-cursor-text me-2"></i>Query Parameters</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="parametersContent">
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="SQT.runWithParameters()">
                            <i class="bi bi-play-fill me-1"></i>Run Query
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Document Generator Modal -->
        <div class="modal fade" id="docGenModal" tabindex="-1">
            <div class="modal-dialog modal-xl" id="docGenModalDialog">
                <div class="modal-content">
                    <div class="modal-header d-flex justify-content-between align-items-center">
                        <h5 class="modal-title mb-0" style="font-size: 18px; font-weight: 600;">
                            <i class="bi bi-file-earmark-pdf me-2"></i>Document Generator
                            <span class="badge bg-secondary ms-2 fw-normal" id="docGenProjectBadge" style="display: none; font-size: 11px;"></span>
                        </h5>
                        <div class="d-flex align-items-center" style="gap: 8px;">
                            <button type="button" class="btn btn-sm btn-outline-secondary" onclick="SQT.toggleDocGenFullscreen()" title="Toggle fullscreen" id="docGenFullscreenBtn">
                                <i class="bi bi-arrows-fullscreen"></i>
                            </button>
                            <button type="button" class="btn-close m-0" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                    </div>
                    <div class="modal-body">
                        <div class="row">
                            <!-- Left Panel: Settings -->
                            <div class="col-md-4">
                                <!-- Saved Projects Section -->
                                <div class="mb-3">
                                    <label class="form-label fw-semibold">Saved Projects</label>
                                    <div class="input-group input-group-sm">
                                        <select class="form-select" id="docGenProjectSelect" onchange="SQT.loadDocGenProject()">
                                            <option value="">-- New Document --</option>
                                        </select>
                                        <button type="button" class="btn btn-outline-danger" onclick="SQT.deleteDocGenProject()" title="Delete selected project" id="docGenDeleteBtn" disabled>
                                            <i class="bi bi-trash"></i>
                                        </button>
                                    </div>
                                </div>

                                <hr class="my-3">

                                <div class="mb-3">
                                    <label class="form-label fw-semibold">Output Format</label>
                                    <div class="btn-group w-100" role="group">
                                        <input type="radio" class="btn-check" name="docGenFormat" id="docGenPdf" value="pdf" checked>
                                        <label class="btn btn-outline-primary" for="docGenPdf">
                                            <i class="bi bi-file-earmark-pdf me-1"></i>PDF
                                        </label>
                                        <input type="radio" class="btn-check" name="docGenFormat" id="docGenHtml" value="html">
                                        <label class="btn btn-outline-primary" for="docGenHtml">
                                            <i class="bi bi-filetype-html me-1"></i>HTML
                                        </label>
                                    </div>
                                </div>

                                <div class="mb-3">
                                    <label class="form-label fw-semibold">Quick Templates</label>
                                    <select class="form-select form-select-sm" id="docGenTemplateSelect" onchange="SQT.loadDocGenTemplate()">
                                        <option value="">-- Select a template --</option>
                                        <option value="simple-table">Simple Table</option>
                                        <option value="styled-report">Styled Report</option>
                                        <option value="invoice-style">Invoice Style</option>
                                        <option value="master-detail">Master-Detail (Multi-Source)</option>
                                        <option value="custom">Custom Template</option>
                                    </select>
                                </div>

                                <div class="mb-3">
                                    <label class="form-label fw-semibold d-flex justify-content-between align-items-center">
                                        <span>Data Sources</span>
                                        <button type="button" class="btn btn-outline-primary btn-sm py-0 px-2" onclick="SQT.addDocGenDataSource()" title="Add Data Source">
                                            <i class="bi bi-plus"></i> Add
                                        </button>
                                    </label>
                                    <div id="docGenDataSources" class="docgen-datasources">
                                        <!-- Data sources will be populated dynamically -->
                                    </div>
                                </div>

                                <div class="mb-3">
                                    <label class="form-label fw-semibold">FreeMarker Reference</label>
                                    <div class="alert alert-info small py-2 mb-0" id="docGenDataSourceInfo">
                                        <i class="bi bi-info-circle me-1"></i>
                                        <strong>Available Variables:</strong><br>
                                        <div id="docGenAliasReference">
                                            <code>results.records</code> - array of rows<br>
                                            <code>results.columns</code> - column names<br>
                                            <code>results.count</code> - row count
                                        </div>
                                        <hr class="my-2">
                                        <strong>Example:</strong><br>
                                        <code>&lt;#list results.records as row&gt;</code><br>
                                        <code>&nbsp;&nbsp;\${row.columnname!""}</code><br>
                                        <code>&lt;/#list&gt;</code>
                                    </div>
                                </div>

                                <div class="mb-3" id="docGenColumnsSection" style="display: none;">
                                    <label class="form-label fw-semibold">Available Columns</label>
                                    <div class="docgen-columns-list" id="docGenColumnsList"></div>
                                </div>
                            </div>

                            <!-- Right Panel: Template Editor -->
                            <div class="col-md-8">
                                <div class="mb-2 d-flex justify-content-between align-items-center">
                                    <label class="form-label fw-semibold mb-0">Template (HTML + FreeMarker)</label>
                                    <div class="d-flex gap-2">
                                        <!-- AI Generate Button -->
                                        <button type="button" class="btn btn-outline-primary btn-sm" onclick="SQT.showDocGenAIModal()" title="Generate template with AI" id="docGenAIBtn">
                                            <i class="bi bi-stars me-1"></i>AI Generate
                                        </button>
                                        <!-- Snippets Dropdown (custom handling) -->
                                        <div id="docGenSnippetsDropdown">
                                            <button class="btn btn-outline-secondary btn-sm" type="button" id="docGenSnippetsBtn" aria-expanded="false" title="Insert Snippet">
                                                <i class="bi bi-code-square"></i> Snippets <i class="bi bi-chevron-down" style="font-size: 10px;"></i>
                                            </button>
                                            <ul class="dropdown-menu" style="min-width: 280px;">
                                                <li><h6 class="dropdown-header">Loops</h6></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('list-records'); return false;">
                                                    <code>&lt;#list&gt;</code> - Loop through records
                                                </a></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('list-columns'); return false;">
                                                    <code>&lt;#list&gt;</code> - Loop through columns
                                                </a></li>
                                                <li><hr class="dropdown-divider"></li>
                                                <li><h6 class="dropdown-header">Conditionals</h6></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('if-else'); return false;">
                                                    <code>&lt;#if&gt;</code> - If/else block
                                                </a></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('if-has-content'); return false;">
                                                    <code>?has_content</code> - Check if data exists
                                                </a></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('default-value'); return false;">
                                                    <code>!""</code> - Default value for null
                                                </a></li>
                                                <li><hr class="dropdown-divider"></li>
                                                <li><h6 class="dropdown-header">Formatting</h6></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('format-date'); return false;">
                                                    <code>?date</code> - Format as date
                                                </a></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('format-number'); return false;">
                                                    <code>?string</code> - Format number
                                                </a></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('format-currency'); return false;">
                                                    <code>?string.currency</code> - Format as currency
                                                </a></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('upper-lower'); return false;">
                                                    <code>?upper_case</code> - Change case
                                                </a></li>
                                                <li><hr class="dropdown-divider"></li>
                                                <li><h6 class="dropdown-header">Tables</h6></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('dynamic-table'); return false;">
                                                    <i class="bi bi-table me-1"></i> Dynamic table (all columns)
                                                </a></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('row-alternating'); return false;">
                                                    <i class="bi bi-list-ol me-1"></i> Alternating row colors
                                                </a></li>
                                                <li><hr class="dropdown-divider"></li>
                                                <li><h6 class="dropdown-header">Variables</h6></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('current-date'); return false;">
                                                    <code>.now</code> - Current date/time
                                                </a></li>
                                                <li><a class="dropdown-item small" href="#" onclick="SQT.insertDocGenSnippet('assign-var'); return false;">
                                                    <code>&lt;#assign&gt;</code> - Create variable
                                                </a></li>
                                            </ul>
                                        </div>
                                        <div class="btn-group btn-group-sm">
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.formatDocGenTemplate()" title="Format HTML">
                                                <i class="bi bi-code-slash"></i>
                                            </button>
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.validateDocGenTemplate()" title="Validate Template">
                                                <i class="bi bi-check-circle"></i>
                                            </button>
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.previewDocGen()" title="Preview">
                                                <i class="bi bi-eye"></i> Preview
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div class="docgen-editor-wrapper" id="docGenEditorWrapper">
                                    <div class="docgen-editor-toolbar">
                                        <div class="btn-group btn-group-sm">
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.docGenEditorUndo()" title="Undo (Ctrl+Z)">
                                                <i class="bi bi-arrow-counterclockwise"></i>
                                            </button>
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.docGenEditorRedo()" title="Redo (Ctrl+Y)">
                                                <i class="bi bi-arrow-clockwise"></i>
                                            </button>
                                        </div>
                                        <div class="toolbar-separator"></div>
                                        <div class="btn-group btn-group-sm">
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.docGenEditorFind()" title="Find (Ctrl+F)">
                                                <i class="bi bi-search"></i>
                                            </button>
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.docGenEditorReplace()" title="Find & Replace (Ctrl+Shift+F)">
                                                <i class="bi bi-arrow-left-right"></i>
                                            </button>
                                        </div>
                                        <div class="toolbar-separator"></div>
                                        <span class="toolbar-label">Font:</span>
                                        <div class="btn-group btn-group-sm">
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.docGenEditorFontSize(-1)" title="Decrease font size">
                                                <i class="bi bi-dash"></i>
                                            </button>
                                            <span class="font-size-display" id="docGenFontSizeDisplay">12px</span>
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.docGenEditorFontSize(1)" title="Increase font size">
                                                <i class="bi bi-plus"></i>
                                            </button>
                                        </div>
                                        <div class="toolbar-separator"></div>
                                        <div class="btn-group btn-group-sm">
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.docGenEditorToggleWrap()" title="Toggle word wrap" id="docGenWrapBtn">
                                                <i class="bi bi-text-wrap"></i>
                                            </button>
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.docGenEditorFoldAll()" title="Fold all">
                                                <i class="bi bi-arrows-collapse"></i>
                                            </button>
                                            <button type="button" class="btn btn-outline-secondary" onclick="SQT.docGenEditorUnfoldAll()" title="Unfold all">
                                                <i class="bi bi-arrows-expand"></i>
                                            </button>
                                        </div>
                                        <div class="toolbar-separator"></div>
                                        <button type="button" class="btn btn-outline-secondary btn-sm" onclick="SQT.docGenEditorGoToLine()" title="Go to line (Ctrl+G)">
                                            <i class="bi bi-123 me-1"></i>Go to Line
                                        </button>
                                    </div>
                                    <textarea id="docGenTemplate" style="display: none;"></textarea>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer justify-content-between">
                        <button type="button" class="btn btn-outline-secondary" onclick="SQT.showSaveProjectModal()">
                            <i class="bi bi-save me-1"></i>Save Project
                        </button>
                        <div>
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-outline-primary me-2" onclick="SQT.showGenerateSuiteletModal()" id="docGenSuiteletBtn">
                                <i class="bi bi-file-earmark-code me-1"></i>Generate Suitelet
                            </button>
                            <button type="button" class="btn btn-primary" onclick="SQT.generateDocument()" id="docGenSubmitBtn">
                                <i class="bi bi-file-earmark-pdf me-1"></i>Generate Document
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Save Project Modal -->
        <div class="modal fade" id="saveProjectModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 18px; font-weight: 600;">
                            <i class="bi bi-save me-2"></i>Save Document Project
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="projectName" class="form-label">Project Name <span class="text-danger">*</span></label>
                            <input type="text" class="form-control" id="projectName" placeholder="e.g., Customer Invoice Report">
                        </div>
                        <div class="mb-3">
                            <label for="projectDescription" class="form-label">Description</label>
                            <textarea class="form-control" id="projectDescription" rows="2" placeholder="Optional description of this project"></textarea>
                        </div>
                        <div class="alert alert-info small py-2 mb-0">
                            <i class="bi bi-info-circle me-1"></i>
                            Projects are saved to your browser's local storage and will persist across sessions.
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="SQT.saveDocGenProject()">
                            <i class="bi bi-save me-1"></i>Save Project
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- AI Template Generator Modal -->
        <div class="modal fade" id="docGenAIModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 18px; font-weight: 600;">
                            <i class="bi bi-stars me-2"></i>AI Template Generator
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="docGenAIPrompt" class="form-label fw-semibold">Describe your document</label>
                            <textarea class="form-control" id="docGenAIPrompt" rows="4"
                                placeholder="Example: Create a professional invoice with a company header, customer billing information at the top, a table of line items showing item name, quantity, rate, and amount, followed by subtotal, tax, and total at the bottom. Use alternating row colors for the table."></textarea>
                            <div class="form-text">Be specific about layout, sections, and formatting. The AI will use your available data sources and columns.</div>
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-semibold">Available Data Sources</label>
                            <div id="docGenAIDataSourcesInfo" class="small text-muted border rounded p-2 bg-light" style="max-height: 150px; overflow-y: auto;">
                                <!-- Populated dynamically -->
                            </div>
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-semibold">Template Options</label>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" id="docGenAIReplaceTemplate" checked>
                                <label class="form-check-label" for="docGenAIReplaceTemplate">
                                    Replace current template (uncheck to append)
                                </label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" id="docGenAIIncludeStyles" checked>
                                <label class="form-check-label" for="docGenAIIncludeStyles">
                                    Include CSS styles
                                </label>
                            </div>
                        </div>
                        <div id="docGenAIError" class="alert alert-danger small py-2 d-none">
                            <i class="bi bi-exclamation-triangle me-1"></i>
                            <span id="docGenAIErrorText"></span>
                        </div>
                        <div id="docGenAILoading" class="text-center py-3 d-none">
                            <div class="spinner-border text-primary" role="status">
                                <span class="visually-hidden">Generating...</span>
                            </div>
                            <div class="mt-2 text-muted">Generating template... This may take a moment.</div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="SQT.generateDocGenWithAI()" id="docGenAISubmitBtn">
                            <i class="bi bi-stars me-1"></i>Generate Template
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Template Validation Results Modal -->
        <div class="modal fade" id="docGenValidationModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 18px; font-weight: 600;">
                            <i class="bi bi-check-circle me-2"></i>Template Validation Results
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" style="max-height: 400px; overflow-y: auto;">
                        <div id="docGenValidationSummary" class="mb-3">
                            <!-- Summary badge will be inserted here -->
                        </div>
                        <div id="docGenValidationResults">
                            <!-- Validation results will be inserted here -->
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-warning d-none" id="docGenValidationProceedBtn" onclick="SQT.proceedWithGeneration()">
                            <i class="bi bi-exclamation-triangle me-1"></i>Generate Anyway
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Suitelet Generation Options Modal -->
        <div class="modal fade" id="suiteletOptionsModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 18px; font-weight: 600;">
                            <i class="bi bi-gear me-2"></i>Generate Suitelet
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="text-muted small mb-3">
                            Generate a standalone SuiteScript 2.1 Suitelet that executes your queries and renders the document.
                        </p>
                        <div class="mb-3">
                            <label class="form-label fw-semibold">Script ID <span class="text-muted fw-normal">(optional)</span></label>
                            <input type="text" class="form-control" id="suiteletScriptId"
                                   placeholder="customscript_my_report" maxlength="40">
                            <div class="form-text">Used in the JSDoc header. Leave blank for auto-generated.</div>
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-semibold">Commenting Level</label>
                            <select class="form-select" id="suiteletCommentLevel">
                                <option value="none">None - Code only</option>
                                <option value="minimal" selected>Minimal - Section headers</option>
                                <option value="verbose">Verbose - Full documentation</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-semibold">Default Output Mode</label>
                            <select class="form-select" id="suiteletOutputMode">
                                <option value="inline" selected>Inline - Display PDF in browser</option>
                                <option value="download">Download - Prompt to save file</option>
                            </select>
                            <div class="form-text">Can be changed in the generated script.</div>
                        </div>
                        <div id="suiteletParamsInfo" class="alert alert-info small py-2 mb-0" style="display: none;">
                            <i class="bi bi-info-circle me-1"></i>
                            <strong>Detected Parameters:</strong>
                            <div id="suiteletParamsList" class="mt-1 font-monospace"></div>
                            <div class="mt-1 text-muted">These will become URL parameters in the generated Suitelet.</div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="SQT.generateSuiteletCode()">
                            <i class="bi bi-code-slash me-1"></i>Generate Code
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Suitelet Code Preview Modal -->
        <div class="modal fade" id="suiteletPreviewModal" tabindex="-1">
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 18px; font-weight: 600;">
                            <i class="bi bi-file-earmark-code me-2"></i>Generated Suitelet
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-0">
                        <div id="suiteletPreviewWrapper" style="height: 500px; border: 1px solid var(--sqt-border);"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-outline-primary" onclick="SQT.copySuiteletCode()">
                            <i class="bi bi-clipboard me-1"></i>Copy to Clipboard
                        </button>
                        <button type="button" class="btn btn-primary" onclick="SQT.downloadSuiteletCode()">
                            <i class="bi bi-download me-1"></i>Download .js File
                        </button>
                    </div>
                </div>
            </div>
        </div>

        ${CONFIG.AI_ENABLED ? `
        <!-- AI Assistant Modal -->
        <div class="modal fade sqt-ai-modal" id="aiModal" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <div class="sqt-ai-header">
                            <h5 class="modal-title" style="font-size: 18px; font-weight: 600;">
                                <i class="bi bi-robot me-2"></i>AI Assistant
                            </h5>
                            <div class="sqt-ai-header-controls">
                                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm"
                                        onclick="SQT.clearAIConversation()" title="Clear conversation">
                                    <i class="bi bi-trash"></i>
                                </button>
                                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm"
                                        onclick="SQT.showAISettings()" title="AI Settings">
                                    <i class="bi bi-gear"></i>
                                </button>
                            </div>
                        </div>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body sqt-ai-body">
                        <div class="sqt-ai-messages" id="aiMessages">
                            <div class="sqt-ai-welcome">
                                <i class="bi bi-robot"></i>
                                <h4>How can I help you?</h4>
                                <p>Describe the data you need from NetSuite and I'll generate a SuiteQL query for you.</p>
                                <div class="sqt-ai-examples">
                                    <button class="sqt-ai-example" onclick="SQT.useAIExample('Show me all active customers with their sales rep')">
                                        Show me all active customers with their sales rep
                                    </button>
                                    <button class="sqt-ai-example" onclick="SQT.useAIExample('Find invoices from last month over $1000')">
                                        Find invoices from last month over $1000
                                    </button>
                                    <button class="sqt-ai-example" onclick="SQT.useAIExample('List all employees in the Sales department')">
                                        List all employees in the Sales department
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer sqt-ai-footer">
                        <div class="sqt-ai-input-container">
                            <textarea id="aiInput" class="sqt-ai-input"
                                      placeholder="Describe the query you need..."
                                      rows="2"
                                      onkeydown="SQT.handleAIInputKeydown(event)"></textarea>
                            <div class="sqt-ai-input-actions">
                                <div class="sqt-ai-toggle">
                                    <input type="checkbox" id="aiAutoExecute">
                                    <label for="aiAutoExecute">Auto-execute query</label>
                                </div>
                                <button type="button" class="sqt-btn sqt-btn-primary"
                                        onclick="SQT.sendAIMessage()" id="aiSendBtn">
                                    <i class="bi bi-send"></i>
                                    <span>Send</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- AI Settings Modal -->
        <div class="modal fade" id="aiSettingsModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 20px; font-weight: 600;"><i class="bi bi-gear me-2"></i>AI Settings</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="aiProvider" class="form-label">AI Provider</label>
                            <select id="aiProvider" class="form-select" onchange="SQT.updateAIModels()">
                                <option value="">Select a provider...</option>
                                <option value="anthropic">Anthropic (Claude)</option>
                                <option value="openai">OpenAI (GPT)</option>
                                <option value="openai-compatible">OpenAI-Compatible (OpenRouter, etc.)</option>
                                <option value="cohere">Cohere (Command)</option>
                                <option value="xai">xAI (Grok)</option>
                                <option value="gemini">Google (Gemini)</option>
                                <option value="mistral">Mistral AI</option>
                            </select>
                        </div>
                        <div class="mb-3" id="customBaseUrlGroup" style="display: none;">
                            <label for="aiCustomBaseUrl" class="form-label">Base URL</label>
                            <input type="text" id="aiCustomBaseUrl" class="form-control"
                                   placeholder="https://openrouter.ai/api/v1">
                            <div class="form-text">
                                The base URL for the OpenAI-compatible API (without /chat/completions).
                            </div>
                        </div>
                        <div class="mb-3">
                            <label for="aiApiKey" class="form-label">API Key</label>
                            <div class="input-group">
                                <input type="password" id="aiApiKey" class="form-control"
                                       placeholder="Enter your API key">
                                <button class="btn btn-outline-secondary" type="button"
                                        onclick="SQT.toggleApiKeyVisibility()">
                                    <i class="bi bi-eye" id="apiKeyToggleIcon"></i>
                                </button>
                            </div>
                        </div>
                        <div class="mb-3">
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" id="aiRememberKey" checked>
                                <label class="form-check-label" for="aiRememberKey">
                                    Remember my API key
                                </label>
                            </div>
                            <div class="form-text">
                                When enabled, your API key is stored in your browser's local storage.
                            </div>
                        </div>
                        <div class="mb-3">
                            <label for="aiModel" class="form-label">Model</label>
                            <select id="aiModel" class="form-select" disabled>
                                <option value="">Select a provider first...</option>
                            </select>
                        </div>
                        <div class="mb-3" id="customModelGroup" style="display: none;">
                            <label for="aiCustomModel" class="form-label">Model Name</label>
                            <input type="text" id="aiCustomModel" class="form-control"
                                   placeholder="e.g., anthropic/claude-3.5-sonnet">
                            <div class="form-text">
                                Enter the exact model identifier for your chosen provider.
                            </div>
                        </div>
                        <div class="alert alert-info small mb-0">
                            <i class="bi bi-info-circle me-1"></i>
                            Get your API key from
                            <a href="https://console.anthropic.com/" target="_blank">Anthropic Console</a>,
                            <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI Platform</a>,
                            <a href="https://openrouter.ai/keys" target="_blank">OpenRouter</a>,
                            <a href="https://dashboard.cohere.com/api-keys" target="_blank">Cohere Dashboard</a>,
                            <a href="https://console.x.ai/" target="_blank">xAI Console</a>,
                            <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a>, or
                            <a href="https://console.mistral.ai/" target="_blank">Mistral Console</a>.
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="SQT.saveAISettings()">
                            Save Settings
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- AI Debug Modal -->
        <div class="modal fade" id="aiDebugModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 20px; font-weight: 600;">
                            <i class="bi bi-bug me-2"></i>API Debug Information
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
                        <div id="aiDebugContent" style="font-family: monospace; font-size: 12px;">
                            <!-- Debug content will be inserted here -->
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" onclick="SQT.copyDebugInfo()">
                            <i class="bi bi-clipboard me-1"></i>Copy to Clipboard
                        </button>
                    </div>
                </div>
            </div>
        </div>
        ` : ''}

        <!-- Airtable Settings Modal -->
        <div class="modal fade" id="airtableSettingsModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 20px; font-weight: 600;">
                            <i class="bi bi-cloud-upload me-2"></i>Airtable Settings
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="airtableApiToken" class="form-label">Personal Access Token</label>
                            <div class="input-group">
                                <input type="password" id="airtableApiToken" class="form-control"
                                       placeholder="Enter your Airtable Personal Access Token">
                                <button class="btn btn-outline-secondary" type="button"
                                        onclick="SQT.toggleAirtableTokenVisibility()">
                                    <i class="bi bi-eye" id="airtableTokenToggleIcon"></i>
                                </button>
                            </div>
                            <div class="form-text">
                                Create a token at <a href="https://airtable.com/create/tokens" target="_blank">airtable.com/create/tokens</a>
                                with <code>data.records:write</code> and <code>schema.bases:read</code> scopes.
                            </div>
                        </div>
                        <div class="mb-3">
                            <label for="airtableBaseId" class="form-label">Base ID</label>
                            <input type="text" id="airtableBaseId" class="form-control"
                                   placeholder="appXXXXXXXXXXXXXX">
                            <div class="form-text">
                                Find your Base ID in the Airtable URL: airtable.com/<strong>appXXXXXXXXXXXXXX</strong>/...
                            </div>
                        </div>
                        <div class="mb-3">
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" id="airtableRememberCredentials" checked>
                                <label class="form-check-label" for="airtableRememberCredentials">
                                    Remember my credentials
                                </label>
                            </div>
                            <div class="form-text">
                                When enabled, credentials are stored in your browser's local storage.
                            </div>
                        </div>
                        <div class="alert alert-info small mb-0">
                            <i class="bi bi-info-circle me-1"></i>
                            Need help? Visit the <a href="https://airtable.com/developers/web/api/introduction" target="_blank">Airtable API documentation</a>.
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="SQT.saveAirtableSettings()">
                            Save Settings
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Airtable Export Modal -->
        <div class="modal fade" id="airtableExportModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 20px; font-weight: 600;">
                            <i class="bi bi-cloud-upload me-2"></i>Export to Airtable
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <!-- Mode Toggle -->
                        <div class="btn-group w-100 mb-3" role="group">
                            <input type="radio" class="btn-check" name="airtableMode" id="airtableModeCreate" value="create" checked>
                            <label class="btn btn-outline-primary" for="airtableModeCreate">Create New Table</label>
                            <input type="radio" class="btn-check" name="airtableMode" id="airtableModeAppend" value="append">
                            <label class="btn btn-outline-primary" for="airtableModeAppend">Append to Existing</label>
                        </div>

                        <!-- Create New Table View -->
                        <div id="airtableCreateView">
                            <div class="mb-3">
                                <label for="airtableNewTableName" class="form-label">Table Name</label>
                                <input type="text" id="airtableNewTableName" class="form-control"
                                       placeholder="Query Results">
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Field Types (auto-detected)</label>
                                <div id="airtableFieldPreview" class="border rounded p-2" style="max-height: 150px; overflow-y: auto; font-size: 13px;">
                                    <span class="text-muted">Run a query to see field type preview...</span>
                                </div>
                            </div>
                        </div>

                        <!-- Append to Existing View -->
                        <div id="airtableAppendView" style="display: none;">
                            <div class="mb-3">
                                <label for="airtableTableSelect" class="form-label">Select Table</label>
                                <div class="input-group">
                                    <select id="airtableTableSelect" class="form-select">
                                        <option value="">Loading tables...</option>
                                    </select>
                                    <button class="btn btn-outline-secondary" type="button" onclick="SQT.refreshAirtableTables()">
                                        <i class="bi bi-arrow-clockwise"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="alert alert-warning small">
                                <i class="bi bi-exclamation-triangle me-1"></i>
                                Column names must match existing table fields. Mismatched columns will be skipped.
                            </div>
                        </div>

                        <!-- Progress Section (hidden by default) -->
                        <div id="airtableProgress" style="display: none;">
                            <div class="mb-2">
                                <div class="progress" style="height: 20px;">
                                    <div id="airtableProgressBar" class="progress-bar progress-bar-striped progress-bar-animated"
                                         role="progressbar" style="width: 0%">0%</div>
                                </div>
                            </div>
                            <div id="airtableProgressStatus" class="text-center small text-muted">
                                Preparing export...
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" onclick="SQT.showAirtableSettings()">
                            <i class="bi bi-gear"></i>
                        </button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="airtableExportBtn" onclick="SQT.exportToAirtable()">
                            <i class="bi bi-cloud-upload me-1"></i>Export
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Google Sheets Settings Modal -->
        <div class="modal fade" id="googleSheetsSettingsModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 20px; font-weight: 600;">
                            <i class="bi bi-file-earmark-spreadsheet me-2"></i>Google Sheets Settings
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="googleSheetsServiceAccountJson" class="form-label">Service Account JSON Key</label>
                            <textarea id="googleSheetsServiceAccountJson" class="form-control" rows="8"
                                      placeholder="Paste your entire service account JSON key file contents here..."></textarea>
                            <div class="form-text">
                                Download your service account JSON key from the
                                <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank">Google Cloud Console</a>.
                            </div>
                        </div>
                        <div class="mb-3">
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" id="googleSheetsRememberCredentials" checked>
                                <label class="form-check-label" for="googleSheetsRememberCredentials">
                                    Remember my credentials
                                </label>
                            </div>
                            <div class="form-text">
                                When enabled, credentials are stored in your browser's local storage.
                            </div>
                        </div>
                        <div class="alert alert-info small mb-0">
                            <i class="bi bi-info-circle me-1"></i>
                            <strong>Setup:</strong> Create a Service Account in Google Cloud Console, enable the Google Sheets API,
                            download the JSON key, and share your target spreadsheets with the service account email
                            (looks like: <code>name@project.iam.gserviceaccount.com</code>).
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="SQT.saveGoogleSheetsSettings()">
                            Save Settings
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Google Sheets Export Modal -->
        <div class="modal fade" id="googleSheetsExportModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" style="font-size: 20px; font-weight: 600;">
                            <i class="bi bi-file-earmark-spreadsheet me-2"></i>Export to Google Sheets
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <!-- Mode Toggle -->
                        <div class="btn-group w-100 mb-3" role="group">
                            <input type="radio" class="btn-check" name="googleSheetsMode" id="googleSheetsModeCreate" value="create" checked>
                            <label class="btn btn-outline-success" for="googleSheetsModeCreate">Create New Spreadsheet</label>
                            <input type="radio" class="btn-check" name="googleSheetsMode" id="googleSheetsModeAppend" value="append">
                            <label class="btn btn-outline-success" for="googleSheetsModeAppend">Append to Existing</label>
                        </div>

                        <!-- Create New Spreadsheet View -->
                        <div id="googleSheetsCreateView">
                            <div class="mb-3">
                                <label for="googleSheetsNewSpreadsheetName" class="form-label">Spreadsheet Name</label>
                                <input type="text" id="googleSheetsNewSpreadsheetName" class="form-control"
                                       placeholder="Query Results">
                            </div>
                            <div class="mb-3">
                                <label for="googleSheetsNewSheetName" class="form-label">Sheet Name (optional)</label>
                                <input type="text" id="googleSheetsNewSheetName" class="form-control"
                                       placeholder="Sheet1">
                            </div>
                        </div>

                        <!-- Append to Existing View -->
                        <div id="googleSheetsAppendView" style="display: none;">
                            <div class="mb-3">
                                <label for="googleSheetsSpreadsheetId" class="form-label">Spreadsheet ID</label>
                                <input type="text" id="googleSheetsSpreadsheetId" class="form-control"
                                       placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms">
                                <div class="form-text">
                                    Find the ID in your Google Sheets URL:<br>
                                    docs.google.com/spreadsheets/d/<strong>[SPREADSHEET_ID]</strong>/edit
                                </div>
                            </div>
                            <div class="mb-3">
                                <label for="googleSheetsSheetName" class="form-label">Sheet Name (optional)</label>
                                <input type="text" id="googleSheetsSheetName" class="form-control"
                                       placeholder="Sheet1">
                                <div class="form-text">
                                    Leave blank to append to the first sheet.
                                </div>
                            </div>
                            <div class="alert alert-warning small">
                                <i class="bi bi-exclamation-triangle me-1"></i>
                                Make sure you have shared the spreadsheet with your service account email address.
                            </div>
                        </div>

                        <!-- Progress Section (hidden by default) -->
                        <div id="googleSheetsProgress" style="display: none;">
                            <div class="mb-2">
                                <div class="progress" style="height: 20px;">
                                    <div id="googleSheetsProgressBar" class="progress-bar bg-success progress-bar-striped progress-bar-animated"
                                         role="progressbar" style="width: 0%">0%</div>
                                </div>
                            </div>
                            <div id="googleSheetsProgressStatus" class="text-center small text-muted">
                                Preparing export...
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" onclick="SQT.showGoogleSheetsSettings()">
                            <i class="bi bi-gear"></i>
                        </button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-success" id="googleSheetsExportBtn" onclick="SQT.exportToGoogleSheets()">
                            <i class="bi bi-file-earmark-spreadsheet me-1"></i>Export
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- SQT-PLUGIN:modals -->

    `;
}

// =============================================================================
// SECTION 10: CLIENT-SIDE JAVASCRIPT
// =============================================================================

/**
 * Generates client-side code for all loaded plugins.
 * Wraps each plugin's client code in an IIFE for isolation.
 *
 * @param {Array} plugins - Array of loaded plugins
 * @returns {string} JavaScript code string
 */
function generatePluginClientCode(plugins) {
    if (!plugins || plugins.length === 0) {
        return '// No plugins loaded';
    }

    let code = '// Plugin client-side code\n';
    code += '(function initializePlugins() {\n';

    for (const plugin of plugins) {
        if (!plugin.client) continue;

        code += '\n// Plugin: ' + plugin.name + ' v' + plugin.version + '\n';
        code += '(function() {\n';
        code += '    try {\n';

        // Add plugin metadata
        code += '        var pluginMeta = ' + JSON.stringify({
            name: plugin.name,
            version: plugin.version,
            description: plugin.description || ''
        }) + ';\n';

        // Register hooks if defined
        if (plugin.client.hooks) {
            for (const [hookName, hookCode] of Object.entries(plugin.client.hooks)) {
                // hookCode should be a function string or actual function
                code += '        plugins.registerHook("' + hookName + '", "' + plugin.name + '", ';
                if (typeof hookCode === 'function') {
                    code += hookCode.toString();
                } else {
                    code += hookCode;
                }
                code += ');\n';
            }
        }

        // Add plugin initialization code
        if (plugin.client.init) {
            code += '\n        // Plugin initialization\n';
            if (typeof plugin.client.init === 'function') {
                code += '        var initFn = ' + plugin.client.init.toString() + ';\n';
            } else {
                code += '        var initFn = ' + plugin.client.init + ';\n';
            }
            code += '        var pluginApi = initFn(pluginMeta, plugins) || {};\n';
            code += '        plugins.register("' + plugin.name + '", pluginApi);\n';
        } else {
            code += '        plugins.register("' + plugin.name + '", {});\n';
        }

        code += '        console.log("[SQT Plugins] Initialized: ' + plugin.name + '");\n';
        code += '    } catch (e) {\n';
        code += '        console.error("[SQT Plugins] Failed to initialize ' + plugin.name + ':", e);\n';
        code += '        plugins.reportError("' + plugin.name + '", e, { phase: "init" });\n';
        code += '    }\n';
        code += '})();\n';
    }

    code += '})();\n';

    return code;
}

/**
 * Generates the client-side JavaScript.
 * @param {string} scriptUrl - The script URL for AJAX calls
 * @param {Array} plugins - Array of loaded plugins for client-side integration
 * @returns {string} JavaScript in a script tag
 */
function generateClientScript(scriptUrl, plugins) {
    plugins = plugins || [];
    return `
        <script>
        /**
         * SuiteQL Query Tool - Client-Side Application
         */
        const SQT = (function() {
            'use strict';

            // =================================================================
            // STATE
            // =================================================================

            const state = {
                editor: null,
                results: null,
                isRunning: false,
                currentFile: null,
                history: [],
                theme: 'light',
                viewMode: 'table',  // 'table', 'datatable', or 'json'
                sidebarVisible: false,
                focusMode: false,
                resultsMaximized: false,
                autocompleteEnabled: false,
                schemaAutocompleteEnabled: false,
                cachedSchema: null,
                selectedRowIndex: 0,
                executionTimes: [],
                draftSaveTimer: null,
                // AI state
                aiConversation: [],
                aiIsLoading: false,
                aiApiKey: null,  // Session-only key storage when "Remember" is unchecked
                // Error context for AI help
                lastFailedQuery: null,
                lastError: null,
                // Last executed query for AI results chat
                lastExecutedQuery: null,
                // Airtable state
                airtableApiToken: null,  // Session-only token storage when "Remember" is unchecked
                airtableTables: [],
                airtableExportProgress: { total: 0, completed: 0, status: 'idle' },
                // Google Sheets state
                googleSheetsServiceAccount: null,
                googleSheetsToken: null,
                googleSheetsTokenExpiry: null,
                googleSheetsExportProgress: { total: 0, completed: 0, status: 'idle' },
                // Chart state
                chart: null,
                chartConfig: {
                    type: 'bar',
                    labelColumn: null,
                    valueColumns: []
                }
            };

            const CONFIG = {
                SCRIPT_URL: '${scriptUrl}',
                MAX_HISTORY: ${CONFIG.MAX_HISTORY_ENTRIES},
                STORAGE_KEY: 'sqt_history',
                THEME_KEY: 'sqt_theme',
                SIDEBAR_KEY: 'sqt_sidebar',
                DRAFT_KEY: 'sqt_draft',
                TIMES_KEY: 'sqt_execution_times',
                AUTOCOMPLETE_KEY: 'sqt_autocomplete',
                SCHEMA_AUTOCOMPLETE_KEY: 'sqt_schema_autocomplete',
                COMPACT_TOOLBAR_KEY: 'sqt_compact_toolbar',
                TOOLBAR_VISIBILITY_KEY: 'sqt_toolbar_visibility',
                FONT_SIZE_KEY: 'sqt_editor_font_size',
                MAX_EXECUTION_TIMES: 50,
                REMOTE_LIBRARY_URL: '${CONFIG.REMOTE_LIBRARY_URL}',
                // AI keys
                AI_SETTINGS_KEY: 'sqt_ai_settings',
                AI_CONVERSATION_KEY: 'sqt_ai_conversation',
                AI_ENABLED: ${CONFIG.AI_ENABLED},
                AI_RESULTS_CHAT_ENABLED: ${CONFIG.AI_RESULTS_CHAT_ENABLED},
                // Performance
                SLOW_QUERY_THRESHOLD_MS: ${CONFIG.SLOW_QUERY_THRESHOLD_MS},
                // Document Generator
                DOCGEN_PROJECTS_KEY: 'sqt_docgen_projects',
                // Airtable
                AIRTABLE_SETTINGS_KEY: 'sqt_airtable_settings',
                // Google Sheets
                GOOGLE_SHEETS_SETTINGS_KEY: 'sqt_google_sheets_settings',
                // Plugin settings key prefix
                PLUGIN_SETTINGS_PREFIX: 'sqt_plugin_',
                // Record links preference
                RECORD_LINKS_KEY: 'sqt_record_links'
            };

            // =================================================================
            // RECORD LINKS - URL patterns for clickable record IDs
            // =================================================================

            const RECORD_LINKS = {
                // Entity types
                entity: '/app/common/entity/custjob.nl?id=',
                customer: '/app/common/entity/custjob.nl?id=',
                vendor: '/app/common/entity/vendor.nl?id=',
                employee: '/app/common/entity/employee.nl?id=',
                contact: '/app/common/entity/contact.nl?id=',
                partner: '/app/common/entity/partner.nl?id=',
                // Items
                item: '/app/common/item/item.nl?id=',
                // Transactions
                transaction: '/app/accounting/transactions/transaction.nl?id=',
                createdfrom: '/app/accounting/transactions/transaction.nl?id=',
                appliedtotransaction: '/app/accounting/transactions/transaction.nl?id=',
                // Classifications
                subsidiary: '/app/common/otherlists/subsidiarytype.nl?id=',
                department: '/app/common/otherlists/departmenttype.nl?id=',
                class: '/app/common/otherlists/classtype.nl?id=',
                location: '/app/common/otherlists/locationtype.nl?id=',
                // Accounting
                account: '/app/accounting/account/account.nl?id=',
                currency: '/app/common/multicurrency/currency.nl?id=',
                // Other common
                unit: '/app/common/units/unitstype.nl?id=',
                taxitem: '/app/setup/tax/taxtype.nl?id='
            };

            /**
             * Checks if a column name matches a known record link pattern.
             * @param {string} columnName - The column name to check
             * @returns {string|null} The URL pattern or null if no match
             */
            function getRecordLinkPattern(columnName) {
                if (!columnName) return null;
                const col = columnName.toLowerCase();

                // Direct match
                if (RECORD_LINKS[col]) return RECORD_LINKS[col];

                // Suffix matching (e.g., customer_id, entityid, etc.)
                const suffixes = ['_id', 'id', '_internalid', 'internalid'];
                for (const suffix of suffixes) {
                    if (col.endsWith(suffix)) {
                        const base = col.slice(0, -suffix.length);
                        if (RECORD_LINKS[base]) return RECORD_LINKS[base];
                    }
                }

                // Special case: standalone "id" column - link to transaction by default
                // (most common use case in SuiteQL is querying Transaction table)
                if (col === 'id') return RECORD_LINKS.transaction;

                return null;
            }

            /**
             * Validates if a value is a valid record ID (positive integer).
             * @param {*} value - The value to check
             * @returns {boolean} True if valid record ID
             */
            function isValidRecordId(value) {
                if (value === null || value === undefined || value === '') return false;
                const num = parseInt(value, 10);
                return !isNaN(num) && num > 0 && String(num) === String(value).trim();
            }

            // =================================================================
            // PLUGINS
            // =================================================================

            /**
             * Plugin system for extending SuiteQL Query Tool.
             * Plugins can register hooks, add UI elements, and access the API.
             */
            const plugins = {
                // Registry of loaded plugins
                _registry: {},

                // Registered hooks by name
                _hooks: {},

                /**
                 * Registers a plugin with the system.
                 * Called automatically during plugin initialization.
                 */
                register: function(name, pluginApi) {
                    this._registry[name] = pluginApi;
                    console.log('[SQT Plugins] Registered:', name);
                },

                /**
                 * Gets a registered plugin by name.
                 */
                get: function(name) {
                    return this._registry[name];
                },

                /**
                 * Lists all registered plugins.
                 */
                list: function() {
                    return Object.keys(this._registry);
                },

                /**
                 * Registers a hook callback for a plugin.
                 */
                registerHook: function(hookName, pluginName, callback) {
                    if (!this._hooks[hookName]) {
                        this._hooks[hookName] = [];
                    }
                    this._hooks[hookName].push({
                        plugin: pluginName,
                        callback: callback
                    });
                },

                /**
                 * Invokes all registered hooks for a given hook name.
                 * Returns the (potentially modified) data object.
                 */
                invokeHooks: function(hookName, data) {
                    const hooks = this._hooks[hookName] || [];
                    let result = data;

                    for (const hook of hooks) {
                        try {
                            const hookResult = hook.callback(result);
                            if (hookResult !== undefined) {
                                result = hookResult;
                            }
                        } catch (e) {
                            console.error('[SQT Plugins] Hook error in', hook.plugin, 'for', hookName + ':', e);
                            this.reportError(hook.plugin, e, { hook: hookName });
                        }
                    }

                    return result;
                },

                /**
                 * Saves settings for a plugin to localStorage and optionally to server.
                 */
                saveSettings: function(pluginName, settings, saveToServer) {
                    const key = CONFIG.PLUGIN_SETTINGS_PREFIX + pluginName;
                    try {
                        localStorage.setItem(key, JSON.stringify(settings));

                        if (saveToServer) {
                            // Also save to File Cabinet
                            fetch(CONFIG.SCRIPT_URL, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    function: 'pluginSettingsSave',
                                    pluginName: pluginName,
                                    settings: settings
                                })
                            }).catch(e => console.error('[SQT Plugins] Server settings save failed:', e));
                        }

                        return true;
                    } catch (e) {
                        console.error('[SQT Plugins] Settings save failed for', pluginName + ':', e);
                        return false;
                    }
                },

                /**
                 * Loads settings for a plugin from localStorage.
                 */
                loadSettings: function(pluginName) {
                    const key = CONFIG.PLUGIN_SETTINGS_PREFIX + pluginName;
                    try {
                        const stored = localStorage.getItem(key);
                        return stored ? JSON.parse(stored) : null;
                    } catch (e) {
                        console.error('[SQT Plugins] Settings load failed for', pluginName + ':', e);
                        return null;
                    }
                },

                /**
                 * Reports a plugin error for debugging.
                 */
                reportError: function(pluginName, error, context) {
                    console.error('[SQT Plugins] Error in', pluginName + ':', error, context || '');
                    // Could be extended to send to server or show toast
                }
            };

            ${generatePluginClientCode(plugins)}

            // =================================================================
            // INITIALIZATION
            // =================================================================

            function init() {
                initEditor();
                initResizer();
                initTheme();
                initSidebar();
                initAutocomplete();
                initSchemaAutocomplete();
                initRecordLinks();
                initCompactToolbar();
                initToolbarVisibility();
                initEditorFontSize();
                initDragDrop();
                initUndoHistory();
                loadHistory();
                loadExecutionTimes();
                loadDraft();
                checkUrlParams();
                setupKeyboardShortcuts();
                initNLBar();

                // Prevent CodeMirror from stealing focus from NL input
                const nlInput = document.getElementById('nlQueryInput');
                console.log('Setting up NL input focus prevention, element:', nlInput);
                if (nlInput) {
                    // Use capture phase to intercept before CodeMirror
                    nlInput.addEventListener('mousedown', (e) => {
                        console.log('NL input mousedown (capture)');
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                    }, true);
                    nlInput.addEventListener('click', (e) => {
                        console.log('NL input click (capture)');
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        nlInput.focus();
                    }, true);
                    // Also listen on document to refocus if something steals it
                    document.addEventListener('focusin', (e) => {
                        if (e.target !== nlInput && nlInput.matches(':hover')) {
                            console.log('Focus stolen while hovering NL input, refocusing');
                            setTimeout(() => nlInput.focus(), 0);
                        }
                    });
                } else {
                    console.error('nlQueryInput element not found!');
                }

                // Prevent CodeMirror from interfering with AI modal interactions
                const aiModal = document.getElementById('aiModal');
                console.log('Setting up AI modal focus prevention, element:', aiModal);
                if (aiModal) {
                    aiModal.addEventListener('mousedown', (e) => {
                        console.log('AI modal mousedown - stopping propagation');
                        e.stopPropagation();
                    });
                    aiModal.addEventListener('mouseup', (e) => {
                        e.stopPropagation();
                    });
                    aiModal.addEventListener('mousemove', (e) => {
                        e.stopPropagation();
                    });
                }

                // Also protect the AI input field specifically
                const aiInput = document.getElementById('aiInput');
                console.log('Setting up AI input focus prevention, element:', aiInput);
                if (aiInput) {
                    aiInput.addEventListener('mousedown', (e) => {
                        console.log('AI input mousedown (capture)');
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                    }, true);
                    aiInput.addEventListener('click', (e) => {
                        console.log('AI input click (capture)');
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        aiInput.focus();
                    }, true);
                }

                // Close dropdowns when clicking outside
                document.addEventListener('click', (e) => {
                    // Check if click is inside any dropdown or its toggle button
                    const dropdownConfigs = [
                        { id: 'optionsPanel', toggleSelector: '[onclick*="toggleOptions"]' },
                        { id: 'undoHistoryDropdown', toggleSelector: '[onclick*="showUndoHistory"]' },
                        { id: 'aiDropdown', toggleSelector: '[onclick*="toggleAIDropdown"]' },
                        { id: 'moreDropdown', toggleSelector: '[onclick*="toggleMoreDropdown"]' }
                    ];

                    dropdownConfigs.forEach(config => {
                        const dropdown = document.getElementById(config.id);
                        const btn = e.target.closest(config.toggleSelector);
                        if (dropdown && !dropdown.contains(e.target) && !btn) {
                            dropdown.classList.remove('show');
                        }
                    });
                });

                // Plugin hook: onInit - called when app initialization is complete
                plugins.invokeHooks('onInit', { state: state, config: CONFIG });
            }

            // Define custom SQL mode with NetSuite BUILTIN function highlighting
            CodeMirror.defineMode('netsuite-sql', function(config) {
                var sqlMode = CodeMirror.getMode(config, 'text/x-sql');

                return CodeMirror.overlayMode(sqlMode, {
                    token: function(stream) {
                        // Match BUILTIN.functionname pattern (case-insensitive)
                        if (stream.match(/BUILTIN\\.[A-Za-z_][A-Za-z0-9_]*/i)) {
                            return 'builtin';
                        }
                        // Skip to next potential match
                        while (stream.next() != null) {
                            if (stream.match(/BUILTIN/i, false)) break;
                        }
                        return null;
                    }
                });
            });

            function initEditor() {
                const textarea = document.getElementById('queryEditor');
                state.editor = CodeMirror.fromTextArea(textarea, {
                    mode: 'netsuite-sql',
                    theme: state.theme === 'dark' ? 'dracula' : 'eclipse',
                    lineNumbers: true,
                    lineWrapping: true,
                    indentWithTabs: true,
                    tabSize: 4,
                    indentUnit: 4,
                    autofocus: true,
                    matchBrackets: true,
                    autoCloseBrackets: true,
                    inputStyle: 'textarea',  // Fix for Safari Cmd+A selection issues
                    extraKeys: {
                        'Ctrl-Enter': runQuery,
                        'Cmd-Enter': runQuery,
                        'Ctrl-S': (cm) => { showSaveModal(); return false; },
                        'Cmd-S': (cm) => { showSaveModal(); return false; },
                        'Ctrl-Shift-F': formatQuery,
                        'Cmd-Shift-F': formatQuery,
                        'Ctrl-A': 'selectAll',
                        'Cmd-A': 'selectAll',
                        'Tab': (cm) => {
                            if (cm.somethingSelected()) {
                                cm.indentSelection('add');
                            } else {
                                cm.replaceSelection('\\t', 'end');
                            }
                        }
                    }
                });

                // Update cursor position in status bar
                state.editor.on('cursorActivity', () => {
                    const cursor = state.editor.getCursor();
                    document.getElementById('cursorPosition').textContent =
                        \`Ln \${cursor.line + 1}, Col \${cursor.ch + 1}\`;
                });

                // Auto-save draft on change
                state.editor.on('change', () => {
                    saveDraft();
                    // Plugin hook: onEditorChange - called when editor content changes
                    plugins.invokeHooks('onEditorChange', {
                        content: state.editor.getValue()
                    });
                });

                // Safari fix: Manual double-click word selection
                // CodeMirror's built-in double-click handling may not work in Safari
                (function() {
                    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
                    if (!isSafari) return;

                    state.editor.getWrapperElement().addEventListener('dblclick', (e) => {
                        // Get the position where the double-click occurred
                        const pos = state.editor.coordsChar({ left: e.clientX, top: e.clientY });

                        // Find word boundaries at this position
                        const line = state.editor.getLine(pos.line);
                        if (!line) return;

                        // Find word start
                        let start = pos.ch;
                        while (start > 0 && /\\w/.test(line[start - 1])) {
                            start--;
                        }

                        // Find word end
                        let end = pos.ch;
                        while (end < line.length && /\\w/.test(line[end])) {
                            end++;
                        }

                        // Select the word
                        if (end > start) {
                            state.editor.setSelection(
                                { line: pos.line, ch: start },
                                { line: pos.line, ch: end }
                            );
                        }
                    });
                })();

                // Load sample query
                state.editor.setValue(\`SELECT
    ID,
    LastName,
    FirstName,
    Email,
    Phone
FROM
    Employee
WHERE
    IsInactive = 'F'
ORDER BY
    LastName,
    FirstName\`);
            }

            function initResizer() {
                const resizer = document.getElementById('resizer');
                const editorPanel = document.querySelector('.sqt-editor-panel');
                const resultsPanel = document.getElementById('resultsPanel');
                let startY, startEditorHeight, startResultsHeight;

                resizer.addEventListener('mousedown', (e) => {
                    startY = e.clientY;
                    startEditorHeight = editorPanel.offsetHeight;
                    startResultsHeight = resultsPanel.offsetHeight;

                    document.addEventListener('mousemove', resize);
                    document.addEventListener('mouseup', stopResize);
                    document.body.style.cursor = 'row-resize';
                    document.body.style.userSelect = 'none';
                });

                function resize(e) {
                    const delta = e.clientY - startY;
                    const newEditorHeight = startEditorHeight + delta;
                    const newResultsHeight = startResultsHeight - delta;

                    if (newEditorHeight > 100 && newResultsHeight > 100) {
                        editorPanel.style.flex = 'none';
                        editorPanel.style.height = newEditorHeight + 'px';
                        resultsPanel.style.flex = 'none';
                        resultsPanel.style.height = newResultsHeight + 'px';
                        state.editor.refresh();
                    }
                }

                function stopResize() {
                    document.removeEventListener('mousemove', resize);
                    document.removeEventListener('mouseup', stopResize);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                }
            }

            function initTheme() {
                const savedTheme = localStorage.getItem(CONFIG.THEME_KEY) || 'light';
                setTheme(savedTheme);
            }

            function initSidebar() {
                const savedState = localStorage.getItem(CONFIG.SIDEBAR_KEY);
                // Default to hidden (false) unless explicitly saved as 'true'
                state.sidebarVisible = savedState === 'true';
                // Always update visibility on init to apply default or saved state
                updateSidebarVisibility();
            }

            function toggleSidebar() {
                state.sidebarVisible = !state.sidebarVisible;
                localStorage.setItem(CONFIG.SIDEBAR_KEY, state.sidebarVisible);
                updateSidebarVisibility();
            }

            function updateSidebarVisibility() {
                const sidebar = document.getElementById('sidebar');
                const icon = document.getElementById('sidebarIcon');

                if (state.sidebarVisible) {
                    sidebar.classList.remove('collapsed');
                    if (icon) icon.className = 'bi bi-layout-sidebar';
                } else {
                    sidebar.classList.add('collapsed');
                    if (icon) icon.className = 'bi bi-layout-sidebar-inset';
                }

                // Refresh CodeMirror to adjust to new width
                if (state.editor) {
                    setTimeout(() => state.editor.refresh(), 200);
                }
            }

            function toggleFocusMode() {
                state.focusMode = !state.focusMode;
                const app = document.querySelector('.sqt-app');
                const icon = document.getElementById('focusModeIcon');

                if (state.focusMode) {
                    app.classList.add('sqt-focus-mode');
                    if (icon) icon.className = 'bi bi-fullscreen-exit';
                    showToast('info', 'Focus Mode', 'Press the button again or Escape to exit.');
                } else {
                    app.classList.remove('sqt-focus-mode');
                    if (icon) icon.className = 'bi bi-arrows-fullscreen';
                }

                // Refresh CodeMirror to adjust to new size
                if (state.editor) {
                    setTimeout(() => state.editor.refresh(), 200);
                }
            }

            function toggleResultsMaximized() {
                state.resultsMaximized = !state.resultsMaximized;
                const app = document.querySelector('.sqt-app');
                const resultsPanel = document.getElementById('resultsPanel');
                const editorPanel = document.querySelector('.sqt-editor-panel');

                if (state.resultsMaximized) {
                    // Save current heights before maximizing
                    state.savedResultsHeight = resultsPanel?.style.height;
                    state.savedEditorHeight = editorPanel?.style.height;
                    // Clear inline heights so CSS flex rules take effect
                    if (resultsPanel) resultsPanel.style.height = '';
                    if (editorPanel) editorPanel.style.height = '';
                    app.classList.add('sqt-results-maximized');
                    showToast('info', 'Results Maximized', 'Press Shift+R or Escape to restore.');
                } else {
                    app.classList.remove('sqt-results-maximized');
                    // Restore saved heights
                    if (state.savedResultsHeight && resultsPanel) {
                        resultsPanel.style.height = state.savedResultsHeight;
                    }
                    if (state.savedEditorHeight && editorPanel) {
                        editorPanel.style.height = state.savedEditorHeight;
                    }
                    // Refresh CodeMirror when editor is visible again
                    if (state.editor) {
                        setTimeout(() => state.editor.refresh(), 100);
                    }
                }
            }

            function setupKeyboardShortcuts() {
                document.addEventListener('keydown', (e) => {
                    // Don't trigger shortcuts when typing in inputs
                    const isTyping = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

                    // Select all in editor: Cmd+A (macOS)
                    if (e.metaKey && e.key === 'a' && state.editor && state.editor.hasFocus()) {
                        e.preventDefault();
                        state.editor.execCommand('selectAll');
                        return;
                    }

                    // Run query: Ctrl/Cmd + Enter
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        runQuery();
                    }
                    // Exit focus mode or results maximized: Escape
                    if (e.key === 'Escape') {
                        if (state.focusMode) {
                            e.preventDefault();
                            toggleFocusMode();
                        } else if (state.resultsMaximized) {
                            e.preventDefault();
                            toggleResultsMaximized();
                        }
                    }
                    // Toggle results maximized: Shift+R
                    if (e.shiftKey && e.key === 'R' && !isTyping && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        toggleResultsMaximized();
                    }
                    // Navigate row details: Arrow keys
                    if (document.getElementById('rowDetailsModal').classList.contains('show')) {
                        if (e.key === 'ArrowLeft') {
                            e.preventDefault();
                            prevRow();
                        } else if (e.key === 'ArrowRight') {
                            e.preventDefault();
                            nextRow();
                        }
                    }
                    // Show keyboard shortcuts: ?
                    if (e.key === '?' && !isTyping && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        showShortcuts();
                    }
                });
            }

            // =================================================================
            // AUTO-SAVE DRAFT
            // =================================================================

            function loadDraft() {
                try {
                    const draft = localStorage.getItem(CONFIG.DRAFT_KEY);
                    if (draft && state.editor) {
                        // Only load draft if it differs from default sample query
                        const currentValue = state.editor.getValue();
                        if (draft !== currentValue && draft.trim()) {
                            state.editor.setValue(draft);
                        }
                    }
                } catch (e) {
                    console.error('Failed to load draft:', e);
                }
            }

            function saveDraft() {
                // Debounce draft saving
                if (state.draftSaveTimer) {
                    clearTimeout(state.draftSaveTimer);
                }
                state.draftSaveTimer = setTimeout(() => {
                    try {
                        const query = state.editor.getValue();
                        localStorage.setItem(CONFIG.DRAFT_KEY, query);
                    } catch (e) {
                        console.error('Failed to save draft:', e);
                    }
                }, 1000); // Save after 1 second of inactivity
            }

            function clearDraft() {
                try {
                    localStorage.removeItem(CONFIG.DRAFT_KEY);
                } catch (e) {
                    console.error('Failed to clear draft:', e);
                }
            }

            // =================================================================
            // AUTOCOMPLETE
            // =================================================================

            function initAutocomplete() {
                const saved = localStorage.getItem(CONFIG.AUTOCOMPLETE_KEY);
                state.autocompleteEnabled = saved === 'true';
                const checkbox = document.getElementById('optAutocomplete');
                if (checkbox) {
                    checkbox.checked = state.autocompleteEnabled;
                }
                // Apply autocomplete settings to editor if enabled
                if (state.editor && state.autocompleteEnabled) {
                    state.editor.setOption('extraKeys', {
                        ...state.editor.getOption('extraKeys'),
                        'Ctrl-Space': 'autocomplete',
                        'Tab': (cm) => {
                            if (cm.somethingSelected()) {
                                cm.indentSelection('add');
                            } else {
                                cm.replaceSelection('\\t', 'end');
                            }
                        }
                    });
                    state.editor.setOption('hintOptions', {
                        tables: getTableHints(),
                        completeSingle: false
                    });
                }
            }

            function toggleAutocomplete() {
                const checkbox = document.getElementById('optAutocomplete');
                state.autocompleteEnabled = checkbox?.checked || false;
                localStorage.setItem(CONFIG.AUTOCOMPLETE_KEY, state.autocompleteEnabled);

                // Update editor with autocomplete settings
                if (state.editor && state.autocompleteEnabled) {
                    // Enable autocomplete on Ctrl-Space
                    state.editor.setOption('extraKeys', {
                        ...state.editor.getOption('extraKeys'),
                        'Ctrl-Space': 'autocomplete',
                        'Tab': (cm) => {
                            if (cm.somethingSelected()) {
                                cm.indentSelection('add');
                            } else {
                                cm.replaceSelection('\\t', 'end');
                            }
                        }
                    });
                    state.editor.setOption('hintOptions', {
                        tables: getTableHints(),
                        completeSingle: false
                    });
                    showToast('info', 'Autocomplete Enabled', 'Press Ctrl+Space to trigger suggestions.');
                } else if (state.editor) {
                    showToast('info', 'Autocomplete Disabled', 'Code completion is now off.');
                }
                // Update schema autocomplete row visibility
                updateSchemaAutocompleteVisibility();
            }

            function loadSchemaForAutocomplete() {
                // Load schema from IndexedDB (same DB used by Schema Explorer)
                return new Promise((resolve) => {
                    try {
                        const request = indexedDB.open('NetSuiteSchemaExplorer', 1);

                        request.onerror = () => {
                            console.log('Schema Explorer DB not available');
                            resolve(null);
                        };

                        request.onsuccess = () => {
                            const db = request.result;
                            if (!db.objectStoreNames.contains('schema')) {
                                db.close();
                                resolve(null);
                                return;
                            }

                            const transaction = db.transaction(['schema'], 'readonly');
                            const store = transaction.objectStore('schema');
                            const getRequest = store.get('current');

                            getRequest.onsuccess = () => {
                                db.close();
                                if (getRequest.result?.tables) {
                                    state.cachedSchema = getRequest.result;
                                    resolve(getRequest.result);
                                } else {
                                    resolve(null);
                                }
                            };

                            getRequest.onerror = () => {
                                db.close();
                                resolve(null);
                            };
                        };

                        request.onupgradeneeded = () => {
                            // DB doesn't exist yet, user hasn't run Schema Explorer
                            request.transaction.abort();
                            resolve(null);
                        };
                    } catch (e) {
                        console.error('Error loading schema:', e);
                        resolve(null);
                    }
                });
            }

            function updateSchemaAutocompleteVisibility() {
                const row = document.getElementById('schemaAutocompleteRow');
                if (row) {
                    // Show schema option only if autocomplete is enabled AND schema is available
                    const shouldShow = state.autocompleteEnabled && state.cachedSchema?.tables;
                    row.style.display = shouldShow ? 'flex' : 'none';
                }
            }

            function initSchemaAutocomplete() {
                // Load saved preference
                const saved = localStorage.getItem(CONFIG.SCHEMA_AUTOCOMPLETE_KEY);
                state.schemaAutocompleteEnabled = saved === 'true';

                const checkbox = document.getElementById('optSchemaAutocomplete');
                if (checkbox) {
                    checkbox.checked = state.schemaAutocompleteEnabled;
                }

                // Load schema from IndexedDB
                loadSchemaForAutocomplete().then(() => {
                    updateSchemaAutocompleteVisibility();
                    // Refresh hints if autocomplete is already enabled
                    if (state.editor && state.autocompleteEnabled) {
                        state.editor.setOption('hintOptions', {
                            tables: getTableHints(),
                            completeSingle: false
                        });
                    }
                });
            }

            function toggleSchemaAutocomplete() {
                const checkbox = document.getElementById('optSchemaAutocomplete');
                state.schemaAutocompleteEnabled = checkbox?.checked || false;
                localStorage.setItem(CONFIG.SCHEMA_AUTOCOMPLETE_KEY, state.schemaAutocompleteEnabled);

                // Refresh editor hints
                if (state.editor && state.autocompleteEnabled) {
                    state.editor.setOption('hintOptions', {
                        tables: getTableHints(),
                        completeSingle: false
                    });

                    if (state.schemaAutocompleteEnabled && state.cachedSchema?.tables) {
                        const tableCount = state.cachedSchema.tables.length;
                        showToast('success', 'Full Schema Enabled', \`Autocomplete now includes \${tableCount} tables with data types.\`);
                    } else {
                        showToast('info', 'Basic Mode', 'Using standard table/column list.');
                    }
                }
            }

            function initRecordLinks() {
                // Load saved preference (default: true/enabled)
                const saved = localStorage.getItem(CONFIG.RECORD_LINKS_KEY);
                // Default to true if no saved preference
                const enabled = saved === null ? true : saved === 'true';
                const checkbox = document.getElementById('optRecordLinks');
                if (checkbox) {
                    checkbox.checked = enabled;
                }
            }

            function toggleRecordLinks() {
                const checkbox = document.getElementById('optRecordLinks');
                const enabled = checkbox?.checked || false;
                localStorage.setItem(CONFIG.RECORD_LINKS_KEY, enabled);
                refreshResults();
            }

            function initCompactToolbar() {
                const saved = localStorage.getItem(CONFIG.COMPACT_TOOLBAR_KEY);
                const isCompact = saved === 'true';
                const checkbox = document.getElementById('optCompactToolbar');
                if (checkbox) {
                    checkbox.checked = isCompact;
                }
                updateCompactToolbar(isCompact);
            }

            function toggleCompactToolbar() {
                const checkbox = document.getElementById('optCompactToolbar');
                const isCompact = checkbox?.checked || false;
                localStorage.setItem(CONFIG.COMPACT_TOOLBAR_KEY, isCompact);
                updateCompactToolbar(isCompact);
            }

            function updateCompactToolbar(isCompact) {
                const toolbar = document.querySelector('.sqt-toolbar');
                if (toolbar) {
                    toolbar.classList.toggle('sqt-toolbar-compact', isCompact);
                }
            }

            function initToolbarVisibility() {
                const saved = localStorage.getItem(CONFIG.TOOLBAR_VISIBILITY_KEY);
                const defaults = { format: true, ai: true, more: true, tables: true };
                const visibility = saved ? JSON.parse(saved) : defaults;

                // Set checkbox states
                const checkboxes = {
                    format: document.getElementById('optShowFormat'),
                    ai: document.getElementById('optShowAI'),
                    more: document.getElementById('optShowMore'),
                    tables: document.getElementById('optShowTables')
                };

                Object.keys(checkboxes).forEach(key => {
                    if (checkboxes[key]) {
                        checkboxes[key].checked = visibility[key] !== false;
                    }
                });

                applyToolbarVisibility(visibility);
            }

            function updateToolbarVisibility() {
                const visibility = {
                    format: document.getElementById('optShowFormat')?.checked !== false,
                    ai: document.getElementById('optShowAI')?.checked !== false,
                    more: document.getElementById('optShowMore')?.checked !== false,
                    tables: document.getElementById('optShowTables')?.checked !== false
                };

                localStorage.setItem(CONFIG.TOOLBAR_VISIBILITY_KEY, JSON.stringify(visibility));
                applyToolbarVisibility(visibility);
            }

            function applyToolbarVisibility(visibility) {
                const elements = {
                    format: document.getElementById('toolbarFormat'),
                    ai: document.getElementById('toolbarAI'),
                    more: document.getElementById('toolbarMore'),
                    tables: document.getElementById('toolbarTablesGroup'),
                    tablesDivider: document.getElementById('toolbarTablesDivider')
                };

                if (elements.format) elements.format.style.display = visibility.format ? '' : 'none';
                if (elements.ai) elements.ai.style.display = visibility.ai ? '' : 'none';
                if (elements.more) elements.more.style.display = visibility.more ? '' : 'none';
                if (elements.tables) elements.tables.style.display = visibility.tables ? '' : 'none';
                if (elements.tablesDivider) elements.tablesDivider.style.display = visibility.tables ? '' : 'none';
            }

            function initEditorFontSize() {
                const saved = localStorage.getItem(CONFIG.FONT_SIZE_KEY);
                const fontSize = saved || '12';
                const select = document.getElementById('optFontSize');
                if (select) {
                    select.value = fontSize;
                }
                applyEditorFontSize(fontSize);
            }

            function changeEditorFontSize() {
                const select = document.getElementById('optFontSize');
                const fontSize = select?.value || '12';
                localStorage.setItem(CONFIG.FONT_SIZE_KEY, fontSize);
                applyEditorFontSize(fontSize);
            }

            function applyEditorFontSize(fontSize) {
                const cm = document.querySelector('.sqt-editor-container .CodeMirror');
                if (cm) {
                    cm.style.fontSize = fontSize + 'px';
                    // Refresh editor to recalculate line heights
                    if (state.editor) {
                        state.editor.refresh();
                    }
                }
                // Update toolbar font size display
                updateEditorFontSizeDisplay();
            }

            function updateEditorFontSizeDisplay() {
                const display = document.getElementById('editorFontSizeDisplay');
                const select = document.getElementById('optFontSize');
                if (display && select) {
                    display.textContent = select.value + 'px';
                }
            }

            // Query Editor Toolbar Functions
            function editorUndo() {
                if (state.editor) {
                    state.editor.undo();
                    state.editor.focus();
                }
            }

            function editorRedo() {
                if (state.editor) {
                    state.editor.redo();
                    state.editor.focus();
                }
            }

            function editorFind() {
                if (state.editor) {
                    state.editor.execCommand('find');
                }
            }

            function editorReplace() {
                if (state.editor) {
                    state.editor.execCommand('replace');
                }
            }

            function editorFontSize(delta) {
                const select = document.getElementById('optFontSize');
                if (!select) return;

                const sizes = ['10', '11', '12', '13', '14', '16'];
                const currentIndex = sizes.indexOf(select.value);
                const newIndex = Math.max(0, Math.min(sizes.length - 1, currentIndex + delta));

                if (currentIndex !== newIndex) {
                    select.value = sizes[newIndex];
                    localStorage.setItem(CONFIG.FONT_SIZE_KEY, sizes[newIndex]);
                    applyEditorFontSize(sizes[newIndex]);
                }
            }

            function editorToggleWrap() {
                if (!state.editor) return;

                const currentWrap = state.editor.getOption('lineWrapping');
                state.editor.setOption('lineWrapping', !currentWrap);

                const btn = document.getElementById('editorWrapBtn');
                if (btn) {
                    btn.classList.toggle('active', !currentWrap);
                }
            }

            function editorGoToLine() {
                if (state.editor) {
                    state.editor.execCommand('jumpToLine');
                }
            }

            function getTableHints() {
                // If schema autocomplete is enabled and we have cached schema, use it
                if (state.schemaAutocompleteEnabled && state.cachedSchema?.tables) {
                    const hints = {};
                    state.cachedSchema.tables.forEach(table => {
                        // Format columns with data types for display
                        hints[table.id] = table.columns.map(col => ({
                            text: col.id,
                            displayText: \`\${col.id} (\${col.dataType || 'VARCHAR'})\`
                        }));
                    });
                    return hints;
                }

                // Fall back to static NetSuite tables - extracted from query library
                return {
                    'Transaction': ['id', 'tranid', 'trandate', 'entity', 'type', 'status', 'posting', 'voided', 'void', 'duedate', 'foreigntotal', 'foreignamountunpaid', 'foreignamountpaid', 'otherrefnum', 'employee', 'memo', 'postingperiod', 'createdby', 'currency', 'shipdate', 'actualshipdate', 'totalcostestimate', 'estgrossprofit', 'estgrossprofitpercent', 'paymentmethod', 'shipcarrier', 'shippingaddress', 'trackingnumberlist', 'approvalstatus', 'createddate'],
                    'TransactionLine': ['id', 'transaction', 'mainline', 'item', 'quantity', 'rate', 'netamount', 'foreignamount', 'createdfrom', 'linesequencenumber', 'isinventoryaffecting', 'taxline', 'location', 'memo', 'itemtype', 'subsidiary', 'department', 'uniquekey'],
                    'TransactionAccountingLine': ['transaction', 'transactionline', 'account', 'debit', 'credit', 'amount', 'posting', 'amountunpaid', 'paymentamountunused', 'accountingbook'],
                    'Item': ['id', 'itemid', 'itemtype', 'parent', 'description', 'fullname', 'isinactive', 'isonline', 'externalid', 'createddate', 'lastmodifieddate', 'purchasedescription', 'quantityonhand', 'quantityavailable', 'quantitycommitted', 'quantityonorder', 'quantitybackordered', 'reorderpoint', 'preferredstocklevel', 'cost', 'averagecost', 'lastpurchaseprice', 'leadtime', 'matrixtype', 'manufacturer'],
                    'Customer': ['id', 'entityid', 'companyname', 'altname', 'firstname', 'lastname', 'email', 'phone', 'title', 'isperson', 'isinactive', 'terms', 'salesrep', 'creditlimit', 'oncredithold', 'balancesearch', 'overduebalancesearch', 'unbilledorderssearch', 'datecreated', 'lastmodifieddate', 'searchstage', 'defaultshippingaddress'],
                    'Employee': ['id', 'firstname', 'lastname', 'email', 'title', 'isinactive', 'giveaccess', 'supervisor', 'issalesrep'],
                    'Vendor': ['id', 'companyname', 'isinactive', 'accountnumber', 'balance', 'email', 'phone', 'terms', 'contact', 'creditlimit', 'datecreated', 'lastmodifieddate', 'externalid'],
                    'Account': ['id', 'accttype', 'acctnumber', 'displaynamewithHierarchy', 'accountsearchdisplayname', 'balance', 'description', 'isinactive', 'legalname', 'parent'],
                    'AccountingPeriod': ['id', 'periodname', 'parent', 'startdate', 'enddate', 'isposting', 'isadjust', 'isinactive', 'isquarter', 'alllocked', 'arlocked', 'aplocked', 'allownonglchanges', 'lastmodifieddate', 'closed', 'closedondate'],
                    'Entity': ['id', 'type', 'altname', 'entitytitle'],
                    'EntityAddress': ['nkey', 'addressee', 'addr1', 'addr2', 'addr3', 'city', 'state', 'zip', 'country', 'attention'],
                    'EntityAddressbook': ['entity', 'addressbookaddress', 'defaultbilling', 'defaultshipping'],
                    'Bin': ['id', 'binnumber', 'location', 'memo'],
                    'ItemBinQuantity': ['bin', 'item', 'location', 'onhand', 'onhandavail', 'preferredbin'],
                    'Location': ['id', 'name', 'fullname', 'externalid', 'isinactive', 'mainaddress', 'latitude', 'longitude'],
                    'LocationMainAddress': ['nkey', 'addressee', 'addr1', 'addr2', 'addr3', 'city', 'state', 'zip', 'attention'],
                    'Role': ['id', 'name', 'isinactive'],
                    'RolePermissions': ['role', 'name', 'permlevel'],
                    'EmployeeRolesForSearch': ['entity', 'role'],
                    'LoginAudit': ['user', 'date', 'role'],
                    'SupportCase': ['id', 'casenumber', 'startdate', 'company', 'status', 'title', 'issue', 'category', 'assigned', 'origin', 'priority', 'timeelapsed', 'timeopen', 'timetoassign', 'timetoclose'],
                    'ItemPrice': ['item', 'price', 'isinactive', 'pricelevelname'],
                    'ItemVendor': ['item', 'vendor', 'preferredvendor', 'purchaseprice'],
                    'ItemMember': ['item', 'parentitem', 'quantity', 'memberunit'],
                    'AssemblyItemMember': ['parentitem', 'item', 'linenumber', 'quantity', 'memberunit', 'itemsource'],
                    'PreviousTransactionLineLink': ['previousdoc', 'previousline', 'nextdoc', 'nextline', 'nexttype', 'linktype', 'foreignamount'],
                    'NextTransactionLink': ['previousdoc', 'nextdoc', 'linktype'],
                    'Currency': ['id', 'symbol', 'name', 'exchangerate', 'displaysymbol', 'symbolplacement', 'currencyprecision', 'isbasecurrency', 'isinactive'],
                    'CurrencyRate': ['basecurrency', 'transactioncurrency', 'exchangerate', 'effectivedate', 'lastmodifieddate'],
                    'File': ['id', 'name', 'folder', 'createddate', 'lastmodifieddate', 'filetype', 'filesize', 'url'],
                    'MediaItemFolder': ['id', 'name', 'istoplevel', 'appfolder'],
                    'Script': ['scriptid', 'name', 'scripttype', 'owner', 'scriptfile'],
                    'ClientScript': ['id', 'name', 'scriptid', 'description', 'apiversion', 'scriptfile', 'owner', 'isinactive'],
                    'CustomField': ['scriptid', 'name', 'fieldtype', 'fieldvaluetype', 'owner', 'lastmodifieddate'],
                    'CustomList': ['name', 'description', 'scriptid', 'owner', 'isordered', 'isinactive'],
                    'CustomRecordType': ['internalid', 'name', 'scriptid', 'description', 'owner'],
                    'CustomSegment': ['name', 'recordtype', 'glimpact', 'isinactive'],
                    'DeletedRecord': ['deleteddate', 'type', 'recordid', 'deletedby', 'context'],
                    'EmployeeEmergencyContact': ['employee', 'contact', 'relationship', 'address', 'phone'],
                    'CompanyContactRelationship': ['company', 'contact', 'role'],
                    'CompanyFeatureSetup': ['id', 'name', 'isavailable', 'isactive'],
                    'Country': ['id', 'name', 'edition', 'nationality'],
                    'State': ['id', 'shortname', 'fullname', 'country'],
                    'PhoneCall': ['id', 'externalid', 'createddate', 'startdate', 'completeddate', 'owner', 'assigned', 'company', 'contact', 'transaction', 'relateditem', 'supportcase', 'priority', 'status', 'phone', 'title', 'message'],
                    'Pricing': ['pricelevel', 'item', 'priceqty', 'unitprice'],
                    'PriceLevel': ['id', 'name', 'isinactive'],
                    'InventoryNumber': ['item', 'inventorynumber', 'quantityonhand', 'expirationdate'],
                    'AggregateItemLocation': ['item', 'location', 'quantityonhand', 'quantityavailable', 'quantitycommitted', 'quantityonorder', 'quantitybackordered', 'quantityintransit', 'qtyintransitexternal', 'onhandvaluemli', 'averagecostmli', 'lastpurchasepricemli', 'preferredstocklevel', 'leadtime', 'safetystocklevel', 'leadtimeoffset', 'lastinvtcountdate', 'nextinvtcountdate', 'invtcountinterval', 'invtclassification', 'costinglotsize', 'lastquantityavailablechange'],
                    'ItemInventoryBalance': ['item', 'quantityavailable'],
                    'UpsellItem': ['customer', 'purchaseditem', 'item', 'corrrelationfld', 'countfld'],
                    'TransactionShipment': ['doc', 'sourceaddress', 'destinationaddress', 'shippingmethod', 'weight', 'shippingrate', 'handlingrate'],
                    'TrackingNumber': ['id', 'trackingnumber'],
                    'TrackingNumberMap': ['transaction', 'trackingnumber'],
                    'InboundShipment': ['id', 'shipmentstatus', 'expectedshippingdate', 'actualshippingdate', 'expecteddeliverydate', 'shipmentmemo', 'externaldocumentnumber', 'billoflading'],
                    'InboundShipmentItem': ['inboundshipment', 'receivinglocation', 'shipmentitemdescription', 'quantityexpected', 'unit', 'expectedrate', 'purchaseordertransaction', 'shipmentitemtransaction'],
                    'OutboundRequest': ['time', 'key', 'requestid', 'elapsed', 'host', 'port', 'url', 'statuscode', 'error', 'requestcontenttype', 'requestcontentlength', 'responsecontenttype', 'responsecontentlength', 'scriptdeploymenturl', 'scriptid'],
                    'PaymentMethod': ['id', 'name', 'methodtype', 'merchantaccounts', 'isinactive'],
                    'Term': ['id', 'name', 'isinactive'],
                    'AccountSubsidiaryMap': ['account', 'subsidiary'],
                    'Contact': ['id', 'entityid', 'firstname', 'lastname', 'email', 'phone', 'company', 'isinactive'],
                    'Department': ['id', 'name', 'fullname', 'parent', 'isinactive'],
                    'Subsidiary': ['id', 'name', 'fullname', 'parent', 'isinactive', 'country', 'currency'],
                    'Dual': []
                };
            }

            // =================================================================
            // EXECUTION TIME TRACKING
            // =================================================================

            function loadExecutionTimes() {
                try {
                    const saved = localStorage.getItem(CONFIG.TIMES_KEY);
                    if (saved) {
                        state.executionTimes = JSON.parse(saved);
                    }
                } catch (e) {
                    console.error('Failed to load execution times:', e);
                }
            }

            function saveExecutionTime(query, elapsedTime, rowCount) {
                const entry = {
                    query: query.substring(0, 100),
                    elapsedTime,
                    rowCount,
                    timestamp: new Date().toISOString()
                };

                state.executionTimes.unshift(entry);

                // Limit stored entries
                if (state.executionTimes.length > CONFIG.MAX_EXECUTION_TIMES) {
                    state.executionTimes = state.executionTimes.slice(0, CONFIG.MAX_EXECUTION_TIMES);
                }

                try {
                    localStorage.setItem(CONFIG.TIMES_KEY, JSON.stringify(state.executionTimes));
                } catch (e) {
                    console.error('Failed to save execution times:', e);
                }
            }

            // =================================================================
            // QUERY SHARING
            // =================================================================

            function checkUrlParams() {
                const params = new URLSearchParams(window.location.search);
                const sharedQuery = params.get('query');
                if (sharedQuery && state.editor) {
                    try {
                        const query = decodeURIComponent(sharedQuery);
                        state.editor.setValue(query);
                        showToast('info', 'Query Loaded', 'Shared query has been loaded.');
                    } catch (e) {
                        console.error('Failed to load shared query:', e);
                    }
                }
            }

            function showShareModal() {
                const query = state.editor.getValue();
                if (!query.trim()) {
                    showToast('warning', 'No Query', 'Please enter a query to share.');
                    return;
                }

                const encodedQuery = encodeURIComponent(query);
                // Build full URL using current page location
                const baseUrl = window.location.origin + window.location.pathname + window.location.search;
                const separator = baseUrl.includes('?') ? '&' : '?';
                const url = baseUrl + separator + 'query=' + encodedQuery;

                document.getElementById('shareUrl').textContent = url;
                new bootstrap.Modal(document.getElementById('shareModal')).show();
            }

            function copyShareUrl() {
                const url = document.getElementById('shareUrl').textContent;
                navigator.clipboard.writeText(url).then(() => {
                    bootstrap.Modal.getInstance(document.getElementById('shareModal')).hide();
                    showToast('success', 'URL Copied', 'Share URL copied to clipboard.');
                }).catch(err => {
                    showToast('error', 'Copy Failed', 'Failed to copy URL to clipboard.');
                });
            }

            // =================================================================
            // ROW DETAILS
            // =================================================================

            function showRowDetails(index) {
                if (!state.results || !state.results.records || !state.results.records[index]) {
                    return;
                }

                state.selectedRowIndex = index;
                renderRowDetails();
                new bootstrap.Modal(document.getElementById('rowDetailsModal')).show();
            }

            function renderRowDetails() {
                const record = state.results.records[state.selectedRowIndex];
                if (!record) return;

                const columns = Object.keys(record).filter(c => c !== 'rownumber');
                const nullDisplay = document.getElementById('optNullDisplay')?.value || 'dimmed';
                const allowHtml = document.getElementById('optAllowHtml')?.checked;

                let html = '<table class="table table-sm">';
                columns.forEach(col => {
                    const value = record[col];
                    const displayValue = formatCellValue(value, nullDisplay, allowHtml, col);
                    html += \`
                        <tr>
                            <th style="width: 30%; font-weight: 600;">\${escapeHtml(col)}</th>
                            <td style="word-break: break-all;">\${displayValue}</td>
                        </tr>
                    \`;
                });
                html += '</table>';

                document.getElementById('rowDetailsContent').innerHTML = html;
                document.getElementById('rowDetailsIndex').textContent =
                    \`Row \${state.selectedRowIndex + 1} of \${state.results.records.length}\`;
            }

            function prevRow() {
                if (state.selectedRowIndex > 0) {
                    state.selectedRowIndex--;
                    renderRowDetails();
                }
            }

            function nextRow() {
                if (state.results && state.selectedRowIndex < state.results.records.length - 1) {
                    state.selectedRowIndex++;
                    renderRowDetails();
                }
            }

            // =================================================================
            // COLUMN STATISTICS
            // =================================================================

            function calculateColumnStats(records) {
                if (!records || records.length === 0) return null;

                const columns = Object.keys(records[0]).filter(c => c !== 'rownumber');
                const stats = {};

                columns.forEach(col => {
                    const values = records.map(r => r[col]).filter(v => v !== null && v !== undefined);
                    const numericValues = values.filter(v => !isNaN(parseFloat(v)) && isFinite(v)).map(v => parseFloat(v));

                    stats[col] = {
                        count: values.length,
                        nullCount: records.length - values.length,
                        isNumeric: numericValues.length > 0 && numericValues.length === values.length
                    };

                    if (stats[col].isNumeric && numericValues.length > 0) {
                        stats[col].sum = numericValues.reduce((a, b) => a + b, 0);
                        stats[col].min = Math.min(...numericValues);
                        stats[col].max = Math.max(...numericValues);
                        stats[col].avg = stats[col].sum / numericValues.length;
                    }
                });

                return stats;
            }

            function formatStatValue(value, decimals = 2) {
                if (value === undefined || value === null) return '-';
                if (Math.abs(value) >= 1000000) {
                    return (value / 1000000).toFixed(1) + 'M';
                } else if (Math.abs(value) >= 1000) {
                    return (value / 1000).toFixed(1) + 'K';
                } else if (Number.isInteger(value)) {
                    return value.toLocaleString();
                } else {
                    return value.toFixed(decimals);
                }
            }

            // =================================================================
            // FILE IMPORT (DRAG & DROP)
            // =================================================================

            function initDragDrop() {
                const editorPanel = document.querySelector('.sqt-editor-panel');
                const overlay = document.getElementById('dropOverlay');

                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                    editorPanel.addEventListener(eventName, preventDefaults);
                    document.body.addEventListener(eventName, preventDefaults);
                });

                function preventDefaults(e) {
                    e.preventDefault();
                    e.stopPropagation();
                }

                ['dragenter', 'dragover'].forEach(eventName => {
                    editorPanel.addEventListener(eventName, () => {
                        overlay.classList.add('active');
                    });
                });

                ['dragleave', 'drop'].forEach(eventName => {
                    editorPanel.addEventListener(eventName, () => {
                        overlay.classList.remove('active');
                    });
                });

                editorPanel.addEventListener('drop', handleDrop);
            }

            function handleDrop(e) {
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    readSqlFile(files[0]);
                }
            }

            function importSqlFile() {
                document.getElementById('sqlFileInput').click();
            }

            function handleFileSelect(e) {
                const file = e.target.files[0];
                if (file) {
                    readSqlFile(file);
                }
                // Reset input so same file can be selected again
                e.target.value = '';
            }

            function readSqlFile(file) {
                const validExtensions = ['.sql', '.txt'];
                const extension = '.' + file.name.split('.').pop().toLowerCase();

                if (!validExtensions.includes(extension)) {
                    showToast('warning', 'Invalid File', 'Please select a .sql or .txt file.');
                    return;
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    state.editor.setValue(content);
                    showToast('success', 'File Imported', \`Loaded: \${file.name}\`);
                };
                reader.onerror = () => {
                    showToast('error', 'Read Error', 'Failed to read the file.');
                };
                reader.readAsText(file);
            }

            function downloadQuery() {
                const query = state.editor.getValue();
                if (!query.trim()) {
                    showToast('warning', 'No Query', 'Please enter a query to download.');
                    return;
                }

                // Generate filename with timestamp
                const timestamp = new Date().toISOString().slice(0, 10);
                const filename = \`query-\${timestamp}.sql\`;

                // Create and download the file
                const blob = new Blob([query], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                showToast('success', 'Query Downloaded', \`Saved as \${filename}\`);
            }

            // =================================================================
            // COLUMN REORDERING
            // =================================================================

            let draggedColumn = null;
            let columnOrder = [];

            function initColumnDrag() {
                // This is called after rendering results
                const headers = document.querySelectorAll('.sqt-results-table th.sqt-draggable');

                headers.forEach(header => {
                    header.setAttribute('draggable', 'true');

                    header.addEventListener('dragstart', (e) => {
                        draggedColumn = header;
                        header.classList.add('sqt-dragging');
                        e.dataTransfer.effectAllowed = 'move';
                    });

                    header.addEventListener('dragend', () => {
                        header.classList.remove('sqt-dragging');
                        document.querySelectorAll('.sqt-drag-over').forEach(el => {
                            el.classList.remove('sqt-drag-over');
                        });
                        draggedColumn = null;
                    });

                    header.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        if (draggedColumn && draggedColumn !== header) {
                            header.classList.add('sqt-drag-over');
                        }
                    });

                    header.addEventListener('dragleave', () => {
                        header.classList.remove('sqt-drag-over');
                    });

                    header.addEventListener('drop', (e) => {
                        e.preventDefault();
                        header.classList.remove('sqt-drag-over');

                        if (draggedColumn && draggedColumn !== header) {
                            reorderColumns(draggedColumn.dataset.column, header.dataset.column);
                        }
                    });
                });
            }

            function reorderColumns(fromCol, toCol) {
                if (!state.results || !state.results.records) return;

                const columns = Object.keys(state.results.records[0]).filter(c => c !== 'rownumber');
                const fromIndex = columns.indexOf(fromCol);
                const toIndex = columns.indexOf(toCol);

                if (fromIndex === -1 || toIndex === -1) return;

                // Reorder the column array
                columns.splice(fromIndex, 1);
                columns.splice(toIndex, 0, fromCol);

                // Store new order
                columnOrder = columns;

                // Re-render with new order
                renderResults(state.results);
                showToast('info', 'Columns Reordered', \`Moved "\${fromCol}" column.\`);
            }

            function getOrderedColumns(records) {
                if (!records || records.length === 0) return [];
                const allColumns = Object.keys(records[0]).filter(c => c !== 'rownumber');

                if (columnOrder.length === 0) return allColumns;

                // Return columns in stored order, adding any new columns at the end
                const ordered = [];
                columnOrder.forEach(col => {
                    if (allColumns.includes(col)) ordered.push(col);
                });
                allColumns.forEach(col => {
                    if (!ordered.includes(col)) ordered.push(col);
                });
                return ordered;
            }

            // =================================================================
            // QUERY PARAMETERS
            // =================================================================

            // Storage for last used parameter values
            const PARAMS_STORAGE_KEY = 'sqt_params';

            function getStoredParams() {
                try {
                    const stored = localStorage.getItem(PARAMS_STORAGE_KEY);
                    return stored ? JSON.parse(stored) : {};
                } catch (e) {
                    return {};
                }
            }

            function saveParams(params) {
                try {
                    const existing = getStoredParams();
                    Object.assign(existing, params);
                    localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(existing));
                } catch (e) {
                    console.error('Failed to save params:', e);
                }
            }

            function extractParameters(query) {
                const params = [];
                let start = 0;
                while (true) {
                    const openIdx = query.indexOf('{{', start);
                    if (openIdx === -1) break;
                    const closeIdx = query.indexOf('}}', openIdx + 2);
                    if (closeIdx === -1) break;
                    const paramName = query.substring(openIdx + 2, closeIdx).trim();
                    if (paramName && !params.includes(paramName)) {
                        params.push(paramName);
                    }
                    start = closeIdx + 2;
                }
                return params;
            }

            function checkForParameters() {
                const query = getQueryToRun();
                const params = extractParameters(query);

                if (params.length > 0) {
                    showParametersModal(params);
                    return true;
                }
                return false;
            }

            function showParametersModal(params) {
                const content = document.getElementById('parametersContent');
                const storedParams = getStoredParams();

                let html = '<p class="text-muted mb-3" style="font-size: 14px;">Enter values for the following parameters:</p>';
                params.forEach((param, index) => {
                    const storedValue = storedParams[param] || '';
                    html += \`
                        <div class="sqt-param-input">
                            <label for="param_\${index}">\${escapeHtml(param)}</label>
                            <input type="text" id="param_\${index}" data-param="\${escapeHtml(param)}"
                                   value="\${escapeHtml(storedValue)}"
                                   placeholder="Enter value..." \${index === 0 ? 'autofocus' : ''}>
                        </div>
                    \`;
                });

                content.innerHTML = html;
                new bootstrap.Modal(document.getElementById('parametersModal')).show();
            }

            function runWithParameters() {
                const inputs = document.querySelectorAll('#parametersContent input[data-param]');
                let query = getQueryToRun();
                const paramsToSave = {};

                inputs.forEach(input => {
                    const paramName = input.dataset.param;
                    const value = input.value;
                    paramsToSave[paramName] = value;

                    // Simple string replacement - replace all occurrences
                    const placeholder = '{{' + paramName + '}}';
                    while (query.includes(placeholder)) {
                        query = query.replace(placeholder, value);
                    }
                });

                // Save parameter values for next time
                saveParams(paramsToSave);

                bootstrap.Modal.getInstance(document.getElementById('parametersModal')).hide();

                // Run query with substituted parameters
                runQueryWithText(query);
            }

            async function runQueryWithText(queryText) {
                if (!queryText.trim()) {
                    showToast('warning', 'No Query', 'Please enter a query to run.');
                    return;
                }

                // Inject cache buster if option is enabled
                const disableCache = document.getElementById('optDisableCache')?.checked || false;
                if (disableCache) {
                    queryText = injectCacheBuster(queryText);
                }

                setRunningState(true);
                const options = getQueryOptions();

                try {
                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            function: 'queryExecute',
                            query: queryText,
                            rowBegin: options.rowBegin,
                            rowEnd: options.rowEnd,
                            paginationEnabled: options.paginationEnabled,
                            viewsEnabled: options.viewsEnabled,
                            returnTotals: options.returnTotals
                        })
                    });

                    const data = await response.json();

                    if (data.error) {
                        showError(data.error.message || data.error);
                    } else {
                        data.cacheMissForced = disableCache;
                        state.results = data;
                        state.lastExecutedQuery = queryText;
                        columnOrder = []; // Reset column order for new results
                        renderResults(data);
                        addToHistory(queryText, data);
                        saveExecutionTime(queryText, data.elapsedTime, data.rowCount);
                        showToast('success', 'Query Complete',
                            \`Retrieved \${data.rowCount} rows in \${data.elapsedTime}ms\${disableCache ? ' (uncached)' : ''}\`);
                    }

                } catch (error) {
                    showError(error.message);
                } finally {
                    setRunningState(false);
                }
            }

            // =================================================================
            // KEYBOARD SHORTCUTS MODAL
            // =================================================================

            function showShortcuts() {
                new bootstrap.Modal(document.getElementById('shortcutsModal')).show();
            }

            // =================================================================
            // UNDO/REDO HISTORY
            // =================================================================

            let undoHistory = [];
            let undoHistoryIndex = -1;

            function initUndoHistory() {
                if (!state.editor) return;

                // Track changes for undo history visualization
                state.editor.on('change', (cm, change) => {
                    if (change.origin && change.origin !== 'setValue') {
                        trackUndoHistory();
                    }
                });
            }

            function trackUndoHistory() {
                const content = state.editor.getValue();
                const preview = content.substring(0, 50).replace(/\\n/g, ' ');

                // Add to history if different from last entry
                if (undoHistory.length === 0 || undoHistory[undoHistory.length - 1].content !== content) {
                    undoHistory.push({
                        content: content,
                        preview: preview || '(empty)',
                        timestamp: new Date()
                    });

                    // Limit history size
                    if (undoHistory.length > 50) {
                        undoHistory.shift();
                    }

                    undoHistoryIndex = undoHistory.length - 1;
                }
            }

            function showUndoHistory() {
                const dropdown = document.getElementById('undoHistoryDropdown');
                const list = document.getElementById('undoHistoryList');

                if (undoHistory.length === 0) {
                    list.innerHTML = '<div class="p-3 text-muted text-center">No edit history yet</div>';
                } else {
                    list.innerHTML = undoHistory.slice().reverse().map((entry, revIndex) => {
                        const index = undoHistory.length - 1 - revIndex;
                        const isActive = index === undoHistoryIndex;
                        const timeAgo = formatTimestamp(entry.timestamp.toISOString());
                        return \`
                            <div class="sqt-history-dropdown-item \${isActive ? 'active' : ''}"
                                 onclick="SQT.restoreFromUndoHistory(\${index})">
                                <span class="sqt-history-dropdown-item-preview">\${escapeHtml(entry.preview)}...</span>
                                <span class="sqt-history-dropdown-item-time">\${timeAgo}</span>
                            </div>
                        \`;
                    }).join('');
                }

                dropdown.classList.toggle('show');
            }

            function closeUndoHistory() {
                document.getElementById('undoHistoryDropdown').classList.remove('show');
            }

            function restoreFromUndoHistory(index) {
                if (index >= 0 && index < undoHistory.length) {
                    state.editor.setValue(undoHistory[index].content);
                    undoHistoryIndex = index;
                    closeUndoHistory();
                    showToast('info', 'Restored', 'Editor content restored from history.');
                }
            }

            // =================================================================
            // QUERY EXECUTION
            // =================================================================

            async function runQuery() {
                let query = getQueryToRun();

                if (!query.trim()) {
                    showToast('warning', 'No Query', 'Please enter a query to run.');
                    return;
                }

                // Check for parameters - if found, show modal and return
                if (checkForParameters()) {
                    return;
                }

                // Inject cache buster if option is enabled
                const disableCache = document.getElementById('optDisableCache')?.checked || false;
                if (disableCache) {
                    query = injectCacheBuster(query);
                }

                // Plugin hook: onBeforeQuery - allows plugins to modify query before execution
                const beforeQueryData = plugins.invokeHooks('onBeforeQuery', {
                    query: query,
                    options: getQueryOptions()
                });
                if (beforeQueryData && beforeQueryData.query) {
                    query = beforeQueryData.query;
                }
                if (beforeQueryData && beforeQueryData.cancel) {
                    return; // Plugin requested cancellation
                }

                setRunningState(true);
                columnOrder = []; // Reset column order for new results

                const options = getQueryOptions();

                try {
                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            function: 'queryExecute',
                            query: query,
                            rowBegin: options.rowBegin,
                            rowEnd: options.rowEnd,
                            paginationEnabled: options.paginationEnabled,
                            viewsEnabled: options.viewsEnabled,
                            returnTotals: options.returnTotals
                        })
                    });

                    const data = await response.json();

                    if (data.error) {
                        showError(data.error.message || data.error);
                    } else {
                        data.cacheMissForced = disableCache;
                        state.results = data;
                        state.lastExecutedQuery = query;
                        renderResults(data);
                        addToHistory(query, data);
                        saveExecutionTime(query, data.elapsedTime, data.rowCount);
                        showToast('success', 'Query Complete',
                            \`Retrieved \${data.rowCount} rows in \${data.elapsedTime}ms\${disableCache ? ' (uncached)' : ''}\`);

                        // Show optimization banner for slow queries
                        hideOptimizeBanner(); // Hide any previous banner
                        if (data.elapsedTime > CONFIG.SLOW_QUERY_THRESHOLD_MS) {
                            showOptimizeBanner(data.elapsedTime);
                        }

                        // Plugin hook: onAfterQuery - called after successful query
                        plugins.invokeHooks('onAfterQuery', {
                            query: query,
                            results: data,
                            elapsedTime: data.elapsedTime,
                            rowCount: data.rowCount
                        });
                    }

                } catch (error) {
                    showError(error.message);
                } finally {
                    setRunningState(false);
                }
            }

            function getQueryToRun() {
                const selection = state.editor.getSelection();
                return selection || state.editor.getValue();
            }

            function getQueryOptions() {
                const paginationEnabled = document.getElementById('optPagination').checked;
                const returnAll = document.getElementById('optReturnAll')?.checked || false;

                return {
                    paginationEnabled,
                    rowBegin: returnAll ? 1 : parseInt(document.getElementById('optRowBegin').value) || 1,
                    rowEnd: returnAll ? 999999 : parseInt(document.getElementById('optRowEnd').value) || ${CONFIG.ROWS_RETURNED_DEFAULT},
                    returnTotals: document.getElementById('optShowTotals')?.checked || false,
                    viewsEnabled: document.getElementById('optEnableViews')?.checked || false
                };
            }

            function generateUUID() {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    const r = Math.random() * 16 | 0;
                    const v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            }

            function injectCacheBuster(query) {
                const uuid = generateUUID();
                const cacheBuster = "( '" + uuid + "' = '" + uuid + "' )";

                // Normalize whitespace for pattern matching
                const normalized = query.replace(/\\s+/g, ' ').trim();

                // Check if query has a WHERE clause
                const whereMatch = normalized.match(/\\bWHERE\\b/i);

                if (whereMatch) {
                    // Find WHERE and add AND condition after the first condition
                    // Insert before ORDER BY, GROUP BY, HAVING, UNION, or end of query
                    const insertBeforePattern = /\\s+(ORDER\\s+BY|GROUP\\s+BY|HAVING|UNION|LIMIT|OFFSET|$)/i;
                    const match = query.match(insertBeforePattern);

                    if (match) {
                        const insertPos = match.index;
                        return query.slice(0, insertPos) + '\\n\\tAND ' + cacheBuster + query.slice(insertPos);
                    } else {
                        // No terminating clause found, append at end
                        return query + '\\n\\tAND ' + cacheBuster;
                    }
                } else {
                    // No WHERE clause - insert WHERE before ORDER BY, GROUP BY, etc., or at end
                    const insertBeforePattern = /\\s+(ORDER\\s+BY|GROUP\\s+BY|HAVING|UNION|LIMIT|OFFSET)/i;
                    const match = query.match(insertBeforePattern);

                    if (match) {
                        const insertPos = match.index;
                        return query.slice(0, insertPos) + '\\nWHERE\\n\\t' + cacheBuster + query.slice(insertPos);
                    } else {
                        // No terminating clause, append at end
                        return query + '\\nWHERE\\n\\t' + cacheBuster;
                    }
                }
            }

            function setRunningState(running) {
                state.isRunning = running;
                const btn = document.getElementById('runButton');
                const dot = document.getElementById('statusDot');
                const text = document.getElementById('statusText');

                if (running) {
                    btn.disabled = true;
                    btn.innerHTML = '<div class="sqt-spinner" style="width: 14px; height: 14px; border-width: 2px; margin: 0;"></div><span>Running...</span>';
                    dot.classList.add('running');
                    text.textContent = 'Running query...';
                } else {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="bi bi-play-fill"></i><span>Run</span>';
                    dot.classList.remove('running');
                    text.textContent = 'Ready';
                }
            }

            // =================================================================
            // RESULTS RENDERING
            // =================================================================

            function clearResults() {
                // Skip if no results to clear
                if (!state.results) {
                    return;
                }

                // Confirm before clearing
                if (!confirm('Clear the current results?')) {
                    return;
                }

                state.results = null;
                const panel = document.getElementById('resultsPanel');
                panel.innerHTML = \`
                    <div class="sqt-empty-state" id="emptyState">
                        <i class="bi bi-terminal"></i>
                        <h3>Ready to query</h3>
                        <p>Write a SuiteQL query above and click <strong>Run Query</strong> or press <span class="sqt-kbd">Ctrl</span> + <span class="sqt-kbd">Enter</span></p>
                    </div>
                \`;

                // Exit maximized mode if active
                if (state.resultsMaximized) {
                    toggleResultsMaximized();
                }

                showToast('info', 'Cleared', 'Results have been cleared.');
            }

            function renderResults(data) {
                const panel = document.getElementById('resultsPanel');

                if (!data.records || data.records.length === 0) {
                    panel.innerHTML = \`
                        <div class="sqt-empty-state">
                            <i class="bi bi-inbox"></i>
                            <h3>No results</h3>
                            <p>The query returned no records.</p>
                        </div>
                    \`;
                    return;
                }

                // Check if AI results chat is available
                const aiSettings = loadAISettings();
                const aiConfigured = aiSettings && (aiSettings.apiKey || state.aiApiKey);
                const showAIResultsBtn = CONFIG.AI_RESULTS_CHAT_ENABLED && aiConfigured;

                // Build header with view toggle
                const headerHtml = \`
                    <div class="sqt-results-header">
                        <div class="sqt-results-info">
                            <div class="sqt-results-info-item">
                                <i class="bi bi-table"></i>
                                <span>\${data.rowCount} rows</span>
                                \${data.totalRecordCount ? \`<span class="text-muted">of \${data.totalRecordCount} total</span>\` : ''}
                            </div>
                            <div class="sqt-results-info-item">
                                <i class="bi bi-clock"></i>
                                <span>\${data.elapsedTime}ms</span>
                                \${data.cacheMissForced ? '<span class="sqt-cache-miss-badge" title="Cache miss was forced for this query">uncached</span>' : ''}
                            </div>
                        </div>
                        <div class="sqt-results-actions">
                            <div class="sqt-view-toggle">
                                <button type="button" class="sqt-view-toggle-btn \${state.viewMode === 'table' ? 'active' : ''}" onclick="SQT.setViewMode('table')" title="Table view">
                                    <i class="bi bi-table"></i> Table
                                </button>
                                <button type="button" class="sqt-view-toggle-btn \${state.viewMode === 'datatable' ? 'active' : ''}" onclick="SQT.setViewMode('datatable')" title="DataTable view with sorting">
                                    <i class="bi bi-filter"></i> DataTable
                                </button>
                                <button type="button" class="sqt-view-toggle-btn \${state.viewMode === 'json' ? 'active' : ''}" onclick="SQT.setViewMode('json')" title="JSON view">
                                    <i class="bi bi-braces"></i> JSON
                                </button>
                            </div>
                            <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.copyToClipboard()" title="Copy results to clipboard (JSON view copies as JSON, otherwise CSV)">
                                <i class="bi bi-clipboard"></i>
                                <span>Copy</span>
                            </button>
                            \${showAIResultsBtn ? \`
                                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.askAIAboutResults()" title="Ask AI about these results">
                                    <i class="bi bi-stars"></i>
                                    <span>Ask AI</span>
                                </button>
                            \` : ''}
                            <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.showExportModal()">
                                <i class="bi bi-download"></i>
                                <span>Export</span>
                            </button>
                            <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.showChartModal()" title="Visualize as chart">
                                <i class="bi bi-bar-chart-line"></i>
                                <span class="d-none d-md-inline">Chart</span>
                            </button>
                            <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm sqt-btn-icon" onclick="SQT.clearResults()" title="Clear results">
                                <i class="bi bi-x-lg"></i>
                            </button>
                            <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm sqt-btn-icon sqt-results-maximize-btn" onclick="SQT.toggleResultsMaximized()" title="Maximize results (Shift+R)">
                                <i class="bi bi-arrows-fullscreen"></i>
                            </button>
                            <span id="sqtPluginResultsHeader"></span>
                        </div>
                    </div>
                \`;

                // Render based on view mode
                let contentHtml;
                switch (state.viewMode) {
                    case 'datatable':
                        contentHtml = renderDataTableView(data);
                        break;
                    case 'json':
                        contentHtml = renderJsonView(data);
                        break;
                    default:
                        contentHtml = renderTableView(data);
                }

                // Add results footer placeholder for plugins
                const footerHtml = '<div id="sqtPluginResultsFooter" class="sqt-plugin-results-footer"></div>';

                panel.innerHTML = headerHtml + contentHtml + footerHtml;

                // Initialize DataTable if needed
                if (state.viewMode === 'datatable') {
                    try {
                        new DataTable('#resultsDataTable', {
                            pageLength: 25,
                            lengthMenu: [10, 25, 50, 100, 250, 500],
                            scrollX: true,
                            order: []
                        });
                    } catch (e) {
                        console.error('DataTable initialization error:', e);
                    }
                }

                // Initialize column drag for table view
                if (state.viewMode === 'table') {
                    initColumnDrag();
                    initPinnedColumns();
                }

                // Plugin hook: onResultsDisplay - called after results are rendered to DOM
                plugins.invokeHooks('onResultsDisplay', {
                    data: data,
                    viewMode: state.viewMode,
                    panel: panel
                });
            }

            function initPinnedColumns() {
                const table = document.querySelector('.sqt-results-table');
                if (!table) return;

                const pinnedHeaders = table.querySelectorAll('th.sqt-pinned');
                if (pinnedHeaders.length === 0) return;

                // Calculate cumulative left positions
                let leftPos = 0;
                pinnedHeaders.forEach((th, index) => {
                    const width = th.offsetWidth;
                    th.style.left = leftPos + 'px';

                    // Apply same left to all cells in this column
                    const colIndex = Array.from(th.parentNode.children).indexOf(th);
                    table.querySelectorAll('tbody tr, tfoot tr').forEach(row => {
                        const cell = row.children[colIndex];
                        if (cell && cell.classList.contains('sqt-pinned')) {
                            cell.style.left = leftPos + 'px';
                        }
                    });

                    leftPos += width;
                });
            }

            function renderTableView(data) {
                const filteredColumns = getOrderedColumns(data.records);
                const hideRowNumbers = document.getElementById('optHideRowNumbers')?.checked;
                const nullDisplay = document.getElementById('optNullDisplay')?.value || 'dimmed';
                const showStats = document.getElementById('optShowStats')?.checked;
                const pinColumns = parseInt(document.getElementById('optPinColumns')?.value) || 0;
                const allowHtml = document.getElementById('optAllowHtml')?.checked;

                // Calculate column statistics
                const stats = showStats ? calculateColumnStats(data.records) : null;

                // Helper to get pinned class for a column index
                const getPinnedClass = (colIndex, isLast = false) => {
                    if (pinColumns === 0) return '';
                    // If row numbers are visible, they take index 0
                    const effectiveIndex = hideRowNumbers ? colIndex : colIndex + 1;
                    if (effectiveIndex < pinColumns) {
                        const lastClass = isLast ? ' sqt-pinned-last' : '';
                        return ' sqt-pinned' + lastClass;
                    }
                    return '';
                };

                // Determine which column index is the last pinned one
                const lastPinnedIndex = hideRowNumbers ? pinColumns - 1 : pinColumns - 2;

                // Row number pinned class
                const rowNumPinnedClass = (!hideRowNumbers && pinColumns > 0)
                    ? ' sqt-pinned' + (pinColumns === 1 ? ' sqt-pinned-last' : '')
                    : '';

                let html = \`
                    <div class="sqt-results-container">
                        <table class="sqt-results-table">
                            <thead>
                                <tr>
                                    \${!hideRowNumbers ? '<th class="row-number' + rowNumPinnedClass + '">#</th>' : ''}
                                    \${filteredColumns.map((c, i) => \`<th class="sqt-draggable\${getPinnedClass(i, i === lastPinnedIndex)}" data-column="\${escapeHtml(c)}">\${escapeHtml(c)}</th>\`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                \`;

                data.records.forEach((record, index) => {
                    html += \`<tr class="sqt-row-clickable" onclick="SQT.showRowDetails(\${index})" title="Click to view all fields">\`;
                    if (!hideRowNumbers) {
                        html += \`<td class="row-number\${rowNumPinnedClass}">\${index + 1}</td>\`;
                    }
                    filteredColumns.forEach((col, colIndex) => {
                        const value = record[col];
                        html += \`<td class="\${getPinnedClass(colIndex, colIndex === lastPinnedIndex).trim()}">\${formatCellValue(value, nullDisplay, allowHtml, col)}</td>\`;
                    });
                    html += '</tr>';
                });

                html += '</tbody>';

                // Add statistics footer if enabled
                if (stats) {
                    html += '<tfoot>';

                    // Sum row
                    html += '<tr class="sqt-stats-row">';
                    if (!hideRowNumbers) html += '<td class="row-number' + rowNumPinnedClass + '">SUM</td>';
                    filteredColumns.forEach((col, colIndex) => {
                        const colStats = stats[col];
                        html += \`<td class="\${getPinnedClass(colIndex, colIndex === lastPinnedIndex).trim()}">\${colStats.isNumeric ? formatStatValue(colStats.sum) : '-'}</td>\`;
                    });
                    html += '</tr>';

                    // Avg row
                    html += '<tr class="sqt-stats-row">';
                    if (!hideRowNumbers) html += '<td class="row-number' + rowNumPinnedClass + '">AVG</td>';
                    filteredColumns.forEach((col, colIndex) => {
                        const colStats = stats[col];
                        html += \`<td class="\${getPinnedClass(colIndex, colIndex === lastPinnedIndex).trim()}">\${colStats.isNumeric ? formatStatValue(colStats.avg) : '-'}</td>\`;
                    });
                    html += '</tr>';

                    // Min row
                    html += '<tr class="sqt-stats-row">';
                    if (!hideRowNumbers) html += '<td class="row-number' + rowNumPinnedClass + '">MIN</td>';
                    filteredColumns.forEach((col, colIndex) => {
                        const colStats = stats[col];
                        html += \`<td class="\${getPinnedClass(colIndex, colIndex === lastPinnedIndex).trim()}">\${colStats.isNumeric ? formatStatValue(colStats.min) : '-'}</td>\`;
                    });
                    html += '</tr>';

                    // Max row
                    html += '<tr class="sqt-stats-row">';
                    if (!hideRowNumbers) html += '<td class="row-number' + rowNumPinnedClass + '">MAX</td>';
                    filteredColumns.forEach((col, colIndex) => {
                        const colStats = stats[col];
                        html += \`<td class="\${getPinnedClass(colIndex, colIndex === lastPinnedIndex).trim()}">\${colStats.isNumeric ? formatStatValue(colStats.max) : '-'}</td>\`;
                    });
                    html += '</tr>';

                    html += '</tfoot>';
                }

                html += \`
                        </table>
                    </div>
                \`;

                return html;
            }

            function renderDataTableView(data) {
                const columns = Object.keys(data.records[0]).filter(c => c !== 'rownumber');
                const nullDisplay = document.getElementById('optNullDisplay')?.value || 'dimmed';
                const allowHtml = document.getElementById('optAllowHtml')?.checked;

                let html = \`
                    <div class="sqt-results-container" style="padding: 16px;">
                        <table id="resultsDataTable" class="table table-striped table-bordered" style="width: 100%;">
                            <thead>
                                <tr>
                                    \${columns.map(c => \`<th>\${escapeHtml(c)}</th>\`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                \`;

                data.records.forEach(record => {
                    html += '<tr>';
                    columns.forEach(col => {
                        const value = record[col];
                        html += \`<td>\${formatCellValue(value, nullDisplay, allowHtml, col)}</td>\`;
                    });
                    html += '</tr>';
                });

                html += \`
                            </tbody>
                        </table>
                    </div>
                \`;

                return html;
            }

            function renderJsonView(data) {
                const jsonString = JSON.stringify(data.records, null, 2);
                return \`
                    <div class="sqt-json-container">
                        <pre class="sqt-json-pre">\${escapeHtml(jsonString)}</pre>
                    </div>
                \`;
            }

            function setViewMode(mode) {
                state.viewMode = mode;
                if (state.results) {
                    renderResults(state.results);
                }
            }

            function refreshResults() {
                if (state.results) {
                    renderResults(state.results);
                }
            }

            function formatCellValue(value, nullDisplay, allowHtml, columnName) {
                if (value === null || value === undefined) {
                    switch (nullDisplay) {
                        case 'blank': return '';
                        case 'null': return '<span class="sqt-null-value">null</span>';
                        default: return '<span class="sqt-null-value">null</span>';
                    }
                }
                const strValue = String(value);

                // Check for record link (if enabled)
                const recordLinksEnabled = document.getElementById('optRecordLinks')?.checked !== false;
                if (recordLinksEnabled && columnName) {
                    const linkPattern = getRecordLinkPattern(columnName);
                    if (linkPattern && isValidRecordId(value)) {
                        const url = linkPattern + encodeURIComponent(value);
                        const escaped = escapeHtml(strValue);
                        return '<a href="' + url + '" target="_blank" class="sqt-record-link" title="Open record in NetSuite" onclick="event.stopPropagation()">' +
                               escaped + ' <i class="bi bi-box-arrow-up-right sqt-link-icon"></i></a>';
                    }
                }

                if (allowHtml) {
                    // Return value as-is (allows HTML rendering)
                    return strValue;
                }
                return escapeHtml(strValue);
            }

            function showError(message, query) {
                // Store error context for AI help
                state.lastError = message;
                state.lastFailedQuery = query || getQueryToRun();

                // Check if AI is configured
                const aiSettings = loadAISettings();
                const aiConfigured = aiSettings && (aiSettings.apiKey || state.aiApiKey);

                const panel = document.getElementById('resultsPanel');
                panel.innerHTML = \`
                    <div style="overflow: auto; height: 100%; display: flex; align-items: flex-start; justify-content: center;">
                        <div class="sqt-empty-state" style="color: var(--sqt-danger); justify-content: flex-start; min-height: auto; margin: auto 0;">
                            <i class="bi bi-exclamation-triangle"></i>
                            <h3>Query Error</h3>
                            <p style="font-family: var(--sqt-editor-font); white-space: pre-wrap; text-align: left; max-width: 600px;">\${escapeHtml(message)}</p>
                            \${aiConfigured ? \`
                                <button type="button" class="sqt-btn sqt-btn-secondary" onclick="SQT.askAIForHelp()" style="margin-top: 16px;">
                                    <i class="bi bi-stars"></i> Ask AI for Help
                                </button>
                            \` : ''}
                        </div>
                    </div>
                \`;
                showToast('error', 'Query Failed', 'See error details in the results panel.');
            }

            // =================================================================
            // QUERY HISTORY
            // =================================================================

            function loadHistory() {
                try {
                    const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
                    if (saved) {
                        state.history = JSON.parse(saved);
                        renderHistory();
                    }
                } catch (e) {
                    console.error('Failed to load history:', e);
                }
            }

            function addToHistory(query, result) {
                const entry = {
                    id: Date.now(),
                    query: query.trim(),
                    timestamp: new Date().toISOString(),
                    rowCount: result.rowCount,
                    elapsedTime: result.elapsedTime
                };

                // Remove duplicate if exists
                state.history = state.history.filter(h => h.query !== entry.query);

                // Add to beginning
                state.history.unshift(entry);

                // Limit size
                if (state.history.length > CONFIG.MAX_HISTORY) {
                    state.history = state.history.slice(0, CONFIG.MAX_HISTORY);
                }

                saveHistory();
                renderHistory();
            }

            function saveHistory() {
                try {
                    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.history));
                } catch (e) {
                    console.error('Failed to save history:', e);
                }
            }

            function renderHistory() {
                const list = document.getElementById('historyList');

                if (state.history.length === 0) {
                    list.innerHTML = \`
                        <div class="sqt-empty-state" style="padding: 24px;">
                            <i class="bi bi-clock-history" style="font-size: 24px;"></i>
                            <p style="margin-top: 8px;">No query history yet</p>
                        </div>
                    \`;
                    return;
                }

                list.innerHTML = state.history.map(entry => \`
                    <div class="sqt-history-item" onclick="SQT.loadFromHistory('\${entry.id}')" title="\${escapeHtml(entry.query)}">
                        <div class="sqt-history-item-query">\${escapeHtml(entry.query.substring(0, 100))}</div>
                        <div class="sqt-history-item-meta">
                            <span>\${entry.rowCount} rows</span>
                            <span>\${entry.elapsedTime}ms</span>
                            <span>\${formatTimestamp(entry.timestamp)}</span>
                        </div>
                    </div>
                \`).join('');
            }

            function loadFromHistory(id) {
                const entry = state.history.find(h => h.id === parseInt(id));
                if (entry) {
                    state.editor.setValue(entry.query);
                    showToast('info', 'Query Loaded', 'Query loaded from history.');
                }
            }

            function clearHistory() {
                if (confirm('Clear all query history?')) {
                    state.history = [];
                    saveHistory();
                    renderHistory();
                    showToast('info', 'History Cleared', 'Query history has been cleared.');
                }
            }

            // =================================================================
            // THEME
            // =================================================================

            function toggleTheme() {
                const newTheme = state.theme === 'light' ? 'dark' : 'light';
                setTheme(newTheme);
            }

            function setTheme(theme) {
                state.theme = theme;
                document.documentElement.setAttribute('data-bs-theme', theme);
                localStorage.setItem(CONFIG.THEME_KEY, theme);

                // Update CodeMirror theme
                if (state.editor) {
                    state.editor.setOption('theme', theme === 'dark' ? 'dracula' : 'eclipse');
                }

                // Update icon
                const icon = document.getElementById('themeIcon');
                if (icon) {
                    icon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
                }
            }

            // =================================================================
            // OPTIONS
            // =================================================================

            function toggleOptions() {
                closeAllDropdowns();
                const panel = document.getElementById('optionsPanel');
                panel.classList.toggle('show');
            }

            function toggleAIDropdown() {
                closeAllDropdowns('aiDropdown');
                const dropdown = document.getElementById('aiDropdown');
                dropdown.classList.toggle('show');
            }

            function toggleMoreDropdown() {
                closeAllDropdowns('moreDropdown');
                const dropdown = document.getElementById('moreDropdown');
                dropdown.classList.toggle('show');
            }

            function closeAllDropdowns(except = null) {
                const dropdowns = ['aiDropdown', 'moreDropdown', 'optionsPanel', 'undoHistoryDropdown'];
                dropdowns.forEach(id => {
                    if (id !== except) {
                        const el = document.getElementById(id);
                        if (el) el.classList.remove('show');
                    }
                });
            }

            function updateOptions() {
                const pagination = document.getElementById('optPagination').checked;
                document.getElementById('rowRangeOptions').style.display = pagination ? 'flex' : 'none';
                document.getElementById('returnAllOption').style.display = pagination ? 'flex' : 'none';
                document.getElementById('showTotalsOption').style.display = pagination ? 'flex' : 'none';

                const returnAll = document.getElementById('optReturnAll')?.checked;
                if (returnAll) {
                    document.getElementById('rowRangeOptions').style.display = 'none';
                }
            }

            // =================================================================
            // EXPORT
            // =================================================================

            function showExportModal() {
                new bootstrap.Modal(document.getElementById('exportModal')).show();
            }

            function exportAs(format) {
                if (!state.results || !state.results.records) {
                    showToast('warning', 'No Data', 'Run a query first to export results.');
                    return;
                }

                // Plugin hook: onBeforeExport - allows plugins to modify export or cancel
                const beforeExportData = plugins.invokeHooks('onBeforeExport', {
                    format: format,
                    records: state.results.records,
                    rowCount: state.results.rowCount
                });
                if (beforeExportData && beforeExportData.cancel) {
                    return; // Plugin requested cancellation
                }

                let content, filename, mimeType;

                if (format === 'csv') {
                    content = convertToCSV(state.results.records);
                    filename = 'query-results.csv';
                    mimeType = 'text/csv';
                    downloadFile(content, filename, mimeType);
                } else if (format === 'json') {
                    content = JSON.stringify(state.results.records, null, 2);
                    filename = 'query-results.json';
                    mimeType = 'application/json';
                    downloadFile(content, filename, mimeType);
                } else if (format === 'xlsx') {
                    exportToExcel(state.results.records);
                    bootstrap.Modal.getInstance(document.getElementById('exportModal')).hide();
                    showToast('success', 'Export Complete', 'Results exported as Excel (.xlsx).');

                    // Plugin hook: onAfterExport
                    plugins.invokeHooks('onAfterExport', { format: format, rowCount: state.results.rowCount });
                    return;
                }

                bootstrap.Modal.getInstance(document.getElementById('exportModal')).hide();
                showToast('success', 'Export Complete', \`Results exported as \${format.toUpperCase()}.\`);

                // Plugin hook: onAfterExport - called after successful export
                plugins.invokeHooks('onAfterExport', {
                    format: format,
                    rowCount: state.results.rowCount
                });
            }

            function exportToExcel(records) {
                if (!records || records.length === 0) return;

                // Filter out rownumber column
                const columns = Object.keys(records[0]).filter(c => c !== 'rownumber');

                // Create worksheet data
                const wsData = [columns]; // Header row
                records.forEach(record => {
                    const row = columns.map(col => {
                        const value = record[col];
                        return value === null || value === undefined ? '' : value;
                    });
                    wsData.push(row);
                });

                // Create workbook and worksheet
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.aoa_to_array ? XLSX.utils.aoa_to_sheet(wsData) : XLSX.utils.aoa_to_sheet(wsData);

                // Auto-size columns (approximate)
                const colWidths = columns.map((col, i) => {
                    let maxLen = col.length;
                    records.forEach(record => {
                        const val = record[col];
                        if (val !== null && val !== undefined) {
                            maxLen = Math.max(maxLen, String(val).length);
                        }
                    });
                    return { wch: Math.min(maxLen + 2, 50) };
                });
                ws['!cols'] = colWidths;

                XLSX.utils.book_append_sheet(wb, ws, 'Query Results');

                // Generate and download file
                XLSX.writeFile(wb, 'query-results.xlsx');
            }

            function convertToCSV(records) {
                if (!records.length) return '';

                const columns = Object.keys(records[0]).filter(c => c !== 'rownumber');
                const header = columns.map(c => \`"\${c}"\`).join(',');

                const rows = records.map(record => {
                    return columns.map(col => {
                        const value = record[col];
                        if (value === null || value === undefined) return '""';
                        return \`"\${String(value).replace(/"/g, '""')}"\`;
                    }).join(',');
                });

                return [header, ...rows].join('\\n');
            }

            function downloadFile(content, filename, mimeType) {
                const blob = new Blob([content], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            function copyToClipboard() {
                if (!state.results || !state.results.records) {
                    showToast('warning', 'No Data', 'Run a query first to copy results.');
                    return;
                }

                let content;
                let format;

                if (state.viewMode === 'json') {
                    content = JSON.stringify(state.results.records, null, 2);
                    format = 'JSON';
                } else {
                    content = convertToCSV(state.results.records);
                    format = 'CSV';
                }

                navigator.clipboard.writeText(content).then(() => {
                    // Hide export modal if it's open
                    const exportModal = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
                    if (exportModal) exportModal.hide();
                    showToast('success', 'Copied', 'Results copied to clipboard as ' + format + '.');
                }).catch(err => {
                    showToast('error', 'Copy Failed', 'Failed to copy to clipboard.');
                });
            }

            // =================================================================
            // DOCUMENT GENERATION
            // =================================================================

            const DOCGEN_TEMPLATES = {
                'simple-table': \`<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
<head>
    <style>
        body { font-family: sans-serif; font-size: 10pt; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { background-color: #f0f0f0; border: 1px solid #ccc; padding: 6px; text-align: left; font-weight: bold; }
        td { border: 1px solid #ccc; padding: 6px; }
        tr:nth-child(even) { background-color: #fafafa; }
        h1 { color: #333; font-size: 16pt; margin-bottom: 5px; }
        .meta { color: #666; font-size: 8pt; margin-bottom: 15px; }
    </style>
</head>
<body>
    <h1>Query Results</h1>
    <p class="meta">Generated: \\\${.now?string("yyyy-MM-dd HH:mm")}</p>

    <#if results.records?has_content>
    <table>
        <tr>
            <#list results.columns as col>
            <th>\\\${col}</th>
            </#list>
        </tr>
        <#list results.records as record>
        <tr>
            <#list results.columns as col>
            <td>\\\${record[col]!""}</td>
            </#list>
        </tr>
        </#list>
    </table>
    <p class="meta">Total rows: \\\${results.count}</p>
    <#else>
    <p>No results found.</p>
    </#if>
</body>
</pdf>\`,

                'styled-report': \`<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
<head>
    <style>
        body { font-family: sans-serif; font-size: 10pt; padding: 20px; }
        .header { border-bottom: 2px solid #2563eb; padding-bottom: 15px; margin-bottom: 20px; }
        .header h1 { color: #1e40af; font-size: 20pt; margin: 0 0 5px 0; }
        .header .subtitle { color: #64748b; font-size: 10pt; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th { background-color: #2563eb; color: white; padding: 10px; text-align: left; font-size: 9pt; }
        td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 9pt; }
        tr:nth-child(even) { background-color: #f8fafc; }
        .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 8pt; text-align: center; }
        .summary { background: #f1f5f9; padding: 10px; border-radius: 4px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Data Report</h1>
        <div class="subtitle">Generated from SuiteQL Query Tool on \\\${.now?string("MMMM d, yyyy 'at' h:mm a")}</div>
    </div>

    <#if results.records?has_content>
    <table>
        <tr>
            <#list results.columns as col>
            <th>\\\${col?upper_case}</th>
            </#list>
        </tr>
        <#list results.records as record>
        <tr>
            <#list results.columns as col>
            <td>\\\${record[col]!""}</td>
            </#list>
        </tr>
        </#list>
    </table>

    <div class="summary">
        <strong>Summary:</strong> \\\${results.count} record(s) returned
    </div>
    <#else>
    <p>No results found.</p>
    </#if>

    <div class="footer">
        This report was automatically generated by SuiteQL Query Tool
    </div>
</body>
</pdf>\`,

                'invoice-style': \`<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
<head>
    <style>
        body { font-family: sans-serif; font-size: 10pt; }
        .page-header { display: flex; justify-content: space-between; margin-bottom: 30px; }
        .company { font-size: 18pt; font-weight: bold; color: #1f2937; }
        .doc-title { font-size: 24pt; color: #6b7280; text-align: right; }
        .doc-date { color: #9ca3af; font-size: 9pt; text-align: right; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th { background: #f3f4f6; padding: 12px; text-align: left; border-bottom: 2px solid #d1d5db; font-size: 9pt; text-transform: uppercase; color: #374151; }
        td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
        .totals { text-align: right; margin-top: 20px; }
        .totals table { width: 300px; margin-left: auto; }
        .totals td { border: none; padding: 5px 10px; }
        .total-row { font-weight: bold; font-size: 12pt; border-top: 2px solid #1f2937 !important; }
    </style>
</head>
<body>
    <table width="100%">
        <tr>
            <td style="border:none;"><div class="company">Your Company Name</div></td>
            <td style="border:none; text-align:right;">
                <div class="doc-title">REPORT</div>
                <div class="doc-date">\\\${.now?string("MMMM d, yyyy")}</div>
            </td>
        </tr>
    </table>

    <#if results.records?has_content>
    <table>
        <tr>
            <#list results.columns as col>
            <th>\\\${col}</th>
            </#list>
        </tr>
        <#list results.records as record>
        <tr>
            <#list results.columns as col>
            <td>\\\${record[col]!""}</td>
            </#list>
        </tr>
        </#list>
    </table>

    <div class="totals">
        <table>
            <tr>
                <td>Total Records:</td>
                <td>\\\${results.count}</td>
            </tr>
        </table>
    </div>
    <#else>
    <p>No data available.</p>
    </#if>
</body>
</pdf>\`,

                'master-detail': \`<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
<head>
    <style>
        body { font-family: sans-serif; font-size: 10pt; padding: 15px; }
        .header { border-bottom: 3px solid #1e40af; padding-bottom: 15px; margin-bottom: 20px; }
        .header h1 { color: #1e40af; font-size: 18pt; margin: 0 0 5px 0; }
        .header .subtitle { color: #64748b; font-size: 9pt; }

        /* Master section styles */
        .master-section { margin-bottom: 25px; }
        .master-section h2 { color: #1f2937; font-size: 14pt; margin: 0 0 10px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        .master-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        .master-table th { background: #1e40af; color: white; padding: 8px 10px; text-align: left; font-size: 9pt; }
        .master-table td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
        .master-table tr:nth-child(even) { background: #f8fafc; }

        /* Detail section styles */
        .detail-section { margin-bottom: 25px; background: #f8fafc; padding: 15px; border-radius: 4px; }
        .detail-section h2 { color: #374151; font-size: 12pt; margin: 0 0 10px 0; }
        .detail-table { width: 100%; border-collapse: collapse; background: white; }
        .detail-table th { background: #64748b; color: white; padding: 6px 8px; text-align: left; font-size: 8pt; }
        .detail-table td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 9pt; }

        .summary-box { background: #f1f5f9; padding: 10px; border-radius: 4px; margin-top: 20px; font-size: 9pt; }
        .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 8pt; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Master-Detail Report</h1>
        <div class="subtitle">Generated on \\\${.now?string("MMMM d, yyyy 'at' h:mm a")}</div>
        <div class="subtitle">This template demonstrates multiple data sources. Configure additional data sources in the panel.</div>
    </div>

    <!-- Primary Data Source (results) -->
    <div class="master-section">
        <h2>Primary Data (results)</h2>
        <#if results.records?has_content>
        <table class="master-table">
            <tr>
                <#list results.columns as col>
                <th>\\\${col}</th>
                </#list>
            </tr>
            <#list results.records as record>
            <tr>
                <#list results.columns as col>
                <td>\\\${record[col]!""}</td>
                </#list>
            </tr>
            </#list>
        </table>
        <#else>
        <p>No primary data available.</p>
        </#if>
    </div>

    <!--
    To add detail data:
    1. Click "Add" in the Data Sources section
    2. Set an alias like "details" or "items"
    3. Configure the query for detail records
    4. Uncomment and modify the section below:

    <div class="detail-section">
        <h2>Detail Data (data2)</h2>
        <#if data2.records?has_content>
        <table class="detail-table">
            <tr>
                <#list data2.columns as col>
                <th>\\\${col}</th>
                </#list>
            </tr>
            <#list data2.records as record>
            <tr>
                <#list data2.columns as col>
                <td>\\\${record[col]!""}</td>
                </#list>
            </tr>
            </#list>
        </table>
        <#else>
        <p>No detail data available.</p>
        </#if>
    </div>
    -->

    <div class="summary-box">
        <strong>Data Summary:</strong><br>
        Primary records: \\\${results.count}
        <!-- Add more summaries as you add data sources -->
    </div>

    <div class="footer">
        Generated by SuiteQL Query Tool - Multiple Data Source Example
    </div>
</body>
</pdf>\`
            };

            // Document Generator Data Sources State
            let docGenDataSources = [];
            let docGenEditor = null; // CodeMirror instance for template editor

            // Snippet definitions for the template editor
            const DOCGEN_SNIPPETS = {
                'list-records': '<#list results.records as record>\\n    \${record.columnname!""}\\n</#list>',
                'list-columns': '<#list results.columns as col>\\n    <th>\${col}</th>\\n</#list>',
                'if-else': '<#if condition>\\n    <!-- true -->\\n<#else>\\n    <!-- false -->\\n</#if>',
                'if-has-content': '<#if results.records?has_content>\\n    <!-- has data -->\\n<#else>\\n    <!-- no data -->\\n</#if>',
                'default-value': '\${record.columnname!"default"}',
                'format-date': '\${record.datefield?date?string("MM/dd/yyyy")}',
                'format-number': '\${record.numberfield?string("#,##0.00")}',
                'format-currency': '\${record.amount?string.currency}',
                'upper-lower': '\${record.textfield?upper_case}',
                'dynamic-table': \`<table>
    <tr>
        <#list results.columns as col>
        <th>\\\${col}</th>
        </#list>
    </tr>
    <#list results.records as record>
    <tr>
        <#list results.columns as col>
        <td>\\\${record[col]!""}</td>
        </#list>
    </tr>
    </#list>
</table>\`,
                'row-alternating': '<tr class="<#if record?index % 2 == 0>even<#else>odd</#if>">',
                'current-date': '\${.now?string("MMMM d, yyyy")}',
                'assign-var': '<#assign myVar = "value">'
            };

            /**
             * Initializes the CodeMirror editor for the template.
             */
            let docGenFontSize = 12; // Track font size for the editor

            function initDocGenEditor() {
                if (docGenEditor) {
                    return; // Already initialized
                }

                const textarea = document.getElementById('docGenTemplate');
                const wrapper = document.getElementById('docGenEditorWrapper');

                docGenEditor = CodeMirror(wrapper, {
                    value: textarea.value || '',
                    mode: 'xml',
                    theme: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dracula' : 'eclipse',
                    lineNumbers: true,
                    lineWrapping: true,
                    autoCloseTags: true,
                    matchTags: { bothTags: true },
                    matchBrackets: true,
                    styleActiveLine: true,
                    foldGutter: true,
                    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
                    indentUnit: 4,
                    tabSize: 4,
                    indentWithTabs: false,
                    extraKeys: {
                        'Tab': (cm) => cm.execCommand('indentMore'),
                        'Shift-Tab': (cm) => cm.execCommand('indentLess'),
                        'Ctrl-/': (cm) => cm.execCommand('toggleComment'),
                        'Cmd-/': (cm) => cm.execCommand('toggleComment'),
                        'Ctrl-F': (cm) => cm.execCommand('find'),
                        'Cmd-F': (cm) => cm.execCommand('find'),
                        'Ctrl-H': (cm) => cm.execCommand('replace'),
                        'Cmd-Option-F': (cm) => cm.execCommand('replace'),
                        'Ctrl-G': (cm) => cm.execCommand('jumpToLine'),
                        'Cmd-G': (cm) => cm.execCommand('jumpToLine'),
                        'Ctrl-Shift-F': (cm) => cm.execCommand('replace'),
                        'Cmd-Shift-F': (cm) => cm.execCommand('replace')
                    }
                });

                // Apply saved font size
                docGenEditor.getWrapperElement().style.fontSize = docGenFontSize + 'px';
                updateFontSizeDisplay();

                // Sync changes back to hidden textarea
                docGenEditor.on('change', () => {
                    textarea.value = docGenEditor.getValue();
                });
            }

            function updateFontSizeDisplay() {
                const display = document.getElementById('docGenFontSizeDisplay');
                if (display) {
                    display.textContent = docGenFontSize + 'px';
                }
            }

            // Document Generator Editor Toolbar Functions
            function docGenEditorUndo() {
                if (docGenEditor) {
                    docGenEditor.undo();
                    docGenEditor.focus();
                }
            }

            function docGenEditorRedo() {
                if (docGenEditor) {
                    docGenEditor.redo();
                    docGenEditor.focus();
                }
            }

            function docGenEditorFind() {
                if (docGenEditor) {
                    docGenEditor.execCommand('find');
                }
            }

            function docGenEditorReplace() {
                if (docGenEditor) {
                    docGenEditor.execCommand('replace');
                }
            }

            function docGenEditorFontSize(delta) {
                if (!docGenEditor) return;

                const minSize = 8;
                const maxSize = 24;
                docGenFontSize = Math.max(minSize, Math.min(maxSize, docGenFontSize + delta));

                docGenEditor.getWrapperElement().style.fontSize = docGenFontSize + 'px';
                docGenEditor.refresh();
                updateFontSizeDisplay();
            }

            function docGenEditorToggleWrap() {
                if (!docGenEditor) return;

                const currentWrap = docGenEditor.getOption('lineWrapping');
                docGenEditor.setOption('lineWrapping', !currentWrap);

                const btn = document.getElementById('docGenWrapBtn');
                if (btn) {
                    btn.classList.toggle('active', !currentWrap);
                }
            }

            function docGenEditorFoldAll() {
                if (docGenEditor) {
                    CodeMirror.commands.foldAll(docGenEditor);
                }
            }

            function docGenEditorUnfoldAll() {
                if (docGenEditor) {
                    CodeMirror.commands.unfoldAll(docGenEditor);
                }
            }

            function docGenEditorGoToLine() {
                if (docGenEditor) {
                    docGenEditor.execCommand('jumpToLine');
                }
            }

            /**
             * Gets the current template value from CodeMirror or textarea.
             */
            function getDocGenTemplateValue() {
                if (docGenEditor) {
                    return docGenEditor.getValue();
                }
                return document.getElementById('docGenTemplate').value;
            }

            /**
             * Sets the template value in CodeMirror or textarea.
             */
            function setDocGenTemplateValue(value) {
                if (docGenEditor) {
                    docGenEditor.setValue(value);
                }
                document.getElementById('docGenTemplate').value = value;
            }

            function showDocGenModal() {
                if (!state.results || !state.results.records || state.results.records.length === 0) {
                    showToast('warning', 'No Data', 'Run a query first to generate a document.');
                    return;
                }

                // Populate saved projects dropdown
                populateProjectDropdown();

                // Reset to new document mode
                document.getElementById('docGenProjectSelect').value = '';
                document.getElementById('docGenDeleteBtn').disabled = true;
                updateProjectBadge(null);

                // Initialize with default data source (uses current query)
                docGenDataSources = [{
                    id: 'ds_' + Date.now(),
                    alias: 'results',
                    useCurrentQuery: true,
                    query: '',
                    rowBegin: 1,
                    rowEnd: Math.min(state.results.records.length, 100)
                }];
                renderDocGenDataSources();

                // Show available columns
                const columns = Object.keys(state.results.records[0]).filter(c => c !== 'rownumber');
                const columnsList = document.getElementById('docGenColumnsList');
                columnsList.innerHTML = columns.map(col =>
                    \`<span class="badge bg-secondary me-1 mb-1" style="font-weight: normal; cursor: pointer;"
                           onclick="SQT.insertDocGenColumn('\${col}')"
                           title="Click to copy">\${col}</span>\`
                ).join('');
                document.getElementById('docGenColumnsSection').style.display = 'block';

                // Load default template if empty
                const currentTemplate = getDocGenTemplateValue();
                if (!currentTemplate.trim()) {
                    setDocGenTemplateValue(DOCGEN_TEMPLATES['simple-table']);
                    document.getElementById('docGenTemplateSelect').value = 'simple-table';
                }

                // Show modal and initialize editor after it's visible
                const modal = new bootstrap.Modal(document.getElementById('docGenModal'));
                document.getElementById('docGenModal').addEventListener('shown.bs.modal', function onShown() {
                    initDocGenEditor();
                    initSnippetsDropdown();
                    if (docGenEditor) {
                        docGenEditor.refresh();
                        // Update theme based on current setting
                        const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
                        docGenEditor.setOption('theme', isDark ? 'dracula' : 'eclipse');
                    }
                    document.getElementById('docGenModal').removeEventListener('shown.bs.modal', onShown);
                }, { once: true });

                modal.show();
            }

            /**
             * Toggles fullscreen mode for the Document Generator modal.
             */
            function toggleDocGenFullscreen() {
                const dialog = document.getElementById('docGenModalDialog');
                const btn = document.getElementById('docGenFullscreenBtn');
                const isFullscreen = dialog.classList.toggle('modal-fullscreen');

                // Update button icon
                btn.innerHTML = isFullscreen
                    ? '<i class="bi bi-fullscreen-exit"></i>'
                    : '<i class="bi bi-arrows-fullscreen"></i>';

                // Refresh CodeMirror to adjust to new size
                if (docGenEditor) {
                    setTimeout(() => docGenEditor.refresh(), 100);
                }
            }

            /**
             * Renders the data sources UI cards.
             */
            function renderDocGenDataSources() {
                const container = document.getElementById('docGenDataSources');
                const rowCount = state.results?.records?.length || 0;

                container.innerHTML = docGenDataSources.map((ds, index) => {
                    const isPrimary = index === 0;
                    const queryPreview = ds.useCurrentQuery
                        ? (state.lastExecutedQuery || 'No query executed').substring(0, 100) + (state.lastExecutedQuery?.length > 100 ? '...' : '')
                        : (ds.query || 'Enter a custom query').substring(0, 100);

                    return \`
                        <div class="docgen-datasource-card \${isPrimary ? 'primary' : ''}" data-ds-id="\${ds.id}">
                            \${!isPrimary ? \`<button type="button" class="btn btn-outline-danger docgen-datasource-remove" onclick="SQT.removeDocGenDataSource('\${ds.id}')" title="Remove">
                                <i class="bi bi-x"></i>
                            </button>\` : ''}
                            <div class="docgen-datasource-header">
                                <div class="d-flex align-items-center gap-2">
                                    <input type="text" class="form-control alias-input" value="\${ds.alias}"
                                           onchange="SQT.updateDocGenDataSource('\${ds.id}', 'alias', this.value)"
                                           placeholder="alias" \${isPrimary ? 'title="Primary data source alias"' : ''}>
                                    \${isPrimary ? '<span class="badge bg-primary">Primary</span>' : '<span class="badge bg-secondary">Additional</span>'}
                                </div>
                            </div>
                            <div class="docgen-datasource-body">
                                <div class="mb-2">
                                    <label class="form-label">Query Source</label>
                                    <select class="form-select" onchange="SQT.updateDocGenDataSource('\${ds.id}', 'useCurrentQuery', this.value === 'current')">
                                        <option value="current" \${ds.useCurrentQuery ? 'selected' : ''}>Use Current Query</option>
                                        <option value="custom" \${!ds.useCurrentQuery ? 'selected' : ''}>Custom Query</option>
                                    </select>
                                </div>
                                \${!ds.useCurrentQuery ? \`
                                    <div class="mb-2">
                                        <label class="form-label">Custom Query</label>
                                        <textarea class="form-control font-monospace" rows="2" placeholder="SELECT * FROM ..."
                                                  onchange="SQT.updateDocGenDataSource('\${ds.id}', 'query', this.value)">\${ds.query || ''}</textarea>
                                    </div>
                                \` : ''}
                                <div class="row g-2">
                                    <div class="col-6">
                                        <label class="form-label">Row Begin</label>
                                        <input type="number" class="form-control" value="\${ds.rowBegin}" min="1"
                                               onchange="SQT.updateDocGenDataSource('\${ds.id}', 'rowBegin', parseInt(this.value))">
                                    </div>
                                    <div class="col-6">
                                        <label class="form-label">Row End</label>
                                        <input type="number" class="form-control" value="\${ds.rowEnd}" min="1"
                                               onchange="SQT.updateDocGenDataSource('\${ds.id}', 'rowEnd', parseInt(this.value))">
                                    </div>
                                </div>
                                \${ds.useCurrentQuery ? \`<div class="docgen-datasource-query">\${queryPreview}</div>\` : ''}
                                \${ds.useCurrentQuery ? \`<div class="form-text mt-1">Current results: \${rowCount} rows</div>\` : ''}
                            </div>
                        </div>
                    \`;
                }).join('');

                // Update alias reference in the FreeMarker info section
                updateDocGenAliasReference();
            }

            /**
             * Updates the FreeMarker variable reference based on current data sources.
             */
            function updateDocGenAliasReference() {
                const container = document.getElementById('docGenAliasReference');
                const aliasHtml = docGenDataSources.map(ds => \`
                    <code>\${ds.alias}.records</code> - array of rows<br>
                    <code>\${ds.alias}.columns</code> - column names<br>
                    <code>\${ds.alias}.count</code> - row count
                \`).join('<hr class="my-1">');
                container.innerHTML = aliasHtml;
            }

            /**
             * Adds a new data source.
             */
            function addDocGenDataSource() {
                const existingAliases = docGenDataSources.map(ds => ds.alias);
                let newAlias = 'data' + (docGenDataSources.length + 1);

                // Ensure unique alias
                let counter = 2;
                while (existingAliases.includes(newAlias)) {
                    newAlias = 'data' + (docGenDataSources.length + counter);
                    counter++;
                }

                docGenDataSources.push({
                    id: 'ds_' + Date.now(),
                    alias: newAlias,
                    useCurrentQuery: false,
                    query: '',
                    rowBegin: 1,
                    rowEnd: 100
                });

                renderDocGenDataSources();
                showToast('info', 'Data Source Added', \`Added new data source "\${newAlias}". Configure its query and settings.\`);
            }

            /**
             * Removes a data source by ID.
             */
            function removeDocGenDataSource(dsId) {
                const index = docGenDataSources.findIndex(ds => ds.id === dsId);
                if (index > 0) { // Can't remove primary (index 0)
                    const removed = docGenDataSources.splice(index, 1)[0];
                    renderDocGenDataSources();
                    showToast('info', 'Removed', \`Data source "\${removed.alias}" removed.\`);
                }
            }

            /**
             * Updates a data source property.
             */
            function updateDocGenDataSource(dsId, property, value) {
                const ds = docGenDataSources.find(ds => ds.id === dsId);
                if (ds) {
                    // Validate alias uniqueness
                    if (property === 'alias') {
                        const existing = docGenDataSources.find(d => d.id !== dsId && d.alias === value);
                        if (existing) {
                            showToast('warning', 'Duplicate Alias', \`Alias "\${value}" is already in use.\`);
                            renderDocGenDataSources(); // Reset the input
                            return;
                        }
                        if (!value.match(/^[a-zA-Z][a-zA-Z0-9_]*$/)) {
                            showToast('warning', 'Invalid Alias', 'Alias must start with a letter and contain only letters, numbers, and underscores.');
                            renderDocGenDataSources();
                            return;
                        }
                    }

                    ds[property] = value;

                    // Re-render if query source changed
                    if (property === 'useCurrentQuery') {
                        renderDocGenDataSources();
                    } else if (property === 'alias') {
                        updateDocGenAliasReference();
                    }
                }
            }

            /**
             * Gets all data sources for document generation.
             */
            function getDocGenDataSources() {
                return docGenDataSources.map(ds => ({
                    alias: ds.alias,
                    query: ds.useCurrentQuery ? state.lastExecutedQuery : ds.query,
                    rowBegin: ds.rowBegin || 1,
                    rowEnd: ds.rowEnd || 100
                }));
            }

            function loadDocGenTemplate() {
                const select = document.getElementById('docGenTemplateSelect');
                const templateKey = select.value;

                if (templateKey && templateKey !== 'custom' && DOCGEN_TEMPLATES[templateKey]) {
                    setDocGenTemplateValue(DOCGEN_TEMPLATES[templateKey]);

                    // Auto-add a second data source for master-detail template
                    if (templateKey === 'master-detail' && docGenDataSources.length === 1) {
                        addDocGenDataSource();
                        showToast('info', 'Multi-Source Template', 'Added a second data source for the master-detail template. Configure its query below.');
                    }
                }
            }

            /**
             * Initializes the snippets dropdown with proper positioning.
             */
            function initSnippetsDropdown() {
                const btn = document.getElementById('docGenSnippetsBtn');
                const menu = document.querySelector('#docGenSnippetsDropdown .dropdown-menu');

                if (!btn || !menu) return;

                // Position the dropdown when shown
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const isOpen = menu.classList.contains('show');

                    if (!isOpen) {
                        // Calculate position relative to button
                        const rect = btn.getBoundingClientRect();
                        menu.style.top = (rect.bottom + 4) + 'px';
                        menu.style.right = (window.innerWidth - rect.right) + 'px';
                        menu.classList.add('show');
                        btn.setAttribute('aria-expanded', 'true');
                    } else {
                        menu.classList.remove('show');
                        btn.setAttribute('aria-expanded', 'false');
                    }
                });

                // Close when clicking outside
                document.addEventListener('click', function(e) {
                    if (!btn.contains(e.target) && !menu.contains(e.target)) {
                        menu.classList.remove('show');
                        btn.setAttribute('aria-expanded', 'false');
                    }
                });
            }

            /**
             * Inserts a snippet at the current cursor position in the editor.
             */
            function insertDocGenSnippet(snippetKey) {
                const snippet = DOCGEN_SNIPPETS[snippetKey];
                if (!snippet) return;

                // Close the dropdown
                const dropdownMenu = document.querySelector('#docGenSnippetsDropdown .dropdown-menu');
                if (dropdownMenu) {
                    dropdownMenu.classList.remove('show');
                }
                const dropdownBtn = document.getElementById('docGenSnippetsBtn');
                if (dropdownBtn) {
                    dropdownBtn.setAttribute('aria-expanded', 'false');
                }

                if (docGenEditor) {
                    const cursor = docGenEditor.getCursor();
                    docGenEditor.replaceRange(snippet, cursor);
                    docGenEditor.focus();
                } else {
                    const templateArea = document.getElementById('docGenTemplate');
                    const start = templateArea.selectionStart;
                    const text = templateArea.value;
                    templateArea.value = text.substring(0, start) + snippet + text.substring(start);
                    templateArea.focus();
                }

                showToast('info', 'Snippet Inserted', 'FreeMarker snippet added to template.');
            }

            function insertDocGenColumn(columnName) {
                var dollar = String.fromCharCode(36);
                var insertText = dollar + '{record.' + columnName + '!""}';

                if (docGenEditor) {
                    const cursor = docGenEditor.getCursor();
                    docGenEditor.replaceRange(insertText, cursor);
                    docGenEditor.focus();
                } else {
                    const templateArea = document.getElementById('docGenTemplate');
                    const start = templateArea.selectionStart;
                    const end = templateArea.selectionEnd;
                    const text = templateArea.value;
                    templateArea.value = text.substring(0, start) + insertText + text.substring(end);
                    templateArea.selectionStart = templateArea.selectionEnd = start + insertText.length;
                    templateArea.focus();
                }

                showToast('info', 'Inserted', \`Column reference for "\${columnName}" inserted.\`);
            }

            function formatDocGenTemplate() {
                let html = getDocGenTemplateValue();

                // Simple formatting: add newlines after closing tags
                html = html.replace(/></g, '>\\n<');

                setDocGenTemplateValue(html);
                showToast('info', 'Formatted', 'Template formatted.');
            }

            /**
             * Finds the line number where a pattern occurs in the template.
             */
            function findLineNumber(template, pattern) {
                const lines = template.split('\\n');
                for (let i = 0; i < lines.length; i++) {
                    if (typeof pattern === 'string') {
                        if (lines[i].includes(pattern)) return i + 1;
                    } else {
                        if (pattern.test(lines[i])) return i + 1;
                    }
                }
                return 0;
            }

            /**
             * Jumps to a specific line in the CodeMirror editor.
             */
            function jumpToEditorLine(lineNumber) {
                if (docGenEditor) {
                    const line = lineNumber - 1;
                    docGenEditor.scrollIntoView({ line: line, ch: 0 }, 100);
                    docGenEditor.setCursor({ line: line, ch: 0 });
                    docGenEditor.focus();
                    const modal = bootstrap.Modal.getInstance(document.getElementById('docGenValidationModal'));
                    if (modal) modal.hide();
                }
            }

            // Store pending generation state for proceeding after warnings
            let pendingDocGeneration = null;

            /**
             * Proceeds with document generation after user confirms warnings.
             */
            function proceedWithGeneration() {
                const modal = bootstrap.Modal.getInstance(document.getElementById('docGenValidationModal'));
                if (modal) modal.hide();
                if (pendingDocGeneration) {
                    executeDocumentGeneration(pendingDocGeneration.format, pendingDocGeneration.isPreview);
                    pendingDocGeneration = null;
                }
            }

            /**
             * Shows the validation results modal.
             */
            function showValidationModal(errors, warnings, showProceed) {
                const summaryEl = document.getElementById('docGenValidationSummary');
                const resultsEl = document.getElementById('docGenValidationResults');
                const proceedBtn = document.getElementById('docGenValidationProceedBtn');

                let summaryHtml = '';
                if (errors.length === 0 && warnings.length === 0) {
                    summaryHtml = '<div class="alert alert-success mb-0"><i class="bi bi-check-circle me-2"></i><strong>Valid!</strong> No issues found.</div>';
                } else {
                    if (errors.length > 0) {
                        summaryHtml += \`<span class="badge bg-danger me-2">\${errors.length} Error\${errors.length > 1 ? 's' : ''}</span>\`;
                    }
                    if (warnings.length > 0) {
                        summaryHtml += \`<span class="badge bg-warning text-dark">\${warnings.length} Warning\${warnings.length > 1 ? 's' : ''}</span>\`;
                    }
                }
                summaryEl.innerHTML = summaryHtml;

                let resultsHtml = '';
                if (errors.length > 0) {
                    resultsHtml += '<h6 class="text-danger mb-2"><i class="bi bi-x-circle me-1"></i>Errors (must fix)</h6>';
                    resultsHtml += '<ul class="list-group mb-3">';
                    for (const err of errors) {
                        const lineInfo = err.line ? \` <span class="badge bg-secondary">Line \${err.line}</span>\` : '';
                        const clickAttr = err.line ? \` onclick="SQT.jumpToEditorLine(\${err.line})" style="cursor: pointer;"\` : '';
                        const ctx = err.context ? \`<div class="small text-muted font-monospace mt-1" style="font-size: 11px;">\${escapeHtml(err.context)}...</div>\` : '';
                        resultsHtml += \`<li class="list-group-item list-group-item-danger"\${clickAttr}>\${escapeHtml(err.message)}\${lineInfo}\${ctx}</li>\`;
                    }
                    resultsHtml += '</ul>';
                }
                if (warnings.length > 0) {
                    resultsHtml += '<h6 class="text-warning mb-2"><i class="bi bi-exclamation-triangle me-1"></i>Warnings</h6>';
                    resultsHtml += '<ul class="list-group">';
                    for (const warn of warnings) {
                        const lineInfo = warn.line ? \` <span class="badge bg-secondary">Line \${warn.line}</span>\` : '';
                        const clickAttr = warn.line ? \` onclick="SQT.jumpToEditorLine(\${warn.line})" style="cursor: pointer;"\` : '';
                        const ctx = warn.context ? \`<div class="small text-muted font-monospace mt-1" style="font-size: 11px;">\${escapeHtml(warn.context)}...</div>\` : '';
                        resultsHtml += \`<li class="list-group-item list-group-item-warning"\${clickAttr}>\${escapeHtml(warn.message)}\${lineInfo}\${ctx}</li>\`;
                    }
                    resultsHtml += '</ul>';
                }
                resultsEl.innerHTML = resultsHtml;

                if (showProceed && errors.length === 0 && warnings.length > 0) {
                    proceedBtn.classList.remove('d-none');
                } else {
                    proceedBtn.classList.add('d-none');
                }

                const modal = new bootstrap.Modal(document.getElementById('docGenValidationModal'));
                modal.show();
            }

            /**
             * Validates the template for common issues.
             * @param {boolean} showModal - Whether to show the validation modal
             * @returns {Object} {errors: [], warnings: [], isValid: boolean}
             */
            function validateDocGenTemplate(showModal) {
                if (showModal === undefined) showModal = true;
                const template = getDocGenTemplateValue();
                const errors = [];
                const warnings = [];
                const dollar = String.fromCharCode(36);

                // Get configured data source aliases
                const dataSources = docGenDataSources || [];
                const aliases = dataSources.map(ds => ds.alias);

                // ========== STRUCTURE CHECKS ==========
                if (!template.includes('<?xml')) {
                    warnings.push({ message: 'Missing XML declaration (<?xml version="1.0"?>)', line: 1 });
                }
                if (!template.includes('<pdf>') && !template.includes('<html>')) {
                    warnings.push({ message: 'Template should start with <pdf> or <html> root element', line: 1 });
                }

                // ========== XML SYNTAX VALIDATION ==========
                try {
                    // Strip FreeMarker for XML validation
                    let xmlForValidation = template
                        .replace(/<#[^>]*>/g, '')
                        .replace(/<\\/#[^>]*>/g, '')
                        .replace(/\\$\\{[^}]*\\}/g, 'X');

                    const parser = new DOMParser();
                    const doc = parser.parseFromString(xmlForValidation, 'application/xml');
                    const parseError = doc.querySelector('parsererror');
                    if (parseError) {
                        let errorText = parseError.textContent || 'XML parsing error';
                        const lineMatch = errorText.match(/line\\s+(\\d+)/i);
                        const errorLine = lineMatch ? parseInt(lineMatch[1]) : 0;
                        errorText = errorText.replace(/Below is a rendering[\\s\\S]*/i, '').trim();
                        if (errorText.length > 150) errorText = errorText.substring(0, 150) + '...';
                        errors.push({ message: 'XML syntax error: ' + errorText, line: errorLine });
                    }
                } catch (xmlErr) {
                    console.error('XML validation error:', xmlErr);
                }

                // Check for unclosed tags (e.g., "</head<body>" - missing >)
                try {
                    const xmlLines = template.split('\\n');
                    for (let i = 0; i < xmlLines.length; i++) {
                        const xmlLine = xmlLines[i];
                        if (xmlLine.includes('<#') || xmlLine.includes('</#')) continue;

                        let searchPos = 0;
                        while (searchPos < xmlLine.length) {
                            const tagStart = xmlLine.indexOf('<', searchPos);
                            if (tagStart === -1) break;

                            const nextChar = xmlLine[tagStart + 1] || '';
                            const isXmlTag = (nextChar >= 'a' && nextChar <= 'z') ||
                                             (nextChar >= 'A' && nextChar <= 'Z') ||
                                             nextChar === '/';
                            const isDecl = nextChar === '!' || nextChar === '?';

                            if (isXmlTag && !isDecl) {
                                const tagEnd = xmlLine.indexOf('>', tagStart);
                                const nextTagStart = xmlLine.indexOf('<', tagStart + 1);

                                if (tagEnd === -1) {
                                    errors.push({
                                        message: 'Unclosed XML tag - missing ">" delimiter',
                                        line: i + 1,
                                        context: xmlLine.trim().substring(0, 50)
                                    });
                                    break;
                                } else if (nextTagStart !== -1 && nextTagStart < tagEnd) {
                                    errors.push({
                                        message: 'Unclosed XML tag - missing ">" delimiter',
                                        line: i + 1,
                                        context: xmlLine.substring(tagStart, Math.min(tagStart + 40, xmlLine.length))
                                    });
                                    searchPos = nextTagStart;
                                    continue;
                                } else {
                                    searchPos = tagEnd + 1;
                                }
                            } else {
                                searchPos = tagStart + 1;
                            }
                        }
                    }
                } catch (tagErr) {
                    console.error('Tag check error:', tagErr);
                }

                // ========== FREEMARKER DIRECTIVE CHECKS ==========
                const listOpens = (template.match(/<#list/g) || []).length;
                const listCloses = (template.match(/<\\/#list>/g) || []).length;
                if (listOpens !== listCloses) {
                    errors.push({
                        message: \`Unclosed <#list> directive: \${listOpens} opens, \${listCloses} closes\`,
                        line: findLineNumber(template, '<#list')
                    });
                }

                const ifOpens = (template.match(/<#if/g) || []).length;
                const ifCloses = (template.match(/<\\/#if>/g) || []).length;
                if (ifOpens !== ifCloses) {
                    errors.push({
                        message: \`Unclosed <#if> directive: \${ifOpens} opens, \${ifCloses} closes\`,
                        line: findLineNumber(template, '<#if')
                    });
                }

                // ========== UNSUPPORTED FREEMARKER FEATURES ==========
                if (template.includes('?string.currency')) {
                    errors.push({
                        message: '?string.currency is not supported in NetSuite. Format currency manually.',
                        line: findLineNumber(template, '?string.currency')
                    });
                }
                if (template.includes('?item_parity')) {
                    errors.push({
                        message: '?item_parity is not supported. Use ?index % 2 instead.',
                        line: findLineNumber(template, '?item_parity')
                    });
                }
                if (template.includes('?then(')) {
                    errors.push({
                        message: '?then() ternary is not supported. Use <#if>...<#else>...</#if>.',
                        line: findLineNumber(template, '?then(')
                    });
                }

                // Check for iterating without .records
                for (const alias of aliases) {
                    const pattern = '<#list ' + alias + ' as ';
                    if (template.includes(pattern) && !template.includes('<#list ' + alias + '.records as ')) {
                        errors.push({
                            message: \`Use <#list \${alias}.records as row> instead of <#list \${alias} as row>.\`,
                            line: findLineNumber(template, pattern)
                        });
                    }
                }

                // ========== CSS WARNINGS ==========
                if (template.includes('display: flex') || template.includes('display:flex')) {
                    warnings.push({
                        message: 'CSS flexbox is not supported in the PDF renderer.',
                        line: findLineNumber(template, 'display: flex') || findLineNumber(template, 'display:flex')
                    });
                }
                if (template.includes('display: grid') || template.includes('display:grid')) {
                    warnings.push({
                        message: 'CSS grid is not supported in the PDF renderer.',
                        line: findLineNumber(template, 'display: grid') || findLineNumber(template, 'display:grid')
                    });
                }
                if (template.includes(':hover')) {
                    warnings.push({
                        message: 'CSS :hover is not supported in PDF documents.',
                        line: findLineNumber(template, ':hover')
                    });
                }
                if (template.includes(':nth-child')) {
                    warnings.push({
                        message: 'CSS :nth-child is not supported. Use FreeMarker ?index % 2.',
                        line: findLineNumber(template, ':nth-child')
                    });
                }

                // ========== BEST PRACTICE WARNINGS ==========
                if (template.includes('== true') || template.includes('== false')) {
                    warnings.push({
                        message: 'NetSuite uses "T" and "F" strings for booleans, not true/false.',
                        line: findLineNumber(template, '== true') || findLineNumber(template, '== false')
                    });
                }

                const unescapedAmpersands = template.match(/&(?!(amp|lt|gt|apos|quot|#[0-9]+|#x[0-9a-fA-F]+);)/g);
                if (unescapedAmpersands && unescapedAmpersands.length > 0) {
                    warnings.push({
                        message: \`Found \${unescapedAmpersands.length} unescaped & character(s) - will be auto-escaped.\`,
                        line: 0
                    });
                }

                // ========== DISPLAY RESULTS ==========
                const isValid = errors.length === 0;

                if (showModal) {
                    if (errors.length === 0 && warnings.length === 0) {
                        showToast('success', 'Valid', 'Template validation passed!');
                    } else {
                        showValidationModal(errors, warnings, false);
                    }
                }

                return { errors: errors, warnings: warnings, isValid: isValid };
            }

            function previewDocGen() {
                showToast('info', 'Preview', 'Generating preview... This will open in a new window.');
                generateDocument('html', true);
            }

            async function generateDocument(formatOverride, isPreview = false) {
                const format = formatOverride || document.querySelector('input[name="docGenFormat"]:checked').value;
                const template = getDocGenTemplateValue();

                if (!template.trim()) {
                    showToast('warning', 'No Template', 'Please enter a template or select a quick template.');
                    return;
                }

                // Get all data sources
                const dataSources = getDocGenDataSources();

                // Validate data sources
                for (const ds of dataSources) {
                    if (!ds.query || !ds.query.trim()) {
                        showToast('warning', 'Missing Query', \`Data source "\${ds.alias}" has no query defined.\`);
                        return;
                    }
                }

                // Run template validation (without showing modal)
                let validation;
                try {
                    validation = validateDocGenTemplate(false);
                } catch (validationError) {
                    console.error('Template validation error:', validationError);
                    showToast('error', 'Validation Error', 'An error occurred during validation. Check console.');
                    return;
                }

                // If there are errors, show modal and block generation
                if (!validation || !validation.isValid) {
                    showValidationModal(validation ? validation.errors : [], validation ? validation.warnings : [], false);
                    return;
                }

                // If there are warnings, show modal with "Generate Anyway" button
                if (validation.warnings && validation.warnings.length > 0) {
                    pendingDocGeneration = { format: format, isPreview: isPreview };
                    showValidationModal(validation.errors, validation.warnings, true);
                    return;
                }

                // No issues, proceed with generation
                executeDocumentGeneration(format, isPreview);
            }

            /**
             * Executes the actual document generation (called after validation passes).
             */
            async function executeDocumentGeneration(format, isPreview) {
                const template = getDocGenTemplateValue();
                const dataSources = getDocGenDataSources();

                const submitBtn = document.getElementById('docGenSubmitBtn');
                const originalText = submitBtn.innerHTML;
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Generating...';

                try {
                    // Submit document info to server
                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            function: 'documentSubmit',
                            dataSources: dataSources,
                            template: template,
                            docType: format
                        })
                    });

                    const result = await response.json();

                    if (result.error) {
                        throw new Error(result.error);
                    }

                    if (result.submitted) {
                        // Open the document in a new window
                        const docUrl = CONFIG.SCRIPT_URL + '&function=documentGenerate';
                        window.open(docUrl, '_blank');

                        if (!isPreview) {
                            showToast('success', 'Document Generated', \`Your \${format.toUpperCase()} document is ready.\`);
                        }
                    }

                } catch (error) {
                    console.error('Document generation error:', error);
                    showToast('error', 'Generation Failed', error.message || 'Failed to generate document.');
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                }
            }

            // =================================================================
            // SUITELET GENERATION
            // =================================================================

            var suiteletPreviewEditor = null;

            /**
             * Shows the Suitelet generation options modal.
             * Validates template first and extracts parameters.
             */
            function showGenerateSuiteletModal() {
                // Validate template first (same as Generate Document)
                var template = getDocGenTemplateValue();

                if (!template.trim()) {
                    showToast('warning', 'No Template', 'Please enter a template before generating a Suitelet.');
                    return;
                }

                // Validate data sources have queries
                var dataSources = getDocGenDataSources();
                for (var i = 0; i < dataSources.length; i++) {
                    if (!dataSources[i].query || !dataSources[i].query.trim()) {
                        showToast('warning', 'Missing Query', 'Data source "' + dataSources[i].alias + '" has no query defined.');
                        return;
                    }
                }

                // Run template validation
                var validation;
                try {
                    validation = validateDocGenTemplate(false);
                } catch (validationError) {
                    console.error('Template validation error:', validationError);
                    showToast('error', 'Validation Error', 'An error occurred during validation.');
                    return;
                }

                // Block if there are errors
                if (!validation || !validation.isValid) {
                    showValidationModal(validation ? validation.errors : [], validation ? validation.warnings : [], false);
                    return;
                }

                // Extract parameters from all data sources
                var allParams = [];
                for (var i = 0; i < dataSources.length; i++) {
                    var dsParams = extractParameters(dataSources[i].query || '');
                    for (var j = 0; j < dsParams.length; j++) {
                        if (allParams.indexOf(dsParams[j]) === -1) {
                            allParams.push(dsParams[j]);
                        }
                    }
                }

                // Show detected parameters
                var paramsInfo = document.getElementById('suiteletParamsInfo');
                var paramsList = document.getElementById('suiteletParamsList');
                if (allParams.length > 0) {
                    paramsList.innerHTML = allParams.map(function(p) {
                        return '<code>' + escapeHtml(p) + '</code>';
                    }).join(', ');
                    paramsInfo.style.display = 'block';
                } else {
                    paramsInfo.style.display = 'none';
                }

                // Reset form fields
                document.getElementById('suiteletScriptId').value = '';
                document.getElementById('suiteletCommentLevel').value = 'minimal';
                document.getElementById('suiteletOutputMode').value = 'inline';

                // Show options modal
                new bootstrap.Modal(document.getElementById('suiteletOptionsModal')).show();
            }

            /**
             * Generates the Suitelet code and displays it in the preview modal.
             */
            function generateSuiteletCode() {
                var commentLevel = document.getElementById('suiteletCommentLevel').value;
                var outputMode = document.getElementById('suiteletOutputMode').value;
                var scriptId = document.getElementById('suiteletScriptId').value.trim();

                var template = getDocGenTemplateValue();
                var dataSources = getDocGenDataSources();

                // Extract all parameters
                var allParams = [];
                for (var i = 0; i < dataSources.length; i++) {
                    var dsParams = extractParameters(dataSources[i].query || '');
                    for (var j = 0; j < dsParams.length; j++) {
                        if (allParams.indexOf(dsParams[j]) === -1) {
                            allParams.push(dsParams[j]);
                        }
                    }
                }

                // Build the Suitelet code
                var code = buildSuiteletCode({
                    template: template,
                    dataSources: dataSources,
                    params: allParams,
                    commentLevel: commentLevel,
                    outputMode: outputMode,
                    scriptId: scriptId
                });

                // Close options modal
                bootstrap.Modal.getInstance(document.getElementById('suiteletOptionsModal')).hide();

                // Show preview modal with CodeMirror
                var previewModal = new bootstrap.Modal(document.getElementById('suiteletPreviewModal'));
                previewModal.show();

                // Initialize CodeMirror for preview after modal is shown
                setTimeout(function() {
                    var wrapper = document.getElementById('suiteletPreviewWrapper');
                    wrapper.innerHTML = '';

                    suiteletPreviewEditor = CodeMirror(wrapper, {
                        value: code,
                        mode: 'javascript',
                        theme: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dracula' : 'eclipse',
                        lineNumbers: true,
                        readOnly: true,
                        foldGutter: true,
                        gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
                        viewportMargin: Infinity
                    });

                    suiteletPreviewEditor.setSize('100%', '500px');
                }, 200);
            }

            /**
             * Builds the Suitelet code from the template and data sources.
             * @param {Object} config - Configuration object
             * @returns {string} Generated Suitelet code
             */
            function buildSuiteletCode(config) {
                var template = config.template;
                var dataSources = config.dataSources;
                var params = config.params;
                var commentLevel = config.commentLevel;
                var outputMode = config.outputMode;
                var scriptId = config.scriptId || '';

                // Escape template for embedding as a JavaScript string literal
                var escapedTemplate = escapeForJSString(template);

                var lines = [];

                // JSDoc header
                lines.push('/**');
                lines.push(' * @NApiVersion 2.1');
                lines.push(' * @NScriptType Suitelet');
                if (scriptId) {
                    lines.push(' * @NScriptId ' + scriptId);
                }
                lines.push(' *');
                lines.push(' * Generated by SuiteQL Query Tool Document Generator');
                lines.push(' * Date: ' + new Date().toISOString().split('T')[0]);
                lines.push(' */');
                lines.push('');

                // Module definition
                lines.push("define(['N/query', 'N/render', 'N/log'], (query, render, log) => {");
                lines.push('');

                // Configuration constant
                if (commentLevel !== 'none') {
                    lines.push('    // =========================================================================');
                    lines.push('    // CONFIGURATION');
                    lines.push('    // =========================================================================');
                    lines.push('');
                }

                if (commentLevel === 'verbose') {
                    lines.push('    /**');
                    lines.push('     * Script configuration settings.');
                    lines.push("     * OUTPUT_MODE: 'inline' displays PDF in browser, 'download' prompts save dialog.");
                    lines.push('     */');
                }
                lines.push('    const CONFIG = {');
                lines.push("        OUTPUT_MODE: '" + outputMode + "',");
                lines.push("        FILENAME: 'report.pdf'");
                lines.push('    };');
                lines.push('');

                // Entry point
                if (commentLevel !== 'none') {
                    lines.push('    // =========================================================================');
                    lines.push('    // SUITELET ENTRY POINT');
                    lines.push('    // =========================================================================');
                    lines.push('');
                }

                if (commentLevel === 'verbose') {
                    lines.push('    /**');
                    lines.push('     * Main entry point for the Suitelet.');
                    lines.push('     * Handles GET requests to generate and return a PDF document.');
                    lines.push('     * @param {Object} context - Suitelet context object');
                    lines.push('     */');
                }
                lines.push('    const onRequest = (context) => {');
                lines.push('        try {');

                // Parameter extraction if needed
                if (params.length > 0) {
                    if (commentLevel === 'verbose') {
                        lines.push('            // Extract URL parameters from the request');
                    }
                    lines.push('            const params = context.request.parameters;');
                    lines.push('');

                    if (commentLevel === 'verbose') {
                        lines.push('            // Validate that all required parameters are present');
                    }
                    lines.push('            const requiredParams = ' + JSON.stringify(params) + ';');
                    lines.push('            const missingParams = requiredParams.filter(p => !params[p]);');
                    lines.push('            if (missingParams.length > 0) {');
                    lines.push("                context.response.write('Error: Missing required parameters: ' + missingParams.join(', '));");
                    lines.push('                return;');
                    lines.push('            }');
                    lines.push('');
                }

                // Create renderer
                if (commentLevel !== 'none') {
                    lines.push('            // Initialize the template renderer');
                }
                lines.push('            const renderer = render.create();');
                lines.push('');

                // Data sources
                if (commentLevel !== 'none') {
                    lines.push('            // =====================================================================');
                    lines.push('            // EXECUTE QUERIES AND ADD DATA SOURCES');
                    lines.push('            // =====================================================================');
                    lines.push('');
                }

                for (var i = 0; i < dataSources.length; i++) {
                    var ds = dataSources[i];
                    var dsQuery = ds.query;

                    // Replace {{param}} with parameter references for the generated code
                    var processedQuery = dsQuery;
                    for (var j = 0; j < params.length; j++) {
                        var paramPlaceholder = '{{' + params[j] + '}}';
                        // Replace with string concatenation in generated code
                        processedQuery = processedQuery.split(paramPlaceholder).join("' + params." + params[j] + " + '");
                    }

                    // Escape the query for JS string
                    var escapedQuery = escapeForJSString(processedQuery);

                    if (commentLevel === 'verbose') {
                        lines.push('            // Data source: ' + ds.alias);
                        lines.push('            // Execute query and prepare results for the template');
                    } else if (commentLevel === 'minimal') {
                        lines.push('            // Data source: ' + ds.alias);
                    }

                    lines.push("            const " + ds.alias + "Query = '" + escapedQuery + "';");
                    lines.push("            const " + ds.alias + "Results = query.runSuiteQL({ query: " + ds.alias + "Query }).asMappedResults();");
                    lines.push("            const " + ds.alias + "Columns = " + ds.alias + "Results.length > 0 ? Object.keys(" + ds.alias + "Results[0]) : [];");
                    lines.push('');
                    lines.push('            renderer.addCustomDataSource({');
                    lines.push("                alias: '" + ds.alias + "',");
                    lines.push('                format: render.DataSource.OBJECT,');
                    lines.push('                data: {');
                    lines.push('                    records: ' + ds.alias + 'Results,');
                    lines.push('                    columns: ' + ds.alias + 'Columns,');
                    lines.push('                    count: ' + ds.alias + 'Results.length');
                    lines.push('                }');
                    lines.push('            });');
                    lines.push('');
                }

                // Template
                if (commentLevel !== 'none') {
                    lines.push('            // =====================================================================');
                    lines.push('            // FREEMARKER TEMPLATE');
                    lines.push('            // =====================================================================');
                    lines.push('');
                }

                if (commentLevel === 'verbose') {
                    lines.push('            // The FreeMarker template defines the PDF layout and styling.');
                    lines.push('            // Access data using: ' + String.fromCharCode(36) + '{alias.records}, ' + String.fromCharCode(36) + '{alias.columns}, ' + String.fromCharCode(36) + '{alias.count}');
                }
                lines.push("            let template = '" + escapedTemplate + "';");
                lines.push('');

                // Add template sanitization (escape lone & characters for XML)
                if (commentLevel === 'verbose') {
                    lines.push('            // Sanitize template: escape lone & characters that are not valid XML entities');
                }
                lines.push("            template = template.replace(/&(?!(amp|lt|gt|apos|quot|#[0-9]+|#x[0-9a-fA-F]+);)/g, '&amp;');");
                lines.push('');
                lines.push('            renderer.templateContent = template;');
                lines.push('');

                // Output
                if (commentLevel !== 'none') {
                    lines.push('            // =====================================================================');
                    lines.push('            // GENERATE AND OUTPUT PDF');
                    lines.push('            // =====================================================================');
                    lines.push('');
                }

                if (commentLevel === 'verbose') {
                    lines.push('            // Render the template as a PDF file');
                }
                lines.push('            const pdfFile = renderer.renderAsPdf();');
                lines.push('');

                if (commentLevel === 'verbose') {
                    lines.push('            // Output the PDF - inline displays in browser, download prompts save');
                }
                lines.push("            if (CONFIG.OUTPUT_MODE === 'download') {");
                lines.push('                context.response.writeFile({ file: pdfFile, isInline: false });');
                lines.push('            } else {');
                lines.push('                context.response.writeFile({ file: pdfFile, isInline: true });');
                lines.push('            }');
                lines.push('');

                // Error handling
                lines.push('        } catch (e) {');
                lines.push("            log.error({ title: 'Report Generation Error', details: e });");
                lines.push("            context.response.write('Error generating report: ' + e.message);");
                lines.push('        }');
                lines.push('    };');
                lines.push('');
                lines.push('    return { onRequest };');
                lines.push('});');

                return lines.join('\\n');
            }

            /**
             * Escapes a string for use inside a JavaScript single-quoted string literal.
             * @param {string} str - The string to escape
             * @returns {string} Escaped string
             */
            function escapeForJSString(str) {
                return str
                    .replace(/\\\\/g, '\\\\\\\\')
                    .replace(/'/g, "\\\\'")
                    .replace(/\\n/g, '\\\\n')
                    .replace(/\\r/g, '\\\\r')
                    .replace(/\\t/g, '\\\\t');
            }

            /**
             * Copies the generated Suitelet code to clipboard.
             */
            function copySuiteletCode() {
                if (!suiteletPreviewEditor) return;

                var code = suiteletPreviewEditor.getValue();
                navigator.clipboard.writeText(code).then(function() {
                    showToast('success', 'Copied', 'Suitelet code copied to clipboard.');
                }).catch(function(err) {
                    console.error('Copy failed:', err);
                    showToast('error', 'Copy Failed', 'Failed to copy to clipboard.');
                });
            }

            /**
             * Downloads the generated Suitelet code as a .js file.
             */
            function downloadSuiteletCode() {
                if (!suiteletPreviewEditor) return;

                var code = suiteletPreviewEditor.getValue();
                var scriptId = document.getElementById('suiteletScriptId').value.trim();
                var filename = scriptId ? scriptId.replace(/^customscript_/, '') + '.js' : 'report_suitelet.js';

                var blob = new Blob([code], { type: 'application/javascript' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                showToast('success', 'Downloaded', 'Suitelet saved as ' + filename);
            }

            // =================================================================
            // DOCUMENT PROJECT MANAGEMENT
            // =================================================================

            /**
             * Gets all saved document projects from localStorage.
             * @returns {Array} Array of project objects
             */
            function getDocGenProjects() {
                try {
                    const projects = localStorage.getItem(CONFIG.DOCGEN_PROJECTS_KEY);
                    return projects ? JSON.parse(projects) : [];
                } catch (e) {
                    console.error('Error loading projects:', e);
                    return [];
                }
            }

            /**
             * Saves projects to localStorage.
             * @param {Array} projects - Array of project objects
             */
            function saveDocGenProjects(projects) {
                try {
                    localStorage.setItem(CONFIG.DOCGEN_PROJECTS_KEY, JSON.stringify(projects));
                } catch (e) {
                    console.error('Error saving projects:', e);
                    showToast('error', 'Save Error', 'Failed to save projects to local storage.');
                }
            }

            /**
             * Populates the project dropdown with saved projects.
             */
            function populateProjectDropdown() {
                const select = document.getElementById('docGenProjectSelect');
                const projects = getDocGenProjects();

                // Clear existing options except the first one
                select.innerHTML = '<option value="">-- New Document --</option>';

                // Add saved projects
                projects.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project.id;
                    option.textContent = project.name;
                    if (project.description) {
                        option.title = project.description;
                    }
                    select.appendChild(option);
                });
            }

            /**
             * Shows the save project modal.
             */
            function showSaveProjectModal() {
                const currentProjectId = document.getElementById('docGenProjectSelect').value;
                const projects = getDocGenProjects();
                const existingProject = projects.find(p => p.id === currentProjectId);

                // Pre-fill if editing existing project
                if (existingProject) {
                    document.getElementById('projectName').value = existingProject.name;
                    document.getElementById('projectDescription').value = existingProject.description || '';
                } else {
                    document.getElementById('projectName').value = '';
                    document.getElementById('projectDescription').value = '';
                }

                new bootstrap.Modal(document.getElementById('saveProjectModal')).show();
            }

            /**
             * Saves the current document configuration as a project.
             */
            function saveDocGenProject() {
                const name = document.getElementById('projectName').value.trim();
                const description = document.getElementById('projectDescription').value.trim();

                if (!name) {
                    showToast('warning', 'Name Required', 'Please enter a name for the project.');
                    document.getElementById('projectName').focus();
                    return;
                }

                const template = getDocGenTemplateValue();
                const format = document.querySelector('input[name="docGenFormat"]:checked').value;

                // Save data sources (without the current query - queries using current query will re-use at runtime)
                const dataSourcesToSave = docGenDataSources.map(ds => ({
                    alias: ds.alias,
                    useCurrentQuery: ds.useCurrentQuery,
                    query: ds.useCurrentQuery ? '' : ds.query, // Only save custom queries
                    rowBegin: ds.rowBegin,
                    rowEnd: ds.rowEnd
                }));

                const projects = getDocGenProjects();
                const currentProjectId = document.getElementById('docGenProjectSelect').value;

                // Check if updating existing or creating new
                const existingIndex = projects.findIndex(p => p.id === currentProjectId);

                const project = {
                    id: existingIndex >= 0 ? currentProjectId : 'project_' + Date.now(),
                    name: name,
                    description: description,
                    template: template,
                    outputFormat: format,
                    dataSources: dataSourcesToSave,
                    // Keep legacy fields for backwards compatibility
                    rowBegin: dataSourcesToSave[0]?.rowBegin || 1,
                    rowEnd: dataSourcesToSave[0]?.rowEnd || 100,
                    created: existingIndex >= 0 ? projects[existingIndex].created : new Date().toISOString(),
                    modified: new Date().toISOString()
                };

                if (existingIndex >= 0) {
                    projects[existingIndex] = project;
                    showToast('success', 'Project Updated', \`"\${name}" has been updated.\`);
                } else {
                    projects.push(project);
                    showToast('success', 'Project Saved', \`"\${name}" has been saved.\`);
                }

                saveDocGenProjects(projects);
                populateProjectDropdown();

                // Select the saved project
                document.getElementById('docGenProjectSelect').value = project.id;
                updateProjectBadge(project.name);
                document.getElementById('docGenDeleteBtn').disabled = false;

                // Close the save modal
                bootstrap.Modal.getInstance(document.getElementById('saveProjectModal')).hide();
            }

            /**
             * Loads a saved project into the document generator.
             */
            function loadDocGenProject() {
                const select = document.getElementById('docGenProjectSelect');
                const projectId = select.value;
                const deleteBtn = document.getElementById('docGenDeleteBtn');
                const rowCount = state.results?.records?.length || 100;

                if (!projectId) {
                    // New document - reset to defaults
                    setDocGenTemplateValue(DOCGEN_TEMPLATES['simple-table']);
                    document.getElementById('docGenTemplateSelect').value = 'simple-table';
                    document.getElementById('docGenPdf').checked = true;

                    // Reset to single data source using current query
                    docGenDataSources = [{
                        id: 'ds_' + Date.now(),
                        alias: 'results',
                        useCurrentQuery: true,
                        query: '',
                        rowBegin: 1,
                        rowEnd: Math.min(rowCount, 100)
                    }];
                    renderDocGenDataSources();

                    updateProjectBadge(null);
                    deleteBtn.disabled = true;
                    return;
                }

                const projects = getDocGenProjects();
                const project = projects.find(p => p.id === projectId);

                if (!project) {
                    showToast('error', 'Not Found', 'Project not found.');
                    return;
                }

                // Load project settings
                setDocGenTemplateValue(project.template || '');
                document.getElementById('docGenTemplateSelect').value = 'custom';

                if (project.outputFormat === 'html') {
                    document.getElementById('docGenHtml').checked = true;
                } else {
                    document.getElementById('docGenPdf').checked = true;
                }

                // Load data sources (with backwards compatibility for old projects)
                if (project.dataSources && project.dataSources.length > 0) {
                    docGenDataSources = project.dataSources.map(ds => ({
                        id: 'ds_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                        alias: ds.alias,
                        useCurrentQuery: ds.useCurrentQuery,
                        query: ds.query || '',
                        rowBegin: ds.rowBegin || 1,
                        rowEnd: ds.rowEnd || 100
                    }));
                } else {
                    // Legacy project format - single data source
                    docGenDataSources = [{
                        id: 'ds_' + Date.now(),
                        alias: 'results',
                        useCurrentQuery: true,
                        query: '',
                        rowBegin: project.rowBegin || 1,
                        rowEnd: project.rowEnd || 100
                    }];
                }
                renderDocGenDataSources();

                updateProjectBadge(project.name);
                deleteBtn.disabled = false;

                showToast('info', 'Project Loaded', \`"\${project.name}" loaded.\`);
            }

            /**
             * Deletes the currently selected project.
             */
            function deleteDocGenProject() {
                const select = document.getElementById('docGenProjectSelect');
                const projectId = select.value;

                if (!projectId) return;

                const projects = getDocGenProjects();
                const project = projects.find(p => p.id === projectId);

                if (!project) return;

                if (!confirm(\`Are you sure you want to delete "\${project.name}"?\`)) {
                    return;
                }

                const updatedProjects = projects.filter(p => p.id !== projectId);
                saveDocGenProjects(updatedProjects);
                populateProjectDropdown();

                // Reset to new document
                select.value = '';
                loadDocGenProject();

                showToast('success', 'Project Deleted', \`"\${project.name}" has been deleted.\`);
            }

            /**
             * Updates the project badge in the modal header.
             * @param {string|null} projectName - Project name or null to hide
             */
            function updateProjectBadge(projectName) {
                const badge = document.getElementById('docGenProjectBadge');
                if (projectName) {
                    badge.textContent = projectName;
                    badge.style.display = 'inline';
                } else {
                    badge.style.display = 'none';
                }
            }

            // =================================================================
            // AI TEMPLATE GENERATION
            // =================================================================

            /**
             * Shows the AI template generation modal.
             * Automatically detects if there's existing code to enable "refine" mode.
             */
            function showDocGenAIModal() {
                // Check if AI is configured
                const settings = loadAISettings();
                const apiKey = settings?.apiKey || state.aiApiKey;

                if (!settings || !apiKey) {
                    showToast('warning', 'AI Not Configured', 'Please configure AI settings first.');
                    showAISettings();
                    return;
                }

                // Populate data sources info
                populateDocGenAIDataSourcesInfo();

                // Check if there's existing template code
                const existingTemplate = getDocGenTemplateValue().trim();
                const hasExistingCode = existingTemplate.length > 50; // More than just whitespace/minimal content

                // Update modal for generate vs refine mode
                const modalTitle = document.querySelector('#docGenAIModal .modal-title');
                const promptLabel = document.querySelector('#docGenAIModal label[for="docGenAIPrompt"]');
                const promptTextarea = document.getElementById('docGenAIPrompt');
                const replaceCheckboxDiv = document.getElementById('docGenAIReplaceTemplate').closest('.form-check');
                const submitBtn = document.getElementById('docGenAISubmitBtn');

                if (hasExistingCode) {
                    // Refine mode
                    modalTitle.innerHTML = '<i class="bi bi-stars me-2"></i>AI Template Refiner';
                    promptLabel.textContent = 'What would you like to change?';
                    promptTextarea.placeholder = 'Examples:\\n• Add a footer with page numbers\\n• Change the header color to blue\\n• Add a column for phone number\\n• Make the table rows have alternating colors\\n• Add a summary section at the bottom with totals';
                    submitBtn.innerHTML = '<i class="bi bi-stars me-1"></i>Refine Template';
                    replaceCheckboxDiv.style.display = 'none'; // Always replace when refining
                    document.getElementById('docGenAIReplaceTemplate').checked = true;
                } else {
                    // Generate mode
                    modalTitle.innerHTML = '<i class="bi bi-stars me-2"></i>AI Template Generator';
                    promptLabel.textContent = 'Describe your document';
                    promptTextarea.placeholder = 'Example: Create a professional invoice with a company header, customer billing information at the top, a table of line items showing item name, quantity, rate, and amount, followed by subtotal, tax, and total at the bottom. Use alternating row colors for the table.';
                    submitBtn.innerHTML = '<i class="bi bi-stars me-1"></i>Generate Template';
                    replaceCheckboxDiv.style.display = 'block';
                }

                // Store mode for use in generation
                document.getElementById('docGenAIModal').dataset.mode = hasExistingCode ? 'refine' : 'generate';

                // Clear previous state
                document.getElementById('docGenAIPrompt').value = '';
                document.getElementById('docGenAIError').classList.add('d-none');
                document.getElementById('docGenAILoading').classList.add('d-none');
                document.getElementById('docGenAISubmitBtn').disabled = false;

                // Show modal
                new bootstrap.Modal(document.getElementById('docGenAIModal')).show();
            }

            /**
             * Populates the data sources info section in the AI modal.
             */
            function populateDocGenAIDataSourcesInfo() {
                const container = document.getElementById('docGenAIDataSourcesInfo');
                if (!container) return;

                let html = '';

                docGenDataSources.forEach((ds, index) => {
                    const columns = getColumnsForDataSource(ds);
                    const recordCount = ds.useCurrentQuery
                        ? (state.results?.records?.length || 0)
                        : '?';

                    html += \`
                        <div class="\${index > 0 ? 'mt-2 pt-2 border-top' : ''}">
                            <div class="fw-semibold text-dark">\${ds.alias}</div>
                            <div class="text-muted" style="font-size: 11px;">
                                \${ds.useCurrentQuery ? 'Current query results' : 'Custom query'} •
                                ~\${recordCount} record\${recordCount !== 1 ? 's' : ''}
                            </div>
                            <div class="mt-1" style="font-size: 11px;">
                                <span class="text-primary">Columns:</span>
                                \${columns.length > 0 ? columns.join(', ') : '<em>No columns available</em>'}
                            </div>
                        </div>
                    \`;
                });

                if (docGenDataSources.length === 0) {
                    html = '<div class="text-muted"><em>No data sources configured</em></div>';
                }

                container.innerHTML = html;
            }

            /**
             * Gets column names for a data source.
             * @param {Object} ds - The data source object
             * @returns {Array} Array of column names
             */
            function getColumnsForDataSource(ds) {
                if (ds.useCurrentQuery && state.results?.records?.length > 0) {
                    return Object.keys(state.results.records[0]);
                }
                return [];
            }

            /**
             * Generates or refines a template using AI based on user description.
             */
            async function generateDocGenWithAI() {
                const prompt = document.getElementById('docGenAIPrompt').value.trim();
                const mode = document.getElementById('docGenAIModal').dataset.mode || 'generate';

                if (!prompt) {
                    const msg = mode === 'refine'
                        ? 'Please describe what you want to change.'
                        : 'Please describe the document you want to create.';
                    showToast('warning', 'Description Required', msg);
                    return;
                }

                const settings = loadAISettings();
                const apiKey = settings?.apiKey || state.aiApiKey;

                if (!settings || !apiKey) {
                    showToast('warning', 'AI Not Configured', 'Please configure AI settings first.');
                    return;
                }

                // Gather context about data sources
                const dataSourceContext = buildDataSourceContext();
                const includeStyles = document.getElementById('docGenAIIncludeStyles').checked;

                // Get existing template for refine mode
                const existingTemplate = mode === 'refine' ? getDocGenTemplateValue() : null;

                // Build the message
                const message = mode === 'refine'
                    ? buildAIRefineMessage(prompt, existingTemplate, dataSourceContext)
                    : buildAITemplateMessage(prompt, dataSourceContext, includeStyles);

                // Show loading state
                setDocGenAILoadingState(true);

                try {
                    const requestBody = {
                        function: 'aiGenerateQuery',
                        provider: settings.provider,
                        apiKey: apiKey,
                        model: settings.model,
                        mode: 'template',
                        messages: [{ role: 'user', content: message }]
                    };
                    if (settings.provider === 'openai-compatible' && settings.customBaseUrl) {
                        requestBody.customBaseUrl = settings.customBaseUrl;
                    }

                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });

                    const data = await response.json();

                    if (data.error) {
                        showDocGenAIError(data.error.message);
                    } else {
                        // Extract template from response
                        const template = extractTemplateFromResponse(data.response);

                        if (template) {
                            // Insert into editor
                            const replaceTemplate = document.getElementById('docGenAIReplaceTemplate').checked;

                            if (replaceTemplate) {
                                setDocGenTemplateValue(template);
                            } else {
                                const currentValue = getDocGenTemplateValue();
                                setDocGenTemplateValue(currentValue + '\\n\\n' + template);
                            }

                            // Refresh CodeMirror
                            if (docGenEditor) {
                                docGenEditor.refresh();
                            }

                            // Close modal and show success
                            bootstrap.Modal.getInstance(document.getElementById('docGenAIModal')).hide();
                            const successMsg = mode === 'refine'
                                ? 'AI has refined your template.'
                                : 'AI has generated your template.';
                            showToast('success', mode === 'refine' ? 'Template Refined' : 'Template Generated', successMsg);
                        } else {
                            showDocGenAIError('Could not extract template from AI response. The AI may have returned an invalid format.');
                        }
                    }
                } catch (error) {
                    showDocGenAIError('Failed to connect to AI service: ' + error.message);
                } finally {
                    setDocGenAILoadingState(false);
                }
            }

            /**
             * Builds context about data sources for the AI.
             * @returns {string} Formatted data source context
             */
            function buildDataSourceContext() {
                let context = '';

                docGenDataSources.forEach((ds, index) => {
                    const columns = getColumnsForDataSource(ds);
                    const recordCount = ds.useCurrentQuery
                        ? (state.results?.records?.length || 0)
                        : 'unknown';

                    context += \`
Data Source \${index + 1}:
- Alias: "\${ds.alias}"
- Type: \${ds.useCurrentQuery ? 'Query results' : 'Custom query'}
- Approximate records: \${recordCount}
- Columns: \${columns.length > 0 ? columns.join(', ') : 'unknown'}
\`;
                });

                return context;
            }

            /**
             * Builds the AI message for template generation.
             * @param {string} userPrompt - User's description
             * @param {string} dataSourceContext - Data source information
             * @param {boolean} includeStyles - Whether to include CSS
             * @returns {string} Formatted message for AI
             */
            function buildAITemplateMessage(userPrompt, dataSourceContext, includeStyles) {
                var dollar = String.fromCharCode(36); // $ character
                var styleNote = includeStyles ? 'Include professional CSS styles in the template' : 'Minimize CSS, keep it simple';
                return 'Please generate a NetSuite Advanced PDF/HTML template based on this description:\\n\\n' +
                    '**User Request:**\\n' + userPrompt + '\\n\\n' +
                    '**Available Data Sources:**\\n' + dataSourceContext + '\\n\\n' +
                    '**CRITICAL Requirements:**\\n' +
                    '- Generate a complete, valid XML template for NetSuite Advanced PDF\\n' +
                    '- Use the exact column names and data source aliases provided above\\n' +
                    '- IMPORTANT: To iterate records, use <#list alias.records as row> (NOT <#list alias as row>)\\n' +
                    '- For record count, use ' + dollar + '{alias.count} (NOT ' + dollar + '{alias?size})\\n' +
                    '- Access fields as ' + dollar + '{row.fieldname!""} inside the loop\\n' +
                    '- Use null-safe operators (' + dollar + '{field!""}) to prevent errors\\n' +
                    '- ' + styleNote + '\\n' +
                    '- Wrap the template in an XML code block\\n\\n' +
                    'Generate the template now.';
            }

            /**
             * Builds the AI message for template refinement.
             * @param {string} userPrompt - User's refinement request
             * @param {string} existingTemplate - The current template code
             * @param {string} dataSourceContext - Data source information
             * @returns {string} Formatted message for AI
             */
            function buildAIRefineMessage(userPrompt, existingTemplate, dataSourceContext) {
                var fence = String.fromCharCode(96, 96, 96); // backtick fence for markdown
                var dollar = String.fromCharCode(36); // $ character
                return 'Please modify this existing NetSuite Advanced PDF/HTML template based on the user' + "'" + 's request.\\n\\n' +
                    '**User' + "'" + 's Change Request:**\\n' + userPrompt + '\\n\\n' +
                    '**Current Template:**\\n' + fence + 'xml\\n' + existingTemplate + '\\n' + fence + '\\n\\n' +
                    '**Available Data Sources:**\\n' + dataSourceContext + '\\n\\n' +
                    '**CRITICAL Requirements:**\\n' +
                    '- Return the COMPLETE modified template (not just the changed parts)\\n' +
                    '- Maintain the existing structure and styling unless asked to change it\\n' +
                    '- To iterate records, use <#list alias.records as row> (NOT <#list alias as row>)\\n' +
                    '- For record count, use ' + dollar + '{alias.count} (NOT ' + dollar + '{alias?size})\\n' +
                    '- Keep all null-safe operators (' + dollar + '{field!""})\\n' +
                    '- Wrap the modified template in an XML code block\\n\\n' +
                    'Return the complete modified template now.';
            }

            /**
             * Extracts the template code from AI response.
             * @param {string} response - AI response text
             * @returns {string|null} Extracted template or null
             */
            function extractTemplateFromResponse(response) {
                // Build the fence pattern dynamically to avoid template literal escaping issues
                var bt = String.fromCharCode(96); // single backtick
                var fence = bt + bt + bt; // triple backtick fence

                // Look for XML code blocks (triple-backtick xml fence)
                var xmlPattern = fence + 'xml\\\\n([\\\\s\\\\S]*?)' + fence;
                var xmlBlockRegex = new RegExp(xmlPattern);
                var match = response.match(xmlBlockRegex);

                if (match && match[1]) {
                    return match[1].trim();
                }

                // Try without language specifier (triple-backtick fence)
                var genericPattern = fence + '\\\\n?([\\\\s\\\\S]*?)' + fence;
                var genericBlockRegex = new RegExp(genericPattern);
                var genericMatch = response.match(genericBlockRegex);

                if (genericMatch && genericMatch[1]) {
                    var content = genericMatch[1].trim();
                    // Check if it looks like XML
                    if (content.startsWith('<?xml') || content.startsWith('<pdf') || content.startsWith('<!DOCTYPE')) {
                        return content;
                    }
                }

                // If no code block, check if the entire response is XML
                if (response.trim().startsWith('<?xml') || response.trim().startsWith('<pdf')) {
                    return response.trim();
                }

                return null;
            }

            /**
             * Sets the loading state for AI template generation.
             * @param {boolean} loading - Whether loading is in progress
             */
            function setDocGenAILoadingState(loading) {
                const submitBtn = document.getElementById('docGenAISubmitBtn');
                const loadingDiv = document.getElementById('docGenAILoading');
                const loadingText = loadingDiv.querySelector('.text-muted');
                const errorDiv = document.getElementById('docGenAIError');
                const promptInput = document.getElementById('docGenAIPrompt');
                const mode = document.getElementById('docGenAIModal').dataset.mode || 'generate';

                if (loading) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = mode === 'refine'
                        ? '<span class="spinner-border spinner-border-sm me-1"></span>Refining...'
                        : '<span class="spinner-border spinner-border-sm me-1"></span>Generating...';
                    if (loadingText) {
                        loadingText.textContent = mode === 'refine'
                            ? 'Refining template... This may take a moment.'
                            : 'Generating template... This may take a moment.';
                    }
                    loadingDiv.classList.remove('d-none');
                    errorDiv.classList.add('d-none');
                    promptInput.disabled = true;
                } else {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = mode === 'refine'
                        ? '<i class="bi bi-stars me-1"></i>Refine Template'
                        : '<i class="bi bi-stars me-1"></i>Generate Template';
                    loadingDiv.classList.add('d-none');
                    promptInput.disabled = false;
                }
            }

            /**
             * Shows an error in the AI template modal.
             * @param {string} message - Error message
             */
            function showDocGenAIError(message) {
                const errorDiv = document.getElementById('docGenAIError');
                const errorText = document.getElementById('docGenAIErrorText');

                errorText.textContent = message;
                errorDiv.classList.remove('d-none');
            }

            // =================================================================
            // QUERY FORMATTING
            // =================================================================

            function formatQuery() {
                const query = state.editor.getValue();
                if (!query.trim()) return;

                try {
                    const formatted = formatSQL(query);
                    state.editor.setValue(formatted);
                    showToast('info', 'Formatted', 'Query has been formatted.');
                } catch (e) {
                    showToast('warning', 'Format Error', 'Could not format query. Check syntax.');
                    console.error('Format error:', e);
                }
            }

            /**
             * Formats SQL query with comprehensive styling:
             * - Keywords uppercase
             * - Tab indentation for readability
             * - Each SELECT column on its own line
             * - Proper JOIN and ON clause formatting
             * - CASE/WHEN/THEN/ELSE/END handling
             * - Subquery handling with nested indentation
             * - Preserves string literals and comments
             */
            function formatSQL(sql) {
                // Protect string literals
                var strings = [];
                var q = sql.replace(/'([^']*(?:''[^']*)*)'/g, function(match) {
                    strings.push(match);
                    return '{{STR' + (strings.length - 1) + '}}';
                });

                // Protect line comments
                var lineComments = [];
                q = q.replace(/--[^\\n]*/g, function(match) {
                    lineComments.push(match);
                    return '{{LINE' + (lineComments.length - 1) + '}}';
                });

                // Normalize whitespace
                q = q.replace(/\\s+/g, ' ').trim();

                // Keywords to uppercase
                var keywords = [
                    'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN',
                    'NOT EXISTS', 'NOT BETWEEN', 'IS NOT NULL', 'NOT LIKE',
                    'NULLS FIRST', 'NULLS LAST', 'PARTITION BY',
                    'ORDER BY', 'GROUP BY', 'UNION ALL', 'INNER JOIN', 'CROSS JOIN',
                    'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'NOT IN', 'IS NULL',
                    'DISTINCT', 'BETWEEN', 'INTERSECT', 'ROLLUP', 'HAVING', 'OFFSET',
                    'EXISTS', 'SELECT', 'UPDATE', 'VALUES', 'EXCEPT',
                    'WHERE', 'LIMIT', 'WHEN', 'THEN', 'ELSE', 'CASE', 'WITH', 'FROM',
                    'JOIN', 'LIKE', 'OVER', 'CAST', 'CUBE', 'INTO', 'NULL', 'DESC',
                    'COALESCE', 'BUILTIN',
                    'AND', 'ASC', 'END', 'SET', 'ALL', 'NOT', 'AS', 'BY',
                    'IN', 'ON', 'OR'
                ];

                for (var k = 0; k < keywords.length; k++) {
                    var kw = keywords[k];
                    var regex = new RegExp('\\\\b' + kw.replace(/ /g, '\\\\s+') + '\\\\b', 'gi');
                    q = q.replace(regex, kw);
                }

                // Build result with proper formatting
                var result = '';
                var depth = 0;
                var inSelect = false;
                var afterFrom = false;
                var inCase = 0;
                var i = 0;
                var TAB = '\\t';
                var NL = '\\n';

                function indent(level) {
                    var s = '';
                    for (var x = 0; x < level; x++) s += TAB;
                    return s;
                }

                function addNewline(level) {
                    return NL + indent(level);
                }

                while (i < q.length) {
                    var remaining = q.substring(i);
                    var ch = q[i];

                    // Check for placeholders
                    var placeholderMatch = remaining.match(/^\\{\\{(STR|LINE)(\\d+)\\}\\}/);
                    if (placeholderMatch) {
                        result += placeholderMatch[0];
                        i += placeholderMatch[0].length;
                        continue;
                    }

                    // Opening parenthesis - check if subquery
                    if (ch === '(') {
                        var ahead = q.substring(i + 1).trim();
                        if (/^SELECT\\b/i.test(ahead)) {
                            depth++;
                            result += '(' + addNewline(depth);
                        } else {
                            result += '(';
                        }
                        i++;
                        continue;
                    }

                    // Closing parenthesis
                    if (ch === ')') {
                        if (depth > 0 && result.indexOf(NL) !== -1) {
                            depth--;
                            result = result.replace(/\\s+$/, '') + addNewline(depth) + ')';
                        } else {
                            result += ')';
                        }
                        i++;
                        continue;
                    }

                    // SELECT keyword
                    if (/^SELECT\\b/i.test(remaining)) {
                        var trimmed = result.replace(/\\s+$/, '');
                        if (trimmed && !/[\\(]$/.test(trimmed)) {
                            result += addNewline(depth);
                        }
                        result += 'SELECT';
                        inSelect = true;
                        afterFrom = false;
                        i += 6;
                        var afterSel = q.substring(i).match(/^\\s+DISTINCT\\b/i);
                        if (afterSel) {
                            result += ' DISTINCT';
                            i += afterSel[0].length;
                        }
                        result += addNewline(depth + 1);
                        // Skip whitespace after SELECT
                        while (i < q.length && q[i] === ' ') i++;
                        continue;
                    }

                    // FROM keyword
                    if (/^FROM\\b/i.test(remaining)) {
                        result = result.replace(/\\s+$/, '');
                        result += addNewline(depth) + 'FROM' + addNewline(depth + 1);
                        inSelect = false;
                        afterFrom = true;
                        i += 4;
                        // Skip whitespace after FROM
                        while (i < q.length && q[i] === ' ') i++;
                        continue;
                    }

                    // JOIN keywords
                    var joinMatch = remaining.match(/^(INNER JOIN|LEFT OUTER JOIN|RIGHT OUTER JOIN|FULL OUTER JOIN|LEFT JOIN|RIGHT JOIN|CROSS JOIN|JOIN)\\b/i);
                    if (joinMatch) {
                        result = result.replace(/\\s+$/, '');
                        result += addNewline(depth + 1) + joinMatch[1].toUpperCase() + ' ';
                        i += joinMatch[1].length;
                        while (i < q.length && q[i] === ' ') i++;
                        continue;
                    }

                    // ON keyword (must be preceded by whitespace or paren to avoid matching inside words like "transaction")
                    var prevCharOn = i > 0 ? q[i - 1] : ' ';
                    if (/^ON\\b/i.test(remaining) && afterFrom && (prevCharOn === ' ' || prevCharOn === '(' || prevCharOn === ')')) {
                        result = result.replace(/\\s+$/, '') + ' ON ';
                        i += 2;
                        continue;
                    }

                    // WHERE keyword
                    if (/^WHERE\\b/i.test(remaining)) {
                        result = result.replace(/\\s+$/, '');
                        result += addNewline(depth) + 'WHERE' + addNewline(depth + 1);
                        inSelect = false;
                        afterFrom = false;
                        i += 5;
                        while (i < q.length && q[i] === ' ') i++;
                        continue;
                    }

                    // AND/OR in conditions (must be preceded by whitespace or paren)
                    var andOrMatch = remaining.match(/^(AND|OR)\\b/i);
                    var prevChar = i > 0 ? q[i - 1] : ' ';
                    if (andOrMatch && !inSelect && (prevChar === ' ' || prevChar === '(' || prevChar === ')')) {
                        result = result.replace(/\\s+$/, '');
                        result += addNewline(depth + 1) + andOrMatch[1].toUpperCase() + ' ';
                        i += andOrMatch[1].length;
                        while (i < q.length && q[i] === ' ') i++;
                        continue;
                    }

                    // GROUP BY
                    if (/^GROUP BY\\b/i.test(remaining)) {
                        result = result.replace(/\\s+$/, '');
                        result += addNewline(depth) + 'GROUP BY' + addNewline(depth + 1);
                        inSelect = false;
                        i += 8;
                        while (i < q.length && q[i] === ' ') i++;
                        continue;
                    }

                    // ORDER BY
                    if (/^ORDER BY\\b/i.test(remaining)) {
                        result = result.replace(/\\s+$/, '');
                        result += addNewline(depth) + 'ORDER BY' + addNewline(depth + 1);
                        inSelect = false;
                        i += 8;
                        while (i < q.length && q[i] === ' ') i++;
                        continue;
                    }

                    // HAVING
                    if (/^HAVING\\b/i.test(remaining)) {
                        result = result.replace(/\\s+$/, '');
                        result += addNewline(depth) + 'HAVING' + addNewline(depth + 1);
                        i += 6;
                        while (i < q.length && q[i] === ' ') i++;
                        continue;
                    }

                    // UNION, UNION ALL, EXCEPT, INTERSECT
                    var setOpMatch = remaining.match(/^(UNION ALL|UNION|EXCEPT|INTERSECT)\\b/i);
                    if (setOpMatch) {
                        result = result.replace(/\\s+$/, '');
                        result += addNewline(depth) + addNewline(depth) + setOpMatch[1].toUpperCase() + addNewline(depth);
                        i += setOpMatch[1].length;
                        while (i < q.length && q[i] === ' ') i++;
                        continue;
                    }

                    // CASE keyword
                    if (/^CASE\\b/i.test(remaining)) {
                        result += 'CASE';
                        inCase++;
                        i += 4;
                        continue;
                    }

                    // WHEN keyword (in CASE)
                    if (/^WHEN\\b/i.test(remaining) && inCase > 0) {
                        result = result.replace(/\\s+$/, '') + ' WHEN ';
                        i += 4;
                        continue;
                    }

                    // THEN keyword (in CASE)
                    if (/^THEN\\b/i.test(remaining) && inCase > 0) {
                        result = result.replace(/\\s+$/, '') + ' THEN ';
                        i += 4;
                        continue;
                    }

                    // ELSE keyword (in CASE)
                    if (/^ELSE\\b/i.test(remaining) && inCase > 0) {
                        result = result.replace(/\\s+$/, '') + ' ELSE ';
                        i += 4;
                        continue;
                    }

                    // END keyword (in CASE)
                    if (/^END\\b/i.test(remaining) && inCase > 0) {
                        result = result.replace(/\\s+$/, '') + ' END';
                        inCase--;
                        i += 3;
                        continue;
                    }

                    // LIMIT and OFFSET
                    var limitMatch = remaining.match(/^(LIMIT|OFFSET)\\b/i);
                    if (limitMatch) {
                        result = result.replace(/\\s+$/, '');
                        result += addNewline(depth) + limitMatch[1].toUpperCase() + ' ';
                        i += limitMatch[1].length;
                        continue;
                    }

                    // Comma handling
                    if (ch === ',') {
                        if (inSelect) {
                            result = result.replace(/\\s+$/, '') + ',' + addNewline(depth + 1);
                        } else {
                            result += ', ';
                        }
                        i++;
                        while (i < q.length && q[i] === ' ') i++;
                        continue;
                    }

                    // Skip extra spaces
                    if (ch === ' ' && result.charAt(result.length - 1) === ' ') {
                        i++;
                        continue;
                    }

                    // Default: add character
                    result += ch;
                    i++;
                }

                // Restore line comments
                for (var j = 0; j < lineComments.length; j++) {
                    result = result.replace('{{LINE' + j + '}}', lineComments[j]);
                }

                // Restore string literals
                for (var j = 0; j < strings.length; j++) {
                    result = result.replace('{{STR' + j + '}}', strings[j]);
                }

                // Clean up trailing whitespace and multiple blank lines
                var lines = result.split(NL);
                var cleanLines = [];
                for (var l = 0; l < lines.length; l++) {
                    cleanLines.push(lines[l].replace(/\\s+$/, ''));
                }
                result = cleanLines.join(NL);
                result = result.replace(/\\n\\n\\n+/g, NL + NL);

                return result.replace(/^\\s+|\\s+$/g, '');
            }

            // =================================================================
            // TABLES REFERENCE & SCHEMA EXPLORER
            // =================================================================

            function openTablesReference() {
                window.open(CONFIG.SCRIPT_URL + '&function=tablesReference', '_tablesRef');
            }

            function openSchemaExplorer() {
                window.open(CONFIG.SCRIPT_URL + '&function=schemaExplorer', '_schemaExplorer');
            }

            // =================================================================
            // LIBRARY FUNCTIONS
            // =================================================================

            async function showRemoteLibrary() {
                const modal = new bootstrap.Modal(document.getElementById('remoteLibraryModal'));
                modal.show();

                const content = document.getElementById('remoteLibraryContent');
                content.innerHTML = '<div class="sqt-loading"><div class="sqt-spinner"></div><span>Loading query library...</span></div>';

                try {
                    const response = await fetch(CONFIG.REMOTE_LIBRARY_URL + 'index.json?nonce=' + Date.now());
                    const queries = await response.json();

                    // Helper function to render table rows
                    function renderQueryRows(queryList) {
                        if (queryList.length === 0) {
                            return '<tr><td colspan="3" class="text-center text-muted py-4">No matching queries found</td></tr>';
                        }
                        return queryList.map(q => \`
                            <tr>
                                <td>\${escapeHtml(q.name)}</td>
                                <td>\${escapeHtml(q.description)}</td>
                                <td>
                                    <button type="button" class="btn btn-sm btn-primary" onclick="SQT.loadRemoteQuery('\${q.fileName}')">
                                        Load
                                    </button>
                                </td>
                            </tr>
                        \`).join('');
                    }

                    content.innerHTML = \`
                        <div class="mb-3">
                            <input type="text" class="form-control" id="remoteLibrarySearch" placeholder="Search queries..." autocomplete="off">
                        </div>
                        <div class="table-responsive">
                            <table class="table table-hover">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Description</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody id="remoteLibraryTableBody">
                                    \${renderQueryRows(queries)}
                                </tbody>
                            </table>
                        </div>
                    \`;

                    // Set up search filtering
                    var searchInput = document.getElementById('remoteLibrarySearch');
                    var tableBody = document.getElementById('remoteLibraryTableBody');

                    searchInput.addEventListener('input', function() {
                        var searchTerm = this.value.toLowerCase().trim();
                        if (!searchTerm) {
                            tableBody.innerHTML = renderQueryRows(queries);
                            return;
                        }
                        var filtered = queries.filter(function(q) {
                            return q.name.toLowerCase().indexOf(searchTerm) !== -1 ||
                                   q.description.toLowerCase().indexOf(searchTerm) !== -1;
                        });
                        tableBody.innerHTML = renderQueryRows(filtered);
                    });

                    // Focus search input
                    searchInput.focus();

                } catch (error) {
                    content.innerHTML = \`
                        <div class="alert alert-danger">
                            Failed to load query library: \${escapeHtml(error.message)}
                        </div>
                    \`;
                }
            }

            async function loadRemoteQuery(filename) {
                try {
                    const response = await fetch(CONFIG.REMOTE_LIBRARY_URL + filename + '?nonce=' + Date.now());
                    const sql = await response.text();

                    state.editor.setValue(sql);
                    bootstrap.Modal.getInstance(document.getElementById('remoteLibraryModal')).hide();
                    showToast('success', 'Query Loaded', 'Query loaded from library.');
                } catch (error) {
                    showToast('error', 'Load Failed', 'Failed to load query.');
                }
            }

            async function showLocalLibrary() {
                const modal = new bootstrap.Modal(document.getElementById('localLibraryModal'));
                modal.show();

                const content = document.getElementById('localLibraryContent');
                content.innerHTML = '<div class="sqt-loading"><div class="sqt-spinner"></div><span>Loading queries...</span></div>';

                try {
                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ function: 'localLibraryFilesGet' })
                    });
                    const data = await response.json();

                    if (data.error) {
                        content.innerHTML = \`<div class="alert alert-info">\${data.error}</div>\`;
                        return;
                    }

                    content.innerHTML = \`
                        <div class="table-responsive">
                            <table class="table table-hover">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Description</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    \${data.records.map(f => \`
                                        <tr>
                                            <td>\${escapeHtml(f.name)}</td>
                                            <td>\${escapeHtml(f.description || '')}</td>
                                            <td>
                                                <button type="button" class="btn btn-sm btn-primary" onclick="SQT.loadLocalQuery(\${f.id})">
                                                    Load
                                                </button>
                                            </td>
                                        </tr>
                                    \`).join('')}
                                </tbody>
                            </table>
                        </div>
                    \`;
                } catch (error) {
                    content.innerHTML = \`<div class="alert alert-danger">Failed to load: \${escapeHtml(error.message)}</div>\`;
                }
            }

            async function loadLocalQuery(fileId) {
                try {
                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ function: 'sqlFileLoad', fileID: fileId })
                    });
                    const data = await response.json();

                    if (data.error) {
                        showToast('error', 'Load Failed', data.error);
                        return;
                    }

                    state.editor.setValue(data.sql);
                    state.currentFile = data.file;
                    bootstrap.Modal.getInstance(document.getElementById('localLibraryModal')).hide();
                    showToast('success', 'Query Loaded', \`Loaded: \${data.file.name}\`);
                } catch (error) {
                    showToast('error', 'Load Failed', error.message);
                }
            }

            function showSaveModal() {
                const query = state.editor.getValue();
                if (!query.trim()) {
                    showToast('warning', 'No Query', 'Please enter a query to save.');
                    return;
                }

                if (state.currentFile) {
                    document.getElementById('saveFileName').value = state.currentFile.name;
                    document.getElementById('saveDescription').value = state.currentFile.description || '';
                }

                new bootstrap.Modal(document.getElementById('saveModal')).show();
            }

            async function saveQuery() {
                const filename = document.getElementById('saveFileName').value.trim();
                const description = document.getElementById('saveDescription').value.trim();
                const query = state.editor.getValue();

                if (!filename) {
                    showToast('warning', 'Missing Name', 'Please enter a file name.');
                    return;
                }

                try {
                    // Check if file exists
                    const checkResponse = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ function: 'sqlFileExists', filename })
                    });
                    const checkData = await checkResponse.json();

                    if (checkData.exists) {
                        if (!confirm(\`A file named "\${filename}" already exists. Replace it?\`)) {
                            return;
                        }
                    }

                    // Save file
                    const saveResponse = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            function: 'sqlFileSave',
                            filename,
                            contents: query,
                            description
                        })
                    });
                    const saveData = await saveResponse.json();

                    if (saveData.error) {
                        showToast('error', 'Save Failed', saveData.error);
                        return;
                    }

                    state.currentFile = { id: saveData.fileID, name: filename, description };
                    bootstrap.Modal.getInstance(document.getElementById('saveModal')).hide();
                    showToast('success', 'Saved', \`Query saved as "\${filename}".\`);
                } catch (error) {
                    showToast('error', 'Save Failed', error.message);
                }
            }

            async function showWorkbooks() {
                const modal = new bootstrap.Modal(document.getElementById('workbooksModal'));
                modal.show();

                const content = document.getElementById('workbooksContent');
                content.innerHTML = '<div class="sqt-loading"><div class="sqt-spinner"></div><span>Loading workbooks...</span></div>';

                try {
                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ function: 'workbooksGet' })
                    });
                    const data = await response.json();

                    if (data.error) {
                        content.innerHTML = \`<div class="alert alert-info">\${data.error}</div>\`;
                        return;
                    }

                    content.innerHTML = \`
                        <div class="table-responsive">
                            <table class="table table-hover">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Description</th>
                                        <th>Owner</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    \${data.records.map(w => \`
                                        <tr>
                                            <td>\${escapeHtml(w.name)}</td>
                                            <td>\${escapeHtml(w.description || '')}</td>
                                            <td>\${escapeHtml(w.owner)}</td>
                                            <td>
                                                <button type="button" class="btn btn-sm btn-primary" onclick="SQT.loadWorkbook('\${w.scriptid}')">
                                                    Load
                                                </button>
                                            </td>
                                        </tr>
                                    \`).join('')}
                                </tbody>
                            </table>
                        </div>
                    \`;
                } catch (error) {
                    content.innerHTML = \`<div class="alert alert-danger">Failed to load: \${escapeHtml(error.message)}</div>\`;
                }
            }

            async function loadWorkbook(scriptId) {
                try {
                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ function: 'workbookLoad', scriptID: scriptId })
                    });
                    const data = await response.json();

                    if (data.error) {
                        showToast('error', 'Load Failed', data.error);
                        return;
                    }

                    state.editor.setValue(data.sql);
                    bootstrap.Modal.getInstance(document.getElementById('workbooksModal')).hide();
                    showToast('success', 'Workbook Loaded', 'Query loaded from workbook.');
                } catch (error) {
                    showToast('error', 'Load Failed', error.message);
                }
            }

            // =================================================================
            // HELP
            // =================================================================

            function showHelp() {
                new bootstrap.Modal(document.getElementById('shortcutsModal')).show();
            }

            // =================================================================
            // TOAST NOTIFICATIONS
            // =================================================================

            function showToast(type, title, message) {
                const icons = {
                    success: 'bi-check-circle-fill',
                    error: 'bi-x-circle-fill',
                    warning: 'bi-exclamation-triangle-fill',
                    info: 'bi-info-circle-fill'
                };

                // Get or create toast container as a direct child of body
                let container = document.getElementById('toastContainer');
                if (!container) {
                    container = document.createElement('div');
                    container.id = 'toastContainer';
                    container.className = 'sqt-toast-container';
                }

                // Always move container to end of body and set inline z-index to override everything
                container.style.cssText = 'position:fixed!important;top:16px!important;right:16px!important;z-index:2147483647!important;display:flex;flex-direction:column;gap:8px;';
                document.body.appendChild(container);

                const toast = document.createElement('div');
                toast.className = \`sqt-toast sqt-toast-\${type}\`;
                toast.innerHTML = \`
                    <i class="sqt-toast-icon bi \${icons[type]}"></i>
                    <div class="sqt-toast-content">
                        <div class="sqt-toast-title">\${escapeHtml(title)}</div>
                        <div class="sqt-toast-message">\${escapeHtml(message)}</div>
                    </div>
                    <button type="button" class="sqt-toast-close" onclick="this.parentElement.remove()">
                        <i class="bi bi-x"></i>
                    </button>
                \`;

                container.appendChild(toast);

                setTimeout(() => {
                    toast.style.animation = 'slideIn 0.2s ease reverse';
                    setTimeout(() => toast.remove(), 200);
                }, 4000);
            }

            // =================================================================
            // UTILITIES
            // =================================================================

            function escapeHtml(text) {
                if (text === null || text === undefined) return '';
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            function formatTimestamp(isoString) {
                const date = new Date(isoString);
                const now = new Date();
                const diff = now - date;

                if (diff < 60000) return 'just now';
                if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
                if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
                if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';

                return date.toLocaleDateString();
            }

            // =================================================================
            // AI QUERY GENERATOR
            // =================================================================

            const AI_MODELS = {
                anthropic: [
                    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (Recommended)' },
                    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
                    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Fast)' }
                ],
                openai: [
                    { id: 'gpt-4o', name: 'GPT-4o (Recommended)' },
                    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast)' },
                    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' }
                ],
                cohere: [
                    { id: 'command-a-03-2025', name: 'Command A (Recommended)' },
                    { id: 'command-r-plus-08-2024', name: 'Command R+' },
                    { id: 'command-r-08-2024', name: 'Command R (Fast)' }
                ],
                xai: [
                    { id: 'grok-3-beta', name: 'Grok 3 (Recommended)' },
                    { id: 'grok-3-fast-beta', name: 'Grok 3 Fast' },
                    { id: 'grok-2-1212', name: 'Grok 2' }
                ],
                gemini: [
                    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Recommended)' },
                    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
                    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
                ],
                mistral: [
                    { id: 'mistral-large-latest', name: 'Mistral Large (Recommended)' },
                    { id: 'mistral-small-latest', name: 'Mistral Small (Fast)' },
                    { id: 'codestral-latest', name: 'Codestral (Code)' }
                ]
            };

            function showAIModal() {
                if (!CONFIG.AI_ENABLED) return;
                const modal = document.getElementById('aiModal');
                if (!modal) return;
                loadAIConversation();
                renderAIConversation();
                new bootstrap.Modal(modal).show();

                // Focus input and scroll to bottom after modal is shown
                modal.addEventListener('shown.bs.modal', () => {
                    const input = document.getElementById('aiInput');
                    if (input) input.focus();
                    // Delay scroll to ensure content is rendered - scroll the modal body
                    setTimeout(() => {
                        const scrollContainer = document.querySelector('.sqt-ai-body');
                        if (scrollContainer) {
                            scrollContainer.scrollTop = scrollContainer.scrollHeight;
                        }
                    }, 50);
                }, { once: true });
            }

            function loadAISettings() {
                try {
                    const saved = localStorage.getItem(CONFIG.AI_SETTINGS_KEY);
                    if (saved) {
                        const settings = JSON.parse(saved);
                        // If remember was false, don't include the apiKey from storage
                        if (!settings.rememberKey) {
                            settings.apiKey = state.aiApiKey || '';
                        }
                        return settings;
                    }
                    return null;
                } catch (e) {
                    console.error('Failed to load AI settings:', e);
                    return null;
                }
            }

            /**
             * Gets the API key from settings or session state.
             * @param {Object} settings - The loaded AI settings
             * @returns {string|null} The API key or null
             */
            function getAIApiKey(settings) {
                return settings?.apiKey || state.aiApiKey || null;
            }

            /**
             * Builds the AI request body with customBaseUrl if needed.
             * @param {Object} settings - The loaded AI settings
             * @param {string} apiKey - The API key
             * @param {Array} messages - The conversation messages
             * @param {string} [mode] - Optional mode ('tables', 'template', etc.)
             * @returns {Object} The request body object
             */
            function buildAIRequestBody(settings, apiKey, messages, mode) {
                const body = {
                    function: 'aiGenerateQuery',
                    provider: settings.provider,
                    apiKey: apiKey,
                    model: settings.model,
                    messages: messages
                };
                if (mode) body.mode = mode;
                if (settings.provider === 'openai-compatible' && settings.customBaseUrl) {
                    body.customBaseUrl = settings.customBaseUrl;
                }
                return body;
            }

            function saveAISettings() {
                const provider = document.getElementById('aiProvider').value;
                const apiKey = document.getElementById('aiApiKey').value;
                const rememberKey = document.getElementById('aiRememberKey').checked;
                const isOpenAICompatible = provider === 'openai-compatible';

                // Get model from appropriate field based on provider
                let model, customBaseUrl;
                if (isOpenAICompatible) {
                    model = document.getElementById('aiCustomModel').value.trim();
                    customBaseUrl = document.getElementById('aiCustomBaseUrl').value.trim();
                    if (!customBaseUrl) {
                        showToast('warning', 'Missing Base URL', 'Please enter the API base URL.');
                        return;
                    }
                } else {
                    model = document.getElementById('aiModel').value;
                }

                if (!provider || !apiKey || !model) {
                    showToast('warning', 'Missing Fields', 'Please fill in all fields.');
                    return;
                }

                // Always save provider, model, and remember preference
                const settings = {
                    provider,
                    model,
                    rememberKey
                };

                // Add custom base URL for OpenAI-compatible provider
                if (isOpenAICompatible && customBaseUrl) {
                    settings.customBaseUrl = customBaseUrl;
                }

                // Only save API key to localStorage if "Remember" is checked
                if (rememberKey) {
                    settings.apiKey = apiKey;
                } else {
                    // Store in session-only state
                    state.aiApiKey = apiKey;
                }

                try {
                    localStorage.setItem(CONFIG.AI_SETTINGS_KEY, JSON.stringify(settings));
                    bootstrap.Modal.getInstance(document.getElementById('aiSettingsModal')).hide();
                    showToast('success', 'Settings Saved', 'AI settings have been saved.');
                } catch (e) {
                    showToast('error', 'Save Failed', 'Failed to save settings.');
                }
            }

            function showAISettings() {
                if (!CONFIG.AI_ENABLED) return;
                const modal = document.getElementById('aiSettingsModal');
                if (!modal) return;
                const settings = loadAISettings();

                if (settings) {
                    document.getElementById('aiProvider').value = settings.provider || '';
                    updateAIModels();
                    document.getElementById('aiApiKey').value = settings.apiKey || state.aiApiKey || '';
                    document.getElementById('aiRememberKey').checked = settings.rememberKey !== false;

                    // Handle OpenAI-compatible provider fields
                    if (settings.provider === 'openai-compatible') {
                        document.getElementById('aiCustomBaseUrl').value = settings.customBaseUrl || '';
                        document.getElementById('aiCustomModel').value = settings.model || '';
                    } else {
                        document.getElementById('aiModel').value = settings.model || '';
                        document.getElementById('aiCustomBaseUrl').value = '';
                        document.getElementById('aiCustomModel').value = '';
                    }
                } else {
                    document.getElementById('aiProvider').value = '';
                    document.getElementById('aiApiKey').value = '';
                    document.getElementById('aiModel').value = '';
                    document.getElementById('aiCustomBaseUrl').value = '';
                    document.getElementById('aiCustomModel').value = '';
                    document.getElementById('aiRememberKey').checked = true;
                    updateAIModels();
                }

                new bootstrap.Modal(document.getElementById('aiSettingsModal')).show();
            }

            function updateAIModels() {
                const provider = document.getElementById('aiProvider').value;
                const modelSelect = document.getElementById('aiModel');
                const customBaseUrlGroup = document.getElementById('customBaseUrlGroup');
                const customModelGroup = document.getElementById('customModelGroup');
                const isOpenAICompatible = provider === 'openai-compatible';

                // Show/hide custom fields for OpenAI-compatible provider
                if (customBaseUrlGroup) customBaseUrlGroup.style.display = isOpenAICompatible ? 'block' : 'none';
                if (customModelGroup) customModelGroup.style.display = isOpenAICompatible ? 'block' : 'none';

                // Hide standard model select for OpenAI-compatible, show for others
                modelSelect.parentElement.style.display = isOpenAICompatible ? 'none' : 'block';

                modelSelect.innerHTML = '';
                modelSelect.disabled = !provider || isOpenAICompatible;

                if (provider && AI_MODELS[provider]) {
                    AI_MODELS[provider].forEach(model => {
                        const option = document.createElement('option');
                        option.value = model.id;
                        option.textContent = model.name;
                        modelSelect.appendChild(option);
                    });
                } else if (!isOpenAICompatible) {
                    const option = document.createElement('option');
                    option.value = '';
                    option.textContent = 'Select a provider first...';
                    modelSelect.appendChild(option);
                }
            }

            function toggleApiKeyVisibility() {
                const input = document.getElementById('aiApiKey');
                const icon = document.getElementById('apiKeyToggleIcon');

                if (input.type === 'password') {
                    input.type = 'text';
                    icon.className = 'bi bi-eye-slash';
                } else {
                    input.type = 'password';
                    icon.className = 'bi bi-eye';
                }
            }

            // =================================================================
            // AIRTABLE SETTINGS
            // =================================================================

            function loadAirtableSettings() {
                try {
                    const saved = localStorage.getItem(CONFIG.AIRTABLE_SETTINGS_KEY);
                    if (saved) {
                        const settings = JSON.parse(saved);
                        // If remember was false, don't include the apiToken from storage
                        if (!settings.rememberCredentials) {
                            settings.apiToken = state.airtableApiToken || '';
                        }
                        return settings;
                    }
                    return null;
                } catch (e) {
                    console.error('Failed to load Airtable settings:', e);
                    return null;
                }
            }

            function getAirtableCredentials() {
                const settings = loadAirtableSettings();
                if (!settings) return null;
                const apiToken = settings.apiToken || state.airtableApiToken;
                if (!apiToken || !settings.baseId) return null;
                return {
                    apiToken: apiToken,
                    baseId: settings.baseId
                };
            }

            function saveAirtableSettings() {
                const apiToken = document.getElementById('airtableApiToken').value;
                const baseId = document.getElementById('airtableBaseId').value;
                const rememberCredentials = document.getElementById('airtableRememberCredentials').checked;

                if (!apiToken || !baseId) {
                    showToast('warning', 'Missing Fields', 'Please fill in all fields.');
                    return;
                }

                // Validate base ID format
                if (!baseId.startsWith('app') || baseId.length < 10) {
                    showToast('warning', 'Invalid Base ID', 'Base ID should start with "app" followed by alphanumeric characters.');
                    return;
                }

                const settings = {
                    baseId,
                    rememberCredentials
                };

                // Only save API token to localStorage if "Remember" is checked
                if (rememberCredentials) {
                    settings.apiToken = apiToken;
                } else {
                    // Store in session-only state
                    state.airtableApiToken = apiToken;
                }

                try {
                    localStorage.setItem(CONFIG.AIRTABLE_SETTINGS_KEY, JSON.stringify(settings));
                    bootstrap.Modal.getInstance(document.getElementById('airtableSettingsModal')).hide();
                    showToast('success', 'Settings Saved', 'Airtable settings have been saved.');
                } catch (e) {
                    showToast('error', 'Save Failed', 'Failed to save settings.');
                }
            }

            function showAirtableSettings() {
                const modal = document.getElementById('airtableSettingsModal');
                if (!modal) return;
                const settings = loadAirtableSettings();

                if (settings) {
                    document.getElementById('airtableApiToken').value = settings.apiToken || state.airtableApiToken || '';
                    document.getElementById('airtableBaseId').value = settings.baseId || '';
                    document.getElementById('airtableRememberCredentials').checked = settings.rememberCredentials !== false;
                } else {
                    document.getElementById('airtableApiToken').value = '';
                    document.getElementById('airtableBaseId').value = '';
                    document.getElementById('airtableRememberCredentials').checked = true;
                }

                // Close export modal if open
                const exportModal = bootstrap.Modal.getInstance(document.getElementById('airtableExportModal'));
                if (exportModal) exportModal.hide();

                new bootstrap.Modal(modal).show();
            }

            function toggleAirtableTokenVisibility() {
                const input = document.getElementById('airtableApiToken');
                const icon = document.getElementById('airtableTokenToggleIcon');

                if (input.type === 'password') {
                    input.type = 'text';
                    icon.className = 'bi bi-eye-slash';
                } else {
                    input.type = 'password';
                    icon.className = 'bi bi-eye';
                }
            }

            // =================================================================
            // AIRTABLE EXPORT
            // =================================================================

            function showAirtableExportModal() {
                // Check for credentials first
                const creds = getAirtableCredentials();
                if (!creds) {
                    showToast('info', 'Setup Required', 'Please configure your Airtable credentials first.');
                    showAirtableSettings();
                    return;
                }

                // Check for results
                if (!state.results || !state.results.records || state.results.records.length === 0) {
                    showToast('warning', 'No Data', 'Run a query first to export results.');
                    return;
                }

                // Close the regular export modal if open
                const exportModal = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
                if (exportModal) exportModal.hide();

                // Reset progress section
                document.getElementById('airtableProgress').style.display = 'none';
                document.getElementById('airtableExportBtn').disabled = false;

                // Set default table name based on timestamp
                const defaultName = 'Query Results ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
                document.getElementById('airtableNewTableName').value = defaultName;

                // Update field preview
                updateAirtableFieldPreview();

                // Reset to create mode
                document.getElementById('airtableModeCreate').checked = true;
                setAirtableExportMode('create');

                // Show the Airtable export modal
                new bootstrap.Modal(document.getElementById('airtableExportModal')).show();
            }

            function setAirtableExportMode(mode) {
                const createView = document.getElementById('airtableCreateView');
                const appendView = document.getElementById('airtableAppendView');

                if (mode === 'create') {
                    createView.style.display = 'block';
                    appendView.style.display = 'none';
                } else {
                    createView.style.display = 'none';
                    appendView.style.display = 'block';
                    // Fetch tables when switching to append mode
                    refreshAirtableTables();
                }
            }

            function updateAirtableFieldPreview() {
                const preview = document.getElementById('airtableFieldPreview');
                if (!state.results || !state.results.records || state.results.records.length === 0) {
                    preview.innerHTML = '<span class="text-muted">No data available</span>';
                    return;
                }

                const fieldTypes = detectAirtableFieldTypes(state.results.records);
                const html = Object.entries(fieldTypes).map(([name, type]) => {
                    const typeIcon = getAirtableTypeIcon(type);
                    return '<div class="d-flex justify-content-between align-items-center py-1 border-bottom">' +
                           '<span>' + escapeHtml(name) + '</span>' +
                           '<span class="badge bg-secondary">' + typeIcon + ' ' + type + '</span>' +
                           '</div>';
                }).join('');

                preview.innerHTML = html;
            }

            function getAirtableTypeIcon(type) {
                const icons = {
                    'singleLineText': '<i class="bi bi-fonts"></i>',
                    'number': '<i class="bi bi-123"></i>',
                    'date': '<i class="bi bi-calendar"></i>',
                    'dateTime': '<i class="bi bi-calendar-event"></i>',
                    'email': '<i class="bi bi-envelope"></i>',
                    'url': '<i class="bi bi-link-45deg"></i>',
                    'checkbox': '<i class="bi bi-check-square"></i>'
                };
                return icons[type] || '<i class="bi bi-question"></i>';
            }

            function detectAirtableFieldTypes(records) {
                if (!records || records.length === 0) return {};

                const columns = Object.keys(records[0]).filter(c => c !== 'rownumber');
                const fieldTypes = {};

                // Sample up to 100 records for type detection
                const sampleSize = Math.min(records.length, 100);
                const samples = records.slice(0, sampleSize);

                columns.forEach(col => {
                    const values = samples.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '');

                    if (values.length === 0) {
                        fieldTypes[col] = 'singleLineText';
                        return;
                    }

                    // Check for boolean
                    const boolValues = values.filter(v => v === true || v === false || v === 'T' || v === 'F' || v === 'true' || v === 'false');
                    if (boolValues.length === values.length) {
                        fieldTypes[col] = 'checkbox';
                        return;
                    }

                    // Check for number
                    const numValues = values.filter(v => !isNaN(parseFloat(v)) && isFinite(v));
                    if (numValues.length === values.length) {
                        fieldTypes[col] = 'number';
                        return;
                    }

                    // Check for email
                    const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
                    const emailValues = values.filter(v => typeof v === 'string' && emailRegex.test(v));
                    if (emailValues.length > values.length * 0.8) {
                        fieldTypes[col] = 'email';
                        return;
                    }

                    // Check for URL
                    const urlRegex = /^https?:\\/\\//i;
                    const urlValues = values.filter(v => typeof v === 'string' && urlRegex.test(v));
                    if (urlValues.length > values.length * 0.8) {
                        fieldTypes[col] = 'url';
                        return;
                    }

                    // Check for date/datetime
                    const dateRegex = /^\\d{4}-\\d{2}-\\d{2}$/;
                    const dateTimeRegex = /^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}/;
                    const dateValues = values.filter(v => typeof v === 'string' && dateRegex.test(v));
                    const dateTimeValues = values.filter(v => typeof v === 'string' && dateTimeRegex.test(v));

                    if (dateTimeValues.length > values.length * 0.8) {
                        fieldTypes[col] = 'dateTime';
                        return;
                    }
                    if (dateValues.length > values.length * 0.8) {
                        fieldTypes[col] = 'date';
                        return;
                    }

                    // Default to text
                    fieldTypes[col] = 'singleLineText';
                });

                return fieldTypes;
            }

            async function refreshAirtableTables() {
                const creds = getAirtableCredentials();
                if (!creds) {
                    showToast('warning', 'Not Configured', 'Please configure Airtable settings first.');
                    return;
                }

                const select = document.getElementById('airtableTableSelect');
                select.innerHTML = '<option value="">Loading tables...</option>';
                select.disabled = true;

                try {
                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            function: 'airtableListTables',
                            apiToken: creds.apiToken,
                            baseId: creds.baseId
                        })
                    });

                    const data = await response.json();

                    if (data.error) {
                        select.innerHTML = '<option value="">Failed to load tables</option>';
                        showToast('error', 'Load Failed', data.error.message);
                        return;
                    }

                    state.airtableTables = data.tables || [];

                    if (state.airtableTables.length === 0) {
                        select.innerHTML = '<option value="">No tables found</option>';
                    } else {
                        select.innerHTML = '<option value="">Select a table...</option>' +
                            state.airtableTables.map(t =>
                                '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + '</option>'
                            ).join('');
                    }
                } catch (e) {
                    select.innerHTML = '<option value="">Error loading tables</option>';
                    showToast('error', 'Request Failed', e.message);
                } finally {
                    select.disabled = false;
                }
            }

            async function exportToAirtable() {
                const creds = getAirtableCredentials();
                if (!creds) {
                    showToast('warning', 'Not Configured', 'Please configure Airtable settings first.');
                    return;
                }

                if (!state.results || !state.results.records || state.results.records.length === 0) {
                    showToast('warning', 'No Data', 'No data to export.');
                    return;
                }

                const mode = document.querySelector('input[name="airtableMode"]:checked').value;
                let tableId, tableName;

                if (mode === 'create') {
                    tableName = document.getElementById('airtableNewTableName').value.trim();
                    if (!tableName) {
                        showToast('warning', 'Missing Table Name', 'Please enter a table name.');
                        return;
                    }
                } else {
                    tableId = document.getElementById('airtableTableSelect').value;
                    if (!tableId) {
                        showToast('warning', 'No Table Selected', 'Please select a table to append to.');
                        return;
                    }
                }

                // Disable export button and show progress
                document.getElementById('airtableExportBtn').disabled = true;
                document.getElementById('airtableProgress').style.display = 'block';
                updateAirtableProgress(0, state.results.records.length, 'Preparing export...');

                try {
                    // If creating new table, create it first
                    if (mode === 'create') {
                        updateAirtableProgress(0, state.results.records.length, 'Creating table...');

                        const fieldTypes = detectAirtableFieldTypes(state.results.records);
                        const fields = Object.entries(fieldTypes).map(([name, type]) => ({
                            name: name,
                            type: type
                        }));

                        const createResponse = await fetch(CONFIG.SCRIPT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                function: 'airtableCreateTable',
                                apiToken: creds.apiToken,
                                baseId: creds.baseId,
                                tableName: tableName,
                                fields: fields
                            })
                        });

                        const createData = await createResponse.json();

                        if (createData.error) {
                            throw new Error(createData.error.message);
                        }

                        tableId = createData.tableId;
                    }

                    // Export records in batches
                    const records = state.results.records;
                    const columns = Object.keys(records[0]).filter(c => c !== 'rownumber');
                    const batchSize = 10;
                    const totalBatches = Math.ceil(records.length / batchSize);
                    let exportedCount = 0;

                    for (let i = 0; i < records.length; i += batchSize) {
                        const batch = records.slice(i, i + batchSize);
                        const batchNum = Math.floor(i / batchSize) + 1;

                        updateAirtableProgress(exportedCount, records.length,
                            'Exporting batch ' + batchNum + ' of ' + totalBatches + '...');

                        // Prepare records for Airtable format
                        const airtableRecords = batch.map(record => {
                            const fields = {};
                            columns.forEach(col => {
                                let value = record[col];
                                // Convert nulls to empty strings for text fields
                                if (value === null || value === undefined) {
                                    value = '';
                                }
                                // Convert boolean strings
                                if (value === 'T') value = true;
                                if (value === 'F') value = false;
                                fields[col] = value;
                            });
                            return { fields };
                        });

                        const batchResponse = await fetch(CONFIG.SCRIPT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                function: 'airtableCreateRecords',
                                apiToken: creds.apiToken,
                                baseId: creds.baseId,
                                tableId: tableId,
                                records: airtableRecords
                            })
                        });

                        const batchData = await batchResponse.json();

                        if (batchData.error) {
                            throw new Error(batchData.error.message);
                        }

                        exportedCount += batch.length;
                        updateAirtableProgress(exportedCount, records.length, 'Exported ' + exportedCount + ' records');

                        // Rate limiting: wait 250ms between batches (allows ~4 requests/sec, under 5/sec limit)
                        if (i + batchSize < records.length) {
                            await new Promise(resolve => setTimeout(resolve, 250));
                        }
                    }

                    // Success
                    updateAirtableProgress(records.length, records.length, 'Export complete!');
                    showToast('success', 'Export Complete', records.length + ' records exported to Airtable.');

                    // Close modal after short delay
                    setTimeout(() => {
                        bootstrap.Modal.getInstance(document.getElementById('airtableExportModal')).hide();
                    }, 1500);

                } catch (e) {
                    console.error('Airtable export error:', e);
                    updateAirtableProgress(0, 0, 'Export failed: ' + e.message);
                    showToast('error', 'Export Failed', e.message);
                    document.getElementById('airtableExportBtn').disabled = false;
                }
            }

            function updateAirtableProgress(completed, total, status) {
                const progressBar = document.getElementById('airtableProgressBar');
                const statusEl = document.getElementById('airtableProgressStatus');

                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                progressBar.style.width = pct + '%';
                progressBar.textContent = pct + '%';
                statusEl.textContent = status;
            }

            // Add event listeners for mode toggle
            document.addEventListener('DOMContentLoaded', function() {
                const modeCreate = document.getElementById('airtableModeCreate');
                const modeAppend = document.getElementById('airtableModeAppend');
                if (modeCreate) {
                    modeCreate.addEventListener('change', function() {
                        if (this.checked) setAirtableExportMode('create');
                    });
                }
                if (modeAppend) {
                    modeAppend.addEventListener('change', function() {
                        if (this.checked) setAirtableExportMode('append');
                    });
                }

                // Google Sheets mode toggle listeners
                const gsModeCreate = document.getElementById('googleSheetsModeCreate');
                const gsModeAppend = document.getElementById('googleSheetsModeAppend');
                if (gsModeCreate) {
                    gsModeCreate.addEventListener('change', function() {
                        if (this.checked) setGoogleSheetsExportMode('create');
                    });
                }
                if (gsModeAppend) {
                    gsModeAppend.addEventListener('change', function() {
                        if (this.checked) setGoogleSheetsExportMode('append');
                    });
                }
            });

            // =================================================================
            // GOOGLE SHEETS INTEGRATION
            // =================================================================

            function loadGoogleSheetsSettings() {
                try {
                    const saved = localStorage.getItem(CONFIG.GOOGLE_SHEETS_SETTINGS_KEY);
                    if (saved) {
                        const settings = JSON.parse(saved);
                        if (settings.serviceAccountJson) {
                            state.googleSheetsServiceAccount = JSON.parse(settings.serviceAccountJson);
                        }
                    }
                } catch (e) {
                    console.error('Failed to load Google Sheets settings:', e);
                }
            }

            function saveGoogleSheetsSettings() {
                try {
                    const jsonInput = document.getElementById('googleSheetsServiceAccountJson').value.trim();
                    const remember = document.getElementById('googleSheetsRememberCredentials').checked;

                    if (!jsonInput) {
                        showToast('error', 'Missing JSON', 'Please paste your service account JSON key.');
                        return;
                    }

                    // Validate JSON
                    let serviceAccount;
                    try {
                        serviceAccount = JSON.parse(jsonInput);
                    } catch (e) {
                        showToast('error', 'Invalid JSON', 'The service account JSON is not valid JSON.');
                        return;
                    }

                    // Validate required fields
                    if (!serviceAccount.client_email || !serviceAccount.private_key) {
                        showToast('error', 'Invalid Service Account', 'JSON must contain client_email and private_key fields.');
                        return;
                    }

                    // Store in state
                    state.googleSheetsServiceAccount = serviceAccount;
                    // Clear any cached token when credentials change
                    state.googleSheetsToken = null;
                    state.googleSheetsTokenExpiry = null;

                    // Save to localStorage if remember is checked
                    if (remember) {
                        localStorage.setItem(CONFIG.GOOGLE_SHEETS_SETTINGS_KEY, JSON.stringify({
                            serviceAccountJson: jsonInput
                        }));
                    } else {
                        localStorage.removeItem(CONFIG.GOOGLE_SHEETS_SETTINGS_KEY);
                    }

                    showToast('success', 'Settings Saved', 'Google Sheets settings have been saved.');
                    bootstrap.Modal.getInstance(document.getElementById('googleSheetsSettingsModal')).hide();
                } catch (e) {
                    console.error('Failed to save Google Sheets settings:', e);
                    showToast('error', 'Save Failed', e.message);
                }
            }

            function showGoogleSheetsSettings() {
                // Load current settings into form
                try {
                    const saved = localStorage.getItem(CONFIG.GOOGLE_SHEETS_SETTINGS_KEY);
                    if (saved) {
                        const settings = JSON.parse(saved);
                        document.getElementById('googleSheetsServiceAccountJson').value = settings.serviceAccountJson || '';
                        document.getElementById('googleSheetsRememberCredentials').checked = true;
                    } else if (state.googleSheetsServiceAccount) {
                        document.getElementById('googleSheetsServiceAccountJson').value = JSON.stringify(state.googleSheetsServiceAccount, null, 2);
                        document.getElementById('googleSheetsRememberCredentials').checked = false;
                    } else {
                        document.getElementById('googleSheetsServiceAccountJson').value = '';
                        document.getElementById('googleSheetsRememberCredentials').checked = true;
                    }
                } catch (e) {
                    console.error('Failed to load Google Sheets settings:', e);
                }

                // Hide export modal if open
                const exportModal = document.getElementById('googleSheetsExportModal');
                if (exportModal.classList.contains('show')) {
                    bootstrap.Modal.getInstance(exportModal).hide();
                }

                // Show settings modal
                new bootstrap.Modal(document.getElementById('googleSheetsSettingsModal')).show();
            }

            function getGoogleSheetsCredentials() {
                // Check state first (session storage)
                if (state.googleSheetsServiceAccount) {
                    return state.googleSheetsServiceAccount;
                }

                // Try to load from localStorage
                loadGoogleSheetsSettings();
                return state.googleSheetsServiceAccount;
            }

            function showGoogleSheetsExportModal() {
                // Check for results
                if (!state.results || !state.results.records || state.results.records.length === 0) {
                    showToast('error', 'No Results', 'Execute a query first to export results.');
                    return;
                }

                // Check for credentials
                const creds = getGoogleSheetsCredentials();
                if (!creds) {
                    showToast('info', 'Setup Required', 'Please configure your Google Sheets credentials first.');
                    showGoogleSheetsSettings();
                    return;
                }

                // Reset modal state
                document.getElementById('googleSheetsProgress').style.display = 'none';
                document.getElementById('googleSheetsExportBtn').disabled = false;
                document.getElementById('googleSheetsModeCreate').checked = true;
                setGoogleSheetsExportMode('create');

                // Set default spreadsheet name
                document.getElementById('googleSheetsNewSpreadsheetName').value = 'Query Results - ' + new Date().toLocaleDateString();
                document.getElementById('googleSheetsNewSheetName').value = '';
                document.getElementById('googleSheetsSpreadsheetId').value = '';
                document.getElementById('googleSheetsSheetName').value = '';

                new bootstrap.Modal(document.getElementById('googleSheetsExportModal')).show();
            }

            function setGoogleSheetsExportMode(mode) {
                const createView = document.getElementById('googleSheetsCreateView');
                const appendView = document.getElementById('googleSheetsAppendView');

                if (mode === 'create') {
                    createView.style.display = 'block';
                    appendView.style.display = 'none';
                } else {
                    createView.style.display = 'none';
                    appendView.style.display = 'block';
                }
            }

            async function getGoogleSheetsToken() {
                // Check if we have a valid cached token
                if (state.googleSheetsToken && state.googleSheetsTokenExpiry) {
                    const now = Date.now();
                    // Token still valid with 5 minute buffer
                    if (state.googleSheetsTokenExpiry > now + 300000) {
                        return state.googleSheetsToken;
                    }
                }

                // Get new token from server
                const creds = getGoogleSheetsCredentials();
                if (!creds) {
                    throw new Error('No Google Sheets credentials configured');
                }

                const response = await fetch(CONFIG.SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        function: 'googleSheetsGetToken',
                        serviceAccount: creds
                    })
                });

                const data = await response.json();

                if (data.error) {
                    throw new Error(data.error || 'Failed to get access token');
                }

                // Cache the token
                state.googleSheetsToken = data.accessToken;
                // Token expires in 1 hour, cache expiry time
                state.googleSheetsTokenExpiry = Date.now() + (data.expiresIn * 1000);

                return data.accessToken;
            }

            async function exportToGoogleSheets() {
                const mode = document.querySelector('input[name="googleSheetsMode"]:checked').value;
                const exportBtn = document.getElementById('googleSheetsExportBtn');

                try {
                    exportBtn.disabled = true;
                    document.getElementById('googleSheetsProgress').style.display = 'block';
                    updateGoogleSheetsProgress(0, 0, 'Getting access token...');

                    // Get access token
                    const accessToken = await getGoogleSheetsToken();

                    const records = state.results.records;
                    const columns = Object.keys(records[0]).filter(function(c) { return c !== 'rownumber'; });

                    let spreadsheetId;
                    let sheetName;

                    if (mode === 'create') {
                        // Create new spreadsheet
                        const spreadsheetName = document.getElementById('googleSheetsNewSpreadsheetName').value.trim() || 'Query Results';
                        sheetName = document.getElementById('googleSheetsNewSheetName').value.trim() || 'Sheet1';

                        updateGoogleSheetsProgress(0, 0, 'Creating spreadsheet...');

                        const createResponse = await fetch(CONFIG.SCRIPT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                function: 'googleSheetsCreateSpreadsheet',
                                accessToken: accessToken,
                                title: spreadsheetName,
                                sheetName: sheetName
                            })
                        });

                        const createData = await createResponse.json();

                        if (createData.error) {
                            throw new Error(createData.error || 'Failed to create spreadsheet');
                        }

                        spreadsheetId = createData.spreadsheetId;

                        // Add header row
                        updateGoogleSheetsProgress(0, records.length, 'Adding headers...');

                        await fetch(CONFIG.SCRIPT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                function: 'googleSheetsAppendData',
                                accessToken: accessToken,
                                spreadsheetId: spreadsheetId,
                                sheetName: sheetName,
                                values: [columns]
                            })
                        });

                    } else {
                        // Append to existing spreadsheet
                        spreadsheetId = document.getElementById('googleSheetsSpreadsheetId').value.trim();
                        sheetName = document.getElementById('googleSheetsSheetName').value.trim() || 'Sheet1';

                        if (!spreadsheetId) {
                            throw new Error('Please enter a Spreadsheet ID');
                        }
                    }

                    // Export data in batches
                    const batchSize = 500;
                    const totalBatches = Math.ceil(records.length / batchSize);
                    let exportedCount = 0;

                    for (let i = 0; i < records.length; i += batchSize) {
                        const batch = records.slice(i, i + batchSize);
                        const batchNum = Math.floor(i / batchSize) + 1;

                        updateGoogleSheetsProgress(exportedCount, records.length,
                            'Exporting batch ' + batchNum + ' of ' + totalBatches + '...');

                        // Convert records to array of arrays
                        const values = batch.map(function(record) {
                            return columns.map(function(col) {
                                var value = record[col];
                                if (value === null || value === undefined) return '';
                                return value;
                            });
                        });

                        const appendResponse = await fetch(CONFIG.SCRIPT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                function: 'googleSheetsAppendData',
                                accessToken: accessToken,
                                spreadsheetId: spreadsheetId,
                                sheetName: sheetName,
                                values: values
                            })
                        });

                        const appendData = await appendResponse.json();

                        if (appendData.error) {
                            throw new Error(appendData.error || 'Failed to append data');
                        }

                        exportedCount += batch.length;
                        updateGoogleSheetsProgress(exportedCount, records.length, 'Exported ' + exportedCount + ' records');

                        // Rate limiting: wait 100ms between batches
                        if (i + batchSize < records.length) {
                            await new Promise(function(resolve) { setTimeout(resolve, 100); });
                        }
                    }

                    // Success
                    updateGoogleSheetsProgress(records.length, records.length, 'Export complete!');

                    var successMsg = records.length + ' records exported to Google Sheets.';
                    if (mode === 'create') {
                        successMsg += ' <a href="https://docs.google.com/spreadsheets/d/' + spreadsheetId + '" target="_blank">Open Spreadsheet</a>';
                    }
                    showToast('success', 'Export Complete', successMsg);

                    // Close modal after short delay
                    setTimeout(function() {
                        bootstrap.Modal.getInstance(document.getElementById('googleSheetsExportModal')).hide();
                    }, 1500);

                } catch (e) {
                    console.error('Google Sheets export error:', e);
                    updateGoogleSheetsProgress(0, 0, 'Export failed: ' + e.message);
                    showToast('error', 'Export Failed', e.message);
                    exportBtn.disabled = false;
                }
            }

            function updateGoogleSheetsProgress(completed, total, status) {
                var progressBar = document.getElementById('googleSheetsProgressBar');
                var statusEl = document.getElementById('googleSheetsProgressStatus');

                var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                progressBar.style.width = pct + '%';
                progressBar.textContent = pct + '%';
                statusEl.textContent = status;
            }

            function loadAIConversation() {
                try {
                    const saved = localStorage.getItem(CONFIG.AI_CONVERSATION_KEY);
                    state.aiConversation = saved ? JSON.parse(saved) : [];
                } catch (e) {
                    console.error('Failed to load AI conversation:', e);
                    state.aiConversation = [];
                }
            }

            function saveAIConversation() {
                try {
                    localStorage.setItem(CONFIG.AI_CONVERSATION_KEY, JSON.stringify(state.aiConversation));
                } catch (e) {
                    console.error('Failed to save AI conversation:', e);
                }
            }

            function clearAIConversation() {
                state.aiConversation = [];
                saveAIConversation();
                renderAIConversation();
                showToast('info', 'Conversation Cleared', 'AI conversation has been reset.');
            }

            function formatTimestamp(isoString) {
                if (!isoString) return '';
                const date = new Date(isoString);
                return date.toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
            }

            function renderAIConversation() {
                const container = document.getElementById('aiMessages');

                if (state.aiConversation.length === 0) {
                    container.innerHTML = \`
                        <div class="sqt-ai-welcome">
                            <i class="bi bi-robot"></i>
                            <h4>How can I help you?</h4>
                            <p>Describe the data you need from NetSuite and I'll generate a SuiteQL query for you.</p>
                            <div class="sqt-ai-examples">
                                <button class="sqt-ai-example" onclick="SQT.useAIExample('Show me all active customers with their sales rep')">
                                    Show me all active customers with their sales rep
                                </button>
                                <button class="sqt-ai-example" onclick="SQT.useAIExample('Find invoices from last month over $1000')">
                                    Find invoices from last month over $1000
                                </button>
                                <button class="sqt-ai-example" onclick="SQT.useAIExample('List all employees in the Sales department')">
                                    List all employees in the Sales department
                                </button>
                            </div>
                        </div>
                    \`;
                    return;
                }

                container.innerHTML = state.aiConversation.map(msg => {
                    const timestamp = msg.timestamp ? \`<div class="sqt-ai-timestamp">\${formatTimestamp(msg.timestamp)}</div>\` : '';
                    if (msg.role === 'user') {
                        return \`
                            <div class="sqt-ai-message user">
                                <div class="sqt-ai-avatar"><i class="bi bi-person"></i></div>
                                <div class="sqt-ai-content">\${escapeHtml(msg.content)}\${timestamp}</div>
                            </div>
                        \`;
                    } else {
                        return \`
                            <div class="sqt-ai-message assistant">
                                <div class="sqt-ai-avatar"><i class="bi bi-robot"></i></div>
                                <div class="sqt-ai-content">\${formatAIResponse(msg.content)}\${timestamp}</div>
                            </div>
                        \`;
                    }
                }).join('');

                // Scroll to bottom after DOM update - scroll the parent modal body which has overflow-y: auto
                setTimeout(() => {
                    const scrollContainer = container.closest('.sqt-ai-body');
                    if (scrollContainer) {
                        scrollContainer.scrollTop = scrollContainer.scrollHeight;
                    }
                }, 0);
            }

            // Store generated queries for safe reference by index
            const aiGeneratedQueries = [];

            function formatAIResponse(content) {
                // Clear previous queries when formatting new response
                aiGeneratedQueries.length = 0;

                // Process content in segments - escape text but preserve code blocks
                // Build regex pattern dynamically to avoid backtick escaping issues
                var bt = String.fromCharCode(96);
                var fence = bt + bt + bt;
                const sqlPattern = new RegExp(fence + '(?:sql)?\\\\s*[\\\\r\\\\n]+([\\\\s\\\\S]*?)' + fence, 'gi');
                let result = '';
                let lastIndex = 0;
                let match;

                while ((match = sqlPattern.exec(content)) !== null) {
                    // Escape and add text before this code block
                    const textBefore = content.substring(lastIndex, match.index);
                    result += escapeHtml(textBefore).replace(/\\n/g, '<br>');

                    // Store the SQL and get its index
                    const sql = match[1].trim();
                    const queryIndex = aiGeneratedQueries.length;
                    aiGeneratedQueries.push(sql);

                    // Check if this is an executable SELECT query
                    const isSelectQuery = /^\\s*SELECT\\s/i.test(sql);

                    // Add the formatted code block with index reference
                    result += \`
                        <pre><code>\${escapeHtml(sql)}</code></pre>
                        <div class="sqt-ai-query-actions">
                            \${isSelectQuery ? \`
                                <button type="button" class="sqt-btn sqt-btn-primary sqt-btn-sm"
                                        onclick="SQT.useAIQueryByIndex(\${queryIndex}); return false;">
                                    <i class="bi bi-plus-circle me-1"></i>Insert Query
                                </button>
                            \` : ''}
                            <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm"
                                    onclick="SQT.copyAIQueryByIndex(\${queryIndex}); return false;">
                                <i class="bi bi-clipboard me-1"></i>Copy
                            </button>
                        </div>
                    \`;

                    lastIndex = match.index + match[0].length;
                }

                // Add any remaining text after the last code block
                const textAfter = content.substring(lastIndex);
                result += escapeHtml(textAfter).replace(/\\n/g, '<br>');

                // Convert inline code (single backticks)
                var inlineCodePattern = new RegExp(bt + '([^' + bt + ']+)' + bt, 'g');
                result = result.replace(inlineCodePattern, '<code>$1</code>');

                return result;
            }

            function useAIQueryByIndex(index) {
                const sql = aiGeneratedQueries[index];
                if (sql) {
                    useAIQuery(sql);
                }
            }

            function copyAIQueryByIndex(index) {
                const sql = aiGeneratedQueries[index];
                if (sql) {
                    copyAIQuery(sql);
                }
            }

            function useAIExample(text) {
                document.getElementById('aiInput').value = text;
                sendAIMessage();
            }

            function askAIForHelp() {
                if (!CONFIG.AI_ENABLED) return;
                if (!state.lastFailedQuery || !state.lastError) {
                    showToast('warning', 'No Error Context', 'No recent query error to get help with.');
                    return;
                }

                // Build the help request message
                const helpMessage = \`My SuiteQL query failed with the following error:

**Error:** \${state.lastError}

**Query:**
\\\`\\\`\\\`sql
\${state.lastFailedQuery}
\\\`\\\`\\\`

Can you help me fix this query?\`;

                // Open the AI modal
                loadAIConversation();
                renderAIConversation();
                const modal = new bootstrap.Modal(document.getElementById('aiModal'));
                modal.show();

                // Pre-populate and send the message after modal is shown
                document.getElementById('aiModal').addEventListener('shown.bs.modal', () => {
                    // Scroll to bottom first - scroll the modal body
                    setTimeout(() => {
                        const scrollContainer = document.querySelector('.sqt-ai-body');
                        if (scrollContainer) {
                            scrollContainer.scrollTop = scrollContainer.scrollHeight;
                        }
                    }, 50);
                    // Then send the help request
                    document.getElementById('aiInput').value = helpMessage;
                    sendAIMessage();
                }, { once: true });
            }

            function askAIAboutResults() {
                if (!CONFIG.AI_ENABLED) return;
                if (!state.results || !state.results.records || state.results.records.length === 0) {
                    showToast('warning', 'No Results', 'No query results to analyze.');
                    return;
                }

                const records = state.results.records;
                const columns = state.results.columns || Object.keys(records[0]);
                const totalRows = records.length;

                // Calculate dynamic row limit based on average row width
                // Target ~10,000 characters for results data to stay within token limits
                const TARGET_CHARS = 10000;
                const sampleSize = Math.min(10, totalRows);
                let totalSampleChars = 0;

                for (let i = 0; i < sampleSize; i++) {
                    const row = records[i];
                    totalSampleChars += columns.map(col => String(row[col] ?? '')).join(' | ').length;
                }

                const avgRowWidth = totalSampleChars / sampleSize;
                const headerWidth = columns.join(' | ').length;
                const dynamicLimit = Math.max(10, Math.floor((TARGET_CHARS - headerWidth) / avgRowWidth));

                // Use dynamic limit but cap at 100 rows
                const rowLimit = Math.min(dynamicLimit, 100);
                const rowsToSend = records.slice(0, rowLimit);
                const isTruncated = totalRows > rowLimit;

                // Format results as a table
                const header = columns.join(' | ');
                const separator = columns.map(col => '-'.repeat(Math.min(col.length, 20))).join('-|-');
                const rows = rowsToSend.map(record =>
                    columns.map(col => {
                        const val = record[col];
                        if (val === null || val === undefined) return 'NULL';
                        return String(val);
                    }).join(' | ')
                ).join('\\n');

                // Build the context message
                let contextMessage = \`I have query results I'd like to discuss.

**Query:**
\\\`\\\`\\\`sql
\${state.lastExecutedQuery || 'Query not available'}
\\\`\\\`\\\`

**Results\${isTruncated ? \` (showing \${rowLimit} of \${totalRows} rows)\` : \` (\${totalRows} rows)\`}:**
\\\`\\\`\\\`
\${header}
\${separator}
\${rows}
\\\`\\\`\\\`
\`;

                if (isTruncated) {
                    contextMessage += \`\\n*Note: Results truncated to \${rowLimit} rows. The full result set contains \${totalRows} rows.*\\n\`;
                }

                contextMessage += \`\\nWhat would you like to know about these results?\`;

                // Open the AI modal
                loadAIConversation();
                renderAIConversation();
                const modal = new bootstrap.Modal(document.getElementById('aiModal'));
                modal.show();

                // Pre-populate the input after modal is shown (don't auto-send, let user ask their question)
                document.getElementById('aiModal').addEventListener('shown.bs.modal', () => {
                    // Scroll to bottom
                    setTimeout(() => {
                        const scrollContainer = document.querySelector('.sqt-ai-body');
                        if (scrollContainer) {
                            scrollContainer.scrollTop = scrollContainer.scrollHeight;
                        }
                    }, 50);

                    // Add context as a user message so it's in the conversation
                    state.aiConversation.push({ role: 'user', content: contextMessage, timestamp: new Date().toISOString() });
                    saveAIConversation();
                    renderAIConversation();

                    // Focus input for user to type their question
                    document.getElementById('aiInput').focus();

                    // Show toast about truncation if applicable
                    if (isTruncated) {
                        showToast('info', 'Results Truncated', \`Showing \${rowLimit} of \${totalRows} rows to AI.\`);
                    }

                    // Auto-send to get AI acknowledgment
                    document.getElementById('aiInput').value = 'Please acknowledge that you have received the query results and are ready to answer questions about them.';
                    sendAIMessage();
                }, { once: true });
            }

            async function sendAIMessage() {
                const input = document.getElementById('aiInput');
                const message = input.value.trim();

                if (!message) return;

                const settings = loadAISettings();
                const apiKey = settings?.apiKey || state.aiApiKey;

                if (!settings || !apiKey) {
                    showToast('warning', 'Settings Required', 'Please configure AI settings first.');
                    showAISettings();
                    return;
                }

                // Add user message
                state.aiConversation.push({ role: 'user', content: message, timestamp: new Date().toISOString() });
                saveAIConversation();
                renderAIConversation();

                // Clear input
                input.value = '';

                // Show loading state
                setAILoadingState(true);

                try {
                    const requestBody = {
                        function: 'aiGenerateQuery',
                        provider: settings.provider,
                        apiKey: apiKey,
                        model: settings.model,
                        messages: state.aiConversation
                    };

                    // Add custom base URL for OpenAI-compatible provider
                    if (settings.provider === 'openai-compatible' && settings.customBaseUrl) {
                        requestBody.customBaseUrl = settings.customBaseUrl;
                    }

                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });

                    const data = await response.json();

                    if (data.error) {
                        showAIError(data.error.message, data.error.debugInfo);
                    } else {
                        // Add assistant response
                        state.aiConversation.push({
                            role: 'assistant',
                            content: data.response,
                            timestamp: new Date().toISOString()
                        });
                        saveAIConversation();
                        renderAIConversation();

                        // Check if response contains SQL and auto-execute is enabled
                        if (document.getElementById('aiAutoExecute').checked) {
                            const sql = extractSQLFromResponse(data.response);
                            if (sql) {
                                useAIQuery(sql);
                            }
                        }
                    }

                } catch (error) {
                    showAIError('Failed to connect to AI service: ' + error.message);
                } finally {
                    setAILoadingState(false);
                }
            }

            function setAILoadingState(loading) {
                state.aiIsLoading = loading;
                const btn = document.getElementById('aiSendBtn');
                const input = document.getElementById('aiInput');

                if (loading) {
                    btn.disabled = true;
                    btn.innerHTML = '<div class="sqt-spinner" style="width: 14px; height: 14px; border-width: 2px; margin: 0;"></div>';
                    input.disabled = true;

                    // Add loading message to UI
                    const container = document.getElementById('aiMessages');
                    const loadingDiv = document.createElement('div');
                    loadingDiv.id = 'aiLoadingMessage';
                    loadingDiv.className = 'sqt-ai-loading';
                    loadingDiv.innerHTML = \`
                        <div class="sqt-spinner" style="width: 16px; height: 16px; border-width: 2px; margin: 0;"></div>
                        <span>Generating query...</span>
                    \`;
                    container.appendChild(loadingDiv);
                    container.scrollTop = container.scrollHeight;
                } else {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="bi bi-send"></i><span>Send</span>';
                    input.disabled = false;
                    input.focus();

                    // Remove loading message
                    const loadingMsg = document.getElementById('aiLoadingMessage');
                    if (loadingMsg) loadingMsg.remove();
                }
            }

            // Store debug info for the debug modal
            let lastDebugInfo = null;

            function showAIError(message, debugInfo = null) {
                const container = document.getElementById('aiMessages');
                const errorDiv = document.createElement('div');
                errorDiv.className = 'sqt-ai-error';

                let html = \`<i class="bi bi-exclamation-triangle"></i>\${escapeHtml(message)}\`;

                if (debugInfo) {
                    lastDebugInfo = debugInfo;
                    html += \` <button type="button" class="btn btn-link btn-sm p-0 ms-2" onclick="SQT.showDebugModal()" style="font-size: 12px; color: inherit; text-decoration: underline;">Show Details</button>\`;
                }

                errorDiv.innerHTML = html;
                container.appendChild(errorDiv);
                container.scrollTop = container.scrollHeight;
            }

            function showDebugModal() {
                if (!lastDebugInfo) return;

                const content = document.getElementById('aiDebugContent');

                let html = '<div class="mb-3">';
                html += '<h6 class="text-primary mb-2">Request Details</h6>';
                html += '<div class="mb-2"><strong>Provider:</strong> ' + escapeHtml(lastDebugInfo.provider || 'N/A') + '</div>';
                html += '<div class="mb-2"><strong>URL:</strong> ' + escapeHtml(lastDebugInfo.url || 'N/A') + '</div>';
                html += '<div class="mb-2"><strong>Headers:</strong></div>';
                html += '<pre class="bg-light p-2 rounded" style="white-space: pre-wrap; word-break: break-all;">' + escapeHtml(JSON.stringify(lastDebugInfo.headers, null, 2)) + '</pre>';
                html += '<div class="mb-2"><strong>Request Body:</strong></div>';
                html += '<pre class="bg-light p-2 rounded" style="white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto;">' + escapeHtml(JSON.stringify(lastDebugInfo.requestBody, null, 2)) + '</pre>';
                html += '</div>';

                html += '<div class="mb-3">';
                html += '<h6 class="text-danger mb-2">Response Details</h6>';
                html += '<div class="mb-2"><strong>Response Code:</strong> ' + escapeHtml(String(lastDebugInfo.responseCode || 'N/A')) + '</div>';
                html += '<div class="mb-2"><strong>Response Body:</strong></div>';
                html += '<pre class="bg-light p-2 rounded" style="white-space: pre-wrap; word-break: break-all;">' + escapeHtml(JSON.stringify(lastDebugInfo.responseBody, null, 2)) + '</pre>';
                html += '</div>';

                content.innerHTML = html;

                new bootstrap.Modal(document.getElementById('aiDebugModal')).show();
            }

            function copyDebugInfo() {
                if (!lastDebugInfo) return;

                const text = JSON.stringify(lastDebugInfo, null, 2);
                navigator.clipboard.writeText(text).then(() => {
                    showToast('success', 'Copied', 'Debug information copied to clipboard.');
                }).catch(() => {
                    showToast('error', 'Copy Failed', 'Failed to copy to clipboard.');
                });
            }

            function extractSQLFromResponse(response) {
                // Build regex pattern dynamically to avoid backtick escaping issues
                var bt = String.fromCharCode(96);
                var fence = bt + bt + bt;
                var pattern = new RegExp(fence + '(?:sql)?\\\\s*[\\\\r\\\\n]+([\\\\s\\\\S]*?)' + fence, 'i');
                const match = response.match(pattern);
                return match ? match[1].trim() : null;
            }

            function useAIQuery(sql) {
                // Close the AI modal
                bootstrap.Modal.getInstance(document.getElementById('aiModal')).hide();

                // Insert into editor
                state.editor.setValue(sql);

                showToast('success', 'Query Inserted', 'The generated query has been added to the editor.');

                // Auto-execute if toggle is on
                if (document.getElementById('aiAutoExecute').checked) {
                    setTimeout(() => runQuery(), 100);
                }
            }

            function copyAIQuery(sql) {
                navigator.clipboard.writeText(sql).then(() => {
                    showToast('success', 'Copied', 'Query copied to clipboard.');
                }).catch(() => {
                    showToast('error', 'Copy Failed', 'Failed to copy query.');
                });
            }

            function handleAIInputKeydown(event) {
                // Ctrl/Cmd + Enter to send
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    sendAIMessage();
                }
            }

            // =================================================================
            // AI ENHANCED FEATURES
            // =================================================================

            /**
             * Explains the current query in plain English.
             */
            async function explainQuery() {
                if (!CONFIG.AI_ENABLED) return;
                const query = state.editor.getValue().trim();
                if (!query) {
                    showToast('warning', 'No Query', 'Please enter a query to explain.');
                    return;
                }

                const settings = loadAISettings();
                if (!settings || !settings.provider || !settings.model) {
                    showToast('warning', 'AI Not Configured', 'Please configure AI settings first.');
                    showAISettings();
                    return;
                }

                const apiKey = getAIApiKey(settings);
                if (!apiKey) {
                    showToast('warning', 'API Key Required', 'Please enter your API key in AI settings.');
                    showAISettings();
                    return;
                }

                // Show explain panel with loading state
                const panel = document.getElementById('explainPanel');
                const content = document.getElementById('explainContent');
                panel.classList.add('visible');
                content.innerHTML = \`
                    <div class="sqt-loading">
                        <div class="sqt-spinner"></div>
                        <span>Analyzing query...</span>
                    </div>
                \`;

                try {
                    const explainMessages = [{
                        role: 'user',
                        content: \`Please explain this SuiteQL query in plain English. Break it down into sections and explain:
1. What data this query retrieves
2. The tables being used and why
3. Any joins and their purpose
4. Filter conditions (WHERE clause)
5. Sorting and grouping

Query:
\\\`\\\`\\\`sql
\${query}
\\\`\\\`\\\`

Provide a clear, concise explanation suitable for someone unfamiliar with this query.\`
                    }];

                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(buildAIRequestBody(settings, apiKey, explainMessages))
                    });

                    const data = await response.json();

                    if (data.error) {
                        let errorHtml = \`<div class="sqt-ai-error"><i class="bi bi-exclamation-triangle"></i> \${escapeHtml(data.error.message)}\`;
                        if (data.error.debugInfo) {
                            lastDebugInfo = data.error.debugInfo;
                            errorHtml += \` <button type="button" class="btn btn-link btn-sm p-0 ms-2" onclick="SQT.showDebugModal()" style="font-size: 12px; color: inherit; text-decoration: underline;">Show Details</button>\`;
                        }
                        errorHtml += \`</div>\`;
                        content.innerHTML = errorHtml;
                    } else {
                        content.innerHTML = formatAIResponse(data.response);
                    }
                } catch (error) {
                    content.innerHTML = \`<div class="sqt-ai-error"><i class="bi bi-exclamation-triangle"></i> Error: \${escapeHtml(error.message)}</div>\`;
                }
            }

            /**
             * Hides the explain panel.
             */
            function hideExplain() {
                document.getElementById('explainPanel').classList.remove('visible');
            }

            /**
             * Validates the current query for potential issues.
             */
            async function validateQuery() {
                if (!CONFIG.AI_ENABLED) return;
                const query = state.editor.getValue().trim();
                if (!query) {
                    showToast('warning', 'No Query', 'Please enter a query to validate.');
                    return;
                }

                const settings = loadAISettings();
                if (!settings || !settings.provider || !settings.model) {
                    showToast('warning', 'AI Not Configured', 'Please configure AI settings first.');
                    showAISettings();
                    return;
                }

                const apiKey = getAIApiKey(settings);
                if (!apiKey) {
                    showToast('warning', 'API Key Required', 'Please enter your API key in AI settings.');
                    showAISettings();
                    return;
                }

                // Show validation panel with loading state
                const panel = document.getElementById('validationPanel');
                const title = document.getElementById('validationTitle');
                const content = document.getElementById('validationContent');
                const actions = document.getElementById('validationActions');
                panel.classList.remove('error');
                panel.classList.add('visible');
                title.textContent = 'Validating Query...';
                content.innerHTML = \`
                    <div class="sqt-loading">
                        <div class="sqt-spinner"></div>
                        <span>Checking for potential issues...</span>
                    </div>
                \`;
                actions.innerHTML = '';

                try {
                    const validateMessages = [{
                        role: 'user',
                        content: \`Review this SuiteQL query for potential issues and best practices. Check for:

1. **Missing WHERE clause** - Query might return too many rows
2. **Cartesian joins** - Missing join conditions that create cross products
3. **SELECT *** - Should specify columns explicitly
4. **Missing table aliases** - Can cause ambiguity
5. **Performance concerns** - Large table scans, missing filters
6. **Syntax issues** - Common SuiteQL mistakes
7. **Security concerns** - Potential injection risks in dynamic queries

Query:
\\\`\\\`\\\`sql
\${query}
\\\`\\\`\\\`

Respond in this JSON format:
{
    "status": "ok" | "warning" | "error",
    "issues": ["issue 1", "issue 2"],
    "suggestions": ["suggestion 1", "suggestion 2"],
    "summary": "Brief overall assessment"
}

Only return the JSON, no other text.\`
                    }];

                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(buildAIRequestBody(settings, apiKey, validateMessages))
                    });

                    const data = await response.json();

                    if (data.error) {
                        title.textContent = 'Validation Error';
                        panel.classList.add('error');
                        let errorHtml = \`<p>\${escapeHtml(data.error.message)}\`;
                        if (data.error.debugInfo) {
                            lastDebugInfo = data.error.debugInfo;
                            errorHtml += \` <button type="button" class="btn btn-link btn-sm p-0 ms-2" onclick="SQT.showDebugModal()" style="font-size: 12px; text-decoration: underline;">Show Details</button>\`;
                        }
                        errorHtml += \`</p>\`;
                        content.innerHTML = errorHtml;
                        actions.innerHTML = \`
                            <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.hideValidation()">Close</button>
                        \`;
                    } else {
                        // Try to parse JSON response
                        let result;
                        try {
                            // Extract JSON from response (it might be wrapped in markdown)
                            const jsonMatch = data.response.match(/\\{[\\s\\S]*\\}/);
                            result = jsonMatch ? JSON.parse(jsonMatch[0]) : { status: 'ok', summary: data.response, issues: [], suggestions: [] };
                        } catch (e) {
                            result = { status: 'ok', summary: data.response, issues: [], suggestions: [] };
                        }

                        if (result.status === 'ok' && (!result.issues || result.issues.length === 0)) {
                            title.innerHTML = '<i class="bi bi-check-circle"></i> Query Looks Good';
                            panel.classList.remove('error');
                            content.innerHTML = \`<p>\${escapeHtml(result.summary || 'No issues found.')}</p>\`;
                            if (result.suggestions && result.suggestions.length > 0) {
                                content.innerHTML += \`<p><strong>Suggestions:</strong></p><ul>\${result.suggestions.map(s => \`<li>\${escapeHtml(s)}</li>\`).join('')}</ul>\`;
                            }
                            actions.innerHTML = \`
                                <button type="button" class="sqt-btn sqt-btn-primary sqt-btn-sm" onclick="SQT.hideValidation(); SQT.runQuery();">
                                    <i class="bi bi-play-fill"></i> Run Query
                                </button>
                                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.hideValidation()">Close</button>
                            \`;
                        } else {
                            title.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Issues Found';
                            if (result.status === 'error') {
                                panel.classList.add('error');
                            }
                            let html = \`<p>\${escapeHtml(result.summary || '')}</p>\`;
                            if (result.issues && result.issues.length > 0) {
                                html += \`<p><strong>Issues:</strong></p><ul>\${result.issues.map(i => \`<li>\${escapeHtml(i)}</li>\`).join('')}</ul>\`;
                            }
                            if (result.suggestions && result.suggestions.length > 0) {
                                html += \`<p><strong>Suggestions:</strong></p><ul>\${result.suggestions.map(s => \`<li>\${escapeHtml(s)}</li>\`).join('')}</ul>\`;
                            }
                            content.innerHTML = html;
                            actions.innerHTML = \`
                                <button type="button" class="sqt-btn sqt-btn-primary sqt-btn-sm" onclick="SQT.hideValidation(); SQT.runQuery();">
                                    <i class="bi bi-play-fill"></i> Run Anyway
                                </button>
                                <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.hideValidation()">Close</button>
                            \`;
                        }
                    }
                } catch (error) {
                    title.textContent = 'Validation Error';
                    panel.classList.add('error');
                    content.innerHTML = \`<p>Error: \${escapeHtml(error.message)}</p>\`;
                    actions.innerHTML = \`
                        <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="SQT.hideValidation()">Close</button>
                    \`;
                }
            }

            /**
             * Hides the validation panel.
             */
            function hideValidation() {
                document.getElementById('validationPanel').classList.remove('visible');
            }

            /**
             * Generates a query from natural language input.
             */
            async function generateFromNaturalLanguage() {
                if (!CONFIG.AI_ENABLED) return;
                const input = document.getElementById('nlQueryInput');
                const btn = document.getElementById('nlGenerateBtn');
                if (!input || !btn) return;
                const prompt = input.value.trim();

                if (!prompt) {
                    showToast('warning', 'Empty Input', 'Please describe what you want to query.');
                    input.focus();
                    return;
                }

                const settings = loadAISettings();
                if (!settings || !settings.provider || !settings.model) {
                    showToast('warning', 'AI Not Configured', 'Please configure AI settings first.');
                    showAISettings();
                    return;
                }

                const apiKey = getAIApiKey(settings);
                if (!apiKey) {
                    showToast('warning', 'API Key Required', 'Please enter your API key in AI settings.');
                    showAISettings();
                    return;
                }

                // Show loading state
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating...';

                try {
                    const nlMessages = [{
                        role: 'user',
                        content: \`Generate a SuiteQL query for this request: "\${prompt}"

Return ONLY the SQL query in a code block, no explanation needed. The query should be ready to execute.\`
                    }];

                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(buildAIRequestBody(settings, apiKey, nlMessages))
                    });

                    const data = await response.json();

                    if (data.error) {
                        if (data.error.debugInfo) {
                            lastDebugInfo = data.error.debugInfo;
                            showToast('error', 'Generation Failed', data.error.message + ' (Click "Show Details" in Query Explanation for debug info)');
                        } else {
                            showToast('error', 'Generation Failed', data.error.message);
                        }
                    } else {
                        // Extract SQL from response
                        const sql = extractSQLFromResponse(data.response);
                        if (sql) {
                            state.editor.setValue(sql);
                            input.value = '';
                            showToast('success', 'Query Generated', 'The query has been added to the editor.');
                        } else {
                            // If no code block, try using the whole response
                            state.editor.setValue(data.response.trim());
                            input.value = '';
                            showToast('success', 'Query Generated', 'The query has been added to the editor.');
                        }
                    }
                } catch (error) {
                    showToast('error', 'Generation Failed', error.message);
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="bi bi-stars"></i><span>Generate</span>';
                }
            }

            /**
             * Toggles the natural language query bar visibility.
             */
            function toggleNLBar() {
                if (!CONFIG.AI_ENABLED) return;
                const bar = document.getElementById('nlQueryBar');
                if (!bar) return;
                const btn = document.getElementById('nlBarToggle');
                const isHidden = bar.classList.toggle('hidden');

                // Update button active state
                if (btn) {
                    btn.classList.toggle('active', !isHidden);
                }

                // Save preference
                localStorage.setItem('sqt_nl_bar_visible', !isHidden ? 'true' : 'false');

                // Focus the input when showing the bar
                if (!isHidden) {
                    setTimeout(() => {
                        const input = document.getElementById('nlQueryInput');
                        if (input) input.focus();
                    }, 100);
                }
            }

            /**
             * Initializes the natural language bar visibility from saved preference.
             */
            function initNLBar() {
                if (!CONFIG.AI_ENABLED) return;
                const visible = localStorage.getItem('sqt_nl_bar_visible') !== 'false';
                const bar = document.getElementById('nlQueryBar');
                const btn = document.getElementById('nlBarToggle');

                if (bar && !visible) {
                    bar.classList.add('hidden');
                }
                if (btn) {
                    btn.classList.toggle('active', visible);
                }
            }

            /**
             * Shows the optimization banner for slow queries.
             * @param {number} executionTime - Time in milliseconds
             */
            function showOptimizeBanner(executionTime) {
                if (!CONFIG.AI_ENABLED) return;
                const banner = document.getElementById('optimizeBanner');
                const message = document.getElementById('optimizeMessage');
                if (!banner || !message) return;
                const seconds = (executionTime / 1000).toFixed(1);
                message.textContent = \`Query took \${seconds}s to execute. Would you like AI to suggest optimizations?\`;
                banner.classList.add('visible');
            }

            /**
             * Hides the optimization banner.
             */
            function hideOptimizeBanner() {
                const banner = document.getElementById('optimizeBanner');
                if (banner) banner.classList.remove('visible');
            }

            /**
             * Asks AI to optimize the last executed query.
             */
            async function askAIToOptimize() {
                if (!CONFIG.AI_ENABLED) return;
                hideOptimizeBanner();

                const query = state.lastExecutedQuery || state.editor.getValue().trim();
                if (!query) {
                    showToast('warning', 'No Query', 'No query to optimize.');
                    return;
                }

                const settings = loadAISettings();
                if (!settings || !settings.provider || !settings.model) {
                    showToast('warning', 'AI Not Configured', 'Please configure AI settings first.');
                    showAISettings();
                    return;
                }

                const apiKey = getAIApiKey(settings);
                if (!apiKey) {
                    showToast('warning', 'API Key Required', 'Please enter your API key in AI settings.');
                    showAISettings();
                    return;
                }

                // Open AI modal and send optimization request
                showAIModal();

                // Add the optimization request to conversation
                const optimizePrompt = \`This query is running slowly. Please analyze it and suggest optimizations:

\\\`\\\`\\\`sql
\${query}
\\\`\\\`\\\`

Please suggest:
1. Index recommendations (if applicable)
2. Better join strategies
3. Query restructuring for performance
4. Any filtering improvements
5. An optimized version of the query\`;

                // Wait for modal to be ready, then send
                setTimeout(() => {
                    document.getElementById('aiInput').value = optimizePrompt;
                    sendAIMessage();
                }, 300);
            }

            // =================================================================
            // CHART VISUALIZATION
            // =================================================================

            /**
             * Shows the chart modal for visualizing query results.
             */
            function showChartModal() {
                if (!state.results?.records?.length) {
                    showToast('warning', 'No Data', 'Run a query first to visualize results.');
                    return;
                }
                populateChartOptions();
                new bootstrap.Modal(document.getElementById('chartModal')).show();
            }

            /**
             * Populates the column dropdowns in the chart modal based on result data.
             */
            function populateChartOptions() {
                const records = state.results.records;
                const columns = Object.keys(records[0]).filter(c => c !== 'rownumber');

                // Detect numeric vs string columns
                const numericCols = detectNumericColumns(records, columns);
                const stringCols = columns.filter(c => !numericCols.includes(c));

                // Populate label dropdown (all columns, prefer string columns first)
                const labelSelect = document.getElementById('chartLabelColumn');
                labelSelect.innerHTML = '<option value="">Select column...</option>';

                // Add string columns first, then numeric
                [...stringCols, ...numericCols].forEach(col => {
                    const option = document.createElement('option');
                    option.value = col;
                    option.textContent = col + (numericCols.includes(col) ? ' (numeric)' : '');
                    labelSelect.appendChild(option);
                });

                // Restore previous selection if valid
                if (state.chartConfig.labelColumn && columns.includes(state.chartConfig.labelColumn)) {
                    labelSelect.value = state.chartConfig.labelColumn;
                }

                // Populate value checkboxes (numeric columns only, or all if no numeric)
                const valueContainer = document.getElementById('chartValueColumns');
                const valueCols = numericCols.length > 0 ? numericCols : columns;

                valueContainer.innerHTML = valueCols.map(col => {
                    const checked = state.chartConfig.valueColumns.includes(col) ? 'checked' : '';
                    return '<div class="sqt-chart-value-item">' +
                        '<input type="checkbox" class="form-check-input sqt-chart-value-cb" ' +
                        'id="chartVal_' + col + '" value="' + col + '" ' + checked + ' ' +
                        'onchange="SQT.onValueColumnToggle(this)">' +
                        '<label for="chartVal_' + col + '">' + col + '</label>' +
                        '</div>';
                }).join('');

                // Update chart type UI
                updateChartConfigUI();

                // Generate chart if config is valid
                if (state.chartConfig.labelColumn && state.chartConfig.valueColumns.length) {
                    generateChart();
                } else {
                    // Show empty state
                    document.getElementById('chartEmpty').style.display = 'block';
                    document.getElementById('chartExportBtn').disabled = true;
                }
            }

            /**
             * Detects which columns contain numeric data.
             * @param {Array} records - The query result records
             * @param {Array} columns - Column names to check
             * @returns {Array} Columns that contain numeric data
             */
            function detectNumericColumns(records, columns) {
                return columns.filter(col => {
                    const sample = records.slice(0, 20);
                    return sample.every(r => {
                        const val = r[col];
                        return val === null || val === '' || !isNaN(parseFloat(val));
                    });
                });
            }

            /**
             * Generates the chart from current configuration.
             */
            function generateChart() {
                const canvas = document.getElementById('chartCanvas');
                if (!canvas) return;
                const ctx = canvas.getContext('2d');

                // Destroy existing chart
                if (state.chart) {
                    state.chart.destroy();
                    state.chart = null;
                }

                // Hide empty state
                document.getElementById('chartEmpty').style.display = 'none';

                // Build chart data
                const chartData = buildChartData();

                // Get theme-aware colors
                const colors = getChartColors();

                // Configure chart options based on type
                const options = getChartOptions(colors);

                // Create new chart
                state.chart = new Chart(ctx, {
                    type: state.chartConfig.type,
                    data: chartData,
                    options: options
                });

                // Enable export button
                document.getElementById('chartExportBtn').disabled = false;
            }

            /**
             * Builds chart data from query results.
             * @returns {Object} Chart.js data object
             */
            function buildChartData() {
                const records = state.results.records;
                const labels = records.map(r => {
                    const val = r[state.chartConfig.labelColumn];
                    return val === null || val === '' ? '(empty)' : String(val);
                });

                const isPieType = ['pie', 'doughnut', 'polarArea'].includes(state.chartConfig.type);

                if (isPieType && state.chartConfig.valueColumns.length === 1) {
                    // For pie/doughnut, use single dataset with multiple colors
                    const col = state.chartConfig.valueColumns[0];
                    return {
                        labels: labels,
                        datasets: [{
                            label: col,
                            data: records.map(r => parseFloat(r[col]) || 0),
                            backgroundColor: labels.map((_, idx) => getDatasetColor(idx, 0.7)),
                            borderColor: labels.map((_, idx) => getDatasetColor(idx, 1)),
                            borderWidth: 1
                        }]
                    };
                }

                // For bar/line/area, each value column is a dataset
                const datasets = state.chartConfig.valueColumns.map((col, idx) => ({
                    label: col,
                    data: records.map(r => parseFloat(r[col]) || 0),
                    backgroundColor: getDatasetColor(idx, 0.6),
                    borderColor: getDatasetColor(idx, 1),
                    borderWidth: state.chartConfig.type === 'line' ? 2 : 1,
                    fill: state.chartConfig.type === 'line' ? false : true,
                    tension: 0.1
                }));

                return { labels, datasets };
            }

            /**
             * Gets theme-aware chart colors from CSS variables.
             * @returns {Object} Color values for chart elements
             */
            function getChartColors() {
                const style = getComputedStyle(document.documentElement);
                return {
                    text: style.getPropertyValue('--sqt-text-primary').trim() || '#333',
                    grid: style.getPropertyValue('--sqt-border').trim() || '#ddd',
                    bg: style.getPropertyValue('--sqt-bg-secondary').trim() || '#fff'
                };
            }

            /**
             * Color palette for chart datasets.
             * @param {number} index - Dataset index
             * @param {number} alpha - Opacity value (0-1)
             * @returns {string} RGBA color string
             */
            function getDatasetColor(index, alpha) {
                const palette = [
                    '59, 130, 246',   // Blue
                    '16, 185, 129',   // Green
                    '249, 115, 22',   // Orange
                    '139, 92, 246',   // Purple
                    '236, 72, 153',   // Pink
                    '14, 165, 233',   // Cyan
                    '245, 158, 11',   // Amber
                    '99, 102, 241',   // Indigo
                    '34, 197, 94',    // Emerald
                    '244, 63, 94'     // Rose
                ];
                const rgb = palette[index % palette.length];
                return 'rgba(' + rgb + ', ' + alpha + ')';
            }

            /**
             * Gets Chart.js options with theme support.
             * @param {Object} colors - Theme color values
             * @returns {Object} Chart.js options object
             */
            function getChartOptions(colors) {
                const isPieType = ['pie', 'doughnut', 'polarArea'].includes(state.chartConfig.type);

                const options = {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: isPieType ? 'right' : 'top',
                            labels: { color: colors.text }
                        }
                    }
                };

                // Add scales for non-pie charts
                if (!isPieType) {
                    options.scales = {
                        x: {
                            ticks: { color: colors.text },
                            grid: { color: colors.grid }
                        },
                        y: {
                            ticks: { color: colors.text },
                            grid: { color: colors.grid },
                            beginAtZero: true
                        }
                    };
                }

                return options;
            }

            /**
             * Exports the current chart as a PNG image.
             */
            function exportChartPNG() {
                if (!state.chart) {
                    showToast('warning', 'No Chart', 'Generate a chart first.');
                    return;
                }
                const link = document.createElement('a');
                const timestamp = new Date().toISOString().slice(0, 10);
                link.download = 'chart-' + timestamp + '.png';
                link.href = document.getElementById('chartCanvas').toDataURL('image/png');
                link.click();
                showToast('success', 'Chart Exported', 'PNG file downloaded.');
            }

            /**
             * Sets the chart type and regenerates the chart.
             * @param {string} type - Chart type (bar, line, pie, doughnut, polarArea)
             */
            function setChartType(type) {
                state.chartConfig.type = type;
                updateChartConfigUI();
                if (state.chartConfig.labelColumn && state.chartConfig.valueColumns.length) {
                    generateChart();
                }
            }

            /**
             * Updates the chart config UI to reflect current state.
             */
            function updateChartConfigUI() {
                // Update type buttons
                document.querySelectorAll('.sqt-chart-type-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.type === state.chartConfig.type);
                });

                // Update label dropdown
                const labelSelect = document.getElementById('chartLabelColumn');
                if (labelSelect && state.chartConfig.labelColumn) {
                    labelSelect.value = state.chartConfig.labelColumn;
                }

                // Update value checkboxes
                document.querySelectorAll('.sqt-chart-value-cb').forEach(cb => {
                    cb.checked = state.chartConfig.valueColumns.includes(cb.value);
                });
            }

            /**
             * Handles label column change.
             * @param {HTMLSelectElement} select - The label column select element
             */
            function onLabelColumnChange(select) {
                state.chartConfig.labelColumn = select.value;
                if (state.chartConfig.valueColumns.length && select.value) {
                    generateChart();
                } else if (!select.value) {
                    // Clear chart if no label selected
                    if (state.chart) {
                        state.chart.destroy();
                        state.chart = null;
                    }
                    document.getElementById('chartEmpty').style.display = 'block';
                    document.getElementById('chartExportBtn').disabled = true;
                }
            }

            /**
             * Handles value column checkbox toggle.
             * @param {HTMLInputElement} checkbox - The value column checkbox
             */
            function onValueColumnToggle(checkbox) {
                const col = checkbox.value;
                if (checkbox.checked) {
                    if (!state.chartConfig.valueColumns.includes(col)) {
                        state.chartConfig.valueColumns.push(col);
                    }
                } else {
                    state.chartConfig.valueColumns = state.chartConfig.valueColumns.filter(c => c !== col);
                }
                if (state.chartConfig.labelColumn && state.chartConfig.valueColumns.length) {
                    generateChart();
                } else if (!state.chartConfig.valueColumns.length) {
                    // Clear chart if no values selected
                    if (state.chart) {
                        state.chart.destroy();
                        state.chart = null;
                    }
                    document.getElementById('chartEmpty').style.display = 'block';
                    document.getElementById('chartExportBtn').disabled = true;
                }
            }

            /**
             * Generates chart from natural language description using AI.
             */
            async function generateChartFromDescription() {
                const input = document.getElementById('chartAIInput');
                const description = input.value.trim();

                if (!description) {
                    showToast('warning', 'Empty Description', 'Describe the chart you want to create.');
                    return;
                }

                const settings = loadAISettings();
                if (!settings?.provider || !settings?.model) {
                    showToast('warning', 'AI Not Configured', 'Configure AI settings first.');
                    showAISettings();
                    return;
                }

                const apiKey = getAIApiKey(settings);
                if (!apiKey) {
                    showToast('warning', 'API Key Required', 'Enter your API key in AI settings.');
                    showAISettings();
                    return;
                }

                // Build context about available data
                const records = state.results.records;
                const columns = Object.keys(records[0]).filter(c => c !== 'rownumber');
                const numericCols = detectNumericColumns(records, columns);
                const sampleData = records.slice(0, 3);

                const prompt = 'Analyze this data and suggest the best chart configuration:' +
                    String.fromCharCode(10) + String.fromCharCode(10) +
                    'Available columns: ' + columns.join(', ') + String.fromCharCode(10) +
                    'Numeric columns: ' + numericCols.join(', ') + String.fromCharCode(10) +
                    'Sample data (first 3 rows): ' + JSON.stringify(sampleData, null, 2) + String.fromCharCode(10) +
                    String.fromCharCode(10) +
                    'User request: "' + description + '"' + String.fromCharCode(10) +
                    String.fromCharCode(10) +
                    'Respond with ONLY a JSON object (no markdown, no code blocks):' + String.fromCharCode(10) +
                    '{' + String.fromCharCode(10) +
                    '    "type": "bar|line|pie|doughnut|polarArea",' + String.fromCharCode(10) +
                    '    "labelColumn": "column_name_for_x_axis",' + String.fromCharCode(10) +
                    '    "valueColumns": ["column_name_for_y_axis"],' + String.fromCharCode(10) +
                    '    "title": "Suggested chart title"' + String.fromCharCode(10) +
                    '}' + String.fromCharCode(10) +
                    String.fromCharCode(10) +
                    'Choose the most appropriate chart type and columns based on the user request and data structure.';

                // Show loading state
                const btn = document.getElementById('chartAIBtn');
                const originalHtml = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

                try {
                    const response = await fetch(CONFIG.SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(buildAIRequestBody(settings, apiKey, [
                            { role: 'user', content: prompt }
                        ]))
                    });

                    const data = await response.json();

                    if (data.error) {
                        showToast('error', 'AI Error', data.error.message || 'Failed to generate chart configuration.');
                        return;
                    }

                    // Parse AI response - extract JSON from response
                    const responseText = data.response || '';
                    const jsonMatch = responseText.match(/\\{[\\s\\S]*\\}/);
                    if (jsonMatch) {
                        const config = JSON.parse(jsonMatch[0]);

                        // Validate columns exist
                        if (!columns.includes(config.labelColumn)) {
                            showToast('warning', 'Invalid Column', 'AI suggested a label column that does not exist.');
                            return;
                        }

                        const validValues = (config.valueColumns || []).filter(c => columns.includes(c));
                        if (validValues.length === 0) {
                            showToast('warning', 'Invalid Columns', 'AI suggested value columns that do not exist.');
                            return;
                        }

                        // Apply configuration
                        state.chartConfig.type = config.type || 'bar';
                        state.chartConfig.labelColumn = config.labelColumn;
                        state.chartConfig.valueColumns = validValues;

                        // Update UI and generate chart
                        document.getElementById('chartLabelColumn').value = config.labelColumn;
                        updateChartConfigUI();
                        generateChart();

                        showToast('success', 'Chart Generated', config.title || 'Chart created from your description.');
                    } else {
                        showToast('error', 'Parse Error', 'Could not parse AI response.');
                    }
                } catch (error) {
                    console.error('Chart AI error:', error);
                    showToast('error', 'Error', error.message || 'Failed to generate chart.');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = originalHtml;
                }
            }

            // =================================================================
            // PUBLIC API
            // =================================================================

            return {
                init,
                runQuery,
                formatQuery,
                toggleTheme,
                toggleSidebar,
                toggleFocusMode,
                toggleResultsMaximized,
                toggleOptions,
                toggleAIDropdown,
                toggleMoreDropdown,
                closeAllDropdowns,
                updateOptions,
                openTablesReference,
                openSchemaExplorer,
                showRemoteLibrary,
                loadRemoteQuery,
                showLocalLibrary,
                loadLocalQuery,
                showSaveModal,
                saveQuery,
                showWorkbooks,
                loadWorkbook,
                showExportModal,
                exportAs,
                copyToClipboard,
                showHelp,
                loadFromHistory,
                clearHistory,
                setViewMode,
                refreshResults,
                clearResults,
                // Feature functions
                toggleAutocomplete,
                toggleSchemaAutocomplete,
                toggleRecordLinks,
                toggleCompactToolbar,
                updateToolbarVisibility,
                changeEditorFontSize,
                // Query Editor Toolbar
                editorUndo,
                editorRedo,
                editorFind,
                editorReplace,
                editorFontSize,
                editorToggleWrap,
                editorGoToLine,
                showShareModal,
                copyShareUrl,
                showRowDetails,
                prevRow,
                nextRow,
                // Import/Export
                importSqlFile,
                handleFileSelect,
                downloadQuery,
                // Document Generation
                showDocGenModal,
                toggleDocGenFullscreen,
                loadDocGenTemplate,
                insertDocGenColumn,
                insertDocGenSnippet,
                formatDocGenTemplate,
                validateDocGenTemplate,
                previewDocGen,
                generateDocument,
                // Suitelet Generation
                showGenerateSuiteletModal,
                generateSuiteletCode,
                copySuiteletCode,
                downloadSuiteletCode,
                // Document Validation
                jumpToEditorLine,
                proceedWithGeneration,
                // Document Data Sources
                addDocGenDataSource,
                removeDocGenDataSource,
                updateDocGenDataSource,
                // Document Projects
                showSaveProjectModal,
                saveDocGenProject,
                loadDocGenProject,
                deleteDocGenProject,
                // Document Editor Toolbar
                docGenEditorUndo,
                docGenEditorRedo,
                docGenEditorFind,
                docGenEditorReplace,
                docGenEditorFontSize,
                docGenEditorToggleWrap,
                docGenEditorFoldAll,
                docGenEditorUnfoldAll,
                docGenEditorGoToLine,
                // AI Template Generation
                showDocGenAIModal,
                generateDocGenWithAI,
                // Parameters
                runWithParameters,
                // Shortcuts & History
                showShortcuts,
                showUndoHistory,
                closeUndoHistory,
                restoreFromUndoHistory,
                // AI Assistant
                showAIModal,
                showAISettings,
                saveAISettings,
                updateAIModels,
                toggleApiKeyVisibility,
                sendAIMessage,
                useAIExample,
                askAIForHelp,
                askAIAboutResults,
                useAIQuery,
                copyAIQuery,
                useAIQueryByIndex,
                copyAIQueryByIndex,
                clearAIConversation,
                handleAIInputKeydown,
                // AI Debug
                showDebugModal,
                copyDebugInfo,
                // AI Enhanced Features
                explainQuery,
                hideExplain,
                validateQuery,
                hideValidation,
                generateFromNaturalLanguage,
                toggleNLBar,
                showOptimizeBanner,
                hideOptimizeBanner,
                askAIToOptimize,
                // Airtable Export
                showAirtableExportModal,
                showAirtableSettings,
                saveAirtableSettings,
                toggleAirtableTokenVisibility,
                refreshAirtableTables,
                exportToAirtable,
                // Google Sheets Export
                showGoogleSheetsExportModal,
                showGoogleSheetsSettings,
                saveGoogleSheetsSettings,
                exportToGoogleSheets,
                // Chart Visualization
                showChartModal,
                generateChart,
                setChartType,
                exportChartPNG,
                generateChartFromDescription,
                onLabelColumnChange,
                onValueColumnToggle,
                // Plugin API
                plugins,
                // Convenience methods for plugins
                getResults: () => state.results,
                getQuery: () => state.editor?.getValue(),
                setQuery: (sql) => state.editor?.setValue(sql),
                getEditor: () => state.editor,
                showModal: (id) => new bootstrap.Modal(document.getElementById(id)).show(),
                hideModal: (id) => bootstrap.Modal.getInstance(document.getElementById(id))?.hide()
            };
        })();

        // Initialize on DOM ready
        document.addEventListener('DOMContentLoaded', SQT.init);
        <\/script>
    `;
}

// =============================================================================
// SECTION 11: TABLES REFERENCE HTML
// =============================================================================

/**
 * Generates HTML for the Tables Reference page.
 * @param {string} scriptUrl - The script URL
 * @returns {string} Complete HTML for tables reference
 */
function generateTablesReferenceHtml(scriptUrl) {
    return `
        <!DOCTYPE html>
        <html lang="en" data-bs-theme="light">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${generateExternalResources()}
            ${generateStyles()}
            <style>
                .sqt-tables-layout {
                    display: flex;
                    height: calc(100vh - var(--sqt-header-height));
                }

                .sqt-tables-list {
                    width: 320px;
                    border-right: 1px solid var(--sqt-border);
                    overflow-y: auto;
                    background: var(--sqt-bg-primary);
                }

                .sqt-tables-detail {
                    flex: 1;
                    overflow-y: auto;
                    padding: 24px;
                    background: var(--sqt-bg-secondary);
                }

                .sqt-table-item {
                    padding: 12px 16px;
                    border-bottom: 1px solid var(--sqt-border);
                    cursor: pointer;
                    transition: background-color 0.15s;
                }

                .sqt-table-item:hover {
                    background: var(--sqt-bg-tertiary);
                }

                .sqt-table-item-label {
                    font-weight: 500;
                    color: var(--sqt-text-primary);
                    margin-bottom: 2px;
                }

                .sqt-table-item-id {
                    font-family: var(--sqt-editor-font);
                    font-size: 11px;
                    color: var(--sqt-text-muted);
                }

                .sqt-detail-header {
                    margin-bottom: 24px;
                }

                .sqt-detail-title {
                    font-size: 24px;
                    font-weight: 600;
                    color: var(--sqt-text-primary);
                    margin-bottom: 4px;
                }

                .sqt-detail-subtitle {
                    font-family: var(--sqt-editor-font);
                    color: var(--sqt-text-secondary);
                }

                .sqt-detail-section {
                    background: var(--sqt-bg-primary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 8px;
                    margin-bottom: 24px;
                    overflow: hidden;
                }

                .sqt-detail-section-header {
                    padding: 12px 16px;
                    background: var(--sqt-bg-secondary);
                    border-bottom: 1px solid var(--sqt-border);
                    font-weight: 600;
                    color: var(--sqt-text-primary);
                }

                .sqt-search-box {
                    padding: 12px 16px;
                    border-bottom: 1px solid var(--sqt-border);
                }

                .sqt-search-input {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid var(--sqt-border);
                    border-radius: 6px;
                    background: var(--sqt-bg-secondary);
                    color: var(--sqt-text-primary);
                    font-size: 13px;
                }

                .sqt-search-input:focus {
                    outline: none;
                    border-color: var(--sqt-primary);
                }

                /* AI Search Toggle */
                .sqt-search-mode-toggle {
                    display: flex;
                    gap: 4px;
                    padding: 8px 16px;
                    border-bottom: 1px solid var(--sqt-border);
                }

                .sqt-search-mode-btn {
                    flex: 1;
                    padding: 6px 12px;
                    border: 1px solid var(--sqt-border);
                    background: var(--sqt-bg-secondary);
                    color: var(--sqt-text-secondary);
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .sqt-search-mode-btn:first-child {
                    border-radius: 6px 0 0 6px;
                }

                .sqt-search-mode-btn:last-child {
                    border-radius: 0 6px 6px 0;
                }

                .sqt-search-mode-btn.active {
                    background: var(--sqt-primary);
                    border-color: var(--sqt-primary);
                    color: white;
                }

                .sqt-search-mode-btn:hover:not(.active) {
                    background: var(--sqt-bg-tertiary);
                }

                /* AI Search Input Area */
                .sqt-ai-search-container {
                    display: none;
                    padding: 12px 16px;
                    border-bottom: 1px solid var(--sqt-border);
                }

                .sqt-ai-search-container.active {
                    display: block;
                }

                .sqt-ai-search-input {
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid var(--sqt-border);
                    border-radius: 6px;
                    background: var(--sqt-bg-secondary);
                    color: var(--sqt-text-primary);
                    font-size: 13px;
                    resize: none;
                    min-height: 60px;
                }

                .sqt-ai-search-input:focus {
                    outline: none;
                    border-color: var(--sqt-primary);
                }

                .sqt-ai-search-btn {
                    margin-top: 8px;
                    width: 100%;
                }

                .sqt-ai-search-results {
                    padding: 12px;
                    background: var(--sqt-bg-tertiary);
                    border-radius: 6px;
                    margin-top: 12px;
                    font-size: 13px;
                    display: none;
                }

                .sqt-ai-search-results.active {
                    display: block;
                }

                .sqt-ai-suggested-table {
                    padding: 8px 12px;
                    background: var(--sqt-bg-primary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 4px;
                    margin-top: 8px;
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .sqt-ai-suggested-table:hover {
                    border-color: var(--sqt-primary);
                    background: var(--sqt-bg-secondary);
                }

                .sqt-ai-suggested-table-name {
                    font-weight: 600;
                    color: var(--sqt-primary);
                }

                .sqt-ai-suggested-table-desc {
                    font-size: 12px;
                    color: var(--sqt-text-secondary);
                    margin-top: 2px;
                }

                /* AI Section in Table Detail */
                .sqt-ai-section {
                    background: linear-gradient(135deg, rgba(37, 99, 235, 0.05), rgba(124, 58, 237, 0.05));
                    border: 1px solid rgba(37, 99, 235, 0.2);
                    border-radius: 8px;
                    padding: 16px;
                    margin-bottom: 24px;
                }

                .sqt-ai-section-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 600;
                    color: var(--sqt-text-primary);
                    margin-bottom: 12px;
                }

                .sqt-ai-section-header i {
                    color: var(--sqt-primary);
                }

                .sqt-ai-quick-actions {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                }

                .sqt-ai-quick-btn {
                    padding: 8px 14px;
                    background: var(--sqt-bg-primary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 20px;
                    color: var(--sqt-text-primary);
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.15s;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .sqt-ai-quick-btn:hover {
                    border-color: var(--sqt-primary);
                    background: rgba(37, 99, 235, 0.1);
                    color: var(--sqt-primary);
                }

                .sqt-ai-quick-btn i {
                    font-size: 14px;
                }

                /* Column Selection */
                .sqt-column-checkbox {
                    width: 16px;
                    height: 16px;
                    cursor: pointer;
                    accent-color: var(--sqt-primary);
                }

                .sqt-column-select-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .sqt-column-select-actions {
                    display: flex;
                    gap: 8px;
                }

                .sqt-selection-count {
                    font-size: 12px;
                    color: var(--sqt-text-secondary);
                    padding: 4px 8px;
                    background: var(--sqt-bg-tertiary);
                    border-radius: 4px;
                }

                /* AI Chat Modal */
                .sqt-ai-modal .modal-dialog {
                    max-width: 600px;
                }

                .sqt-ai-modal .modal-content {
                    background: var(--sqt-bg-primary);
                    border: 1px solid var(--sqt-border);
                }

                .sqt-ai-modal .modal-header {
                    border-bottom: 1px solid var(--sqt-border);
                    padding: 16px 20px;
                }

                .sqt-ai-modal .modal-body {
                    padding: 0;
                    display: flex;
                    flex-direction: column;
                    height: 500px;
                }

                .sqt-ai-messages {
                    flex: 1;
                    overflow-y: auto;
                    padding: 16px;
                }

                .sqt-ai-message {
                    margin-bottom: 16px;
                }

                .sqt-ai-message.user {
                    text-align: right;
                }

                .sqt-ai-message-content {
                    display: inline-block;
                    max-width: 85%;
                    padding: 10px 14px;
                    border-radius: 12px;
                    font-size: 13px;
                    line-height: 1.5;
                    text-align: left;
                }

                .sqt-ai-message.user .sqt-ai-message-content {
                    background: var(--sqt-primary);
                    color: white;
                }

                .sqt-ai-message.assistant .sqt-ai-message-content {
                    background: var(--sqt-bg-tertiary);
                    color: var(--sqt-text-primary);
                }

                .sqt-ai-message-content pre {
                    background: var(--sqt-bg-secondary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 6px;
                    padding: 12px;
                    margin: 8px 0;
                    overflow-x: auto;
                    font-size: 12px;
                }

                .sqt-ai-message-content code {
                    background: var(--sqt-bg-tertiary);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 12px;
                }

                .sqt-ai-input-area {
                    padding: 16px;
                    border-top: 1px solid var(--sqt-border);
                    display: flex;
                    gap: 8px;
                }

                .sqt-ai-input {
                    flex: 1;
                    padding: 10px 14px;
                    border: 1px solid var(--sqt-border);
                    border-radius: 8px;
                    background: var(--sqt-bg-secondary);
                    color: var(--sqt-text-primary);
                    font-size: 13px;
                    resize: none;
                }

                .sqt-ai-input:focus {
                    outline: none;
                    border-color: var(--sqt-primary);
                }

                .sqt-ai-send-btn {
                    padding: 10px 16px;
                    background: var(--sqt-primary);
                    border: none;
                    border-radius: 8px;
                    color: white;
                    cursor: pointer;
                    transition: background 0.15s;
                }

                .sqt-ai-send-btn:hover {
                    background: var(--sqt-primary-hover);
                }

                .sqt-ai-send-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                /* Copy button in AI responses */
                .sqt-ai-copy-btn {
                    position: absolute;
                    top: 4px;
                    right: 4px;
                    padding: 4px 8px;
                    background: var(--sqt-bg-tertiary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 4px;
                    font-size: 11px;
                    cursor: pointer;
                    opacity: 0;
                    transition: opacity 0.15s;
                }

                .sqt-ai-message-content pre:hover .sqt-ai-copy-btn {
                    opacity: 1;
                }

                /* Toast notifications */
                .sqt-toast-container {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 9999;
                }

                .sqt-toast {
                    min-width: 280px;
                    padding: 12px 16px;
                    margin-bottom: 10px;
                    background: var(--sqt-bg-primary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    animation: slideIn 0.3s ease;
                }

                @keyframes slideIn {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }

                .sqt-toast.success {
                    border-left: 4px solid var(--sqt-success);
                }

                .sqt-toast.error {
                    border-left: 4px solid var(--sqt-danger);
                }

                .sqt-toast.warning {
                    border-left: 4px solid var(--sqt-warning);
                }

                .sqt-toast.info {
                    border-left: 4px solid var(--sqt-primary);
                }

                /* Loading spinner */
                .sqt-ai-loading {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px;
                    color: var(--sqt-text-secondary);
                    font-size: 13px;
                }

                .sqt-ai-loading .spinner-border {
                    width: 16px;
                    height: 16px;
                }

                /* Settings needed notice */
                .sqt-ai-settings-notice {
                    padding: 16px;
                    background: var(--sqt-bg-tertiary);
                    border-radius: 8px;
                    text-align: center;
                    color: var(--sqt-text-secondary);
                }

                .sqt-ai-settings-notice button {
                    margin-top: 12px;
                }

                /* Modal z-index and positioning overrides for NetSuite compatibility */
                .modal {
                    z-index: 100000 !important;
                    position: fixed !important;
                }

                .modal-backdrop {
                    z-index: 99999 !important;
                    position: fixed !important;
                }

                .modal-dialog {
                    z-index: 100001 !important;
                }

                .modal.show {
                    display: block !important;
                }

                /* Ensure modals escape any overflow:hidden containers */
                .modal, .modal-backdrop {
                    top: 0 !important;
                    left: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                }

                /* Focus Mode */
                .sqt-app.sqt-focus-mode {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    z-index: 99999;
                    width: 100vw;
                    height: 100vh;
                    max-width: 100vw;
                    max-height: 100vh;
                }

                .sqt-focus-mode .sqt-tables-layout {
                    height: calc(100vh - 56px);
                }
            </style>
        </head>
        <body>
            <!-- Toast Container -->
            <div class="sqt-toast-container" id="toastContainer"></div>

            <div class="sqt-app">
                <header class="sqt-header">
                    <div class="sqt-header-title">
                        <i class="bi bi-table"></i>
                        <span>Tables Reference</span>
                    </div>
                    <div class="sqt-header-actions">
                        <button type="button" class="sqt-btn sqt-btn-secondary" onclick="openSchemaExplorer()" title="Open Schema Explorer">
                            <i class="bi bi-diagram-3"></i> Schema Explorer
                        </button>
                        ${CONFIG.AI_ENABLED ? `
                        <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-icon" onclick="showAISettings()" title="AI Settings">
                            <i class="bi bi-gear"></i>
                        </button>
                        ` : ''}
                        <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-icon" onclick="toggleFocusMode()" title="Toggle focus mode (hide NetSuite chrome)">
                            <i class="bi bi-arrows-fullscreen" id="focusModeIcon"></i>
                        </button>
                        <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-icon" onclick="toggleTheme()" title="Toggle dark mode">
                            <i class="bi bi-moon-stars" id="themeIcon"></i>
                        </button>
                    </div>
                </header>

                <div class="sqt-tables-layout">
                    <div class="sqt-tables-list">
                        ${CONFIG.AI_ENABLED ? `
                        <!-- Search Mode Toggle -->
                        <div class="sqt-search-mode-toggle">
                            <button type="button" class="sqt-search-mode-btn active" onclick="setSearchMode('standard')" id="searchModeStandard">
                                <i class="bi bi-search"></i> Standard
                            </button>
                            <button type="button" class="sqt-search-mode-btn" onclick="setSearchMode('ai')" id="searchModeAI">
                                <i class="bi bi-stars"></i> AI Find
                            </button>
                        </div>
                        ` : ''}

                        <!-- Standard Search -->
                        <div class="sqt-search-box" id="standardSearchBox">
                            <input type="text" class="sqt-search-input" id="tableSearch" placeholder="Search tables..." oninput="filterTables()">
                        </div>

                        ${CONFIG.AI_ENABLED ? `
                        <!-- AI Search -->
                        <div class="sqt-ai-search-container" id="aiSearchBox">
                            <textarea class="sqt-ai-search-input" id="aiSearchInput" placeholder="Describe what data you need...&#10;&#10;Example: I need customer payment history"></textarea>
                            <button type="button" class="sqt-btn sqt-btn-primary sqt-ai-search-btn" onclick="findTablesWithAI()" id="aiSearchBtn">
                                <i class="bi bi-stars"></i> Find Tables
                            </button>
                            <div class="sqt-ai-search-results" id="aiSearchResults"></div>
                        </div>
                        ` : ''}

                        <div id="tablesList">
                            <div class="sqt-loading" style="padding: 24px;">
                                <div class="sqt-spinner"></div>
                                <span>Loading tables...</span>
                            </div>
                        </div>
                    </div>

                    <div class="sqt-tables-detail" id="tableDetail">
                        <div class="sqt-empty-state">
                            <i class="bi bi-table"></i>
                            <h3>Select a Table</h3>
                            <p>Choose a table from the list to view its columns and details.</p>
                        </div>
                    </div>
                </div>
            </div>

            ${CONFIG.AI_ENABLED ? `
            <!-- AI Chat Modal -->
            <div class="modal fade sqt-ai-modal" id="aiChatModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"><i class="bi bi-stars me-2"></i>AI Table Assistant</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="sqt-ai-messages" id="aiMessages"></div>
                            <div class="sqt-ai-input-area">
                                <textarea class="sqt-ai-input" id="aiChatInput" placeholder="Ask about this table..." rows="1" onkeydown="handleAIChatKeydown(event)"></textarea>
                                <button type="button" class="sqt-ai-send-btn" onclick="sendAIChatMessage()" id="aiSendBtn">
                                    <i class="bi bi-send"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- AI Settings Modal -->
            <div class="modal fade" id="aiSettingsModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" style="font-size: 20px; font-weight: 600;"><i class="bi bi-gear me-2"></i>AI Settings</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <label for="aiProvider" class="form-label">AI Provider</label>
                                <select id="aiProvider" class="form-select" onchange="updateAIModels()">
                                    <option value="">Select provider...</option>
                                    <option value="anthropic">Anthropic (Claude)</option>
                                    <option value="openai">OpenAI (GPT)</option>
                                    <option value="cohere">Cohere (Command)</option>
                                    <option value="xai">xAI (Grok)</option>
                                    <option value="gemini">Google (Gemini)</option>
                                    <option value="mistral">Mistral AI</option>
                                </select>
                            </div>
                            <div class="mb-3">
                                <label for="aiModel" class="form-label">Model</label>
                                <select id="aiModel" class="form-select">
                                    <option value="">Select provider first...</option>
                                </select>
                            </div>
                            <div class="mb-3">
                                <label for="aiApiKey" class="form-label">API Key</label>
                                <input type="password" id="aiApiKey" class="form-control" placeholder="Enter your API key">
                                <div class="form-text">
                                    Get your API key from
                                    <a href="https://console.anthropic.com/settings/keys" target="_blank">Anthropic Console</a>,
                                    <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI Platform</a>, or
                                    <a href="https://dashboard.cohere.com/api-keys" target="_blank">Cohere Dashboard</a>.
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" onclick="saveAISettings()">Save Settings</button>
                        </div>
                    </div>
                </div>
            </div>
            ` : ''}

            <script>
                // ===========================================
                // STATE & CONFIGURATION
                // ===========================================
                const SCRIPT_URL = '${scriptUrl}';
                const AI_ENABLED = ${CONFIG.AI_ENABLED};
                const AI_SETTINGS_KEY = 'sqt_ai_settings';

                let allTables = [];
                let theme = localStorage.getItem('sqt_theme') || 'light';
                let currentTable = null;
                let currentTableData = null;
                let selectedColumns = new Set();
                let aiConversation = [];
                let searchMode = 'standard';

                const AI_MODELS = {
                    anthropic: [
                        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (Recommended)' },
                        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
                        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (Fast)' }
                    ],
                    openai: [
                        { id: 'gpt-4o', name: 'GPT-4o (Recommended)' },
                        { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast)' },
                        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' }
                    ],
                    cohere: [
                        { id: 'command-a-03-2025', name: 'Command A (Recommended)' },
                        { id: 'command-r-plus-08-2024', name: 'Command R+' },
                        { id: 'command-r-08-2024', name: 'Command R (Fast)' }
                    ]
                };

                // ===========================================
                // INITIALIZATION
                // ===========================================
                document.documentElement.setAttribute('data-bs-theme', theme);
                updateThemeIcon();

                // ===========================================
                // THEME FUNCTIONS
                // ===========================================
                function toggleTheme() {
                    theme = theme === 'light' ? 'dark' : 'light';
                    document.documentElement.setAttribute('data-bs-theme', theme);
                    localStorage.setItem('sqt_theme', theme);
                    updateThemeIcon();
                }

                function updateThemeIcon() {
                    const icon = document.getElementById('themeIcon');
                    icon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
                }

                // ===========================================
                // SCHEMA EXPLORER
                // ===========================================
                function openSchemaExplorer() {
                    window.open('${scriptUrl}&function=schemaExplorer', '_blank');
                }

                // ===========================================
                // FOCUS MODE
                // ===========================================
                let focusMode = false;

                function toggleFocusMode() {
                    focusMode = !focusMode;
                    const app = document.querySelector('.sqt-app');
                    const icon = document.getElementById('focusModeIcon');

                    if (focusMode) {
                        app.classList.add('sqt-focus-mode');
                        icon.className = 'bi bi-fullscreen-exit';
                    } else {
                        app.classList.remove('sqt-focus-mode');
                        icon.className = 'bi bi-arrows-fullscreen';
                    }
                }

                // Handle Escape key to exit focus mode
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && focusMode) {
                        toggleFocusMode();
                    }
                });

                // ===========================================
                // TOAST NOTIFICATIONS
                // ===========================================
                function showToast(type, title, message) {
                    const container = document.getElementById('toastContainer');
                    const toast = document.createElement('div');
                    toast.className = \`sqt-toast \${type}\`;
                    toast.innerHTML = \`<strong>\${escapeHtml(title)}</strong><div>\${escapeHtml(message)}</div>\`;
                    container.appendChild(toast);
                    setTimeout(() => toast.remove(), 4000);
                }

                // ===========================================
                // SEARCH MODE TOGGLE
                // ===========================================
                function setSearchMode(mode) {
                    searchMode = mode;
                    document.getElementById('searchModeStandard').classList.toggle('active', mode === 'standard');
                    document.getElementById('searchModeAI').classList.toggle('active', mode === 'ai');
                    document.getElementById('standardSearchBox').style.display = mode === 'standard' ? 'block' : 'none';
                    document.getElementById('aiSearchBox').classList.toggle('active', mode === 'ai');

                    if (mode === 'ai') {
                        const settings = loadAISettings();
                        if (!settings || !settings.apiKey) {
                            showToast('warning', 'AI Not Configured', 'Please configure AI settings first.');
                        }
                    }
                }

                // ===========================================
                // TABLE LOADING & DISPLAY
                // ===========================================
                async function loadTables() {
                    try {
                        const url = '/app/recordscatalog/rcendpoint.nl?action=getRecordTypes&data=' +
                            encodeURIComponent(JSON.stringify({ structureType: 'FLAT' }));

                        const response = await fetch(url);
                        const data = await response.json();

                        allTables = data.data.sort((a, b) => a.label.localeCompare(b.label));
                        renderTablesList(allTables);
                    } catch (error) {
                        document.getElementById('tablesList').innerHTML =
                            '<div class="alert alert-danger m-3">Failed to load tables.</div>';
                    }
                }

                function renderTablesList(tables) {
                    const html = tables.map(t => \`
                        <div class="sqt-table-item" onclick="loadTableDetail('\${t.id}')">
                            <div class="sqt-table-item-label">\${escapeHtml(t.label)}</div>
                            <div class="sqt-table-item-id">\${escapeHtml(t.id)}</div>
                        </div>
                    \`).join('');

                    document.getElementById('tablesList').innerHTML = html ||
                        '<div class="sqt-empty-state" style="padding: 24px;"><p>No tables found</p></div>';
                }

                function filterTables() {
                    const search = document.getElementById('tableSearch').value.toLowerCase();
                    const filtered = allTables.filter(t =>
                        t.label.toLowerCase().includes(search) ||
                        t.id.toLowerCase().includes(search)
                    );
                    renderTablesList(filtered);
                }

                async function loadTableDetail(tableId) {
                    const detail = document.getElementById('tableDetail');
                    detail.innerHTML = '<div class="sqt-loading"><div class="sqt-spinner"></div><span>Loading table details...</span></div>';

                    try {
                        const url = '/app/recordscatalog/rcendpoint.nl?action=getRecordTypeDetail&data=' +
                            encodeURIComponent(JSON.stringify({ scriptId: tableId, detailType: 'SS_ANAL' }));

                        const response = await fetch(url);
                        const data = await response.json();
                        const record = data.data;

                        currentTable = tableId;
                        currentTableData = record;
                        selectedColumns = new Set();

                        const columns = record.fields.filter(f => f.isColumn);

                        // Check if AI is configured
                        const aiConfigured = isAIConfigured();

                        let html = \`
                            <div class="sqt-detail-header">
                                <div class="sqt-detail-title">\${escapeHtml(record.label)}</div>
                                <div class="sqt-detail-subtitle">\${escapeHtml(tableId)}</div>
                            </div>
                        \`;

                        // AI Section - Ask AI about this table (only shown when AI_ENABLED)
                        if (AI_ENABLED) {
                            html += \`
                                <div class="sqt-ai-section">
                                    <div class="sqt-ai-section-header">
                                        <i class="bi bi-stars"></i>
                                        <span>Ask AI About This Table</span>
                                    </div>
                                    <div class="sqt-ai-quick-actions">
                                        <button type="button" class="sqt-ai-quick-btn" data-question="usage" \${!aiConfigured ? 'disabled title="Configure AI settings first"' : ''}>
                                            <i class="bi bi-question-circle"></i> What is this table used for?
                                        </button>
                                        <button type="button" class="sqt-ai-quick-btn" data-question="sample" \${!aiConfigured ? 'disabled title="Configure AI settings first"' : ''}>
                                            <i class="bi bi-code-square"></i> Show me a sample query
                                        </button>
                                        <button type="button" class="sqt-ai-quick-btn" data-question="join" \${!aiConfigured ? 'disabled title="Configure AI settings first"' : ''}>
                                            <i class="bi bi-diagram-3"></i> How to join with Customer?
                                        </button>
                                        <button type="button" class="sqt-ai-quick-btn" data-question="columns" \${!aiConfigured ? 'disabled title="Configure AI settings first"' : ''}>
                                            <i class="bi bi-star"></i> Most important columns?
                                        </button>
                                        <button type="button" class="sqt-ai-quick-btn" data-question="custom" \${!aiConfigured ? 'disabled title="Configure AI settings first"' : ''}>
                                            <i class="bi bi-chat-dots"></i> Ask custom question...
                                        </button>
                                    </div>
                                    \${!aiConfigured ? '<div class="mt-2" style="font-size: 12px; color: var(--sqt-text-muted);"><i class="bi bi-info-circle"></i> Configure AI settings to enable these features</div>' : ''}
                                </div>
                            \`;
                        }

                        // Columns section with checkboxes
                        const generateQueryBtn = AI_ENABLED ? \`
                                        <button type="button" class="sqt-btn sqt-btn-primary sqt-btn-sm" onclick="generateQueryFromSelection()" id="generateQueryBtn" disabled>
                                            <i class="bi bi-stars"></i> Generate Query
                                        </button>\` : '';

                        html += \`
                            <div class="sqt-detail-section">
                                <div class="sqt-detail-section-header sqt-column-select-header">
                                    <span>Columns (\${columns.length})</span>
                                    <div class="sqt-column-select-actions">
                                        \${AI_ENABLED ? '<span class="sqt-selection-count" id="selectionCount">0 selected</span>' : ''}
                                        <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="selectAllColumns()">
                                            Select All
                                        </button>
                                        <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="clearColumnSelection()">
                                            Clear
                                        </button>
                                        \${generateQueryBtn}
                                    </div>
                                </div>
                                <table class="table table-sm mb-0">
                                    <thead>
                                        <tr>
                                            <th style="width: 40px;"></th>
                                            <th>Label</th>
                                            <th>Column Name</th>
                                            <th>Type</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        \${columns.map(f => \`
                                            <tr>
                                                <td>
                                                    <input type="checkbox" class="sqt-column-checkbox"
                                                           data-column="\${escapeHtml(f.id)}"
                                                           data-label="\${escapeHtml(f.label)}"
                                                           data-type="\${escapeHtml(f.dataType)}"
                                                           onchange="toggleColumnSelection(this)">
                                                </td>
                                                <td>\${escapeHtml(f.label)}</td>
                                                <td><code>\${escapeHtml(f.id)}</code></td>
                                                <td>\${escapeHtml(f.dataType)}</td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                </table>
                            </div>
                        \`;

                        if (record.joins && record.joins.length > 0) {
                            html += \`
                                <div class="sqt-detail-section">
                                    <div class="sqt-detail-section-header">
                                        Joins (\${record.joins.length})
                                    </div>
                                    <table class="table table-sm mb-0">
                                        <thead>
                                            <tr>
                                                <th>Label</th>
                                                <th>Target Table</th>
                                                <th>Cardinality</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            \${record.joins.map(j => \`
                                                <tr>
                                                    <td>\${escapeHtml(j.label)}</td>
                                                    <td>
                                                        <a href="#" onclick="loadTableDetail('\${j.sourceTargetType.id}'); return false;">
                                                            \${escapeHtml(j.sourceTargetType.id)}
                                                        </a>
                                                    </td>
                                                    <td>\${escapeHtml(j.cardinality)}</td>
                                                </tr>
                                            \`).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            \`;
                        }

                        // Sample query
                        const sampleQuery = 'SELECT\\n' +
                            columns.slice(0, 10).map((f, i, arr) => '    ' + tableId + '.' + f.id + (i < arr.length - 1 ? ',' : '')).join('\\n') +
                            (columns.length > 10 ? '\\n    -- ... and ' + (columns.length - 10) + ' more columns' : '') +
                            '\\nFROM\\n    ' + tableId;

                        html += \`
                            <div class="sqt-detail-section">
                                <div class="sqt-detail-section-header d-flex justify-content-between align-items-center">
                                    <span>Sample Query</span>
                                    <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-sm" onclick="copyQuery()">
                                        <i class="bi bi-clipboard"></i> Copy
                                    </button>
                                </div>
                                <pre id="sampleQuery" style="margin: 0; padding: 16px; background: var(--sqt-bg-secondary); font-size: 12px; overflow-x: auto;">\${escapeHtml(sampleQuery)}</pre>
                            </div>
                        \`;

                        detail.innerHTML = html;
                    } catch (error) {
                        detail.innerHTML = '<div class="alert alert-danger">Failed to load table details.</div>';
                    }
                }

                // ===========================================
                // COLUMN SELECTION
                // ===========================================
                function toggleColumnSelection(checkbox) {
                    const columnId = checkbox.dataset.column;
                    if (checkbox.checked) {
                        selectedColumns.add(columnId);
                    } else {
                        selectedColumns.delete(columnId);
                    }
                    updateSelectionCount();
                }

                function selectAllColumns() {
                    document.querySelectorAll('.sqt-column-checkbox').forEach(cb => {
                        cb.checked = true;
                        selectedColumns.add(cb.dataset.column);
                    });
                    updateSelectionCount();
                }

                function clearColumnSelection() {
                    document.querySelectorAll('.sqt-column-checkbox').forEach(cb => {
                        cb.checked = false;
                    });
                    selectedColumns.clear();
                    updateSelectionCount();
                }

                function updateSelectionCount() {
                    const count = selectedColumns.size;
                    document.getElementById('selectionCount').textContent = count + ' selected';
                    document.getElementById('generateQueryBtn').disabled = count === 0 || !isAIConfigured();
                }

                // ===========================================
                // AI SETTINGS
                // ===========================================
                function loadAISettings() {
                    try {
                        const saved = localStorage.getItem(AI_SETTINGS_KEY);
                        return saved ? JSON.parse(saved) : null;
                    } catch (e) {
                        return null;
                    }
                }

                function saveAISettings() {
                    const provider = document.getElementById('aiProvider').value;
                    const model = document.getElementById('aiModel').value;
                    const apiKey = document.getElementById('aiApiKey').value;

                    if (!provider || !model || !apiKey) {
                        showToast('error', 'Missing Fields', 'Please fill in all fields.');
                        return;
                    }

                    const settings = { provider, model, apiKey };
                    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));

                    bootstrap.Modal.getInstance(document.getElementById('aiSettingsModal')).hide();
                    showToast('success', 'Settings Saved', 'AI settings have been saved.');
                }

                function showAISettings() {
                    if (!AI_ENABLED) return;
                    const modal = document.getElementById('aiSettingsModal');
                    if (!modal) return;
                    const settings = loadAISettings();
                    if (settings) {
                        document.getElementById('aiProvider').value = settings.provider || '';
                        updateAIModels();
                        setTimeout(() => {
                            document.getElementById('aiModel').value = settings.model || '';
                        }, 50);
                        document.getElementById('aiApiKey').value = settings.apiKey || '';
                    }
                    new bootstrap.Modal(modal).show();
                }

                function updateAIModels() {
                    const provider = document.getElementById('aiProvider').value;
                    const modelSelect = document.getElementById('aiModel');
                    modelSelect.innerHTML = '<option value="">Select model...</option>';

                    if (provider && AI_MODELS[provider]) {
                        AI_MODELS[provider].forEach(model => {
                            const option = document.createElement('option');
                            option.value = model.id;
                            option.textContent = model.name;
                            modelSelect.appendChild(option);
                        });
                    }
                }

                function isAIConfigured() {
                    const settings = loadAISettings();
                    return settings && settings.provider && settings.model && settings.apiKey;
                }

                // ===========================================
                // AI TABLE SEARCH (Find the Right Table)
                // ===========================================
                async function findTablesWithAI() {
                    const input = document.getElementById('aiSearchInput');
                    const query = input.value.trim();
                    const resultsDiv = document.getElementById('aiSearchResults');
                    const btn = document.getElementById('aiSearchBtn');

                    if (!query) {
                        showToast('warning', 'Empty Query', 'Please describe what data you need.');
                        return;
                    }

                    const settings = loadAISettings();
                    if (!settings || !settings.apiKey) {
                        showToast('warning', 'AI Not Configured', 'Please configure AI settings first.');
                        showAISettings();
                        return;
                    }

                    // Show loading state
                    btn.disabled = true;
                    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Searching...';
                    resultsDiv.classList.add('active');
                    resultsDiv.innerHTML = '<div class="sqt-ai-loading"><span class="spinner-border spinner-border-sm"></span> AI is analyzing your request...</div>';

                    try {
                        // Get list of available tables for context
                        const tableNames = allTables.slice(0, 100).map(t => t.id).join(', ');

                        const messages = [{
                            role: 'user',
                            content: \`I need to find the right NetSuite tables for this requirement: "\${query}"

Available tables include (partial list): \${tableNames}

Please suggest the most relevant tables for my needs. For each suggested table:
1. Provide the exact table name (ID)
2. Briefly explain why it's relevant
3. Mention any related tables I might need to join

Format your response as a simple list. Keep explanations brief.\`
                        }];

                        const requestBody = {
                            function: 'aiGenerateQuery',
                            provider: settings.provider,
                            apiKey: settings.apiKey,
                            model: settings.model,
                            mode: 'tables',
                            messages: messages
                        };
                        // Include customBaseUrl for OpenAI-compatible provider
                        if (settings.provider === 'openai-compatible' && settings.customBaseUrl) {
                            requestBody.customBaseUrl = settings.customBaseUrl;
                        }

                        const response = await fetch(SCRIPT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(requestBody)
                        });

                        const data = await response.json();

                        if (data.error) {
                            resultsDiv.innerHTML = \`<div class="alert alert-danger mb-0">\${escapeHtml(data.error.message)}</div>\`;
                        } else {
                            // Parse and display AI response
                            const aiResponse = data.response;
                            resultsDiv.innerHTML = \`
                                <div style="margin-bottom: 8px; font-weight: 600; color: var(--sqt-text-primary);">
                                    <i class="bi bi-stars"></i> AI Suggestions
                                </div>
                                <div class="sqt-ai-response-content">\${formatAIResponse(aiResponse)}</div>
                            \`;

                            // Try to extract table names and make them clickable
                            makeTableNamesClickable(resultsDiv);
                        }
                    } catch (error) {
                        resultsDiv.innerHTML = \`<div class="alert alert-danger mb-0">Error: \${escapeHtml(error.message)}</div>\`;
                    } finally {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="bi bi-stars"></i> Find Tables';
                    }
                }

                function makeTableNamesClickable(container) {
                    const tableIds = allTables.map(t => t.id.toLowerCase());
                    const content = container.querySelector('.sqt-ai-response-content');
                    if (!content) return;

                    // Find table names in the response and make them clickable
                    allTables.forEach(table => {
                        const regex = new RegExp('\\\\b' + table.id + '\\\\b', 'gi');
                        content.innerHTML = content.innerHTML.replace(regex, (match) => {
                            return \`<a href="#" class="sqt-ai-suggested-table-name" onclick="loadTableDetail('\${table.id}'); return false;">\${match}</a>\`;
                        });
                    });
                }

                // ===========================================
                // AI CHAT FOR TABLE QUESTIONS
                // ===========================================
                function askAIQuestion(question) {
                    if (!isAIConfigured()) {
                        showToast('warning', 'AI Not Configured', 'Please configure AI settings first.');
                        showAISettings();
                        return;
                    }

                    // Clear previous conversation and start fresh
                    aiConversation = [];
                    openAIChatWithContext();

                    // Set the question and send
                    setTimeout(() => {
                        document.getElementById('aiChatInput').value = question;
                        sendAIChatMessage();
                    }, 300);
                }

                function openAIChatWithContext() {
                    if (!currentTable || !currentTableData) {
                        showToast('warning', 'No Table Selected', 'Please select a table first.');
                        return;
                    }

                    // Clear and reset conversation
                    aiConversation = [];
                    renderAIMessages();

                    // Open modal
                    new bootstrap.Modal(document.getElementById('aiChatModal')).show();

                    // Focus input
                    setTimeout(() => {
                        document.getElementById('aiChatInput').focus();
                    }, 300);
                }

                async function sendAIChatMessage() {
                    const input = document.getElementById('aiChatInput');
                    const message = input.value.trim();
                    const sendBtn = document.getElementById('aiSendBtn');

                    if (!message) return;

                    const settings = loadAISettings();
                    if (!settings || !settings.apiKey) {
                        showToast('warning', 'AI Not Configured', 'Please configure AI settings first.');
                        return;
                    }

                    // Add context about the current table if this is the first message
                    let contextMessage = message;
                    if (aiConversation.length === 0 && currentTableData) {
                        const columns = currentTableData.fields.filter(f => f.isColumn);
                        const joins = currentTableData.joins || [];

                        contextMessage = \`I'm looking at the '\${currentTable}' table in NetSuite.

Table Info:
- Label: \${currentTableData.label}
- Columns (\${columns.length}): \${columns.slice(0, 20).map(c => c.id).join(', ')}\${columns.length > 20 ? '...' : ''}
- Available Joins: \${joins.length > 0 ? joins.map(j => j.sourceTargetType.id).join(', ') : 'None listed'}

My question: \${message}\`;
                    }

                    // Add user message
                    aiConversation.push({ role: 'user', content: contextMessage, displayContent: message });
                    renderAIMessages();

                    // Clear input
                    input.value = '';

                    // Show loading state
                    sendBtn.disabled = true;
                    addLoadingMessage();

                    try {
                        const chatRequestBody = {
                            function: 'aiGenerateQuery',
                            provider: settings.provider,
                            apiKey: settings.apiKey,
                            model: settings.model,
                            mode: 'tables',
                            messages: aiConversation.map(m => ({ role: m.role, content: m.content }))
                        };
                        // Include customBaseUrl for OpenAI-compatible provider
                        if (settings.provider === 'openai-compatible' && settings.customBaseUrl) {
                            chatRequestBody.customBaseUrl = settings.customBaseUrl;
                        }

                        const response = await fetch(SCRIPT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(chatRequestBody)
                        });

                        const data = await response.json();

                        // Remove loading message
                        removeLoadingMessage();

                        if (data.error) {
                            aiConversation.push({ role: 'assistant', content: 'Error: ' + data.error.message });
                        } else {
                            aiConversation.push({ role: 'assistant', content: data.response });
                        }

                        renderAIMessages();

                    } catch (error) {
                        removeLoadingMessage();
                        aiConversation.push({ role: 'assistant', content: 'Error: ' + error.message });
                        renderAIMessages();
                    } finally {
                        sendBtn.disabled = false;
                    }
                }

                function renderAIMessages() {
                    const container = document.getElementById('aiMessages');

                    if (aiConversation.length === 0) {
                        container.innerHTML = \`
                            <div class="sqt-ai-settings-notice">
                                <i class="bi bi-chat-dots" style="font-size: 32px; display: block; margin-bottom: 8px;"></i>
                                <p>Ask any question about the <strong>\${escapeHtml(currentTable || 'selected')}</strong> table.</p>
                            </div>
                        \`;
                        return;
                    }

                    container.innerHTML = aiConversation.map(msg => \`
                        <div class="sqt-ai-message \${msg.role}">
                            <div class="sqt-ai-message-content">
                                \${msg.role === 'assistant' ? formatAIResponse(msg.content) : escapeHtml(msg.displayContent || msg.content)}
                            </div>
                        </div>
                    \`).join('');

                    // Scroll to bottom
                    container.scrollTop = container.scrollHeight;
                }

                function addLoadingMessage() {
                    const container = document.getElementById('aiMessages');
                    const loadingDiv = document.createElement('div');
                    loadingDiv.id = 'aiLoadingMsg';
                    loadingDiv.className = 'sqt-ai-loading';
                    loadingDiv.innerHTML = '<span class="spinner-border spinner-border-sm"></span> AI is thinking...';
                    container.appendChild(loadingDiv);
                    container.scrollTop = container.scrollHeight;
                }

                function removeLoadingMessage() {
                    const loading = document.getElementById('aiLoadingMsg');
                    if (loading) loading.remove();
                }

                function handleAIChatKeydown(event) {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        sendAIChatMessage();
                    }
                }

                // ===========================================
                // GENERATE QUERY FROM SELECTION
                // ===========================================
                async function generateQueryFromSelection() {
                    if (selectedColumns.size === 0) {
                        showToast('warning', 'No Columns Selected', 'Please select at least one column.');
                        return;
                    }

                    if (!isAIConfigured()) {
                        showToast('warning', 'AI Not Configured', 'Please configure AI settings first.');
                        showAISettings();
                        return;
                    }

                    const settings = loadAISettings();
                    const columns = Array.from(selectedColumns);
                    const columnDetails = [];

                    // Gather column details
                    document.querySelectorAll('.sqt-column-checkbox:checked').forEach(cb => {
                        columnDetails.push({
                            id: cb.dataset.column,
                            label: cb.dataset.label,
                            type: cb.dataset.type
                        });
                    });

                    // Get join info
                    const joins = currentTableData.joins || [];

                    // Open chat and send request
                    aiConversation = [];
                    openAIChatWithContext();

                    const question = \`Generate a practical SuiteQL query using the '\${currentTable}' table with these selected columns:

\${columnDetails.map(c => \`- \${c.id} (\${c.label}, \${c.type})\`).join('\\n')}

Available joins: \${joins.length > 0 ? joins.map(j => j.sourceTargetType.id).join(', ') : 'None listed'}

Please:
1. Include the selected columns in the SELECT clause
2. Add appropriate WHERE conditions based on common use cases
3. Suggest any useful joins if relevant to these columns
4. Add an ORDER BY clause if appropriate
5. Include comments explaining the query\`;

                    setTimeout(() => {
                        document.getElementById('aiChatInput').value = question;
                        sendAIChatMessage();
                    }, 300);
                }

                // ===========================================
                // UTILITY FUNCTIONS
                // ===========================================
                function formatAIResponse(content) {
                    if (!content) return '';

                    // Escape HTML first
                    let formatted = escapeHtml(content);

                    // Build regex patterns dynamically to avoid backtick escaping issues
                    var bt = String.fromCharCode(96);
                    var fence = bt + bt + bt;

                    // Format code blocks
                    var codeBlockPattern = new RegExp(fence + '(\\\\w*)\\\\n([\\\\s\\\\S]*?)' + fence, 'g');
                    formatted = formatted.replace(codeBlockPattern, function(match, lang, code) {
                        return '<pre style="position: relative;"><code>' + code.trim() + '</code><button type="button" class="sqt-ai-copy-btn" onclick="copyCodeBlock(this)">Copy</button></pre>';
                    });

                    // Format inline code
                    var inlineCodePattern = new RegExp(bt + '([^' + bt + ']+)' + bt, 'g');
                    formatted = formatted.replace(inlineCodePattern, '<code>$1</code>');

                    // Format bold
                    formatted = formatted.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

                    // Format line breaks
                    formatted = formatted.replace(/\\n/g, '<br>');

                    return formatted;
                }

                function copyCodeBlock(button) {
                    const pre = button.parentElement;
                    const code = pre.querySelector('code').textContent;
                    navigator.clipboard.writeText(code).then(() => {
                        button.textContent = 'Copied!';
                        setTimeout(() => button.textContent = 'Copy', 2000);
                    });
                }

                function copyQuery() {
                    const query = document.getElementById('sampleQuery').textContent;
                    navigator.clipboard.writeText(query).then(() => {
                        showToast('success', 'Copied', 'Query copied to clipboard!');
                    });
                }

                function escapeHtml(text) {
                    if (text === null || text === undefined) return '';
                    const div = document.createElement('div');
                    div.textContent = text;
                    return div.innerHTML;
                }

                // ===========================================
                // INITIALIZATION
                // ===========================================

                // Move modals to body root to avoid z-index/overflow issues with NetSuite
                document.addEventListener('DOMContentLoaded', () => {
                    const modals = document.querySelectorAll('.modal');
                    modals.forEach(modal => {
                        document.body.appendChild(modal);
                    });
                });

                // Handle AI quick question button clicks using event delegation
                document.addEventListener('click', (e) => {
                    const btn = e.target.closest('.sqt-ai-quick-btn[data-question]');
                    if (!btn || btn.disabled) return;

                    const questionType = btn.dataset.question;
                    if (!currentTable) {
                        showToast('warning', 'No Table Selected', 'Please select a table first.');
                        return;
                    }

                    const questions = {
                        usage: 'What is the ' + currentTable + ' table typically used for in NetSuite?',
                        sample: 'Show me a practical sample query using the ' + currentTable + ' table with its most useful columns.',
                        join: 'How do I join the ' + currentTable + ' table with the Customer table?',
                        columns: 'What are the most important columns in the ' + currentTable + ' table and what do they contain?',
                        custom: null
                    };

                    if (questionType === 'custom') {
                        openAIChatWithContext();
                    } else if (questions[questionType]) {
                        askAIQuestion(questions[questionType]);
                    }
                });

                loadTables();
            <\/script>
        </body>
        </html>
    `;
}

// =============================================================================
// SECTION 12: HTML GENERATION - SCHEMA EXPLORER
// =============================================================================

/**
 * Generates the Schema Explorer HTML.
 * This tool allows users to build a complete schema of the NetSuite database
 * and export it as JSON or SQL DDL for use in external database tools.
 * @param {string} scriptUrl - The script URL
 * @returns {string} Complete HTML for the Schema Explorer
 */
function generateSchemaExplorerHtml(scriptUrl) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>NetSuite Schema Explorer</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css" rel="stylesheet">
            <style>
                :root {
                    --sqt-bg-primary: #ffffff;
                    --sqt-bg-secondary: #f8f9fa;
                    --sqt-bg-tertiary: #e9ecef;
                    --sqt-text-primary: #212529;
                    --sqt-text-secondary: #6c757d;
                    --sqt-text-muted: #adb5bd;
                    --sqt-border: #dee2e6;
                    --sqt-accent: #0d6efd;
                    --sqt-accent-hover: #0b5ed7;
                    --sqt-success: #198754;
                    --sqt-warning: #ffc107;
                    --sqt-danger: #dc3545;
                }

                [data-bs-theme="dark"] {
                    --sqt-bg-primary: #1a1d21;
                    --sqt-bg-secondary: #212529;
                    --sqt-bg-tertiary: #2b3035;
                    --sqt-text-primary: #e9ecef;
                    --sqt-text-secondary: #adb5bd;
                    --sqt-text-muted: #6c757d;
                    --sqt-border: #495057;
                    --sqt-accent: #3d8bfd;
                    --sqt-accent-hover: #5c9cfd;
                }

                * { box-sizing: border-box; }

                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    font-size: 14px;
                    margin: 0;
                    padding: 0;
                    background: var(--sqt-bg-secondary);
                    color: var(--sqt-text-primary);
                }

                .sqt-app {
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                }

                .sqt-app.sqt-focus-mode {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    z-index: 9999;
                }

                /* Header */
                .sqt-header {
                    background: var(--sqt-bg-primary);
                    border-bottom: 1px solid var(--sqt-border);
                    padding: 16px 24px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .sqt-header-title {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .sqt-header-title h1 {
                    font-size: 20px;
                    font-weight: 600;
                    margin: 0;
                }

                .sqt-header-title .sqt-badge {
                    background: var(--sqt-accent);
                    color: white;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                }

                .sqt-header-actions {
                    display: flex;
                    gap: 8px;
                }

                /* Buttons */
                .sqt-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }

                .sqt-btn-primary {
                    background: var(--sqt-accent);
                    color: white;
                }

                .sqt-btn-primary:hover {
                    background: var(--sqt-accent-hover);
                }

                .sqt-btn-primary:disabled {
                    background: var(--sqt-text-muted);
                    cursor: not-allowed;
                }

                .sqt-btn-secondary {
                    background: var(--sqt-bg-tertiary);
                    color: var(--sqt-text-primary);
                }

                .sqt-btn-secondary:hover {
                    background: var(--sqt-border);
                }

                .sqt-btn-success {
                    background: var(--sqt-success);
                    color: white;
                }

                .sqt-btn-success:hover {
                    background: #157347;
                }

                .sqt-btn-icon {
                    padding: 8px;
                    width: 36px;
                    height: 36px;
                    justify-content: center;
                }

                .sqt-btn-sm {
                    padding: 6px 12px;
                    font-size: 12px;
                }

                /* Main Content */
                .sqt-content {
                    flex: 1;
                    padding: 24px;
                    overflow: auto;
                }

                /* Cards */
                .sqt-card {
                    background: var(--sqt-bg-primary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 8px;
                    margin-bottom: 24px;
                }

                .sqt-card-header {
                    padding: 16px 20px;
                    border-bottom: 1px solid var(--sqt-border);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .sqt-card-header h2 {
                    font-size: 16px;
                    font-weight: 600;
                    margin: 0;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .sqt-card-body {
                    padding: 20px;
                }

                .sqt-card.collapsed .sqt-card-body {
                    display: none;
                }

                .sqt-card.collapsed .sqt-card-header {
                    border-bottom: none;
                }

                .sqt-card-toggle {
                    background: none;
                    border: none;
                    color: var(--sqt-text-secondary);
                    cursor: pointer;
                    padding: 4px 8px;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    border-radius: 4px;
                    transition: background 0.15s, color 0.15s;
                }

                .sqt-card-toggle:hover {
                    background: var(--sqt-bg-tertiary);
                    color: var(--sqt-text-primary);
                }

                .sqt-card.collapsed .sqt-card-toggle .bi-chevron-up {
                    transform: rotate(180deg);
                }

                /* Progress Section */
                .sqt-progress-section {
                    margin-bottom: 16px;
                }

                .sqt-progress-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 8px;
                    font-size: 13px;
                }

                .sqt-progress-bar-container {
                    background: var(--sqt-bg-tertiary);
                    border-radius: 4px;
                    height: 8px;
                    overflow: hidden;
                }

                .sqt-progress-bar {
                    background: var(--sqt-accent);
                    height: 100%;
                    width: 0%;
                    transition: width 0.3s ease;
                }

                .sqt-progress-bar.complete {
                    background: var(--sqt-success);
                }

                .sqt-progress-stats {
                    display: flex;
                    gap: 24px;
                    margin-top: 16px;
                    padding-top: 16px;
                    border-top: 1px solid var(--sqt-border);
                }

                .sqt-stat {
                    text-align: center;
                }

                .sqt-stat-value {
                    font-size: 24px;
                    font-weight: 600;
                    color: var(--sqt-accent);
                }

                .sqt-stat-label {
                    font-size: 12px;
                    color: var(--sqt-text-secondary);
                }

                /* Status Messages */
                .sqt-status {
                    padding: 12px 16px;
                    border-radius: 6px;
                    margin-bottom: 16px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .sqt-status.info {
                    background: #cfe2ff;
                    color: #084298;
                }

                .sqt-status.success {
                    background: #d1e7dd;
                    color: #0f5132;
                }

                .sqt-status.warning {
                    background: #fff3cd;
                    color: #664d03;
                }

                [data-bs-theme="dark"] .sqt-status.info {
                    background: #031633;
                    color: #6ea8fe;
                }

                [data-bs-theme="dark"] .sqt-status.success {
                    background: #051b11;
                    color: #75b798;
                }

                [data-bs-theme="dark"] .sqt-status.warning {
                    background: #332701;
                    color: #ffda6a;
                }

                /* Export Options */
                .sqt-export-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 16px;
                }

                .sqt-export-option {
                    background: var(--sqt-bg-secondary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 8px;
                    padding: 20px;
                    text-align: center;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }

                .sqt-export-option:hover {
                    border-color: var(--sqt-accent);
                    background: var(--sqt-bg-primary);
                }

                .sqt-export-option.disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .sqt-export-option.sqt-export-advanced {
                    display: none;
                }

                .sqt-export-grid.show-all .sqt-export-option.sqt-export-advanced {
                    display: block;
                }

                .sqt-export-option i {
                    font-size: 32px;
                    color: var(--sqt-accent);
                    margin-bottom: 12px;
                }

                .sqt-export-option h3 {
                    font-size: 14px;
                    font-weight: 600;
                    margin: 0 0 4px 0;
                }

                .sqt-export-option p {
                    font-size: 12px;
                    color: var(--sqt-text-secondary);
                    margin: 0;
                }

                /* Schema Browser */
                .sqt-schema-browser {
                    display: grid;
                    grid-template-columns: 300px 1fr;
                    gap: 20px;
                    height: 500px;
                }

                .sqt-table-list {
                    background: var(--sqt-bg-secondary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 8px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }

                .sqt-table-list-header {
                    padding: 12px;
                    border-bottom: 1px solid var(--sqt-border);
                }

                .sqt-table-list-header input {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid var(--sqt-border);
                    border-radius: 6px;
                    background: var(--sqt-bg-primary);
                    color: var(--sqt-text-primary);
                    font-size: 13px;
                }

                .sqt-table-list-content {
                    flex: 1;
                    overflow-y: auto;
                }

                .sqt-table-item {
                    padding: 10px 12px;
                    border-bottom: 1px solid var(--sqt-border);
                    cursor: pointer;
                    transition: background 0.1s ease;
                }

                .sqt-table-item:hover {
                    background: var(--sqt-bg-tertiary);
                }

                .sqt-table-item.selected {
                    background: var(--sqt-accent);
                    color: white;
                }

                .sqt-table-item-label {
                    font-weight: 500;
                    font-size: 13px;
                }

                .sqt-table-item-id {
                    font-size: 11px;
                    color: var(--sqt-text-secondary);
                    font-family: monospace;
                }

                .sqt-table-item.selected .sqt-table-item-id {
                    color: rgba(255,255,255,0.8);
                }

                .sqt-table-detail {
                    background: var(--sqt-bg-primary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 8px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }

                .sqt-table-detail-header {
                    padding: 16px;
                    border-bottom: 1px solid var(--sqt-border);
                }

                .sqt-table-detail-header h3 {
                    font-size: 16px;
                    font-weight: 600;
                    margin: 0 0 4px 0;
                }

                .sqt-table-detail-header code {
                    font-size: 12px;
                    color: var(--sqt-text-secondary);
                }

                .sqt-table-detail-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 0;
                }

                .sqt-columns-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13px;
                }

                .sqt-columns-table th,
                .sqt-columns-table td {
                    padding: 10px 12px;
                    text-align: left;
                    border-bottom: 1px solid var(--sqt-border);
                }

                .sqt-columns-table th {
                    background: var(--sqt-bg-secondary);
                    font-weight: 600;
                    font-size: 11px;
                    text-transform: uppercase;
                    color: var(--sqt-text-secondary);
                    position: sticky;
                    top: 0;
                }

                .sqt-columns-table td code {
                    background: var(--sqt-bg-secondary);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 12px;
                }

                .sqt-column-filter {
                    padding: 12px 16px;
                    border-bottom: 1px solid var(--sqt-border);
                    background: var(--sqt-bg-secondary);
                }

                .sqt-column-filter input {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid var(--sqt-border);
                    border-radius: 6px;
                    font-size: 13px;
                    background: var(--sqt-bg-primary);
                    color: var(--sqt-text-primary);
                }

                .sqt-column-filter input:focus {
                    outline: none;
                    border-color: var(--sqt-accent);
                    box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.15);
                }

                .sqt-column-filter-info {
                    font-size: 11px;
                    color: var(--sqt-text-secondary);
                    margin-top: 6px;
                }

                .sqt-columns-table tbody tr.sqt-highlight {
                    background: rgba(13, 110, 253, 0.1);
                }

                /* Empty State */
                .sqt-empty-state {
                    text-align: center;
                    padding: 40px;
                    color: var(--sqt-text-secondary);
                }

                .sqt-empty-state i {
                    font-size: 48px;
                    margin-bottom: 16px;
                    opacity: 0.5;
                }

                /* Toast */
                .sqt-toast-container {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 10000;
                }

                .sqt-toast {
                    background: var(--sqt-bg-primary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 8px;
                    padding: 12px 16px;
                    margin-bottom: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    animation: slideIn 0.3s ease;
                }

                .sqt-toast.success { border-left: 4px solid var(--sqt-success); }
                .sqt-toast.warning { border-left: 4px solid var(--sqt-warning); }
                .sqt-toast.error { border-left: 4px solid var(--sqt-danger); }

                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }

                /* Log Panel */
                .sqt-log-panel {
                    background: var(--sqt-bg-secondary);
                    border: 1px solid var(--sqt-border);
                    border-radius: 6px;
                    max-height: 200px;
                    overflow-y: auto;
                    font-family: monospace;
                    font-size: 12px;
                    margin-top: 16px;
                }

                .sqt-log-entry {
                    padding: 6px 12px;
                    border-bottom: 1px solid var(--sqt-border);
                }

                .sqt-log-entry:last-child {
                    border-bottom: none;
                }

                .sqt-log-entry.error {
                    color: var(--sqt-danger);
                }

                .sqt-log-entry .time {
                    color: var(--sqt-text-muted);
                    margin-right: 8px;
                }

                /* Responsive */
                @media (max-width: 768px) {
                    .sqt-schema-browser {
                        grid-template-columns: 1fr;
                        height: auto;
                    }

                    .sqt-table-list {
                        height: 300px;
                    }

                    .sqt-table-detail {
                        height: 400px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="sqt-app" id="app">
                <!-- Header -->
                <div class="sqt-header">
                    <div class="sqt-header-title">
                        <i class="bi bi-diagram-3" style="font-size: 24px; color: var(--sqt-accent);"></i>
                        <h1>NetSuite Schema Explorer</h1>
                        <span class="sqt-badge">BETA</span>
                    </div>
                    <div class="sqt-header-actions">
                        <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-icon" onclick="toggleFocusMode()" title="Toggle focus mode">
                            <i class="bi bi-arrows-fullscreen" id="focusModeIcon"></i>
                        </button>
                        <button type="button" class="sqt-btn sqt-btn-secondary sqt-btn-icon" onclick="toggleTheme()" title="Toggle dark mode">
                            <i class="bi bi-moon-stars" id="themeIcon"></i>
                        </button>
                    </div>
                </div>

                <!-- Main Content -->
                <div class="sqt-content">
                    <!-- Build Schema Card -->
                    <div class="sqt-card" id="buildCard">
                        <div class="sqt-card-header">
                            <h2><i class="bi bi-gear"></i> Build Schema</h2>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <button type="button" class="sqt-btn sqt-btn-sm sqt-btn-secondary" onclick="clearStoredSchema()" id="clearBtn" style="display: none;">
                                    <i class="bi bi-trash"></i> Clear Stored Schema
                                </button>
                                <button type="button" class="sqt-card-toggle" onclick="toggleCard('buildCard')" title="Toggle section">
                                    <i class="bi bi-chevron-up"></i>
                                </button>
                            </div>
                        </div>
                        <div class="sqt-card-body">
                            <div id="buildStatus">
                                <div class="sqt-status info" id="statusMessage">
                                    <i class="bi bi-info-circle"></i>
                                    <span>Click "Build Schema" to scan all available tables and columns. This process runs entirely in your browser and may take several minutes.</span>
                                </div>
                            </div>

                            <div class="sqt-progress-section" id="progressSection" style="display: none;">
                                <div class="sqt-progress-header">
                                    <span id="progressLabel">Initializing...</span>
                                    <span id="progressPercent">0%</span>
                                </div>
                                <div class="sqt-progress-bar-container">
                                    <div class="sqt-progress-bar" id="progressBar"></div>
                                </div>
                                <div class="sqt-log-panel" id="logPanel"></div>
                            </div>

                            <div class="sqt-progress-stats" id="statsSection" style="display: none;">
                                <div class="sqt-stat">
                                    <div class="sqt-stat-value" id="statTables">0</div>
                                    <div class="sqt-stat-label">Tables</div>
                                </div>
                                <div class="sqt-stat">
                                    <div class="sqt-stat-value" id="statColumns">0</div>
                                    <div class="sqt-stat-label">Columns</div>
                                </div>
                                <div class="sqt-stat">
                                    <div class="sqt-stat-value" id="statRelationships">0</div>
                                    <div class="sqt-stat-label">Relationships</div>
                                </div>
                                <div class="sqt-stat">
                                    <div class="sqt-stat-value" id="statSize">0 KB</div>
                                    <div class="sqt-stat-label">Schema Size</div>
                                </div>
                                <div class="sqt-stat">
                                    <div class="sqt-stat-value" id="statDate">-</div>
                                    <div class="sqt-stat-label">Last Built</div>
                                </div>
                            </div>

                            <div style="margin-top: 20px; display: flex; gap: 12px; align-items: center;">
                                <button type="button" class="sqt-btn sqt-btn-primary" onclick="buildSchema()" id="buildBtn">
                                    <i class="bi bi-play-fill"></i> Build Schema
                                </button>
                                <button type="button" class="sqt-btn sqt-btn-secondary" onclick="cancelBuild()" id="cancelBtn" style="display: none;">
                                    <i class="bi bi-stop-fill"></i> Cancel
                                </button>
                                <button type="button" class="sqt-btn sqt-btn-secondary" onclick="inspectAPI()" id="inspectBtn">
                                    <i class="bi bi-bug"></i> Inspect API
                                </button>
                            </div>

                            <!-- API Inspector Panel -->
                            <div id="inspectorPanel" style="display: none; margin-top: 20px;">
                                <div class="sqt-card-header" style="background: var(--sqt-bg-secondary); margin: -20px -20px 16px -20px; padding: 12px 16px;">
                                    <h3 style="font-size: 14px; margin: 0;"><i class="bi bi-bug"></i> API Response Inspector</h3>
                                </div>
                                <div style="margin-bottom: 12px;">
                                    <label style="font-size: 13px; margin-right: 8px;">Sample Table:</label>
                                    <select id="inspectTableSelect" style="padding: 6px 12px; border-radius: 4px; border: 1px solid var(--sqt-border); background: var(--sqt-bg-primary); color: var(--sqt-text-primary);">
                                        <option value="customer">Customer</option>
                                        <option value="transaction">Transaction</option>
                                        <option value="item">Item</option>
                                        <option value="employee">Employee</option>
                                        <option value="salesorder">Sales Order</option>
                                    </select>
                                    <button type="button" class="sqt-btn sqt-btn-sm sqt-btn-secondary" onclick="fetchInspectData()" style="margin-left: 8px;">
                                        <i class="bi bi-arrow-clockwise"></i> Fetch
                                    </button>
                                </div>
                                <pre id="inspectorOutput" style="background: var(--sqt-bg-tertiary); border: 1px solid var(--sqt-border); border-radius: 6px; padding: 16px; max-height: 400px; overflow: auto; font-size: 12px; white-space: pre-wrap; word-break: break-all;"></pre>
                            </div>
                        </div>
                    </div>

                    <!-- Export Options Card -->
                    <div class="sqt-card" id="exportCard">
                        <div class="sqt-card-header" style="display: flex; justify-content: space-between; align-items: center;">
                            <h2><i class="bi bi-download"></i> Export Schema</h2>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <button type="button" class="sqt-btn sqt-btn-sm sqt-btn-outline" onclick="toggleAdvancedExports()" id="toggleExportsBtn">
                                    <i class="bi bi-plus-circle"></i> Show All Formats
                                </button>
                                <button type="button" class="sqt-card-toggle" onclick="toggleCard('exportCard')" title="Toggle section">
                                    <i class="bi bi-chevron-up"></i>
                                </button>
                            </div>
                        </div>
                        <div class="sqt-card-body">
                            <div class="sqt-export-grid" id="exportGrid">
                                <div class="sqt-export-option disabled" onclick="exportJSON()" id="exportJSON">
                                    <i class="bi bi-filetype-json"></i>
                                    <h3>JSON Schema</h3>
                                    <p>Complete metadata structure</p>
                                </div>
                                <div class="sqt-export-option disabled" onclick="exportDDL('mysql')" id="exportMySQL">
                                    <i class="bi bi-database"></i>
                                    <h3>MySQL DDL</h3>
                                    <p>CREATE TABLE statements</p>
                                </div>
                                <div class="sqt-export-option disabled" onclick="exportDDL('postgresql')" id="exportPostgreSQL">
                                    <i class="bi bi-database"></i>
                                    <h3>PostgreSQL DDL</h3>
                                    <p>CREATE TABLE statements</p>
                                </div>
                                <div class="sqt-export-option disabled sqt-export-advanced" onclick="exportDDL('sqlite')" id="exportSQLite">
                                    <i class="bi bi-database"></i>
                                    <h3>SQLite DDL</h3>
                                    <p>CREATE TABLE statements</p>
                                </div>
                                <div class="sqt-export-option disabled sqt-export-advanced" onclick="exportDDL('sqlserver')" id="exportSQLServer">
                                    <i class="bi bi-database"></i>
                                    <h3>SQL Server DDL</h3>
                                    <p>CREATE TABLE statements</p>
                                </div>
                                <div class="sqt-export-option disabled" onclick="exportDDL('bigquery')" id="exportBigQuery">
                                    <i class="bi bi-cloud"></i>
                                    <h3>BigQuery DDL</h3>
                                    <p>Google BigQuery schema</p>
                                </div>
                                <div class="sqt-export-option disabled" onclick="exportDDL('snowflake')" id="exportSnowflake">
                                    <i class="bi bi-snow"></i>
                                    <h3>Snowflake DDL</h3>
                                    <p>Snowflake data warehouse</p>
                                </div>
                                <div class="sqt-export-option disabled sqt-export-advanced" onclick="exportDDL('redshift')" id="exportRedshift">
                                    <i class="bi bi-cloud"></i>
                                    <h3>Redshift DDL</h3>
                                    <p>Amazon Redshift warehouse</p>
                                </div>
                                <div class="sqt-export-option disabled sqt-export-advanced" onclick="exportDBTSchema()" id="exportDBT">
                                    <i class="bi bi-file-earmark-code"></i>
                                    <h3>dbt Schema</h3>
                                    <p>YAML for dbt sources</p>
                                </div>
                                <div class="sqt-export-option disabled sqt-export-advanced" onclick="exportAvroSchema()" id="exportAvro">
                                    <i class="bi bi-braces"></i>
                                    <h3>Apache Avro</h3>
                                    <p>Schema for Kafka streaming</p>
                                </div>
                                <div class="sqt-export-option disabled" onclick="exportMarkdownDocs()" id="exportMarkdown">
                                    <i class="bi bi-markdown"></i>
                                    <h3>Markdown Docs</h3>
                                    <p>Documentation for wikis</p>
                                </div>
                                <div class="sqt-export-option disabled sqt-export-advanced" onclick="exportDBML()" id="exportDBML">
                                    <i class="bi bi-diagram-3"></i>
                                    <h3>DBML</h3>
                                    <p>For dbdiagram.io ERD tool</p>
                                </div>
                                <div class="sqt-export-option disabled sqt-export-advanced" onclick="exportFullSchemaDOT()" id="exportDOTFull">
                                    <i class="bi bi-diagram-2"></i>
                                    <h3>Graphviz DOT</h3>
                                    <p>For OmniGraffle, Graphviz</p>
                                </div>
                                <div class="sqt-export-option disabled" onclick="showERDModal()" id="exportERD">
                                    <i class="bi bi-share"></i>
                                    <h3>View ERD</h3>
                                    <p>Interactive diagram viewer</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Schema Browser Card -->
                    <div class="sqt-card" id="browserCard" style="display: none;">
                        <div class="sqt-card-header">
                            <h2><i class="bi bi-search"></i> Browse Schema</h2>
                            <span id="browserInfo" style="font-size: 13px; color: var(--sqt-text-secondary);"></span>
                        </div>
                        <div class="sqt-card-body">
                            <div class="sqt-schema-browser">
                                <div class="sqt-table-list">
                                    <div class="sqt-table-list-header">
                                        <input type="text" id="tableSearch" placeholder="Search tables..." oninput="filterTables()">
                                    </div>
                                    <div class="sqt-table-list-content" id="tablesList"></div>
                                </div>
                                <div class="sqt-table-detail" id="tableDetail">
                                    <div class="sqt-empty-state">
                                        <i class="bi bi-table"></i>
                                        <p>Select a table to view its columns</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ERD Modal -->
            <div class="modal fade" id="erdModal" tabindex="-1">
                <div class="modal-dialog modal-xl modal-dialog-scrollable">
                    <div class="modal-content" style="height: 90vh;">
                        <div class="modal-header" style="background: var(--sqt-bg-secondary); border-bottom: 1px solid var(--sqt-border);">
                            <h5 class="modal-title" style="font-size: 18px; font-weight: 600;"><i class="bi bi-share me-2"></i>Entity Relationship Diagram</h5>
                            <div class="d-flex align-items-center gap-2">
                                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="toggleERDSidebar()" title="Toggle Options Panel">
                                    <i class="bi bi-layout-sidebar-inset" id="erdSidebarIcon"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="toggleERDMaximize()" title="Maximize">
                                    <i class="bi bi-arrows-fullscreen" id="erdMaximizeIcon"></i>
                                </button>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                        </div>
                        <div class="modal-body p-0" style="display: flex; overflow: hidden;">
                            <!-- Options Sidebar -->
                            <div id="erdSidebar" style="width: 280px; min-width: 280px; background: var(--sqt-bg-secondary); border-right: 1px solid var(--sqt-border); padding: 16px; overflow-y: auto;">
                                <h6 style="margin-bottom: 12px; font-weight: 600; font-size: 15px;">Scope</h6>
                                <div class="form-check mb-2">
                                    <input class="form-check-input" type="radio" name="erdScope" id="erdScopeAll" value="all" checked>
                                    <label class="form-check-label" for="erdScopeAll">All related tables</label>
                                </div>
                                <div class="form-check mb-2">
                                    <input class="form-check-input" type="radio" name="erdScope" id="erdScopeSelect" value="select">
                                    <label class="form-check-label" for="erdScopeSelect">Select tables</label>
                                </div>
                                <div class="form-check mb-3">
                                    <input class="form-check-input" type="radio" name="erdScope" id="erdScopeConnected" value="connected">
                                    <label class="form-check-label" for="erdScopeConnected">Connected subset</label>
                                </div>

                                <!-- Table selector (shown when "Select tables" chosen) -->
                                <div id="erdTableSelector" style="display: none; margin-bottom: 16px;">
                                    <div style="margin-bottom: 8px;">
                                        <input type="text" id="erdTableSearch" class="form-control form-control-sm" placeholder="Search tables..." autocomplete="off">
                                    </div>
                                    <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--sqt-border); border-radius: 4px; background: var(--sqt-bg-primary);">
                                        <div id="erdTableList"></div>
                                    </div>
                                    <div style="margin-top: 8px; font-size: 12px;">
                                        <a href="#" onclick="selectAllERDTables(); return false;">Select All</a> |
                                        <a href="#" onclick="clearERDTables(); return false;">Clear</a>
                                    </div>
                                </div>

                                <!-- Connected subset options (shown when "Connected subset" chosen) -->
                                <div id="erdConnectedOptions" style="display: none; margin-bottom: 16px;">
                                    <label class="form-label" style="font-size: 13px;">Start from table:</label>
                                    <select id="erdStartTable" class="form-select form-select-sm" style="margin-bottom: 8px;"></select>
                                    <label class="form-label" style="font-size: 13px;">Max hops:</label>
                                    <select id="erdMaxHops" class="form-select form-select-sm">
                                        <option value="1">1 hop</option>
                                        <option value="2" selected>2 hops</option>
                                        <option value="3">3 hops</option>
                                        <option value="4">4 hops</option>
                                    </select>
                                </div>

                                <hr style="border-color: var(--sqt-border);">

                                <h6 style="margin-bottom: 12px; font-weight: 600; font-size: 15px;">Display Options</h6>
                                <div class="form-check mb-2">
                                    <input class="form-check-input" type="checkbox" id="erdShowColumns">
                                    <label class="form-check-label" for="erdShowColumns">Show columns (PK/FK)</label>
                                </div>
                                <div class="form-check mb-3">
                                    <input class="form-check-input" type="checkbox" id="erdShowLabels" checked>
                                    <label class="form-check-label" for="erdShowLabels">Show relationship labels</label>
                                </div>

                                <hr style="border-color: var(--sqt-border);">

                                <h6 style="margin-bottom: 12px; font-weight: 600; font-size: 15px;">Layout & Style</h6>
                                <div class="mb-2">
                                    <label class="form-label" style="font-size: 13px;">Direction:</label>
                                    <select id="erdLayoutDirection" class="form-select form-select-sm">
                                        <option value="TB">Top to Bottom</option>
                                        <option value="LR">Left to Right</option>
                                        <option value="BT">Bottom to Top</option>
                                        <option value="RL">Right to Left</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label" style="font-size: 13px;">Style:</label>
                                    <select id="erdLook" class="form-select form-select-sm">
                                        <option value="classic">Classic</option>
                                        <option value="handDrawn">Hand Drawn</option>
                                    </select>
                                </div>

                                <button type="button" class="btn btn-primary w-100" onclick="generateERD()">
                                    <i class="bi bi-play-fill me-1"></i>Generate ERD
                                </button>

                                <div id="erdStats" style="margin-top: 16px; font-size: 12px; color: var(--sqt-text-secondary);"></div>
                            </div>

                            <!-- ERD Diagram Area -->
                            <div id="erdDiagramArea" style="flex: 1; overflow: auto; background: var(--sqt-bg-primary); position: relative;">
                                <!-- Zoom Controls -->
                                <div id="erdZoomControls" style="position: sticky; top: 0; left: 0; right: 0; z-index: 10; padding: 8px 16px; background: var(--sqt-bg-secondary); border-bottom: 1px solid var(--sqt-border); display: none;">
                                    <div class="d-flex align-items-center gap-2">
                                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="erdZoomOut()" title="Zoom Out">
                                            <i class="bi bi-zoom-out"></i>
                                        </button>
                                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="erdZoomReset()" title="Reset Zoom">
                                            <span id="erdZoomLevel" style="min-width: 45px; display: inline-block; text-align: center;">100%</span>
                                        </button>
                                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="erdZoomIn()" title="Zoom In">
                                            <i class="bi bi-zoom-in"></i>
                                        </button>
                                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="erdZoomFit()" title="Fit to View">
                                            <i class="bi bi-arrows-angle-contract"></i>
                                        </button>
                                        <span style="font-size: 12px; color: var(--sqt-text-secondary); margin-left: 8px;">
                                            <i class="bi bi-mouse me-1"></i>Scroll to pan, Ctrl+Scroll to zoom
                                        </span>
                                    </div>
                                </div>
                                <div id="erdDiagramWrapper" style="padding: 16px; transform-origin: top left;">
                                    <div id="erdDiagramContainer" style="display: inline-block;"></div>
                                </div>
                                <div id="erdEmptyState" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--sqt-text-secondary);">
                                    <i class="bi bi-share" style="font-size: 48px; margin-bottom: 16px;"></i>
                                    <p>Configure options and click "Generate ERD" to create the diagram</p>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer d-flex justify-content-between" style="background: var(--sqt-bg-secondary); border-top: 1px solid var(--sqt-border);">
                            <div>
                                <a href="https://mermaid.live" target="_blank" class="text-decoration-none" style="color: var(--sqt-text-secondary); font-size: 13px;">
                                    <i class="bi bi-box-arrow-up-right me-1"></i>Open in Mermaid Live Editor
                                </a>
                            </div>
                            <div class="d-flex gap-2">
                                <button type="button" class="btn btn-outline-secondary" onclick="copyMermaidCode()" id="btnCopyMermaid" disabled>
                                    <i class="bi bi-clipboard me-1"></i>Copy Mermaid Code
                                </button>
                                <button type="button" class="btn btn-outline-secondary" onclick="exportERDasSVG()" id="btnExportSVG" disabled>
                                    <i class="bi bi-filetype-svg me-1"></i>Download SVG
                                </button>
                                <button type="button" class="btn btn-outline-secondary" onclick="exportERDasPNG()" id="btnExportPNG" disabled>
                                    <i class="bi bi-filetype-png me-1"></i>Download PNG
                                </button>
                                <button type="button" class="btn btn-outline-secondary" onclick="exportERDasDOT()" id="btnExportDOT" disabled>
                                    <i class="bi bi-diagram-2 me-1"></i>Download DOT
                                </button>
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Toast Container -->
            <div class="sqt-toast-container" id="toastContainer"></div>

            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"><\/script>
            <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script>
            <script>
                // ===========================================
                // STATE & CONFIGURATION
                // ===========================================
                const DB_NAME = 'NetSuiteSchemaExplorer';
                const DB_VERSION = 1;
                const STORE_NAME = 'schema';
                const BATCH_SIZE = 10; // Process tables in batches
                const BATCH_DELAY = 100; // ms delay between batches

                let db = null;
                let schema = null;
                let selectedTable = null;
                let isBuilding = false;
                let cancelRequested = false;
                let theme = localStorage.getItem('sqt_theme') || 'light';

                // ===========================================
                // INITIALIZATION
                // ===========================================
                document.documentElement.setAttribute('data-bs-theme', theme);
                updateThemeIcon();
                restoreCardStates();
                initDB().then(() => loadStoredSchema());

                // ===========================================
                // INDEXEDDB FUNCTIONS
                // ===========================================
                function initDB() {
                    return new Promise((resolve, reject) => {
                        const request = indexedDB.open(DB_NAME, DB_VERSION);

                        request.onerror = () => reject(request.error);
                        request.onsuccess = () => {
                            db = request.result;
                            resolve(db);
                        };

                        request.onupgradeneeded = (event) => {
                            const database = event.target.result;
                            if (!database.objectStoreNames.contains(STORE_NAME)) {
                                database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                            }
                        };
                    });
                }

                function saveSchema(schemaData) {
                    return new Promise((resolve, reject) => {
                        const transaction = db.transaction([STORE_NAME], 'readwrite');
                        const store = transaction.objectStore(STORE_NAME);
                        const request = store.put({ id: 'current', ...schemaData });
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                }

                function loadStoredSchema() {
                    return new Promise((resolve, reject) => {
                        const transaction = db.transaction([STORE_NAME], 'readonly');
                        const store = transaction.objectStore(STORE_NAME);
                        const request = store.get('current');

                        request.onsuccess = () => {
                            if (request.result) {
                                schema = request.result;
                                updateUIWithSchema();
                            }
                            resolve(request.result);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                function clearStoredSchema() {
                    if (!confirm('Are you sure you want to clear the stored schema?')) return;

                    const transaction = db.transaction([STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    store.delete('current');

                    schema = null;
                    updateUIWithSchema();
                    showToast('success', 'Schema cleared');
                }

                // ===========================================
                // CARD TOGGLE (COLLAPSE/EXPAND)
                // ===========================================
                function toggleCard(cardId) {
                    const card = document.getElementById(cardId);
                    if (!card) return;

                    card.classList.toggle('collapsed');

                    // Save state to localStorage
                    const collapsedCards = JSON.parse(localStorage.getItem('sqt_schema_collapsed') || '{}');
                    collapsedCards[cardId] = card.classList.contains('collapsed');
                    localStorage.setItem('sqt_schema_collapsed', JSON.stringify(collapsedCards));
                }

                function restoreCardStates() {
                    const collapsedCards = JSON.parse(localStorage.getItem('sqt_schema_collapsed') || '{}');
                    for (const cardId in collapsedCards) {
                        if (collapsedCards[cardId]) {
                            const card = document.getElementById(cardId);
                            if (card) card.classList.add('collapsed');
                        }
                    }
                }

                // ===========================================
                // SCHEMA BUILDING
                // ===========================================
                async function buildSchema() {
                    if (isBuilding) return;

                    isBuilding = true;
                    cancelRequested = false;

                    // Update UI
                    document.getElementById('buildBtn').style.display = 'none';
                    document.getElementById('cancelBtn').style.display = 'inline-flex';
                    document.getElementById('progressSection').style.display = 'block';
                    document.getElementById('logPanel').innerHTML = '';

                    try {
                        // Step 1: Get all tables
                        log('Fetching table list...');
                        updateProgress(0, 'Fetching table list...');

                        const tablesResponse = await fetch('/app/recordscatalog/rcendpoint.nl?action=getRecordTypes&data=' +
                            encodeURIComponent(JSON.stringify({ structureType: 'FLAT' })));
                        const tablesData = await tablesResponse.json();
                        const tables = tablesData.data.sort((a, b) => a.label.localeCompare(b.label));

                        log(\`Found \${tables.length} tables\`);

                        // Diagnostic: Check for duplicate labels
                        const labelCounts = {};
                        tables.forEach(t => {
                            const label = t.label || '(no label)';
                            if (!labelCounts[label]) {
                                labelCounts[label] = [];
                            }
                            labelCounts[label].push(t.id);
                        });
                        const duplicateLabels = Object.entries(labelCounts).filter(([label, ids]) => ids.length > 1);
                        if (duplicateLabels.length > 0) {
                            log(\`Warning: Found \${duplicateLabels.length} labels shared by multiple tables:\`);
                            duplicateLabels.forEach(([label, ids]) => {
                                log(\`  "\${label}" is used by: \${ids.join(', ')}\`);
                            });
                        }

                        // Step 2: Process each table
                        const schemaData = {
                            version: '2026.1',
                            exportDate: new Date().toISOString(),
                            tableCount: tables.length,
                            columnCount: 0,
                            relationshipCount: 0,
                            tables: [],
                            relationships: []
                        };

                        // Track processed tables and discovered tables from relationships
                        const processedTableIds = new Set();
                        const discoveredTableIds = new Set();
                        let tablesToProcess = [...tables];
                        let totalProcessed = 0;

                        // Helper function to process a single table
                        async function processTable(tableId, tableLabel) {
                            if (processedTableIds.has(tableId)) return;
                            processedTableIds.add(tableId);

                            try {
                                const detailResponse = await fetch('/app/recordscatalog/rcendpoint.nl?action=getRecordTypeDetail&data=' +
                                    encodeURIComponent(JSON.stringify({ scriptId: tableId, detailType: 'SS_ANAL' })));
                                const detailData = await detailResponse.json();
                                const record = detailData.data;

                                const columns = (record.fields || [])
                                    .filter(f => f.isColumn)
                                    .map(f => ({
                                        id: f.id,
                                        label: f.label,
                                        dataType: f.dataType || 'VARCHAR'
                                    }));

                                schemaData.tables.push({
                                    id: tableId,
                                    label: tableLabel || record.label || tableId,
                                    columns: columns
                                });

                                schemaData.columnCount += columns.length;

                                // Extract relationships from joins array
                                const joins = record.joins || [];
                                joins.forEach(join => {
                                    // Only capture N:1 and 1:1 relationships (foreign keys)
                                    if ((join.cardinality === 'N:1' || join.cardinality === '1:1') &&
                                        join.sourceTargetType?.id && join.fieldId) {

                                        // Parse joinPairs to get the exact column mapping
                                        let fromColumn = join.fieldId;
                                        let toColumn = 'id';

                                        if (join.joinPairs && join.joinPairs.length > 0) {
                                            const pairLabel = join.joinPairs[0].label || '';
                                            // Format: "tableName.column = TargetTable.column"
                                            const match = pairLabel.match(/\\.([\\w]+)\\s*=\\s*[\\w]+\\.([\\w]+)/i);
                                            if (match) {
                                                fromColumn = match[1];
                                                toColumn = match[2];
                                            }
                                        }

                                        const toTableId = join.sourceTargetType.id.toLowerCase();
                                        schemaData.relationships.push({
                                            fromTable: tableId,
                                            fromColumn: fromColumn,
                                            toTable: toTableId,
                                            toColumn: toColumn,
                                            cardinality: join.cardinality,
                                            joinType: join.joinType || 'AUTOMATIC',
                                            label: join.label || ''
                                        });

                                        // Track discovered tables that weren't in the original list
                                        if (!processedTableIds.has(toTableId) && !discoveredTableIds.has(toTableId)) {
                                            discoveredTableIds.add(toTableId);
                                        }
                                    }
                                });

                                schemaData.relationshipCount = schemaData.relationships.length;

                            } catch (err) {
                                log(\`Error processing \${tableId}: \${err.message}\`, 'error');
                            }
                        }

                        // Phase 1: Process all tables from the initial list
                        for (let i = 0; i < tables.length; i++) {
                            if (cancelRequested) {
                                log('Build cancelled by user');
                                break;
                            }

                            const table = tables[i];
                            const progress = Math.round((i / tables.length) * 90); // Reserve 10% for discovered tables
                            updateProgress(progress, \`Processing: \${table.label} (\${i + 1}/\${tables.length})\`);

                            await processTable(table.id, table.label);
                            totalProcessed++;

                            // Small delay between requests to avoid overwhelming the server
                            if (totalProcessed % BATCH_SIZE === 0) {
                                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
                            }
                        }

                        // Phase 2+: Recursively process discovered tables until no new tables are found
                        let discoveryRound = 0;
                        while (!cancelRequested) {
                            const newTables = [...discoveredTableIds].filter(id => !processedTableIds.has(id));
                            if (newTables.length === 0) break;

                            discoveryRound++;
                            log(\`Discovery round \${discoveryRound}: Found \${newTables.length} additional tables from relationships\`);

                            for (let i = 0; i < newTables.length; i++) {
                                if (cancelRequested) break;

                                const tableId = newTables[i];
                                updateProgress(95, \`Discovery round \${discoveryRound}: \${tableId} (\${i + 1}/\${newTables.length})\`);

                                await processTable(tableId, null);
                                totalProcessed++;

                                if (totalProcessed % BATCH_SIZE === 0) {
                                    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
                                }
                            }

                            log(\`Discovery round \${discoveryRound}: Processed \${newTables.length} tables\`);
                        }

                        if (discoveryRound > 0) {
                            log(\`Completed \${discoveryRound} discovery round(s)\`);
                        }

                        // Update table count to reflect actual tables processed
                        schemaData.tableCount = schemaData.tables.length;

                        if (!cancelRequested) {
                            // Save to IndexedDB
                            log('Saving schema to local storage...');
                            await saveSchema(schemaData);
                            schema = schemaData;

                            updateProgress(100, 'Complete!');
                            document.getElementById('progressBar').classList.add('complete');
                            log(\`Schema built successfully: \${schemaData.tableCount} tables, \${schemaData.columnCount} columns, \${schemaData.relationshipCount} relationships\`);

                            // Diagnostic: Verify duplicate-label tables were all stored
                            if (duplicateLabels.length > 0) {
                                log('Verifying tables with duplicate labels were stored:');
                                duplicateLabels.forEach(([label, ids]) => {
                                    const storedIds = ids.filter(id => schemaData.tables.some(t => t.id === id));
                                    const missingIds = ids.filter(id => !schemaData.tables.some(t => t.id === id));
                                    if (missingIds.length > 0) {
                                        log(\`  "\${label}": MISSING: \${missingIds.join(', ')}\`, 'error');
                                    } else {
                                        log(\`  "\${label}": All \${storedIds.length} tables stored correctly\`);
                                    }
                                });
                            }

                            updateUIWithSchema();
                            showToast('success', 'Schema built successfully!');
                        }

                    } catch (err) {
                        log(\`Error: \${err.message}\`, 'error');
                        showToast('error', 'Failed to build schema: ' + err.message);
                    } finally {
                        isBuilding = false;
                        document.getElementById('buildBtn').style.display = 'inline-flex';
                        document.getElementById('cancelBtn').style.display = 'none';
                    }
                }

                function cancelBuild() {
                    cancelRequested = true;
                    log('Cancelling build...');
                }

                function updateProgress(percent, label) {
                    document.getElementById('progressBar').style.width = percent + '%';
                    document.getElementById('progressPercent').textContent = percent + '%';
                    document.getElementById('progressLabel').textContent = label;
                }

                function log(message, type = 'info') {
                    const panel = document.getElementById('logPanel');
                    const time = new Date().toLocaleTimeString();
                    const entry = document.createElement('div');
                    entry.className = 'sqt-log-entry' + (type === 'error' ? ' error' : '');
                    entry.innerHTML = \`<span class="time">\${time}</span>\${escapeHtml(message)}\`;
                    panel.appendChild(entry);
                    panel.scrollTop = panel.scrollHeight;
                }

                // ===========================================
                // UI UPDATE FUNCTIONS
                // ===========================================
                function updateUIWithSchema() {
                    const hasSchema = schema && schema.tables && schema.tables.length > 0;

                    // Update stats
                    if (hasSchema) {
                        document.getElementById('statTables').textContent = schema.tableCount.toLocaleString();
                        document.getElementById('statColumns').textContent = schema.columnCount.toLocaleString();
                        document.getElementById('statRelationships').textContent = (schema.relationshipCount || 0).toLocaleString();
                        document.getElementById('statSize').textContent = formatBytes(JSON.stringify(schema).length);
                        document.getElementById('statDate').textContent = new Date(schema.exportDate).toLocaleDateString();
                        document.getElementById('statsSection').style.display = 'flex';
                        document.getElementById('clearBtn').style.display = 'inline-flex';

                        // Update status
                        document.getElementById('statusMessage').className = 'sqt-status success';
                        document.getElementById('statusMessage').innerHTML = '<i class="bi bi-check-circle"></i><span>Schema loaded with ' +
                            schema.tableCount + ' tables, ' + schema.columnCount + ' columns, and ' +
                            (schema.relationshipCount || 0) + ' relationships.</span>';

                        // Enable export options
                        document.querySelectorAll('.sqt-export-option').forEach(el => el.classList.remove('disabled'));

                        // Show browser
                        document.getElementById('browserCard').style.display = 'block';
                        document.getElementById('browserInfo').textContent = schema.tableCount + ' tables';
                        renderTablesList(schema.tables);

                    } else {
                        document.getElementById('statsSection').style.display = 'none';
                        document.getElementById('clearBtn').style.display = 'none';
                        document.getElementById('browserCard').style.display = 'none';
                        document.querySelectorAll('.sqt-export-option').forEach(el => el.classList.add('disabled'));
                    }
                }

                // Fix for NetSuite Records Catalog API bug that returns malformed labels
                // like "[Missing Label:com.netledger.app.platform.records.assemblyitem.LotNumberedAssemblyItem]"
                function cleanTableLabel(label) {
                    if (label && label.indexOf('[Missing Label:') === 0) {
                        // Extract the part after "[Missing Label:" and before "]"
                        var inner = label.substring(15, label.length - 1);
                        // Split by "." and take the last element
                        var parts = inner.split('.');
                        return {
                            label: parts[parts.length - 1],
                            isDerived: true
                        };
                    }
                    return { label: label, isDerived: false };
                }

                function renderTablesList(tables) {
                    const container = document.getElementById('tablesList');
                    // Sort tables by cleaned label (so tables with fixed labels sort correctly)
                    var sortedTables = tables.slice().sort(function(a, b) {
                        var labelA = cleanTableLabel(a.label).label.toLowerCase();
                        var labelB = cleanTableLabel(b.label).label.toLowerCase();
                        return labelA.localeCompare(labelB);
                    });
                    container.innerHTML = sortedTables.map(t => {
                        var cleaned = cleanTableLabel(t.label);
                        var derivedIcon = cleaned.isDerived ? '<i class="bi bi-info-circle text-warning" title="Label derived from API metadata (NetSuite API bug)" style="margin-left: 4px; font-size: 11px;"></i>' : '';
                        return \`
                            <div class="sqt-table-item" onclick="selectTable('\${t.id}')">
                                <div class="sqt-table-item-label">\${escapeHtml(cleaned.label)}\${derivedIcon}</div>
                                <div class="sqt-table-item-id">\${escapeHtml(t.id)}</div>
                            </div>
                        \`;
                    }).join('');
                }

                function filterTables() {
                    const search = document.getElementById('tableSearch').value.toLowerCase();
                    const filtered = schema.tables.filter(t =>
                        t.label.toLowerCase().includes(search) ||
                        t.id.toLowerCase().includes(search)
                    );
                    renderTablesList(filtered);
                }

                function selectTable(tableId) {
                    const table = schema.tables.find(t => t.id === tableId);
                    if (!table) return;

                    // Store selected table for filtering
                    selectedTable = table;

                    // Update selection
                    document.querySelectorAll('.sqt-table-item').forEach(el => el.classList.remove('selected'));
                    event.currentTarget.classList.add('selected');

                    // Clean up label if it has the NetSuite API bug
                    var cleanedLabel = cleanTableLabel(table.label);
                    var derivedNote = cleanedLabel.isDerived ? '<span class="text-warning" style="font-size: 12px; margin-left: 8px;" title="Original label: ' + escapeHtml(table.label) + '"><i class="bi bi-info-circle"></i> Label derived from API</span>' : '';

                    // Show detail with column filter
                    const detail = document.getElementById('tableDetail');
                    detail.innerHTML = \`
                        <div class="sqt-table-detail-header">
                            <h3>\${escapeHtml(cleanedLabel.label)}\${derivedNote}</h3>
                            <code>\${escapeHtml(table.id)}</code>
                        </div>
                        <div class="sqt-column-filter">
                            <input type="text" id="columnSearch" placeholder="Filter columns..." oninput="filterColumns()">
                            <div class="sqt-column-filter-info" id="columnFilterInfo">
                                \${table.columns.length} columns
                            </div>
                        </div>
                        <div class="sqt-table-detail-content">
                            <table class="sqt-columns-table">
                                <thead>
                                    <tr>
                                        <th>Column Name</th>
                                        <th>Label</th>
                                        <th>Data Type</th>
                                    </tr>
                                </thead>
                                <tbody id="columnsBody">
                                </tbody>
                            </table>
                        </div>
                    \`;

                    // Render columns
                    renderColumnRows(table.columns, '');
                }

                function filterColumns() {
                    if (!selectedTable) return;
                    const searchTerm = document.getElementById('columnSearch').value.toLowerCase().trim();
                    const filtered = selectedTable.columns.filter(c => {
                        const colLabel = cleanTableLabel(c.label);
                        return c.id.toLowerCase().includes(searchTerm) ||
                               colLabel.label.toLowerCase().includes(searchTerm) ||
                               c.dataType.toLowerCase().includes(searchTerm);
                    });
                    renderColumnRows(filtered, searchTerm);
                }

                function renderColumnRows(columns, searchTerm) {
                    const tbody = document.getElementById('columnsBody');
                    if (!tbody) return;

                    tbody.innerHTML = columns.map(c => {
                        var colLabel = cleanTableLabel(c.label);
                        var colDerived = colLabel.isDerived ? ' <i class="bi bi-info-circle text-warning" title="Label derived from API metadata" style="font-size: 11px;"></i>' : '';

                        // Highlight matching text if searching
                        let idDisplay = escapeHtml(c.id);
                        let labelDisplay = escapeHtml(colLabel.label);
                        let typeDisplay = escapeHtml(c.dataType);

                        if (searchTerm) {
                            idDisplay = highlightMatch(c.id, searchTerm);
                            labelDisplay = highlightMatch(colLabel.label, searchTerm);
                            typeDisplay = highlightMatch(c.dataType, searchTerm);
                        }

                        return \`
                            <tr\${searchTerm ? ' class="sqt-highlight"' : ''}>
                                <td><code>\${idDisplay}</code></td>
                                <td>\${labelDisplay}\${colDerived}</td>
                                <td>\${typeDisplay}</td>
                            </tr>
                        \`;
                    }).join('');

                    // Update filter info
                    const info = document.getElementById('columnFilterInfo');
                    if (info && selectedTable) {
                        if (searchTerm) {
                            info.textContent = columns.length + ' of ' + selectedTable.columns.length + ' columns';
                        } else {
                            info.textContent = selectedTable.columns.length + ' columns';
                        }
                    }
                }

                function highlightMatch(text, searchTerm) {
                    if (!searchTerm) return escapeHtml(text);
                    const escaped = escapeHtml(text);
                    // Escape special regex characters in search term
                    // Using simple string replacement to avoid template literal issues
                    var escapedSearch = searchTerm
                        .split('').map(function(c) {
                            if ('.*+?^$|()[]{}\\\\'.indexOf(c) > -1) return '\\\\' + c;
                            return c;
                        }).join('');
                    var regex = new RegExp('(' + escapedSearch + ')', 'gi');
                    return escaped.replace(regex, '<mark style="background: #ffc107; padding: 0 2px; border-radius: 2px;">' + String.fromCharCode(36) + '1</mark>');
                }

                // ===========================================
                // EXPORT FORMAT TOGGLE
                // ===========================================
                let showAllExports = false;

                function toggleAdvancedExports() {
                    showAllExports = !showAllExports;
                    const grid = document.getElementById('exportGrid');
                    const btn = document.getElementById('toggleExportsBtn');

                    if (showAllExports) {
                        grid.classList.add('show-all');
                        btn.innerHTML = '<i class="bi bi-dash-circle"></i> Show Less';
                    } else {
                        grid.classList.remove('show-all');
                        btn.innerHTML = '<i class="bi bi-plus-circle"></i> Show All Formats';
                    }
                }

                // ===========================================
                // EXPORT FUNCTIONS
                // ===========================================
                function exportJSON() {
                    if (!schema) return;

                    const exportData = {
                        version: schema.version,
                        exportDate: new Date().toISOString(),
                        source: 'NetSuite Schema Explorer',
                        tableCount: schema.tableCount,
                        columnCount: schema.columnCount,
                        relationshipCount: schema.relationshipCount || 0,
                        tables: schema.tables,
                        relationships: schema.relationships || []
                    };

                    downloadFile(
                        JSON.stringify(exportData, null, 2),
                        'netsuite-schema.json',
                        'application/json'
                    );
                    showToast('success', 'JSON schema exported');
                }

                function exportDDL(dialect) {
                    if (!schema) return;

                    const ddl = generateDDL(schema.tables, dialect);
                    const filename = \`netsuite-schema-\${dialect}.sql\`;

                    downloadFile(ddl, filename, 'text/plain');
                    showToast('success', \`\${dialect.toUpperCase()} DDL exported\`);
                }

                function generateDDL(tables, dialect) {
                    const relationships = schema.relationships || [];
                    const tableIds = new Set(tables.map(t => t.id));

                    const lines = [
                        '-- NetSuite Schema DDL',
                        '-- Generated: ' + new Date().toISOString(),
                        '-- Dialect: ' + dialect.toUpperCase(),
                        '-- Tables: ' + tables.length,
                        '-- Relationships: ' + relationships.length,
                        '',
                        ''
                    ];

                    tables.forEach(table => {
                        // Check if table has columns - if not, comment it out
                        if (!table.columns || table.columns.length === 0) {
                            lines.push(\`-- Table: \${table.label}\`);
                            lines.push(\`-- NOTE: This table appears in the API but has no queryable columns.\`);
                            lines.push(\`-- It may be a system table, deprecated, or not accessible via SuiteQL.\`);
                            lines.push(\`-- CREATE TABLE \${quoteIdentifier(table.id, dialect)} ();\`);
                            lines.push('');
                            return;
                        }

                        lines.push(\`-- Table: \${table.label}\`);
                        lines.push(\`CREATE TABLE \${quoteIdentifier(table.id, dialect)} (\`);

                        const columnDefs = table.columns.map(col => {
                            // Force 'id' column to INT since NetSuite IDs are always integers
                            // This also ensures it can be used as a PRIMARY KEY
                            let sqlType;
                            if (col.id.toLowerCase() === 'id') {
                                sqlType = dialect === 'sqlserver' ? 'INT' : 'INT';
                            } else {
                                sqlType = mapDataType(col.dataType, dialect);
                            }
                            return \`    \${quoteIdentifier(col.id, dialect)} \${sqlType}\`;
                        });

                        // Check if table has an 'id' column to use as primary key
                        const hasIdColumn = table.columns.some(col => col.id.toLowerCase() === 'id');

                        if (hasIdColumn) {
                            lines.push(columnDefs.join(',\\n') + ',');
                            lines.push(\`    PRIMARY KEY (\${quoteIdentifier('id', dialect)})\`);
                        } else {
                            lines.push(columnDefs.join(',\\n'));
                        }
                        lines.push(');');
                        lines.push('');
                    });

                    // Add FOREIGN KEY constraints at the end (only for relationships where both tables exist)
                    const validRelationships = relationships.filter(rel =>
                        tableIds.has(rel.fromTable) && tableIds.has(rel.toTable)
                    );

                    if (validRelationships.length > 0) {
                        lines.push('');
                        lines.push('-- ===========================================');
                        lines.push('-- FOREIGN KEY CONSTRAINTS');
                        lines.push('-- ===========================================');
                        lines.push('');

                        validRelationships.forEach((rel, idx) => {
                            // Include target table in constraint name to handle polymorphic relationships
                            const constraintName = \`fk_\${rel.fromTable}_\${rel.fromColumn}_\${rel.toTable}\`.substring(0, 63);
                            if (dialect === 'mysql') {
                                lines.push(\`ALTER TABLE \${quoteIdentifier(rel.fromTable, dialect)}\`);
                                lines.push(\`    ADD CONSTRAINT \${quoteIdentifier(constraintName, dialect)}\`);
                                lines.push(\`    FOREIGN KEY (\${quoteIdentifier(rel.fromColumn, dialect)})\`);
                                lines.push(\`    REFERENCES \${quoteIdentifier(rel.toTable, dialect)}(\${quoteIdentifier(rel.toColumn, dialect)});\`);
                            } else if (dialect === 'postgresql') {
                                lines.push(\`ALTER TABLE \${quoteIdentifier(rel.fromTable, dialect)}\`);
                                lines.push(\`    ADD CONSTRAINT \${quoteIdentifier(constraintName, dialect)}\`);
                                lines.push(\`    FOREIGN KEY (\${quoteIdentifier(rel.fromColumn, dialect)})\`);
                                lines.push(\`    REFERENCES \${quoteIdentifier(rel.toTable, dialect)}(\${quoteIdentifier(rel.toColumn, dialect)});\`);
                            } else if (dialect === 'sqlserver') {
                                lines.push(\`ALTER TABLE \${quoteIdentifier(rel.fromTable, dialect)}\`);
                                lines.push(\`    ADD CONSTRAINT \${quoteIdentifier(constraintName, dialect)}\`);
                                lines.push(\`    FOREIGN KEY (\${quoteIdentifier(rel.fromColumn, dialect)})\`);
                                lines.push(\`    REFERENCES \${quoteIdentifier(rel.toTable, dialect)}(\${quoteIdentifier(rel.toColumn, dialect)});\`);
                            } else if (dialect === 'bigquery' || dialect === 'snowflake' || dialect === 'redshift') {
                                // BigQuery, Snowflake, and Redshift don't enforce foreign keys, but we document the relationship as a comment
                                lines.push(\`-- \${rel.fromTable}.\${rel.fromColumn} -> \${rel.toTable}.\${rel.toColumn}\`);
                            }
                            // SQLite doesn't support ALTER TABLE ADD CONSTRAINT, FKs must be in CREATE TABLE
                            lines.push('');
                        });
                    }

                    return lines.join('\\n');
                }

                function mapDataType(nsType, dialect) {
                    // Note: MySQL has a 65535 byte row size limit. Using TEXT for ALL string
                    // types avoids this limit since TEXT is stored off-row in InnoDB.
                    const typeMap = {
                        mysql: {
                            // Numeric types
                            'INTEGER': 'INT',
                            'FLOAT': 'DECIMAL(18,2)',
                            'CURRENCY': 'DECIMAL(18,2)',
                            'PERCENT': 'DECIMAL(5,2)',
                            'SELECT': 'INT',
                            // Boolean
                            'CHECKBOX': 'TINYINT(1)',
                            // Date/Time
                            'DATE': 'DATE',
                            'DATETIME': 'DATETIME',
                            'DATETIMETZ': 'DATETIME',
                            'TIME': 'TIME',
                            'TIMEOFDAY': 'TIME',
                            // ALL string types use TEXT to avoid row size limit
                            'VARCHAR': 'TEXT',
                            'TEXT': 'TEXT',
                            'CLOBTEXT': 'TEXT',
                            'TEXTAREA': 'TEXT',
                            'RICHTEXT': 'TEXT',
                            'INLINEHTML': 'TEXT',
                            'EMAIL': 'TEXT',
                            'PHONE': 'TEXT',
                            'URL': 'TEXT',
                            'ADDRESS': 'TEXT',
                            'IDENTIFIER': 'TEXT',
                            'MULTISELECT': 'TEXT',
                            'IMAGE': 'TEXT',
                            'DOCUMENT': 'TEXT',
                            'default': 'TEXT'
                        },
                        postgresql: {
                            'INTEGER': 'INTEGER',
                            'FLOAT': 'NUMERIC(18,2)',
                            'CHECKBOX': 'BOOLEAN',
                            'DATE': 'DATE',
                            'DATETIME': 'TIMESTAMP',
                            'VARCHAR': 'VARCHAR(255)',
                            'TEXT': 'TEXT',
                            'CURRENCY': 'NUMERIC(18,2)',
                            'PERCENT': 'NUMERIC(5,2)',
                            'EMAIL': 'VARCHAR(255)',
                            'PHONE': 'VARCHAR(50)',
                            'URL': 'VARCHAR(1000)',
                            'SELECT': 'INTEGER',
                            'MULTISELECT': 'TEXT',
                            'default': 'VARCHAR(255)'
                        },
                        sqlite: {
                            'INTEGER': 'INTEGER',
                            'FLOAT': 'REAL',
                            'CHECKBOX': 'INTEGER',
                            'DATE': 'TEXT',
                            'DATETIME': 'TEXT',
                            'VARCHAR': 'TEXT',
                            'TEXT': 'TEXT',
                            'CURRENCY': 'REAL',
                            'PERCENT': 'REAL',
                            'EMAIL': 'TEXT',
                            'PHONE': 'TEXT',
                            'URL': 'TEXT',
                            'SELECT': 'INTEGER',
                            'MULTISELECT': 'TEXT',
                            'default': 'TEXT'
                        },
                        sqlserver: {
                            'INTEGER': 'INT',
                            'FLOAT': 'DECIMAL(18,2)',
                            'CHECKBOX': 'BIT',
                            'DATE': 'DATE',
                            'DATETIME': 'DATETIME2',
                            'VARCHAR': 'NVARCHAR(255)',
                            'TEXT': 'NVARCHAR(MAX)',
                            'CURRENCY': 'DECIMAL(18,2)',
                            'PERCENT': 'DECIMAL(5,2)',
                            'EMAIL': 'NVARCHAR(255)',
                            'PHONE': 'NVARCHAR(50)',
                            'URL': 'NVARCHAR(1000)',
                            'SELECT': 'INT',
                            'MULTISELECT': 'NVARCHAR(MAX)',
                            'default': 'NVARCHAR(255)'
                        },
                        bigquery: {
                            // Numeric types
                            'INTEGER': 'INT64',
                            'FLOAT': 'FLOAT64',
                            'CURRENCY': 'NUMERIC',
                            'PERCENT': 'FLOAT64',
                            'SELECT': 'INT64',
                            // Boolean
                            'CHECKBOX': 'BOOL',
                            // Date/Time
                            'DATE': 'DATE',
                            'DATETIME': 'DATETIME',
                            'DATETIMETZ': 'TIMESTAMP',
                            'TIME': 'TIME',
                            'TIMEOFDAY': 'TIME',
                            // String types
                            'VARCHAR': 'STRING',
                            'TEXT': 'STRING',
                            'CLOBTEXT': 'STRING',
                            'TEXTAREA': 'STRING',
                            'RICHTEXT': 'STRING',
                            'INLINEHTML': 'STRING',
                            'EMAIL': 'STRING',
                            'PHONE': 'STRING',
                            'URL': 'STRING',
                            'ADDRESS': 'STRING',
                            'IDENTIFIER': 'STRING',
                            'MULTISELECT': 'STRING',
                            'IMAGE': 'STRING',
                            'DOCUMENT': 'STRING',
                            'default': 'STRING'
                        },
                        snowflake: {
                            // Numeric types
                            'INTEGER': 'INTEGER',
                            'FLOAT': 'FLOAT',
                            'CURRENCY': 'NUMBER(18,2)',
                            'PERCENT': 'NUMBER(5,2)',
                            'SELECT': 'INTEGER',
                            // Boolean
                            'CHECKBOX': 'BOOLEAN',
                            // Date/Time
                            'DATE': 'DATE',
                            'DATETIME': 'TIMESTAMP_NTZ',
                            'DATETIMETZ': 'TIMESTAMP_LTZ',
                            'TIME': 'TIME',
                            'TIMEOFDAY': 'TIME',
                            // String types
                            'VARCHAR': 'VARCHAR',
                            'TEXT': 'TEXT',
                            'CLOBTEXT': 'TEXT',
                            'TEXTAREA': 'TEXT',
                            'RICHTEXT': 'TEXT',
                            'INLINEHTML': 'TEXT',
                            'EMAIL': 'VARCHAR(255)',
                            'PHONE': 'VARCHAR(50)',
                            'URL': 'VARCHAR(2000)',
                            'ADDRESS': 'TEXT',
                            'IDENTIFIER': 'VARCHAR(255)',
                            'MULTISELECT': 'TEXT',
                            'IMAGE': 'VARCHAR(255)',
                            'DOCUMENT': 'VARCHAR(255)',
                            'default': 'VARCHAR'
                        },
                        redshift: {
                            // Numeric types
                            'INTEGER': 'INTEGER',
                            'FLOAT': 'DOUBLE PRECISION',
                            'CURRENCY': 'DECIMAL(18,2)',
                            'PERCENT': 'DECIMAL(5,2)',
                            'SELECT': 'INTEGER',
                            // Boolean
                            'CHECKBOX': 'BOOLEAN',
                            // Date/Time
                            'DATE': 'DATE',
                            'DATETIME': 'TIMESTAMP',
                            'DATETIMETZ': 'TIMESTAMPTZ',
                            'TIME': 'TIME',
                            'TIMEOFDAY': 'TIME',
                            // String types - Redshift VARCHAR max is 65535
                            'VARCHAR': 'VARCHAR(256)',
                            'TEXT': 'VARCHAR(MAX)',
                            'CLOBTEXT': 'VARCHAR(MAX)',
                            'TEXTAREA': 'VARCHAR(MAX)',
                            'RICHTEXT': 'VARCHAR(MAX)',
                            'INLINEHTML': 'VARCHAR(MAX)',
                            'EMAIL': 'VARCHAR(255)',
                            'PHONE': 'VARCHAR(50)',
                            'URL': 'VARCHAR(2000)',
                            'ADDRESS': 'VARCHAR(MAX)',
                            'IDENTIFIER': 'VARCHAR(255)',
                            'MULTISELECT': 'VARCHAR(MAX)',
                            'IMAGE': 'VARCHAR(255)',
                            'DOCUMENT': 'VARCHAR(255)',
                            'default': 'VARCHAR(256)'
                        }
                    };

                    const map = typeMap[dialect] || typeMap.mysql;
                    return map[nsType.toUpperCase()] || map['default'];
                }

                function quoteIdentifier(name, dialect) {
                    if (dialect === 'mysql' || dialect === 'bigquery') return \`\\\`\${name}\\\`\`;
                    if (dialect === 'sqlserver') return \`[\${name}]\`;
                    return \`"\${name}"\`;
                }

                function exportDBML() {
                    if (!schema) return;

                    const relationships = schema.relationships || [];
                    const tableIds = new Set(schema.tables.map(t => t.id));

                    const lines = [
                        '// NetSuite Schema DBML',
                        '// Generated: ' + new Date().toISOString(),
                        '// Tables: ' + schema.tables.length,
                        '// Relationships: ' + relationships.length,
                        '// Use at https://dbdiagram.io',
                        '',
                        ''
                    ];

                    schema.tables.forEach(table => {
                        // Skip tables with no columns (comment them out)
                        if (!table.columns || table.columns.length === 0) {
                            lines.push(\`// Table \${table.id} - No queryable columns (may be system/deprecated table)\`);
                            lines.push('');
                            return;
                        }

                        lines.push(\`Table \${table.id} {\`);
                        table.columns.forEach(col => {
                            const dbmlType = mapDataType(col.dataType, 'postgresql').toLowerCase();
                            lines.push(\`  \${col.id} \${dbmlType} [note: '\${escapeHtml(col.label)}']\`);
                        });
                        lines.push('}');
                        lines.push('');
                    });

                    // Add relationships as Ref: statements
                    const validRelationships = relationships.filter(rel =>
                        tableIds.has(rel.fromTable) && tableIds.has(rel.toTable)
                    );

                    if (validRelationships.length > 0) {
                        lines.push('// ===========================================');
                        lines.push('// RELATIONSHIPS');
                        lines.push('// ===========================================');
                        lines.push('');

                        validRelationships.forEach(rel => {
                            // DBML uses > for many-to-one, < for one-to-many, - for one-to-one
                            let refType = '>';  // Default: many-to-one
                            if (rel.cardinality === '1:1') refType = '-';

                            lines.push(\`Ref: \${rel.fromTable}.\${rel.fromColumn} \${refType} \${rel.toTable}.\${rel.toColumn}\`);
                        });
                        lines.push('');
                    }

                    downloadFile(lines.join('\\n'), 'netsuite-schema.dbml', 'text/plain');
                    showToast('success', 'DBML schema exported');
                }

                function exportDBTSchema() {
                    if (!schema) return;

                    const lines = [
                        '# NetSuite Schema for dbt',
                        '# Generated: ' + new Date().toISOString(),
                        '# Tables: ' + schema.tables.length,
                        '# Documentation: https://docs.getdbt.com/docs/build/sources',
                        '',
                        'version: 2',
                        '',
                        'sources:',
                        '  - name: netsuite',
                        '    description: NetSuite ERP data',
                        '    tables:'
                    ];

                    schema.tables.forEach(table => {
                        // Skip tables with no columns
                        if (!table.columns || table.columns.length === 0) {
                            return;
                        }

                        // Escape special YAML characters in strings
                        const escapeYaml = (str) => {
                            if (!str) return '';
                            // If string contains special chars, wrap in quotes
                            if (/[:\\n"']/.test(str) || str.includes('#')) {
                                return '"' + str.replace(/"/g, '\\\\"') + '"';
                            }
                            return str;
                        };

                        lines.push(\`      - name: \${table.id}\`);
                        lines.push(\`        description: \${escapeYaml(table.label)}\`);
                        lines.push('        columns:');

                        table.columns.forEach(col => {
                            lines.push(\`          - name: \${col.id}\`);
                            const colDesc = col.label + ' (' + col.dataType + ')';
                            lines.push(\`            description: \${escapeYaml(colDesc)}\`);

                            // Add tests for id columns
                            if (col.id.toLowerCase() === 'id') {
                                lines.push('            tests:');
                                lines.push('              - unique');
                                lines.push('              - not_null');
                            }
                        });
                    });

                    downloadFile(lines.join('\\n'), 'netsuite_sources.yml', 'text/yaml');
                    showToast('success', 'dbt schema exported');
                }

                function exportAvroSchema() {
                    if (!schema) return;

                    // Map NetSuite types to Avro types
                    const mapToAvro = (nsType) => {
                        const typeMap = {
                            'INTEGER': 'long',
                            'FLOAT': 'double',
                            'CURRENCY': 'double',
                            'PERCENT': 'double',
                            'CHECKBOX': 'boolean',
                            'DATE': { type: 'int', logicalType: 'date' },
                            'DATETIME': { type: 'long', logicalType: 'timestamp-millis' },
                            'DATETIMETZ': { type: 'long', logicalType: 'timestamp-millis' },
                            'TIME': { type: 'int', logicalType: 'time-millis' },
                            'TIMEOFDAY': { type: 'int', logicalType: 'time-millis' },
                            'SELECT': 'long'
                        };
                        return typeMap[nsType.toUpperCase()] || 'string';
                    };

                    const avroSchemas = schema.tables
                        .filter(table => table.columns && table.columns.length > 0)
                        .map(table => {
                            return {
                                type: 'record',
                                name: table.id,
                                namespace: 'com.netsuite',
                                doc: table.label || table.id,
                                fields: table.columns.map(col => {
                                    const avroType = mapToAvro(col.dataType);
                                    return {
                                        name: col.id,
                                        type: ['null', avroType],
                                        default: null,
                                        doc: col.label + ' (' + col.dataType + ')'
                                    };
                                })
                            };
                        });

                    const output = {
                        schemas: avroSchemas,
                        metadata: {
                            generated: new Date().toISOString(),
                            source: 'NetSuite SuiteQL Query Tool',
                            tableCount: avroSchemas.length
                        }
                    };

                    downloadFile(JSON.stringify(output, null, 2), 'netsuite-avro-schemas.json', 'application/json');
                    showToast('success', 'Avro schema exported (' + avroSchemas.length + ' tables)');
                }

                function exportMarkdownDocs() {
                    if (!schema) return;

                    const relationships = schema.relationships || [];
                    const lines = [
                        '# NetSuite Database Schema',
                        '',
                        '> Generated: ' + new Date().toISOString(),
                        '>',
                        '> Tables: ' + schema.tables.length + ' | Relationships: ' + relationships.length,
                        '',
                        '---',
                        '',
                        '## Table of Contents',
                        ''
                    ];

                    // Build TOC
                    const validTables = schema.tables.filter(t => t.columns && t.columns.length > 0);
                    validTables.forEach(table => {
                        const anchor = table.id.toLowerCase().replace(/[^a-z0-9]/g, '-');
                        lines.push(\`- [\${table.id}](#\${anchor}) - \${table.label || ''}\`);
                    });

                    lines.push('');
                    lines.push('---');
                    lines.push('');

                    // Build table documentation
                    validTables.forEach(table => {
                        lines.push(\`## \${table.id}\`);
                        lines.push('');
                        if (table.label && table.label !== table.id) {
                            lines.push(\`**\${table.label}**\`);
                            lines.push('');
                        }

                        // Find relationships for this table
                        const tableRels = relationships.filter(r => r.fromTable === table.id || r.toTable === table.id);
                        if (tableRels.length > 0) {
                            lines.push('**Relationships:**');
                            tableRels.forEach(rel => {
                                if (rel.fromTable === table.id) {
                                    lines.push(\`- \${rel.fromColumn} \u2192 \${rel.toTable}.\${rel.toColumn}\`);
                                } else {
                                    lines.push(\`- \${rel.fromTable}.\${rel.fromColumn} \u2192 \${rel.toColumn}\`);
                                }
                            });
                            lines.push('');
                        }

                        lines.push('| Column | Type | Description |');
                        lines.push('|--------|------|-------------|');

                        table.columns.forEach(col => {
                            const desc = (col.label || '').replace(/\\|/g, '\\\\|');
                            lines.push(\`| \${col.id} | \${col.dataType} | \${desc} |\`);
                        });

                        lines.push('');
                        lines.push('---');
                        lines.push('');
                    });

                    downloadFile(lines.join('\\n'), 'netsuite-schema.md', 'text/markdown');
                    showToast('success', 'Markdown documentation exported');
                }

                function exportFullSchemaDOT() {
                    if (!schema) return;

                    const relationships = schema.relationships || [];
                    const tableIds = new Set(schema.tables.map(t => t.id));

                    // Sanitize table names for DOT format
                    const sanitizeName = (name) => name.replace(/[^a-zA-Z0-9_]/g, '_');

                    const lines = [
                        '// NetSuite Schema - Graphviz DOT Format',
                        '// Generated: ' + new Date().toISOString(),
                        '// Tables: ' + schema.tables.length,
                        '// Relationships: ' + relationships.length,
                        '// Open in OmniGraffle, Graphviz, or other DOT-compatible tools',
                        '',
                        'digraph NetSuiteSchema {',
                        '    // Graph settings',
                        '    rankdir=TB;',
                        '    splines=ortho;',
                        '    nodesep=0.8;',
                        '    ranksep=1.0;',
                        '    concentrate=true;',
                        '',
                        '    // Node defaults',
                        '    node [shape=box, style="filled,rounded", fillcolor="#e8f4fc", color="#4a90d9", fontname="Helvetica", fontsize=10];',
                        '',
                        '    // Edge defaults',
                        '    edge [color="#666666", arrowhead=normal, fontname="Helvetica", fontsize=8];',
                        ''
                    ];

                    // Add all tables as nodes
                    lines.push('    // Tables');
                    schema.tables.forEach(table => {
                        const safeName = sanitizeName(table.id);
                        // Use table ID as label (could also use table.label but ID is more useful for queries)
                        lines.push(\`    \${safeName} [label="\${table.id}"];\`);
                    });
                    lines.push('');

                    // Add relationships as edges
                    const validRelationships = relationships.filter(rel =>
                        tableIds.has(rel.fromTable) && tableIds.has(rel.toTable)
                    );

                    if (validRelationships.length > 0) {
                        lines.push('    // Relationships');
                        validRelationships.forEach(rel => {
                            const fromTable = sanitizeName(rel.fromTable);
                            const toTable = sanitizeName(rel.toTable);
                            const edgeLabel = rel.fromColumn;
                            // Use different arrow styles for different cardinalities
                            const arrowhead = rel.cardinality === '1:1' ? 'none' : 'normal';
                            const arrowtail = rel.cardinality === '1:1' ? 'none' : 'odot';
                            lines.push(\`    \${fromTable} -> \${toTable} [label="\${edgeLabel}", arrowhead=\${arrowhead}, arrowtail=\${arrowtail}, dir=both];\`);
                        });
                    }

                    lines.push('}');

                    downloadFile(lines.join('\\n'), 'netsuite-schema.dot', 'text/vnd.graphviz');
                    showToast('success', 'Graphviz DOT file exported (' + schema.tables.length + ' tables, ' + validRelationships.length + ' relationships)');
                }

                // ===========================================
                // ERD GENERATION
                // ===========================================

                // ERD Configuration - Modify these values to customize ERD behavior
                const ERD_CONFIG = {
                    // Mermaid rendering limits
                    maxTextSize: 500000,           // Max characters in diagram (default: 50000)

                    // Layout options
                    layoutDirection: 'TB',         // TB (top-bottom), BT, LR (left-right), RL
                    minEntityWidth: 100,           // Minimum table box width in pixels
                    minEntityHeight: 75,           // Minimum table box height in pixels
                    entityPadding: 15,             // Padding inside table boxes
                    diagramPadding: 20,            // Padding around entire diagram

                    // Appearance
                    fontSize: 14,                  // Base font size for labels
                    useMaxWidth: false,            // Scale diagram to container width
                    wrap: true,                    // Enable text wrapping in labels
                    htmlLabels: true,              // Use HTML for label rendering (better quality)

                    // Visual style: 'classic' or 'handDrawn' (sketchy/whiteboard look)
                    look: 'classic',

                    // Themes: 'default', 'dark', 'forest', 'neutral', 'base'
                    // Note: Theme is auto-selected based on Schema Explorer dark/light mode
                    lightTheme: 'default',
                    darkTheme: 'dark',

                    // Custom theme colors (optional - set to null to use theme defaults)
                    // These override the selected theme's colors
                    themeVariables: null,
                    // Example custom theme:
                    // themeVariables: {
                    //     primaryColor: '#4a90d9',        // Entity background
                    //     primaryTextColor: '#ffffff',    // Entity text
                    //     primaryBorderColor: '#2d6cb5',  // Entity border
                    //     lineColor: '#666666',           // Relationship lines
                    //     textColor: '#333333'            // General text
                    // },

                    // Line/curve style for relationships
                    // Options: 'basis', 'bumpX', 'bumpY', 'cardinal', 'catmullRom',
                    //          'linear', 'monotoneX', 'monotoneY', 'natural', 'step',
                    //          'stepAfter', 'stepBefore'
                    curve: 'basis',

                    // Performance warnings
                    warnTableCount: 50,            // Warn when tables exceed this count
                    warnRelationshipCount: 100,    // Warn when relationships exceed this count

                    // Default zoom level (0.1 to 5, where 1 = 100%)
                    defaultZoomLevel: 0.8,         // 80% zoom by default

                    // Security: 'strict', 'loose', 'antiscript', 'sandbox'
                    // 'loose' allows click handlers on nodes (not used currently)
                    securityLevel: 'loose',

                    // Suppress error diagram rendering (show custom error instead)
                    suppressErrorRendering: true
                };

                let currentMermaidCode = '';
                let currentERDTables = [];
                let currentERDRelationships = [];
                let erdSelectedTables = new Set();
                let erdSidebarVisible = true;
                let erdMaximized = false;
                let erdZoomScale = ERD_CONFIG.defaultZoomLevel;

                function showERDModal() {
                    if (!schema) {
                        showToast('warning', 'Please build the schema first');
                        return;
                    }

                    // Build Mermaid configuration from ERD_CONFIG
                    const mermaidConfig = {
                        startOnLoad: false,
                        theme: theme === 'dark' ? ERD_CONFIG.darkTheme : ERD_CONFIG.lightTheme,
                        look: ERD_CONFIG.look,
                        er: {
                            layoutDirection: ERD_CONFIG.layoutDirection,
                            minEntityWidth: ERD_CONFIG.minEntityWidth,
                            minEntityHeight: ERD_CONFIG.minEntityHeight,
                            entityPadding: ERD_CONFIG.entityPadding,
                            diagramPadding: ERD_CONFIG.diagramPadding,
                            useMaxWidth: ERD_CONFIG.useMaxWidth
                        },
                        fontSize: ERD_CONFIG.fontSize,
                        htmlLabels: ERD_CONFIG.htmlLabels,
                        wrap: ERD_CONFIG.wrap,
                        flowchart: {
                            curve: ERD_CONFIG.curve
                        },
                        securityLevel: ERD_CONFIG.securityLevel,
                        maxTextSize: ERD_CONFIG.maxTextSize,
                        suppressErrorRendering: ERD_CONFIG.suppressErrorRendering
                    };

                    // Add custom theme variables if defined
                    if (ERD_CONFIG.themeVariables) {
                        mermaidConfig.themeVariables = ERD_CONFIG.themeVariables;
                    }

                    mermaid.initialize(mermaidConfig);

                    // Populate table list for selection
                    populateERDTableList();
                    populateERDStartTable();

                    // Reset state
                    currentMermaidCode = '';
                    document.getElementById('erdDiagramContainer').innerHTML = '';
                    document.getElementById('erdEmptyState').style.display = 'flex';
                    document.getElementById('btnCopyMermaid').disabled = true;
                    document.getElementById('btnExportSVG').disabled = true;
                    document.getElementById('btnExportPNG').disabled = true;
                    document.getElementById('btnExportDOT').disabled = true;
                    document.getElementById('erdStats').innerHTML = '';

                    // Reset sidebar and maximize state
                    erdSidebarVisible = true;
                    erdMaximized = false;
                    document.getElementById('erdSidebar').style.display = 'block';
                    document.getElementById('erdSidebarIcon').className = 'bi bi-layout-sidebar-inset';
                    const modalDialog = document.querySelector('#erdModal .modal-dialog');
                    const modalContent = document.querySelector('#erdModal .modal-content');
                    modalDialog.classList.remove('modal-fullscreen');
                    modalDialog.classList.add('modal-xl');
                    modalContent.style.height = '90vh';
                    document.getElementById('erdMaximizeIcon').className = 'bi bi-arrows-fullscreen';

                    // Reset zoom state to default
                    erdZoomScale = ERD_CONFIG.defaultZoomLevel;
                    document.getElementById('erdZoomControls').style.display = 'none';
                    document.getElementById('erdDiagramWrapper').style.transform = 'scale(' + ERD_CONFIG.defaultZoomLevel + ')';
                    document.getElementById('erdZoomLevel').textContent = Math.round(ERD_CONFIG.defaultZoomLevel * 100) + '%';

                    // Set layout/style defaults from config
                    document.getElementById('erdLayoutDirection').value = ERD_CONFIG.layoutDirection;
                    document.getElementById('erdLook').value = ERD_CONFIG.look;

                    // Initialize zoom wheel handler (only once)
                    if (!document.getElementById('erdDiagramArea').dataset.zoomInit) {
                        initERDZoomWheel();
                        document.getElementById('erdDiagramArea').dataset.zoomInit = 'true';
                    }

                    // Setup scope radio button handlers
                    document.querySelectorAll('input[name="erdScope"]').forEach(radio => {
                        radio.addEventListener('change', onERDScopeChange);
                    });
                    onERDScopeChange();

                    const modal = new bootstrap.Modal(document.getElementById('erdModal'));
                    modal.show();
                }

                function toggleERDSidebar() {
                    const sidebar = document.getElementById('erdSidebar');
                    const icon = document.getElementById('erdSidebarIcon');
                    erdSidebarVisible = !erdSidebarVisible;

                    if (erdSidebarVisible) {
                        sidebar.style.display = 'block';
                        icon.className = 'bi bi-layout-sidebar-inset';
                    } else {
                        sidebar.style.display = 'none';
                        icon.className = 'bi bi-layout-sidebar-inset-reverse';
                    }
                }

                function toggleERDMaximize() {
                    const modalDialog = document.querySelector('#erdModal .modal-dialog');
                    const modalContent = document.querySelector('#erdModal .modal-content');
                    const icon = document.getElementById('erdMaximizeIcon');
                    erdMaximized = !erdMaximized;

                    if (erdMaximized) {
                        modalDialog.classList.remove('modal-xl');
                        modalDialog.classList.add('modal-fullscreen');
                        modalContent.style.height = '100vh';
                        icon.className = 'bi bi-fullscreen-exit';
                    } else {
                        modalDialog.classList.remove('modal-fullscreen');
                        modalDialog.classList.add('modal-xl');
                        modalContent.style.height = '90vh';
                        icon.className = 'bi bi-arrows-fullscreen';
                    }
                }

                // ERD Zoom Functions
                function updateERDZoom() {
                    const wrapper = document.getElementById('erdDiagramWrapper');
                    wrapper.style.transform = \`scale(\${erdZoomScale})\`;
                    document.getElementById('erdZoomLevel').textContent = Math.round(erdZoomScale * 100) + '%';
                }

                function erdZoomIn() {
                    erdZoomScale = Math.min(erdZoomScale * 1.25, 5);
                    updateERDZoom();
                }

                function erdZoomOut() {
                    erdZoomScale = Math.max(erdZoomScale / 1.25, 0.1);
                    updateERDZoom();
                }

                function erdZoomReset() {
                    erdZoomScale = 1;
                    updateERDZoom();
                }

                function erdZoomFit() {
                    const container = document.getElementById('erdDiagramArea');
                    const wrapper = document.getElementById('erdDiagramWrapper');
                    const svg = wrapper.querySelector('svg');
                    if (!svg) return;

                    // Reset scale to measure actual size
                    wrapper.style.transform = 'scale(1)';

                    const containerWidth = container.clientWidth - 32; // Account for padding
                    const containerHeight = container.clientHeight - 60; // Account for zoom controls
                    const svgWidth = svg.getBoundingClientRect().width;
                    const svgHeight = svg.getBoundingClientRect().height;

                    const scaleX = containerWidth / svgWidth;
                    const scaleY = containerHeight / svgHeight;
                    erdZoomScale = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%

                    updateERDZoom();
                }

                function initERDZoomWheel() {
                    const diagramArea = document.getElementById('erdDiagramArea');
                    diagramArea.addEventListener('wheel', function(e) {
                        if (e.ctrlKey) {
                            e.preventDefault();
                            if (e.deltaY < 0) {
                                erdZoomScale = Math.min(erdZoomScale * 1.1, 5);
                            } else {
                                erdZoomScale = Math.max(erdZoomScale / 1.1, 0.1);
                            }
                            updateERDZoom();
                        }
                    }, { passive: false });
                }

                function onERDScopeChange() {
                    const scope = document.querySelector('input[name="erdScope"]:checked').value;
                    document.getElementById('erdTableSelector').style.display = scope === 'select' ? 'block' : 'none';
                    document.getElementById('erdConnectedOptions').style.display = scope === 'connected' ? 'block' : 'none';
                }

                function populateERDTableList() {
                    if (!schema) return;
                    const container = document.getElementById('erdTableList');
                    const tablesWithRelationships = getTablesWithRelationships()
                        .sort((a, b) => a.id.localeCompare(b.id));

                    erdSelectedTables.clear();

                    // Build HTML - escape special characters in table IDs
                    const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

                    container.innerHTML = tablesWithRelationships.map((table, index) => \`
                        <div class="erd-table-row d-flex align-items-center" data-index="\${index}"
                             style="padding: 8px 10px; border-bottom: 1px solid var(--sqt-border); cursor: pointer; gap: 10px;">
                            <input class="erd-table-checkbox" type="checkbox" value="\${escapeHtml(table.id)}"
                                style="width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;">
                            <span style="font-size: 13px;">\${escapeHtml(table.id)}</span>
                        </div>
                    \`).join('');

                    // Store table IDs in array for reference by index
                    const tableIds = tablesWithRelationships.map(t => t.id);

                    // Add click handlers to each row
                    container.querySelectorAll('.erd-table-row').forEach(function(row) {
                        const checkbox = row.querySelector('.erd-table-checkbox');
                        const index = parseInt(row.dataset.index, 10);
                        const tableId = tableIds[index];

                        // Highlight on hover
                        row.onmouseenter = function() { row.style.background = 'var(--sqt-bg-tertiary)'; };
                        row.onmouseleave = function() { row.style.background = ''; };

                        // Click row to toggle
                        row.onclick = function(e) {
                            if (e.target !== checkbox) {
                                checkbox.checked = !checkbox.checked;
                            }
                            if (checkbox.checked) {
                                erdSelectedTables.add(tableId);
                            } else {
                                erdSelectedTables.delete(tableId);
                            }
                        };
                    });

                    // Setup search filter
                    var searchInput = document.getElementById('erdTableSearch');
                    console.log('ERD Search: Setting up search input, element found:', !!searchInput);

                    if (searchInput) {
                        searchInput.value = '';

                        var doSearch = function(eventType) {
                            console.log('ERD Search: doSearch called via', eventType, 'search value:', searchInput.value);
                            var searchText = searchInput.value.toLowerCase();
                            var rows = document.querySelectorAll('#erdTableList .erd-table-row');
                            console.log('ERD Search: Found', rows.length, 'rows to filter');
                            var visibleCount = 0;
                            for (var i = 0; i < rows.length; i++) {
                                var row = rows[i];
                                var text = row.textContent.toLowerCase();
                                if (text.indexOf(searchText) !== -1) {
                                    row.style.setProperty('display', 'flex', 'important');
                                    row.removeAttribute('hidden');
                                    visibleCount++;
                                } else {
                                    row.style.setProperty('display', 'none', 'important');
                                    row.setAttribute('hidden', '');
                                }
                            }
                            console.log('ERD Search: Showing', visibleCount, 'of', rows.length, 'rows');
                            // Debug: check if first hidden row actually has display:none
                            var hiddenRow = document.querySelector('#erdTableList .erd-table-row[hidden]');
                            if (hiddenRow) {
                                var computedStyle = window.getComputedStyle(hiddenRow);
                                console.log('ERD Search: First hidden row computed display:', computedStyle.display);
                            }
                        };

                        // Multiple event handlers for better compatibility
                        searchInput.oninput = function() { doSearch('oninput'); };
                        searchInput.onkeyup = function() { doSearch('onkeyup'); };
                        searchInput.onchange = function() { doSearch('onchange'); };

                        // Prevent Enter from doing anything unexpected
                        searchInput.onkeydown = function(e) {
                            console.log('ERD Search: onkeydown, key:', e.key, 'keyCode:', e.keyCode);
                            if (e.keyCode === 13 || e.key === 'Enter') {
                                e.preventDefault();
                                doSearch('onkeydown-enter');
                                return false;
                            }
                        };

                        console.log('ERD Search: All event handlers attached');
                    }
                }

                function populateERDStartTable() {
                    if (!schema) return;
                    const select = document.getElementById('erdStartTable');
                    const tablesWithRelationships = getTablesWithRelationships()
                        .sort((a, b) => a.id.localeCompare(b.id));

                    select.innerHTML = tablesWithRelationships.map(table =>
                        \`<option value="\${table.id}">\${table.id}</option>\`
                    ).join('');
                }

                function getTablesWithRelationships() {
                    if (!schema) return [];
                    const relationships = schema.relationships || [];
                    const tablesInRels = new Set();
                    relationships.forEach(rel => {
                        tablesInRels.add(rel.fromTable);
                        tablesInRels.add(rel.toTable);
                    });
                    return schema.tables.filter(t => tablesInRels.has(t.id));
                }

                function selectAllERDTables() {
                    document.querySelectorAll('.erd-table-checkbox').forEach(cb => {
                        cb.checked = true;
                        erdSelectedTables.add(cb.value);
                    });
                }

                function clearERDTables() {
                    document.querySelectorAll('.erd-table-checkbox').forEach(cb => {
                        cb.checked = false;
                    });
                    erdSelectedTables.clear();
                }

                function addSuggestedERDTables() {
                    if (!window.erdSuggestedTables) return;

                    // Add suggested tables to selection
                    window.erdSuggestedTables.forEach(function(tableId) {
                        erdSelectedTables.add(tableId);
                    });

                    // Update checkboxes to reflect new selection
                    document.querySelectorAll('.erd-table-checkbox').forEach(function(cb) {
                        if (window.erdSuggestedTables.has(cb.value)) {
                            cb.checked = true;
                        }
                    });

                    // Clear suggestions and regenerate
                    window.erdSuggestedTables = null;
                    generateERD();
                }

                function generateERDAnywayWithoutRelationships() {
                    // Set a flag to skip the relationship check
                    window.erdSkipRelationshipCheck = true;
                    generateERD();
                    window.erdSkipRelationshipCheck = false;
                }

                function getConnectedTables(startTable, maxHops) {
                    if (!schema) return new Set();
                    const relationships = schema.relationships || [];
                    const connected = new Set([startTable]);
                    let frontier = new Set([startTable]);

                    for (let hop = 0; hop < maxHops; hop++) {
                        const newFrontier = new Set();
                        relationships.forEach(rel => {
                            if (frontier.has(rel.fromTable) && !connected.has(rel.toTable)) {
                                newFrontier.add(rel.toTable);
                                connected.add(rel.toTable);
                            }
                            if (frontier.has(rel.toTable) && !connected.has(rel.fromTable)) {
                                newFrontier.add(rel.fromTable);
                                connected.add(rel.fromTable);
                            }
                        });
                        frontier = newFrontier;
                        if (frontier.size === 0) break;
                    }

                    return connected;
                }

                function generateMermaidERD(tables, relationships, options) {
                    const lines = ['erDiagram'];
                    const tableSet = new Set(tables.map(t => t.id));
                    const showColumns = options.showColumns || false;
                    const showLabels = options.showLabels !== false;

                    // Filter relationships to only include selected tables
                    const validRels = relationships.filter(rel =>
                        tableSet.has(rel.fromTable) && tableSet.has(rel.toTable)
                    );

                    // Add tables with columns if requested
                    if (showColumns) {
                        tables.forEach(table => {
                            const cols = table.columns || [];
                            const pkCols = cols.filter(c => c.id === 'id' || c.id === 'internalid');
                            const fkCols = cols.filter(c => {
                                return validRels.some(r => r.fromTable === table.id && r.fromColumn === c.id);
                            });
                            const displayCols = [...new Set([...pkCols, ...fkCols])];

                            if (displayCols.length > 0) {
                                lines.push(\`    \${sanitizeTableName(table.id)} {\`);
                                displayCols.forEach(col => {
                                    const isPK = col.id === 'id' || col.id === 'internalid';
                                    const isFK = fkCols.includes(col);
                                    const marker = isPK ? 'PK' : (isFK ? 'FK' : '');
                                    lines.push(\`        \${mapMermaidType(col.dataType)} \${col.id} \${marker}\`.trim());
                                });
                                lines.push('    }');
                            }
                        });
                    }

                    // Add relationships
                    validRels.forEach(rel => {
                        const fromTable = sanitizeTableName(rel.fromTable);
                        const toTable = sanitizeTableName(rel.toTable);
                        const relSymbol = rel.cardinality === '1:1' ? '||--||' : '}o--||';
                        const label = showLabels ? \` : "\${rel.fromColumn}"\` : ' : ""';
                        lines.push(\`    \${fromTable} \${relSymbol} \${toTable}\${label}\`);
                    });

                    return lines.join('\\n');
                }

                function sanitizeTableName(name) {
                    // Mermaid doesn't like certain characters in entity names
                    return name.replace(/[^a-zA-Z0-9_]/g, '_');
                }

                function mapMermaidType(dataType) {
                    const type = (dataType || 'string').toUpperCase();
                    if (type.includes('INT')) return 'int';
                    if (type.includes('FLOAT') || type.includes('DECIMAL') || type.includes('NUMBER')) return 'float';
                    if (type.includes('BOOL')) return 'boolean';
                    if (type.includes('DATE') || type.includes('TIME')) return 'datetime';
                    return 'string';
                }

                async function generateERD() {
                    try {
                        if (!schema) return;

                        const scope = document.querySelector('input[name="erdScope"]:checked').value;
                        const showColumns = document.getElementById('erdShowColumns').checked;
                        const showLabels = document.getElementById('erdShowLabels').checked;

                        let selectedTables = [];
                        const relationships = schema.relationships || [];

                        if (scope === 'all') {
                            selectedTables = getTablesWithRelationships();
                        } else if (scope === 'select') {
                            if (erdSelectedTables.size === 0) {
                                showToast('warning', 'Please select at least one table');
                                return;
                            }
                            selectedTables = schema.tables.filter(t => erdSelectedTables.has(t.id));
                        } else if (scope === 'connected') {
                            const startTable = document.getElementById('erdStartTable').value;
                            const maxHops = parseInt(document.getElementById('erdMaxHops').value);
                            const connectedSet = getConnectedTables(startTable, maxHops);
                            selectedTables = schema.tables.filter(t => connectedSet.has(t.id));
                        }

                        if (selectedTables.length === 0) {
                            showToast('warning', 'No tables selected for ERD');
                            return;
                        }

                        // Count relationships for selected tables
                        const tableSet = new Set(selectedTables.map(t => t.id));
                        const relCount = relationships.filter(r =>
                            tableSet.has(r.fromTable) && tableSet.has(r.toTable)
                        ).length;

                        // Check for no relationships in 'select' scope and suggest related tables
                        if (scope === 'select' && relCount === 0 && selectedTables.length > 1 && !window.erdSkipRelationshipCheck) {
                            // Find tables that would connect the selected tables
                            const suggestedTables = new Set();
                            relationships.forEach(r => {
                                if (tableSet.has(r.fromTable) && !tableSet.has(r.toTable)) {
                                    suggestedTables.add(r.toTable);
                                }
                                if (tableSet.has(r.toTable) && !tableSet.has(r.fromTable)) {
                                    suggestedTables.add(r.fromTable);
                                }
                            });

                            if (suggestedTables.size > 0) {
                                const suggestions = Array.from(suggestedTables).slice(0, 5).join(', ');
                                const more = suggestedTables.size > 5 ? \` and \${suggestedTables.size - 5} more\` : '';

                                // Store suggestions for adding later
                                window.erdSuggestedTables = suggestedTables;

                                document.getElementById('erdEmptyState').style.display = 'none';
                                document.getElementById('erdDiagramContainer').innerHTML = \`
                                    <div style="padding: 20px; text-align: center;">
                                        <i class="bi bi-info-circle" style="font-size: 48px; color: var(--sqt-warning); margin-bottom: 16px;"></i>
                                        <h5>No Relationships Found</h5>
                                        <p style="color: var(--sqt-text-secondary); margin-bottom: 16px;">
                                            The selected tables don't have direct relationships between them.
                                        </p>
                                        <p style="margin-bottom: 16px;">
                                            <strong>Suggested tables to add:</strong><br>
                                            <span style="color: var(--sqt-text-secondary);">\${suggestions}\${more}</span>
                                        </p>
                                        <button type="button" class="btn btn-primary" onclick="addSuggestedERDTables()">
                                            <i class="bi bi-plus-circle me-1"></i>Add Suggested Tables
                                        </button>
                                        <button type="button" class="btn btn-outline-secondary ms-2" onclick="generateERDAnywayWithoutRelationships()">
                                            Generate Anyway
                                        </button>
                                    </div>
                                \`;
                                return;
                            }
                        }

                        // Warn if diagram is very large
                        if (selectedTables.length > ERD_CONFIG.warnTableCount || relCount > ERD_CONFIG.warnRelationshipCount) {
                            showToast('warning', \`Large diagram: \${selectedTables.length} tables, \${relCount} relationships. Rendering may be slow.\`);
                        }

                        // Show loading state
                        document.getElementById('erdEmptyState').style.display = 'none';
                        document.getElementById('erdZoomControls').style.display = 'none';
                        const container = document.getElementById('erdDiagramContainer');
                        container.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="bi bi-hourglass-split me-2"></i>Generating diagram...</div>';

                        // Get user-selected layout options
                        const userLayoutDirection = document.getElementById('erdLayoutDirection').value;
                        const userLook = document.getElementById('erdLook').value;

                        // Re-initialize Mermaid with user-selected options
                        const mermaidConfig = {
                            startOnLoad: false,
                            theme: theme === 'dark' ? ERD_CONFIG.darkTheme : ERD_CONFIG.lightTheme,
                            look: userLook,
                            er: {
                                layoutDirection: userLayoutDirection,
                                minEntityWidth: ERD_CONFIG.minEntityWidth,
                                minEntityHeight: ERD_CONFIG.minEntityHeight,
                                entityPadding: ERD_CONFIG.entityPadding,
                                diagramPadding: ERD_CONFIG.diagramPadding,
                                useMaxWidth: ERD_CONFIG.useMaxWidth
                            },
                            fontSize: ERD_CONFIG.fontSize,
                            htmlLabels: ERD_CONFIG.htmlLabels,
                            wrap: ERD_CONFIG.wrap,
                            flowchart: { curve: ERD_CONFIG.curve },
                            securityLevel: ERD_CONFIG.securityLevel,
                            maxTextSize: ERD_CONFIG.maxTextSize,
                            suppressErrorRendering: ERD_CONFIG.suppressErrorRendering
                        };
                        if (ERD_CONFIG.themeVariables) {
                            mermaidConfig.themeVariables = ERD_CONFIG.themeVariables;
                        }
                        mermaid.initialize(mermaidConfig);

                        // Store current ERD data for export
                        currentERDTables = selectedTables;
                        currentERDRelationships = relationships.filter(r =>
                            tableSet.has(r.fromTable) && tableSet.has(r.toTable)
                        );

                        // Generate Mermaid code
                        currentMermaidCode = generateMermaidERD(selectedTables, relationships, {
                            showColumns: showColumns,
                            showLabels: showLabels
                        });

                        // Use setTimeout to allow UI to update before heavy rendering
                        await new Promise(resolve => setTimeout(resolve, 50));

                        const { svg } = await mermaid.render('erdSvg', currentMermaidCode);
                        container.innerHTML = svg;

                        // Show zoom controls and set default zoom
                        erdZoomScale = ERD_CONFIG.defaultZoomLevel;
                        document.getElementById('erdZoomControls').style.display = 'block';
                        document.getElementById('erdDiagramWrapper').style.transform = 'scale(' + ERD_CONFIG.defaultZoomLevel + ')';
                        document.getElementById('erdZoomLevel').textContent = Math.round(ERD_CONFIG.defaultZoomLevel * 100) + '%';

                        // Enable export buttons
                        document.getElementById('btnCopyMermaid').disabled = false;
                        document.getElementById('btnExportSVG').disabled = false;
                        document.getElementById('btnExportPNG').disabled = false;
                        document.getElementById('btnExportDOT').disabled = false;

                        // Update stats
                        document.getElementById('erdStats').innerHTML = \`
                            <strong>Generated:</strong><br>
                            \${selectedTables.length} tables<br>
                            \${relCount} relationships
                        \`;

                    } catch (err) {
                        console.error('ERD generation error:', err);
                        document.getElementById('erdDiagramContainer').innerHTML = \`
                            <div style="color: var(--sqt-danger); padding: 20px;">
                                <i class="bi bi-exclamation-triangle"></i> Error rendering diagram<br>
                                <small>\${err.message || 'Unknown error'}</small>
                            </div>
                        \`;
                        // Re-enable buttons so user can try copying mermaid code
                        if (currentMermaidCode) {
                            document.getElementById('btnCopyMermaid').disabled = false;
                        }
                    }
                }

                function copyMermaidCode() {
                    if (!currentMermaidCode) return;
                    navigator.clipboard.writeText(currentMermaidCode).then(() => {
                        showToast('success', 'Mermaid code copied to clipboard');
                    }).catch(() => {
                        showToast('error', 'Failed to copy to clipboard');
                    });
                }

                function exportERDasSVG() {
                    const svg = document.querySelector('#erdDiagramContainer svg');
                    if (!svg) return;

                    const svgData = new XMLSerializer().serializeToString(svg);
                    const blob = new Blob([svgData], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(blob);

                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'netsuite-erd.svg';
                    a.click();
                    URL.revokeObjectURL(url);

                    showToast('success', 'SVG downloaded');
                }

                function exportERDasPNG() {
                    const svg = document.querySelector('#erdDiagramContainer svg');
                    if (!svg) return;

                    const svgData = new XMLSerializer().serializeToString(svg);
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const img = new Image();

                    img.onload = function() {
                        canvas.width = img.width * 2;  // 2x for better quality
                        canvas.height = img.height * 2;
                        ctx.scale(2, 2);
                        ctx.fillStyle = theme === 'dark' ? '#1a1d21' : '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, 0);

                        canvas.toBlob(function(blob) {
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'netsuite-erd.png';
                            a.click();
                            URL.revokeObjectURL(url);
                            showToast('success', 'PNG downloaded');
                        }, 'image/png');
                    };

                    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                }

                function exportERDasDOT() {
                    if (currentERDTables.length === 0) return;

                    const lines = [
                        'digraph ERD {',
                        '    // Graph settings',
                        '    rankdir=TB;',
                        '    splines=ortho;',
                        '    nodesep=0.8;',
                        '    ranksep=1.0;',
                        '',
                        '    // Node styling',
                        '    node [',
                        '        shape=box,',
                        '        style="filled,rounded",',
                        '        fillcolor="#e8f4fc",',
                        '        color="#4a90d9",',
                        '        fontname="Helvetica",',
                        '        fontsize=12,',
                        '        margin="0.3,0.2"',
                        '    ];',
                        '',
                        '    // Edge styling',
                        '    edge [',
                        '        color="#666666",',
                        '        fontname="Helvetica",',
                        '        fontsize=10,',
                        '        arrowhead=normal',
                        '    ];',
                        '',
                        '    // Tables'
                    ];

                    // Add table nodes
                    currentERDTables.forEach(function(table) {
                        const safeName = table.id.replace(/[^a-zA-Z0-9_]/g, '_');
                        lines.push('    ' + safeName + ' [label="' + table.id + '"];');
                    });

                    lines.push('');
                    lines.push('    // Relationships');

                    // Add relationships
                    currentERDRelationships.forEach(function(rel) {
                        const fromTable = rel.fromTable.replace(/[^a-zA-Z0-9_]/g, '_');
                        const toTable = rel.toTable.replace(/[^a-zA-Z0-9_]/g, '_');
                        const label = rel.fromColumn || '';
                        const cardinality = rel.cardinality === '1:1' ? '1:1' : 'N:1';
                        lines.push('    ' + fromTable + ' -> ' + toTable + ' [label="' + label + ' (' + cardinality + ')"];');
                    });

                    lines.push('}');

                    const dotContent = lines.join('\\n');
                    const blob = new Blob([dotContent], { type: 'text/vnd.graphviz' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'netsuite-erd.dot';
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast('success', 'DOT file downloaded - open in OmniGraffle or Graphviz');
                }

                // ===========================================
                // API INSPECTOR (DEBUG)
                // ===========================================
                function inspectAPI() {
                    const panel = document.getElementById('inspectorPanel');
                    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                    if (panel.style.display === 'block') {
                        fetchInspectData();
                    }
                }

                async function fetchInspectData() {
                    const tableId = document.getElementById('inspectTableSelect').value;
                    const output = document.getElementById('inspectorOutput');
                    output.textContent = 'Fetching data for ' + tableId + '...';

                    try {
                        const response = await fetch('/app/recordscatalog/rcendpoint.nl?action=getRecordTypeDetail&data=' +
                            encodeURIComponent(JSON.stringify({ scriptId: tableId, detailType: 'SS_ANAL' })));
                        const data = await response.json();
                        const record = data.data;

                        // Build a summary of what's available
                        const summary = {
                            '_SUMMARY': {
                                tableId: tableId,
                                label: record.label,
                                totalFields: record.fields?.length || 0,
                                columnFields: record.fields?.filter(f => f.isColumn)?.length || 0,
                                joins: record.joins?.length || 0,
                                availableProperties: Object.keys(record)
                            },
                            '_SAMPLE_FIELD': record.fields?.[0] || 'No fields',
                            '_FIELD_PROPERTIES': record.fields?.[0] ? Object.keys(record.fields[0]) : [],
                            '_SAMPLE_JOIN': record.joins?.[0] || 'No joins',
                            '_JOIN_PROPERTIES': record.joins?.[0] ? Object.keys(record.joins[0]) : [],
                            '_SELECT_TYPE_FIELDS': record.fields?.filter(f => f.dataType === 'SELECT' || f.dataType === 'MULTISELECT')?.slice(0, 3) || [],
                            '_FULL_RESPONSE': record
                        };

                        output.textContent = JSON.stringify(summary, null, 2);
                    } catch (err) {
                        output.textContent = 'Error: ' + err.message;
                    }
                }

                // ===========================================
                // UTILITY FUNCTIONS
                // ===========================================
                function downloadFile(content, filename, mimeType) {
                    const blob = new Blob([content], { type: mimeType });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }

                function formatBytes(bytes) {
                    if (bytes < 1024) return bytes + ' B';
                    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
                }

                function escapeHtml(text) {
                    const div = document.createElement('div');
                    div.textContent = text;
                    return div.innerHTML;
                }

                function showToast(type, message) {
                    const container = document.getElementById('toastContainer');
                    const toast = document.createElement('div');
                    toast.className = \`sqt-toast \${type}\`;
                    toast.innerHTML = \`<strong>\${type.charAt(0).toUpperCase() + type.slice(1)}</strong><div>\${escapeHtml(message)}</div>\`;
                    container.appendChild(toast);
                    setTimeout(() => toast.remove(), 4000);
                }

                // ===========================================
                // THEME & FOCUS MODE
                // ===========================================
                function toggleTheme() {
                    theme = theme === 'light' ? 'dark' : 'light';
                    document.documentElement.setAttribute('data-bs-theme', theme);
                    localStorage.setItem('sqt_theme', theme);
                    updateThemeIcon();
                }

                function updateThemeIcon() {
                    document.getElementById('themeIcon').className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
                }

                let focusMode = false;
                function toggleFocusMode() {
                    focusMode = !focusMode;
                    document.getElementById('app').classList.toggle('sqt-focus-mode', focusMode);
                    document.getElementById('focusModeIcon').className = focusMode ? 'bi bi-fullscreen-exit' : 'bi bi-arrows-fullscreen';
                }

                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && focusMode) toggleFocusMode();
                });
            <\/script>
        </body>
        </html>
    `;
}
