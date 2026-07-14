# 研究補助ツール 設計仕様書（TypeScript版）

- ステータス: 改訂ドラフト（設計フェーズ）
- バージョン: 0.2
- 最終更新: 2026-07-12
- 対象読者: 本ツールの実装者・レビュー担当者
- 原本: `design-spec-typescript.md`
- 備考: Python版仕様書と共通のアーキテクチャ方針をTypeScript／Node.jsスタックで実現する。技術スタック固有の差分は、アプリケーション構造、LLM層、ジョブキュー、エージェント実装に閉じる。

## 0. 改訂方針

本改訂では、元仕様の設計思想を維持したまま、以下を明確化した。

1. `PaperRepository` の責務を分割し、論文・引用・チャンク・要約を別Repositoryとする。
2. 論文名寄せロジックをRepositoryから `PaperMatcher` へ分離する。
3. 検索実行とインデックス管理を `SearchIndex`／`IndexAdmin` に分離する。
4. 人間承認を `JobQueue` から `ApprovalRepository`／承認ユースケースへ分離する。
5. チャンクをRDBへ永続化し、Meilisearchを再構築可能な派生索引とする。
6. RAG対話向けにLLMストリーミングをポートへ追加する。
7. 初期リリースはPostgreSQLを正式対応とし、SQLiteは実験的・後続対応とする。
8. 監査ログ、再インデックス、削除、バックアップ、外部API制限への運用方針を追加する。

---

## 1. 概要と目的

学術論文PDF（英語・日本語）を大量に取り込み、研究活動を補助するローカル中心のツールを構築する。中核機能は次の5つである。

1. PDFの取り込みと構造化（本文・書誌・参考文献の抽出）
2. 引用による論文間の対応付け（引用グラフの構築）
3. 全文検索とベクトル検索を統合したハイブリッド検索
4. LLMによる構造化要約と、検索結果を根拠とするRAG応答
5. 引用グラフ上の未所持論文を探索・取得してコーパスを自己発展させるエージェント（人間の承認を必須とする）

### 1.1 前提条件

| 項目 | 決定内容 |
|---|---|
| 規模 | 数千本。将来的な増加を見込みPostgreSQLを正式DBとする |
| 利用者 | シングルユーザー、単一マシン |
| ネットワーク | データ本体はローカル保持。LLM API・書誌API・OA論文PDFのダウンロードは外部通信を許容 |
| エージェント自律度 | 取得候補の提示までは自動、実行は人間の承認後 |
| 対応言語 | 日本語・英語の混在コーパス。日英クロスリンガル検索を必須とする |
| 可用性 | 個人利用を前提とし、高可用性構成は対象外。ただし再実行・再構築・バックアップを可能にする |

### 1.2 非目標

初期フェーズでは以下を対象外とする。

- 複数ユーザー・組織単位の権限管理
- 商用サービス相当の高可用性、水平スケール、SLA
- 有料論文の自動取得やアクセス制御の回避
- エージェントによる無承認の外部ダウンロード・ファイル削除
- RDB内でのベクトル検索・全文検索

---

## 2. 全体アーキテクチャ

処理の流れは「取り込み → 名寄せ・引用解決 → 永続化 → 索引化 → 検索・要約・分析 → エージェントによる拡張（→ 取り込みへ還流）」というパイプラインである。長時間処理と再実行可能な処理はジョブキューを経由する。

### 2.1 プロセス構成

`docker compose` で以下を起動する。

| プロセス | 種別 | 役割 |
|---|---|---|
| postgres | 常駐サービス | 真実の源。メタデータ、本文チャンク、引用グラフ、要約、ジョブ、承認、監査ログを保持 |
| meilisearch | 常駐サービス | 全文検索＋ベクトル検索。RDBから再構築可能な派生索引 |
| ollama | 常駐サービス | 埋め込み（bge-m3）およびローカルLLM |
| api | 自作（Node.js） | Fastify。検索API、承認API、RAGストリーミング、エージェント対話 |
| worker | 自作（Node.js） | ジョブキューの消化。ステートレスで複数起動可能 |
| web | 自作 | 検索、PDF表示、引用グラフ、承認、運用画面 |

GROBIDは取り込み時のみ必要なためオンデマンド起動とする。エージェントランナーは独立した `apps/agent` とし、APIまたはCLIから起動する。

ホスト／コンテナ要件はNode.js 20+、Java 11+とする。JavaはPDF解析を実行するworkerイメージに同梱する。

### 2.2 データの役割分担

PostgreSQLを唯一の真実の源（System of Record）とする。以下をRDBへ保存する。

