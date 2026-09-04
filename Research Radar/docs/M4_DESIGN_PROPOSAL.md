# Research Radar — Proposta di Design M4: Entity Resolution & Knowledge Layer

**Versione:** 1.0 (proposta — da validare prima dell'implementazione)
**Stato:** Design proposal. M4 è esplicitamente *"da valutare dopo la validazione delle prime tre milestone"* (PRD §20): questo documento è l'oggetto di quella valutazione, non un'implementazione.
**Base di partenza:** M1 `922c261` (Issue Understanding) · M2 `da89e27` (Innovation Intelligence) · M3 `c98fec4` (Policy Intelligence).

---

## 1. Obiettivo e valore

Le prime tre milestone producono, per ogni run: un Issue Profile committato, Candidate normalizzati, Evidence validate con provenance e Policy Stage. Il valore di M4 è trasformare questo accumulo di run in **capitale conoscitivo riutilizzabile**:

1. **Entity Resolution** — capire che *"Fraunhofer-Gesellschaft (DE)"* (CORDIS), *"FRAUNHOFER GESELLSCHAFT"* e *"Fraunhofer"* sono lo stesso attore;
2. **Knowledge Graph** — Issue → Evidence → Actor → Programme → Project come struttura interrogabile (PRD §16: *programma → progetto → organizzazione*, *Issue → Evidence → Actor relationships*);
3. **Persistent Issue Memory** — memoria cross-run: issue già investigate, attori già visti, relazioni già accertate (ponte naturale verso il monitoring di M5).

## 2. Principi (non negoziabili, ereditati dal PRD)

- **La state machine delle fasi NON cambia.** M4 arricchisce `candidate_validation`/`synthesis` e il post-run; non introduce fasi nuove e non indebolisce P-02/P-04/P-07.
- **Ogni arco del grafo ha provenance.** Un arco senza `evidenceId` di origine e senza `extractionMethod` non esiste. Distinzione obbligatoria (RF-13): `source_fact` ≠ `application_classification` ≠ `model_inference`.
- **Deterministico prima, model-assisted dopo.** Le entità già presenti nei metadati (organizzazioni/programmi CORDIS, CELEX/istituzione dai documenti) si estraggono senza LLM. Il modello interviene solo su ciò che richiede lettura semantica (mention nel testo), con schema strict e guardie nel codice.
- **Il grafo è un read model.** Costruito/aggiornato a valle delle Evidence validate; mai fonte di verità primaria. La verità primaria restano Issue Profile, Candidate, Evidence.
- **Zero nuove dipendenze runtime** (coerente con la filosofia del repo).

### Non-goal di M4

- Non è un motore di ricerca sull'intero web semantico; il grafo copre **solo ciò che passa da Evidence validate** di run reali.
- Non è un reasoner RDF/OWL: l'RDF resta un'opzione di **export**, non lo storage.
- Non fa entity resolution su Candidate scartati (solo su Evidence accettate + metadati ad esse collegati).
- Non introduce UI di annotazione manuale nel primo giro (l'human-in-the-loop è previsto come M4c opzionale).

---

## 3. Modello di dominio

### 3.1 Nodi

```ts
type EntityKind = "actor" | "programme" | "project" | "policy_document" | "issue";

interface GraphEntity {
  id: string;                    // generato dall'applicazione (ent_)
  kind: EntityKind;

  canonicalName: string;
  aliases: string[];             // varianti risolte (con origine)
  normalizedName: string;        // chiave di matching (vedi §4.1)

  kindDetail?: string;           // actor: "company"|"research_org"|"institution"|"agency"|"other"
                                 // policy_document: documentType; project: frameworkProgramme
  countryCode?: string;

  sourceKeys: SourceKey[];       // identificatori canonici della fonte
  confidence: "deterministic" | "high" | "review";
  firstSeenRunId: string;
  createdAt: string;
  updatedAt: string;
}

interface SourceKey {
  provider: "cordis" | "cordis-org" | "cellar" | "eurlex" | "application";
  id: string;                    // es. rcn progetto, cordis org id, CELEX
}
```

**Corrispondenze con il dominio esistente:**

| Entità | Origine oggi | Note |
| --- | --- | --- |
| `issue` | `IssueProfile` (uno per run) | nodo di raccordo del grafo |
| `project` | Evidence `innovation` | `sourceId` = RCN; metadati già in `Evidence.metadata` |
| `policy_document` | Evidence policy | `sourceId` = CELEX; `policyStage` resta classificazione applicativa sull'**arco**, non sul nodo |
| `programme` | `Evidence.metadata.frameworkProgramme` / call | es. "Horizon Europe", "HORIZON-CL4" — normalizzati con authority table locale |
| `actor` | organizzazioni/coordinatori CORDIS, istituzioni dai documenti UE, attori menzionati | il cuore di M4 |

### 3.2 Archi

```ts
type EdgeType =
  | "issue_has_evidence"          // issue → project|policy_document
  | "project_participates_in"     // project → programme
  | "actor_coordinates"           // actor → project   (source_fact CORDIS)
  | "actor_participates_in"       // actor → project   (source_fact CORDIS)
  | "actor_mentioned_by"          // actor → policy_document (model_inference o source_fact)
  | "actor_addresses_issue"       // actor → issue     (application_classification: derivato)
  | "document_related_to";        // policy_document ↔ policy_document (stessa procedura/atto base)

interface GraphEdge {
  id: string;
  type: EdgeType;
  fromEntityId: string;
  toEntityId: string;
  provenance: {
    runId: string;
    evidenceId: string;           // arco sempre ancorato a un'Evidence validata
    extractionMethod: "source_fact" | "application_classification" | "model_inference";
    explanation: string;          // spiegazione obbligatoria se model_inference
  };
  attributes?: Record<string, unknown>;  // es. ecContributionEur sull'arco actor→project
  createdAt: string;
}
```

Invarianti enforceable nel codice:
- `extractionMethod = "model_inference"` ⇒ `explanation` non vuota (min. 40 caratteri, come i validator M2/M3);
- ogni `from/to` risolve a un nodo esistente;
- niente archi duplicati stessi (`type, from, to, evidenceId`): idempotenza per re-run.

---

## 4. Entity Resolution — pipeline a tre stadi

### 4.1 Stadio A — Normalizzazione deterministica

Chiave `normalizedName` per le organizzazioni:
1. trim, case-fold;
2. rimozione forme legali (tabella estendibile): `gmbh, mbh, ag, s.a., s.p.a., srl, bv, b.v., nv, ltd, llc, inc, sa, asbl, o.e.i., ug,控股` → già presente il concetto di tabella in `GENERIC_DOMAIN_LABELS` (stesso pattern);
3. rimozione parentesi geografiche `(de)`, `(fr)`, punctuation folding, collapse spazi;
4. unicode NFKC.

Per gli attori istituzionali UE: **authority table locale** seedata (European Commission, Parliament, Council, EEAS, national ministries con nomi EN/FR/DE dove noti) — le istituzioni sono un insieme finito e noto: la resolution qui è tabellare, non probabilistica.

### 4.2 Stadio B — Matching rule-based (senza modello)

Ordine di priorità:
1. **Source key esatta** — stesso `cordis-org id` (richiede l'estensione adapter di §5.1) o stesso CELEX ⇒ merge automatico (`deterministic`);
2. **Authority table / alias noto** ⇒ merge automatico (`deterministic`);
3. **Similarità lessicale** su `normalizedName` (Jaro-Winkler + token-set ratio, implementazione ~60 righe senza dipendenze) a bande:
   - `≥ 0.95` ⇒ merge automatico (`high`);
   - `0.80 – 0.95` ⇒ coda di revisione (Stadio C);
   - `< 0.80` ⇒ entità distinte.

Ogni merge produce un **MergeDecision** loggato (auditability): `{ keptEntityId, mergedEntityId, method, score, decidedBy: "rule"|"model"|"human", reason }`. I merge sono reversibili solo via decisione esplicita (nessun auto-split).

### 4.3 Stadio C — Model-assisted, solo banda grigia

Solo per i casi in banda 0.80–0.95 il modello è interrogato (chiamata applicativa server-side, **non** tool esposto all'agent di ricerca) con compito stretto: *"sono la stessa organizzazione? sì/no + ragione"*. Guardie:
- input: solo le due `normalizedName` + `countryCode` (niente testo libero esteso ⇒ superficie di prompt injection minima);
- output strict JSON `{ same: boolean, reason: string }`, ri-provato una volta sola in caso di scarto;
- disaccordo o fallimento ⇒ resta `review` (nessun merge).

### 4.4 Human-in-the-loop (M4c, opzionale)

Vista "Entity review queue" (entità `confidence: "review"`): merge/split manuale che scrive `MergeDecision.decidedBy: "human"` e promuove `alias` noto nell'authority table locale.

---

## 5. Estrazione — da dove arrivano le entità

### 5.1 Deterministica dai metadati source (nessun LLM, costo zero)

**CORDIS (estensione adapter M4a):** oggi `normalizeProject` cattura `organizations`/`coordinator` come stringhe. L'estrazione va estesa per richiedere, nella query Data Extractions, i campi strutturati delle associazioni (organization `legalName`, `shortName`, `id`, `country`, `role`, programme `code`/`name`), producendo in `Candidate.metadata`:
```json
"organizations": [{ "legalName": "...", "shortName": "...", "sourceKey": "cordis-org:12345", "countryCode": "DE", "role": "coordinator" | "participant", "ecContributionEur": 123 }],
"programmes": [{ "code": "HORIZON.2.4", "name": "Digital, Industry and Space" }]
```
> ⚠️ Dipendenza onesta: lo shape del file di export CORDIS va confermato sulla fonte reale (già azione P0 del piano di produzione). Se gli id organizzazione non fossero disponibili, lo Stadio B degrada a similarità (bande più conservative) senza cambiare il modello.

**CELLAR/EUR-Lex (deterministico):** dal CELEX e dai metadati già normalizzati: istituzione emittente (prefisso CELEX: `52023PC…` → Commission; `32022R…` → atto del Parlamento/Consiglio), `documentType`, date. Nessun full-text parsing nel primo giro.

### 5.2 Model-assisted dalle mention (tool semantic `record_entity_mentions`)

Per gli attori menzionati nel testo delle Evidence (es. una comunicazione che cita un consorzio o un'azienda):
- **disponibilità:** `candidate_validation`, `synthesis` (phase-gated nel codice, come M2/M3);
- input strict: `evidenceId`, `mentions[]` con `{ name, kindDetail?, countryCode?, contextQuote (≤ 300 char, copiata dall'Evidence), explanation (≥ 40 char) }`;
- guardie deterministiche: l'`evidenceId` deve appartenere al run ed essere un'Evidence accettata; la `contextQuote` deve essere sottostringa del contenuto dell'Evidence (verifica nel codice ⇒ il modello non può inventare citazioni); archi creati con `extractionMethod: "model_inference"` e `explanation` obbligatoria;
- budget: max ~24 mention per chiamata, contenuto Evidence troncato (come già nei search tool).

### 5.3 Arricchimento automatico post-accettazione

Quando un validatore accetta un Candidate → Evidence, l'orchestratore invoca l'**enrichment job applicativo** (codice, non modello): crea/aggiorna nodi `project`/`policy_document`/`programme`, applica lo Stadio A+B di resolution per gli attori dai metadati, scrive gli archi `source_fact`. Fallimenti dell'enrichment non invalidano mai l'Evidence (decoupling: enrichment = best-effort, loggato).

---

## 6. Storage e architettura

**Raccomandazione: SQLite** (via `node:sqlite`, built-in da Node 22.5+; in produzione containerizzata è il candidato più coerente con "zero dipendenze"; upgrade path a PostgreSQL documentato in §6.3).

```
runs(id, status, phase, user_question, created_at, ...)
issues(id, run_id, profile_json, committed_at)
evidence(id, run_id, issue_id, json, created_at)         -- fedeltà con i modelli esistenti
entities(id, kind, canonical_name, normalized_name, kind_detail, country, confidence, first_seen_run_id, ...)
entity_source_keys(entity_id, provider, source_id)        -- UNIQUE(provider, source_id)
entity_aliases(entity_id, alias, origin)
edges(id, type, from_entity, to_entity, run_id, evidence_id, extraction_method, explanation, attributes_json)
merge_decisions(id, kept_entity_id, merged_entity_id, method, score, decided_by, reason, created_at)
entity_review_queue(entity_id, reason, created_at, resolved_at)
```

- Il **grafo in memoria per la UI** è un read model costruito da `entities`+`edges` (query ricorsiva per la componentistica del run: CTE `WITH RECURSIVE` su SQLite/PG).
- Il `ResearchStore` in-memory resta per i run in corso; a fine run il persistence layer congela il run (già serializzato com'è in `serializeState`) e alimenta il grafo.
- **Export RDF opzionale** (M4d): mappa banale nodi→URI (cordis/cellar quando disponibili, altrimenti URN applicativi) — utile per interoperabilità OP; non è lo storage.

### 6.3 Upgrade path PostgreSQL

Stesso schema, stessi SQL parametrici; cambia il driver (`node:pg`). Trigger di migrazione: concorrenza multi-istanza o dataset > ~10⁶ archi.

---

## 7. Impatto su orchestrator, tool gating e prompt

- **Nessuna nuova fase**, nessuna transizione modificata (`TRANSITIONS` in `src/domain/state.ts` resta identico).
- Registry: + `record_entity_mentions` (phases: `candidate_validation`, `synthesis`).
- `phaseEntryMessage` di `synthesis` si arricchisce di: "segna le mention di attori con record_entity_mentions prima di chiudere" (bounded: un solo reminder).
- Prompt canonico (`prompt/research-agent.md`): aggiunta di una sezione "Entity mentions" **solo dopo** l'implementazione, con test che dimostri il comportamento (regola del SKILL.md: ogni cambio prompt porta un test).
- Config: `RR_ENTITY_RESOLUTION=on|off` (default off fino a validazione M4a), `RR_ENRICHMENT=on|off`.

---

## 8. API e UI

### API (tutte read-only tranne la review)

```
GET /api/graph/run/:runId            → nodi+archi del run (per la vista run)
GET /api/entities?kind=actor&q=...   → ricerca entità (autocomplete UI)
GET /api/entities/:id                → scheda entità (aliases, source keys, archi, merge history)
GET /api/entities/review             → coda di revisione (M4c)
POST /api/entities/review/:id        → decisione umana merge/split (M4c)
GET /api/issues                      → Issue Memory: profili committati storici
```

### UI (PRD §16, da dati normalizzati)

- **Graph view** nel tab *Synthesis* o tab dedicato *Knowledge*: layout precomputato server-side (layered: Issue → Evidence → Actors/Programmes) e rendering con **Cytoscape.js vendored** (un file, nessun build step, coerente con l'approccio zero-build dell'UI attuale). Interazione minima: click nodo → scheda; filtri per `kind` e `extractionMethod`.
- **Evidence card**: chip entità risolte con `confidence`.
- **Entity review queue** (M4c): lista merge proposti con score e motivo.

---

## 9. Persistent Issue Memory

- Libreria dei profili committati (`GET /api/issues`) con: titolo, perimetro, terminologia, ipotesi di ricerca.
- Al nuovo run, suggerimenti deterministici: *"issue simile già investigata il …"* (similarità su `canonicalTerms`/`searchHypotheses` con le stesse bande §4.2), attori già risolti riusati (Stadio B by source key).
- È il naturale punto di aggancio di M5 (monitoring ricorrente: re-run di un profilo esistente + change detection sulle Evidence nuove) — ma M5 resta fuori da questa proposta.

---

## 10. Test strategy e acceptance criteria

**Test unitari:** normalizzazione (forme legali, paesi, NFKC); bande di similarità con golden pairs (es. `Fraunhofer-Gesellschaft zur Förderung der angewandten Forschung e.V.` vs `FRAUNHOFER` → merge; `Enea (IT)` vs `ENEA Energia Nuova` band); authority table; merge idempotenti.

**Test di contratto tool:** `record_entity_mentions` rifiuta `evidenceId` sconosciuti/non accettati, `contextQuote` non presenti nel contenuto, explanation corte.

**Test di integrazione:** enrichment end-to-end su Evidence fixture (fixture CORDIS estesa con organizations strutturate) → nodi/archi attesi con provenance corretta; re-run dello stesso run ⇒ nessun duplicato.

**Invarianti di grafo verificate nei test:** ogni arco ha `evidenceId` risolvibile; `model_inference` ⇒ `explanation` ≥ 40 char; nessun orfano dopo merge (riancoraggio archi al kept entity).

**Acceptance criteria della milestone (proposta):**
1. dato un run M2+M3 completato, il grafo del run contiene Issue → Evidence (tutte) → Actors (da metadati, deterministic) → Programmes;
2. due run sulla stessa Issue con nomi organizzazione diversi condividono le stesse entità actor (resolution funzionante cross-run);
3. ogni arco è tracciabile all'Evidence e al metodo di estrazione (audit completa via `merge_decisions` + `edges.provenance`);
4. disabilitando `RR_ENRICHMENT` il comportamento è identico a M3 (feature flag pulito);
5. la state machine e tutti i test M1–M3 (76) restano verdi senza modifiche alle asserzioni esistenti.

---

## 11. Phasing interna

| Fase | Contenuto | Dipende da |
| --- | --- | --- |
| **M4a** | Schema storage + entity store + normalizzazione + Stadio A/B + enrichment deterministico + `GET /api/graph/run/:id` | verifica live adapter CORDIS (§5.1) |
| **M4b** | Tool `record_entity_mentions` + mention→graph con guardie + Stadio C model-assisted | M4a |
| **M4c** | UI graph view (Cytoscape vendored) + entity review queue + schede entità | M4a (UI), M4b (coda) |
| **M4d** | Persistent Issue Memory + riuso cross-run + export RDF opzionale | M4a |

Ordine consigliato: M4a → M4c(UI su deterministico) → M4b → M4d. M4b è l'unico blocco con costo LLM aggiuntivo: si può spedire valore (grafo deterministico) senza di esso.

## 12. Rischi e domande aperte

1. **Disponibilità degli organization id nell'export CORDIS** — incerta fino alla verifica live; piano B: bande conservative + authority table (§5.1).
2. **Multilinguismo nomi organizzazione** (EN/FR/DE/…) — mitigato dall'authority table per le istituzioni; per le imprese si accetta risoluzione monolingua con `review` onesto.
3. **Volume**: SQLite regge bene il regime reale (centinaia di run × decine di evidence); il prefisso PG è documentato.
4. **Qualità delle mention del modello** — mitigate da: solo su Evidence accettate, quote verificabili nel codice, `confidence: review` di default per attori nati solo da mention.
5. **Drift CDM/CELLAR per i campi istituzione** — già coperto dal pattern `AdapterError`.

## 13. Cosa NON cambia

State machine delle 5 fasi, gating dei tool esistenti, contratti IssueProfile/Candidate/Evidence, prompt canonico (finché M4b non passa dal suo ciclo test→prompt), UI esistente. M4 è additive e dietro feature flag: un deployment M4-disabled deve essere comportamentalmente identico a M3.
