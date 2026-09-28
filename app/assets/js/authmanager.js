/**
* AuthManager
* 
* This module aims to abstract login procedures (Microsoft accounts and free
* offline accounts). Results are processed and stored, if applicable, in the
* config using the ConfigManager. All login procedures should be made through
* this module.
* 
* @module authmanager
*/
// Requirements
const { v5: uuidv5 } = require('uuid')
const { machineIdSync } = require('node-machine-id')
const ConfigManager          = require('./configmanager')
const { LoggerUtil }         = require('helios-core')
const { RestResponseStatus } = require('helios-core/common')
const { MicrosoftAuth, MicrosoftErrorCode } = require('helios-core/microsoft')
const { AZURE_CLIENT_ID }    = require('./ipcconstants')

const log = LoggerUtil.getLogger('AuthManager')

// Functions

function microsoftErrorDisplayable(errorCode) {
    switch(errorCode) {
        case MicrosoftErrorCode.NO_PROFILE:
            return {
                title: 'Erreur lors de la connexion :<br>Profil non configuré',
                desc: 'Votre compte Microsoft n\'a pas encore de profil Minecraft configuré. Si vous avez récemment acheté le jeu ou l\'avez utilisé via Xbox Game Pass, vous devez configurer votre profil sur <a href="https://minecraft.net/">Minecraft.net</a>.<br><br>Si vous n\'avez pas encore acheté le jeu, vous pouvez également le faire sur <a href="https://minecraft.net/">Minecraft.net</a>.'
            }
        case MicrosoftErrorCode.NO_XBOX_ACCOUNT:
            return {
                title: 'Erreur lors de la connexion :<br>Pas de compte Xbox',
                desc: 'Votre compte Microsoft n\'est associé à aucun compte Xbox.'
            }
        case MicrosoftErrorCode.XBL_BANNED:
            return {
                title: 'Erreur lors de la connexion :<br>Xbox Live indisponible',
                desc: 'Votre compte Microsoft provient d\'un pays où Xbox Live n\'est pas disponible ou interdit.'
            }
        case MicrosoftErrorCode.UNDER_18:
            return {
                title: 'Erreur lors de la connexion :<br>Approbation parentale requise',
                desc: 'Les comptes des utilisateurs de moins de 18 ans doivent être ajoutés à une famille par un adulte.'
            }
        case MicrosoftErrorCode.UNKNOWN:
            return {
                title: 'Erreur inconnue lors de la connexion',
                desc: 'Une erreur inconnue s\'est produite. Veuillez consulter la console pour plus de détails. (CTRL+Shift+I)'
            }
    }
}

/**
 * Build the rejection value of a failed Microsoft/Xbox/Minecraft request.
 * The error is flagged as transient unless the server explicitly rejected the
 * request (HTTP 4xx other than 429): no connection, timeout, unexpected body,
 * server error or rate limit must not be treated as invalid credentials.
 *
 * @param {Object} response The failed RestResponse.
 * @returns {Object} The displayable error, with a `transient` flag.
 */
function microsoftRequestFailure(response) {
    const statusCode = response.error?.response?.statusCode
    const rejectedByServer = statusCode >= 400 && statusCode < 500 && statusCode !== 429
    return {
        ...microsoftErrorDisplayable(response.microsoftErrorCode),
        transient: !rejectedByServer
    }
}

/**
* Add an unofficial account. The resultant data will be stored as an auth account in the
* configuration database.
* 
* @param {string} username The account username.
* @returns {Promise<Object>} Promise which resolves the resolved authenticated account object.
*/
exports.addUnofficalAccount = function(username) {
    try {
        if (!['WOUHAIT', 'ZUKIRYA'].includes(username.toUpperCase())) {
            const uuid = uuidv5('zukipalace-' + username + machineIdSync(), uuidv5.DNS).replaceAll('-', '')
            const ret = ConfigManager.addUnofficalAuthAccount(uuid, username, username)
            if(ConfigManager.getClientToken() == null){
                ConfigManager.setClientToken('00000000000000000000000000000000')
            }
            ConfigManager.save()
            return Promise.resolve(ret)
        } else {
            return Promise.reject({
                title: 'Erreur avec le Pseudo',
                desc: 'Une erreur s\'est produite. Vous ne pouvez pas utiliser le même pseudo qu\'un administrateur du serveur.'
            })
        }       
    } catch (err){
        log.error(err)
        return Promise.reject({
            title: 'Erreur inconnue lors de la connexion',
            desc: 'Une erreur inconnue s\'est produite. Veuillez consulter la console pour plus de détails. (CTRL+Shift+I)'
        })
    }
}

