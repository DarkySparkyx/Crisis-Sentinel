"""
Ariadna — serwer pomocniczy (OPS).

WAŻNE ZAŁOŻENIE ARCHITEKTONICZNE: ten serwer NIE jest częścią systemu
nawigacyjnego. Telefon liczy wszystko sam i działa w trybie samolotowym.
Serwer robi trzy rzeczy, wszystkie poza ścieżką krytyczną:

  1. zbiera nagrania z telefonów (żeby zespół mógł stroić algorytm offline),
  2. serwuje aktualną mapę obiektu i mapę magnetyczną do wgrania na telefon,
  3. daje panel operatora na prezentację (wyzwalacz scenariusza, podgląd).

Jeśli serwer padnie w trakcie demo — demo idzie dalej. To jest cel.

Uruchomienie:  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
REC = DATA / "recordings"
MAPS = DATA / "maps"
MAGMAPS = DATA / "magmaps"
for d in (REC, MAPS, MAGMAPS):
    d.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Ariadna OPS", version="0.1.0")

# Stan sceny prezentacji — trzymany w pamięci, bo żyje tyle co demo.
STATE: dict[str, Any] = {"scenario": "NORMAL", "since": time.time(), "note": ""}
CLIENTS: set[WebSocket] = set()


async def broadcast(msg: dict) -> None:
    dead = []
    for ws in CLIENTS:
        try:
            await ws.send_json(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        CLIENTS.discard(ws)


@app.get("/api/v1/health")
def health() -> dict:
    return {"ok": True, "recordings": len(list(REC.glob("*.jsonl"))), "state": STATE}


@app.get("/api/v1/map/{venue}")
def get_map(venue: str) -> FileResponse:
    """Mapa obiektu (GeoJSON). Telefon pobiera ją RAZ i cache'uje lokalnie."""
    p = MAPS / f"{venue}.geojson"
    if not p.exists():
        raise HTTPException(404, f"brak mapy: {venue}")
    return FileResponse(p, media_type="application/geo+json")


@app.get("/api/v1/magmap/{venue}")
def get_magmap(venue: str) -> FileResponse:
    p = MAGMAPS / f"{venue}.json"
    if not p.exists():
        raise HTTPException(404, f"brak mapy magnetycznej: {venue}")
    return FileResponse(p, media_type="application/json")


@app.post("/api/v1/magmap/{venue}")
async def put_magmap(venue: str, file: UploadFile = File(...)) -> dict:
    """Telefon po przejściu kalibracyjnym wysyła zbudowaną mapę magnetyczną."""
    body = await file.read()
    doc = json.loads(body)
    if doc.get("schema_version") != 2:
        raise HTTPException(400, "nieobsługiwana wersja schematu mapy magnetycznej")
    (MAGMAPS / f"{venue}.json").write_bytes(body)
    return {"ok": True, "cells": len(doc.get("cells", {}))}


@app.post("/api/v1/recordings")
async def upload_recording(file: UploadFile = File(...)) -> dict:
    """Wgranie nagrania .jsonl z telefonu. Walidujemy nagłówek od razu —
    lepiej dowiedzieć się o złym formacie teraz niż o 3 w nocy."""
    body = await file.read()
    first = body.split(b"\n", 1)[0]
    try:
        header = json.loads(first)
        assert header.get("schema_version") == 2
    except Exception as e:
        raise HTTPException(400, f"zły nagłówek nagrania: {e}")
    name = f"{header.get('session_id', 'rec')}.jsonl"
    (REC / name).write_bytes(body)
    return {"ok": True, "saved": name, "bytes": len(body), "header": header}


@app.get("/api/v1/recordings")
def list_recordings() -> JSONResponse:
    out = []
    for p in sorted(REC.glob("*.jsonl")):
        try:
            head = json.loads(p.open("rb").readline())
        except Exception:
            head = {}
        out.append({"name": p.name, "bytes": p.stat().st_size, "header": head})
    return JSONResponse(out)


@app.post("/api/v1/scenario/{name}")
async def set_scenario(name: str) -> dict:
    """Panel operatora przełącza scenariusz prezentacji.

    NORMAL   — GNSS działa, aplikacja pokazuje pozycję z GNSS
    DENIED   — GNSS "zagłuszony": aplikacja przechodzi na nawigację inercyjno-magnetyczną
    SPOOFED  — GNSS podaje fałszywą pozycję: pokazujemy detekcję niespójności z PDR
    """
    if name not in {"NORMAL", "DENIED", "SPOOFED"}:
        raise HTTPException(400, "nieznany scenariusz")
    STATE.update(scenario=name, since=time.time())
    await broadcast({"type": "scenario", "scenario": name})
    return {"ok": True, **STATE}


@app.websocket("/ws/ops")
async def ws_ops(ws: WebSocket) -> None:
    """Kanał panel<->telefony. Służy WYŁĄCZNIE do sterowania sceną.
    Zerwanie tego połączenia nie wpływa na nawigację."""
    await ws.accept()
    CLIENTS.add(ws)
    await ws.send_json({"type": "scenario", "scenario": STATE["scenario"]})
    try:
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "fix":
                await broadcast({"type": "fix", **msg})
    except WebSocketDisconnect:
        pass
    finally:
        CLIENTS.discard(ws)


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
