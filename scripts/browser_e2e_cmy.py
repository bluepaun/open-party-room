"""
브라우저 E2E (양세찬 게임) — 3개 독립 컨텍스트(기기)로 UI 전체를 검증.
- 홈 카드 → ?game=cmy 방 만들기 → 로비 설정(모드/제시어/타이머)
- 1라운드 (이마): 카운트다운 → 내 단어 전체화면 → '정답' 버튼 확인 → 결과
- 2라운드 (손): 타인 단어 카드 트레이 → 턴별 추정(오답→턴 상실) → 결과
실행: PORT=3030 /Users/bluepaun/.pi/agent/skills/camoufox-search/.venv/bin/python scripts/browser_e2e_cmy.py
"""
import json
import os
import sqlite3
from pathlib import Path

from camoufox.sync_api import Camoufox

BASE = os.environ.get("BASE_URL") or f"http://localhost:{os.environ.get('PORT', '3000')}"
DB = Path(__file__).resolve().parent.parent / "data" / "partyroom.db"
SHOTS = Path("/tmp/party-shots")
SHOTS.mkdir(exist_ok=True)


def log(msg):
    print(f"[e2e-cmy] {msg}", flush=True)


def shot(page, name):
    p = SHOTS / f"cmy-{name}.png"
    page.screenshot(path=str(p))
    log(f"screenshot: {p}")


class Device:
    def __init__(self, browser, label):
        self.label = label
        self.context = browser.new_context(viewport={"width": 1280, "height": 900})
        self.page = self.context.new_page()
        self.page.on("dialog", lambda d: (log(f"{label} dialog: {d.message}"), d.accept()))

    def goto(self, path):
        self.page.goto(BASE + path, wait_until="domcontentloaded", timeout=30000)

    def wait(self, ms=800):
        self.page.wait_for_timeout(ms)

    def main_text(self):
        return self.page.text_content("main") or ""


def db_query(sql, args=()):
    con = sqlite3.connect(DB)
    try:
        rows = con.execute(sql, args).fetchall()
    finally:
        con.close()
    return rows