const AUTH_MODE = { FULL: 0, MS_REFRESH: 1, MC_REFRESH: 2 }

/**
* Perform the full MS Auth flow in a given mode.
* 
* AUTH_MODE.FULL = Full authorization for a new account.
* AUTH_MODE.MS_REFRESH = Full refresh authorization.
* AUTH_MODE.MC_REFRESH = Refresh of the MC token, reusing the MS token.
* 
* @param {string | Object} entryCode FULL=Microsoft token response (the authorization code is
* exchanged by the main process, see index.js), MS_REFRESH=refreshToken, MC_REFRESH=accessToken
* @param {*} authMode The auth mode.
* @returns An object with all auth data. AccessToken object will be null when mode is MC_REFRESH.
*/
async function fullMicrosoftAuthFlow(entryCode, authMode) {
    try {

        let accessTokenRaw
        let accessToken
        if(authMode === AUTH_MODE.FULL) {
            accessToken = entryCode
            accessTokenRaw = accessToken.access_token
        } else if(authMode === AUTH_MODE.MS_REFRESH) {
            const accessTokenResponse = await MicrosoftAuth.getAccessToken(entryCode, true, AZURE_CLIENT_ID)
            if(accessTokenResponse.responseStatus === RestResponseStatus.ERROR) {
                return Promise.reject(microsoftRequestFailure(accessTokenResponse))
            }
            accessToken = accessTokenResponse.data
            accessTokenRaw = accessToken.access_token
        } else {
            accessTokenRaw = entryCode
        }
        
        const xblResponse = await MicrosoftAuth.getXBLToken(accessTokenRaw)
        if(xblResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftRequestFailure(xblResponse))
        }
        const xstsResonse = await MicrosoftAuth.getXSTSToken(xblResponse.data)
        if(xstsResonse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftRequestFailure(xstsResonse))
        }
        const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(xstsResonse.data)
        if(mcTokenResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftRequestFailure(mcTokenResponse))
        }
        const mcProfileResponse = await MicrosoftAuth.getMCProfile(mcTokenResponse.data.access_token)
        if(mcProfileResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftRequestFailure(mcProfileResponse))
        }
        return {
            accessToken,
            accessTokenRaw,
            xbl: xblResponse.data,
            xsts: xstsResonse.data,
            mcToken: mcTokenResponse.data,
            mcProfile: mcProfileResponse.data
        }
    } catch(err) {
        log.error(err)
        return Promise.reject(microsoftErrorDisplayable(MicrosoftErrorCode.UNKNOWN))
    }
}

/**
* Calculate the expiry date. Advance the expiry time by 10 seconds
* to reduce the liklihood of working with an expired token.
* 
* @param {number} nowMs Current time milliseconds.
* @param {number} epiresInS Expires in (seconds)
* @returns 
*/
function calculateExpiryDate(nowMs, epiresInS) {
    return nowMs + ((epiresInS-10)*1000)
}

/**
* Add a Microsoft account. This will pass the provided Microsoft tokens to the
* Xbox Live / Minecraft authentication flow. The resultant data will be stored
* as an auth account in the configuration database.
*
* @param {Object} accessToken The Microsoft token response obtained by the main process.
* @returns {Promise.<Object>} Promise which resolves the resolved authenticated account object.
*/
exports.addMicrosoftAccount = async function(accessToken) {

    const fullAuth = await fullMicrosoftAuthFlow(accessToken, AUTH_MODE.FULL)

    // Advance expiry by 10 seconds to avoid close calls.
    const now = new Date().getTime()

    const ret = ConfigManager.addMicrosoftAuthAccount(
        fullAuth.mcProfile.id,
        fullAuth.mcToken.access_token,
        fullAuth.mcProfile.name,
        calculateExpiryDate(now, fullAuth.mcToken.expires_in),
        fullAuth.accessToken.access_token,
        fullAuth.accessToken.refresh_token,
        calculateExpiryDate(now, fullAuth.accessToken.expires_in)
    )
    ConfigManager.save()

    return ret
}

