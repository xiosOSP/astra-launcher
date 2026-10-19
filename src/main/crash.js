'use strict'
// Разбор вылета: смотрим лог игры, отчёт crash-reports/ и файл падения Java (hs_err_pid*.log)
// и превращаем самые частые причины в понятный текст и одну-две кнопки «что сделать».
const fs = require('fs')
const path = require('path')

// Версия формата классов → нужная Java.
const CLASS_TO_JAVA = { 52: 8, 53: 9, 54: 10, 55: 11, 56: 12, 57: 13, 58: 14, 59: 15, 60: 16, 61: 17, 62: 18, 63: 19, 64: 20, 65: 21, 66: 22, 67: 23, 68: 24, 69: 25 }

function newestFile (dir, re, since) {
  try {
    return fs.readdirSync(dir)
      .filter(f => re.test(f))
      .map(f => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter(x => x.t >= since - 5000)
      .sort((a, b) => b.t - a.t)[0]?.f || null
  } catch { return null }
}

function readHead (file, max = 200000) {
  try {
    const buf = fs.readFileSync(file)
    return buf.subarray(0, max).toString('utf8')
  } catch { return '' }
}

// Переводим типовые советы Fabric на русский.
function translateFabric (t) {
  return t
    .replace(/\bfabric-api\b/g, 'Fabric API')
    .replace(/^Install (.+?), any version\.?$/, 'Установить $1 (любую версию)')
    .replace(/^Install (.+?), version (.+?)\.?$/, 'Установить $1 версии $2')
    .replace(/^Replace (.+?) with any version that is compatible with (.+?)\.?$/, 'Заменить $1 на версию, которая подходит для $2')
    .replace(/^Remove mod (.+?)\.?$/, 'Удалить мод $1')
    .replace(/^Install /, 'Установить ')
    .replace(/^Replace /, 'Заменить ')
}

const uniq = arr => [...new Set(arr.filter(Boolean))]

/**
 * lines — лог текущего запуска, instDir — папка сборки, startedAt — время запуска,
 * memoryGb — сколько памяти было выделено.
 * Возвращает { title, text, details[], actions[], reportFile }.
 */
function analyze ({ lines = [], instDir, startedAt = 0, memoryGb, code }) {
  const log = lines.join('\n')
  const report = instDir ? newestFile(path.join(instDir, 'crash-reports'), /^crash-.*\.txt$/, startedAt) : null
  const hsErr = instDir ? newestFile(instDir, /^hs_err_pid\d+\.log$/, startedAt) : null
  const reportText = report ? readHead(report) : ''
  const hsText = hsErr ? readHead(hsErr, 20000) : ''
  const all = log + '\n' + reportText + '\n' + hsText
  const base = { reportFile: report || hsErr || null, details: [] }

  // 1. Не хватило памяти
  if (/java\.lang\.OutOfMemoryError|GC overhead limit exceeded|Java heap space/.test(all)) {
    return { ...base, kind: 'memory', title: 'Игре не хватило памяти', text: `Сейчас игре выделено ${memoryGb} ГБ. Подними память в настройках — для сборок с модами обычно нужно 6–8 ГБ.`, actions: ['settings', 'log'] }
  }
  if (/Could not reserve enough space for|Invalid maximum heap size|Initial heap size set to a larger value/.test(all)) {
    return { ...base, kind: 'memory-too-much', title: 'Java не смогла выделить столько памяти', text: `Выделено ${memoryGb} ГБ — больше, чем сейчас свободно. Уменьши память в настройках или закрой тяжёлые программы.`, actions: ['settings', 'log'] }
  }

  // 2. Не та Java
  const cv = /class file version (\d+)(?:\.\d+)?\), this version of the Java Runtime only recognizes class file versions up to (\d+)/.exec(all)
  if (cv || /UnsupportedClassVersionError/.test(all)) {
    const need = cv ? CLASS_TO_JAVA[Number(cv[1])] : null
    const have = cv ? CLASS_TO_JAVA[Number(cv[2])] : null
    return { ...base, kind: 'java', title: 'Не та версия Java', text: need ? `Игре или моду нужна Java ${need}, а запущена Java ${have || 'старее'}. Включи автоматический выбор Java в настройках — лаунчер сам скачает нужную.` : 'Игре или моду нужна более новая Java. Включи автоматический выбор Java в настройках.', actions: ['settings', 'log'] }
  }

  // 3. Fabric: не хватает модов или они несовместимы
  if (/Incompatible mods? found|Mod resolution failed|Mod resolution encountered an incompatible mod set|which is missing!|requires (?:any|version)/.test(all)) {
    const details = []
    const solution = /A potential solution has been determined[^\n]*:\s*\n([\s\S]*?)(?:\n\s*\n|More details:|$)/.exec(all)
    if (solution) {
      for (const l of solution[1].split('\n')) {
        const t = l.replace(/^[\s\t-]*/, '').trim()
        if (t) details.push(translateFabric(t))
      }
    }
    for (const m of all.matchAll(/^\s*-\s*(Mod '[^\n]*?(?:requires|is incompatible with|conflicts with)[^\n]*)$/gm)) details.push(m[1].trim())
    for (const m of all.matchAll(/Mod '?([^'\n]+?)'? \(([\w-]+)\)[^\n]*requires any version of ([\w-]+), which is missing!/g)) {
      details.push(`Мод «${m[1]}» требует ${m[3] === 'fabric' || m[3] === 'fabric-api' ? 'Fabric API' : m[3]}`)
    }
    return { ...base, kind: 'mods', title: 'Моды не подходят друг к другу', text: 'Какому-то моду не хватает другого мода или он не подходит к этой версии игры. Ниже — что советует сам Fabric.', details: uniq(details).slice(0, 8), actions: ['mods', 'log'] }
  }

  // 4. Один мод установлен дважды
  if (/Duplicate mods?|Found duplicate mod|duplicate mod ids?/i.test(all)) {
    const ids = uniq([...all.matchAll(/[Dd]uplicate mods?[^\n]*?\b([\w-]+)\b/g)].map(m => m[1])).slice(0, 5)
    return { ...base, kind: 'duplicate', title: 'Один мод установлен дважды', text: 'В папке модов лежат две версии одного мода. Удали лишнюю.', details: ids, actions: ['mods', 'log'] }
  }

  // 5. Сломанный мод (Mixin)
  const mixin = [...all.matchAll(/Mixin apply(?: for mod)? ([\w-]+) failed|from mod ([\w-]+)\] failed|mixins? from mod ([\w-]+)/g)].map(m => m[1] || m[2] || m[3])
  if (mixin.length && /MixinApplyError|MixinTransformerError|InvalidMixinException|Mixin apply/.test(all)) {
    const mods = uniq(mixin).filter(m => !['minecraft', 'java', 'fabricloader'].includes(m)).slice(0, 4)
    return { ...base, kind: 'mixin', title: mods.length ? `Мод ${mods.join(', ')} не работает с этой версией` : 'Один из модов не работает с этой версией', text: 'Мод пытается изменить игру, но эта версия ему не подходит. Обнови его, выключи или удали.', details: mods, actions: ['mods', 'log'] }
  }

  // 6. Видеодрайвер
  if (/GLFW error 65542|WGL: The driver does not appear to support OpenGL|Pixel format not accelerated|No OpenGL context|OpenGL 3\.2 or later|nvoglv64\.dll|atio6axx\.dll|ig\w*icd(32|64)\.dll|amdxc64\.dll/.test(all)) {
    return { ...base, kind: 'gpu', title: 'Проблема с видеодрайвером', text: 'Игра не смогла запустить графику. Обнови драйвер видеокарты с сайта NVIDIA, AMD или Intel. На ноутбуке проверь, что игра запускается на дискретной видеокарте.', actions: ['log'] }
  }

  // 7. Общий случай: берём описание из отчёта и первую ошибку
  const desc = /^Description: (.+)$/m.exec(reportText)
  const exc = /^((?:[\w$]+\.)+[\w$]*(?:Exception|Error)(?::[^\n]*)?)$/m.exec(reportText || log)
  const suspects = /Suspected Mods?:\s*([^\n]+)/i.exec(reportText)
  const details = uniq([
    desc && `Описание: ${desc[1]}`,
    exc && exc[1].slice(0, 300),
    suspects && suspects[1] && !/None|Unknown/i.test(suspects[1]) && `Возможная причина — моды: ${suspects[1].slice(0, 200)}`
  ])
  if (!details.length) {
    const lastErr = lines.filter(l => /ERROR|Exception|FATAL/.test(l)).slice(-2)
    details.push(...lastErr.map(l => l.slice(0, 300)))
  }
  return {
    ...base,
    kind: 'unknown',
    title: 'Игра вылетела',
    text: suspects && !/None|Unknown/i.test(suspects[1]) ? 'Похоже, дело в моде из списка ниже. Попробуй его выключить.' : `Код выхода ${code}. Ниже — то, что игра успела написать. Полный текст — в логе${report ? ' и в отчёте о вылете' : ''}.`,
    details: details.slice(0, 6),
    actions: suspects ? ['mods', 'log'] : ['log']
  }
}

module.exports = { analyze }
