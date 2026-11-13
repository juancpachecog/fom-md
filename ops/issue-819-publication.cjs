'use strict'
// Prepare a fresh WEB-only helper from the reviewed #815 publisher. No network,
// activation, secret access or mutation of an existing contract occurs here.
const fs = require('node:fs'), crypto = require('node:crypto')
const SOURCE = '7e2e95da529045eef681bf0a0e1f8787e130155c'
const sha = s => crypto.createHash('sha256').update(s).digest('hex')
function once(s, a, b) {
  if (s.split(a).length !== 2) throw Error('publication template delta gate')
  return s.replace(a, b)
}
function generate(raw) {
  let s = raw.replace(/\r\n/g, '\n')
  if (sha(s) !== 'cb758151b588932291e68b9956d73cf3b1d08f1dce6fc014cbf0b6476a8e744a') throw Error('template hash gate')
  s = s.replace(/\b815\b/g, '819')
    .replaceAll('issue-819-live-8513d2f', 'issue-819-route-connected-7e2e95d')
    .replaceAll('issue-813-guide-608cfe3', 'issue-815-live-8513d2f')
    .replaceAll('8513d2f43d5fc784ac32d58e655a6b63cb4be78a', SOURCE)
    .replaceAll('live-8513d2f.tar.gz', 'route-connected-7e2e95d.tar.gz')
    .replaceAll('b7ffd127a6e689128cda5ee6f212e3193ffea4a1', '849979876222569e4a4d19a9c0d7e624464fbe32')
    .replaceAll('56f043599d98ba7673ec6233377b1406cd8335ceb50e27de9cde15e3c0080655', 'a37d1afe2d5f3646cbbdd57be255b61656cf69180a0cd8eef37dd8471a2fee85')
    .replaceAll('7f884e8640a77edd88eecbb277257052a06da8a2e90734978d512336ff9e393c', '2f600ad2baf45f6cff0fc78da2ca21539d5f1d327bd8b5a2e11d2221f8e1948f')
  s = once(s, "require(value.get('issue') == 819 and value.get('result') == 'PASS'", "require(value.get('issue') == 817 and value.get('result') == 'PASS'")
  s = once(s, "r'issue-819-publish-[0-9]{8}T[0-9]{6}Z', value.get('runId','')", "r'issue-817-publish-[0-9]{8}T[0-9]{6}Z', value.get('runId','')")
  s = once(s, "r'issue-819-publish-[0-9]{8}T[0-9]{6}Z',app_run", "r'issue-817-publish-[0-9]{8}T[0-9]{6}Z',app_run")
  s = once(s, "require(value['issue'] == 819", "require(value['issue'] == (817 if reference == app_run else 819)")
  // The old API execution receipt is an immutable baseline, not a new execution
  // window. api_gate below independently verifies its live container and image.
  // The NEW web stage retains its six-hour gate and both modes keep 120s starts.
  s = once(s,
    "require(0 <= (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(value['finishedAt'])).total_seconds() <= 21600, 'receipt_age')",
    "age = (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(value['finishedAt'])).total_seconds()\n                require(age >= 0 and (reference == app_run or age <= 21600), 'receipt_age')")
  s = once(s, "require('dist/index.html' in names", "require('dist/fom-build-profile.json' in names and 'dist/index.html' in names")
  s = once(s, "        require(info.st_size == item['bytes'] and sha(path) == item['sha256'], 'release_file_hash')",
    "        require(info.st_size == item['bytes'] and sha(path) == item['sha256'], 'release_file_hash')\n" +
    "    profile = json.loads((RELEASE/'fom-build-profile.json').read_text())\n" +
    "    require(profile == {'version':1,'application':'fom-panel','mode':'connected','apiBase':'/fom-api'," +
    "'mapboxConfigured':True,'publicConfigSha256':'fbf73e247db8911a65e6c55f228c4b37d3554a9dfb8b133369810cf6c70be69b'}, 'connected_profile_gate')")
  return s
}
module.exports = { generate }
if (require.main === module) {
  if (process.argv.length !== 4) throw Error('template and NEW output path required')
  const s = generate(fs.readFileSync(process.argv[2], 'utf8'))
  fs.writeFileSync(process.argv[3], s, { flag: 'wx', mode: 0o600 })
  console.log(sha(s))
}