- 論文メタデータ
- PDFファイルの管理情報と内容ハッシュ
- 抽出済み本文チャンク、ページ、bbox、セクション情報
- 参考文献と引用エッジ
- 構造化要約
- ジョブ、承認、監査ログ
- インデックス世代・埋め込みモデルバージョン

Meilisearchには検索に必要な派生ドキュメントと埋め込みのみを保存する。索引はRDBから全再構築できなければならない。

RDBのpgvector、全文検索等をアプリケーション機能として利用することは禁止する。RDB固有機能は、整合性・ロック・ジョブ取得・再帰CTEなど、永続化の責務に限って使用する。

### 2.3 ファイル保存

PDF原本は設定されたローカルディレクトリに保存し、RDBには相対パス、SHA-256、ファイルサイズ、MIME、取得元を記録する。

同一内容のPDFはハッシュで重複排除する。ファイルの直接上書きは禁止し、差し替え時は新しいファイルレコードを作成して再解析ジョブを投入する。

---

## 3. 技術スタックと差し替え方針

| 領域 | 採用 | 差し替え候補 | 備考 |
|---|---|---|---|
| ランタイム | Node.js 20+ / TypeScript | Bun（互換性検証後） | pnpmワークスペースによるモノレポ |
| RDB | PostgreSQL | SQLite（実験的） | Drizzle ORM + drizzle-kit。再帰CTE・ジョブ取得はKyselyまたは生SQLを併用 |
| 検索 | Meilisearch | Elasticsearch等 | 公式JSクライアント。ポートの背後に隠蔽 |
| 埋め込み | Ollama + bge-m3 | 埋め込みAPI | 日英クロスリンガル性能を受入条件とする |
| クラウドLLM | Claude API | 他社API | 通常、ストリーミング、Message Batches |
| ローカルLLM | Ollama（Qwen系等） | vLLM等 | OpenAI互換エンドポイントを利用 |
| PDF解析 | `@opendataloader/pdf` + GROBID | marker、Nougat等 | TEI XMLはfast-xml-parserで解析 |
| 書誌API | OpenAlex、Crossref、Unpaywall、arXiv、J-STAGE、CiNii | — | レート制限とキャッシュを共通アダプタで扱う |
| ジョブキュー | PostgreSQL内jobsテーブル＋自作worker | graphile-worker / pg-boss | 初期リリースではPostgreSQL実装を正式採用 |
| スキーマ検証 | zod | — | LLM出力、ツール、API、TS型の単一定義 |
| API | Fastify | Hono | WebSocketまたはSSEによるストリーミング |
| フロントエンド | 未決定 | React系等 | `packages/contracts` の型を利用 |

### 3.1 差し替え可能性の規約

1. ユースケース層は具体技術名を参照せず、ポートにのみ依存する。
2. RDB方言依存SQLはアダプタ内部に閉じ、ポートのシグネチャへ漏らさない。
3. 検索・ベクトル機能は検索エンジンに置き、RDB検索機能へ依存しない。
4. LLMは役割ベースのルーティング設定で切り替える。
5. API契約・Zodスキーマは `packages/contracts` から共有する。
6. フロントエンドはドメイン内部型ではなく、公開契約型のみを参照する。
7. 外部APIクライアントはタイムアウト、リトライ、レート制限、キャッシュをアダプタ内で統一する。

### 3.2 PostgreSQL／SQLite方針

初期リリースの正式対応はPostgreSQLのみとする。SQLiteは以下を満たした場合に後続フェーズで追加する。

- ジョブ取得、再帰CTE、JSON、マイグレーションの互換試験が通る
- 複数workerを使用しない制約を許容できる
- PostgreSQL版と同一の契約テストを通過する

SQLite対応のためにコア設計を複雑化させない。

---

## 4. アプリケーション構造（ポート＆アダプタ）

### 4.1 モノレポ構成

依存の向きは `apps → packages/adapters → packages/core` とし、`core` は外部ライブラリへ依存しない。Zodを利用する公開契約は `packages/contracts` に置く。

