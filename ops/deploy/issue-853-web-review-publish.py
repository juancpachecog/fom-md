#!/usr/bin/env python3
"""Publish the transfer review using the installed, pinned #853 publisher."""

import hashlib
import os
from pathlib import Path
import stat
import sys
import types


PUBLISHER = Path('/var/lib/fom-issue-853-web-contracts/web-publish-db4b232176e8.py')
PUBLISHER_SHA = 'db4b232176e8e7e92c3621bc32d163658769d32ff4b1bd2ee8b393830c05b780'
SOURCE = '700b8c257b203f32e9eef594a66b88ffe7c53675'
ROOT = Path('/var/lib/fom-issue-853-web-review-contracts')
OLD_ROOT = Path('/var/www/fom-web/releases/issue-853-vehicle-plates')
RELEASE = Path('/var/www/fom-web/releases/issue-853-transfer-review')
OLD_CONFIG = '17a474e3db1160f0751c0797effb6139a7e438dfb7c7baaff6b2676e2d37d7dc'
OLD_INDEX = 'c9cfb1f12be029581f8e77f4838e04efd3d40de53859b2c9ffe2496fb3cc99c0'


def pinned_publisher():
    parent = PUBLISHER.parent.lstat()
    if parent.st_uid != 0 or parent.st_mode != (stat.S_IFDIR | 0o700) or PUBLISHER.parent.resolve() != PUBLISHER.parent:
        raise RuntimeError('publisher_directory_gate')
    fd = os.open(PUBLISHER, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if info.st_uid != 0 or info.st_mode != (stat.S_IFREG | 0o600) or info.st_nlink != 1 or not 0 < info.st_size <= 40000:
            raise RuntimeError('publisher_file_gate')
        raw = file.read(40001)
    if hashlib.sha256(raw).hexdigest() != PUBLISHER_SHA:
        raise RuntimeError('publisher_hash_gate')
    publisher = types.ModuleType('fom_web_publisher_853')
    exec(compile(raw, str(PUBLISHER), 'exec'), publisher.__dict__)
    publisher.__file__ = __file__
    publisher.ROOT = ROOT
    publisher.ARCHIVE = ROOT / 'transfer-review.tar.gz'
    publisher.SOURCE = SOURCE
    publisher.OLD_ROOT = OLD_ROOT
    publisher.RETAIN_ROOTS = (OLD_ROOT,)
    publisher.RELEASE = RELEASE
    publisher.OLD_CONFIG = OLD_CONFIG
    publisher.OLD_INDEX = OLD_INDEX
    return publisher


if __name__ == '__main__':
    try:
        sys.exit(pinned_publisher().main())
    except RuntimeError as error:
        sys.exit(str(error))