/**
* Remove a legacy Mojang account. Mojang's authentication servers are closed,
* so the account is only removed from the database.
*
* @param {string} uuid The UUID of the account to be removed.
* @returns {Promise.<void>} Promise which resolves to void when the action is complete.
*/
exports.removeMojangAccount = function(uuid){
    try {
        ConfigManager.removeAuthAccount(uuid)
        ConfigManager.save()
        return Promise.resolve()
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

/**
* Remove a Microsoft account. It is expected that the caller will invoke the OAuth logout
* through the ipc renderer.
* 
* @param {string} uuid The UUID of the account to be removed.
* @returns {Promise.<void>} Promise which resolves to void when the action is complete.
*/
exports.removeMicrosoftAccount = function(uuid){
    try {
        ConfigManager.removeAuthAccount(uuid)
        ConfigManager.save()
        return Promise.resolve()
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

/**
* Remove an unofficial account.
* 
* @param {string} uuid The UUID of the account to be removed.
* @returns {Promise.<void>} Promise which resolves to void when the action is complete.
*/
exports.removeUnofficialAccount = function(uuid){
    try {
        const authAcc = ConfigManager.getAuthAccount(uuid)
        if(authAcc) {
            ConfigManager.removeAuthAccount(uuid)
            ConfigManager.save()
            return Promise.resolve()
        } else {
            log.error('Error while removing account, uuid not found.')
            return Promise.reject(new Error('Error while removing account, uuid not found.'))
        }
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

/**
* Validate the selected account with Microsoft's authserver. If the account is not valid,
* we will attempt to refresh the access token and update that value. If that fails, a
* new login will be required.
* 
* @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
* otherwise false.
*/
async function validateSelectedMicrosoftAccount() {
    const current = ConfigManager.getSelectedAccount()
    const now = new Date().getTime()
    const mcExpiresAt = new Date(current.expiresAt).getTime()
    const mcExpired = now >= mcExpiresAt

    if(!mcExpired) {
        return true
    }

    // MC token expired. Check MS token.

    const msExpiresAt = new Date(current.microsoft.expires_at).getTime()
    const msExpired = now >= msExpiresAt

    if(msExpired) {
        // MS expired, do full refresh.
        try {
            const res = await fullMicrosoftAuthFlow(current.microsoft.refresh_token, AUTH_MODE.MS_REFRESH)

            ConfigManager.updateMicrosoftAuthAccount(
                current.uuid,
                res.mcToken.access_token,
                res.accessToken.access_token,
                res.accessToken.refresh_token,
                calculateExpiryDate(now, res.accessToken.expires_in),
                calculateExpiryDate(now, res.mcToken.expires_in)
            )
            ConfigManager.save()
            return true
        } catch(err) {
            // Let temporary failures propagate so the caller keeps the account.
            if(err?.transient) {
                throw err
            }
            return false
        }
    } else {
        // Only MC expired, use existing MS token.
        try {
            const res = await fullMicrosoftAuthFlow(current.microsoft.access_token, AUTH_MODE.MC_REFRESH)

            ConfigManager.updateMicrosoftAuthAccount(
                current.uuid,
                res.mcToken.access_token,
                current.microsoft.access_token,
                current.microsoft.refresh_token,
                current.microsoft.expires_at,
                calculateExpiryDate(now, res.mcToken.expires_in)
            )
            ConfigManager.save()
            return true
        }
        catch(err) {
            if(err?.transient) {
                throw err
            }
            return false
        }
    }
}

/**
 * Validate the selected auth account.
 * 
 * @returns {Promise<boolean>} Promise which resolves to true if the access token is valid,
 * otherwise false.
 */
exports.validateSelected = () => {
    const current = ConfigManager.getSelectedAccount()

    if(current.type === 'microsoft') {
        return validateSelectedMicrosoftAccount()
    } else if(current.type === 'mojang') {
        // Legacy Mojang accounts can no longer be validated (service closed).
        return Promise.resolve(false)
    } else {
        return Promise.resolve(true)
    }
}