"""
Локальный сервер для запуска PWA Mazda 6 GH OBD-II Scanner.
Запуск: python server.py
"""

import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8000

class PWAHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.webmanifest': 'application/manifest+json',
        '.json': 'application/json',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png'
    }

    def end_headers(self):
        # Заголовки для кэширования и безопасности
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    handler = PWAHTTPRequestHandler
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        url = f"http://localhost:{PORT}"
        print("=" * 60)
        print("  MAZDA 6 GH | OBD-II SCANNER PWA ЗАПУЩЕН")
        print("=" * 60)
        print(f"  Адрес приложения: {url}")
        print("  Режим PWA и Web Serial / Web Bluetooth активны на localhost.")
        print("  Нажмите Ctrl+C для остановки сервера.")
        print("=" * 60)
        
        # Открыть браузер автоматически
        try:
            webbrowser.open(url)
        except Exception:
            pass

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен.")
            sys.exit(0)

if __name__ == '__main__':
    main()
