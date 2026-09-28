const { LoggerUtil } = require('helios-core')
const logger = LoggerUtil.getLogger('DiscordWebhook')

// Never put a webhook URL in the launcher: anyone can read it in the installed
// files and post in the channel. To re-enable these logs, send them to an
// authenticated backend (on zukipalace.theopierne.fr, allowed by the CSP) that
// posts to Discord, and inform the players of this collection (GDPR: player
// name, UUID, mods and resource packs).
const WEBHOOK_URL = process.env.ZUKI_DISCORD_WEBHOOK_URL

exports.sendGameStartingLogToDiscord = async (playerName, mods = [], resourcePacks = []) => {
    if (!WEBHOOK_URL) {
        logger.info('Game start logging disabled: no endpoint configured.')
        return
    }

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