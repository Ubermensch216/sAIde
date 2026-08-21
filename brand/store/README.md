# 크롬 웹스토어 등록 자산

계획서 §5 Phase 7-7. 이 폴더는 **스토어 등록 화면에 그대로 붙여 넣을 것들**이다.
확장 자체에는 포함되지 않는다.

## 들어 있는 것

| 파일 | 규격 | 용도 |
|---|---|---|
| `promo-small-440x280.png` | 440 × 280 | 목록 카드 (선택이지만 없으면 카드가 밋밋하다) |
| `promo-marquee-1400x560.png` | 1400 × 560 | 추천 배너 (선택) |
| 스토어 아이콘 | 128 × 128 | `public/icon/128.png` 을 그대로 올린다 |

`brand/` 의 워드마크·락업 SVG는 폰트가 패스로 변환돼 있으므로(7-5) 어디서 열어도
같은 자형이 나온다. 타일 PNG도 같은 폰트(Inter 600/800 · Pretendard Medium)로
그렸다.

**타일은 먹배경(`#14121C`)이다.** 처음에는 브랜드 주색인 보라 그라디언트로
만들었는데, 아이콘 배경이 같은 보라라 아이콘이 배경에 묻혔다. 로고가 안 보이는
로고 타일은 쓸모가 없다. 흰 카드가 늘어선 스토어 목록에서는 먹배경이 오히려
눈에 띈다.

## 아직 없는 것 — 스크린샷 (필수)

크롬 웹스토어는 **1280 × 800 또는 640 × 400 스크린샷을 최소 1장** 요구한다.
이것만은 만들어 둘 수 없다. **실제로 도는 확장을 찍은 것이어야 하기 때문이다.**
합성한 화면을 스크린샷으로 올리는 것은 사용자를 속이는 일이다.

찍는 순서:

1. `npm run build` 후 `chrome://extensions` → 개발자 모드 → `.output/chrome-mv3` 로드
2. Ollama 실행 확인 (`ollama ps` 에 `gemma4:e2b` 가 떠 있어야 한다)
3. 브라우저 창을 **1280 × 800** 으로 맞추고 사이드패널을 연다
4. 아래 네 장면을 권한다 — 이 확장의 값이 드러나는 순서다

   | 장면 | 왜 |
   |---|---|
   | 긴 기사 페이지 요약 | 가장 흔한 첫 사용 |
   | 승인 카드가 뜬 에이전트 동작 | 승인 게이트가 이 확장의 핵심 설계다 |
   | 설정 화면의 성능 기록 | 비용을 숨기지 않는다는 태도가 보인다 |
   | 우클릭 → "쉽게 설명" | 선택 텍스트 진입점 |

5. 스크린샷에 개인 정보가 담긴 탭·북마크가 찍히지 않는지 확인한다

## 등록 화면에 넣을 문구

manifest 의 이름·설명은 `public/_locales/{ko,en}/messages.json` 이 단일 원본이다.
스토어 목록에는 크롬이 그것을 그대로 쓰므로 여기서 따로 적지 않는다.

### 한 줄 설명 (132자 이내)

- **ko** — 내 컴퓨터에서만 도는 AI 브라우저 조력자. 인터넷 없이 작동합니다.
- **en** — An AI browser aide that runs entirely on your machine. Works without internet.

### 자세한 설명 (ko)

```
sAIde는 브라우저 옆에서 돕는 AI입니다. 페이지를 요약하고, 문장을 다듬고,
필요하면 페이지를 직접 읽고 스크롤합니다.

다른 AI 확장과 다른 점은 하나입니다. 어떤 내용도 이 컴퓨터를 떠나지 않습니다.

· 내 컴퓨터의 Ollama에 연결합니다. 외부 서버로 나가는 요청이 없습니다.
· 인터넷이 끊겨 있어도 그대로 동작합니다.
· 설치할 때 어떤 사이트 권한도 갖지 않습니다. 필요한 순간에 그 사이트만 요청합니다.
· 클릭·입력·주소 이동은 매번 승인을 거칩니다. 자동 승인은 일부러 만들지
  않았습니다 — 페이지에 숨겨진 지시문으로부터 지켜 주는 마지막 장치입니다.
· 응답에 걸리는 시간을 미리 보여줍니다. 설정에서 분량을 늘리면 얼마나
  느려지는지 숫자로 알려 드립니다.

준비물: Ollama 와 모델 하나. 설정 화면이 연결 상태를 확인해 줍니다.
```

### 자세한 설명 (en)

```
sAIde is an AI aide that works beside your browser. It summarizes pages,
polishes your writing, and — when you ask — reads and scrolls the page itself.

One thing sets it apart: nothing ever leaves your machine.

· Talks to Ollama on your own computer. No request goes to an outside server.
· Keeps working with the internet disconnected.
· Installs with no site access at all, and asks for one site at the moment
  it needs it.
· Clicks, typing, and navigation always go through your approval. There is
  deliberately no auto-approve — it is the last thing standing between you
  and instructions hidden in a page.
· Tells you what a request will cost in time, before you wait for it.

You need Ollama and one model. The settings screen checks the connection.
```

## 권한 사유 (등록 시 항목별로 요구된다)

| 권한 | 사유 |
|---|---|
| `sidePanel` | 이 확장의 화면 전체가 사이드패널이다. |
| `activeTab` | 사용자가 "이 페이지 요약" 등을 누른 그 탭에서만 본문을 읽기 위해. |
| `scripting` | 본문 추출·스크롤·클릭 스크립트를 그 순간에만 주입한다. 상시 주입하지 않는다. |
| `storage` | 설정과 대화 기록을 이 컴퓨터에 저장한다. 동기화하지 않는다. |
| `contextMenus` | 선택한 문장에 대한 번역·설명·다듬기 메뉴. |
| `tabs` | 에이전트의 `list_tabs` 도구가 열린 탭 제목·주소를 읽는다. |
| `host_permissions: localhost:11434` | 이 컴퓨터의 Ollama. 확장이 설치 시점에 갖는 유일한 접근권이다. |
| `optional_host_permissions: <all_urls>` | 설치 시점에는 부여되지 않는다. 사용자가 페이지 기능을 처음 쓸 때 해당 사이트만, 또는 설정에서 명시적으로 전체를 허용할 때만 받는다. 화면 캡처는 크롬이 사이트별 권한을 인정하지 않아 이 권한이 있어야 동작한다. |

**단일 목적 (single purpose):** 로컬 LLM으로 현재 보고 있는 페이지를 읽고,
요약·설명·문장 다듬기를 돕고, 사용자의 승인 아래 페이지 조작을 대행한다.

**원격 코드 사용:** 없음. 번들에 포함된 코드만 실행한다.

**데이터 수집:** 없음. 분석·추적·원격 로깅이 없고, 페이지 내용은 이 컴퓨터의
Ollama 외에는 어디로도 전송되지 않는다(§7-6에서 외부 호스트 0건으로 검증).

## 다시 만들려면

타일 생성 스크립트는 저장소에 두지 않았다. Inter·Pretendard 를 npm 에서 받아
Pillow 로 그리는 일회성 작업이라, 폰트를 커밋하지 않는 한 재현이 반쪽이 된다.
다시 만들 일이 생기면 계획서 §11.5의 7-5 항목에 절차가 적혀 있다.
