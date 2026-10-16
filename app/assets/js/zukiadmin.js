'use strict'

const crypto = require('crypto')
const http = require('http')
const https = require('https')
const os = require('os')
const { LoggerUtil } = require('helios-core')
const { machineId } = require('node-machine-id')

const isDev = require('./isdev')

const logger = LoggerUtil.getLogger('ZukiAdmin')

// Client of the ZukiAdmin backend (separate Laravel project).
// A Microsoft account proves who it is with the Mojang session mechanism used
// by Minecraft servers in online mode: the backend hands out a single-use code,
// the launcher "joins" it on Mojang's session server with the player's token,
// then the backend asks Mojang which account joined it. The Minecraft token is
// only ever sent to Mojang.
// Free (unofficial) accounts cannot be verified: the backend marks their logs
// as unverified.
// The game start log is also how bans are enforced: the backend answers 403
// for a banned account, name or machine (hwid). Any other answer, error or delay
// lets the game start, so that an outage of the site blocks nobody. Another
// launcher bypasses this check: the real barrier will be the Minecraft server.

// In development, nothing is sent unless ZUKI_ADMIN_URL points to a backend,
// for example http://localhost:8000/api.
const API_URL = isDev ? process.env.ZUKI_ADMIN_URL ?? null : 'https://zukipalace.theopierne.fr/api'
const MOJANG_JOIN_URL = 'https://sessionserver.mojang.com/session/minecraft/join'

const TIMEOUT = 10000
// After this delay, the game starts without waiting for the backend.
const GAME_START_DEADLINE = 8000
const MAX_RESPONSE_SIZE = 64 * 1024
// Limits accepted by the backend.
const MAX_LIST_LENGTH = 200
const MAX_NAME_LENGTH = 100
// A session token is renewed shortly before it expires.
const TOKEN_RENEWAL_MARGIN = 60 * 1000
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/**
 * Send a JSON request with Node's http modules, like helios-core: it does not
 * depend on the page CSP or on CORS headers.
 *
 * @param {string} method The HTTP method.
 * @param {string} url The URL: HTTPS, or HTTP for a local backend only.
 * @param {Object} options
 * @param {Object} [options.body] The JSON body.
 * @param {string} [options.token] A ZukiAdmin session token.
 * @returns {Promise<{status: number, data: any}>} The status and the parsed JSON body.
 */
function requestJson(method, url, { body, token } = {}) {
    return new Promise((resolve, reject) => {
        const { protocol, hostname } = new URL(url)
        const client = protocol === 'https:'
            ? https
            : protocol === 'http:' && LOCAL_HOSTS.includes(hostname) ? http : null
        if (client == null) {
            reject(new Error(`Refused URL: ${url}`))
            return
        }

        const payload = body == null ? null : Buffer.from(JSON.stringify(body))
        const headers = { Accept: 'application/json' }
        if (payload != null) {
            headers['Content-Type'] = 'application/json'
            headers['Content-Length'] = payload.length
        }
        if (token != null) {
            headers.Authorization = `Bearer ${token}`
        }

        // Reject first, then destroy: destroying with an error once the
        // response has started emits it on the socket, where nothing listens.
        const abort = err => {
            reject(err)
            req.destroy()
        }

        const req = client.request(url, { method, headers, timeout: TIMEOUT }, res => {
            const chunks = []
            let size = 0
            res.on('data', chunk => {
                size += chunk.length
                if (size > MAX_RESPONSE_SIZE) {
                    abort(new Error(`Response too large from ${url}`))
                } else {
                    chunks.push(chunk)
                }
            })
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf-8')
                let data = null
                if (text.length > 0 && /json/i.test(res.headers['content-type'] ?? '')) {
                    try {
                        data = JSON.parse(text)
                    } catch {
                        data = null
                    }
                }
                resolve({ status: res.statusCode, data })
            })
            res.on('error', reject)
        })
        req.on('timeout', () => abort(new Error(`Timeout for ${url}`)))
        req.on('error', reject)
        req.end(payload ?? undefined)
    })
}

function httpError(step, status) {
    const err = new Error(`${step} failed (HTTP ${status})`)
    err.status = status
    return err
}

function normalizeList(list) {
    return (Array.isArray(list) ? list : [])
        .slice(0, MAX_LIST_LENGTH)
        .map(item => String(item).slice(0, MAX_NAME_LENGTH))
}

let machineHwid = null

/**
 * Identifier of this machine, sent with the game start log so that the
 * backend can enforce bans (it only keeps a keyed hash of it). It is derived
 * for this launcher only: other applications reading the same machine GUID
 * get a different value.
 *
 * @returns {Promise<string|null>} A lowercase SHA-256 hex string, or null.
 */
function getMachineHwid() {
    machineHwid ??= machineId(true)
        .then(id => crypto.createHash('sha256').update(`ZukiLauncher:${id}`).digest('hex'))
        .catch(err => {
            logger.warn('Machine identifier unavailable.', err)
            return null
        })
    return machineHwid
}

