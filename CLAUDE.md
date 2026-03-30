# DualSlide — 멀티모니터 배경화면 슬라이드쇼 데스크탑 앱

## 프로젝트 개요
모니터별 독립 슬라이드쇼 배경화면 + 라이트 멀티모니터 관리 도구.
Windows + macOS 크로스플랫폼. Steam 판매 ($2.99 Lite / $4.99 Pro).

## 기술 스택
- **프레임워크**: Tauri 2.0
- **프론트엔드**: React 18+ (Vite) + TypeScript + Tailwind CSS
- **백엔드**: Rust
- **핵심 라이브러리**: more-wallpapers (모니터별 배경 설정, 크로스플랫폼)
- **다국어**: i18next + react-i18next (en, ko, ja, zh-CN, de, es)
- **핫키**: tauri-plugin-global-shortcut

## Tauri 플러그인
- tauri-plugin-dialog (폴더 선택)
- tauri-plugin-store (설정 저장, JSON)
- tauri-plugin-autostart (부팅 시 자동 실행)
- tauri-plugin-global-shortcut (글로벌 핫키, Pro)
- tray-icon (시스템 트레이)

## Rust Dependencies
- more-wallpapers
- serde, serde_json
- tokio (비동기 타이머)
- tokio-util (CancellationToken)
- image (포맷 검증)
- rand (셔플)
- log, env_logger

## 프로젝트 구조
```
src/
  App.tsx
  components/
    MonitorCard.tsx      — 모니터별 설정 카드
    MonitorLayout.tsx    — 모니터 시각적 배치도
    Settings.tsx         — 전체 설정 모달
    ProBadge.tsx         — Pro 잠금/업그레이드 유도
    HotkeyInput.tsx      — 핫키 녹화 입력
    ProUpgradeModal.tsx  — Pro 업그레이드 모달
  hooks/
    useMonitors.ts       — 모니터 목록
    useSlideshow.ts      — 슬라이드쇼 상태
    useHotkeys.ts        — 핫키 관리
  locales/
    en.json, ko.json, ja.json, zh-CN.json, de.json, es.json
  lib/
    commands.ts          — Tauri 커맨드 래퍼
    i18n.ts              — i18next 초기화
src-tauri/
  src/
    main.rs              — Tauri 앱 엔트리
    commands.rs          — Tauri 커맨드 (프론트 호출용)
    slideshow.rs         — 슬라이드쇼 엔진
    monitor.rs           — 모니터 감지 + 배경 설정
    hotkey.rs            — 핫키 관리 (Pro)
    window_mover.rs      — 창 모니터 간 이동 (Pro)
    profiles.rs          — 모니터 프로필 (Pro)
```

## 코딩 규칙

### 프론트엔드 (React/TypeScript)
- 모든 UI 텍스트는 반드시 `t()` 함수 사용. 하드코딩 문자열 금지
- `useTranslation()` 훅으로 번역 함수 가져오기
- 컴포넌트는 함수형 + hooks 패턴
- Tailwind CSS만 사용, 별도 CSS 파일 금지
- 다크모드 기본 색상:
  - 배경: #0f0f23
  - 카드: #1a1a3e
  - 악센트: #6366f1 (인디고), #8b5cf6 (보라)
  - 텍스트: #e2e8f0 (밝은 회색)
  - 에러: #ef4444, 성공: #22c55e

### 백엔드 (Rust)
- 모든 Tauri 커맨드는 `commands.rs`에 모아서 관리
- 에러는 `Result<T, String>` 으로 프론트에 전달
- 모든 함수에 `log::info!`, `log::error!` 로깅 추가
- 슬라이드쇼 엔진은 `Arc<Mutex<SlideshowEngine>>`으로 스레드 안전하게
- 이미지는 경로만 저장, 메모리에 로드하지 않음

### Lite / Pro 분리
- Pro 기능: 핫키, 창 이동, 프로필, 시간대 테마, 전환 효과, 커서 설정
- Pro 체크: `isPro()` 함수로 추상화 (store에서 license 필드 확인)
- Pro 아닌 유저가 접근 시: ProUpgradeModal 표시
- Lite에서도 Pro 기능 UI는 보이되 잠금 상태 (미리보기 효과)

### 다국어
- 지원 언어: en, ko, ja, zh-CN, de, es
- 시스템 언어 자동 감지, fallback은 'en'
- 트레이 메뉴도 다국어 적용
- 번역 키 구조: app.*, monitor.*, slideshow.*, settings.*, pro.*

### 설정 저장
- tauri-plugin-store → settings.json
- 변경 시 자동 저장 (debounce 500ms)
- 앱 시작 시 설정 로드 → 슬라이드쇼 자동 시작
- 설정 파일 손상 시 기본값 초기화

### 에러 처리
- 폴더 삭제됨 → 다국어 토스트 + 슬라이드쇼 정지
- 이미지 없음 → 다국어 토스트
- 모니터 분리 → 자동 정지, 재연결 시 재개
- 미지원 포맷 → 건너뛰기 (무시)

### UI/UX
- 다크모드 고정 (라이트모드 없음)
- 미니멀, 모던 디자인
- 창 크기: 800x600, 최소 600x400
- framer-motion으로 가벼운 애니메이션
- 반응형 불필요 (데스크탑 고정)
- 토스트: 우측 하단, 3초 후 사라짐

### 지원 이미지 포맷
- JPG, JPEG, PNG, BMP, WEBP

### 빌드
- Windows: NSIS 인스톨러
- macOS: DMG
- Cargo release 최적화: opt-level="s", lto=true, strip=true