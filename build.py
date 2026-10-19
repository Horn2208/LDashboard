#!/usr/bin/env python3
"""Builds public/index.html for Vercel from the artifact page (hws-cockpit.html).

The artifact page is wrapped in a document skeleton by claude.ai at publish time;
here we add that skeleton ourselves, plus the Supabase client, config and the
runtime shim that stands in for window.claude.
"""
import pathlib, shutil, sys

ROOT = pathlib.Path(__file__).parent
SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/home/claude/hws-cockpit.html")
page = SRC.read_text(encoding="utf-8")

LOGIN_CSS = """<style>
#ldash-login{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:16px;background:color-mix(in srgb,var(--bg) 82%,transparent);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
#ldash-login .ldash-card{max-width:380px;width:100%;border-radius:var(--r-xl);padding:28px;display:grid;gap:14px;justify-items:start}
#ldash-login h1{font-size:2rem}
#ldash-login p{margin:0;color:var(--muted)}
.ldash-logout{margin-top:6px;border:0;background:var(--well);color:var(--muted);border-radius:999px;padding:6px 12px;font-size:.8rem;cursor:pointer}
.ldash-logout:hover{color:var(--fg)}
#ldash-reconnect{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(104px + env(safe-area-inset-bottom,0px));z-index:60;display:flex;gap:12px;align-items:center;border-radius:999px;padding:8px 8px 8px 18px;max-width:calc(100% - 32px);font-size:.88rem}
@media (min-width:961px){#ldash-reconnect{bottom:24px}}
</style>"""

HEAD = f"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#232428">
<style>:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
"""

SCRIPTS = """<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
<script src="config.js"></script>
<script src="shim.js"></script>
"""

# put the runtime in front of the page's own inline script
marker = "<script>\n(function(){"
assert marker in page, "main script marker not found"
page = page.replace(marker, SCRIPTS + marker, 1)

# error copy: on Vercel the fix is re-connecting Google, not claude.ai connectors
for a, b in [
  ("Gmail-Anmeldung abgelaufen. Verbinde Gmail neu unter claude.ai → Einstellungen → Connectors.", "Google-Anmeldung abgelaufen. Tippe unten auf „Neu verbinden“."),
  ("Gmail ist nicht verbunden. Füge Gmail unter claude.ai → Einstellungen → Connectors hinzu.", "Gmail ist nicht verbunden. Melde dich neu mit Google an."),
  ("Google Kalender neu verbinden (claude.ai → Einstellungen → Connectors)", "Google-Anmeldung abgelaufen – unten „Neu verbinden“"),
]:
    page = page.replace(a, b)

# logout control in the sidebar footer
page = page.replace('<div class="foot">', '<div class="foot">\n      <button class="ldash-logout" type="button" onclick="window.ldashLogout()">Abmelden</button>', 1)

# title / stylesheet / <style> sit at the top of the artifact page: move them into <head>
split = page.index('<div class="glow"')
head_part, body_part = page[:split], page[split:]
out = HEAD + head_part + LOGIN_CSS + "\n</head>\n<body>\n" + body_part + "\n</body>\n</html>\n"
(ROOT / "public").mkdir(exist_ok=True)
(ROOT / "public" / "index.html").write_text(out, encoding="utf-8")
for f in ("bklit-charts.js", "bklit-charts.css"):
    shutil.copy(SRC.parent / f, ROOT / "public" / f)
print("built public/index.html", len(out), "bytes")
