# EIF TimeFloor Viewer

MES · EIF · PLC 시퀀스 다이어그램 뷰어입니다. **Vercel(Next.js)** 배포용 웹앱은 `web/` 에 있습니다.

## Vercel 배포

1. [Vercel](https://vercel.com)에서 GitHub 저장소 연결
2. **Root Directory** → `web`
3. Framework Preset → **Next.js** (자동 감지)
4. Deploy

로컬 실행:

```bash
cd web
npm install
npm run dev
```

브라우저에서 **찾아보기...** 로 `SFCTYPE` / `PCTYPE` / `PLCTYPE` 폴더(내부에 `SFC`·`SOLACE`·`TRACE`)를 선택한 뒤 LOT ID를 입력합니다.  
로그는 서버로 업로드되지 않고 **브라우저에서만** 파싱됩니다.

## ASP.NET Core (로컬 exe)

기존 .NET 앱은 `EIF_AI/` 에 그대로 있습니다. PC 폴더 경로 브라우징이 필요하면 이쪽을 사용하세요.

```bash
cd EIF_AI
dotnet run --launch-profile http
```