/**
 * @param {Object} options
 * @param {string|null} options.apiUrl The backend API URL, null to send nothing.
 * @param {string} [options.joinUrl] The Mojang session "join" endpoint.
 * @param {function(): Promise<string|null>} [options.getHwid] Machine identifier.
 */
exports.createClient = function({ apiUrl, joinUrl = MOJANG_JOIN_URL, getHwid = getMachineHwid }) {
    // Session tokens per account UUID, kept in memory only.
    const sessions = new Map()

    /**
     * Prove to the backend that the player owns this Microsoft account.
     *
     * @param {Object} account A Microsoft account (ConfigManager).
     * @returns {Promise<string>} A backend session token.
     */
    async function authenticate(account) {
        const cached = sessions.get(account.uuid)
        if (cached != null && cached.expiresAt - TOKEN_RENEWAL_MARGIN > Date.now()) {
            return cached.token
        }

        const challenge = await requestJson('POST', `${apiUrl}/auth/challenge`)
        const serverId = challenge.data?.server_id
        if (challenge.status !== 200 || typeof serverId !== 'string') {
            throw httpError('Challenge', challenge.status)
        }

        // Same request as a Minecraft client joining a server in online mode.
        const join = await requestJson('POST', joinUrl, {
            body: {
                accessToken: account.accessToken,
                selectedProfile: account.uuid.replace(/-/g, ''),
                serverId
            }
        })
        if (join.status !== 204) {
            throw httpError('Mojang join', join.status)
        }

        const verify = await requestJson('POST', `${apiUrl}/auth/verify`, {
            body: { username: account.displayName, server_id: serverId }
        })
        const { token, expires_at: expiresAt } = verify.data ?? {}
        if (verify.status !== 200 || typeof token !== 'string') {
            throw httpError('Verification', verify.status)
        }

        sessions.set(account.uuid, { token, expiresAt: Date.parse(expiresAt) || Date.now() })
        return token
    }

    /**
     * Send the game start log (mods and resource packs) to the backend, which
     * relays it to Discord.
     *
     * @returns {Promise<{status: number, data: any}>} The backend answer.
     */
    async function sendGameStartLog(account, { launcherVersion, mods, resourcePacks }) {
        const url = `${apiUrl}/discord/log`
        const hwid = await getHwid()
        const body = {
            launcher_version: launcherVersion,
            os: `${process.platform} ${os.release()}`,
            mods: normalizeList(mods),
            resource_packs: normalizeList(resourcePacks),
            ...(hwid != null && { hwid })
        }

        if (account.type !== 'microsoft') {
            // Free account: nothing to verify, the backend marks the log as unverified.
            return requestJson('POST', url, { body: { ...body, player_name: account.displayName } })
        }

        let res = await requestJson('POST', url, { body, token: await authenticate(account) })
        if (res.status === 401) {
            // Expired or revoked session: authenticate again, once.
            sessions.delete(account.uuid)
            res = await requestJson('POST', url, { body, token: await authenticate(account) })
        }
        return res
    }

    /**
     * Send the game start log and tell whether the player may start the game.
     * Never throws: only a ban reported by the backend stops the launch.
     *
     * @param {Object} account The selected account (ConfigManager).
     * @param {Object} data
     * @param {string} data.launcherVersion The launcher version.
     * @param {string[]} data.mods The files of the mods folder.
     * @param {string[]} data.resourcePacks The resource packs added by the player.
     * @returns {Promise<{banned: boolean, reason?: string|null, expiresAt?: string|null}>}
     * expiresAt is null for a permanent ban.
     */
    async function checkGameStart(account, data) {
        if (apiUrl == null) {
            return { banned: false }
        }

        let timer
        const deadline = new Promise(resolve => {
            timer = setTimeout(resolve, GAME_START_DEADLINE, null)
        })
        try {
            const res = await Promise.race([sendGameStartLog(account, data), deadline])
            if (res == null) {
                logger.warn('The backend did not answer in time, the game starts anyway.')
                return { banned: false }
            }
            if (res.status === 403 && res.data?.error === 'banned') {
                return {
                    banned: true,
                    reason: typeof res.data.reason === 'string' ? res.data.reason : null,
                    expiresAt: typeof res.data.expires_at === 'string' ? res.data.expires_at : null
                }
            }
            if (res.status === 204) {
                logger.info('Game start log sent.')
            } else {
                logger.warn(`Game start log refused (HTTP ${res.status}), the game starts anyway.`)
            }
        } catch (err) {
            logger.warn('Game start log not sent, the game starts anyway.', err)
        } finally {
            clearTimeout(timer)
        }
        return { banned: false }
    }

    return { authenticate, checkGameStart }
}

const client = exports.createClient({ apiUrl: API_URL })
exports.checkGameStart = client.checkGameStart
