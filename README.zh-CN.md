# CMS-OS

面向多行业企业、原生支持 AI Agent 的内容操作系统。

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OS 在一个平台中管理企业信息、招聘、公关、IR、博客和服务商门户。AI Agent 可以通过 API 和 MCP 完成主题提案、企划、初稿、润色、翻译、事实核查、SEO 审计、审批和发布。

CMS-OS 目前作为开源项目开发中。

## 主要功能

- AI 主题提案、按角色企划、撰写初稿、润色、翻译、事实核查和 SEO 审计
- 面向 `user`、`orderer`、`provider`、`recruiter` 的角色与行业分类权限控制
- 支持法律服务、专业服务、美容、招聘等分类的服务商门户和外部指南
- 内容审核、审批、发布、撤回和版本历史
- 图片、视频、PDF 等媒体管理，包括 alt 文本、结构化数据、内部链接和 SEO 审计
- 通过 BuilderOS Adapter 生成静态网站，并支持发布到 Cloudflare Pages
- 所有操作均通过 REST API 和 MCP 提供，OpenAPI 作为契约正本
- 支持签名 Webhook、加密 secret、投递 outbox 和指数退避重试
- 支持异步内容创建任务、任务状态查询、外部调度器批量执行和幂等键

## 角色与分类显示

| 角色 | 主要显示与操作 |
|---|---|
| 用户 | 公开内容、分类指南、公开服务商和咨询 |
| 发注者 | 服务商搜索、发注请求、请求状态和发注方信息 |
| 服务商 | 自有信息、职位、咨询、申请者、AI 内容和发布流程 |
| 招聘者 | 职位搜索、申请、申请状态和个人申请历史 |

显示内容和操作权限按分类定义。其他分类或其他服务商的数据不会被暴露。

## 内容工作流

```text
REQUESTED → PROPOSED → DRAFTED → FACT_CHECKED → SEO_REVIEWED
→ EDITED → APPROVED → PUBLISHED
```

AI 生成内容在事实核查、审核和审批后发布。对于 IR 和法律等高准确性内容，系统保留依据和核查历史。

## API / MCP

CMS-OS 通过版本化 REST API 和 MCP 提供操作。认证、内容、媒体、发布、门户、Webhook 和 SEO 审计共用领域服务，并通过测试确保输入、权限和结果的一致性。

- OpenAPI：[`docs/openapi.json`](docs/openapi.json)
- API/MCP 规格：[`docs/API-MCP.md`](docs/API-MCP.md)
- 分类注册表：[`docs/CATEGORY-REGISTRY.md`](docs/CATEGORY-REGISTRY.md)
- 持久化规格：[`docs/STORAGE.md`](docs/STORAGE.md)

## 静态发布

CMS-OS 通过 BuilderOS Adapter 将已审批内容转换为静态 HTML、CSS、JavaScript、媒体和 JSON-LD，并可发布到 Cloudflare Pages。运营型 CMS 功能与低成本静态分发保持分离。

## 开发

要求：Node.js 22 或更高版本

```bash
npm ci
npm test
npm run dev
```

`npm test` 会构建 TypeScript，并测试 API/MCP 一致性、认证、分类权限、内容、媒体、发布、Webhook 和持久化。

开发规则请参阅 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 许可证

许可证将在开源开发方针确定后决定。
