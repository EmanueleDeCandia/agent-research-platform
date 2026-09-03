# Research Radar — Product Requirements Document (PRD)

**Versione:** 1.0 — baseline coerente per sviluppo Codex  
**Stato:** Source of Truth del prodotto  
**Ambito:** Research Agent per Issue Understanding, European Policy Intelligence e Innovation Intelligence

---

## 1. Product Vision

**Research Radar** è un'applicazione di intelligence agentica per una grande impresa che vuole comprendere l'evoluzione di problemi economici, tecnologici, industriali, regolatori o sociali e verificare:

1. se una **Issue sostanziale** sta acquisendo rilevanza nel dibattito e nel linguaggio istituzionale;
2. se la Issue sta entrando o avanzando nel **processo europeo di policy**;
3. se esistono **programmi, progetti di ricerca o innovazione** che affrontano realmente lo stesso problema;
4. quali attori, concetti, interventi e relazioni emergono dalle evidenze raccolte.

L'applicazione non è un motore di ricerca generalista e non è una demo di Function Calling.

Il valore del prodotto consiste nel trasformare una domanda formulata in linguaggio naturale in un processo di ricerca **strutturato, verificabile, progressivo e persistibile**, capace di distinguere tra:

- comprensione del problema;
- scoperta del linguaggio con cui il problema viene descritto;
- recupero di candidati da fonti esterne;
- verifica della loro effettiva pertinenza;
- trasformazione dei candidati pertinenti in Evidence;
- sintesi e rappresentazione delle relazioni rilevate.

---

## 2. Problema da risolvere

Le informazioni rilevanti per comprendere una Issue europea sono distribuite tra fonti eterogenee:

- Web pubblico;
- documentazione istituzionale europea;
- basi dati legislative;
- programmi e progetti di ricerca e innovazione;
- dataset e servizi strutturati.

Il problema non è soltanto trovare documenti.

Il problema principale è stabilire **quali documenti parlino realmente dello stesso problema**.

Una ricerca basata su una keyword generica, per esempio `AI`, non distingue tra:

- sovranità tecnologica;
- copyright;
- discriminazione algoritmica;
- medical AI;
- sicurezza dei modelli;
- occupazione;
- concorrenza;
- infrastrutture di calcolo.

Research Radar deve quindi evitare il pattern:

```text
TOPIC
  ↓
KEYWORD SEARCH
  ↓
MANY RESULTS
  ↓
LLM SUMMARY
```

e implementare invece:

```text
SUBSTANTIVE PROBLEM
        ↓
ISSUE UNDERSTANDING
        ↓
SEMANTIC DISCOVERY
        ↓
COMMITTED ISSUE PROFILE
        ↓
AUTHORITATIVE RETRIEVAL
        ↓
CANDIDATES
        ↓
SEMANTIC VALIDATION
        ↓
EVIDENCE
        ↓
SYNTHESIS
```

---

## 3. Utenti target

### Utenti primari

- Corporate Strategy;
- Innovation;
- Public Affairs;
- Institutional Affairs;
- Regulatory Affairs;
- Research & Intelligence.

### Job to Be Done

> Comprendere se un problema specifico sta acquisendo rilevanza europea, con quali definizioni e attori, quali iniziative di policy lo intercettano e quali progetti di innovazione stanno cercando di affrontarlo.

---

## 4. Principi di prodotto non negoziabili

### P-01 — Una tecnologia o un settore non sono una Issue

`AI`, `energia`, `mobilità`, `healthcare` o `cloud` sono domini.

Una Issue deve descrivere almeno:

- il problema;
- i meccanismi che lo producono;
- gli attori interessati;
- gli impatti materiali;
- le possibili risposte;
- ciò che deve essere escluso dal perimetro.

### P-02 — L'Issue Profile precede il retrieval autorevole

Nessuna ricerca specialistica su policy o progetti di innovazione può essere eseguita prima che l'applicazione abbia accettato un `IssueProfile`.

### P-03 — Web Search e fonti strutturate hanno ruoli diversi

**Web Search** è principalmente un **Discovery Layer**.

Serve a scoprire:

- terminologia effettivamente utilizzata;
- framing alternativi;
- concetti tecnici;
- linguaggio istituzionale;
- attori;
- programmi;
- termini adiacenti da escludere.