```text
packages/
  core/
    src/domain/          # Paper, Citation, Chunk, Summary, Job, Approval
    src/usecases/        # ingest, resolve, search, summarize, approve, rebuild
    src/ports/           # 永続化・検索・LLM・外部APIのinterface
    src/services/        # PaperMatcher、スコアリング等のドメインサービス
  contracts/
    src/schemas/         # zod: API、LLM構造化出力、ツール入出力
    src/types/           # z.inferによる公開型
  adapters/
    src/db/postgres/     # Drizzleスキーマ、Repository、JobQueue
    src/db/sqlite/       # 実験的。正式対応まではビルド対象外でもよい
    src/search/          # MeilisearchのSearchIndex／IndexAdmin
    src/llm/             # Anthropic、Ollama、Router
    src/parser/          # OpenDataLoader、GROBID
    src/biblio/          # OpenAlex、Crossref等
    src/storage/         # ローカルファイル保存
apps/
  api/                   # Fastify API、SSE/WebSocket
  worker/                # ジョブ消化ループ
  cli/                   # 取り込み、再構築、バックアップ等
  agent/                 # Agent SDKランナー
  web/                   # 検索・PDF・グラフ・承認・運用UI
```

DIコンテナは使用しない。`apps/*/bootstrap.ts` で設定を読み、アダプタを生成してユースケースへ注入する。`core` 内にインフラ構築コードを置かない。

テストでは各ポートに対するインメモリフェイクまたは契約テスト用実装を注入する。

### 4.2 主要ポート定義

```typescript
export interface PaperRepository {
  get(id: PaperId): Promise<Paper | null>;
  getMany(ids: PaperId[]): Promise<Paper[]>;
  findByDoi(doi: string): Promise<Paper | null>;
  findCandidates(input: PaperMatchQuery): Promise<PaperMatchCandidate[]>;
  upsert(paper: Paper): Promise<PaperId>;
  updateStatus(id: PaperId, status: PaperStatus): Promise<void>;
  listGhosts(query: GhostQuery): Promise<GhostPaper[]>;
}

export interface CitationRepository {
  replaceReferences(paperId: PaperId, refs: ReferenceRecord[]): Promise<void>;
  upsertEdges(edges: CitationEdge[]): Promise<void>;
  findCiting(paperId: PaperId): Promise<PaperId[]>;
  findCitedBy(paperId: PaperId): Promise<PaperId[]>;
  traceLineage(input: LineageQuery): Promise<LineageGraph>;
}

export interface ChunkRepository {
  replaceForPaper(paperId: PaperId, chunks: Chunk[]): Promise<void>;
  get(chunkId: ChunkId): Promise<Chunk | null>;
  getMany(ids: ChunkId[]): Promise<Chunk[]>;
  listForPaper(paperId: PaperId): Promise<Chunk[]>;
  deleteForPaper(paperId: PaperId): Promise<void>;
}

export interface SummaryRepository {
  put(summary: StoredSummary): Promise<void>;
  get(paperId: PaperId, modelKey: string): Promise<StoredSummary | null>;
  listForPaper(paperId: PaperId): Promise<StoredSummary[]>;
}

export interface PaperMatcher {
  match(ref: RefString): Promise<PaperMatchResult>;
}

export interface SearchIndex {
  hybridSearch(query: string, options: SearchOptions): Promise<SearchHit[]>;
  facetByYear(query: string, filters: SearchFilters): Promise<Record<number, number>>;
}

export interface IndexAdmin {
  upsertPaper(paper: Paper, chunks: Chunk[]): Promise<void>;
  deletePaper(paperId: PaperId): Promise<void>;
  rebuildAll(input: RebuildOptions): Promise<RebuildResult>;
  getState(): Promise<IndexState>;
}

export interface Llm {
  complete<T>(
    role: LlmRole,
    messages: Message[],
    schema?: Schema<T>,
  ): Promise<LlmResult<T>>;

  stream(
    role: LlmRole,
    messages: Message[],
  ): AsyncIterable<LlmStreamEvent>;

  submitBatch(role: LlmRole, items: BatchItem[]): Promise<BatchHandle>;
  pollBatch(handle: BatchHandle): Promise<BatchStatus>;
}

export interface PdfParser {
  parse(inputs: PdfParseInput[]): Promise<ParsedDocument[]>;
}

export interface BiblioResolver {
  resolve(ref: RefString): Promise<ResolvedReference | null>;
  findOaPdf(ref: ResolvedReference): Promise<OaPdfCandidate | null>;
}

export interface JobQueue {
  enqueue(spec: JobSpec): Promise<JobId>;
  claimNext(lane: Lane, workerId: string): Promise<Job | null>;
  heartbeat(jobId: JobId, workerId: string): Promise<void>;
  succeed(jobId: JobId, result: JobResult): Promise<void>;
  fail(jobId: JobId, error: JobError): Promise<void>;
  recoverStaleJobs(before: Date): Promise<number>;
}

export interface ApprovalRepository {
  create(request: ApprovalRequest): Promise<ApprovalId>;
  get(id: ApprovalId): Promise<ApprovalRequest | null>;
  listPending(): Promise<ApprovalRequest[]>;
  decide(id: ApprovalId, decision: ApprovalDecision): Promise<void>;
}

export interface AuditLogRepository {
  append(entry: AuditEntry): Promise<void>;
}
```

