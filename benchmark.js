'use strict'

// Launcher benchmark: samples the RAM and CPU of every launcher process
// (app.getAppMetrics) and records the launcher steps sent by the renderer.
// Off unless the launcher is started with --bench[=label] (npm run bench) or
// ZUKI_BENCH=1|label. Each run is written to userData/benchmarks, read it with
// npm run bench:report.

const { app, ipcMain } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SAMPLE_INTERVAL = 1000
const MAX_NAME_LENGTH = 64

let file = null
let phase = 'demarrage'
let gpuWritten = false

/**
 * @returns {string | null} The run label, '' for an unlabeled run, or null if
 * the benchmark is disabled.
 */
function getLabel() {
    if (app.commandLine.hasSwitch('bench')) {
        return app.commandLine.getSwitchValue('bench')
    }
    const env = process.env.ZUKI_BENCH
    if (env == null || env === '' || env === '0') {
        return null
    }
    return env === '1' ? '' : env
}

/**
 * @returns {number} Milliseconds since the process started.
 */
function now() {
    return Math.round(process.uptime() * 1000)
}

function write(entry) {
    fs.appendFileSync(file, JSON.stringify(entry) + '\n')
}

function sample() {
    write({
        type: 'sample',
        t: now(),
        phase,
        // Memory values are in KB, cpu in % of the whole machine (all cores)
        // over the last interval.
        processes: app.getAppMetrics().map(metric => ({
            pid: metric.pid,
            type: metric.type,
            name: metric.name ?? metric.serviceName,
            workingSet: metric.memory.workingSetSize,
            privateBytes: metric.memory.privateBytes ?? null,
            cpu: metric.cpu.percentCPUUsage
        }))
    })
}

function writeGpu() {
    if (gpuWritten) {
        return
    }
    gpuWritten = true
    const features = app.getGPUFeatureStatus()
    write({
        type: 'gpu',
        t: now(),
        hardwareAcceleration: app.isHardwareAccelerationEnabled(),
        compositing: features.gpu_compositing,
        rasterization: features.rasterization
    })
}

function sanitizeName(name) {
    return typeof name === 'string' && name.length > 0 ? name.slice(0, MAX_NAME_LENGTH) : null
}

/**
 * Record a point in time (startup step...). No-op if the benchmark is disabled.
 *
 * @param {string} name The step name.
 */
exports.mark = function(name) {
    if (file != null) {
        write({ type: 'mark', t: now(), name, phase })
    }
}

/**
 * Start a new phase: the following samples are attributed to it. No-op if the
 * benchmark is disabled.
 *
 * @param {string} name The phase name.
 */
exports.setPhase = function(name) {
    if (file == null || name === phase) {
        return
    }
    phase = name
    write({ type: 'phase', t: now(), name })
}

/**
 * @returns {boolean} True if this run is benchmarked.
 */
exports.isEnabled = function() {
    return file != null
}

/**
 * Start the benchmark if it was requested. Must be called before app ready so
 * that the startup steps are recorded.
 */
exports.start = function() {
    const label = getLabel()
    if (label == null) {
        return
    }

    const dir = path.join(app.getPath('userData'), 'benchmarks')
    fs.mkdirSync(dir, { recursive: true })
    const date = new Date()
    const fileLabel = label.replace(/[^\w-]/g, '_')
    file = path.join(dir, `bench-${date.toISOString().replace(/[:.]/g, '-')}${fileLabel ? `-${fileLabel}` : ''}.jsonl`)

    const cpus = os.cpus()
    write({
        type: 'meta',
        label,
        date: date.toISOString(),
        version: app.getVersion(),
        electron: process.versions.electron,
        packaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        osRelease: os.release(),
        cpu: cpus[0]?.model?.trim() ?? null,
        cores: cpus.length,
        totalMem: Math.round(os.totalmem() / 1024),
        sampleInterval: SAMPLE_INTERVAL
    })
    write({ type: 'phase', t: 0, name: phase })
    console.log(`Benchmark activé, relevé écrit dans ${file}`)

    ipcMain.on('bench:mark', (_event, name) => {
        name = sanitizeName(name)
        if (name != null) {
            exports.mark(name)
        }
    })
    ipcMain.on('bench:phase', (_event, name) => {
        name = sanitizeName(name)
        if (name != null) {
            exports.setPhase(name)
        }
    })

    app.once('gpu-info-update', writeGpu)

    app.whenReady().then(() => {
        exports.mark('app-prete')
        // The first call only starts the CPU measurement interval.
        app.getAppMetrics()
        const timer = setInterval(sample, SAMPLE_INTERVAL)

        app.once('will-quit', () => {
            clearInterval(timer)
            sample()
            writeGpu()
            exports.mark('fermeture')
            console.log(`Benchmark terminé : ${file}`)
        })
    })
}