Le fonti autorevoli e strutturate servono invece principalmente a:

- verificare;
- recuperare candidati;
- classificare;
- arricchire metadati;
- stabilire relazioni;
- rendere la ricerca ripetibile e monitorabile.

### P-04 — Candidate non significa Evidence

Un risultato restituito da CORDIS, EUR-Lex, CELLAR o da un'altra fonte è inizialmente un `Candidate`.

Diventa `Evidence` soltanto dopo una verifica semantica rispetto all'Issue Profile.

### P-05 — Recall prima, precision dopo

Il candidate retrieval deve privilegiare il **recall**.

La semantic validation deve privilegiare la **precision**.

Non si deve tentare di ottenere entrambe direttamente attraverso una singola query.

### P-06 — Function Calling orchestra il processo

La Function Call non è il meccanismo che comprende la Issue.

Le Function rappresentano **azioni semantiche dell'applicazione**.

Gli adapter traducono queste azioni nelle query specifiche delle fonti.

### P-07 — Le regole critiche devono essere enforceable nel codice

Il prompt orienta il comportamento dell'Agent.

Le regole critiche di stato e accesso ai Tool devono essere imposte dall'orchestratore applicativo.

---

# 5. Ambito informativo

Research Radar deve integrare progressivamente tre livelli informativi.

## 5.1 Discovery Intelligence

### Fonte core

**OpenAI built-in `web_search`** tramite Responses API.

### Finalità

- comprendere il linguaggio della Issue;
- scoprire alternative semantiche;
- individuare termini istituzionali e tecnici;
- identificare attori, programmi e iniziative;
- generare Search Hypotheses;
- supportare la costruzione dell'Issue Profile.

### Nota su GDELT

**GDELT non è una fonte core del prodotto e non appartiene alle prime tre milestone.**

Potrà essere valutato in una fase successiva come **Media Intelligence Adapter** quando serviranno analisi quantitative o temporali specifiche sulla copertura informativa.

GDELT non deve duplicare il ruolo di `web_search` nella semantic discovery.

---

## 5.2 Innovation Intelligence

### Fonte autorevole iniziale

**CORDIS**.

### Finalità

Individuare progetti di ricerca e innovazione finanziati dall'UE che affrontano sostanzialmente la Issue.

La ricerca deve sfruttare:

- contenuto testuale;
- objective/summary;
- topic e programme;
- metadati;
- organizzazioni;
- paesi;
- finanziamenti;
- relazioni strutturate disponibili.

Il Knowledge Graph e le relazioni strutturate servono soprattutto **dopo** aver individuato progetti pertinenti.

Pattern:

```text
ISSUE PROFILE
     ↓
CORDIS CANDIDATE RETRIEVAL
     ↓
PROJECT CONTENT
     ↓
SEMANTIC VALIDATION
     ↓
RELEVANT PROJECT EVIDENCE
     ↓
STRUCTURED ENRICHMENT
```

---

## 5.3 European Policy Intelligence

### Fonti autorevoli previste

Adapter separati potranno utilizzare, in base alla ricerca:

- EUR-Lex;
- CELLAR;
- Commission Work Programme;
- ulteriori fonti istituzionali europee compatibili con il modello.

L'Agent non deve conoscere endpoint, SPARQL, SOAP o strutture specifiche.

Il Tool applicativo deve esprimere l'intento:

```text
search_policy_documents()
```

Gli adapter decidono come interrogare le fonti pertinenti.

### Finalità

Individuare evidenze che mostrino se la Issue:

1. è semplicemente menzionata;
2. è discussa sostanzialmente;
3. è riconosciuta come problema;
4. è oggetto di consultazione;
5. genera una proposta di intervento;
6. entra in un processo istituzionale o legislativo;
7. produce un atto, programma o risposta formalizzata;
8. entra in valutazione/revisione.

---

# 6. Core Domain Model

## 6.1 Issue Profile

L'`IssueProfile` è il contratto semantico centrale del prodotto.

Campi minimi:

```ts
interface IssueProfile {
  id: string;

  title: string;

  problemStatement: string;
  issueDescription: string;

  mechanisms: string[];
  affectedActors: string[];
  impacts: string[];
  potentialPolicyResponses: string[];

  canonicalTerms: string[];
  institutionalTerms: string[];
  technicalTerms: string[];

  exclusions: string[];
  searchHypotheses: string[];

  geographicScope?: string[];

  temporalScope?: {
    from?: string;
    to?: string;
  };

  createdAt: string;
  updatedAt: string;
}
```

