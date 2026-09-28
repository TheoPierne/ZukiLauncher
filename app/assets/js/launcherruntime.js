'use strict'
/**
 * LauncherRuntime
 *
 * Reads the runtime information passed by the main process to the main window
 * through webPreferences.additionalArguments (see createWindow in index.js).
 * Replaces the synchronous @electron/remote calls previously used by the
 * renderer to read the app version and the userData path.
 *
 * @module launcherruntime
 */

const RUNTIME_ARGUMENT = '--launcher-runtime='

function readRuntime() {
    const arg = process.argv.find(value => value.startsWith(RUNTIME_ARGUMENT))
    if (arg == null) {
        return null
    }

    try {
        return JSON.parse(Buffer.from(arg.slice(RUNTIME_ARGUMENT.length), 'base64url').toString('utf-8'))
    } catch {
        return null
    }
}

const runtime = readRuntime()

/**
 * @returns {string} The launcher version (same value as app.getVersion()).
 */
exports.getVersion = function() {
    return runtime?.version ?? require('../../../package.json').version
}

/**
 * @returns {string | null} The application's userData path, or null if the
 * runtime information is unavailable.
 */
exports.getUserDataPath = function() {
    return runtime?.paths?.userData ?? null
}