`PaperMatcher` はDOI、タイトル、著者、年、外部API照会を組み合わせるドメインサービスであり、Repository内にあいまい一致ロジックを持たせない。

`JobQueue` は実行制御だけを担当する。承認判断と承認履歴は `ApprovalRepository` および承認ユースケースが担当する。

---

## 5. データモデル

### 5.1 主要テーブル

| テーブル | 役割 |
|---|---|
| papers | 所持・未所持を含む論文ノード |
| paper_files | PDF原本、ハッシュ、保存先、取得元、版情報 |
| authors / paper_authors | 著者と順序。初期実装でJSON保持する場合も移行余地を残す |
| sections | 論文内セクション構造 |
| chunks | RAG・検索の根拠となる本文単位。page、bbox、textを保持 |
| references | PDFから抽出した参考文献原文と解決状態 |
| citations | 解決済み引用エッジと引用文脈 |
| summaries | 論文・モデル・プロンプトバージョン別の構造化要約 |
| jobs | 非同期ジョブ |
| approvals | 人間承認要求と判断履歴 |
| tool_audit_logs | エージェントおよびツール実行の監査ログ |
| index_generations | 索引世代、埋め込みモデル、構築状態 |
| external_api_cache | 書誌API応答キャッシュ、ETag、期限 |

### 5.2 papers

```typescript
export const papers = pgTable("papers", {
  id: text("id").primaryKey(),
  doi: text("doi").unique(),
  openalexId: text("openalex_id").unique(),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  authorsJson: jsonb("authors_json").$type<Author[]>().notNull(),
  year: integer("year"),
  venue: text("venue"),
  lang: text("lang").notNull(),
  status: text("status").$type<PaperStatus>().notNull(),
  currentFileId: text("current_file_id"),
  source: text("source"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});
```

未所持論文も `status = 'ghost'` として登録する。PDF取得後は同一paperレコードを所持状態へ遷移させる。

### 5.3 chunks

```typescript
export const chunks = pgTable("chunks", {
  id: text("id").primaryKey(),
  paperId: text("paper_id").notNull(),
  sectionId: text("section_id"),
  ordinal: integer("ordinal").notNull(),
  text: text("text").notNull(),
  pageFrom: integer("page_from").notNull(),
  pageTo: integer("page_to").notNull(),
  bboxJson: jsonb("bbox_json").$type<PageBBox[]>(),
  tokenCount: integer("token_count"),
  contentHash: text("content_hash").notNull(),
  parserVersion: text("parser_version").notNull(),
});
```

チャンク本文はRDBに保持する。Meilisearchには同じ `chunk_id` を主キーとして派生ドキュメントを登録する。

### 5.4 要約のバージョン管理

`summaries` の一意キーは少なくとも以下を含む。

- `paper_id`
- `provider`
- `model`
- `prompt_version`
- `source_content_hash`

PDFや抽出本文が変わった場合、旧要約を上書きせず新しい要約を生成する。

### 5.5 削除方針

論文の通常削除は論理削除とする。物理削除は明示的な管理操作のみ許可する。

物理削除時は次の順序で処理する。

1. 関連ジョブを停止または無効化
2. Meilisearchから削除
3. summaries、chunks、references等を削除
4. citationsは方針に応じて削除またはghostノードへ変換
5. PDF原本を隔離ディレクトリへ移動
6. 監査ログを記録

---

## 6. 取り込みパイプライン

### 6.1 ジョブ連鎖

基本連鎖は以下とする。

```text
register_file
  → parse_pdf_batch
  → persist_document
  → resolve_references
  → build_citation_edges
  → index_paper
  → summarize
```

`persist_document` 完了後は、検索索引が失われても本文と構造をRDBから復元できる。

各工程は冪等性キーと入力内容ハッシュを持つ。途中失敗時は該当工程以降だけを再実行する。

### 6.2 取り込み入力

`PdfParser` 自体はPDF解析だけを担当する。ディレクトリ、ZIP、URL等の展開は取り込みユースケースまたは `ImportSourceAdapter` が担当し、最終的にローカルPDFへ正規化する。

```typescript
export type PdfParseInput = {
  fileId: FileId;
  absolutePath: string;
  sha256: string;
};
```

