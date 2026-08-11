# -*- coding: utf-8 -*-
"""Движок «Черемша: Госхайп».

Разделение ответственности осознанное:
  * клиент крутит игровой цикл (клики, начисление в секунду, кринж, таймеры) —
    иначе кликер тормозил бы на каждом тапе;
  * сервер владеет правилами и данными: считает стоимость улучшений и все
    производные множители, сам бросает кубик на события, начисляет оффлайн-доход
    и пишет прогресс, покупки и события в SQLite.

То есть цифры на экране считает браузер, но «что почём» и «что случилось»
решает сервер, и именно его версия сохраняется.
"""

import random
import time

from . import config, db
from .content import BATTLEPASS, EVENTS, SHOP, SKINS, STAGES, UPGRADES

UPGRADE_BY_ID = {u["id"]: u for u in UPGRADES}
EVENT_BY_ID = {e["id"]: e for e in EVENTS}
SHOP_BY_ID = {s["id"]: s for s in SHOP}
SKIN_BY_ID = {s["id"]: s for s in SKINS}


class GameError(Exception):
    """Понятная игроку ошибка (400)."""


def stage_for(subs):
    idx = 0
    for i, s in enumerate(STAGES):
        if subs >= s["subs"]:
            idx = i
    return idx


class Engine:
    def __init__(self):
        self.conn = db.connect()
        self.rnd = random.Random()
        if db.one(self.conn, "SELECT id FROM player WHERE id = 1") is None:
            self.new_game()

    # ------------------------------------------------------------------ базовое
    def _player(self):
        p = db.one(self.conn, "SELECT * FROM player WHERE id = 1")
        if p is None:
            raise GameError("Игрок не создан")
        return p

    def _levels(self):
        return {r["id"]: r["level"]
                for r in db.rows(self.conn, "SELECT id, level FROM upgrades")}

    def _log(self, kind, title, text="", icon="", hype_delta=0.0):
        self.conn.execute(
            "INSERT INTO events (ts, kind, title, text, icon, hype_delta)"
            " VALUES (?,?,?,?,?,?)",
            (time.time(), kind, title, text, icon, float(hype_delta)))

    def new_game(self):
        with db.LOCK:
            db.wipe(self.conn)
            now = time.time()
            self.conn.execute(
                "INSERT INTO player (id, started_at, last_seen) VALUES (1, ?, ?)",
                (time.strftime("%Y-%m-%d %H:%M:%S"), now))
            self.conn.executemany(
                "INSERT INTO upgrades (id, level) VALUES (?, 0)",
                [(u["id"],) for u in UPGRADES])
            self._log("system", "Смена принята",
                      "Мемкомбинат №1 запущен. Гладьте Черемшу — тихо, не спеша, "
                      "без суеты.", "🌿")
            self.conn.commit()
        return self.state()

    # ------------------------------------------------ производные характеристики
    def derive(self, levels=None):
        """Всё, что вытекает из купленных улучшений. Клиент считает по этим числам."""
        levels = levels or self._levels()
        p = self._player()

        add_click = 0.0
        add_passive = 0.0
        mult = 1.0
        crit = 0.0
        combo_lvl = rhythm_lvl = offline_lvl = discount_lvl = brdysh_lvl = 0

        for u in UPGRADES:
            lvl = levels.get(u["id"], 0)
            if not lvl:
                continue
            if u["kind"] == "click":
                add_click += u["value"] * lvl
            elif u["kind"] == "passive":
                add_passive += u["value"] * lvl
            elif u["kind"] == "mult":
                mult += u["value"] * lvl
            elif u["kind"] == "mechanic":
                m = u["mechanic"]
                if m == "crit":
                    crit += u["value"] * lvl
                elif m == "combo":
                    combo_lvl = lvl
                elif m == "rhythm":
                    rhythm_lvl = lvl
                elif m == "offline":
                    offline_lvl = lvl
                elif m == "discount":
                    discount_lvl = lvl
                elif m == "brdysh":
                    brdysh_lvl = lvl

        stage = stage_for(p["subs"])
        stage_mult = STAGES[stage]["mult"]
        total_mult = mult * stage_mult
        offline_rate = min(1.0, 0.25 * offline_lvl) * \
            (config.PREMIUM_OFFLINE_MULT if p["premium"] else 1.0)

        return {
            "click_power": (config.BASE_CLICK + add_click) * total_mult,
            "passive": add_passive * total_mult,
            "mult": round(total_mult, 4),
            "stage": stage,
            "stage_mult": stage_mult,
            "crit_chance": min(0.5, crit),
            "crit_mult": 12.0,
            "combo_every": 10 if combo_lvl else 0,
            "combo_mult": (6.0 + 3.0 * combo_lvl) if combo_lvl else 0.0,
            "rhythm_mult": (2.0 + 0.4 * rhythm_lvl) if rhythm_lvl else 0.0,
            "rhythm_bpm": 104,
            "offline_rate": offline_rate,
            "offline_cap_hours": config.OFFLINE_CAP_HOURS,
            "cost_discount": min(0.5, 0.035 * discount_lvl),
            "cringe_mult": max(0.2, 1.0 - 0.12 * brdysh_lvl),
            "crisis_mult": max(0.2, 1.0 - 0.09 * brdysh_lvl),
        }

    def cost_of(self, upgrade, level, discount):
        growth = 1.0 + (upgrade["growth"] - 1.0) * (1.0 - discount)
        return round(upgrade["cost"] * (growth ** level))

    def upgrade_payload(self, levels, derived):
        out = []
        for u in UPGRADES:
            lvl = levels.get(u["id"], 0)
            maxed = "max" in u and lvl >= u["max"]
            out.append({
                **{k: v for k, v in u.items() if k != "growth"},
                "level": lvl,
                "cost": None if maxed else self.cost_of(u, lvl, derived["cost_discount"]),
                "unlocked": derived["stage"] >= u["stage"],
                "maxed": maxed,
            })
        return out

    def battlepass_payload(self, p, derived):
        vals = {
            "total_hype": p["total_hype"], "clicks": p["clicks"],
            "events_seen": p["events_seen"], "crises_fixed": p["crises_fixed"],
            "stage": derived["stage"],
        }
        return [{**t, "value": vals.get(t["field"], 0),
                 "done": vals.get(t["field"], 0) >= t["goal"]} for t in BATTLEPASS]

    # ---------------------------------------------------------------- состояние
    def state(self, apply_offline=False):
        with db.LOCK:
            p = self._player()
            levels = self._levels()
            derived = self.derive(levels)
            offline = None

            if apply_offline:
                offline = self._grant_offline(p, derived)
                if offline:
                    p = self._player()
                self.conn.execute("UPDATE player SET last_seen = ? WHERE id = 1",
                                  (time.time(),))
                self.conn.commit()

            return {
                "player": {
                    "hype": p["hype"], "total_hype": p["total_hype"],
                    "subs": p["subs"], "cringe": p["cringe"], "clicks": p["clicks"],
                    "stage": derived["stage"], "skin": p["skin"],
                    "premium": bool(p["premium"]), "events_seen": p["events_seen"],
                    "crises_fixed": p["crises_fixed"], "ads_watched": p["ads_watched"],
                    "started_at": p["started_at"],
                },
                "derived": derived,
                "upgrades": self.upgrade_payload(levels, derived),
                "stages": STAGES,
                "shop": SHOP,
                "skins": SKINS,
                "battlepass": self.battlepass_payload(p, derived),
                "events": db.rows(
                    self.conn,
                    "SELECT ts, kind, title, text, icon, hype_delta FROM events"
                    " ORDER BY id DESC LIMIT ?", (config.EVENT_LOG_LIMIT,)),
                "config": {
                    "base_click": config.BASE_CLICK,
                    "click_cooldown_ms": config.CLICK_COOLDOWN_MS,
                    "cringe_max": config.CRINGE_MAX,
                    "cringe_per_passive": config.CRINGE_PER_PASSIVE,
                    "cringe_per_click": config.CRINGE_PER_CLICK,
                    "cringe_decay": config.CRINGE_DECAY,
                    "cringe_safe": config.CRINGE_SAFE,
                    "cringe_penalty_at_max": config.CRINGE_PENALTY_AT_MAX,
                    "subs_per_hype": config.SUBS_PER_HYPE,
                    "subs_cringe_block": config.SUBS_CRINGE_BLOCK,
                    "event_first_delay": config.EVENT_FIRST_DELAY,
                    "event_min_gap": config.EVENT_MIN_GAP,
                    "event_max_gap": config.EVENT_MAX_GAP,
                    "autosave_seconds": config.AUTOSAVE_SECONDS,
                    "ad_boost_mult": config.AD_BOOST_MULT,
                    "ad_boost_seconds": config.AD_BOOST_SECONDS,
                    "ad_cooldown_seconds": config.AD_COOLDOWN_SECONDS,
                },
                "offline": offline,
            }

    def _grant_offline(self, p, derived):
        """Доход за время, пока вкладка была закрыта. Без «Госплана» — ноль."""
        dt = time.time() - p["last_seen"]
        if dt < config.OFFLINE_MIN_SECONDS or derived["offline_rate"] <= 0:
            return None
        if derived["passive"] <= 0:
            return None
        capped = min(dt, config.OFFLINE_CAP_HOURS * 3600)
        gain = derived["passive"] * capped * derived["offline_rate"]
        if gain < 1:
            return None
        self.conn.execute(
            "UPDATE player SET hype = hype + ?, total_hype = total_hype + ?"
            " WHERE id = 1", (gain, gain))
        self._log("system", "Цех работал без вас",
                  f"Госплан выполнен за {int(capped // 60)} мин отсутствия.",
                  "📋", gain)
        return {"seconds": int(capped), "gain": gain,
                "rate": derived["offline_rate"], "capped": dt > capped}

    # ------------------------------------------------------------ синхронизация
    def sync(self, data):
        """Клиент присылает свой счётчик; сервер сохраняет и следит за этапом."""
        with db.LOCK:
            p = self._player()
            hype = max(0.0, float(data.get("hype", p["hype"])))
            total = max(float(p["total_hype"]), float(data.get("total_hype", 0)))
            subs = max(0.0, float(data.get("subs", p["subs"])))
            cringe = min(config.CRINGE_MAX, max(0.0, float(data.get("cringe", p["cringe"]))))
            clicks = max(int(p["clicks"]), int(data.get("clicks", 0)))

            old_stage = stage_for(p["subs"])
            new_stage = stage_for(subs)
            self.conn.execute(
                "UPDATE player SET hype = ?, total_hype = ?, subs = ?, cringe = ?,"
                " clicks = ?, stage = ?, last_seen = ? WHERE id = 1",
                (hype, total, subs, cringe, clicks, new_stage, time.time()))

            if new_stage > old_stage:
                for i in range(old_stage + 1, new_stage + 1):
                    s = STAGES[i]
                    self._log("system", f"Новый этап: {s['name']}", s["tagline"], "🎉")
            self.conn.commit()
        return {"ok": True, "stage": new_stage}

    # -------------------------------------------------------------------- покупки
    def buy(self, upgrade_id, hype):
        with db.LOCK:
            u = UPGRADE_BY_ID.get(upgrade_id)
            if not u:
                raise GameError("Неизвестное улучшение")
            levels = self._levels()
            derived = self.derive(levels)
            lvl = levels.get(upgrade_id, 0)

            if derived["stage"] < u["stage"]:
                raise GameError(f"Откроется на этапе «{STAGES[u['stage']]['name']}»")
            if "max" in u and lvl >= u["max"]:
                raise GameError("Максимальный уровень")

            cost = self.cost_of(u, lvl, derived["cost_discount"])
            hype = max(0.0, float(hype))
            if hype < cost:
                raise GameError(f"Не хватает {cost - hype:,.0f} хайпа"
                                .replace(",", " "))

            self.conn.execute(
                "UPDATE upgrades SET level = level + 1, spent = spent + ?,"
                " bought_at = ? WHERE id = ?",
                (cost, time.strftime("%Y-%m-%d %H:%M:%S"), upgrade_id))
            self.conn.execute("UPDATE player SET hype = ?, last_seen = ? WHERE id = 1",
                              (hype - cost, time.time()))
            self.conn.execute(
                "INSERT INTO purchases (ts, upgrade, level, cost) VALUES (?,?,?,?)",
                (time.time(), upgrade_id, lvl + 1, cost))
            # в журнал попадают только вехи, иначе он тонет в сотнях «куплено»
            if lvl == 0 or (lvl + 1) % 10 == 0:
                self._log("buy", f"{u['icon']} {u['name']} → ур. {lvl + 1}",
                          u["hint"], u["icon"], -cost)
            self.conn.commit()
        return self.state()

    # -------------------------------------------------------------------- события
    def roll_event(self, cringe=0.0):
        """Сервер сам выбирает событие: веса, доступность по этапу и по кринжу."""
        with db.LOCK:
            p = self._player()
            derived = self.derive()
            stage = derived["stage"]
            pool = []
            for e in EVENTS:
                if e["stage"] > stage:
                    continue
                if e.get("require_cringe") and cringe < e["require_cringe"]:
                    continue
                w = float(e["weight"])
                if e["kind"] in ("crisis", "penalty"):
                    if e.get("blockable"):
                        w *= derived["crisis_mult"]      # Брдыщ отпугивает беду
                    if cringe > 70:
                        w *= config.EVENT_CRISIS_CRINGE_BONUS
                pool.append((w, e))
            if not pool:
                return {"event": None}

            total = sum(w for w, _ in pool)
            roll = self.rnd.uniform(0, total)
            chosen = pool[-1][1]
            for w, e in pool:
                roll -= w
                if roll <= 0:
                    chosen = e
                    break

            payload = dict(chosen)
            if chosen.get("instant_hype_seconds"):
                payload["instant_hype"] = derived["passive"] * chosen["instant_hype_seconds"]
            if chosen.get("fix"):
                payload["fix"] = {**chosen["fix"],
                                  "cost": round(p["hype"] * chosen["fix"]["cost_pct"])}

            self.conn.execute(
                "UPDATE player SET events_seen = events_seen + 1 WHERE id = 1")
            self._log(chosen["kind"], chosen["title"], chosen["text"], chosen["icon"],
                      payload.get("instant_hype", 0))
            self.conn.commit()
        return {"event": payload}

    def fix_event(self, event_id, hype):
        """Погасить кризис за хайп."""
        with db.LOCK:
            e = EVENT_BY_ID.get(event_id)
            if not e or not e.get("fix"):
                raise GameError("Это событие нельзя закрыть досрочно")
            hype = max(0.0, float(hype))
            cost = round(hype * e["fix"]["cost_pct"])
            if hype < cost or cost <= 0:
                raise GameError("Не хватает хайпа")
            self.conn.execute(
                "UPDATE player SET hype = ?, crises_fixed = crises_fixed + 1,"
                " last_seen = ? WHERE id = 1", (hype - cost, time.time()))
            self._log("system", f"Кризис закрыт: {e['title']}",
                      e["fix"]["label"], "✅", -cost)
            self.conn.commit()
        return {"ok": True, "cost": cost}

    # -------------------------------------------------------------------- магазин
    def shop(self, item_id):
        """Витрина монетизации. Реальных платежей нет — только реклама работает."""
        with db.LOCK:
            item = SHOP_BY_ID.get(item_id)
            if not item:
                raise GameError("Нет такой позиции")
            self.conn.execute(
                "INSERT INTO shop_log (ts, item, model, note) VALUES (?,?,?,?)",
                (time.time(), item["id"], item["model"],
                 "макет витрины, оплата не подключена"))

            if item["action"] == "ad":
                self.conn.execute(
                    "UPDATE player SET ads_watched = ads_watched + 1 WHERE id = 1")
                self._log("shop", "Просмотрен ролик Петровича",
                          f"×{config.AD_BOOST_MULT:g} к хайпу на "
                          f"{config.AD_BOOST_SECONDS} секунд", "📺")
                self.conn.commit()
                return {"boost": {"mult": config.AD_BOOST_MULT,
                                  "seconds": config.AD_BOOST_SECONDS,
                                  "cooldown": config.AD_COOLDOWN_SECONDS}}

            self.conn.commit()
            return {"mock": True,
                    "message": f"«{item['name']}» — {item['model']}. "
                               "В прототипе это витрина: оплата не подключена, "
                               "механика описана в README."}

    def set_skin(self, skin_id):
        with db.LOCK:
            if skin_id not in SKIN_BY_ID:
                raise GameError("Нет такого скина")
            self.conn.execute("UPDATE player SET skin = ? WHERE id = 1", (skin_id,))
            self.conn.execute(
                "INSERT INTO shop_log (ts, item, model, note) VALUES (?,?,?,?)",
                (time.time(), f"skin:{skin_id}", "Косметика",
                 "макет: скины выдаются бесплатно"))
            self.conn.commit()
        return {"ok": True, "skin": skin_id}

    def stats(self):
        """Сводка из базы — используется в README и для проверки данных."""
        return {
            "upgrades": db.rows(
                self.conn,
                "SELECT id, level, ROUND(spent) spent FROM upgrades"
                " WHERE level > 0 ORDER BY spent DESC"),
            "purchases": db.rows(
                self.conn,
                "SELECT upgrade, COUNT(*) levels, ROUND(SUM(cost)) spent"
                " FROM purchases GROUP BY upgrade ORDER BY spent DESC"),
            "events": db.rows(
                self.conn,
                "SELECT kind, COUNT(*) n FROM events GROUP BY kind ORDER BY n DESC"),
            "shop": db.rows(
                self.conn,
                "SELECT model, COUNT(*) n FROM shop_log GROUP BY model ORDER BY n DESC"),
        }
