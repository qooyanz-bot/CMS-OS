# CMS-OS

Eine unternehmensweite Content-Plattform für KI-Agenten.

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OS verwaltet Unternehmensinformationen, Recruiting, PR, IR und Blogs in einer Plattform. KI-Agenten unterstützen Planung, Vorschläge, Entwürfe, Faktenprüfung, redaktionelle Überarbeitung, SEO-Optimierung und statische Veröffentlichung.

CMS-OS ist ein Open-Source-Projekt in einer frühen Entwicklungsphase.

## Ziel von CMS-OS

CMS-OS ist für KI-Agenten ausgelegt, die verifizierte Unternehmensinformationen und Markenrichtlinien verstehen. Abhängig von Ziel, Zielgruppe, Branche, Region und Position schlagen die Agenten Inhalte vor und erstellen Entwürfe zur Prüfung und Veröffentlichung.

## Zentrale Funktionen

- KI-generierte Themen, Briefings, Gliederungen, Entwürfe und Endfassungen
- Positionsbezogene Inhalte für Recruiting
- Verwaltung von PR, IR, Blog, Unternehmensinformationen und Medienressourcen
- Faktenprüfung anhand freigegebener Unternehmensdaten und Quellen
- SEO-Titel, Beschreibungen, interne Links, FAQs und strukturierte Daten
- Versionshistorie, Freigaben, Audit-Logs und geplante Veröffentlichungen
- Generierung statischer HTML-Seiten und Veröffentlichung über Cloudflare Pages

KI-Agenten unterstützen das Redaktionsteam. Für sensible Inhalte wie IR, rechtliche Informationen, Vergütung oder Managementdaten bleibt eine menschliche Freigabe erforderlich.

## Portale nach Branchenthemen

CMS-OS führt Besucher nach Branchenthemen zu Anbietern und schaltet sichtbare Daten und Aktionen je nach Rolle um: Nutzer, Auftraggeber, Anbieter oder Recruiter. Aktuell werden Rechts- und Anwaltsdienstleistungen, Beauty, generative KI und Geschäftstransformation, Arbeitskräftemangel und Automatisierung, regionaler Tourismus und Incoming-Tourismus, Mobility DX und SDV, GX sowie Energie- und Ressourcenmanagement und regionale Belebung, Umzug und die Wiederverwendung leerstehender Häuser unterstützt.

- Nutzer: öffentliche Anbieter, Themenleitfäden und FAQs ansehen
- Auftraggeber: Anbieter vergleichen, Anfragen erstellen, Angebote besprechen und die Anfragehistorie prüfen
- Anbieter: Einträge, Stellen, Anfragen, KI-Inhalte, SEO und Veröffentlichungs-Workflows verwalten
- Recruiter: Stellen und Anbieter ansehen, Bewerbungen einreichen und ihren Status verfolgen

Die Kategorien und das Erweiterungsverfahren werden im [Kategorie-Register](docs/CATEGORY-REGISTRY.md) gepflegt.

## API/MCP-first

Jede CMS-OS-Operation muss über eine versionierte API oder MCP ausführbar sein. Es darf keine Geschäftsoperation geben, die nur in der Administrationsoberfläche verfügbar ist.

| Bereich | Abdeckung durch API und MCP |
|---|---|
| Inhalte | Erstellen, Abrufen, Ändern, Löschen, Suchen, Versionieren, Übersetzen, Archivieren |
| KI-Redaktion | Vorschlagen, Entwerfen, Überarbeiten, Fakten prüfen, Zusammenfassen, Übersetzen, SEO prüfen |
| Workflow | Prüfen, Freigeben, Ablehnen, Planen, Veröffentlichung zurücknehmen |
| Medien | Registrieren, Abrufen, Umwandeln und Rechte-Metadaten verwalten |
| SEO | Metadaten, Canonical, strukturierte Daten, Sitemap, Robots und Linkprüfung |
| Veröffentlichung | Bauen, Vorschau, Veröffentlichen, Status prüfen, Rollback |
| Betrieb | Jobs, Wiederholungen, Webhooks, Berechtigungen, Mandanteneinstellungen und Audit-Logs |

Die API basiert auf versioniertem REST/JSON und OpenAPI. MCP-Tools verwenden dieselben Domain-Services wie die API und duplizieren keine Geschäftslogik. Administrationsoberfläche, KI-Agenten, CLI und BuilderOS Adapter sind API/MCP-Clients.

## Statische Veröffentlichung über Cloudflare Pages

CMS-OS erzeugt aus freigegebenen Inhalten statisches HTML, CSS, JavaScript, Bilder und JSON-LD und veröffentlicht diese über den BuilderOS Adapter auf Cloudflare Pages.

Die CMS-API, die Administration und die KI-Verarbeitung bleiben vom öffentlichen statischen Webauftritt getrennt. Damit werden schnelle Auslieferung, SEO, Verfügbarkeit und niedrige Betriebskosten priorisiert.

## Open-Source-Ausrichtung

CMS-OS soll eine kollaborative Open-Source-Grundlage für die Erstellung, Freigabe, Veröffentlichung und Wiederverwendung von Unternehmensinhalten werden.

Das Projekt legt Wert auf verifizierte Fakten, nachvollziehbare KI-Ausgaben, menschliche Freigaben, Auditierbarkeit, SEO, Barrierefreiheit, statische Auslieferung und eine anbieterunabhängige Erweiterbarkeit.

## Entwicklungsstatus

Die geplante Reihenfolge ist:

1. API/MCP-Verträge und Inhaltsmodelle
2. Blog-, Recruiting- und PR-Inhalte
3. Tiptap-Editor
4. KI-Agenten für Planung, Entwürfe und redaktionelle Überarbeitung
5. SEO-Prüfungen und Generierung strukturierter Daten
6. Freigabe-Workflows
7. Generierung statischer HTML-Seiten
8. Cloudflare-Pages-Veröffentlichung über BuilderOS Adapter
9. IR-Workflows und externe Verteilung

## Übersetzungsrichtlinie

`README.md` ist das japanische Quelldokument. Jede README-Änderung muss gleichzeitig in Englisch, vereinfachtem Chinesisch, Spanisch, Koreanisch, Deutsch und Französisch aktualisiert werden. Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Lizenz

Die Lizenz wird festgelegt, sobald die anfängliche Entwicklungsrichtlinie beschlossen ist.
