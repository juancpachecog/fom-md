"""W2: activa el release ya verificado, sin reconstruir ni repetir W1."""
import datetime as dt,fcntl,hashlib,json,os,pathlib,socket,stat,subprocess,tarfile,time,urllib.parse
assert os.geteuid()==0 and os.environ.get('SUDO_USER')=='fom-codex' and socket.gethostname()=='fom-app-01'
now=dt.datetime.now(dt.timezone.utc);assert dt.datetime(2026,11,5,1,tzinfo=dt.timezone.utc)<=now<dt.datetime(2026,11,5,3,tzinfo=dt.timezone.utc)
os.umask(0o077)
lock=os.open('/run/lock/fom-issue-775-web.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
site=pathlib.Path('/etc/nginx/sites-available/fom-mobile.conf')
mobile=pathlib.Path('/etc/nginx/fom-mobile-lifecycle-locations.conf')
source=pathlib.Path('/var/lib/fom-issue-775-web-contracts/mobile-lifecycle-796e853c.conf')
root=pathlib.Path('/var/www/fom-web/releases/issue-775-lifecycle-a3212fe')
oldroot=pathlib.Path('/var/www/fom-web/releases/issue-774-coban-reception-7231997')
backup=pathlib.Path('/opt/fom/state/prod/issue-775-lifecycle-web-retry-20261105T015500Z')
staged=pathlib.Path('/opt/fom/state/prod/issue-775-lifecycle-web-20261105T015000Z')
archive=pathlib.Path('/home/fom-codex/fom-775-lifecycle-a3212fe.tar.gz')
OLD='3ad833aa2012b83e6788066ff406382b859bd0a971d51dfa4b4db5b5bee0735d'
NEW='e45801a9f941d8343985a8b47a3bb904dcf9d9a9435b0dde6982dd0dafd65fd2'
MOBILE_OLD='b75e21ee4d14b68a816e97dab7ae50d1a9fd62f92224917e12b50bc3f471b372'
MOBILE_NEW='796e853c4fea379d2be037bc27ddb9fa3c87b68a277209f2d766bff30d4674b0'
INDEX='baa77130691e6ec0cce5185ab769ff73d66a6ceb76b1d8dfde534df3e4f19135'
OLD_INDEX='6c03b941590fe39bdeb1c136b106a0a80f608254e925fdf2acb15f517f18a036'
API='5a3ed915a3b36de94a459d052285e285562301c13cff0058a9ebc9ea9ad774d5'
IMAGE='sha256:d40d04a9c72a0471775880ecf77730b5e4b9e7be48b815422285616068341898'
deadline=time.monotonic()+600;restoring=False
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for block in iter(lambda:f.read(65536),b''):h.update(block)
 return h.hexdigest()
def private(path,raw):
 fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
def atomic(path,raw):
 temp=path.with_name('.'+path.name+'.fom775-w2.tmp');private(temp,raw);os.chown(temp,0,0);os.chmod(temp,0o644);os.replace(temp,path)
def command(args):
 left=deadline-time.monotonic();assert left>(0 if restoring else 120)
 p=subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,timeout=min(20,left))
 if p.returncode:
  if backup.exists():
   with (backup/'activation.private.log').open('ab') as f:f.write(p.stderr)
  raise RuntimeError('command_unconfirmed_'+args[0])
 return p.stdout
def curl(path):
 return command(['curl','--fail','--silent','--show-error','--max-time','10','--max-filesize','4194304','--header','Accept-Encoding: identity','--resolve','15.204.105.201:443:10.20.30.10','https://15.204.105.201'+urllib.parse.quote(path,safe='/')])
def status(path,method='GET'):
 return command(['curl','--silent','--max-time','10','--output','/dev/null','--write-out','%{http_code}','--request',method,*(['--header','Content-Type: application/json','--data','{}'] if method=='POST' else []),'--resolve','15.204.105.201:443:10.20.30.10','https://15.204.105.201'+path]).decode()
def api_gate():
 api,test=json.loads(command(['docker','inspect','fom-core-api','fom-test-api']))
 assert api['Id']==API and api['Image']==IMAGE and api['Config']['Labels']['org.opencontainers.image.revision']=='c139df433bf23bc6a3dd0171b5843fa562fed5f8'
 assert test['Id']=='e523de689e78878a1152fe45c3da6eda3801c9f87bc0992b3705d2978e8ace05'
 assert all(v['State']['Health']['Status']=='healthy' and v['RestartCount']==0 for v in (api,test))
api_gate()
for path,pin in ((site,OLD),(mobile,MOBILE_OLD),(source,MOBILE_NEW)):
 s=path.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_mode&0o022==0 and sha(path)==pin
