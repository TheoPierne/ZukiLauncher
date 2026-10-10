'use strict'

// Maintainer tool: reads the benchmark runs written by benchmark.js. Run it
// with --help for the options.

const fs = require('fs')
const os = require('os')
const path = require('path')

const { productName } = require('../package.json')

function getDefaultDir() {
    let appData
    if (process.platform === 'win32') {
        appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
    } else if (process.platform === 'darwin') {
        appData = path.join(os.homedir(), 'Library', 'Application Support')
    } else {
        appData = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
    }
    return path.join(appData, productName, 'benchmarks')
}

const DEFAULT_DIR = getDefaultDir()

const HELP = `Relevés de performance du launcher

  npm run bench
      Lance le launcher en mode benchmark. Utilise-le comme d'habitude (accueil,
      paramètres, lancement du jeu...) puis ferme-le : le relevé est écrit dans
      ${DEFAULT_DIR}
      Pour nommer le relevé : npx electron . --bench=avant
      Launcher installé : "${productName}.exe" --bench=avant

  npm run bench:report
      Résumé du dernier relevé.

  npm run bench:report -- --compare
      Compare les deux derniers relevés (le plus ancien sert de référence).

  npm run bench:report -- <relevé> [<relevé à comparer>]
      Résumé d'un relevé, ou comparaison de deux relevés.

Option : --dir <dossier> pour lire les relevés d'un autre dossier.`

// Process types of app.getAppMetrics(), the others are counted in 'autres'.
const TYPE_GROUPS = {
    Browser: 'principal',
    GPU: 'gpu',
    Tab: 'pages'
}

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
    const args = { files: [], dir: DEFAULT_DIR, compare: false, help: false }
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dir') {
            if (argv[i + 1] == null) {
                fail('--dir attend un dossier.')
            }
            args.dir = path.resolve(argv[++i])
        } else if (argv[i] === '--compare') {
            args.compare = true
        } else if (argv[i] === '--help' || argv[i] === '-h') {
            args.help = true
        } else {
            args.files.push(path.resolve(argv[i]))
        }
    }
    return args
}

function listRuns(dir) {
    const runs = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(name => /^bench-.+\.jsonl$/.test(name)).sort()
        : []
    if (runs.length === 0) {
        fail(`Aucun relevé dans ${dir}. Lance d'abord npm run bench.`)
    }
    return runs.map(name => path.join(dir, name))
}

function readRun(file) {
    if (!fs.existsSync(file)) {
        fail(`Relevé introuvable : ${file}`)
    }
    const entries = []
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
        if (line.trim() === '') {
            continue
        }
        try {
            entries.push(JSON.parse(line))
        } catch {
            // Last line of a run that did not end properly (crash, kill).
        }
    }
    const meta = entries.find(entry => entry.type === 'meta')
    if (meta == null) {
        fail(`${file} n'est pas un relevé du launcher.`)
    }
    return { file, meta, entries }
}

function phaseStats(phase) {
    const n = phase.samples.length
    const avg = key => n === 0 ? null : phase.samples.reduce((sum, sample) => sum + sample[key], 0) / n
    const max = key => n === 0 ? null : Math.max(...phase.samples.map(sample => sample[key]))
    return {
        n,
        duration: phase.duration,
        totalAvg: avg('total'),
        totalMax: max('total'),
        privateAvg: avg('privateBytes'),
        principal: avg('principal'),
        gpu: avg('gpu'),
        pages: avg('pages'),
        autres: avg('autres'),
        cpuAvg: avg('cpu'),
        cpuMax: max('cpu')
    }
}

function summarize(run) {
    const { entries, meta } = run
    const end = Math.max(...entries.map(entry => entry.t ?? 0))

    // Startup steps: first occurrence of each mark.
    const marks = new Map()
    for (const entry of entries) {
        if (entry.type === 'mark' && entry.name !== 'fermeture' && !marks.has(entry.name)) {
            marks.set(entry.name, entry.t)
        }
    }

    // Phases in order of first appearance, a phase can occur several times.
    const phases = new Map()
    const getPhase = name => {
        if (!phases.has(name)) {
            phases.set(name, { duration: 0, samples: [] })
        }
        return phases.get(name)
    }
    const changes = entries.filter(entry => entry.type === 'phase')
    changes.forEach((change, i) => {
        getPhase(change.name).duration += (changes[i + 1]?.t ?? end) - change.t
    })
    for (const entry of entries) {
        if (entry.type !== 'sample') {
            continue
        }
        const sample = { total: 0, privateBytes: 0, cpu: 0, principal: 0, gpu: 0, pages: 0, autres: 0 }
        for (const proc of entry.processes) {
            sample.total += proc.workingSet
            sample.privateBytes += proc.privateBytes ?? 0
            // Recorded in % of the whole machine, shown in % of one core.
            sample.cpu += proc.cpu * meta.cores
            sample[TYPE_GROUPS[proc.type] ?? 'autres'] += proc.workingSet
        }
        getPhase(entry.phase).samples.push(sample)
    }

    const stats = new Map([...phases].map(([name, phase]) => [name, phaseStats(phase)]))
    return { run, marks, stats, gpu: entries.find(entry => entry.type === 'gpu') }
}