### 6.3 PDF解析の役割分担

| 役割 | ツール | 出力 |
|---|---|---|
| 本文・座標・読み順 | OpenDataLoader | 要素型、テキスト、bbox、ページ番号 |
| 書誌ヘッダ・参考文献 | GROBID | TEI XML |
| 日本語フォールバック | ローカルLLM（`extract_refs`） | 構造化書誌・参考文献 |
| OCR | OpenDataLoaderハイブリッドモード | OCR済みテキストと座標 |

`convert()` のJVM起動コストを考慮し、workerは複数PDFをまとめて解析する。ポートは配列入力とし、1件ずつの呼び出しを標準経路にしない。

### 6.4 品質判定

解析結果には品質指標を付与する。

- 抽出文字数／ページ
- 文字化け率
- 見出し検出数
- 参考文献検出数
- GROBIDヘッダの必須項目充足率
- OCR使用有無

閾値未満の場合は自動フォールバックまたは要確認状態へ遷移する。

### 6.5 日本語対応

J-STAGE／CiNiiによる書誌補完を行う。言語判定結果を `papers.lang` に保存し、Meilisearch登録時にlocalesを明示する。

外部APIの応答はキャッシュし、レート制限超過時は指数バックオフする。

### 6.6 チャンク分割

見出し境界を優先し、セクションから段落単位へ分割する。各チャンクには以下を付与する。

- `chunk_id`
- `paper_id`
- `section_id`
- `ordinal`
- `page_from`／`page_to`
- ページごとのbbox
- 本文
- トークン数
- 内容ハッシュ
- parser／chunkerバージョン

初期値は実験用設定とし、検索評価に基づいて決定する。変更時は `chunker_version` を更新し、対象論文を再チャンク・再索引する。

---

## 7. 引用解決と引用グラフ

### 7.1 名寄せ手順

1. DOIの正規化・完全一致
2. OpenAlex ID等の外部識別子一致
3. タイトル正規化＋著者＋年による候補抽出
4. OpenAlex、Crossref等の外部候補取得
5. `PaperMatcher` によるスコアリング
6. 閾値以上は自動解決、中間帯は要確認、閾値未満は未解決

あいまい一致の閾値、使用特徴量、モデル／アルゴリズムのバージョンを解決記録へ保存する。

### 7.2 重複統合

DOI重複や同一論文の別レコードが判明した場合、`mergePapers` ユースケースで統合する。

統合では、引用エッジ、ファイル、要約、外部ID、別名タイトルを正規paperへ移し、旧IDにはリダイレクト情報を保持する。自動物理削除は禁止する。

### 7.3 引用文脈

引用エッジには本文中の文脈を保持する。

- 引用位置の `chunk_id`
- 文または段落の抜粋
- ページ・bbox
- 引用マーカー
- 解決信頼度

### 7.4 グラフ探索

引用系譜、祖先・子孫、合流点の検出は `CitationRepository` のPostgreSQL実装内で再帰CTEを用いる。最大ホップ数と最大ノード数を必須引数とし、無制限探索を禁止する。

---

## 8. LLM層

### 8.1 役割ベースルーティング

呼び出し側はロール名のみを指定する。

```yaml
llm:
  roles:
    summarize:
      provider: anthropic
      model: claude-sonnet-4-6
      mode: batch
    extract_refs:
      provider: ollama
      model: qwen3:14b
    rag_chat:
      provider: anthropic
      model: claude-sonnet-4-6
      mode: stream
    agent:
      provider: agent_sdk
    embed:
      provider: ollama
      model: bge-m3
```

設定で以下も指定する。

- timeout
- maxRetries
- maxOutputTokens
- temperature
- promptVersion
- データ送信可否
- 同時実行数
- 予算上限

### 8.2 ストリーミング

RAGチャットは `Llm.stream()` を使用する。イベントは少なくとも以下を表現する。

```typescript
export type LlmStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "citation"; citation: AnswerCitation }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "completed" }
  | { type: "error"; code: string; message: string };
```

APIはSSEを第一候補とし、双方向のエージェント対話が必要な場合のみWebSocketを使用する。

### 8.3 一括要約

数千本の初期要約はMessage Batches APIを使用する。batchの送信、ポーリング、結果取込を別ジョブとし、プロバイダ側IDをRDBへ保存する。

部分失敗は論文単位で再投入し、バッチ全体を再実行しない。

### 8.4 構造化出力

Zodスキーマを唯一の契約定義とする。

