# CMS-OS

面向 AI 智能体原生场景的企业内容管理平台。

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OS 在一个平台中管理企业信息、招聘、PR、IR 和 Blog。AI 智能体可以协助完成企划、提案、起草、事实核验、润色、SEO 优化和静态发布。

CMS-OS 目前作为开源项目处于早期开发阶段。

## CMS-OS 的目标

CMS-OS 面向能够理解已验证企业信息和品牌规范的 AI 智能体。系统根据内容目的、受众、行业、地区和岗位，提出并生成可供审核和发布的内容。

## 核心能力

- AI 生成主题、内容简报、文章结构、初稿和润色稿
- 按招聘岗位生成内容
- 管理 PR、IR、Blog、企业信息和媒体资源
- 根据已批准的企业数据和来源进行事实核验
- 生成 SEO 标题、描述、内部链接、FAQ 和结构化数据
- 版本历史、审批、审计日志和定时发布
- 生成静态 HTML 并发布到 Cloudflare Pages

AI 智能体用于辅助编辑团队。IR、法律信息、薪酬和高管信息等敏感内容必须经过人工审核，不能绕过审批自动发布。

## API/MCP 优先

CMS-OS 的所有操作都必须能够通过版本化 API 或 MCP 执行。任何业务操作都不能只存在于管理后台界面中。

| 操作领域 | API 和 MCP 覆盖范围 |
|---|---|
| 内容 | 创建、读取、更新、删除、搜索、版本管理、翻译、归档 |
| AI 编辑 | 提案、起草、润色、事实核验、摘要、翻译、SEO 审计 |
| 工作流 | 审核、批准、驳回、定时发布、取消发布 |
| 媒体 | 注册、获取、转换和版权元数据管理 |
| SEO | 元数据、canonical、结构化数据、sitemap、robots、链接审计 |
| 发布 | 构建、预览、发布、状态查询、回滚 |
| 运维 | 任务、重试、Webhook、权限、租户设置、审计日志 |

API 以版本化 REST/JSON 和 OpenAPI 为基础。MCP 工具调用与 API 相同的领域服务，不重复实现业务逻辑。管理后台、AI 智能体、CLI 和 BuilderOS Adapter 都作为 API/MCP 客户端使用。

## Cloudflare Pages 静态发布

CMS-OS 根据已批准内容生成静态 HTML、CSS、JavaScript、图片和 JSON-LD，并通过 BuilderOS Adapter 发布到 Cloudflare Pages。

```text
CMS-OS
  ↓ 已批准内容
静态网站构建
  ↓
BuilderOS Adapter
  ↓
Cloudflare Pages
```

CMS API、管理后台和 AI 处理与公开静态网站分离，以实现快速访问、强 SEO、高可用性和低运营成本。

## 开源方向

CMS-OS 致力于成为用于创建、审批、发布和复用企业内容的协作式开源基础设施。

项目重视已验证事实、可追踪的 AI 输出、人工审批、审计能力、SEO、可访问性、静态交付和不依赖单一厂商的扩展性。

## 开发状态

计划按以下顺序实现：

1. API/MCP 契约和内容模型
2. Blog、招聘和 PR 内容
3. Tiptap 编辑器
4. AI 企划、起草和润色智能体
5. SEO 审计和结构化数据生成
6. 审批工作流
7. 静态 HTML 生成
8. 通过 BuilderOS Adapter 发布到 Cloudflare Pages
9. IR 工作流和外部发布

## 翻译规则

`README.md` 是日文正本。每次更新README时，必须在同一变更中同步更新英文、简体中文、西班牙语、韩语、德语和法语版本。请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

许可证将在初期开发方针确定后选定。

