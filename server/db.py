# -*- coding: utf-8 -*-
"""Хранилище прогресса: SQLite, только stdlib.

Требование ТЗ — держать прогресс, покупки и события в структурированном
хранилище. Раскладка такая:
    player     — один игрок: хайп, подписчики, кринж, этап, счётчики, скин
    upgrades   — купленные улучшения и их уровни
    events     — журнал всего, что случилось (события, покупки, оффлайн-доход)
    shop_log   — обращения к витрине монетизации (макет, без реальной оплаты)
"""

import os
import sqlite3
import threading

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DATA_DIR, "cheremsha.db")

LOCK = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS player (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    hype          REAL    NOT NULL DEFAULT 0,   -- текущий баланс
    total_hype    REAL    NOT NULL DEFAULT 0,   -- накоплено за всю игру
    subs          REAL    NOT NULL DEFAULT 0,   -- подписчики (двигают этапы)
    cringe        REAL    NOT NULL DEFAULT 0,   -- 0..100
    clicks        INTEGER NOT NULL DEFAULT 0,
    stage         INTEGER NOT NULL DEFAULT 0,
    skin          TEXT    NOT NULL DEFAULT 'default',
    premium       INTEGER NOT NULL DEFAULT 0,   -- макет подписки «Черемша+»
    events_seen   INTEGER NOT NULL DEFAULT 0,
    crises_fixed  INTEGER NOT NULL DEFAULT 0,
    ads_watched   INTEGER NOT NULL DEFAULT 0,
    started_at    TEXT    NOT NULL,
    last_seen     REAL    NOT NULL              -- unix-время последней синхронизации
);

CREATE TABLE IF NOT EXISTS upgrades (
    id      TEXT    PRIMARY KEY,
    level   INTEGER NOT NULL DEFAULT 0,
    spent   REAL    NOT NULL DEFAULT 0,
    bought_at TEXT
);

-- каждая покупка уровня; журнал событий их не дублирует, иначе он превращается
-- в ленту из сотен строк «куплено»
CREATE TABLE IF NOT EXISTS purchases (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       REAL    NOT NULL,
    upgrade  TEXT    NOT NULL,
    level    INTEGER NOT NULL,
    cost     REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      REAL    NOT NULL,
    kind    TEXT    NOT NULL,      -- bonus | crisis | penalty | twist | buy | system | shop
    title   TEXT    NOT NULL,
    text    TEXT    NOT NULL DEFAULT '',
    icon    TEXT    NOT NULL DEFAULT '',
    hype_delta REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shop_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      REAL    NOT NULL,
    item    TEXT    NOT NULL,
    model   TEXT    NOT NULL,
    note    TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
"""


def connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def wipe(conn):
    with LOCK:
        for t in ("shop_log", "purchases", "events", "upgrades", "player"):
            conn.execute(f"DELETE FROM {t}")
        conn.execute("DELETE FROM sqlite_sequence")
        conn.commit()


def rows(conn, sql, params=()):
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def one(conn, sql, params=()):
    r = conn.execute(sql, params).fetchone()
    return dict(r) if r else None
