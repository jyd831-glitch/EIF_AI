# EIF TimeFloor Viewer

MES · EIF · PLC 시퀀스 다이어그램 뷰어입니다. **Next.js** 앱은 `web/` 에 있습니다.

## 하이브리드 파일 접근

| 실행 환경 | 모드 | 찾아보기 동작 |
|-----------|------|----------------|
| **로컬** (`npm run dev` / `npm start` on PC) | LOCAL | PC 디스크를 **서버가 직접 읽기** (업로드 다이얼로그 아님) |
| **Vercel** | CLOUD | 브라우저 폴더 선택 (`showDirectoryPicker`) |

상단 배지로 현재 모드를 확인할 수 있습니다.

### 로컬 실행 (디스크 직접 읽기)

```bash
cd web
npm install
npm run dev
```

브라우저에서 http://localhost:3000 → **찾아보기...** → 탐색기에서 `LOG/PLCTYPE` 등 선택 → **열기**

기본 시작 경로: `../LOG` (저장소의 `LOG` 폴더). 바꾸려면 `web/.env.local`:

```
LOG_ROOT=C:\Users\...\Desktop\EIF_AI\LOG
```

로컬 FS를 끄려면:

```
LOCAL_FS_ENABLED=0
```

### Vercel (클라우드)

1. [Vercel](https://vercel.com)에서 GitHub 저장소 연결  
2. **Root Directory** → `web`  
3. Deploy → https://eif-ai-mu.vercel.app  

클라우드에서는 사용자 PC 디스크에 직접 접근할 수 없습니다. **찾아보기**는 브라우저 폴더 선택을 사용합니다.  
(보안 프로그램이 막으면 **로컬 실행**을 사용하세요.)

로그 원문은 Vercel 서버에 저장되지 않고, 선택한 뒤 브라우저에서 파싱합니다.

## ASP.NET Core (로컬 exe)

기존 .NET 앱은 `EIF_AI/` 에 있습니다.

```bash
cd EIF_AI
dotnet run --launch-profile http
```
