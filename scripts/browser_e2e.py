"""
브라우저 E2E — 3개 독립 컨텍스트(기기)로 전체 유저 여정을 검증.
실행: /Users/bluepaun/.pi/agent/skills/camoufox-search/.venv/bin/python scripts/browser_e2e.py
"""
import sys
import time
from pathlib import Path

from camoufox.sync_api import Camoufox

BASE = "http://localhost:3000"
SHOTS = Path("/tmp/party-shots")
SHOTS.mkdir(exist_ok=True)

steps = []


def log(msg):
    print(f"[e2e] {msg}", flush=True)
    steps.append(msg)


def shot(page, name):
    p = SHOTS / f"{name}.png"
    page.screenshot(path=str(p))
    log(f"screenshot: {p}")


class Device:
    def __init__(self, browser, label):
        self.label = label
        self.context = browser.new_context(viewport={"width": 1280, "height": 900})
        self.page = self.context.new_page()
        self.dialog_ok = True
        self.page.on("dialog", lambda d: (log(f"{label} dialog: {d.message}"), d.accept() if self.dialog_ok else d.dismiss()))

    def goto(self, path):
        self.page.goto(BASE + path, wait_until="domcontentloaded", timeout=30000)

    def wait(self, ms=800):
        self.page.wait_for_timeout(ms)


def wait_for(page, selector, timeout=15000, label=""):
    page.wait_for_selector(selector, timeout=timeout, state="visible")
    if label:
        log(f"{page}: {label} 보임")


