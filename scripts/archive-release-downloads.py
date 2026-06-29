#!/usr/bin/env python3
"""
GitHub Release Asset 下载量归档。

GitHub 的 Source code.zip 不提供单独下载统计；正式面向用户的下载包应作为
Release Asset 上传。本脚本每天记录每个 asset 的累计 download_count。
"""
import csv
import json
import os
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = os.environ["REPO"]
TOKEN = os.environ["GH_TOKEN"]
OUT = Path("data/traffic")
OUT.mkdir(parents=True, exist_ok=True)
PATH = OUT / "release-assets.csv"


def fetch_json(url: str):
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def main() -> None:
    snapshot_date = datetime.now(timezone.utc).date().isoformat()
    releases = fetch_json(f"https://api.github.com/repos/{REPO}/releases?per_page=100")

    rows: dict[tuple[str, str], dict[str, str]] = {}
    if PATH.exists():
        with PATH.open(newline="") as f:
            for row in csv.DictReader(f):
                rows[(row["snapshot_date"], row["asset_id"])] = row

    for rel in releases:
        for asset in rel.get("assets", []):
            rows[(snapshot_date, str(asset["id"]))] = {
                "snapshot_date": snapshot_date,
                "tag_name": rel.get("tag_name", ""),
                "asset_id": str(asset["id"]),
                "asset_name": asset.get("name", ""),
                "download_count": str(asset.get("download_count", 0)),
                "size": str(asset.get("size", 0)),
                "updated_at": asset.get("updated_at", ""),
                "browser_download_url": asset.get("browser_download_url", ""),
            }

    with PATH.open("w", newline="") as f:
        fieldnames = [
            "snapshot_date",
            "tag_name",
            "asset_id",
            "asset_name",
            "download_count",
            "size",
            "updated_at",
            "browser_download_url",
        ]
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for key in sorted(rows):
            w.writerow(rows[key])

    total = sum(int(row["download_count"]) for row in rows.values() if row["snapshot_date"] == snapshot_date)
    print(f"[release-downloads] {snapshot_date}: assets={sum(1 for k in rows if k[0] == snapshot_date)} total_download_count={total}")


if __name__ == "__main__":
    main()
