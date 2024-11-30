const { LoggerUtil } = require('helios-core')
const logger = LoggerUtil.getLogger('DiscordWebhook')

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1311858765586497537/hMETGLLAwpqr1DH2I9kTGeZBDkv10LCsmUF_SvonBFzNBiRNrmNFluLI6Ro6RvEsixFw'

exports.sendGameStartingLogToDiscord = async (playerName, mods = [], resourcePacks = []) => {
    const embedColor = mods.length === 0 && resourcePacks.length === 0 ? 5763719 : 15548997
    const message = {
        embeds: [
            {
                title: `**${playerName}** vient de démarrer le jeu`,
                color: embedColor,
                fields: [
                    {
                        name: 'Mods :',
                        value: mods.length !== 0 ? '`' + mods.join(', ') + '`' : '`Aucun`',
                        inline: true
                    },
                    {
                        name: 'Resource Packs :',
                        value: resourcePacks.length !== 0 ? '`' + resourcePacks.join(', ') + '`' : '`Aucun`',
                        inline: true
                    },
                ],
                timestamp: new Date().toISOString()
            }
        ]
    }

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(message),
        })

        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status} : ${response.statusText}`)
        }

        logger.info('Message sent to Discord!')
    } catch (err) {
        logger.error('Error while trying to send message to Discord', err)
    }
}