'use strict'
// Проверка компьютера и модов перед запуском. Предупреждает заранее о том,
// из-за чего игра потом вылетит или не скачается: мало места, мало памяти,
// не установлен драйвер видеокарты, проблемы с модами.
const fs = require('fs')
const os = require('os')
const settings = require('./settings')
const versions = require('./versions')
const perf = require('./perf')
const modcheck = require('./modcheck')
const { normalize, instanceDir } = require('./profiles')

const GB = 1024 ** 3

function freeDisk (dir) {
  if (process.env.ASTRA_MOCK_DISK) return Number(process.env.ASTRA_MOCK_DISK) * 1024 ** 2
  try {
    fs.mkdirSync(dir, { recursive: true })
    const st = fs.statfsSync(dir)
    return st.bavail * st.bsize
  } catch { return null }
}

const fmtGb = b => (b / GB).toFixed(1).replace('.', ',').replace(',0', '') + ' ГБ'

function withTimeout (p, ms, fallback) {
  return Promise.race([p.catch(() => fallback), new Promise(resolve => setTimeout(() => resolve(fallback), ms))])
}

async function run (rawProfile) {
  const profile = normalize(rawProfile)
  const s = settings.load()
  const warnings = []

  // 1. Место на диске. Новой версии нужно ~0,6–1 ГБ, сборке — больше.
  const free = freeDisk(settings.gameDir())
  if (free !== null) {
    const installed = versions.isProfileInstalled(profile)
    const need = installed ? 0.3 * GB : (profile.pack ? 1.5 : 1) * GB
    if (free < need) {
      warnings.push({
        id: 'disk',
        level: 'error',
        title: 'Мало места на диске',
        text: installed
          ? `Свободно ${fmtGb(free)}. Игре может не хватить места, чтобы сохранить мир.`
          : `Свободно ${fmtGb(free)}, а для первого запуска нужно около ${fmtGb(need)}. Загрузка оборвётся.`,
        actions: [{ type: 'cleanup', label: 'Освободить место' }]
      })
    }
  }

  // 2. Свободная память.
  const mem = perf.memoryFor(profile, instanceDir(profile), s)
  const freeMem = Number(process.env.ASTRA_MOCK_FREEMEM || 0) * GB || os.freemem()
  if (freeMem < mem.gb * GB * 0.9) {
    warnings.push({
      id: 'ram',
      title: 'Мало свободной памяти',
      text: `Сейчас свободно ${fmtGb(freeMem)}, а игре нужно ${mem.gb} ГБ. Закрой браузер и другие тяжёлые программы, иначе игра будет тормозить или вылетит.`,
      actions: s.memoryMode === 'manual' ? [{ type: 'settings', label: 'Уменьшить память' }] : []
    })
  }

  // 3. Драйвер видеокарты.
  const m = await perf.machine()
  if (m.noDriver) {
    warnings.push({
      id: 'gpu-driver',
      title: 'Не установлен драйвер видеокарты',
      text: 'Windows работает со стандартным драйвером — с ним Minecraft обычно не запускается или идёт 5–10 кадров в секунду. Скачай драйвер с сайта производителя видеокарты или ноутбука.',
      actions: []
    })
  }

  // 4. Моды (до 5 секунд; без сети — пропускаем).
  const mods = await withTimeout(modcheck.check(profile), 5000, [])
  warnings.push(...mods)

  return warnings.filter(w => !s.muteWarnings.includes(w.id))
}

module.exports = { run, freeDisk }