### Regola di validità

Un Issue Profile non è valido soltanto perché tutti i campi sono valorizzati.

Deve preservare il **che cosa tratta realmente**.

Esempio non valido:

```text
title: AI
problemStatement: AI
mechanisms: AI
```

---

## 6.2 Candidate

Ogni risultato proveniente da una fonte autorevole deve essere inizialmente normalizzato come `Candidate`.

```ts
interface Candidate {
  id: string;

  sourceProvider: string;
  sourceId?: string;
  sourceUrl?: string;

  title: string;
  summary?: string;
  content?: string;

  publishedAt?: string;

  metadata: Record<string, unknown>;

  retrievedAt: string;
}
```

---

## 6.3 Evidence

Un Candidate diventa Evidence soltanto dopo la semantic validation.

```ts
interface Evidence {
  id: string;
  issueId: string;
  candidateId: string;

  evidenceType:
    | "media"
    | "institutional"
    | "legislative"
    | "consultation"
    | "research"
    | "innovation";

  title: string;
  summary?: string;

  sourceProvider: string;
  sourceId?: string;
  sourceUrl?: string;

  relevanceExplanation: string;

  matchedProblemElements: string[];
  matchedMechanisms: string[];
  matchedImpacts: string[];
  matchedInterventions: string[];

  createdAt: string;
}
```

---

# 7. Research State Machine

Il workflow applicativo deve essere governato da stato.

```text
USER PROBLEM
    │
    ▼
ISSUE_DISCOVERY
    │
    │ web_search quando necessario
    ▼
ISSUE_PROFILE_READY
    │
    │ commit_issue_profile()
    ▼
ISSUE_COMMITTED
    │
    ▼
AUTHORITATIVE_RETRIEVAL
    │
    ▼
CANDIDATE_VALIDATION
    │
    ▼
EVIDENCE
    │
    ▼
SYNTHESIS
```

Stati applicativi minimi:

```ts
type ResearchPhase =
  | "issue_discovery"
  | "issue_committed"
  | "authoritative_retrieval"
  | "candidate_validation"
  | "synthesis";
```

---

# 8. Tool Gating

I Tool esposti al modello devono dipendere dalla fase.

## Phase: `issue_discovery`

Disponibili:

- `web_search`;
- `commit_issue_profile`.

Non disponibili:

- `search_innovation_projects`;
- `search_policy_documents`;
- qualunque adapter autorevole.

## Phase: `issue_committed` / `authoritative_retrieval`

Potranno essere disponibili:

- `search_innovation_projects`;
- `search_policy_documents`;
- `web_search` quando utile per completare terminologia o contesto.

La disponibilità non deve dipendere soltanto dalle istruzioni del prompt.

Deve essere controllata nel codice.

---

# 9. Requisiti Funzionali

## RF-01 — Inserimento della Issue

L'utente deve poter inserire una descrizione in linguaggio naturale.

L'applicazione deve accettare sia:

- descrizioni sostanziali;
- input incompleti o generici.

Non deve presumere che un input generico identifichi automaticamente una Issue.

---

## RF-02 — Valutazione della sufficienza semantica

L'Agent deve valutare se l'input contiene informazioni sufficienti per distinguere il problema da Issue adiacenti.

Se insufficiente, deve restare in `issue_discovery`.

Non deve inventare implicitamente il problema dell'utente.

---

## RF-03 — Semantic Discovery via Web Search

Quando necessario, l'Agent deve usare `web_search` per scoprire:

- canonical terms;
- institutional terms;
- technical terms;
- alternative framings;
- actors;
- programmes;
- potential responses;
- exclusions.

Le ricerche devono essere guidate dalla descrizione del problema, non da una sola keyword.

---

## RF-04 — Search Hypotheses

L'Agent deve formulare Search Hypotheses che rappresentino modi sostanzialmente differenti in cui lo stesso problema potrebbe essere espresso.

Esempio:

```text
European technological dependence
strategic autonomy
non-EU compute dependency
sovereign AI infrastructure
European cloud-edge capacity
```