```typescript
export const SummarySchema = z.object({
  researchQuestion: z.string(),
  method: z.string(),
  keyFindings: z.array(z.string()),
  limitations: z.array(z.string()),
  positioning: z.string(),
  keywords: z.array(z.string()),
});
```

構造化出力の検証失敗は、次の順で処理する。

1. 可能ならプロバイダのネイティブ構造化出力を利用
2. Zod検証
3. 検証エラーを添えた修正再生成
4. 上限超過時はジョブ失敗

### 8.5 RAG応答

RAGは以下の段階に分ける。

1. クエリ正規化・必要に応じた日英展開
2. ハイブリッド検索
3. RDBからチャンク原文を再取得
4. 重複除去・論文多様性・年代等による再ランキング
5. コンテキスト構築
6. LLMストリーミング生成
7. 引用検証

回答中の出典は `paper_id`、`chunk_id`、page、bboxを必須とする。検索結果に存在しない出典IDをLLMが生成しても採用しない。

---

## 9. 検索とインデックス管理

### 9.1 インデックス単位

基本単位はチャンクとする。各検索ドキュメントには以下を含める。

- `chunk_id`
- `paper_id`
- title、authors、year、venue、lang
- section title
- chunk text
- page range
- status
- embedding model key
- content hash

### 9.2 検索

`SearchIndex` は検索系操作だけを公開する。

- ハイブリッド検索
- フィルタ
- ファセット
- ページング

`semanticRatio` は0〜1で検証する。既定値は評価で決定し、UI上で調整可能にする。

### 9.3 インデックス管理

`IndexAdmin` は以下を担当する。

- 論文単位のupsert／delete
- 全再構築
- 世代切り替え
- 索引状態の取得
- モデル変更時の再埋め込み

全再構築は新しい索引世代へ書き込み、完了後にエイリアスまたは設定を切り替える。構築途中の索引を本番検索へ公開しない。

### 9.4 埋め込みモデル更新

埋め込みモデル、次元、documentTemplateが変わった場合は別世代として再構築する。`index_generations` に以下を保存する。

- generation ID
- model／revision
- template version
- chunker version
- 開始／完了時刻
- 対象件数／成功件数／失敗件数
- activeフラグ

---

## 10. ジョブキューと承認

### 10.1 ジョブ状態

```text
queued → running → succeeded
              └→ retry_wait → queued
              └→ dead
```

承認待ちはジョブ状態に混在させない。外部取得等は先に `approvals` レコードを作成し、承認後にジョブをenqueueする。

### 10.2 承認状態

```text
pending → approved
        → rejected
        → expired
        → cancelled
```

承認要求には次を保存する。

- action type
- 対象論文・URL
- 理由
- 根拠となる引用文脈
- 想定通信先
- 想定ファイルサイズ／費用（取得可能な場合）
- 作成者（agent／user／system）
- 有効期限

### 10.3 ジョブ取得

PostgreSQL版は `FOR UPDATE SKIP LOCKED` を用いる。`LISTEN/NOTIFY` は即時ウェイクアップの最適化として利用するが、通知欠落に備えて定期ポーリングも行う。

workerはclaim後にheartbeatを更新する。一定時間heartbeatがないrunningジョブはstaleと判定し、再キューする。

### 10.4 冪等性

jobsは `idempotency_key` に一意制約を持つ。キーには入力内容または処理バージョンを含める。

例:

```text
parse:<file_sha256>:parser-v3
index:<paper_id>:<content_hash>:bge-m3-v1
summarize:<paper_id>:<content_hash>:sonnet:<prompt-v2>
```

### 10.5 リトライ

エラーを分類する。

- 一時的: timeout、429、5xx、接続失敗
- 恒久的: 不正PDF、スキーマ不整合、権限拒否
- 要確認: 名寄せ競合、低品質抽出

一時的エラーのみ指数バックオフで自動再試行する。`Retry-After` がある場合は優先する。

### 10.6 graphile-workerの扱い

初期実装は独自jobsテーブルを採用する。ただし次の条件を満たせない場合はgraphile-workerへ切り替える。

- stale回収、heartbeat、バックオフ、監視の実装コストが過大
- 運用試験で重複実行や取りこぼしが発生
- SQLite対応を正式要件から外せる

承認はどちらの場合も別テーブル・別ユースケースで管理する。

---

## 11. エージェント

### 11.1 ツール定義

エージェントツールはユースケースの薄いラッパとし、Zodスキーマは `packages/contracts` から利用する。