assert not backup.exists() and not backup.is_symlink()
assert sha(archive)=='7b94d23a972f19e8a9bbdeb3a65d187ca1a33ba3385fb112a7f88a49ab5b309e'
with tarfile.open(archive) as t:raw=t.extractfile('./manifest.json').read()
assert hashlib.sha256(raw).hexdigest()=='eb7ed06442e455889e81c0e44a9ec4161938296b63f109353fe24e2ea963a6f2'
manifest=json.loads(raw);assert manifest['source']=='a3212fee716bf74012a6a867af7de7a71b9e582e' and len(manifest['files'])==1142
assets=[]
for f in manifest['files']:
 rel=pathlib.PurePosixPath(f['path']).relative_to('dist');assert '..' not in rel.parts
 path=root.joinpath(*rel.parts);s=path.lstat()
 assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_size==f['bytes'] and sha(path)==f['sha256']
 if str(rel).startswith('assets/') and path.suffix in ('.js','.css') and not oldroot.joinpath(*rel.parts).exists():assets.append((str(rel),f))
stage=json.loads((staged/'web-stage.json').read_bytes());assert stage['result']=='PASS' and stage['candidateFiles']==1142
for item in stage['retainedAssets']:
 p=root/item['path'];q=oldroot/item['path'];assert p.stat().st_ino==q.stat().st_ino and sha(p)==item['sha256']
assert sha(root/'index.html')==INDEX and sha(oldroot/'index.html')==OLD_INDEX and assets
old=site.read_bytes();old_mobile=mobile.read_bytes()
needle=b'root /var/www/fom-web/releases/issue-774-coban-reception-7231997;';assert old.count(needle)==1
new=old.replace(needle,b'root /var/www/fom-web/releases/issue-775-lifecycle-a3212fe;')
needle=b'include /etc/nginx/fom-mobile-vehicles-locations.conf;';assert new.count(needle)==1
new=new.replace(needle,b'include /etc/nginx/fom-mobile-lifecycle-locations.conf;\n    '+needle);assert hashlib.sha256(new).hexdigest()==NEW
backup.mkdir(mode=0o700);private(backup/'nginx.before-web.conf',old);private(backup/'mobile.before.conf',old_mobile)
report={'issue':775,'result':'FAIL','source':manifest['source'],'root':str(root),'startedAt':now.isoformat(),'databaseWrites':False,'apiRestart':False,'restoration':'NOT_NEEDED'}
changed=False
try:
 atomic(mobile,source.read_bytes());changed=True;atomic(site,new)
 command(['nginx','-t']);command(['systemctl','reload','nginx'])
 stable=0
 for attempt in range(20):
  stable=stable+1 if all(hashlib.sha256(curl(route)).hexdigest()==INDEX for route in ('/panel/admin/ciclo-datos','/panel/admin/vehiculos','/panel/admin/gps')) else 0
  if stable>=2:break
  time.sleep(0.5)
 else:raise RuntimeError('served_index_unstable')
 for rel,item in assets:
  data=curl('/'+rel);assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
 assert status('/fom-api/api/v1/console/lifecycle/global')=='401'
 assert status('/api/v1/mobile/lifecycle/global')=='401'
 assert status('/api/v1/mobile/lifecycle/global/test-sets','POST')=='401'
 assert status('/api/v1/mobile/lifecycle/unknown-route')=='404'
 assert status('/fom-api/api/v1/console/meitrack-setup/readiness','POST')=='401'
 assert status('/fom-api/api/v1/console/meitrack-setup/unknown-route')=='404'
 assert status('/gps-console-internal')=='404'
 api_gate()
 report.update(result='PASS',configSha256=sha(site),fragmentSha256=sha(mobile),servedIndexSha256=INDEX,filesVerified=1142,newAssetsHttps=len(assets),retainedAssets=len(stage['retainedAssets']),lifecycleWebMobileGuard=401,unknownRoute=404)
except Exception as error:
 report['failureCode']=str(error) if isinstance(error,RuntimeError) else type(error).__name__
 if changed:
  restoring=True
  try:
   atomic(site,old);atomic(mobile,old_mobile);command(['nginx','-t']);command(['systemctl','reload','nginx'])
   assert sha(site)==OLD and sha(mobile)==MOBILE_OLD and hashlib.sha256(curl('/panel/admin/vehiculos')).hexdigest()==OLD_INDEX
   report['restoration']='PASS_OLD_WEB_AND_FRAGMENT'
  except Exception:report['restoration']='UNKNOWN_STOP_NO_REPLAY'
report['finishedAt']=dt.datetime.now(dt.timezone.utc).isoformat()
private(backup/'web-activation.json',(json.dumps(report,indent=2)+'\n').encode());print(json.dumps(report))
raise SystemExit(0 if report['result']=='PASS' else 1)