Le ipotesi devono mantenere il legame con il problem statement.

---

## RF-05 — Commit dell'Issue Profile

L'Agent deve chiamare:

```text
commit_issue_profile()
```

quando ritiene sufficientemente compresa la Issue.

Il backend deve:

1. validare lo schema;
2. applicare controlli minimi deterministici;
3. generare ID e timestamp;
4. accettare o rifiutare il commit;
5. controllare la transizione di stato.

Il modello non può auto-dichiarare la transizione.

---

## RF-06 — Persistenza del Research State

Ogni ricerca deve mantenere almeno:

- user question;
- current phase;
- Issue Profile;
- agent activity;
- fonti usate per la discovery;
- timestamp.

Nella prima milestone la persistenza può essere limitata alla sessione corrente.

---

## RF-07 — Agent Activity

L'applicazione deve rendere visibili le attività principali dell'Agent:

- web searches;
- tool calls;
- tool results sintetici;
- state transitions.

Non devono essere mostrati o salvati segreti.

---

## RF-08 — Innovation Candidate Retrieval

Dopo `ISSUE_COMMITTED`, l'Agent potrà chiamare:

```text
search_innovation_projects()
```

Il Tool deve ricevere un intento semantico costruito dal committed Issue Profile, non una keyword generica.

L'adapter CORDIS deve trasformare l'intento in query compatibili con la fonte.

Output:

```text
Candidate[]
```

non direttamente Evidence.

---

## RF-09 — Innovation Semantic Validation

Per ogni Candidate CORDIS, il sistema deve recuperare il contenuto sufficiente per confrontarlo con la Issue.

La validazione deve verificare almeno:

- problem fit;
- mechanism fit;
- actor fit;
- impact fit;
- intervention fit;
- exclusions.

Un progetto che usa la stessa tecnologia ma affronta un problema diverso deve essere scartato.

---

## RF-10 — Policy Candidate Retrieval

Dopo `ISSUE_COMMITTED`, l'Agent potrà chiamare:

```text
search_policy_documents()
```

Il Tool rappresenta l'intento applicativo.

Uno o più adapter possono interrogare fonti istituzionali differenti.

Output:

```text
Candidate[]
```

---

## RF-11 — Policy Semantic Validation

Ogni documento candidato deve essere classificato rispetto alla Issue.

Il sistema deve distinguere almeno:

1. incidental mention;
2. thematic association;
3. substantive discussion;
4. explicit problem recognition;
5. proposed intervention;
6. formal policy or funded response.

---

## RF-12 — Policy Stage Classification

Quando le evidenze lo consentono, l'applicazione deve attribuire uno stadio normalizzato.

```ts
type PolicyStage =
  | "signal"
  | "consultation"
  | "planned_initiative"
  | "proposal"
  | "legislative_process"
  | "adopted"
  | "evaluation";
```

La classificazione applicativa deve essere distinta dai metadati originali della fonte.

---

## RF-13 — Provenance

Ogni Evidence deve conservare:

- source provider;
- source identifier quando disponibile;
- source URL quando disponibile;
- retrieval timestamp;
- spiegazione della rilevanza.

L'Agent deve distinguere tra:

- source fact;
- application classification;
- model inference;
- hypothesis.

---

## RF-14 — Deduplicazione

L'applicazione deve evitare duplicazioni dello stesso documento o progetto quando proveniente da più canali o endpoint.

Quando disponibili devono essere preferiti identificatori canonici della fonte rispetto all'URL.

---

## RF-15 — Synthesis

La sintesi finale deve essere costruita soltanto su Evidence validate.

Deve includere:

- Executive Synthesis;
- Issue Definition;
- Evidence found;
- Policy Signals;
- Innovation Signals;
- Actors;
- Information Gaps;
- Sources/Provenance.

---

# 10. Regole di Semantic Relevance

Una corrispondenza terminologica non costituisce evidenza.

Il sistema deve distinguere:

```text
same keyword
≠
same technology
≠
same sector
≠
same Issue
```

Il Semantic Validator deve valutare la relazione tra il Candidate e la struttura causale della Issue.

Dimensioni minime:

```text
problem
mechanism
affected actor
impact
intervention
exclusion
```

Non è richiesto nel MVP un singolo score numerico opaco.

La spiegabilità della decisione è prioritaria.

