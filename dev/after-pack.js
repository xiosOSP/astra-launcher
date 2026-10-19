// Хук electron-builder: вшивает иконку и сведения о программе в AstraLauncher.exe.
// Делается на чистом JS (resedit), поэтому сборка под Windows работает и с Linux без wine.
const fs = require('fs')
const path = require('path')
const ResEdit = require('resedit')

exports.default = async function afterPack (context) {
  if (context.electronPlatformName !== 'win32') return
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  const pkg = context.packager.appInfo
  const data = fs.readFileSync(exe)
  const exeFile = ResEdit.NtExecutable.from(data, { ignoreCert: true })
  const res = ResEdit.NtExecutableResource.from(exeFile)

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')))
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, 1, 1033, iconFile.icons.map(i => i.data)
  )

  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty()
  // 0.2.0-v1 → 0.2.0.1
  const [major, minor, patch, rev] = require('../src/main/appversion').fileVersion(pkg.version)
  vi.setFileVersion(major, minor, patch, rev, 1033)
  vi.setProductVersion(major, minor, patch, rev, 1033)
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: 'AstraLauncher',
    FileDescription: 'AstraLauncher',
    CompanyName: 'AstraLauncher',
    LegalCopyright: `© ${new Date().getFullYear()} AstraLauncher`,
    OriginalFilename: 'AstraLauncher.exe',
    InternalName: 'AstraLauncher',
    ProductVersion: require('../src/main/appversion').label(pkg.version)
  })
  vi.outputToResourceEntries(res.entries)

  res.outputResource(exeFile)
  fs.writeFileSync(exe, Buffer.from(exeFile.generate()))
  console.log('  • icon and version info written  exe=' + path.basename(exe))
}
