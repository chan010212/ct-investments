#!/usr/bin/env python3
"""
CT Investments — 台灣股票儀表板後端
Serves static files + proxies API requests + member system
All using Python stdlib only (no pip dependencies)
"""

import http.server
import socketserver
import json
import os
import sys
import sqlite3
import hashlib
import hmac
import base64
import time
import urllib.request
import urllib.parse
import urllib.error
import ssl
from pathlib import Path
from datetime import datetime

PORT = int(os.environ.get('PORT', 8888))
JWT_SECRET = os.environ.get('JWT_SECRET', 'ct-investments-secret-key-change-in-production')
DB_PATH = Path(__file__).parent / 'data' / 'ct_invest.db'

ALLOWED_HOSTS = [
    'www.twse.com.tw',
    'www.tpex.org.tw',
    'mis.twse.com.tw',
    'query1.finance.yahoo.com',
    'query2.finance.yahoo.com',
]


# ============================================================
# DATABASE
# ============================================================
def init_db():
    """Initialize SQLite database with member tables"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute('PRAGMA journal_mode=WAL')
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT DEFAULT 'free',
        created_at TEXT DEFAULT (datetime('now')),
        last_login TEXT,
        login_count INTEGER DEFAULT 0
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS watchlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        stock_code TEXT NOT NULL,
        added_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, stock_code)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS user_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS stock_picks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_code TEXT NOT NULL,
        stock_name TEXT,
        action TEXT NOT NULL,
        reason TEXT,
        target_price REAL,
        stop_loss REAL,
        score INTEGER,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )''')

    conn.commit()
    conn.close()
    print(f'[DB] Database initialized at {DB_PATH}')


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


# ============================================================
# SIMPLE JWT (stdlib only, no pyjwt needed)
# ============================================================
def _b64encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def _b64decode(s):
    s += '=' * (4 - len(s) % 4)
    return base64.urlsafe_b64decode(s)


def jwt_encode(payload):
    header = _b64encode(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
    payload_b64 = _b64encode(json.dumps(payload).encode())
    msg = f'{header}.{payload_b64}'
    sig = _b64encode(hmac.new(JWT_SECRET.encode(), msg.encode(), hashlib.sha256).digest())
    return f'{msg}.{sig}'


def jwt_decode(token):
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header, payload_b64, sig = parts
        expected_sig = _b64encode(hmac.new(JWT_SECRET.encode(), f'{header}.{payload_b64}'.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected_sig):
            return None
        payload = json.loads(_b64decode(payload_b64))
        if payload.get('exp', 0) < time.time():
            return None
        return payload
    except Exception:
        return None


PBKDF2_ITERATIONS = 10000

def hash_password(password):
    salt = os.urandom(16)
    h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, PBKDF2_ITERATIONS)
    return base64.b64encode(salt + h).decode()


def verify_password(password, stored_hash):
    try:
        decoded = base64.b64decode(stored_hash)
        salt = decoded[:16]
        stored_h = decoded[16:]
        # Try current iteration count first, fallback to legacy 100000
        h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, PBKDF2_ITERATIONS)
        if hmac.compare_digest(h, stored_h):
            return True
        h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
        return hmac.compare_digest(h, stored_h)
    except Exception:
        return False


# ============================================================
# HTTP HANDLER
# ============================================================
class StockProxyHandler(http.server.SimpleHTTPRequestHandler):
    """Serves static files + proxies API requests + member API"""

    def do_GET(self):
        if self.path.startswith('/api/proxy?'):
            self.handle_proxy()
        elif self.path == '/api/me':
            self.handle_me()
        elif self.path == '/api/watchlist':
            self.handle_get_watchlist()
        elif self.path == '/api/picks':
            self.handle_get_picks()
        elif self.path.startswith('/api/admin/') and self.path.split('?')[0] in ('/api/admin/users', '/api/admin/actions', '/api/admin/stats'):
            self.handle_admin_get()
        elif self.path == '/' or self.path == '':
            self.path = '/index.html'
            super().do_GET()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/register':
            self.handle_register()
        elif self.path == '/api/login':
            self.handle_login()
        elif self.path == '/api/watchlist':
            self.handle_post_watchlist()
        elif self.path == '/api/track':
            self.handle_track()
        elif self.path == '/api/admin/picks':
            self.handle_admin_picks()
        else:
            self.send_error(404)

    def do_DELETE(self):
        if self.path.startswith('/api/watchlist/'):
            self.handle_delete_watchlist()
        elif self.path.startswith('/api/admin/picks/'):
            self.handle_admin_delete_pick()
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    # --- Helpers ---
    def read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def get_user(self):
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return None
        token = auth[7:]
        payload = jwt_decode(token)
        if not payload:
            return None
        return payload

    def require_user(self):
        user = self.get_user()
        if not user:
            self.send_json({'error': '請先登入'}, 401)
            return None
        return user

    def require_admin(self):
        user = self.get_user()
        if not user:
            self.send_json({'error': '請先登入'}, 401)
            return None
        if user.get('role') != 'admin':
            self.send_json({'error': '需要管理員權限'}, 403)
            return None
        return user

    # --- Auth ---
    def handle_register(self):
        body = self.read_body()
        email = (body.get('email') or '').strip().lower()
        password = body.get('password') or ''
        name = (body.get('name') or '').strip()

        if not email or '@' not in email:
            self.send_json({'error': '請輸入有效的 Email'}, 400)
            return
        if len(password) < 6:
            self.send_json({'error': '密碼至少需要 6 個字元'}, 400)
            return
        if not name:
            name = email.split('@')[0]

        db = get_db()
        try:
            existing = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
            if existing:
                self.send_json({'error': '此 Email 已被註冊'}, 409)
                return

            pw_hash = hash_password(password)
            # First user is admin
            user_count = db.execute('SELECT COUNT(*) FROM users').fetchone()[0]
            role = 'admin' if user_count == 0 else 'free'

            db.execute(
                'INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
                (email, pw_hash, name, role)
            )
            db.commit()
            user_id = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()['id']

            token = jwt_encode({
                'uid': user_id,
                'email': email,
                'name': name,
                'role': role,
                'exp': time.time() + 30 * 24 * 3600  # 30 days
            })

            log_action(db, user_id, 'register', f'New user registered: {email}')

            self.send_json({
                'token': token,
                'user': {'id': user_id, 'email': email, 'name': name, 'role': role}
            })
        finally:
            db.close()

    def handle_login(self):
        body = self.read_body()
        email = (body.get('email') or '').strip().lower()
        password = body.get('password') or ''

        if not email or not password:
            self.send_json({'error': '請輸入 Email 和密碼'}, 400)
            return

        db = get_db()
        try:
            user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
            if not user or not verify_password(password, user['password_hash']):
                self.send_json({'error': 'Email 或密碼錯誤'}, 401)
                return

            db.execute(
                'UPDATE users SET last_login = datetime("now"), login_count = login_count + 1 WHERE id = ?',
                (user['id'],)
            )
            db.commit()

            token = jwt_encode({
                'uid': user['id'],
                'email': user['email'],
                'name': user['display_name'],
                'role': user['role'],
                'exp': time.time() + 30 * 24 * 3600
            })

            log_action(db, user['id'], 'login', f'User login: {email}')

            self.send_json({
                'token': token,
                'user': {
                    'id': user['id'],
                    'email': user['email'],
                    'name': user['display_name'],
                    'role': user['role']
                }
            })
        finally:
            db.close()

    def handle_me(self):
        user = self.require_user()
        if not user:
            return
        self.send_json({'user': {
            'id': user['uid'],
            'email': user['email'],
            'name': user['name'],
            'role': user['role']
        }})

    # --- Watchlist ---
    def handle_get_watchlist(self):
        user = self.require_user()
        if not user:
            return
        db = get_db()
        try:
            rows = db.execute(
                'SELECT stock_code, added_at FROM watchlists WHERE user_id = ? ORDER BY added_at',
                (user['uid'],)
            ).fetchall()
            self.send_json({'watchlist': [{'code': r['stock_code'], 'added_at': r['added_at']} for r in rows]})
        finally:
            db.close()

    def handle_post_watchlist(self):
        user = self.require_user()
        if not user:
            return
        body = self.read_body()
        codes = body.get('codes', [])
        if isinstance(codes, str):
            codes = [codes]

        db = get_db()
        try:
            for code in codes:
                code = code.strip()
                if code:
                    db.execute(
                        'INSERT OR IGNORE INTO watchlists (user_id, stock_code) VALUES (?, ?)',
                        (user['uid'], code)
                    )
            db.commit()
            log_action(db, user['uid'], 'watchlist_sync', json.dumps(codes))

            rows = db.execute(
                'SELECT stock_code FROM watchlists WHERE user_id = ? ORDER BY added_at',
                (user['uid'],)
            ).fetchall()
            self.send_json({'watchlist': [r['stock_code'] for r in rows]})
        finally:
            db.close()

    def handle_delete_watchlist(self):
        user = self.require_user()
        if not user:
            return
        code = self.path.split('/')[-1]
        db = get_db()
        try:
            db.execute('DELETE FROM watchlists WHERE user_id = ? AND stock_code = ?', (user['uid'], code))
            db.commit()
            log_action(db, user['uid'], 'watchlist_remove', code)
            self.send_json({'ok': True})
        finally:
            db.close()

    # --- Track user actions ---
    def handle_track(self):
        user = self.get_user()
        body = self.read_body()
        action = body.get('action', '')
        detail = body.get('detail', '')
        uid = user['uid'] if user else None

        db = get_db()
        try:
            log_action(db, uid, action, detail)
            self.send_json({'ok': True})
        finally:
            db.close()

    # --- Stock Picks (public read) ---
    def handle_get_picks(self):
        db = get_db()
        try:
            rows = db.execute(
                'SELECT * FROM stock_picks WHERE status = "active" ORDER BY created_at DESC'
            ).fetchall()
            picks = []
            for r in rows:
                picks.append({
                    'id': r['id'],
                    'code': r['stock_code'],
                    'name': r['stock_name'],
                    'action': r['action'],
                    'reason': r['reason'],
                    'target_price': r['target_price'],
                    'stop_loss': r['stop_loss'],
                    'score': r['score'],
                    'created_at': r['created_at'],
                })
            self.send_json({'picks': picks})
        finally:
            db.close()

    # --- Admin ---
    def handle_admin_get(self):
        user = self.require_admin()
        if not user:
            return

        path = self.path.split('?')[0]
        db = get_db()
        try:
            if path == '/api/admin/users':
                rows = db.execute(
                    'SELECT id, email, display_name, role, created_at, last_login, login_count FROM users ORDER BY created_at DESC'
                ).fetchall()
                self.send_json({'users': [dict(r) for r in rows]})

            elif path == '/api/admin/actions':
                rows = db.execute(
                    '''SELECT a.*, u.email, u.display_name
                       FROM user_actions a
                       LEFT JOIN users u ON a.user_id = u.id
                       ORDER BY a.created_at DESC LIMIT 200'''
                ).fetchall()
                self.send_json({'actions': [dict(r) for r in rows]})

            elif path == '/api/admin/stats':
                total_users = db.execute('SELECT COUNT(*) FROM users').fetchone()[0]
                today = datetime.now().strftime('%Y-%m-%d')
                active_today = db.execute(
                    "SELECT COUNT(DISTINCT user_id) FROM user_actions WHERE created_at >= ?",
                    (today,)
                ).fetchone()[0]
                total_picks = db.execute("SELECT COUNT(*) FROM stock_picks WHERE status = 'active'").fetchone()[0]
                popular = db.execute(
                    '''SELECT stock_code, COUNT(*) as cnt
                       FROM watchlists GROUP BY stock_code ORDER BY cnt DESC LIMIT 10'''
                ).fetchall()
                self.send_json({
                    'total_users': total_users,
                    'active_today': active_today,
                    'total_picks': total_picks,
                    'popular_stocks': [{'code': r['stock_code'], 'count': r['cnt']} for r in popular]
                })
        finally:
            db.close()

    def handle_admin_picks(self):
        user = self.require_admin()
        if not user:
            return
        body = self.read_body()
        db = get_db()
        try:
            db.execute(
                '''INSERT INTO stock_picks (stock_code, stock_name, action, reason, target_price, stop_loss, score)
                   VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (body.get('code', ''), body.get('name', ''), body.get('action', 'buy'),
                 body.get('reason', ''), body.get('target_price'), body.get('stop_loss'), body.get('score'))
            )
            db.commit()
            log_action(db, user['uid'], 'admin_add_pick', json.dumps(body, ensure_ascii=False))
            self.send_json({'ok': True})
        finally:
            db.close()

    def handle_admin_delete_pick(self):
        user = self.require_admin()
        if not user:
            return
        pick_id = self.path.split('/')[-1]
        db = get_db()
        try:
            db.execute("UPDATE stock_picks SET status = 'closed' WHERE id = ?", (pick_id,))
            db.commit()
            self.send_json({'ok': True})
        finally:
            db.close()

    # --- Proxy ---
    def handle_proxy(self):
        try:
            query = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(query)
            url = params.get('url', [''])[0]

            if not url:
                self.send_error(400, 'Missing url parameter')
                return

            parsed = urllib.parse.urlparse(url)
            if parsed.hostname not in ALLOWED_HOSTS:
                self.send_error(403, f'Host not allowed: {parsed.hostname}')
                return

            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Referer': f'https://{parsed.hostname}/',
            })

            # TWSE has broken SSL cert (missing Subject Key Identifier)
            # Use relaxed SSL context for TWSE domains
            ctx = None
            if 'twse.com.tw' in (parsed.hostname or ''):
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE

            with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                data = resp.read()
                content_type = resp.headers.get('Content-Type', 'application/json')

            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'public, max-age=300')
            self.end_headers()
            self.wfile.write(data)

        except urllib.error.HTTPError as e:
            self.send_error(e.code, str(e.reason))
        except urllib.error.URLError as e:
            self.send_error(502, f'Upstream error: {e.reason}')
        except Exception as e:
            self.send_error(500, str(e))

    def end_headers(self):
        # Check _headers_buffer for existing CORS header to avoid duplicates
        has_cors = False
        if hasattr(self, '_headers_buffer'):
            for h in self._headers_buffer:
                if b'access-control-allow-origin' in h.lower():
                    has_cors = True
                    break
        if not has_cors:
            self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, fmt, *args):
        msg = fmt % args
        if '/api/proxy' in msg:
            sys.stderr.write(f"[PROXY] {msg}\n")
        elif '/api/' in msg:
            sys.stderr.write(f"[API] {msg}\n")
        elif '200' in msg or '304' in msg:
            pass
        else:
            sys.stderr.write(f"[HTTP] {msg}\n")


def log_action(db, user_id, action, detail=''):
    db.execute(
        'INSERT INTO user_actions (user_id, action, detail) VALUES (?, ?, ?)',
        (user_id, action, detail)
    )
    db.commit()


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == '__main__':
    os.chdir(Path(__file__).parent)
    init_db()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), StockProxyHandler)
    print(f'CT Investments server started on port {PORT} (threaded)')
    print(f'  Database: {DB_PATH}')
    print(f'  Open: http://localhost:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped')
        server.server_close()