---

# 11. Retrieval Strategy

## Stage A — Discovery

Obiettivo:

```text
capire come cercare
```

Strumento:

```text
web_search
```

Output:

- Issue vocabulary;
- alternative formulations;
- search hypotheses;
- exclusions.

## Stage B — Authoritative Candidate Retrieval

Obiettivo:

```text
trovare record potenzialmente pertinenti
```

Strumenti:

- CORDIS adapter;
- EU Policy adapters.

Output:

```text
Candidate[]
```

## Stage C — Semantic Validation

Obiettivo:

```text
stabilire cosa tratta davvero la stessa Issue
```

Output:

```text
Evidence[]
```

## Stage D — Structured Enrichment

Obiettivo:

```text
arricchire le Evidence già validate
```

Esempi:

- organizzazioni;
- programmi;
- paesi;
- finanziamenti;
- atti collegati;
- relazioni documentali.

---

# 12. Function Calling Architecture

Le Function esposte all'Agent devono rappresentare azioni semantiche.

Core:

```text
commit_issue_profile()
search_innovation_projects()
search_policy_documents()
```

`web_search` è un built-in tool della Responses API.

Non devono essere esposti direttamente all'Agent:

```text
cordis_sparql()
cellar_sparql()
eurlex_soap()
gdelt_doc()
```

a meno che una futura revisione architetturale dimostri un vantaggio specifico.

Pattern:

```text
LLM / Research Agent
        │
        ▼
Semantic Function
        │
        ▼
Source Adapter
        │
        ▼
Source-specific Query
        │
        ▼
Normalized Candidate
```

---

# 13. Source Adapter Architecture

Ogni fonte esterna deve essere implementata in un adapter separato.

Responsabilità dell'adapter:

- autenticazione;
- request building;
- HTTP/SPARQL/SOAP;
- parsing;
- error handling;
- timeout;
- normalization;
- source provenance.

L'UI e il domain model non devono contenere logiche specifiche della fonte.

---

# 14. UI minima

## Input

Campo principale:

```text
Describe the substantive issue you want to investigate
```

Azione:

```text
RUN RESEARCH
```

## Agent Activity

Visualizzare:

- phase;
- web search;
- function call;
- state transition;
- numero di candidate/evidence quando rilevante.

## Issue Profile

Visualizzare:

- title;
- problem statement;
- issue description;
- mechanisms;
- affected actors;
- impacts;
- potential policy responses;
- canonical terms;
- institutional terms;
- technical terms;
- exclusions;
- search hypotheses.

## Evidence Workspace — milestone successive

Visualizzare:

- Candidate/Evidence status;
- source;
- relevance explanation;
- matched issue dimensions;
- policy stage quando applicabile;
- innovation project metadata quando applicabile.

---

# 15. Output analitico finale

Quando le milestone di retrieval saranno implementate, Research Radar dovrà produrre:

### 1. Executive Synthesis

Sintesi del quadro emerso.

### 2. Issue Profile

Definizione sostanziale utilizzata per tutta la ricerca.

### 3. Policy Evidence

Documenti e iniziative validate.

### 4. Policy Maturity

Stadio di avanzamento, quando inferibile con sufficiente evidenza.

### 5. Innovation Evidence

Progetti pertinenti e relazione con la Issue.

### 6. Actors

Istituzioni, imprese, centri di ricerca e altri soggetti rilevanti.

### 7. Relationships

Collegamenti tra Issue, Evidence, Actor, Programme e Project.

### 8. Information Gaps

Informazioni mancanti o non verificabili.

### 9. Provenance

Fonti utilizzate.

---

# 16. Visual Intelligence

Le visualizzazioni devono essere generate a partire da dati normalizzati, non da dati sorgente specifici.

Possibili viste:

- Issue Profile map;
- timeline delle Evidence;
- Policy Stage timeline;
- actors;
- innovation project network;
- programma → progetto → organizzazione;
- Issue → Evidence → Actor relationships.

Le visualizzazioni non sono requisito della Milestone 1 oltre alla presentazione strutturata dell'Issue Profile e dell'Agent Activity.

---

# 17. Requisiti Tecnici

