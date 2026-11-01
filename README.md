# Topic Progression Coder · 화제 전개 코딩 도구

A static web tool for coding **topic progression** in Korean, Japanese and Chinese book reviews, sentence by sentence.
It runs entirely in the browser (plain HTML/CSS/JS, no build step, no server). **Data never leaves the coder's browser.**

한·중·일 북리뷰의 화제 전개를 문장 단위로 코딩하는 정적 웹 도구입니다. 빌드 도구·서버 없이 HTML/CSS/JS만으로 동작하며, **데이터는 코더의 브라우저 밖으로 나가지 않습니다.**

---

## 목차 / Contents

1. [빠른 시작](#1-빠른-시작--quick-start)
2. [입력 CSV](#2-입력-csv)
3. [코드북 (codebook.json)](#3-코드북-codebookjson)
4. [코딩 화면](#4-코딩-화면)
5. [이중코딩과 신뢰도](#5-이중코딩과-신뢰도)
6. [출력](#6-출력)
7. [GitHub Pages 배포](#7-github-pages-배포)
8. [테스트](#8-테스트)
9. [데이터와 개인정보](#9-데이터와-개인정보)
10. [파일 구성](#10-파일-구성)

---

## 1. 빠른 시작 / Quick start

```bash
git clone https://github.com/sorangkim-creator/topic-progression-coder.git
```

```bash
cd topic-progression-coder && python3 -m http.server 8000
```

Open <http://localhost:8000>, go to **Data & export → Load sample CSV**, enter a **Coder ID**, then switch to **Coding**.

> `index.html`을 더블클릭(file://)으로 열어도 코딩은 되지만, 브라우저가 `codebook.json` 자동 읽기를 막습니다. 이때는 **Data & export → Load codebook.json**으로 파일을 직접 고르세요(한 번 읽으면 브라우저에 사본이 저장됩니다). 로컬 서버나 GitHub Pages로 여는 것을 권장합니다.

UI는 영어가 기본이고, 오른쪽 위 **한국어** 버튼으로 바꿀 수 있습니다(중·일 공동 코더는 영어 UI 사용).

## 2. 입력 CSV

| 열 | 설명 |
|---|---|
| `review_id` | 리뷰 고유 ID (중복 불가) |
| `lang` | `ko` / `ja` / `zh` (`kr`, `jp`, `cn` 등 흔한 별칭도 허용) |
| `text` | 리뷰 본문. 쉼표·줄바꿈이 있으면 큰따옴표로 감싸기 |

- 인코딩은 UTF-8 (BOM 있어도 됨). 엑셀에서는 "CSV UTF-8"로 저장하세요.
- 예시: [`sample/sample_reviews.csv`](sample/sample_reviews.csv) (직접 지어낸 짧은 문장들입니다).
- 잘못된 행(언어 코드 오류, 빈 본문, ID 중복)은 건너뛰고 행 번호와 함께 보고합니다.

### 문장 분할 규칙 (기본값, `codebook.json`의 `segmentation`에서 변경 가능)

| 언어 | 종결 부호 | 비고 |
|---|---|---|
| ko | `.` `?` `!` | 뒤에 공백/끝이 올 때만 경계 → `4.5점`, `"좋다."라고` 는 나누지 않음 |
| ja | `。` `！` `？` | 공백 불필요 |
| zh | `。` `！` `？` `；` | 공백 불필요 |

공통: `?!`, `...` 같은 연속 부호는 하나로 처리하고, 바로 뒤의 닫는 따옴표·괄호는 앞 문장에 붙입니다. 「」『』（）“” 안의 종결 부호에서는 나누지 않습니다. 줄바꿈은 문장 경계로 봅니다(`splitOnNewline: false`로 끌 수 있음).

자동 분할이 틀리면 코딩 화면의 **Merge with previous / Merge with next / Split at cursor**로 고칩니다. (나누기: 문장 텍스트 안을 클릭해 커서를 둔 뒤 버튼 클릭)

## 3. 코드북 (codebook.json)

모든 범주와 정의는 [`codebook.json`](codebook.json)에서 읽습니다. **코드북이 바뀌어도(v2 등) 코드는 고칠 필요 없이 JSON만 수정**하면 됩니다.

| 키 | 내용 |
|---|---|
| `version` | 코드북 버전. 프로젝트·내보내기 파일에 기록되고, 버전이 다르면 경고합니다 |
| `progressionTypes` | 화제 전개 6유형: 신규도입 `new` / 유지 `maintain` / 선형 `linear` / 파생 `derived` / 재도입 `reintro` / 종합 `synthesis` |
| `genreStages` | 장르 단계 4개: 소개 `intro` / 요약 `summary` / 평가 `evaluation` / 추천 `recommendation` |
| `topicMarkers` | 언어별(`ko`/`ja`/`zh`) 화제 표지 목록. 현재 값은 **예시용 초기 목록**이니 코드북에 맞게 바꾸세요 |
| `allowCustomMarkers` | `true`면 목록에 없는 표지를 직접 입력 가능 |
| `principles` | 코딩 원칙 4조. 사이드 패널과 상단 "Principles ⓘ" 툴팁에 항상 표시 |
| `segmentation` | 언어별 문장 분할 규칙 |

각 항목의 형식:

```json
{
  "id": "maintain",
  "key": "2",
  "label": { "ko": "유지", "en": "Maintenance" },
  "definition": { "ko": "TODO: 정의를 입력하세요.", "en": "TODO: add definition." },
  "example": { "ko": "", "en": "" }
}
```

- **정의·원칙 문구는 모두 `TODO` 빈 자리로 두었습니다.** 채워 넣으면 버튼 툴팁, 사이드 패널 정의 목록에 바로 반영됩니다. Data 탭에 남은 `TODO` 개수가 표시됩니다.
- `id`는 코딩 데이터에 저장되는 값입니다. **버전을 올릴 때 기존 `id`는 바꾸지 말고**, 이름(label)·정의만 수정하거나 새 `id`를 추가하세요. 이미 코딩된 값 중 코드북에 없는 `id`는 `id (?)`로 표시됩니다.
- `key`는 선택 사항인 한 글자 단축키입니다. 예약 키 `j k s t m f [ ] ?`와 화살표는 쓸 수 없습니다(쓰면 경고 후 무시).
- `label`/`definition`은 `{ "ko": ..., "en": ... }` 형태이며, 현재 UI 언어 → 영어 → 한국어 순으로 표시합니다.
- 코드북을 고친 뒤 브라우저에서 새로고침하면 적용됩니다(GitHub Pages는 반영까지 1~2분).

## 4. 코딩 화면

왼쪽은 리뷰 목록(언어·표본·미완료 필터, 진행률), 가운데는 현재 리뷰의 문장들, 오른쪽은 **코딩 원칙·정의·단축키** 패널입니다.

현재 문장마다 입력하는 항목:

- **화제 (Topic)**: 문장에서 텍스트를 드래그로 선택하고 `S`(또는 "Use selection") → 선택 범위와 문자 위치가 저장되고 문장에 하이라이트. 직접 입력도 가능.
- **전개 유형**: `1`–`6` 또는 클릭 (같은 키를 다시 누르면 해제)
- **장르 단계**: `Q` `W` `E` `R` 또는 클릭
- **화제 표지**: 해당 언어의 표지 버튼 클릭, `(none)`, 또는 `F`로 기타 입력
- **메모**: `M`

| 키 | 동작 |
|---|---|
| `↓` / `J`, `↑` / `K` | 다음 / 이전 문장 (리뷰 끝에서는 다음 리뷰로) |
| `]` / `[` | 다음 / 이전 리뷰 |
| `S` | 선택한 텍스트를 화제로 |
| `T` / `F` / `M` | 화제 / 기타 표지 / 메모 입력란으로 |
| `Esc` / `Enter` | 입력란에서 나오기 |

- 유형과 단계가 모두 입력되면 "코딩 완료"로 셉니다. 상단 진행 막대에 표시(마우스를 올리면 언어별 진행률).
- 단축키 패널의 "Auto-advance"를 켜면 유형·단계 입력 후 자동으로 다음 문장으로 넘어갑니다.
- **자동 저장**: 모든 변경은 브라우저 저장소(localStorage)에 즉시 저장됩니다. 그래도 정기적으로 **Export JSON**으로 백업하세요(브라우저 데이터 삭제 시 사라짐).
- **코더 ID**는 내보내기 전에 꼭 입력해야 합니다.

## 5. 이중코딩과 신뢰도

**Double coding** 탭에서 진행합니다.

### 5.1 표본 추출

1. 시드(seed)와 비율(기본 20%)을 정하고 **Draw sample**.
2. 리뷰 단위로, **언어별 층화** 추출합니다. 언어마다 `round(리뷰 수 × 비율)`개(최소 1개)를 뽑습니다.
3. 같은 시드 → 항상 같은 표본(시드 고정 PRNG: mulberry32). 결과는 CSV 행 순서와 무관하며, 언어마다 별도 난수열(`시드:언어`)을 써서 한 언어의 리뷰가 늘어도 다른 언어의 표본은 바뀌지 않습니다. 시드는 논문·보고서에 기록해 두세요.
4. **Export package for 2nd coder**: 표본 리뷰만, **현재 문장 분할 그대로**, 코드는 비운 JSON을 만듭니다. 2차 코더는 이 파일을 Data 탭 **Import JSON**으로 불러와 코딩하고 다시 JSON으로 내보냅니다.

> 패키지를 보낸 뒤에는 표본 리뷰의 문장 분할을 바꾸지 마세요. 문장은 (review_id, 문장 번호)로 대응되므로, 분할이 다르면 해당 문장은 비교에서 제외됩니다(목록으로 확인 가능). 표본 리뷰의 분할을 바꾸려 하면 경고가 뜹니다.

### 5.2 일치도 계산

1. 코더 A JSON(또는 **Use current project as A**), 코더 B JSON을 불러옵니다.
2. 필요하면 언어를 고르고 **Compute agreement**.
3. 변수별(**전개 유형, 장르 단계, 화제 표지**)로 n, 제외 수, 일치율 pₒ, 우연 일치 pₑ, **Cohen's κ**, Landis & Koch(1977) 해석, **혼동행렬**(행 A, 열 B)을 보여 줍니다. 화제 표현은 참고용으로 완전 일치율만 표시합니다.

결측 처리:
- 유형·단계: 한 코더라도 비워 둔 문장은 해당 변수 계산에서 **제외**(제외 수 표시).
- 표지: 빈 값은 `(none)`이라는 **하나의 범주**로 계산(표지가 없는 것도 판단이므로).

κ = (pₒ − pₑ) / (1 − pₑ). 두 코더가 모두 한 범주만 사용해 pₑ = 1이면 κ는 정의되지 않으며, 완전 일치일 때만 1로 표시합니다.

### 5.3 불일치와 합의

- 하나 이상의 변수에서 다른 문장이 목록으로 나옵니다(다른 변수는 빨간색).
- 변수별 최종값을 고르거나 **Take A / Take B**로 한쪽 값을 한 번에 채택하고, 최종 화제·합의 메모를 적습니다.
- **합의 결과는 각 코더의 데이터와 별도로** 브라우저에 저장되며, **Export consensus JSON / CSV**로 내보냅니다. CSV에는 비교된 모든 문장이 A값·B값·최종값·상태(`agreed` / `resolved` / `unresolved`)와 함께 들어갑니다.

## 6. 출력

**Data & export → Export CSV**: 문장 1행, **UTF-8 BOM 포함**(엑셀에서 한·중·일 글자가 깨지지 않음), CRLF 줄바꿈.

| 열 | 내용 |
|---|---|
| `review_id`, `lang`, `sentence_no`, `sentence_id` | 위치 정보 (`sentence_id` = `리뷰ID_s번호`) |
| `text` | 문장 |
| `topic_expression`, `topic_start`, `topic_end` | 화제 표현과 문장 내 문자 위치(0부터, 끝 위치 미포함). 직접 입력한 경우 위치는 빈칸 |
| `progression_type`, `progression_type_label` | 유형 id와 이름 |
| `genre_stage`, `genre_stage_label` | 단계 id와 이름 |
| `topic_marker` | 표지 (빈칸 = 없음) |
| `memo`, `coded`, `in_sample`, `coder_id`, `codebook_version` | 메모, 완료 여부(1/0), 표본 여부(1/0), 코더, 코드북 버전 |

**Export JSON**은 문장 분할·코드·표본·코더 ID·코드북 버전을 모두 담은 프로젝트 파일입니다(백업, 이어서 작업, 신뢰도 비교에 사용).

## 7. GitHub Pages 배포

빌드가 필요 없으므로 저장소를 그대로 배포하면 됩니다.

1. GitHub 저장소 → **Settings → Pages**
2. **Build and deployment → Source: Deploy from a branch**
3. **Branch: `main`**, 폴더 **`/ (root)`** → **Save**
4. 1~2분 뒤 `https://<사용자명>.github.io/topic-progression-coder/` 에서 열립니다(이 저장소라면 `https://sorangkim-creator.github.io/topic-progression-coder/`).

참고:
- 루트의 `.nojekyll` 파일은 Jekyll 처리를 끄기 위한 것이니 지우지 마세요.
- 모든 경로가 상대 경로라 하위 경로(`/topic-progression-coder/`)에서도 그대로 동작합니다.
- 코드북만 고치려면 GitHub 웹에서 `codebook.json`을 편집·커밋하면 됩니다. 코더들은 새로고침만 하면 됩니다.
- 저장소가 비공개여도 Pages 사이트는 (요금제에 따라) 공개될 수 있습니다. 사이트에는 도구와 코드북만 있고 **리뷰 데이터는 올라가지 않습니다** — 실제 데이터 CSV를 저장소에 커밋하지 않도록 주의하세요.
- localStorage는 사이트 주소(origin)별로 따로 저장됩니다. 로컬(`localhost`)에서 하던 작업은 Pages 주소에서 보이지 않으니 JSON으로 옮기세요.

## 8. 테스트

κ 계산·CSV·문장 분할·표본 추출·문장 대응을 검증하는 테스트가 있습니다. κ는 결과가 알려진 예제로 확인합니다.

- Wikipedia "Cohen's kappa" 예제: 2×2 표 (20, 5, 10, 15) → pₒ = .70, pₑ = .50, **κ = .40**
- 같은 일치율(.60)인데 κ가 다른 두 표: (45, 15, 25, 15) → **κ ≈ .1304**, (25, 35, 5, 35) → **κ ≈ .2593**
- 3범주 손계산 예제 (n = 40): pₒ = .725, pₑ = .3375, **κ = .3875 / .6625 ≈ .5849** (혼동행렬까지 확인)
- 완전 일치 = 1, 체계적 불일치 = −1, 단일 범주·빈 입력 같은 경계 사례, 코더 순서 대칭성

실행 (Node.js, 의존성 없음):

```bash
node tests/run-node.js
```

브라우저에서는 사이트의 `tests/index.html`을 열면 같은 테스트가 실행됩니다.

## 9. 데이터와 개인정보

- CSV/JSON 파일은 브라우저의 FileReader로 **로컬에서만** 읽습니다. 업로드·분석 서버·외부 스크립트·폰트·통계 수집이 없습니다.
- `index.html`의 Content-Security-Policy가 같은 사이트 외의 네트워크 요청과 외부 스크립트를 브라우저 차원에서 막습니다. 네트워크 요청은 같은 사이트의 `codebook.json`과 샘플 CSV를 읽을 때뿐입니다.
- 작업 내용은 그 브라우저의 localStorage에만 저장됩니다(키: `tpc.project.v1`, `tpc.consensus.v1`, `tpc.codebook.v1`, `tpc.ui.v1`). 공용 PC에서는 작업 후 JSON을 내보내고 **Clear project**로 지우세요.
- 내보내기는 브라우저 안에서 파일을 만들어 다운로드합니다.

## 10. 파일 구성

```
index.html              앱 화면
css/style.css           스타일
js/core.js              순수 로직: CSV, 문장 분할, 합치기/나누기, 표본 추출, κ (브라우저·Node 공용)
js/i18n.js              UI 문구 (en, ko)
js/app.js               화면 동작, 저장, 내보내기
codebook.json           코드북 (여기만 고치면 됨)
sample/sample_reviews.csv  지어낸 샘플 데이터
tests/tests.js          테스트 모음
tests/run-node.js       Node 실행기
tests/index.html        브라우저 실행기
.nojekyll               GitHub Pages용
```

UI 언어 추가: `js/i18n.js`의 `en` 블록을 복사해 새 언어 코드로 번역하고, `index.html`의 언어 버튼을 하나 추가하면 됩니다.
