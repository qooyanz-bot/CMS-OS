# CMS-OS

AI 에이전트 네이티브 멀티 카테고리 콘텐츠 운영체제입니다.

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OS는 기업 정보, 채용, PR, IR, 블로그, 사업자 포털을 하나의 플랫폼에서 관리합니다. AI 에이전트는 API와 MCP를 통해 주제 제안, 포지션별 기획, 초안 작성, 교정, 번역, 사실 확인, SEO 감사, 승인 요청과 공개를 수행할 수 있습니다.

CMS-OS는 현재 오픈 소스로 개발 중입니다.

## 주요 기능

- AI 기반 주제 제안, 역할별 기획, 초안, 교정, 번역, 사실 확인, SEO 감사
- `user`, `orderer`, `provider`, `recruiter` 역할과 카테고리별 권한
- 법률·전문 서비스, 미용, 채용 등 카테고리별 사업자 포털과 외부 안내
- 콘텐츠 검토, 승인, 공개, 비공개, 버전 이력
- 이미지·동영상·PDF 관리, alt 텍스트·구조화 데이터·내부 링크·SEO 감사
- BuilderOS Adapter를 통한 정적 사이트 생성 및 Cloudflare Pages 공개
- Portal Planning Agent를 통한 주제·지역·대상 포지션별 검색 의도 분석, 기존 콘텐츠 커버리지 부족 탐지, SEO 페이지 생성 및 콘텐츠 초안 적용
- 모든 작업을 REST API와 MCP로 제공하고 OpenAPI를 계약의 기준으로 사용
- 서명된 Webhook, 암호화된 secret, 전달 outbox, 지수 백오프 재시도
- 비동기 콘텐츠 생성 작업, 작업 상태 조회, 외부 스케줄러 실행, 멱등성 키

## 역할과 카테고리별 화면

| 역할 | 주요 표시와 작업 |
|---|---|
| 사용자 | 공개 콘텐츠, 카테고리 안내, 공개 사업자, 문의 |
| 발주자 | 사업자 검색, 발주 요청, 요청 상태, 발주자 정보 |
| 사업자 | 자신의 정보, 채용, 문의, 지원자, AI 콘텐츠, 공개 워크플로 |
| 리크루터 | 채용 검색, 지원, 지원 상태, 개인 지원 이력 |

표시 대상과 권한은 카테고리별로 정의되며 다른 카테고리나 사업자의 정보는 노출되지 않습니다.

## 콘텐츠 워크플로

```text
REQUESTED → PROPOSED → DRAFTED → FACT_CHECKED → SEO_REVIEWED
→ EDITED → APPROVED → PUBLISHED
```

AI 결과는 사실 확인, 검토, 승인을 거친 뒤 공개합니다. IR과 법률 등 정확성이 중요한 정보는 근거와 확인 이력을 보존합니다.

## API / MCP

CMS-OS의 작업은 버전이 지정된 REST API와 MCP로 실행할 수 있습니다. 인증, 콘텐츠, 미디어, 공개, 포털, Webhook, SEO 감사를 동일한 도메인 서비스로 처리하며 입력·권한·결과의 일관성을 테스트합니다.

- OpenAPI: [`docs/openapi.json`](docs/openapi.json)
- API/MCP 사양: [`docs/API-MCP.md`](docs/API-MCP.md)
- 카테고리 레지스트리: [`docs/CATEGORY-REGISTRY.md`](docs/CATEGORY-REGISTRY.md)
- 저장소 사양: [`docs/STORAGE.md`](docs/STORAGE.md)

## 정적 공개

CMS-OS는 BuilderOS Adapter를 통해 승인된 콘텐츠를 정적 HTML, CSS, JavaScript, 미디어, JSON-LD로 변환하고 Cloudflare Pages에 공개할 수 있습니다.

## 개발

요구 사항: Node.js 22 이상

```bash
npm ci
npm test
npm run dev
```

개발 규칙은 [`CONTRIBUTING.md`](CONTRIBUTING.md)를 참조하세요.

## 라이선스

라이선스는 오픈 소스 개발 정책을 확정한 뒤 결정합니다.
