import pathlib,hashlib,json,tarfile,os,stat,subprocess,datetime,time,urllib.parse
now=datetime.datetime.now(datetime.timezone.utc)
assert datetime.datetime(2026,11,4,12,30,tzinfo=datetime.timezone.utc)<=now<datetime.datetime(2026,11,4,13,30,tzinfo=datetime.timezone.utc)
assert os.geteuid()==0
site=pathlib.Path('/etc/nginx/sites-available/fom-mobile.conf')
backup=pathlib.Path('/opt/fom/state/prod/issue-773-web-integration-20261104T123500Z')
oldroot=pathlib.Path('/var/www/fom-web/releases/issue-727-reception-2d27ff8')
newroot=pathlib.Path('/var/www/fom-web/releases/issue-773-integration-07aaf09')
archive=pathlib.Path('/home/fom-codex/fom-773-web-integration-07aaf09-prod1.tar.gz')
OLD='25de45b0002b99c613c39d9aff84c1f3973e2351bdaa7301e36156b4c16a74f6'
NEW='4ec7368a967e4faf79e314677847fb74c35c046d4ebe54f1685c0764eede94a7'
INDEX='99e968014c65ca8276f768965fa073bdf2baa4c095c3afc9921ebeb1cff82fa5'
os.umask(0o077)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(65536),b''):h.update(b)
 return h.hexdigest()
def command(args,**kw):
 return subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20,check=True,**kw)
def private_write(path,raw):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
def curl(path,limit=4*1024*1024):
 return command(['curl','--fail','--silent','--show-error','--max-time','10','--max-filesize',str(limit),'--header','Accept-Encoding: identity','--resolve','15.204.105.201:443:10.20.30.10','https://15.204.105.201'+urllib.parse.quote(path,safe='/')]).stdout
def status(path,method="GET"):
 return command(['curl','--silent','--show-error','--max-time','10','--output','/dev/null','--write-out','%{http_code}','--request',method,*(['--header','Content-Type: application/json','--data','{}'] if method=='POST' else []),'--resolve','15.204.105.201:443:10.20.30.10','https://15.204.105.201'+path]).stdout.decode()
version=json.loads(command(['curl','--fail','--silent','--max-time','10','http://127.0.0.1:3000/version']).stdout)
health=json.loads(command(['curl','--fail','--silent','--max-time','5','http://127.0.0.1:3000/health/meitrack']).stdout)
assert health=={'service':'meitrack','enabled':True,'status':'ok'}
assert version['commit']=='00320ebf362c96042b48c589c78f4b15a4685f60' and version['environment']=='prod'
info_api=json.loads(command(['docker','inspect','fom-core-api']).stdout)[0]
assert info_api['Id']=='63fd33e069fc85fea206a3b1b00c0099756474ad9eef8a05897d9849e59acb9d' and info_api['Image']=='sha256:0f8ed68e9563756bd3c06f2f93c7c9cace38772c5fe3b81f9d6ba9aff72c7be9' and info_api['State']['Health']['Status']=='healthy'
test_api=json.loads(command(['docker','inspect','fom-test-api']).stdout)[0]
assert test_api['Id']=='e523de689e78878a1152fe45c3da6eda3801c9f87bc0992b3705d2978e8ace05' and test_api['State']['Health']['Status']=='healthy'
info=site.lstat();assert stat.S_ISREG(info.st_mode) and info.st_uid==info.st_gid==0 and stat.S_IMODE(info.st_mode)==0o644
old=site.read_bytes();assert hashlib.sha256(old).hexdigest()==OLD
needle=b'root /var/www/fom-web/releases/issue-727-reception-2d27ff8;';assert old.count(needle)==1
new=old.replace(needle,b'root /var/www/fom-web/releases/issue-773-integration-07aaf09;');assert hashlib.sha256(new).hexdigest()==NEW
assert sha(archive)=='070881739064ee14a6a152f5a9d1546b711efa177c6a7ac5ef741dae8e0e5fbe'
with tarfile.open(archive) as t:raw=t.extractfile('./manifest.json').read()
assert hashlib.sha256(raw).hexdigest()=='614609a6c03344a8da3612331e1be7ffad721c178ba4bce9a6af7ed401c1cfa6'
manifest=json.loads(raw);assert manifest['source']=='07aaf09fb6373ee56806a1eff627eb7179122c12' and len(manifest['files'])==1139

assert not backup.exists() and not newroot.exists()
backup.mkdir(mode=0o700)
private_write(backup/'nginx.before-web.conf',old)
newroot.mkdir(mode=0o755);os.chmod(newroot,0o755)
with tarfile.open(archive) as delta:
 for item in manifest['files']:
  rel=pathlib.PurePosixPath(item['path']).relative_to('dist');assert '..' not in rel.parts
  dest=newroot.joinpath(*rel.parts);previous=oldroot.joinpath(*rel.parts)
  dest.parent.mkdir(parents=True,exist_ok=True)
  for parent in [dest.parent,*dest.parent.parents]:
   if parent==newroot.parent:break
   os.chmod(parent,0o755)
  if previous.is_file() and not previous.is_symlink() and previous.stat().st_uid==0 and previous.stat().st_size==item['bytes'] and sha(previous)==item['sha256']:
   os.link(previous,dest)
  else:
   member=delta.getmember('./'+item['path']);assert member.isfile() and member.size==item['bytes']
   data=delta.extractfile(member).read(item['bytes']+1);assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
   fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
   with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
   os.chmod(dest,0o644)