def main():
    with Camoufox(headless=True, geoip=True, os="macos") as browser:
        host = Device(browser, "host")
        p2 = Device(browser, "p2")
        p3 = Device(browser, "p3")
        names = {"host": "지우", "p2": "민준", "p3": "수진"}
        devices = {"host": host, "p2": p2, "p3": p3}

        # ── 1. 홈 → 양세찬 게임 카드 ──
        host.goto("/")
        host.page.wait_for_selector("h1", timeout=15000)
        card = host.page.locator('article:has-text("양세찬 게임")')
        assert card.count() == 1, "홈에 양세찬 게임 카드가 있어야 함"
        log("홈: 양세찬 게임 카드 발견")

        # ── 2. 방 만들기 (?game=cmy) ──
        host.page.click('a[href="/rooms/create?game=cmy"]')
        host.page.wait_for_selector("#hostName", timeout=15000)
        host.page.fill("#name", "CMy E2E 방")
        host.page.fill("#hostName", "지우")
        host.page.click('button[type="submit"]')
        host.page.wait_for_url("**/room/**", timeout=20000)
        code = host.page.url.rstrip("/").split("/")[-1]
        log(f"방 생성 완료: {code} (game=cmy)")
        host.wait(1500)

        # ── 3. 참가 (p2, p3) ──
        for key in ("p2", "p3"):
            d = devices[key]
            d.goto(f"/join?code={code}")
            d.page.wait_for_selector("#code", timeout=15000)
            d.page.wait_for_timeout(500)
            d.page.fill("#join-name", names[key])
            d.page.click('button[type="submit"]')
            d.page.wait_for_url("**/room/**", timeout=20000)
            d.wait(1200)
        log("3명 모두 접속")

        # ── 4. 로비: 기본 모드 이마 (전체화면) 확인 ──
        t = host.main_text()
        assert "게임 설정" in t, "게임 설정 카드"
        assert "내 단어 전체화면" in t, "이마 모드 라벨 (내 단어 전체화면)"
        log("로비: 게임 설정 확인 (기본: 이마)")

        # ── 5. 1라운드 (이마): 시작 ──
        host.page.click('button:has-text("게임 시작")')
        host.wait(1200)
        # 카운트다운(10초): 대형 안내 문구 표시 확인
        for d in devices.values():
            d.page.wait_for_selector("text=보여 주세요", timeout=10000)
        shot(host.page, "04-countdown")
        log("이마: 카운트다운 화면 '다른 사람에게 보여 주세요' 확인")
        # 카운트다운 종료 → "다른 사람에게 보이게 해주세요" + 단어
        for d in devices.values():
            d.page.wait_for_selector("text=다른 사람에게 보이게 해주세요", timeout=20000)
        log("이마: 3기기 모두 공개 화면 진입 (카운트다운 종료)")
        host.wait(400)

        # ── 6. 각 기기: 내 단어 전체화면 확인 ──
        room_row = db_query("SELECT words FROM cmy_games WHERE room_id=?", (code,))
        words_map = json.loads(room_row[0][0])
        players = db_query(
            "SELECT id, name FROM players WHERE room_id=? ORDER BY joined_at", (code,)
        )
        pid2name = {pid: name for pid, name in players}
        word_by_name = {pid2name[pid]: w for pid, w in words_map.items()}
        log(f"단어: {word_by_name}")

        for key, d in devices.items():
            me = names[key]
            w = word_by_name[me]
            d.page.wait_for_selector(f"p:has-text('{w}')", timeout=10000)
            assert "정답" in d.main_text(), f"{me}: '정답' 버튼 없음"
            log(f"이마: {me} 화면 = 내 단어 '{w}' 전체화면 + 정답 버튼")
        shot(host.page, "05-forehead-fullscreen")

        # ── 7. '정답' 버튼 순차 확인 (다른 사람이 맞춰준 설정) → 전원 해결 ──
        for i, key in enumerate(("host", "p2", "p3")):
            d = devices[key]
            d.page.click('button:has-text("정답")')
            d.wait(1200)
            assert "맞혔어요" in d.main_text(), f"{names[key]}: 확인 후 '맞혔어요' 없음"
            log(f"이마: {names[key]} '정답' 확인 → {i + 1}위")
        host.page.wait_for_selector("text=라운드 종료!", timeout=15000)
        t = host.main_text()
        for w in word_by_name.values():
            assert w in t, f"결과 단어 공개: {w}"
        log("결과: 등수 + 전원 단어 공개 확인")
        shot(host.page, "06-result-forehead")

        # ── 8. 대기실 → 손 모드로 전환 → 2라운드 ──
        host.page.click('button:has-text("대기실로")')
        host.page.wait_for_selector("text=JUST FINISHED", timeout=15000)
        hand_btn = host.page.locator('button:has-text("✋ 손")')
        hand_btn.click()
        for _ in range(25):
            if "bg-surface-warm" in hand_btn.evaluate("el => el.className"):
                break
            host.wait(200)
        assert "bg-surface-warm" in hand_btn.evaluate("el => el.className"), "손 모드 active"
        log("로비: 손 모드로 전환")
        host.page.click('button:has-text("한 판 더")')
        for d in devices.values():
            d.page.wait_for_selector("text=CALL MY NAME", timeout=15000)
        log("2라운드 (손) 진입")
        host.wait(800)

        # ── 9. 손 모드: 타인 단어 카드 트레이 + 추정 루프 ──
        room_row = db_query("SELECT words FROM cmy_games WHERE room_id=?", (code,))
        words_map = json.loads(room_row[0][0])
        word_by_name2 = {pid2name[pid]: w for pid, w in words_map.items()}
        log(f"새 단어: {word_by_name2}")

        for key, d in devices.items():
            me = names[key]
            others = [w for n, w in word_by_name2.items() if n != me]
            assert "내 손 카드" in d.main_text(), f"{me}: 카드 트레이 없음"
            for w in others:
                assert w in d.main_text(), f"{me}: 타인 단어 '{w}' 트레이에 없음"
            assert d.page.locator("#cmy-question").count() == 0, f"{me}: 질문 입력 UI 잔존"
            assert d.page.locator('button:has-text("질문하기")').count() == 0, f"{me}: 질문하기 버튼 잔존"
            log(f"손: {me} 타인 단어 {others} 확인 (질문 UI 없음)")
        shot(host.page, "07-hand-tray")

        solved = set()
        wrong = set()
        passed = set()
        while len(solved) < 3:
            turn_key = None
            for key, d in devices.items():
                if key in solved:
                    continue
                h1 = d.page.locator("h1").first.text_content() or ""
                if "당신 차례" in h1:
                    turn_key = key
                    break
            assert turn_key, f"턴 플레이어 미발견 (solved={solved})"
            d = devices[turn_key]
            name = names[turn_key]

            if turn_key not in passed:
                d.page.click('button:has-text("턴 넘기기")')
                passed.add(turn_key)
                log(f"손: {name} 턴 넘기기 (패스) → 다음 차례")
                for x in devices.values():
                    x.wait(800)
                continue

            if turn_key not in wrong:
                d.page.fill("#cmy-guess", "없는 단어 xyz")
                d.page.click('button:has-text("외치기!")')
                d.page.wait_for_selector("text=아직 아니에요!", timeout=10000)
                wrong.add(turn_key)
                log(f"손: 오답 {name} → 턴 상실 (다음 사람 차례)")
                for x in devices.values():
                    x.wait(800)
                continue

            d.page.fill("#cmy-guess", word_by_name2[name])
            d.page.click('button:has-text("외치기!")')
            try:
                d.page.wait_for_selector("text=맞혔어요", timeout=8000)
            except Exception:
                row = db_query(
                    "SELECT phase, json_extract(solved, '$') FROM cmy_games WHERE room_id=?", (code,)
                )
                log(f"DEBUG {name} guess fail | db: {row} | text: {d.main_text()[:400]!r}")
                raise
            solved.add(turn_key)
            log(f"손: 추정 성공 {name} ({len(solved)}/3)")
            for x in devices.values():
                x.wait(600)

        try:
            host.page.wait_for_selector("text=라운드 종료!", timeout=15000)
        except Exception:
            log("DEBUG host text:\n" + host.main_text()[:600])
            log("DEBUG host url: " + host.page.url)
            shot(host.page, "08-debug-hand")
            raise
        log("2라운드 결과 도달")
        shot(host.page, "08-result-hand")

        # ── 정리 ──
        db_query("DELETE FROM rooms WHERE code=?", (code,))
        log(f"방 {code} 정리")
        log("✅ CMy BROWSER E2E DONE")


if __name__ == "__main__":
    main()
