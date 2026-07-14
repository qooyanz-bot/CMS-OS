# CMS-OS

Ein KI-Agenten-natives Content-Betriebssystem für Unternehmen mit mehreren Kategorien.

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OS verwaltet Unternehmensinformationen, Recruiting, PR, IR, Blogs und Anbieterportale auf einer Plattform. KI-Agenten können Themen vorschlagen, nach Positionen planen, Inhalte entwerfen und redigieren, übersetzen, Fakten prüfen, SEO-Audits durchführen, Freigaben anfordern und über API oder MCP veröffentlichen.

CMS-OS wird derzeit als Open-Source-Software entwickelt.

## Hauptfunktionen

- KI-gestützte Themenvorschläge, rollenbezogene Planung, Entwürfe, Überarbeitung, Übersetzung, Faktenprüfung und SEO-Audits
- Rollen- und kategoriebezogene Berechtigungen für `user`, `orderer`, `provider` und `recruiter`
- Anbieterportale und externe Hinweise für Kategorien wie Rechts- und Fachdienstleistungen, Beauty und Recruiting
- Prüfung, Freigabe, Veröffentlichung, Rücknahme und Versionshistorie von Inhalten
- Medienverwaltung für Bilder, Videos und PDFs mit Alt-Text, strukturierten Daten, internen Links und SEO-Audits
- Statische Seitengenerierung über den BuilderOS Adapter und Veröffentlichung auf Cloudflare Pages
- Portal Planning Agent für Suchintentionen, Inhaltsvorschläge und SEO-Seiten nach Thema, Region und Zielgruppe sowie deren Anwendung als Entwürfe
- Alle Vorgänge über REST API und MCP; OpenAPI ist die maßgebliche Vertragsspezifikation
- Signierte Webhooks, verschlüsselte Secrets, Delivery-Outbox und Wiederholungen mit exponentiellem Backoff
- Asynchrone Jobs zur Inhaltserstellung mit Statusabfrage, Ausführung durch externe Scheduler und Idempotenzschlüsseln

## Rollen und kategoriebezogene Ansichten

| Rolle | Wichtigste Sichtbarkeit und Aktionen |
|---|---|
| Benutzer | Öffentliche Inhalte, Kategoriehinweise, öffentliche Anbieter und Anfragen |
| Auftraggeber | Anbietersuche, Aufträge, Auftragsstatus und Auftraggeberinformationen |
| Anbieter | Eigene Einträge, Jobs, Anfragen, Bewerber, KI-Inhalte und Veröffentlichungsworkflow |
| Recruiter | Jobsuche, Bewerbungen, Bewerbungsstatus und eigene Bewerbungshistorie |

Sichtbarkeit und Aktionen werden pro Kategorie definiert. Daten anderer Kategorien oder Anbieter werden nicht offengelegt.

## Content-Workflow

```text
REQUESTED → PROPOSED → DRAFTED → FACT_CHECKED → SEO_REVIEWED
→ EDITED → APPROVED → PUBLISHED
```

KI-Ausgaben durchlaufen Faktenprüfung, Review und Freigabe vor der Veröffentlichung. Für IR- und Rechtsinhalte bleiben Quellen und Prüfverlauf erhalten.

## API / MCP

CMS-OS stellt seine Vorgänge über versionierte REST APIs und MCP bereit. Authentifizierung, Inhalte, Medien, Veröffentlichung, Portale, Webhooks und SEO-Audits verwenden dieselben Domain-Services. Paritätstests prüfen Eingaben, Berechtigungen und Ergebnisse.

- OpenAPI: [`docs/openapi.json`](docs/openapi.json)
- API/MCP-Spezifikation: [`docs/API-MCP.md`](docs/API-MCP.md)
- Kategorien: [`docs/CATEGORY-REGISTRY.md`](docs/CATEGORY-REGISTRY.md)
- Speicherung: [`docs/STORAGE.md`](docs/STORAGE.md)

## Statische Veröffentlichung

CMS-OS wandelt freigegebene Inhalte über den BuilderOS Adapter in statisches HTML, CSS, JavaScript, Medien und JSON-LD um und kann sie auf Cloudflare Pages veröffentlichen.

## Entwicklung

Voraussetzung: Node.js 22 oder neuer

```bash
npm ci
npm test
npm run dev
```

Die Entwicklungsregeln stehen in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Lizenz

Die Lizenz wird nach Festlegung der Open-Source-Entwicklungsrichtlinien bestimmt.
