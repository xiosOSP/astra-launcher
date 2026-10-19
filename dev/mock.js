'use strict'
// Тестовые данные для разработки без сети: ASTRA_MOCK=1 npm start
const fs = require('fs')
const path = require('path')

const SIZES = new Map()
function fakeUrl (name, size) {
  const url = 'https://piston-data.mojang.com/mock/' + name
  SIZES.set(url, size)
  return url
}

const releases = ['1.21.10', '1.21.9', '1.21.8', '1.21.4', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.17.1', '1.16.5', '1.12.2', '1.8.9', '1.7.10']
const snapshots = ['25w41a', '25w40a', '1.21.10-rc1']
const old = ['b1.7.3', 'a1.2.6']

function manifest () {
  let t = Date.parse('2025-10-07T10:00:00Z')
  const versions = []
  const push = (id, type) => { versions.push({ id, type, url: `https://piston-meta.mojang.com/v1/packages/x/${id}.json`, releaseTime: new Date(t).toISOString() }); t -= 1000 * 3600 * 24 * 40 }
  snapshots.forEach(id => push(id, 'snapshot'))
  releases.forEach(id => push(id, 'release'))
  old.forEach(id => push(id, id.startsWith('b') ? 'old_beta' : 'old_alpha'))
  versions.sort((a, b) => b.releaseTime.localeCompare(a.releaseTime))
  return { latest: { release: '1.21.10', snapshot: '25w41a' }, versions }
}

const mods = [
  ['AANobbMI', 'Sodium', 'The fastest and most compatible rendering optimization mod for Minecraft.', 'jellysquid3', 98e6, ['optimization'], 0xdc4b3a],
  ['P7dR8mSH', 'Fabric API', 'Lightweight and modular API providing common hooks and intercompatibility measures.', 'modmuss50', 120e6, ['library'], 0xdbb69b],
  ['gvQqBUqZ', 'Lithium', 'No-compromises game logic optimization mod.', 'jellysquid3', 52e6, ['optimization'], 0x7bd4a6],
  ['YL57xq9U', "Iris Shaders", 'A modern shader pack loader for Minecraft intended to be compatible with existing OptiFine shader packs.', 'coderbot', 61e6, ['decoration', 'optimization'], 0x8b5cf6],
  ['mOgUt4GM', 'Mod Menu', 'Adds a mod menu to view the list of mods you have installed.', 'Prospector', 70e6, ['library', 'utility'], 0x2ea043],
  ['lfHFW1mp', 'JourneyMap', 'Real-time mapping in game or in a web browser as you explore.', 'techbrew', 24e6, ['adventure', 'utility'], 0x3a7bd5],
  ['NNAgCjsB', 'Entity Culling', 'Using async path-tracing to hide Block-/Entities that are not visible.', 'tr7zw', 40e6, ['optimization'], 0xe0b04a],
  ['5ZwdcRci', 'ImmediatelyFast', 'Speed up immediate mode rendering in Minecraft.', 'RaphiMC', 33e6, ['optimization'], 0xf06292],
  ['1IjD5062', 'Continuity', 'A Fabric mod that allows for efficient connected textures.', 'PepperCode1', 19e6, ['decoration'], 0x60a5fa],
  ['w7ThoJFB', 'Zoomify', 'A zoom mod with infinite customizability.', 'isXander', 15e6, ['utility'], 0xfacc15],
  ['EsAfCjCV', 'AppleSkin', 'Food-related HUD improvements.', 'squeek502', 28e6, ['food', 'utility'], 0x84cc16],
  ['1bokaNcj', "Xaero's Minimap", 'Displays a map of the nearby world terrain, players, mobs and more.', 'thexaero', 30e6, ['adventure', 'utility'], 0x94a3b8],
  ['qANg5Jrr', 'e4mc', 'Open your singleplayer world to anyone, anywhere, without port forwarding.', 'skyecodes', 8e6, ['utility'], 0x38bdf8]
]

// Проверка модов: файл мода в тестовом режиме = 'mock:' + адрес, так что хеш известен заранее.
const sha1 = t => require('crypto').createHash('sha1').update(t).digest('hex')
const MOCK_FORGE = sha1('mock:forge-mod')
function versionByHash (h) {
  if (h === MOCK_FORGE) return { id: 'vForge', project_id: 'FoRgE001', loaders: ['forge'], game_versions: ['1.20.1'], dependencies: [], files: [] }
  for (const m of mods) {
    const url = `https://cdn.modrinth.com/data/${m[0]}/file`
    if (sha1('mock:' + url) !== h) continue
    const deps = m[0] === 'AANobbMI' ? [] : [{ project_id: 'P7dR8mSH', dependency_type: 'required' }]
    if (m[0] === 'lfHFW1mp') deps.push({ project_id: '1bokaNcj', dependency_type: 'incompatible' })
    return { id: 'v' + m[0], project_id: m[0], loaders: ['fabric', 'quilt'], game_versions: ['1.21.10'], dependencies: m[0] === 'P7dR8mSH' ? [] : deps, files: [{ hashes: { sha1: h }, url, filename: m[1] + '.jar' }] }
  }
  return null
}
const packs = [
  ['XRBjqjo3', 'Faithful 32x', 'Faithful is a resource pack that doubles the resolution of the default textures.', 'Faithful', 9e6, ['32x'], 0x4ade80],
  ['50dA9Sha', 'Fresh Animations', 'Breathe life into your world with smooth new mob animations.', 'FreshLX', 12e6, ['entities'], 0xfb923c],
  ['4jcbqh1l', 'Stay True', 'A vanilla-friendly resource pack that keeps the spirit of the original.', 'Steelfeathers', 6e6, ['blocks'], 0x22d3ee],
  ['8hQo1Z9Q', 'Bare Bones', 'The simple, clean look of the official trailers.', 'RobotPants', 7e6, ['simplistic'], 0xa3a3a3],
  ['Wx3aU5Hk', "Dramatic Skys", 'Gives your skies a beautiful overhaul.', 'Pugduddly', 4e6, ['environment'], 0x818cf8],
  ['Gp0cN1kL', 'Low Fire', 'Lowers the fire overlay so you can see.', 'Juknum', 3e6, ['utility'], 0xef4444]
]

const shaders = [
  ['HVnmMxH1', 'Complementary Reimagined', 'Shaderpack focused on high-quality visuals while keeping the Minecraft look.', 'EminGT', 20e6, ['atmosphere', 'shadows'], 0x6aa9ff],
  ['BVzZfTc1', 'BSL Shaders', 'Bright, colorful and soft shaders with many options.', 'CaptTatsu', 15e6, ['bloom', 'shadows'], 0xffb24a],
  ['Iq1z5pJc', 'MakeUp - Ultra Fast', 'Lightweight shaders for weak PCs.', 'XorDev', 6e6, ['potato', 'lightweight'], 0x84cc16]
]
const modpacks = [
  ['1KVo5zza', 'Fabulously Optimized', 'Improve your graphics and performance with this simple modpack.', 'robotkoer', 9e6, ['optimization', 'lightweight'], 0x8b5cf6, '1.21.10', 22],
  ['ZYcHoqIo', 'Cobblemon Official Modpack', 'The official Cobblemon modpack with extra quality of life mods.', 'Cobblemon', 3e6, ['adventure'], 0xf87171, '1.21.1', 48],
  ['JkSi2Fzx', 'Simply Optimized', 'The best mods for performance, nothing else.', 'HyperSoop', 2e6, ['optimization'], 0x22d3ee, '1.21.4', 15]
]

function hit (m, type) {
  return {
    project_id: m[0], slug: m[1].toLowerCase().replace(/\W+/g, '-'), title: m[1], description: m[2], author: m[3],
    downloads: m[4], follows: Math.round(m[4] / 900), display_categories: m[5], icon_url: null, color: m[6], project_type: type
  }
}

function json (url) {
  const u = new URL(url)
  if (u.pathname.endsWith('version_manifest_v2.json')) return manifest()
  if (u.pathname.endsWith('/assets/17.json')) {
    const objects = {}
    for (let i = 0; i < 600; i++) {
      const hash = (i.toString(16).padStart(4, '0') + 'a'.repeat(36))
      objects['minecraft/sounds/s' + i + '.ogg'] = { hash, size: 20000 + (i * 7919) % 400000 }
      SIZES.set('https://resources.download.minecraft.net/' + hash.slice(0, 2) + '/' + hash, objects['minecraft/sounds/s' + i + '.ogg'].size)
    }
    return { objects }
  }
  if (u.hostname === 'meta.fabricmc.net') {
    if (u.pathname === '/v2/versions/game') return releases.map(v => ({ version: v, stable: true }))
    const m = u.pathname.match(/^\/v2\/versions\/loader\/([^/]+)\/([^/]+)\/profile\/json$/)
    if (m) return { id: `fabric-loader-${m[2]}-${m[1]}`, inheritsFrom: m[1], mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', libraries: [] }
    return [{ loader: { version: '0.17.2', stable: true } }]
  }
  if (u.pathname.startsWith('/v1/packages/')) {
    const id = decodeURIComponent(path.basename(u.pathname, '.json'))
    const lib = (n, size) => ({ name: 'mock:' + n + ':1', downloads: { artifact: { url: fakeUrl('lib-' + n, size), path: 'mock/' + n + '.jar', size, sha1: 'x' } } })
    return {
      id,
      type: 'release',
      javaVersion: { majorVersion: 21 },
      downloads: { client: { url: fakeUrl('client-' + id, 26e6), size: 26e6, sha1: 'x' } },
      libraries: Array.from({ length: 40 }, (_, i) => lib('l' + i, 3e5 + i * 4e4)),
      assetIndex: { id: '17', url: 'https://piston-meta.mojang.com/v1/packages/assets/17.json', size: 1, sha1: 'x' },
      logging: { client: { file: { id: 'client-1.12.xml', url: fakeUrl('log', 900), size: 900, sha1: 'x' } } }
    }
  }
  if (u.hostname === 'api.adoptium.net') {
    return [{ release_name: 'jdk-21.0.5+11', binary: { package: { name: 'OpenJDK21U-jre_x64_windows.zip', link: fakeUrl('java', 45e6), size: 45e6, checksum: null } } }]
  }
  if (u.hostname === 'api.modrinth.com') {
    if (u.pathname === '/v2/projects') {
      const ids = JSON.parse(u.searchParams.get('ids') || '[]')
      return ids.map(id => { const m = [...mods, ...packs, ...shaders, ...modpacks].find(x => x[0] === id); return { id, title: m ? m[1] : 'Forge Mod', slug: id } })
    }
    if (u.pathname === '/v2/search') {
      const facets = u.searchParams.get('facets') || ''
      const kind = facets.includes('modpack') ? 'modpack' : facets.includes('shader') ? 'shader' : facets.includes('resourcepack') ? 'resourcepack' : 'mod'
      const table = { mod: mods, resourcepack: packs, shader: shaders, modpack: modpacks }[kind]
      const q = (u.searchParams.get('query') || '').toLowerCase()
      const src = table.filter(m => !q || m[1].toLowerCase().includes(q))
      const off = Number(u.searchParams.get('offset')) || 0
      const lim = Number(u.searchParams.get('limit')) || 20
      return { total_hits: src.length, hits: src.slice(off, off + lim).map(m => ({ ...hit(m, kind), versions: m[7] ? [m[7]] : [] })) }
    }
    const pm = u.pathname.match(/^\/v2\/project\/([^/]+)(\/version)?$/)
    if (pm) {
      const m = [...mods, ...packs, ...shaders, ...modpacks].find(x => x[0] === pm[1]) || mods[0]
      const isPack = packs.includes(m) || shaders.includes(m)
      if (!pm[2]) return { title: m[1], slug: m[1].toLowerCase().replace(/\W+/g, '-'), description: m[2], icon_url: null }
      if (modpacks.includes(m)) {
        const url = `https://cdn.modrinth.com/mock/${m[0]}.mrpack`
        MRPACKS.set(url, m)
        return [{ id: 'v' + m[0], version_number: '2.1.0', version_type: 'release', date_published: '2025-09-01T00:00:00Z', game_versions: [m[7]],
          files: [{ primary: true, filename: m[1].replace(/\W+/g, '') + '-2.1.0.mrpack', url, hashes: {} }], dependencies: [] }]
      }
      return [{
        id: 'v' + m[0],
        version_number: '1.0.0', version_type: 'release', date_published: '2025-09-01T00:00:00Z',
        files: [{ primary: true, filename: `${m[1].replace(/\W+/g, '')}-1.0.0.${isPack ? 'zip' : 'jar'}`, url: `https://cdn.modrinth.com/data/${m[0]}/file`, hashes: {} }],
        dependencies: m[0] === 'AANobbMI' ? [] : (isPack ? [] : [{ project_id: 'P7dR8mSH', dependency_type: 'required' }])
      }]
    }
  }
  throw new Error('mock: нет данных для ' + url)
}

const MRPACKS = new Map()

// Настоящий .mrpack: индекс с модами и папка overrides.
function buildMrpack (m, dest) {
  const yazl = require('yazl')
  const zip = new yazl.ZipFile()
  const files = Array.from({ length: m[8] }, (_, i) => {
    const url = `https://cdn.modrinth.com/data/mock/mod${i}.jar`
    SIZES.set(url, 150000 + i * 20000)
    return { path: `mods/mock-mod-${i}.jar`, hashes: { sha1: 'x'.repeat(40), sha512: 'x' }, env: { client: 'required', server: 'required' }, downloads: [url], fileSize: 150000 + i * 20000 }
  })
  const index = { formatVersion: 1, game: 'minecraft', versionId: '2.1.0', name: m[1], files, dependencies: { minecraft: m[7], 'fabric-loader': '0.16.9' } }
  zip.addBuffer(Buffer.from(JSON.stringify(index)), 'modrinth.index.json')
  zip.addBuffer(Buffer.from('fov:90\n'), 'overrides/options.txt')
  zip.addBuffer(Buffer.from('enabled=true\n'), 'overrides/config/mock.properties')
  zip.end()
  return new Promise((resolve, reject) => {
    zip.outputStream.pipe(fs.createWriteStream(dest)).on('close', resolve).on('error', reject)
  })
}

// Имитация скорости: ~6 МБ/с на поток, размер берём из таблицы фейковых адресов.
async function download (url, dest, onProgress, signal) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (MRPACKS.has(url)) { await buildMrpack(MRPACKS.get(url), dest); return dest }
  const size = SIZES.get(url) || 200000
  const speed = 6 * 1048576
  let got = 0
  while (got < size) {
    await new Promise(r => setTimeout(r, 100))
    if (signal && signal.aborted) throw new Error('Загрузка отменена')
    got = Math.min(size, got + speed / 10)
    if (onProgress) onProgress(got, size)
  }
  // Содержимое зависит от адреса — у разных модов разные хеши.
  fs.writeFileSync(dest, Buffer.from('mock:' + url))
  return dest
}

// Ely.by: «bad» — неверный пароль, «2fa» — нужен код 123456.
async function post (url, body) {
  await new Promise(r => setTimeout(r, 300))
  const u = new URL(url)
  if (u.pathname === '/auth/authenticate') {
    const [pass, code] = String(body.password).split(':')
    if (pass === 'bad') return { status: 401, ok: false, data: { error: 'ForbiddenOperationException', errorMessage: 'Invalid credentials. Invalid email or password.' } }
    if (pass === '2fa' && !code) return { status: 401, ok: false, data: { error: 'ForbiddenOperationException', errorMessage: 'Account protected with two factor auth.' } }
    if (pass === '2fa' && code !== '123456') return { status: 401, ok: false, data: { error: 'ForbiddenOperationException', errorMessage: 'Invalid credentials. Invalid email or password.' } }
    const name = String(body.username).split('@')[0].replace(/\W/g, '').slice(0, 16) || 'ElyPlayer'
    const id = require('crypto').createHash('md5').update(name).digest('hex')
    return { status: 200, ok: true, data: { accessToken: 'tok-' + Date.now(), clientToken: body.clientToken, selectedProfile: { id, name } } }
  }
  if (u.hostname === 'api.modrinth.com' && u.pathname === '/v2/version_files') {
    const out = {}
    for (const h of body.hashes || []) { const v = versionByHash(h); if (v) out[h] = v }
    return { status: 200, ok: true, data: out }
  }
  if (u.pathname === '/auth/refresh') return { status: 200, ok: true, data: { accessToken: 'tok-' + Date.now(), clientToken: body.clientToken } }
  return { status: 200, ok: true, data: null }
}

module.exports = { json, download, post }
