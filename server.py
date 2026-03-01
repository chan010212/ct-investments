#!/usr/bin/env python3
"""
CT Investments — 台灣股票儀表板後端
Serves static files + proxies API requests to bypass CORS
"""

import http.server
import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

PORT = int(os.environ.get('PORT', 8888))
ALLOWED_HOSTS = [
    'www.twse.com.tw',
    'www.tpex.org.tw',
    'mis.twse.com.tw',
    'query1.finance.yahoo.com',
    'query2.finance.yahoo.com',
]


class StockProxyHandler(http.server.SimpleHTTPRequestHandler):
    """Serves static files + proxies API requests to bypass CORS"""

    def do_GET(self):
        if self.path.startswith('/api/proxy?'):
            self.handle_proxy()
        elif self.path == '/' or self.path == '':
            # Serve index.html at root
            self.path = '/index.html'
            super().do_GET()
        else:
            super().do_GET()

    def handle_proxy(self):
        """Proxy external API requests"""
        try:
            query = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(query)
            url = params.get('url', [''])[0]

            if not url:
                self.send_error(400, 'Missing url parameter')
                return

            # Security: only allow whitelisted hosts
            parsed = urllib.parse.urlparse(url)
            if parsed.hostname not in ALLOWED_HOSTS:
                self.send_error(403, f'Host not allowed: {parsed.hostname}')
                return

            # Fetch from upstream
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Referer': f'https://{parsed.hostname}/',
            })

            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
                content_type = resp.headers.get('Content-Type', 'application/json')

            # Send response with CORS headers
            self.send_response(200)
            self.send_header('Content-Type', content_type)
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
        # Only add CORS header if not already set (proxy handler sets it explicitly)
        if not any(k.lower() == 'access-control-allow-origin' for k, v in self._headers):
            self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        msg = format % args
        if '/api/proxy' in msg:
            sys.stderr.write(f"[PROXY] {msg}\n")
        elif '200' in msg or '304' in msg:
            pass
        else:
            sys.stderr.write(f"[HTTP] {msg}\n")


if __name__ == '__main__':
    os.chdir(Path(__file__).parent)
    server = http.server.HTTPServer(('0.0.0.0', PORT), StockProxyHandler)
    print(f'CT Investments server started on port {PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped')
        server.server_close()
