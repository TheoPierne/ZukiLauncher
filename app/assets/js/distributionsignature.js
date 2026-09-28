'use strict'

const crypto = require('crypto')
const https = require('https')

// distribution.json is published with a detached Ed25519 signature next to it
// (distribution.json.sig). The private key stays on the maintainer's PC
// (scripts/distribution-signing.js), so a compromised server cannot make the
// launcher download files that the maintainer did not sign.
// This module is also used by that script: it must not depend on Electron.

exports.SIGNATURE_EXTENSION = '.sig'

const MAX_DISTRIBUTION_SIZE = 20 * 1024 * 1024
const MAX_SIGNATURE_SIZE = 4096
const SIGNATURE_LENGTH = 64
const TIMEOUT = 30000
const MAX_REDIRECTS = 3

/**
 * Error raised when the distribution cannot be trusted.
 */
class DistributionSignatureError extends Error {
    /**
     * @param {string} code NO_TRUSTED_KEY, INVALID_SIGNATURE or HTTP_ERROR.
     * @param {string} message The error message.
     */
    constructor(code, message) {
        super(message)
        this.name = 'DistributionSignatureError'
        this.code = code
    }
}
exports.DistributionSignatureError = DistributionSignatureError

/**
 * @returns {string[]} The trusted public keys (base64 DER SPKI).
 */
exports.getTrustedKeys = function() {
    return require('./distributionkeys.json').publicKeys
}

/**
 * @param {string} base64 An Ed25519 public key (base64 DER SPKI).
 * @returns {crypto.KeyObject} The parsed key.
 */
function toPublicKey(base64) {
    const key = crypto.createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ed25519') {
        throw new Error('Distribution public keys must be Ed25519 keys.')
    }
    return key
}

/**
 * Check the detached signature of the distribution index.
 *
 * @param {Buffer} data The raw bytes of distribution.json, exactly as served.
 * @param {string} signatureFile The content of distribution.json.sig: one base64
 * signature per line (several lines allow a key rotation).
 * @param {string[]} publicKeys The trusted public keys (base64 DER SPKI).
 * @returns {boolean} Whether one of the signatures was made by a trusted key.
 */
exports.verifyDistribution = function(data, signatureFile, publicKeys = exports.getTrustedKeys()) {
    const keys = publicKeys.map(toPublicKey)
    const signatures = signatureFile.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)

    return signatures.some(signature => {
        const bytes = Buffer.from(signature, 'base64')
        return bytes.length === SIGNATURE_LENGTH && keys.some(key => crypto.verify(null, data, key, bytes))
    })
}

/**
 * Download a file over HTTPS. Node's https module is used, like helios-core,
 * so the request does not depend on the page CSP or on CORS headers.
 *
 * @param {string} url The file URL.
 * @param {number} maxSize The maximum accepted size, in bytes.
 * @param {number} redirects The number of redirects still allowed.
 * @returns {Promise<Buffer>} The raw response body.
 */
function download(url, maxSize, redirects = MAX_REDIRECTS) {
    return new Promise((resolve, reject) => {
        // Destroying with an error once the response has started emits it on
        // the socket, where nothing listens: reject first, then destroy.
        const abort = err => {
            reject(err)
            req.destroy()
        }

        // https.get throws on a plain HTTP URL, including after a redirect.
        const req = https.get(url, { timeout: TIMEOUT }, res => {
            const { statusCode, headers } = res

            if (statusCode >= 300 && statusCode < 400 && headers.location != null) {
                res.resume()
                if (redirects === 0) {
                    reject(new Error(`Too many redirects for ${url}`))
                } else {
                    resolve(download(new URL(headers.location, url).href, maxSize, redirects - 1))
                }
                return
            }

            if (statusCode !== 200) {
                res.resume()
                const err = new DistributionSignatureError('HTTP_ERROR', `HTTP ${statusCode} for ${url}`)
                err.statusCode = statusCode
                err.url = url
                reject(err)
                return
            }

            const chunks = []
            let size = 0
            res.on('data', chunk => {
                size += chunk.length
                if (size > maxSize) {
                    abort(new Error(`${url} is larger than ${maxSize} bytes`))
                } else {
                    chunks.push(chunk)
                }
            })
            res.on('end', () => {
                if (size <= maxSize) {
                    resolve(Buffer.concat(chunks))
                }
            })
            res.on('error', reject)
        })
        req.on('timeout', () => abort(new Error(`Timeout while downloading ${url}`)))
        req.on('error', reject)
    })
}

/**
 * Download distribution.json and its signature, then check the signature.
 *
 * @param {string} url The distribution.json URL.
 * @param {string[]} publicKeys The trusted public keys (base64 DER SPKI).
 * @returns {Promise<Object>} The parsed distribution index.
 * @throws If a download fails, or if the signature is missing or invalid.
 */
exports.pullSignedDistribution = async function(url, publicKeys = exports.getTrustedKeys()) {
    if (publicKeys.length === 0) {
        throw new DistributionSignatureError('NO_TRUSTED_KEY', 'No trusted public key in distributionkeys.json.')
    }

    const [data, signature] = await Promise.all([
        download(url, MAX_DISTRIBUTION_SIZE),
        download(url + exports.SIGNATURE_EXTENSION, MAX_SIGNATURE_SIZE)
    ])

    if (!exports.verifyDistribution(data, signature.toString('utf-8'), publicKeys)) {
        throw new DistributionSignatureError('INVALID_SIGNATURE', `Invalid signature for ${url}`)
    }

    // Parsed like helios-core does, a UTF-8 BOM aside.
    return JSON.parse(data.toString('utf-8').replace(/^\uFEFF/, ''))
}