```typescript
const searchChunks = tool(
  "search_chunks",
  "ハイブリッド検索を実行する",
  SearchChunksInputSchema.shape,
  async (args) => toToolResult(await usecases.hybridSearch(args)),
);
```

ツール内でDBや外部APIを直接呼び出さない。

### 11.2 権限モデル

ツールを次に分類する。

| 分類 | 例 | 方針 |
|---|---|---|
| 読み取り | search、getPaper、traceLineage | 事前許可可能 |
| ローカル変更 | summarize、reindex | ユーザー設定または操作単位で許可 |
| 外部通信 | resolve、findOaPdf | 宛先と目的を監査ログへ記録 |
| 外部取得 | downloadAndIngest | 毎回人間承認 |
| 破壊的操作 | delete、purge | エージェントへ公開しない |

### 11.3 暴走防止

- `maxTurns`
- 最大ツール呼び出し数
- 最大探索ホップ数
- 最大取得候補数
- 実行時間上限
- API費用／トークン上限
- 同一ツール・同一引数の反復検知
- 承認待ち中の自動継続禁止

### 11.4 監査ログ

全ツール呼び出しについて以下を記録する。

- session／run ID
- actor（user、agent、system）
- model／provider
- tool name
- 検証済み引数（秘密情報はマスク）
- 結果の要約、成功／失敗
- 開始・終了時刻、duration
- token usage／推定費用
- 関連approval ID／job ID

モデルの非公開推論過程や内部思考を保存対象にしない。プロンプト全文の保存は設定で制御し、PDF本文やAPIキーが不要に監査ログへ複製されないようにする。

### 11.5 ローカルLLMエージェント

ローカルLLMは検索1〜2回と回答生成程度の浅いループに限定する。深い調査、外部取得候補の選定、複数段階の探索はClaude側エージェントに任せる。

---

## 12. 時系列分析

第一段階では以下を提供する。

1. 年別facet分布
2. 年代フィルタ付き検索と構造化要約による変遷要約
3. 引用系譜の年次グラフ表示

時系列要約では、各主張がどの年代・論文集合に基づくかを保持する。

トピックモデリング等のPython優位な処理は、必要時にPythonサイドカーを呼び出すジョブとして追加する。TSコアにPythonライブラリ依存を漏らさない。

---

## 13. API・UI

### 13.1 API原則

- 入出力はZodで検証する
- エラー形式を統一する
- 長時間処理はジョブIDを返す
- RAGはSSEで逐次返却する
- UIへ内部DB例外・外部API秘密情報を返さない
- PDF配信はローカル認証済みAPI経由とし、任意パス読み取りを禁止する

### 13.2 PDFジャンプ

検索・RAG出典からPDFビューアへ以下を渡す。

- paper ID
- file version
- page
- bbox
- chunk ID

bboxはPDF座標系を正規化し、座標原点・単位・回転を仕様として固定する。

### 13.3 運用画面

最低限、以下を表示する。

- ジョブ一覧、失敗理由、再実行
- 承認待ち一覧
- 索引世代と再構築進捗
- 解析品質が低い論文
- 外部API制限・LLM利用量
- ghostノード候補

---

## 14. セキュリティ・プライバシー

- APIキーは環境変数または秘密管理機構から取得し、DB・ログへ保存しない
- 外部LLMへ送る本文量と対象データを設定で制御する
- ローカル限定モードではクラウドLLMアダプタを起動しない
- ダウンロードURLは許可スキームを `https` に限定し、localhost・プライベートIP等へのSSRFを防止する
- ダウンロードサイズ、MIME、リダイレクト回数を制限する
- PDFは信頼できない入力として扱い、解析プロセスをworkerコンテナ内へ隔離する
- パストラバーサルを防ぎ、保存名は内部生成IDを使用する
- ツール引数と外部レスポンスをログ出力する際は秘密情報をマスクする

---

## 15. 可観測性・運用・復旧

### 15.1 ログとメトリクス

構造化ログへ次を含める。

- request／job／agent run ID
- paper／file ID
- lane、job type、attempt
- 外部サービス名
- duration、result

主要メトリクス:

- ジョブ待ち時間・成功率・dead件数
- PDF解析時間・品質指標
- 検索レイテンシ・ヒット率
- RAGの出典数・引用検証失敗率
- 外部API 429／5xx
- LLMトークン・費用
- 索引件数とRDBチャンク件数の差分

### 15.2 バックアップ

バックアップ対象:

1. PostgreSQL
2. PDF保存ディレクトリ
3. 設定ファイル（秘密情報を除く）

Meilisearchはバックアップ必須とせず、RDBから再構築する。復旧手順は定期的に検証する。

