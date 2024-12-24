/**
 * Script for waitingNextServer.ejs
 */

(async function() {
    const countdownElement = document.getElementById('countdown')
    const buttonAccessLanding = document.getElementById('waitingNextServerAccessLanding')
    const waitingTitleEl = document.getElementById('waitingTitle')
    const waitingDescriptionEl = document.getElementById('waitingDescription')
    const waitingEndDescriptionEl = document.getElementById('waitingEndDescription')

    const {
        nextServerOpeningDate,
        waitingTitle,
        waitingDescription,
        waitingEndDescription
    } = await fetchServerDates()

    waitingTitleEl.innerText = waitingTitle
    waitingDescriptionEl.innerText = waitingDescription
    waitingEndDescriptionEl.innerText = waitingEndDescription

    // Date de l'ouverture du prochain serveur
    const openingDate = new Date(nextServerOpeningDate).getTime()

    if (isNaN(openingDate)) {
        return
    }

    // Met à jour le compte à rebours chaque seconde
    const countdownInterval = setInterval(() => {
    // Date et heure actuelles
        const now = Date.now()

        // Calcul de la différence de temps entre maintenant et la date d'ouverture
        const timeDifference = openingDate - now

        // Calcul des jours, heures, minutes et secondes restantes
        const days = Math.floor(timeDifference / (1000 * 60 * 60 * 24))
        const hours = Math.floor((timeDifference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        const minutes = Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((timeDifference % (1000 * 60)) / 1000)

        // Construire la chaîne du compte à rebours
        let countdownText = ''
        if (days > 0) countdownText += `${days}j `
        if (hours > 0 || days > 0) countdownText += `${hours}h `
        if (minutes > 0 || hours > 0 || days > 0) countdownText += `${minutes}m `
        countdownText += `${seconds}s`

        // Affiche le compte à rebours dans l'élément HTML
        countdownElement.innerText = countdownText

        // Si la date d'ouverture est atteinte
        if (timeDifference < 0) {
            clearInterval(countdownInterval)
            buttonAccessLanding.innerText = 'JOUER'
            buttonAccessLanding.style.display = 'block'

            buttonAccessLanding.addEventListener('click', () => {
                switchView(getCurrentView(), VIEWS.landing)
            }, false)

            countdownElement.innerText = 'Le serveur est maintenant ouvert !'
        }
    }, 1000)
}())
