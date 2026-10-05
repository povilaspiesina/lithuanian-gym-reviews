"""Local review archive and dashboard. Imports review data supplied by the user."""

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sqlite3
import sys
from contextlib import closing
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
DATA = Path(os.environ.get("GYM_DATA_DIR", str(ROOT / "data")))
DIRECTORY = Path(os.environ.get("GYM_DIRECTORY_FILE", str(ROOT / "gyms_lt.json")))
DEFAULT_DB = DATA / "reviews.sqlite3"
REPORT = DATA / "scrape-report.json"
REQUIRED_COLUMNS = {"club_id", "rating", "published_at", "text"}
OPTIONAL_COLUMNS = {"review_id", "author", "review_url", "owner_reply_text", "owner_reply_at", "published_label", "date_precision"}


def clubs():
    return json.loads(DIRECTORY.read_text(encoding="utf-8"))["clubs"]


def connect(db_path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS reviews (
            club_id TEXT NOT NULL,
            review_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
            published_at TEXT NOT NULL,
            text TEXT NOT NULL,
            author TEXT NOT NULL DEFAULT '',
            review_url TEXT NOT NULL DEFAULT '',
            owner_reply_text TEXT NOT NULL DEFAULT '',
            owner_reply_at TEXT NOT NULL DEFAULT '',
            published_label TEXT NOT NULL DEFAULT '',
            date_precision TEXT NOT NULL DEFAULT 'exact',
            imported_at TEXT NOT NULL,
            PRIMARY KEY (club_id, review_id)
        );
        CREATE INDEX IF NOT EXISTS reviews_by_date ON reviews(published_at);
        CREATE INDEX IF NOT EXISTS reviews_by_club_date ON reviews(club_id, published_at);
        """
    )
    existing = {row[1] for row in con.execute("PRAGMA table_info(reviews)")}
    if "published_label" not in existing:
        con.execute("ALTER TABLE reviews ADD COLUMN published_label TEXT NOT NULL DEFAULT ''")
    if "date_precision" not in existing:
        con.execute("ALTER TABLE reviews ADD COLUMN date_precision TEXT NOT NULL DEFAULT 'exact'")
    return con


def normalized_date(value):
    value = value.strip()
    if not value:
        raise ValueError("date is empty")
    try:
        if len(value) == 10:
            return date.fromisoformat(value).isoformat()
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
    except ValueError as exc:
        raise ValueError(f"invalid date {value!r}; use YYYY-MM-DD or ISO 8601") from exc


def import_csv(con, path):
    known = {club["id"] for club in clubs()}
    with open(path, newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        columns = set(reader.fieldnames or [])
        missing = REQUIRED_COLUMNS - columns
        if missing:
            raise ValueError(f"missing CSV columns: {', '.join(sorted(missing))}")
        prepared = []
        for line_number, row in enumerate(reader, start=2):
            try:
                club_id = (row["club_id"] or "").strip()
                if club_id not in known:
                    raise ValueError(f"unknown club_id {club_id!r}")
                rating = int((row["rating"] or "").strip())
                if rating not in range(1, 6):
                    raise ValueError("rating must be 1–5")
                published = normalized_date(row["published_at"] or "")
                review_text = (row["text"] or "").strip()
                author = (row.get("author") or "").strip()
                if author:
                    author = re.split(r"\s+(?:Local Guide\b|\d+\s+reviews?\b)", author.splitlines()[0], maxsplit=1)[0]
                review_id = (row.get("review_id") or "").strip()
                if not review_id:
                    fingerprint = "\x1f".join((club_id, published, str(rating), author, review_text))
                    review_id = "sha256:" + hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
                reply_at = (row.get("owner_reply_at") or "").strip()
                if reply_at:
                    reply_at = normalized_date(reply_at)
                review_url = (row.get("review_url") or "").strip()
                if review_url and not review_url.startswith(("https://", "http://")):
                    raise ValueError("review_url must begin with https:// or http://")
                precision = (row.get("date_precision") or "exact").strip()
                if precision not in {"exact", "estimated", "unknown"}:
                    raise ValueError("date_precision must be exact, estimated, or unknown")
                prepared.append(
                    (
                        club_id, review_id, rating, published, review_text, author,
                        review_url,
                        (row.get("owner_reply_text") or "").strip(), reply_at,
                        (row.get("published_label") or "").strip(), precision,
                        datetime.now().astimezone().isoformat(timespec="seconds"),
                    )
                )
            except (ValueError, TypeError) as exc:
                raise ValueError(f"CSV line {line_number}: {exc}") from exc
    before = con.total_changes
    with con:
        con.executemany(
            """INSERT INTO reviews
               (club_id, review_id, rating, published_at, text, author,
                review_url, owner_reply_text, owner_reply_at, published_label,
                date_precision, imported_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(club_id, review_id) DO UPDATE SET
                 rating=excluded.rating, published_at=excluded.published_at,
                 text=excluded.text, author=excluded.author,
                 review_url=excluded.review_url,
                 owner_reply_text=excluded.owner_reply_text,
                 owner_reply_at=excluded.owner_reply_at,
                 published_label=excluded.published_label,
                 date_precision=excluded.date_precision,
                 imported_at=excluded.imported_at""",
            prepared,
        )
    return len(prepared), con.total_changes - before


def export_club_csv(con, club_id, path):
    if club_id not in {club["id"] for club in clubs()}:
        raise ValueError(f"unknown club_id {club_id!r}")
    columns = ["club_id", "review_id", "rating", "published_at", "text", "author",
               "review_url", "owner_reply_text", "owner_reply_at", "published_label", "date_precision"]
    rows = con.execute(
        f"SELECT {', '.join(columns)} FROM reviews WHERE club_id = ? ORDER BY published_at DESC, review_id",
        (club_id,),
    ).fetchall()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(columns)
        writer.writerows(rows)
    return len(rows)


def filters(params):
    today = date.today()
    period = params.get("period", ["all"])[0]
    if period not in {"all", "last_30_days", "previous_month", "custom"}:
        raise ValueError("invalid period")
    if period == "last_30_days":
        start, end = (today - timedelta(days=29)).isoformat(), today.isoformat()
    elif period == "previous_month":
        first = today.replace(day=1)
        end_date = first - timedelta(days=1)
        start, end = end_date.replace(day=1).isoformat(), end_date.isoformat()
    elif period == "custom":
        start = params.get("start", [""])[0]
        end = params.get("end", [""])[0]
        start = normalized_date(start) if start else ""
        end = normalized_date(end) if end else ""
        if start and end and start > end:
            raise ValueError("start date is after end date")
    else:
        start, end = "", ""
    chain = params.get("chain", [""])[0]
    city = params.get("city", [""])[0]
    club_id = params.get("club_id", [""])[0]
    rating = params.get("rating", [""])[0]
    query = params.get("q", [""])[0].strip()
    known_clubs = clubs()
    if chain and chain not in {c["chain"] for c in known_clubs}:
        raise ValueError("unknown chain")
    if city and city not in {c["locality"] for c in known_clubs}:
        raise ValueError("unknown city")
    if club_id and club_id not in {c["id"] for c in known_clubs}:
        raise ValueError("unknown club")
    if rating and rating not in {"1", "2", "3", "4", "5"}:
        raise ValueError("rating must be 1–5")
    selected = [c["id"] for c in known_clubs if
                (not chain or c["chain"] == chain) and
                (not city or c["locality"] == city) and
                (not club_id or c["id"] == club_id)]
    clauses, values = [], []
    if selected and len(selected) < len(known_clubs):
        clauses.append("club_id IN (" + ",".join("?" for _ in selected) + ")")
        values.extend(selected)
    elif not selected:
        clauses.append("0")
    if start:
        clauses.append("published_at >= ?")
        values.append(start)
    if end:
        clauses.append("published_at <= ?")
        values.append(end)
    if rating:
        clauses.append("rating = ?")
        values.append(int(rating))
    if query:
        clauses.append("(text LIKE ? OR owner_reply_text LIKE ?)")
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        values.extend([f"%{escaped}%", f"%{escaped}%"])
        clauses[-1] = "(text LIKE ? ESCAPE '\\' OR owner_reply_text LIKE ? ESCAPE '\\')"
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), values


def review_data(con, params, limit=100, offset=0):
    where, values = filters(params)
    rows = con.execute(
        "SELECT club_id, review_id, rating, published_at, text, author, "
        "review_url, owner_reply_text, owner_reply_at, published_label, date_precision FROM reviews" + where +
        " ORDER BY published_at DESC, club_id, review_id LIMIT ? OFFSET ?",
        [*values, limit, offset],
    ).fetchall()
    return [dict(row) for row in rows]


def stats(con, params):
    where, values = filters(params)
    summary = dict(con.execute(
        "SELECT COUNT(*) AS review_count, ROUND(AVG(rating), 2) AS average_rating, "
        "SUM(CASE WHEN owner_reply_text != '' THEN 1 ELSE 0 END) AS replied_count "
        "FROM reviews" + where, values,
    ).fetchone())
    summary["replied_count"] = summary["replied_count"] or 0
    summary["ratings"] = {str(i): 0 for i in range(1, 6)}
    for row in con.execute("SELECT rating, COUNT(*) AS n FROM reviews" + where + " GROUP BY rating", values):
        summary["ratings"][str(row["rating"])] = row["n"]
    return summary


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Gym reviews</title>
<style>
:root{font:16px system-ui,sans-serif;color:#19252c;background:#f5f7f8}
*{box-sizing:border-box}body{margin:0}header{background:#12383d;color:white;padding:24px max(24px,calc((100vw - 1200px)/2))}
h1{margin:0;font-size:1.55rem}header p{margin:.4rem 0 0;color:#d2e5e3}main{max-width:1200px;margin:auto;padding:24px}
form,.card,.review{background:white;border:1px solid #dce4e5;border-radius:12px;padding:18px;box-shadow:0 2px 8px #12383d08}
form{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;align-items:end}
label{display:grid;gap:5px;font-size:.8rem;font-weight:650}input,select,button{font:inherit;border:1px solid #b6c5c6;border-radius:7px;padding:9px;min-width:0}
button,.button{background:#126c66;color:white;border:0;cursor:pointer;text-decoration:none;text-align:center;border-radius:7px;padding:10px;font:inherit}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}.metric b{font-size:1.7rem;display:block}
.coverage-details{margin-bottom:20px}.coverage-details summary{cursor:pointer;font-weight:650}.coverage-details p{margin:10px 0 0}
.card h2{margin:0 0 12px;font-size:1rem}.barrow{display:grid;grid-template-columns:36px 1fr 50px;gap:10px;align-items:center;margin:7px 0}.bar{height:12px;background:#e8eeed;border-radius:8px;overflow:hidden}.bar span{display:block;height:100%;background:#14a496}
.top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:22px 0 12px}.top h2{margin:0}.review{margin:10px 0}.review h3{margin:0 0 7px;font-size:1rem}.meta{color:#53666c;font-size:.85rem}.stars{color:#b36500;font-weight:700}.review p{white-space:pre-wrap;overflow-wrap:anywhere}.reply{border-left:3px solid #14a496;padding-left:12px;margin-top:12px;color:#36575a}.pager{display:flex;gap:12px;align-items:center;margin:16px 0 30px}.muted{color:#63757a}
@media(max-width:600px){header,main{padding:18px}.top{align-items:flex-start;flex-direction:column}}
</style></head><body><header><h1>Lithuanian gym reviews</h1><p>Local review archive · Gym+ · Lemon Gym · SportGates</p></header>
<main><form id="filters"><label>Period<select name="period" id="period"><option value="all">All time</option><option value="last_30_days">Last 30 days</option><option value="previous_month">Previous calendar month</option><option value="custom">Custom dates</option></select></label>
<label>From<input type="date" name="start" id="start"></label><label>To<input type="date" name="end" id="end"></label>
<label>Chain<select name="chain" id="chain"><option value="">All chains</option></select></label>
<label>City<select name="city" id="city"><option value="">All cities</option></select></label>
<label>Club<select name="club_id" id="club"><option value="">All clubs</option></select></label>
<label>Stars<select name="rating"><option value="">All ratings</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
<label>Search review or reply<input name="q" type="search" placeholder="e.g. cleanliness"></label>
<button type="submit">Apply filters</button></form>
<div class="metrics"><div class="card metric">Reviews<b id="count">—</b></div><div class="card metric">Average rating<b id="average">—</b></div><div class="card metric">Owner replies<b id="replied">—</b></div><div class="card metric">Maps coverage<b id="coverage">—</b><span class="muted" id="coverage-note"></span></div></div>
<details class="card coverage-details"><summary>Clubs with incomplete review history</summary><div id="coverage-list" class="muted"></div></details>
<div class="card"><h2>Rating distribution</h2><div id="distribution"></div></div>
<div class="top"><h2>Reviews</h2><a class="button" id="export" href="/export.csv">Export filtered CSV</a></div><div id="reviews"></div>
<div class="pager"><button id="previous" type="button">Previous</button><span id="page">Page 1</span><button id="next" type="button">Next</button></div>
<p class="muted">Reviews are saved locally. Check Maps coverage before treating a club's history as complete.</p></main>
<script>
const form=document.querySelector('#filters'),clubs=CLUBS,limit=50;let offset=0,total=0;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function options(el,values){for(const [value,label] of values){const o=document.createElement('option');o.value=value;o.textContent=label;el.append(o)}}
options(document.querySelector('#chain'),[...new Set(clubs.map(c=>c.chain))].sort().map(x=>[x,x]));
options(document.querySelector('#city'),[...new Set(clubs.map(c=>c.locality))].sort().map(x=>[x,x]));
options(document.querySelector('#club'),clubs.map(c=>[c.id,`${c.chain} · ${c.club_name} · ${c.locality}`]));
function params(){const p=new URLSearchParams(new FormData(form));if(p.get('period')!=='custom'){p.delete('start');p.delete('end')}for(const [k,v] of [...p])if(!v)p.delete(k);return p}
async function load(){const p=params();p.set('offset',offset);const r=await fetch('/api/data?'+p);if(!r.ok){alert((await r.json()).error);return}const data=await r.json();total=data.stats.review_count;
document.querySelector('#count').textContent=total.toLocaleString();document.querySelector('#average').textContent=data.stats.average_rating??'—';document.querySelector('#replied').textContent=data.stats.replied_count.toLocaleString();
const coverage=data.coverage, clubId=p.get('club_id');document.querySelector('#coverage').textContent=clubId&&coverage.clubs[clubId]?`${coverage.clubs[clubId].collected}/${coverage.clubs[clubId].displayed_review_count??'?'}`:`${coverage.complete}/${coverage.open}`;document.querySelector('#coverage-note').textContent=clubId&&coverage.clubs[clubId]?(coverage.clubs[clubId].complete?'Displayed reviews collected':'Incomplete or unverified'):`open clubs complete · ${coverage.attempted} attempted`;
const incomplete=clubs.filter(c=>c.status==='open'&&!coverage.clubs[c.id]?.complete);document.querySelector('#coverage-list').innerHTML=incomplete.length?incomplete.map(c=>{const x=coverage.clubs[c.id];return `<p>${esc(c.chain)} · ${esc(c.club_name)} · ${esc(c.locality)}: ${x?`${x.collected}/${x.displayed_review_count??'?'}`:'not collected'}</p>`}).join(''):'<p>All open clubs match their displayed Maps review counts.</p>';
document.querySelector('#distribution').innerHTML=[5,4,3,2,1].map(n=>`<div class="barrow"><span>${n} ★</span><div class="bar"><span style="width:${total?100*data.stats.ratings[n]/total:0}%"></span></div><span>${data.stats.ratings[n]}</span></div>`).join('');
document.querySelector('#reviews').innerHTML=data.reviews.length?data.reviews.map(x=>{const c=clubs.find(c=>c.id===x.club_id);return `<article class="review"><h3>${esc(c.chain)} · ${esc(c.club_name)} <span class="stars">${'★'.repeat(x.rating)}</span></h3><div class="meta">${esc(c.locality)} · ${x.date_precision==='estimated'?'about ':''}${esc(x.published_at)}${x.published_label?' ('+esc(x.published_label)+')':''}${x.author?' · '+esc(x.author):''}${x.review_url?' · <a href="'+esc(x.review_url)+'" target="_blank" rel="noopener noreferrer">Source</a>':''}</div><p>${esc(x.text)||'<em>Rating only</em>'}</p>${x.owner_reply_text?'<div class="reply"><b>Owner reply</b>'+ (x.owner_reply_at?' · '+esc(x.owner_reply_at):'')+'<p>'+esc(x.owner_reply_text)+'</p></div>':''}</article>`}).join(''):'<p class="muted">No reviews match these filters.</p>';
document.querySelector('#page').textContent=`Page ${Math.floor(offset/limit)+1} · ${total} results`;document.querySelector('#previous').disabled=offset===0;document.querySelector('#next').disabled=offset+limit>=total;
const e=params();document.querySelector('#export').href='/export.csv?'+e;}
form.addEventListener('submit',e=>{e.preventDefault();offset=0;load()});document.querySelector('#previous').onclick=()=>{offset=Math.max(0,offset-limit);load()};document.querySelector('#next').onclick=()=>{offset+=limit;load()};
document.querySelector('#period').onchange=()=>{const on=document.querySelector('#period').value==='custom';document.querySelector('#start').disabled=!on;document.querySelector('#end').disabled=!on};document.querySelector('#period').onchange();load();
</script></body></html>"""


def make_handler(db_path):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_GET(self):
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query, keep_blank_values=True)
            try:
                if parsed.path == "/":
                    page = PAGE.replace("CLUBS", json.dumps(clubs(), ensure_ascii=False))
                    self.send_bytes(page.encode("utf-8"), "text/html; charset=utf-8")
                elif parsed.path == "/api/data":
                    offset = int(params.get("offset", ["0"])[0])
                    if offset < 0:
                        raise ValueError("offset must be nonnegative")
                    with closing(connect(db_path)) as con:
                        payload = {"stats": stats(con, params), "reviews": review_data(con, params, 50, offset)}
                        imported_counts = dict(con.execute(
                            "SELECT club_id, COUNT(*) FROM reviews GROUP BY club_id"
                        ).fetchall())
                    report = json.loads(REPORT.read_text(encoding="utf-8")) if REPORT.exists() else {}
                    for club_id, count in imported_counts.items():
                        report.setdefault(club_id, {
                            "collected": count, "displayed_review_count": None,
                            "complete": False, "source": "imported CSV",
                        })
                    payload["coverage"] = {
                        "open": sum(c["status"] == "open" for c in clubs()),
                        "attempted": len(report),
                        "complete": sum(item.get("complete", False) for item in report.values()),
                        "clubs": report,
                    }
                    self.send_bytes(json.dumps(payload, ensure_ascii=False).encode(), "application/json; charset=utf-8")
                elif parsed.path == "/export.csv":
                    with closing(connect(db_path)) as con:
                        where, values = filters(params)
                        rows = con.execute("SELECT club_id, review_id, rating, published_at, text, author, review_url, owner_reply_text, owner_reply_at, published_label, date_precision FROM reviews" + where + " ORDER BY published_at DESC, club_id, review_id", values).fetchall()
                    output = io.StringIO()
                    writer = csv.writer(output)
                    writer.writerow(["club_id", "review_id", "rating", "published_at", "text", "author", "review_url", "owner_reply_text", "owner_reply_at", "published_label", "date_precision"])
                    writer.writerows([tuple(row) for row in rows])
                    self.send_bytes(output.getvalue().encode("utf-8-sig"), "text/csv; charset=utf-8", "attachment; filename=reviews_filtered.csv")
                else:
                    self.send_error(404)
            except (ValueError, OverflowError) as exc:
                self.send_bytes(json.dumps({"error": str(exc)}).encode(), "application/json", status=400)

        def send_bytes(self, body, content_type, disposition=None, status=200):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if disposition:
                self.send_header("Content-Disposition", disposition)
            self.end_headers()
            self.wfile.write(body)

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Local Lithuanian gym review dashboard")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite database path")
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="start local dashboard")
    serve.add_argument("--port", type=int, default=8765)
    importer = commands.add_parser("import-csv", help="import full-history review CSV")
    importer.add_argument("path", type=Path)
    commands.add_parser("status", help="show imported review count")
    club_status = commands.add_parser("count-club", help="show imported review count for one club")
    club_status.add_argument("club_id")
    club_export = commands.add_parser("export-club", help="save all stored reviews for one club as CSV")
    club_export.add_argument("club_id")
    club_export.add_argument("path", type=Path)
    sync = commands.add_parser("sync-club", help="import a club CSV and rebuild it from the archive")
    sync.add_argument("club_id")
    sync.add_argument("path", type=Path)
    args = parser.parse_args()
    if args.command == "import-csv":
        with closing(connect(args.db)) as con:
            read, changed = import_csv(con, args.path)
        print(f"Read {read} rows; inserted or updated {changed} reviews in {args.db}")
    elif args.command == "status":
        with closing(connect(args.db)) as con:
            count = con.execute("SELECT COUNT(*) FROM reviews").fetchone()[0]
        print(f"{count} reviews in {args.db}")
    elif args.command == "count-club":
        with closing(connect(args.db)) as con:
            count = con.execute("SELECT COUNT(*) FROM reviews WHERE club_id = ?", (args.club_id,)).fetchone()[0]
        print(count)
    elif args.command == "export-club":
        with closing(connect(args.db)) as con:
            count = export_club_csv(con, args.club_id, args.path)
        print(f"Exported {count} reviews to {args.path}")
    elif args.command == "sync-club":
        with closing(connect(args.db)) as con:
            read, changed = import_csv(con, args.path)
            count = export_club_csv(con, args.club_id, args.path)
        print(f"Read {read} rows; saved {count} reviews ({changed} inserted or updated)")
        print(f"SYNC_RESULT={count}")
    else:
        with closing(connect(args.db)):
            pass
        server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.db))
        print(f"SERVER_URL=http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
        finally:
            server.server_close()


if __name__ == "__main__":
    main()