- TypeScript;
- OpenAI Responses API;
- `web_search` built-in per discovery;
- custom Function con strict schema;
- server-side external calls;
- environment variables;
- nessuna chiave esposta al browser;
- runtime schema validation;
- error handling;
- timeout;
- maximum tool/research iteration budget;
- structured activity logging;
- provenance;
- unit tests;
- integration tests;
- adapter separation.

---

# 18. Runtime Agent Instructions

Le istruzioni canoniche del Research Agent devono vivere in:

```text
prompts/research-agent.md
```

Il codice non deve mantenere una seconda copia divergente.

Il runtime prompt definisce:

- finalità;
- regole di Issue Understanding;
- discovery strategy;
- semantic validation;
- evidence rules;
- synthesis principles.

Le regole critiche di accesso ai Tool restano enforceable nel codice.

---

# 19. Relationship con i file del repository

## `PRD.md`

Source of Truth dei requisiti di prodotto.

## `AGENTS.md`

Istruzioni per Codex su come operare nel repository e quali invarianti preservare.

## `docs/ARCHITECTURE.md`

Definizione tecnica minima della state machine e delle responsabilità runtime.

## `docs/DATA_MODEL.md`

Contratti minimi delle entità applicative.

## `prompts/research-agent.md`

Istruzioni runtime del Research Agent.

## `.agents/skills/research-radar-development/SKILL.md`

Workflow di implementazione per Codex.

## `tasks/`

Milestone eseguibili e acceptance criteria.

In caso di divergenza sostanziale sui requisiti di prodotto, `PRD.md` prevale e la divergenza deve essere segnalata prima di modificare silenziosamente il comportamento.

---

# 20. Milestone di sviluppo

## Milestone 1 — Issue Understanding

### Obiettivo

```text
user substantive problem
→ web discovery
→ structured Issue Profile
→ commit_issue_profile
→ visible committed profile
```

### Tool

- `web_search`;
- `commit_issue_profile`.

### Fuori scope

- CORDIS;
- EUR-Lex;
- CELLAR;
- GDELT;
- knowledge graph;
- semantic candidate validation;
- persistent monitoring.

### Success criteria

- generic topic non viene silenziosamente trasformato in Issue;
- substantive description può essere strutturata;
- discovery può arricchire terminologia;
- Issue Profile viene validato;
- stato passa a `issue_committed`;
- UI mostra Issue Profile e Agent Activity.

---

## Milestone 2 — Innovation Intelligence

### Obiettivo

```text
COMMITTED ISSUE
→ CORDIS candidate retrieval
→ content retrieval
→ semantic validation
→ Innovation Evidence
```

### Funzione core

```text
search_innovation_projects()
```

### Success criteria

Il sistema deve distinguere progetti che:

- condividono solo la tecnologia;
- affrontano effettivamente lo stesso problema.

---

## Milestone 3 — European Policy Intelligence

### Obiettivo

```text
COMMITTED ISSUE
→ EU policy candidate retrieval
→ content validation
→ Policy Evidence
→ Policy Stage
```

### Funzione core

```text
search_policy_documents()
```

### Success criteria

Il sistema deve distinguere tra:

- semplice menzione;
- discussione;
- riconoscimento del problema;
- iniziativa;
- proposta;
- processo;
- atto/adoption;
- evaluation.

---

## Milestone 4 — Relationship & Knowledge Layer

Da valutare dopo la validazione delle prime tre milestone.

Obiettivi possibili:

- entity resolution;
- relationships;
- project/actor/programme graph;
- document relationships;
- persistent Issue Memory.

---

## Milestone 5 — Monitoring & Media Intelligence

Da valutare dopo la validazione del core.

Possibili estensioni:

- recurring monitoring;
- change detection;
- trigger;
- trend analysis;
- media intelligence;
- eventuale adapter GDELT se dimostra valore rispetto al Web Search per analisi quantitative o longitudinali.

GDELT è quindi una **estensione specializzata**, non un prerequisito architetturale.

---

# 21. Non-Goals del Core

Il core non deve diventare:

- motore di ricerca generalista;
- catalogo indiscriminato di API;
- crawler web;
- sistema che accetta keyword generiche come Issue;
- sistema che considera ogni record recuperato una Evidence;
- sistema che produce policy prediction non verificabili;
- orchestratore che chiama tutte le fonti disponibili;
- demo di Function Calling fine a se stessa.

---

# 22. KPI di prodotto e sperimentazione