def main():
    with Camoufox(headless=True, geoip=True, os="macos") as browser:
        host = Device(browser, "host")
        p2 = Device(browser, "p2")
        p3 = Device(browser, "p3")

        # ── 1. 홈 ──
        host.goto("/")
        wait_for(host.page, "h1", label="홈 h1")
        shot(host.page, "01-home")

        # ── 2. 방 만들기 (호스트) ──
        host.page.click('a[href="/rooms/create"]')
        wait_for(host.page, "#hostName", label="createForm")
        host.page.fill("#name", "브라우저 E2E 방")
        host.page.fill("#hostName", "지우")
        host.page.click('button[type="submit"]')
        host.page.wait_for_url("**/room/**", timeout=20000)
        code = host.page.url.rstrip("/").split("/")[-1]
        log(f"방 생성 완료: {code}")
        host.wait(1500)
        shot(host.page, "02-lobby-host")

        # ── 3. 참가 (p2, p3) ──
        p2.goto(f"/join?code={code}")
        wait_for(p2.page, "#code", label="joinForm")
        p2.page.wait_for_timeout(500)  # prefill
        p2.page.fill("#join-name", "민준")
        p2.page.click('button[type="submit"]')
        p2.page.wait_for_url("**/room/**", timeout=20000)
        p2.wait(1200)

        p3.goto(f"/join?code={code}")
        wait_for(p3.page, "#code", label="joinForm")
        p3.page.wait_for_timeout(500)
        p3.page.fill("#join-name", "수진")
        p3.page.click('button[type="submit"]')
        p3.page.wait_for_url("**/room/**", timeout=20000)
        p3.wait(1200)
        shot(host.page, "03-lobby-3players")

        # 호스트 화면에 3명 확인
        players_text = host.page.text_content("main")
        assert "지우" in players_text and "민준" in players_text and "수진" in players_text, players_text
        log("3명 모두 로비 표시 확인")

        # ── 3b. 제시어 그룹 설정 (호스트) ──
        sel = host.page.locator('select[aria-label="제시어 그룹"]')
        assert sel.count() > 0, "제시어 그룹 select 미발견"
        opt_texts = sel.locator("option").all_inner_texts()
        log(f"그룹 옵션: {opt_texts[0]} / {opt_texts[1]} / … 총 {len(opt_texts)}개")
        sel.select_option(index=1)  # 전체 랜덤 다음 그룹 (먹거리)
        # 교차 동기화 확인: 비호스트 p2의 select에 반영될 때까지 대기
        # (action 커밋 + room:state broadcast 도달 증거 — host 로컬 값만 보면 race)
        p2sel = p2.page.locator('select[aria-label="제시어 그룹"]')
        for _ in range(25):
            if p2sel.input_value() == "1":
                break
            host.wait(200)
        assert p2sel.input_value() == "1", f"비호스트에 그룹 변경이 동기화되지 않음: {p2sel.input_value()!r}"
        log("그룹 선택 교차 동기화 확인 (p2) — action 커밋 완료")
        log(f"제시어 그룹 선택됨 (value={sel.input_value()})")
        assert p2.page.locator('select[aria-label="제시어 그룹"][disabled]').count() > 0, "비호스트 select가 비활성화돼야 함"
        log("비호스트: 그룹 선택 disabled 확인")
        shot(host.page, "03b-wordgroup")

        # ── 4. 게임 시작 ──
        host.page.click('button:has-text("게임 시작")')
        host.wait(1500)
        shot(host.page, "04-reveal-host")
        shot(p2.page, "04-reveal-p2")
        shot(p3.page, "04-reveal-p3")

        # 역할 확인 클릭 (각자)
        for d in (host, p2, p3):
            d.page.click('button:has-text("알겠어요")')
            d.wait(400)
        host.wait(1200)
        shot(host.page, "05-explain")

        # ── 5. 설명 순서 진행 (차례인 사람이 설명 완료) ──
        for _ in range(6):
            clicked = False
            for d in (host, p2, p3):
                btn = d.page.locator('button:has-text("설명 완료")')
                if btn.count() > 0 and btn.is_visible():
                    log(f"{d.label} 설명 완료 클릭")
                    btn.click()
                    clicked = True
                    break
            if not clicked:
                # vote phase인지 확인
                if host.page.locator('h1:has-text("라이어를 투표하세요")').count() > 0:
                    break
            host.wait(700)
        host.wait(800)
        shot(host.page, "06-vote")

        # ── 6. 투표: 각자 목록의 첫 번째(자기 제외) 투표 ──
        for d in (host, p2, p3):
            opts = d.page.locator('[role="radiogroup"] button')
            if opts.count() > 0:
                log(f"{d.label} 투표: {opts.first.text_content().strip()[:20]}")
                opts.first.click()
                d.wait(300)
                d.page.click('button:has-text("에게 투표하기")')
                d.wait(400)
        host.wait(1000)
        shot(host.page, "07-tally")

        # ── 7. 다음/결과 보기 ──
        for d in (host, p2, p3):
            btn = d.page.locator('button:has-text("결과 보기"), button:has-text("다음")')
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click()
                break
        host.wait(1200)
        shot(host.page, "08-guess-or-result")

        # guess phase라면 (라이어 화면에 입력框)
        for d in (host, p2, p3):
            gi = d.page.locator("#guess-input")
            if gi.count() > 0 and gi.is_visible():
                log(f"{d.label}은(는) guess 단계 — 추측 제출")
                gi.fill("치킨")
                d.page.click('button:has-text("제출하기")')
                break
        host.wait(1200)
        shot(host.page, "09-result")
        result_text = host.page.text_content("main")
        log(f"결과 화면: {result_text[:80]!r}")

        # 결과 제시어가 선택한 그룹의 단어인지 DB로 교차 검증
        import sqlite3
        word_el = host.page.locator('p:text-is("제시어") + p')
        game_word = word_el.first.text_content().strip() if word_el.count() > 0 else None
        con = sqlite3.connect("data/partyroom.db")
        gid = con.execute("SELECT word_group_id FROM rooms WHERE code=?", (code,)).fetchone()[0]
        q = "SELECT word FROM words" + (" WHERE group_id=?" if gid else "")
        group_words = [r[0] for r in con.execute(q, (gid,) if gid else ())]
        con.close()
        assert game_word in group_words, f"결과 제시어 {game_word!r}이(가) 선택 그룹(id={gid})에 없음: {group_words}"
        log(f"결과 제시어 {game_word!r} ∈ 선택 그룹(id={gid}) ✓")

        # ── 8. 한 판 더 (호스트) ──
        host.page.click('button:has-text("한 판 더")')
        host.wait(1500)
        shot(host.page, "10-new-round-reveal")

        # ── 8b. 2라운드: 투표 단계에서 투표용지가 다시 보여야 함 (myVote 라운드 리셋 회귀) ──
        # 3명 모두 1라운드에서 투표함 — 2라운드 투표 단계에서
        # "투표 완료"가 먼저 보이면 지난 라운드 myVote가 남아 있다는 뜻
        for d in (host, p2, p3):
            d.page.click('button:has-text("알겠어요")')
            d.wait(300)
        for _ in range(6):
            clicked = False
            for d in (host, p2, p3):
                btn = d.page.locator('button:has-text("설명 완료")')
                if btn.count() > 0 and btn.is_visible():
                    btn.click()
                    clicked = True
                    break
            if not clicked:
                if host.page.locator('h1:has-text("라이어를 투표하세요")').count() > 0:
                    break
            host.wait(700)
        host.wait(800)
        for d in (host, p2, p3):
            assert d.page.locator('h1:has-text("라이어를 투표하세요")').count() > 0, \
                f"{d.label} 2라운드: 투표용지 미표시 (투표 완료 화면으로 건너뛴?)"
        log("2라운드 투표 단계: 3명 모두 투표용지 표시 (myVote 리셋 확인)")
        shot(host.page, "10b-round2-vote")

        # ── 9. p2 게임 중 이탈 (상단 나가기, confirm accept) ──
        p2.page.click('button:has-text("나가기")')
        p2.page.wait_for_url("**/", timeout=20000)
        log("p2 게임 중 이탈 → 홈 (라운드 초기화)")
        host.wait(1000)
        shot(host.page, "11-after-leave")
        host_text = host.page.text_content("main") or ""
        assert "민준" not in host_text, f"이탈 후에도 민준 표시됨: {host_text[:200]}"
        log("이탈자 로비에서 제거 확인")

        # ── 10. 호스트 방 정리 (confirm accept) ──
        host.page.click('button:has-text("방을 정리하고 새로 시작")')
        host.page.wait_for_url("**/", timeout=20000)
        log("호스트 방 정리 → 홈")

        for d in (host, p2, p3):
            d.context.close()

    log("✅ BROWSER E2E DONE")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"❌ FAILED: {e}")
        sys.exit(1)
