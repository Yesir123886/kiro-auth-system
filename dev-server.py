#!/usr/bin/env python3
"""ANGEL Auth System - Local Dev Server with hysafe API Proxy"""
import http.server
import socketserver
import json
import urllib.request
import urllib.error
import os

PORT = 8080
HYSAFE_API = "http://hp.hysafe.top:15110"

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/proxy/hysafe':
            self.proxy_hysafe()
        else:
            self.send_error(404)

    def proxy_hysafe(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length else b'{}'
            
            req = urllib.request.Request(
                f"{HYSAFE_API}/api/issue",
                data=body,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = resp.read().decode('utf-8')
                
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(result.encode())
            
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='replace')
            self.send_response(e.code)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(err_body.encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode())

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")

os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f"ANGEL Dev Server running at http://localhost:{PORT}")
print(f"   -> hysafe API proxy: /api/proxy/hysafe")
with socketserver.TCPServer(("", PORT), ProxyHandler) as httpd:
    httpd.serve_forever()
