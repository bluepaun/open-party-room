"use client";

import { useEffect, useRef } from "react";

/**
 * Screen Wake Lock API를 활용해 게임 진행 중 모바일/태블릿 화면이 꺼지지 않도록 방지하는 훅.
 * - 지원 브라우저 자동 판별 (미지원 환경에서도 오류 없이 no-op)
 * - 탭 비활성화 후 복귀(visibilitychange, focus) 시 자동으로 락 재획득
 * - 사용자 인터랙션(터치/클릭) 제약 시 첫 제스처 발생 시 락 획득
 * - 게임 종료 또는 언마운트 시 안전하게 락 해제
 */
export function useWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("wakeLock" in navigator)) {
      return;
    }

    let isMounted = true;

    const requestLock = async () => {
      if (!enabled || !isMounted) return;
      if (document.visibilityState !== "visible") return;
      if (sentinelRef.current && !sentinelRef.current.released) return;

      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (!isMounted || !enabled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
          }
        });
      } catch {
        // 저전력 모드 또는 브라우저 권한 제한 시 무시
      }
    };

    const releaseLock = async () => {
      if (sentinelRef.current) {
        try {
          await sentinelRef.current.release();
        } catch {
          // ignore
        }
        sentinelRef.current = null;
      }
    };

    if (enabled) {
      requestLock();
    } else {
      releaseLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && enabled) {
        requestLock();
      }
    };

    const handleInteraction = () => {
      if (enabled && (!sentinelRef.current || sentinelRef.current.released)) {
        requestLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);
    window.addEventListener("pointerdown", handleInteraction, { passive: true });
    window.addEventListener("touchstart", handleInteraction, { passive: true });

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
      window.removeEventListener("pointerdown", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
      releaseLock();
    };
  }, [enabled]);
}
