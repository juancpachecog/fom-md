import hashlib
import importlib.util
from pathlib import Path
import tarfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('web852',Path(__file__).with_name('issue-852-web-publish.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def manifest():
    files=[{'path':'dist/index.html','bytes':1,'sha256':'a'*64},
           {'path':'dist/fom-build-profile.json','bytes':1,'sha256':'b'*64}]
    files += [{'path':f'dist/assets/synthetic-{i}.js','bytes':1,'sha256':'c'*64} for i in range(998)]
    return {'version':1,'issue':852,'source':m.SOURCE,'files':files}

class PublicationTest(unittest.TestCase):
    def test_closed_manifest_source_size_and_paths(self):
        m.manifest_gate(manifest())
        for field,value in [('issue',846),('source','0'*40),('version',2)]:
            bad=manifest();bad[field]=value
            with self.assertRaises(RuntimeError):m.manifest_gate(bad)
        for path in ('../escape','dist/.env','dist/assets/../../escape','/absolute','dist/assets\\wrong.js'):
            bad=manifest();bad['files'][2]['path']=path
            with self.assertRaises(RuntimeError):m.manifest_gate(bad)
        for alteration in ('duplicate','empty','oversize','extra'):
            bad=manifest()
            if alteration=='duplicate':bad['files'][2]=bad['files'][3]
            if alteration=='empty':bad['files'][2]['bytes']=0
            if alteration=='oversize':bad['files'][2]['bytes']=300*1024**2
            if alteration=='extra':bad['proof']='not authority'
            with self.assertRaises(RuntimeError):m.manifest_gate(bad)

    def test_nginx_delta_changes_one_root_and_preserves_rest(self):
        before=('server {\nroot '+str(m.OLD_ROOT)+';\ninclude unchanged.conf;\n}\n').encode()
        with patch.object(m,'OLD_CONFIG',hashlib.sha256(before).hexdigest()):
            after=m.config_delta(before)
            self.assertEqual(after.replace(str(m.RELEASE).encode(),str(m.OLD_ROOT).encode()),before)
            with self.assertRaises(RuntimeError):m.config_delta(before+b'# drift')
        doubled=before+before
        with patch.object(m,'OLD_CONFIG',hashlib.sha256(doubled).hexdigest()):
            with self.assertRaises(RuntimeError):m.config_delta(doubled)

    def test_only_consumes_existing846_api_receipt_without_new_execution(self):
        value={'issue':846,'result':'PASS','runId':'issue-846-publish-20261118T234804Z','head':m.API_HEAD,
            'commandExecutionEnabled':False,'mfaRuntimeConfigVerified':True,'mfaKeyRetained':True,
            'compatibleReturnReady':True,'containerId':'a'*64,'imageId':'sha256:'+'b'*64}
        m.validate_api_receipt(value)
        for field,new in [('issue',852),('head','0'*40),('mfaKeyRetained',False),('commandExecutionEnabled',True),('compatibleReturnReady',False)]:
            with self.assertRaises(RuntimeError):m.validate_api_receipt({**value,field:new})

    def test_readiness_requires_two_complete_new_observations(self):
        new,old=b'new synthetic',b'old synthetic'
        n={'calls':0}
        def fetch(_route):n['calls']+=1;return old if n['calls']<=12 else new
        result=m.index_readiness(fetch,hashlib.sha256(new).hexdigest(),hashlib.sha256(old).hexdigest(),lambda _:None)
        self.assertEqual(result['stableIndexPasses'],2)
        with self.assertRaises(RuntimeError):m.index_readiness(lambda _:b'unexpected',hashlib.sha256(new).hexdigest(),hashlib.sha256(old).hexdigest(),lambda _:None)

    def test_retained_assets_never_follow_foreign_roots_or_nonassets(self):
        item={'path':'assets/old.js','sha256':'a'*64,'sourceRoot':str(m.OLD_ROOT)}
        self.assertEqual(m.retained_source(item),m.OLD_ROOT/'assets/old.js')
        for change in ({'sourceRoot':'/elsewhere'},{'path':'../escape'},{'path':'index.html'},{'path':'assets/.env'}):
            with self.assertRaises(RuntimeError):m.retained_source({**item,**change})

    def test_archive_rejects_links_and_traversal_before_extracting(self):
        meta=tarfile.TarInfo('manifest.json');meta.size=1
        for name,kind in [('../outside',tarfile.REGTYPE),('dist/link',tarfile.SYMTYPE),('dist/hard',tarfile.LNKTYPE),('extra',tarfile.REGTYPE)]:
            bad=tarfile.TarInfo(name);bad.type=kind;bad.size=1
            with self.assertRaises(RuntimeError):m.archive_members([meta,bad])

if __name__=='__main__':unittest.main()
