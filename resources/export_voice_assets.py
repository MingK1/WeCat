#!/usr/bin/env python3
"""Export one conversation's locally cached WeChat SILK voice blobs as WAV."""
import json
import os
import pathlib
import sys

package_root = pathlib.Path(os.environ.get('WECAT_WEFLOW_ROOT', ''))
scripts = package_root / 'scripts'
if not scripts.is_dir():
    print(json.dumps({'success': False, 'error': 'WeFlow scripts not found'}))
    raise SystemExit(1)
sys.path.insert(0, str(scripts))

from _utils import decrypt_lock, load_config  # noqa: E402
from wechat_voice import decode_silk, load_voice_map  # noqa: E402

talker = os.environ.get('WEFLOW_TALKER', '')
output = pathlib.Path(os.environ.get('WECAT_VOICE_OUTPUT', ''))
config = load_config()
if not talker or not output:
    print(json.dumps({'success': False, 'error': 'Missing talker or output'}))
    raise SystemExit(1)

try:
    import pilk  # noqa: F401
except ImportError:
    print(json.dumps({'success': False, 'error': 'PILK_MISSING'}))
    raise SystemExit(1)

voices = load_voice_map(
    config.get('ntDbPath', ''),
    decrypt_lock(config.get('ntKey', '') or ''),
    config.get('ntSalt', '') or '',
    decrypt_lock(config.get('favPassphrase') or config.get('decryptKey') or ''),
    talker,
)
output.mkdir(parents=True, exist_ok=True)
items = []
for local_id, blob in voices.items():
    target = output / ('%s.wav' % local_id)
    if decode_silk(blob, str(target)):
        items.append({'localId': str(local_id), 'path': str(target), 'bytes': target.stat().st_size})
print(json.dumps({'success': True, 'items': items}, ensure_ascii=False))