### 15.3 整合性検査

CLIで以下を検査できるようにする。

- `papers.current_file_id` の参照切れ
- chunk件数と索引件数の差
- 存在しないchunkを指すcitation context
- runningのまま停止したjob
- active index generationの不整合
- PDFファイルハッシュ不一致

### 15.4 Meilisearch障害時

1. 検索APIを一時的にdegraded状態へする
2. RDBのactive generationを基準に新規索引を作る
3. 全paper／chunkをバッチ投入する
4. 件数・サンプル検索を検証する
5. active索引を切り替える

---

## 16. テスト戦略

### 16.1 単体テスト

- PaperMatcherの正規化・スコアリング
- チャンク分割
- 状態遷移
- 承認ポリシー
- LLM構造化出力検証
- RAG引用検証

### 16.2 契約テスト

各ポートの共通テストスイートを用意する。

- Repository CRUD・制約
- JobQueueの多重claim防止・stale回収
- SearchIndexのフィルタ・facet
- LLMアダプタのイベント正規化

将来SQLiteを追加する場合、PostgreSQLと同じRepository契約テストを通過させる。

### 16.3 統合テスト

docker compose上で以下を確認する。

- PDF登録から検索可能になるまで
- ghost作成から引用グラフ反映まで
- バッチ要約の部分失敗と再実行
- 承認後のみダウンロードジョブが生成されること
- Meilisearch全削除後の再構築

### 16.4 検索品質評価

日英それぞれの評価クエリと期待論文集合を固定し、以下を比較する。

- keywordのみ
- semanticのみ
- hybridのsemanticRatio別
- chunkサイズ別
- 埋め込みモデル別

Recall@K、MRR、nDCG等と人手評価を用いる。

---

## 17. 開発フェーズ

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| 1 | モノレポ、PostgreSQLスキーマ、各Repository、PDF取り込み、chunk永続化、Meilisearch、JobQueue、CLI | PDF群を取り込み、日英ハイブリッド検索が動き、索引を全再構築できる |
| 2 | 引用解決、PaperMatcher、ghost登録、引用グラフAPI・UI、重複統合 | 引用ネットワークが可視化され、系譜追跡と名寄せ確認ができる |
| 3 | 構造化要約、バッチ処理、RAGストリーミング、出典ジャンプ、時系列分析 | 根拠付き質問応答と年代分析が実用になる |
| 4 | Agent SDK、Approval、監査ログ、取得候補提示、承認後取り込み | 承認付きでコーパスが自己拡張する |
| 5 | 運用強化、バックアップ、整合性検査、必要ならSQLite／graphile-worker評価 | 復旧手順と運用監視が確立する |

フェーズ1ではPostgreSQLのみを正式対象とする。

---

## 18. 未決事項

### 18.1 フェーズ1で決める

- チャンク長・オーバーラップ・見出し結合規則
- bge-m3の具体的なMeilisearch設定とdocumentTemplate
- GROBID品質閾値と日本語フォールバック条件
- 検索品質評価セット
- PDF bboxの正規化方式
- authorsをJSONで開始するか正規化テーブルにするか

### 18.2 フェーズ2〜3で決める

- PaperMatcherの特徴量・閾値・確認UI
- 構造化要約プロンプトと品質評価
- RAG再ランキング方式
- 回答引用の表示粒度
- ghostノードの取得優先度スコア
- 有料論文ghostを分析へ含める範囲

### 18.3 フェーズ4以降で決める

- Agent SDKの具体的な権限コールバック設計
- 取得候補1件あたりのコスト／サイズ表示
- graphile-worker採用可否
- SQLite正式対応の必要性
- Bun移行可否
- Web UIフレームワーク
- Pythonサイドカーの実行方式

---

## 19. 受入基準

初期実用版は以下を満たすこと。

1. 1,000本規模のPDFを再実行可能なジョブとして取り込める。
2. 日本語クエリから英語論文、英語クエリから日本語論文を検索できる。
3. 検索結果からRDB上のチャンク原文とPDF該当箇所へ到達できる。
4. Meilisearchのデータを削除してもRDBから全再構築できる。
5. 同一ジョブの重複投入・複数workerによる二重claimを防止できる。
6. RAG回答の出典が実在する検索チャンクに限定される。
7. 外部PDF取得は承認なしに実行されない。
8. 全エージェントツール呼び出しが監査可能である。
9. PDF差し替え、モデル変更、プロンプト変更時に旧成果物を追跡できる。
10. PostgreSQLとPDF原本のバックアップから復旧できる。