## Issue Understanding

- percentuale di Issue Profile accettati correttamente;
- generic topic rejection rate;
- qualità/distinzione delle Search Hypotheses;
- rilevanza della terminologia scoperta.

## Retrieval

- Candidate count;
- Candidate → Evidence conversion rate;
- false positive rate;
- false negative rate su test set;
- numero di tool call;
- numero di query ridondanti.

## Agent Efficiency

- tool calls per research run;
- latenza;
- costo;
- iteration count;
- error rate per adapter.

## Evidence Quality

- provenance completeness;
- relevance explanation coverage;
- percentuale di Evidence con matched issue dimensions;
- information-gap detection.

---

# 23. Acceptance Rule generale

Una feature non è completa se:

- funziona solo con mock quando il requisito richiede una integrazione reale;
- non rispetta la state machine;
- consente retrieval autorevole prima del commit della Issue;
- perde provenance;
- espone raw source schema al posto del semantic tool contract senza motivazione;
- considera una keyword match come Evidence.

---

# 24. Esempio end-to-end di riferimento

## User input

> Individuare iniziative europee che cercano di ridurre la dipendenza delle imprese e delle istituzioni europee da infrastrutture, capacità di calcolo, foundation models, cloud o semiconduttori controllati prevalentemente da operatori extra-UE, e i relativi rischi per autonomia strategica, capacità industriale, sicurezza economica e controllo dei dati.

## Phase 1 — Discovery

L'Agent può usare `web_search`.

Può scoprire linguaggio come:

- technological sovereignty;
- strategic autonomy;
- economic security;
- AI factories;
- sovereign cloud;
- cloud-edge infrastructure.

Non assume che questi termini siano equivalenti.

Costruisce e propone un Issue Profile.

## Phase 2 — Commit

Chiama:

```text
commit_issue_profile()
```

L'applicazione valida e cambia stato.

## Phase 3 — Innovation

In Milestone 2:

```text
search_innovation_projects()
```

CORDIS restituisce Candidate.

Un progetto di AI agricola viene scartato se condivide la tecnologia ma non il problema.

Un progetto che sviluppa capacità europea autonoma di compute/cloud può diventare Evidence se semanticamente coerente.

## Phase 4 — Policy

In Milestone 3:

```text
search_policy_documents()
```

Gli adapter UE recuperano Candidate.

Il Semantic Validator distingue tra una citazione marginale e un documento che riconosce la dipendenza come problema o propone un intervento.

## Phase 5 — Synthesis

Il sistema produce una sintesi basata esclusivamente su Evidence validate e segnala i gap informativi.

---

# 25. Architettura concettuale finale

```text
                         USER PROBLEM
                              │
                              ▼
                     ISSUE DISCOVERY
                              │
                     ┌────────┴────────┐
                     │                 │
              existing meaning    web_search
                     │                 │
                     └────────┬────────┘
                              ▼
                       ISSUE PROFILE
                              │
                    commit_issue_profile
                              │
                              ▼
                       ISSUE COMMITTED
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
      INNOVATION RETRIEVAL          POLICY RETRIEVAL
             CORDIS                 EU ADAPTERS
                │                           │
                └─────────────┬─────────────┘
                              ▼
                         CANDIDATES
                              │
                              ▼
                    SEMANTIC VALIDATION
                              │
                              ▼
                           EVIDENCE
                              │
                              ▼
                     RELATIONSHIPS / STATE
                              │
                              ▼
                         SYNTHESIS
```

---

# 26. Decisioni architetturali definitive di questa baseline

1. **`web_search` è il Discovery Layer core.**
2. **GDELT non è nel core né nelle prime tre milestone.**
3. **CORDIS è la prima fonte autorevole per Innovation Intelligence.**
4. **EUR-Lex/CELLAR e altre fonti UE sono adapter del Policy Intelligence Layer.**
5. **L'Issue Profile è obbligatorio prima del retrieval autorevole.**
6. **Function Calling orchestra azioni semantiche, non sostituisce la comprensione della Issue.**
7. **Candidate ed Evidence sono entità differenti.**
8. **Semantic validation è obbligatoria prima della sintesi.**
9. **Tool availability è state-gated nel codice.**
10. **PRD, runtime prompt, architecture, data model e Skill hanno responsabilità separate.**
