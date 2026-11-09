# -*- coding: utf-8 -*-
import http.server
import socketserver
import threading
import os
import sys
import json

PORTS = [80, 8688]
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "yuanhe_data.json")
os.chdir(BASE_DIR)

class YuanHeHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path in ("/merchant", "/merchant/", "/admin", "/admin/"):
            self.path = "/merchant.html"
        if self.path.startswith("/api/data"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if os.path.exists(DATA_FILE):
                try:
                    with open(DATA_FILE, "r", encoding="utf-8") as f:
                        self.wfile.write(f.read().encode("utf-8"))
                    return
                except Exception:
                    pass
            self.wfile.write(b"{}")
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/data"):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            try:
                parsed = json.loads(body)
                with open(DATA_FILE, "w", encoding="utf-8") as f:
                    json.dump(parsed, f, ensure_ascii=False, indent=2)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "err": str(e)}).encode("utf-8"))
            return
        super().do_POST()

    def log_message(self, format, *args):
        pass

class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

def serve_on_port(port):
    try:
        with ThreadedHTTPServer(("0.0.0.0", port), YuanHeHandler) as httpd:
            print(f"[OK] YuanHe Server listening on port {port}", flush=True)
            httpd.serve_forever()
    except Exception as e:
        print(f"[WARN] Could not bind port {port}: {e}", flush=True)

if __name__ == "__main__":
    threads = []
    for p in PORTS:
        t = threading.Thread(target=serve_on_port, args=(p,), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
