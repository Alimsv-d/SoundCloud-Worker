// JSON response helpers + consistent error shape.
export function requestId() {
  return crypto.randomUUID();
}

export function json(data, init = {}, reqId) {
  const body = { ok: init.status ? init.status < 400 : true, request_id: reqId || requestId(), ...data };
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status: init.status || 200, headers });
}

export const ERR = {
  BAD_REQUEST:   [400, "BAD_REQUEST",   "درخواست نامعتبر است", "Invalid request"],
  NOT_FOUND:     [404, "NOT_FOUND",     "پیدا نشد", "Not found"],
  UNAUTHORIZED:  [401, "UNAUTHORIZED",  "احراز هویت لازم است", "Authentication required"],
  FORBIDDEN:     [403, "FORBIDDEN",     "دسترسی مجاز نیست", "Access forbidden"],
  RATE_LIMITED:  [429, "RATE_LIMITED",  "تعداد درخواست بیش از حد", "Rate limit exceeded"],
  UPSTREAM:      [502, "UPSTREAM_ERROR","خطا در سرویس بالادست", "Upstream service error"],
  TIMEOUT:       [504, "UPSTREAM_TIMEOUT","مهلت تمام شد", "Upstream timeout"],
  TOO_LARGE:     [413, "PAYLOAD_TOO_LARGE","حجم بیش از حد مجاز", "Payload too large"],
  BLOCKED_URL:   [403, "BLOCKED_URL",   "نشانی مسدود است", "Blocked URL"],
  NOT_DOWNLOADABLE:[403,"NOT_DOWNLOADABLE","دانلود برای این ترک مجاز نیست","Download not allowed"],
  INTERNAL:      [500, "INTERNAL_ERROR","خطای داخلی", "Internal error"],
};

export function err(code, extra = {}, reqId) {
  const [status, c, fa, en] = ERR[code] || ERR.INTERNAL;
  return json({ error: { code: c, message: { fa, en }, ...extra } }, { status }, reqId);
}