retained=[]
for previous in (oldroot/'assets').rglob('*'):
 if previous.is_file():
  assert not previous.is_symlink() and previous.stat().st_uid==0
  rel=previous.relative_to(oldroot);dest=newroot/rel
  if not dest.exists():
   dest.parent.mkdir(parents=True,exist_ok=True);os.link(previous,dest)
   retained.append({'path':str(rel),'sha256':sha(previous)})
private_write(backup/'web-stage.json',json.dumps({'result':'PASS','candidateFiles':1139,'retainedAssets':retained}).encode())

newassets=[]
for f in manifest['files']:
 rel=pathlib.PurePosixPath(f['path']).relative_to('dist');p=newroot.joinpath(*rel.parts)
 assert not p.is_symlink() and p.stat().st_uid==0 and p.stat().st_size==f['bytes'] and sha(p)==f['sha256']
 if str(rel).startswith('assets/') and p.suffix in ('.js','.css') and not oldroot.joinpath(*rel.parts).exists():newassets.append((rel,f))
assert sha(newroot/'index.html')==INDEX and newassets
stage=json.loads((backup/'web-stage.json').read_text());assert stage['result']=='PASS' and stage['candidateFiles']==1139
for f in stage['retainedAssets']:
 p=newroot/f['path'];q=oldroot/f['path'];assert p.stat().st_ino==q.stat().st_ino and sha(p)==f['sha256']

def write_config(raw):
 tmp=site.with_name('.fom-mobile.issue773-integration.once.tmp');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
 os.chown(tmp,info.st_uid,info.st_gid);os.chmod(tmp,0o644);os.replace(tmp,site)
receipt={'issue':773,'source':'07aaf09fb6373ee56806a1eff627eb7179122c12','apiHead':version['commit'],'beforeNginxSha256':OLD,'targetNginxSha256':NEW,'root':str(newroot),'result':'FAIL','databaseWrites':False,'firewallChanges':False,'physicalCertification':False}
changed=False
try:
 assert sha(site)==OLD
 write_config(new);changed=True
 command(['nginx','-t']);command(['systemctl','reload','nginx'])
 receipt['step']='index_stability'
 stable=0
 for attempt in range(20):
  checks=[hashlib.sha256(curl(route)).hexdigest()==INDEX for route in ('/panel/flota','/panel/admin/vehiculos','/panel/admin/gps')]
  stable=stable+1 if all(checks) else 0
  if stable>=2:break
  time.sleep(0.5)
 else:raise ValueError('served_indexes_not_stable')
 for rel,f in newassets:
  receipt['step']='asset:'+str(rel)
  b=curl('/'+str(rel),max(4096,f['bytes']+1024));assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256']
 receipt['step']='anonymous_readiness'
 assert status('/fom-api/api/v1/console/meitrack-setup/readiness','POST')=='401'
 for endpoint in ('availability','discovery'):
  assert status('/fom-api/api/v1/console/meitrack-setup/'+endpoint,'POST')=='401'
 assert status('/fom-api/api/v1/console/gps-devices/00000000-0000-4000-8000-000000000727/telemetry?limit=20')=='401'
 assert status('/fom-api/api/v1/console/vehicles','POST')=='401'
 assert json.loads(command(['docker','inspect','fom-core-api']).stdout)[0]['Id']==info_api['Id']
 receipt['step']='unknown_route'
 assert status('/fom-api/api/v1/console/meitrack-setup/unknown-route')=='404'
 receipt['step']='internal_route'
 assert status('/gps-console-internal')=='404'
 receipt.update(result='PASS',servedIndexSha256=INDEX,newAssetsServedAndHashed=len(newassets),retainedAssets=len(stage['retainedAssets']),anonymousMeitrackGuard=401,unknownRoute=404,restoration='NOT_NEEDED')
except Exception as e:
 receipt['failureType']=type(e).__name__
 if changed:
  try:
   assert sha(site)==NEW
   write_config(old);command(['nginx','-t']);command(['systemctl','reload','nginx'])
   assert sha(site)==OLD
   receipt['restoration']='PASS_OLD_ROOT'
  except Exception:receipt['restoration']='NO'
receipt['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
data=json.dumps(receipt,indent=2).encode();private_write(backup/'web-activation.json',data)
print(json.dumps(receipt));print('WEB_RECEIPT_SHA256='+hashlib.sha256(data).hexdigest())
raise SystemExit(0 if receipt['result']=='PASS' else 1)