const mb = kb => kb == null ? '—' : `${Math.round(kb / 1024)} Mo`
const percent = value => value == null ? '—' : `${value.toFixed(1)} %`
const seconds = ms => ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`
const ms = value => value == null ? '—' : `${value} ms`

function delta(before, after) {
    if (before == null || after == null || before === 0) {
        return ''
    }
    const value = Math.round((after - before) / before * 100)
    return `${value > 0 ? '+' : ''}${value} %`
}

function compareCell(before, after, format) {
    if (before == null && after == null) {
        return '—'
    }
    const change = delta(before, after)
    return `${format(before)} → ${format(after)}${change ? `  ${change}` : ''}`
}

/**
 * Print aligned columns: the first one left-aligned, the others right-aligned.
 */
function printTable(header, rows) {
    const all = [header, ...rows]
    const widths = header.map((_, col) => Math.max(...all.map(row => String(row[col]).length)))
    for (const row of all) {
        console.log('  ' + row.map((cell, col) => col === 0
            ? String(cell).padEnd(widths[col])
            : String(cell).padStart(widths[col])).join('   ').trimEnd())
    }
}

function runTitle(summary) {
    const { meta, file } = summary.run
    return meta.label ? `« ${meta.label} »` : path.basename(file)
}

function gpuText(gpu) {
    if (gpu == null) {
        return 'inconnue'
    }
    return `${gpu.hardwareAcceleration ? 'oui' : 'non'} (compositing : ${gpu.compositing}, rasterization : ${gpu.rasterization})`
}

function printHeader(summary) {
    const { meta, file } = summary.run
    console.log(`Relevé ${runTitle(summary)} — ${new Date(meta.date).toLocaleString('fr-FR')}`)
    console.log(`  ${file}`)
    console.log(`  Launcher ${meta.version} · Electron ${meta.electron} · ${meta.packaged ? 'version installée' : 'développement'}`)
    console.log(`  ${meta.cpu?.trim()} (${meta.cores} cœurs) · ${Math.round(meta.totalMem / 1024 / 1024)} Go de RAM · ${meta.platform} ${meta.osRelease}`)
    console.log(`  Accélération matérielle : ${gpuText(summary.gpu)}`)
}

function printRun(summary) {
    printHeader(summary)

    console.log('\nDémarrage (depuis le lancement du process)')
    if (summary.marks.size === 0) {
        console.log('  Aucune étape enregistrée.')
    } else {
        printTable(['Étape', 'Temps'], [...summary.marks].map(([name, t]) => [name, ms(t)]))
    }
    if (!summary.marks.has('interface-prete')) {
        console.log('  Attention : l\'interface n\'a jamais fini de charger dans ce relevé.')
    }

    console.log('\nPar phase')
    printTable(
        ['Phase', 'Durée', 'Mesures', 'RAM moy', 'RAM max', 'Privée moy', 'Principal', 'GPU', 'Pages', 'Autres', 'CPU moy', 'CPU max'],
        [...summary.stats].map(([name, s]) => [
            name, seconds(s.duration), s.n, mb(s.totalAvg), mb(s.totalMax), mb(s.privateAvg),
            mb(s.principal), mb(s.gpu), mb(s.pages), mb(s.autres), percent(s.cpuAvg), percent(s.cpuMax)
        ])
    )
    printLegend()
}

function printComparison(before, after) {
    printHeader(before)
    console.log()
    printHeader(after)

    console.log(`\nComparaison ${runTitle(before)} → ${runTitle(after)}`)

    console.log('\nDémarrage (depuis le lancement du process)')
    const markNames = [...new Set([...before.marks.keys(), ...after.marks.keys()])]
    printTable(
        ['Étape', 'Avant → après'],
        markNames.map(name => [name, compareCell(before.marks.get(name), after.marks.get(name), ms)])
    )

    console.log('\nPar phase')
    const phaseNames = [...new Set([...before.stats.keys(), ...after.stats.keys()])]
    printTable(
        ['Phase', 'RAM moy', 'RAM max', 'CPU moy', 'Durée'],
        phaseNames.map(name => {
            const a = before.stats.get(name) ?? {}
            const b = after.stats.get(name) ?? {}
            return [
                name,
                compareCell(a.totalAvg, b.totalAvg, mb),
                compareCell(a.totalMax, b.totalMax, mb),
                compareCell(a.cpuAvg, b.cpuAvg, percent),
                compareCell(a.duration, b.duration, seconds)
            ]
        })
    )
    printLegend()
}

function printLegend() {
    console.log(`
  RAM : working set, somme de tous les process du launcher (les pages partagées
  sont comptées plusieurs fois). Privée : mémoire propre à chaque process.
  CPU : somme des process, 100 % = un cœur entier occupé (le Gestionnaire des
  tâches divise en plus par le nombre de cœurs).
  Pas comptés : Java (le jeu) et le process de vérification/téléchargement des
  fichiers (FullRepair), lancés hors d'Electron.
  La durée des phases « vue:* » dépend de ton utilisation, compare plutôt leurs
  moyennes.`)
}

function main() {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) {
        console.log(HELP)
        return
    }

    let files = args.files
    if (files.length === 0) {
        files = listRuns(args.dir).slice(args.compare ? -2 : -1)
        if (args.compare && files.length < 2) {
            fail('Il faut au moins deux relevés pour comparer.')
        }
    }
    if (files.length > 2) {
        fail('Donne un ou deux relevés.')
    }

    const summaries = files.map(file => summarize(readRun(file)))
    if (summaries.length === 1) {
        printRun(summaries[0])
    } else {
        printComparison(summaries[0], summaries[1])
    }
}

try {
    main()
} catch (err) {
    console.error(err.isUserError ? err.message : err)
    process.exitCode = 1
}
