"""
브라우저 E2E (양세찬 게임) — 3개 독립 컨텍스트(기기)로 UI 전체를 검증.
- 홈 카드 → ?game=cmy 방 만들기 → 로비 설정(모드/제시어/타이머) → 플레이
- 이마 모드: 타인 단어 배지 표시 / 질문·답변 UI / 정답 추정 / 결과 등수
실행: PORT=3030 /Users/bluepaun/.pi/agent/skills/camoufox-search/.venv/bin/python scripts/browser_e2e_cmy.py
"""
import json
import os
import sqlite3
import subprocess
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
        return self.page.text_content("main")


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
        shot(host.page, "01-home")

        # ── 2. 방 만들기 (?game=cmy) ──
        host.page.click('a[href="/rooms/create?game=cmy"]')
        host.page.wait_for_selector("#hostName", timeout=15000)
        assert host.page.locator('input[name="game"][value="cmy"]').count() == 1, "game=cmy hidden input"
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
        shot(host.page, "02-lobby")

        # ── 4. 로비 설정 UI 검증 ──
        t = host.main_text()
        assert "양세찬 게임" in t, "로비에 게임 제목"
        assert "게임 설정" in t, "게임 설정 카드"
        assert "이마" in t and "손" in t and "랜덤" in t and "출제자" in t and "타이머" in t, "설정 항목"
        log("로비: 게임 설정(모드/제시어/타이머) 확인")

        # 모드 토글: 손 → active 확인 → 이마로 복원
        hand_btn = host.page.locator('button:has-text("✋ 손")')
        hand_btn.click()
        for _ in range(25):
            cls = hand_btn.evaluate("el => el.className")
            if "bg-surface-warm" in cls:
                break
            host.wait(200)
        assert "bg-surface-warm" in cls, "손 모드 active 클래스"
        log("로비: 모드 토글 '손' active 확인")
        shot(host.page, "03-mode-hand")
        host.page.locator('button:has-text("🔝 이마")').click()
        for _ in range(25):
            cls = host.page.locator('button:has-text("🔝 이마")').evaluate("el => el.className")
            if "bg-surface-warm" in cls:
                break
            host.wait(200)
        assert "bg-surface-warm" in cls, "이마 모드 복원 active"
        log("로비: 모드 '이마'로 복원")

        # ── 5. 게임 시작 ──
        host.page.click('button:has-text("게임 시작")')
        for d in devices.values():
            d.page.wait_for_selector("text=CALL MY NAME", timeout=15000)
        log("play 진입 (3기기)")
        host.wait(800)
        shot(host.page, "04-play-start")

        # ── 6. 이마 배지: 각 기기는 타인 단어 2개 표시 ──
        room_row = db_query("SELECT words FROM cmy_games WHERE room_id=?", (code,))
        words_map = json.loads(room_row[0][0])  # {pid: word}
        players = db_query(
            "SELECT id, name FROM players WHERE room_id=? ORDER BY joined_at", (code,)
        )
        pid2name = {pid: name for pid, name in players}
        word_by_name = {pid2name[pid]: w for pid, w in words_map.items()}
        log(f"단어: {word_by_name}")

        for key, d in devices.items():
            me = names[key]
            d.page.wait_for_timeout(300)
            t = d.main_text()
            others = [w for n, w in word_by_name.items() if n != me]
            for w in others:
                assert w in t, f"{me}: 타인 단어 '{w}' 배지缺失"
            log(f"이마 배지: {me}는 타인 단어 {others} 확인")
        shot(host.page, "05-forehead-badges")

        # ── 7. 턴 루프: 1턴 = 질문 또는 추정 (택1) — 전원 해결까지 ──
        # 각 플레이어: 오답 추정 1회(턴 상실) → 질문 1회(턴 소비) → 정답 추정 1회
        solved = set()
        wrongGuessed = set()
        asked = set()
        while len(solved) < 3:
            # 턴 플레이어 찾기 (h1 "당신 차례예요!")
            turn_key = None
            for key, d in devices.items():
                if key in solved:
                    continue
                h1 = d.page.locator("h1").first.text_content() or ""
                if "당신 차례" in h1:
                    turn_key = key
                    break
            assert turn_key, f"턴 플레이어 미발견 (solved={solved})"
            turn = devices[turn_key]
            turn_name = names[turn_key]

            if turn_key not in wrongGuessed:
                # 1) 오답 추정 → "아직 아니에요!" 토스트 → 질문 기회 상실
                turn.page.click('button:has-text("내 단어를 알아냈어요!")')
                turn.page.fill("#cmy-guess", "없는 단어 xyz")
                turn.page.click('button:has-text("외치기!")')
                turn.page.wait_for_selector("text=아직 아니에요!", timeout=10000)
                wrongGuessed.add(turn_key)
                log(f"오답: {turn_name} → 턴 상실 (다음 사람 차례)")
                for d in devices.values():
                    d.wait(800)
                continue

            if turn_key not in asked:
                # 2) 질문 (턴 소비) → 다른 전원이 답변
                log(f"턴: {turn_name} (질문)")
                turn.page.fill("#cmy-question", "저는 사람인가요?")
                turn.page.click('button:has-text("질문하기")')
                turn.wait(600)
                shot(turn.page, f"06-question-{turn_name}")
                for key, d in devices.items():
                    if key == turn_key:
                        continue
                    d.page.locator('button:has-text("아니요")').click()
                asked.add(turn_key)
                for d in devices.values():
                    d.wait(1000)
                continue

            # 3) 정답 추정 (질문 대신) → 해결
            log(f"턴: {turn_name} (추정)")
            turn.page.click('button:has-text("내 단어를 알아냈어요!")')
            turn.page.fill("#cmy-guess", word_by_name[turn_name])
            turn.page.click('button:has-text("외치기!")')
            turn.wait(1500)
            assert "맞혔어요" in turn.main_text(), f"{turn_name}: 추정 성공 배너 없음"
            solved.add(turn_key)
            log(f"추정 성공: {turn_name} ({len(solved)}/3)")
            for d in devices.values():
                d.wait(600)

        # ── 8. 결과 ──
        host.page.wait_for_selector("text=라운드 종료!", timeout=15000)
        t = host.main_text()
        for w in word_by_name.values():
            assert w in t, f"결과 단어 공개: {w}"
        log("결과: 등수 + 전원 단어 공개 확인")
        assert host.page.locator('button:has-text("한 판 더")').count() == 1, "호스트 '한 판 더'"
        assert host.page.locator('button:has-text("대기실로")').count() == 1, "'대기실로'"
        shot(host.page, "07-result")

        # ── 9. 대기실로 → JUST FINISHED 카드 ──
        host.page.click('button:has-text("대기실로")')
        host.page.wait_for_selector("text=JUST FINISHED", timeout=15000)
        log("대기실: JUST FINISHED 카드 확인")
        shot(host.page, "08-lobby-after")

        # ── 정리 ──
        db_query("DELETE FROM rooms WHERE code=?", (code,))
        log(f"방 {code} 정리")
        log("✅ CMy BROWSER E2E DONE")


if __name__ == "__main__":
    main()
