from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import hashlib
import hmac
import json
import secrets
import threading

ROOT = Path(__file__).parent
DATA_FILE = ROOT / "orders.json"
ADMIN_FILE = ROOT / "admin.json"
PORT = 8000
SESSIONS = set()
ADMIN_LOCK = threading.Lock()


def load_orders():
    if not DATA_FILE.exists():
        return []
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []


def save_orders(orders):
    DATA_FILE.write_text(
        json.dumps(orders, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def load_admin():
    if not ADMIN_FILE.exists():
        return None
    try:
        admin = json.loads(ADMIN_FILE.read_text(encoding="utf-8"))
        if admin.get("login") and admin.get("salt") and admin.get("password_hash"):
            return admin
    except (OSError, AttributeError, json.JSONDecodeError):
        pass
    return None


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000).hex()


def save_admin(login, password):
    salt = secrets.token_hex(16)
    ADMIN_FILE.write_text(
        json.dumps({"login": login, "salt": salt, "password_hash": hash_password(password, salt)}, indent=2),
        encoding="utf-8",
    )


class AppHandler(BaseHTTPRequestHandler):
    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def get_session(self):
        cookie = self.headers.get("Cookie", "")
        for item in cookie.split(";"):
            name, _, value = item.strip().partition("=")
            if name == "session" and value in SESSIONS:
                return value
        return None

    def require_auth(self):
        if self.get_session():
            return True
        self.send_json({"error": "Требуется авторизация"}, 401)
        return False

    def send_file(self, filename, content_type):
        body = (ROOT / filename).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/orders":
            self.send_json(load_orders())
        elif self.path == "/api/auth":
            self.send_json({"authenticated": bool(self.get_session()), "has_admin": load_admin() is not None})
        elif self.path == "/" or self.path == "/index.html":
            self.send_file("index.html", "text/html; charset=utf-8")
        elif self.path == "/styles.css":
            self.send_file("styles.css", "text/css; charset=utf-8")
        elif self.path == "/app.js":
            self.send_file("app.js", "application/javascript; charset=utf-8")
        else:
            self.send_json({"error": "Не найдено"}, 404)

    def do_POST(self):
        if self.path == "/api/register":
            self.register()
            return
        if self.path == "/api/login":
            self.login()
            return
        if self.path == "/api/logout":
            session = self.get_session()
            if session:
                SESSIONS.discard(session)
            self.send_json({"ok": True}, 200)
            return
        if self.path == "/api/orders/clear":
            self.clear_orders()
            return
        if self.path != "/api/orders":
            self.send_json({"error": "Не найдено"}, 404)
            return
        if not self.require_auth():
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length))
            orders = load_orders()
            order = {
                "id": payload.get("id") or str(int(date.today().strftime("%Y%m%d"))) + str(len(orders) + 1),
                "number": str(payload.get("number", "")).strip(),
                "date": str(payload.get("date", date.today().isoformat())),
                "client": str(payload.get("client", "")).strip(),
                "note": str(payload.get("note", "")).strip(),
                "count": int(payload.get("count", 0)),
                "pickers": [str(name).strip() for name in payload.get("pickers", []) if str(name).strip()],
            }
            if not order["number"] or order["count"] < 1 or len(order["pickers"]) not in (1, 2):
                self.send_json({"error": "Проверьте номер, количество и состав сборщиков"}, 400)
                return
            existing_index = next((index for index, item in enumerate(orders) if item["id"] == order["id"]), None)
            if existing_index is None:
                orders.insert(0, order)
            else:
                orders[existing_index] = order
            save_orders(orders)
            self.send_json(order, 201)
        except (ValueError, TypeError, json.JSONDecodeError):
            self.send_json({"error": "Некорректные данные"}, 400)

    def clear_orders(self):
        if not self.require_auth():
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length))
            scope = payload.get("scope")
            period = str(payload.get("period", ""))
            orders = load_orders()
            if scope == "all":
                remaining = []
            elif scope == "day" and len(period) == 10:
                remaining = [order for order in orders if order.get("date") != period]
            elif scope == "month" and len(period) == 7:
                remaining = [order for order in orders if not str(order.get("date", "")).startswith(period)]
            else:
                self.send_json({"error": "Некорректный диапазон очистки"}, 400)
                return
            save_orders(remaining)
            self.send_json({"ok": True, "deleted": len(orders) - len(remaining)})
        except (TypeError, json.JSONDecodeError):
            self.send_json({"error": "Некорректные данные"}, 400)

    def login(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length))
            admin = load_admin()
            if admin is None:
                self.send_json({"error": "Сначала создайте админ-аккаунт"}, 409)
                return
            password = str(payload.get("password", ""))
            password_hash = hash_password(password, admin["salt"])
            if payload.get("login") != admin["login"] or not hmac.compare_digest(password_hash, admin["password_hash"]):
                self.send_json({"error": "Неверный логин или пароль"}, 401)
                return
            self.start_session()
        except (TypeError, json.JSONDecodeError):
            self.send_json({"error": "Некорректные данные"}, 400)

    def register(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length))
            login = str(payload.get("login", "")).strip()
            password = str(payload.get("password", ""))
            if not login or len(login) > 64 or len(password) < 6:
                self.send_json({"error": "Логин обязателен, пароль должен содержать минимум 6 символов"}, 400)
                return
            with ADMIN_LOCK:
                if load_admin() is not None:
                    self.send_json({"error": "Админ-аккаунт уже создан"}, 409)
                    return
                save_admin(login, password)
            self.start_session()
        except (TypeError, json.JSONDecodeError):
            self.send_json({"error": "Некорректные данные"}, 400)

    def start_session(self):
        session = secrets.token_urlsafe(32)
        SESSIONS.add(session)
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Set-Cookie", f"session={session}; HttpOnly; SameSite=Strict; Path=/")
        body = json.dumps({"authenticated": True}).encode("utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self):
        if not self.path.startswith("/api/orders/"):
            self.send_json({"error": "Не найдено"}, 404)
            return
        if not self.require_auth():
            return
        order_id = self.path.rsplit("/", 1)[-1]
        orders = [order for order in load_orders() if order["id"] != order_id]
        save_orders(orders)
        self.send_json({"ok": True})

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    print(f"Оптовый подсчёт запущен: http://localhost:{PORT}")
    ThreadingHTTPServer(("localhost", PORT), AppHandler).serve_forever()
