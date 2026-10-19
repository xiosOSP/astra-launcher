'use strict'
// Производительность: сколько памяти дать игре, слабый ли компьютер,
// облегчённые настройки графики для новых сборок и параметры сборщика мусора Java.
const fs = require('fs')
const os = require('os')
const path = require('path')
const settings = require('./settings')

let gpuCache = null

// Видеокарты из Chromium. vendorId: 0x10de NVIDIA, 0x1002 AMD, 0x8086 Intel, 0x1414 Microsoft (без драйвера).
async function gpus () {
  if (gpuCache) return gpuCache
  try {
    const { app } = require('electron')
    const info = await Promise.race([app.getGPUInfo('basic'), new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout')), 3000))])
    gpuCache = (info.gpuDevice || []).map(d => ({ vendorId: d.vendorId, deviceId: d.deviceId, active: !!d.active, driverVersion: d.driverVersion || '' }))
  } catch { gpuCache = [] }
  if (process.env.ASTRA_MOCK_GPU === 'basic') gpuCache = [{ vendorId: 0x1414, deviceId: 0x8c, active: true, driverVersion: '' }]
  if (process.env.ASTRA_MOCK_GPU === 'intel') gpuCache = [{ vendorId: 0x8086, deviceId: 0x3e92, active: true, driverVersion: '31.0' }]
  return gpuCache
}

async function machine () {
  const list = await gpus()
  const ram = settings.totalRamGb()
  const cores = os.cpus().length || 1
  const integratedOnly = list.length > 0 && list.every(g => g.vendorId === 0x8086)
  const noDriver = list.some(g => g.vendorId === 0x1414)
  // Слабый: мало памяти, мало ядер или только встроенная графика Intel при 8 ГБ и меньше.
  const weak = ram <= 6 || cores <= 2 || ((integratedOnly || noDriver) && ram <= 8)
  return { ram, cores, integratedOnly, noDriver, weak, gpus: list }
}

function countMods (instDir) {
  try { return fs.readdirSync(path.join(instDir, 'mods')).filter(f => f.endsWith('.jar')).length } catch { return 0 }
}

// Новая ли версия игры (1.18+ и снапшоты 2x — им нужно больше памяти).
function isModern (version) {
  const m = /^1\.(\d+)/.exec(version || '')
  if (m) return Number(m[1]) >= 18
  return /^\d{2}[.w]/.test(version || '')
}

/**
 * Память для запуска в ГБ. В ручном режиме — из настроек.
 * В авто: обычная игра 2–3 ГБ, с модами 4–6 ГБ в зависимости от их числа,
 * но не больше 60 % памяти компьютера и так, чтобы системе осталось 2 ГБ.
 */
function memoryFor (profile, instDir, s = settings.load()) {
  if (s.memoryMode === 'manual') return { gb: s.memoryGb, auto: false }
  const total = settings.totalRamGb()
  const mods = profile.loader === 'fabric' ? countMods(instDir) : 0
  let want = isModern(profile.version) ? 3 : 2
  if (profile.loader === 'fabric') want = mods >= 100 ? 6 : mods >= 30 ? 5 : 4
  const gb = Math.max(1, Math.min(want, total - 2, Math.floor(total * 0.6)))
  return { gb, auto: true, mods }
}

// Есть ли у пользователя свой сборщик мусора в аргументах — тогда свой не добавляем.
function gcArgs (userArgs = '') {
  if (/-XX:\+Use\w+GC/.test(userArgs)) return []
  return [
    '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC',
    '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20', '-XX:InitiatingHeapOccupancyPercent=15'
  ]
}

async function lightWanted (s = settings.load()) {
  if (s.lightMode === 'on') return true
  if (s.lightMode === 'off') return false
  return (await machine()).weak
}

/**
 * Облегчённые настройки графики — только для новой сборки, у которой ещё нет options.txt.
 * Настройки, которые игрок уже менял, лаунчер не трогает.
 */
function applyLight (instDir, version) {
  const file = path.join(instDir, 'options.txt')
  if (fs.existsSync(file)) return false
  const m = /^1\.(\d+)/.exec(version || '')
  const minor = m ? Number(m[1]) : 99
  const lines = ['renderDistance:8', 'particles:1', 'entityShadows:false']
  if (minor >= 16) lines.push('graphicsMode:0'); else lines.push('fancyGraphics:false')
  if (minor >= 18) lines.push('simulationDistance:6')
  if (minor >= 13) lines.push('biomeBlendRadius:0')
  fs.mkdirSync(instDir, { recursive: true })
  fs.writeFileSync(file, lines.join('\n') + '\n')
  return true
}

module.exports = { machine, gpus, memoryFor, gcArgs, lightWanted, applyLight, countMods, isModern }
