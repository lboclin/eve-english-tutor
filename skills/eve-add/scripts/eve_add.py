#!/usr/bin/env python3
"""Send English cards to Eve through its local inbox webhook.

Usage: python3 eve_add.py cards.json [--dry-run] [--url URL]

cards.json is one card object or a JSON list of them (shape in SKILL.md §2). Eve validates the cards
(fix = 3 consecutive cards per rule, phrasal = 2 per pv, pronunciation = 2 per rule), skips exact
duplicates and stores them in its own database. --dry-run validates without saving.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

EVE_URL = "http://127.0.0.1:8790/api/inbox/cards"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", type=Path)
    ap.add_argument("--dry-run", action="store_true", help="validate only; nothing is saved")
    ap.add_argument("--url", default=EVE_URL)
    args = ap.parse_args()

    cards = json.loads(args.file.read_text(encoding="utf-8"))
    if isinstance(cards, dict):
        cards = [cards]
    body = json.dumps({"cards": cards, "dryRun": args.dry_run}).encode()
    req = urllib.request.Request(args.url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        try:
            msg = json.load(e).get("error", str(e))
        except Exception:
            msg = str(e)
        print(f"Eve refused the cards: {msg}", file=sys.stderr)
        return 1
    except urllib.error.URLError:
        print("Eve isn't running. Start it with: npm run dev (in Eve's repo)", file=sys.stderr)
        return 2

    if args.dry_run:
        print(f"Valid: {out['valid']} card(s) — nothing saved (dry run).")
        for c in out["cards"]:
            print(f"- [{c['category']}{' · ' + c['eventKey'] if c.get('eventKey') else ''}] {c['front']}  →  {c['back']}")
        return 0
    print(f"Added {out['inserted']} card(s) to Eve; {out['duplicates']} exact duplicate(s) skipped.")
    for key, n in (out.get("events") or {}).items():
        print(f"- {key}: event #{n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
