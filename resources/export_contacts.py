#!/usr/bin/env python3
"""Read the verified public columns from the configured WeChat contact.db."""
import json
import os
import sys

package_root = os.environ.get('WECAT_WEFLOW_ROOT', '')
scripts = os.path.join(package_root, 'scripts')
if not os.path.isdir(scripts):
    print(json.dumps({'success': False, 'error': 'WeFlow scripts not found'}))
    raise SystemExit(1)
sys.path.insert(0, scripts)

from _utils import decrypt_lock, load_config  # noqa: E402

config = load_config()
path = config.get('contactDbPath') or ''
key = decrypt_lock(config.get('contactKey') or '')
salt = config.get('contactSalt') or ''
if not path or not key or not salt or not os.path.isfile(path):
    print(json.dumps({'success': False, 'error': 'contact.db configuration is incomplete'}))
    raise SystemExit(1)

try:
    import sqlcipher3
    conn = sqlcipher3.connect(path)
    conn.execute("PRAGMA key = \"x'%s%s'\";" % (key, salt))
    cursor = conn.cursor()
    columns = {row[1] for row in cursor.execute('PRAGMA table_info(contact)').fetchall()}
    wanted = [name for name in ('username', 'remark', 'nick_name', 'alias', 'local_type') if name in columns]
    rows = cursor.execute('SELECT %s FROM contact' % ','.join(wanted)).fetchall()
    contacts = []
    for row in rows:
        item = dict(zip(wanted, row))
        username = str(item.get('username') or '').strip()
        if not username:
            continue
        remark = str(item.get('remark') or '').strip()
        nickname = str(item.get('nick_name') or '').strip()
        alias = str(item.get('alias') or '').strip()
        if username.endswith('@chatroom'):
            kind = 'group'
        elif username.startswith('gh_'):
            kind = 'official'
        else:
            kind = 'direct'
        contacts.append({
            'username': username,
            'remark': remark or None,
            'nickname': nickname or None,
            'alias': alias or None,
            'displayName': remark or nickname or alias or username,
            'kind': kind,
            'localType': int(item.get('local_type') or 0),
        })
    print(json.dumps({'success': True, 'contacts': contacts}, ensure_ascii=False))
finally:
    try:
        conn.close()
    except Exception:
        pass
