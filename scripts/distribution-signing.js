'use strict'

// Maintainer tool: signs distribution.json with a private key that never
// leaves this PC. Run it without arguments for the help.

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')

const DistributionSignature = require('../app/assets/js/distributionsignature')

const PROJECT_DIR = path.resolve(__dirname, '..')
const KEYS_FILE = path.join(PROJECT_DIR, 'app', 'assets', 'js', 'distributionkeys.json')
const DEFAULT_KEY_FILE = path.join(os.homedir(), '.zuki-launcher', 'distribution-signing-key.pem')
const MIN_PASSPHRASE_LENGTH = 12

const HELP = `Signature de distribution.json

  npm run distribution:keygen
      Crée ta clé de signature (une seule fois) et ajoute sa clé publique au launcher.

  npm run distribution:sign -- <chemin vers distribution.json>
      Signe le fichier et écrit distribution.json.sig à côté.

  npm run distribution:verify
      Vérifie la distribution en ligne, comme le fait le launcher.
      Pour un fichier local : node scripts/distribution-signing.js verify <fichier>

Option : --key <fichier> pour utiliser une autre clé que ${DEFAULT_KEY_FILE}
La clé privée ne doit jamais être dans le projet : elle serait publiée avec le launcher.`

/**
 * @param {string} message The message shown to the user.
 * @returns {never}
 */
function fail(message) {
    const err = new Error(message)
    err.isUserError = true
    throw err
}

function parseArgs(argv) {
    const args = { positional: [], key: DEFAULT_KEY_FILE }
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--key') {
            if (argv[i + 1] == null) {
                fail('--key attend un chemin de fichier.')
            }
            args.key = path.resolve(argv[++i])
        } else {
            args.positional.push(argv[i])
        }
    }
    return args
}

function assertOutsideProject(file) {
    const relative = path.relative(PROJECT_DIR, file)
    if (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
        fail(`La clé privée ne doit pas être dans le projet, elle serait publiée avec le launcher : ${file}`)
    }
}

function readTrustedKeys() {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8')).publicKeys
}

function writeTrustedKeys(publicKeys) {
    const json = JSON.stringify({ publicKeys }, null, 4)
    fs.writeFileSync(KEYS_FILE, json.replace(/\n/g, '\r\n') + '\r\n')
}

let pipedLines = null

/**
 * Ask for a passphrase without echoing it. Without a terminal (pipe), the next
 * line of the standard input is read instead.
 *
 * @param {string} question The prompt.
 * @returns {Promise<string>} The passphrase.
 */
async function askPassphrase(question) {
    if (!process.stdin.isTTY) {
        pipedLines ??= readline.createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]()
        const { value, done } = await pipedLines.next()
        if (done) {
            fail('Phrase de passe manquante.')
        }
        return value
    }

    return new Promise((resolve, reject) => {
        const { stdin, stdout } = process
        let value = ''

        const finish = callback => {
            stdin.removeListener('data', onData)
            stdin.setRawMode(false)
            stdin.pause()
            stdout.write('\n')
            callback()
        }

        const onData = chunk => {
            for (const char of chunk) {
                if (char === '\r' || char === '\n') {
                    finish(() => resolve(value))
                    return
                } else if (char === '\u0003') {
                    finish(() => reject(Object.assign(new Error('Interrompu.'), { isUserError: true })))
                    return
                } else if (char === '\u0008' || char === '\u007f') {
                    value = value.slice(0, -1)
                } else if (char >= ' ') {
                    value += char
                }
            }
        }

        stdout.write(question)
        stdin.setEncoding('utf-8')
        stdin.setRawMode(true)
        stdin.resume()
        stdin.on('data', onData)
    })
}

async function keygen({ key }) {
    assertOutsideProject(key)
    if (fs.existsSync(key)) {
        fail(`Une clé existe déjà dans ${key}\nPour en créer une autre, indique un autre chemin avec --key.`)
    }

    const passphrase = await askPassphrase('Choisis une phrase de passe pour la clé : ')
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        fail(`La phrase de passe doit faire au moins ${MIN_PASSPHRASE_LENGTH} caractères.`)
    }
    if (await askPassphrase('Confirme la phrase de passe : ') !== passphrase) {
        fail('Les deux phrases de passe sont différentes.')
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }
    })

    fs.mkdirSync(path.dirname(key), { recursive: true, mode: 0o700 })
    fs.writeFileSync(key, privateKey, { flag: 'wx', mode: 0o600 })
    writeTrustedKeys([...readTrustedKeys(), publicKey.toString('base64')])

    console.log(`Clé privée enregistrée dans ${key}`)
    console.log(`Clé publique ajoutée à ${path.relative(PROJECT_DIR, KEYS_FILE)}`)
    console.log('')
    console.log('Ensuite :')
    console.log('  1. Sauvegarde la clé privée et sa phrase de passe (gestionnaire de mots de passe, clé USB).')
    console.log('     Si tu les perds, il faudra une nouvelle clé et une nouvelle version du launcher.')
    console.log('  2. Commite distributionkeys.json.')
    console.log('  3. Signe ta distribution : npm run distribution:sign -- <chemin vers distribution.json>')
}

