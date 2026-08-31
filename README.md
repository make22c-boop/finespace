# 파인스페이스 지출결의 시스템

현장담당자의 지출요청 → 대표 승인 → 경리 지급처리 흐름을 관리하는 독립 웹 애플리케이션입니다.
(기존 Claude Artifact 버전을 대체하는, 완전히 독립된 웹서버입니다.)

## 1. 로컬에서 실행하기 (테스트용)

```bash
npm install
cp .env.example .env
npm run migrate   # DB 테이블 생성
npm start
```

브라우저에서 http://localhost:3000 접속.

## 2. 실제 서비스로 배포하기 (인터넷에 공개)

아래 순서대로 진행하면 됩니다. 모두 무료로 시작할 수 있습니다.
(계정 생성은 본인이 직접 해야 합니다 — 결제/개인정보가 필요한 단계라 제가 대신 만들어 드릴 수 없습니다.)

### 2-1. GitHub에 코드 올리기

1. https://github.com 에서 무료 계정을 만드세요 (이미 있으면 생략).
2. 새 저장소(Repository)를 만드세요. 이름 예: `pinespace-expense`. "Private"으로 설정하는 것을 추천합니다.
3. 이 폴더의 코드를 그 저장소에 올립니다. (터미널 사용법을 모르시면, 이 폴더를 통째로 저에게 다시 요청하시면 git 명령어를 정리해서 안내해 드릴게요.)

### 2-2. Supabase 계정 생성 (데이터베이스 + 사진 저장용, 무료)

1. https://supabase.com 에서 회원가입 → "New Project" 생성.
2. 프로젝트 생성시 DB 비밀번호를 설정합니다 (꼭 기억해두세요).
3. 생성 완료 후 좌측 메뉴 **Project Settings → Database** 에서 **Connection string (URI)** 를 복사합니다.
   - `postgresql://postgres:[YOUR-PASSWORD]@...`  형태입니다. `[YOUR-PASSWORD]` 부분을 아까 설정한 비밀번호로 바꿔주세요.
4. 좌측 메뉴 **Storage** 에서 새 버킷(Bucket)을 만듭니다. 이름: `photos`, **Public bucket**으로 설정 (사진을 인쇄/조회할 때 필요).
5. 좌측 메뉴 **Project Settings → API** 에서 **Project URL** 과 **service_role key**(비밀 키, 절대 외부에 공유 금지)를 복사해둡니다.

### 2-3. Render에 배포하기 (서버 실행, 무료로 시작 가능)

1. https://render.com 에서 회원가입 (GitHub 계정으로 가입하면 연동이 쉽습니다).
2. "New +" → "Web Service" 선택 → 아까 만든 GitHub 저장소 연결.
3. 설정값:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free (우선 무료로 시작, 느리면 나중에 유료로 전환 가능)
4. "Environment" 탭에서 아래 환경변수를 추가합니다:

   | 이름 | 값 |
   |---|---|
   | `DATABASE_URL` | 2-2에서 복사한 Supabase Connection string |
   | `SESSION_SECRET` | 아무 임의의 긴 문자열 (예: 32자리 랜덤 문자열) |
   | `CEO_PASSWORD` | 대표님 로그인 비밀번호 (원하는 값으로 변경 가능) |
   | `ACCOUNTANT_PASSWORD` | 경리 로그인 비밀번호 (원하는 값으로 변경 가능) |
   | `CEO_NAME` | 전동원 |
   | `ACCOUNTANT_NAME` | 김소영 |
   | `SUPABASE_URL` | 2-2에서 복사한 Project URL |
   | `SUPABASE_SERVICE_KEY` | 2-2에서 복사한 service_role key |
   | `NODE_ENV` | production |

5. "Create Web Service" 클릭 → 자동으로 빌드/배포가 시작됩니다 (2~5분 소요).
6. 배포가 끝나면 `https://(임의이름).onrender.com` 형태의 주소가 생깁니다. 이 주소가 앞으로 회사에서 사용할 고정 링크입니다.
7. 처음 한 번만, Render의 "Shell" 탭(또는 로컬에서 `DATABASE_URL`을 Supabase 값으로 바꿔서)에서 아래 명령을 실행해 DB 테이블을 만들어주세요:
   ```
   npm run migrate
   ```

### 2-4. 다 됐습니다

이제 `https://(임의이름).onrender.com` 링크를 현장담당자/대표/경리 모두에게 공유하시면 됩니다.
아이폰/갤럭시 상관없이 브라우저(Safari, Chrome)로 접속하면 바로 사용 가능하고, 이전 Claude Artifact 버전에서 겪었던
읽기 전용 문제나 한글 입력(IME) 문제와 무관하게 정상적으로 실 데이터가 저장됩니다.

## 3. 주의사항 / 참고

- 무료 Render 플랜은 일정 시간 방문자가 없으면 서버가 잠들었다가, 다시 접속시 첫 로딩이 10~30초 정도 걸릴 수 있습니다.
  실사용에 불편하면 Render의 유료 플랜(월 $7 정도)으로 올리면 항상 깨어있는 상태로 유지됩니다.
- 비밀번호(`CEO_PASSWORD`, `ACCOUNTANT_PASSWORD`)는 반드시 기본값(0001, 1000)에서 변경해서 사용하시길 권장합니다.
- 사진은 Supabase Storage에 영구 저장되므로, 서버를 재배포해도 사라지지 않습니다 (환경변수 SUPABASE_URL/SUPABASE_SERVICE_KEY가 설정되어 있는 경우).
- 월별 지출내역은 경리 화면의 "월별 엑셀 내보내기"에서 다운로드할 수 있습니다.