async function sign({ positional, key }) {
    const file = positional[0]
    if (file == null) {
        fail('Indique le fichier à signer : npm run distribution:sign -- <chemin vers distribution.json>')
    }
    assertOutsideProject(key)
    if (!fs.existsSync(key)) {
        fail(`Clé privée introuvable : ${key}\nCrée-la avec npm run distribution:keygen.`)
    }

    const data = fs.readFileSync(file)
    try {
        JSON.parse(data.toString('utf-8').replace(/^\uFEFF/, ''))
    } catch (err) {
        fail(`${file} n'est pas un JSON valide : ${err.message}`)
    }

    const passphrase = await askPassphrase('Phrase de passe de la clé : ')
    let privateKey
    try {
        privateKey = crypto.createPrivateKey({ key: fs.readFileSync(key), format: 'pem', passphrase })
    } catch {
        fail('Impossible d\'ouvrir la clé privée : phrase de passe incorrecte ?')
    }

    const trustedKeys = readTrustedKeys()
    const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64')
    if (!trustedKeys.includes(publicKey)) {
        fail(`Cette clé n'est pas dans ${path.relative(PROJECT_DIR, KEYS_FILE)} : le launcher refuserait la signature.`)
    }

    const signature = crypto.sign(null, data, privateKey).toString('base64')
    if (!DistributionSignature.verifyDistribution(data, signature, trustedKeys)) {
        fail('La signature produite ne se vérifie pas.')
    }

    const signatureFile = file + DistributionSignature.SIGNATURE_EXTENSION
    fs.writeFileSync(signatureFile, signature + '\n')

    console.log(`Signature écrite dans ${signatureFile}`)
    console.log('Envoie les deux fichiers dans le dossier zuki-launcher de ton serveur, sous les noms')
    console.log('distribution.json et distribution.json.sig, puis vérifie avec : npm run distribution:verify')
}

function explain(err) {
    if (err.code === 'HTTP_ERROR') {
        return err.statusCode === 404
            ? `Fichier introuvable sur le serveur : ${err.url}`
            : `Le serveur a répondu ${err.statusCode} pour ${err.url}`
    }
    if (err.code === 'INVALID_SIGNATURE') {
        return 'Signature invalide. Soit distribution.json a changé depuis sa signature (signe-le à nouveau et '
            + 'renvoie les deux fichiers), soit il a été modifié pendant l\'envoi (en FTP, utilise le mode binaire).'
    }
    return `Vérification impossible : ${err.message}`
}

async function verify({ positional }) {
    const target = positional[0]
    if (target == null) {
        fail('Indique une URL ou un fichier à vérifier.')
    }

    const trustedKeys = readTrustedKeys()
    if (trustedKeys.length === 0) {
        fail(`Aucune clé publique dans ${path.relative(PROJECT_DIR, KEYS_FILE)} : lance npm run distribution:keygen.`)
    }

    if (/^https?:\/\//i.test(target)) {
        let distribution
        try {
            distribution = await DistributionSignature.pullSignedDistribution(target, trustedKeys)
        } catch (err) {
            fail(explain(err))
        }
        console.log(`OK : la distribution en ligne est signée (${distribution.servers?.length ?? 0} serveur(s)).`)
        return
    }

    const signatureFile = target + DistributionSignature.SIGNATURE_EXTENSION
    if (!fs.existsSync(signatureFile)) {
        fail(`Signature introuvable : ${signatureFile}`)
    }
    if (!DistributionSignature.verifyDistribution(fs.readFileSync(target), fs.readFileSync(signatureFile, 'utf-8'), trustedKeys)) {
        fail('Signature invalide : le fichier a changé depuis sa signature. Signe-le à nouveau.')
    }
    console.log('OK : le fichier est signé.')
}

const COMMANDS = { keygen, sign, verify }

async function main() {
    const [command, ...rest] = process.argv.slice(2)
    const run = Object.hasOwn(COMMANDS, command ?? '') ? COMMANDS[command] : null
    if (run == null) {
        console.log(HELP)
        if (command != null && command !== 'help') {
            process.exitCode = 1
        }
        return
    }
    await run(parseArgs(rest))
}

main()
    .catch(err => {
        console.error(err.isUserError ? err.message : err)
        process.exitCode = 1
    })
    .finally(() => pipedLines?.return())
