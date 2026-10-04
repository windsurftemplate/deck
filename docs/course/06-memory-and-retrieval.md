# 6. Memory and retrieval

**You will learn:** the kinds of agent memory, embeddings and vector search, keyword search, hybrid ranking, graph links, chunking documents, write discipline, and how deck stores it all.

## Why memory is a harness problem

The model remembers nothing between requests (chapter 2). Memory is a system you build: storage, a way to choose what to recall, and rules for what to save. Done badly, it fills the context with noise or, worse, confidently stale facts.

## Kinds of memory

| Kind | What it holds | deck |
|---|---|---|
| **Working** | The current conversation and task state | Chat history per thread, task brief |
| **Semantic** | Facts about the world and the user | `facts` table, with stated or inferred source |
| **Episodic** | What happened, when | `episodes` table |
| **Procedural** | How to do things | Skills, learned guidance |
| **Documents** | Source material | Second brain documents and passages |

## Embeddings and vector search

An **embedding** is a list of numbers (a vector) that represents meaning. Texts with similar meaning get vectors that point in similar directions. deck's default embedding model, all-MiniLM-L6-v2, produces 384 numbers per text and runs locally.

To search by meaning: embed the query, then find stored vectors closest to it (by cosine similarity or distance). This finds "who handles Acme's security?" even if the stored fact says "Dana Wright is the CISO at Acme Corp".

At large scale, systems use approximate nearest-neighbour indexes (such as HNSW) to avoid comparing against every vector. At personal scale, an exact comparison is fast enough; deck uses sqlite-vec inside the same encrypted SQLite file.

Embeddings have weaknesses: they can miss exact names, numbers and rare terms, and they blur negation.

## Keyword search

Full-text search (deck uses SQLite FTS5 with BM25 ranking) finds exact words and names. It is precise where embeddings are fuzzy, and fuzzy where embeddings are precise.

## Hybrid ranking with RRF

deck runs both searches and merges them with **reciprocal rank fusion**: each result scores `1 / (k + rank)` in each list (k is a constant, commonly 60), and scores add up. Items found by both methods rise to the top. RRF needs no tuning of score scales, which is why it is a popular default.

Then deck follows **one graph hop**: if a result mentions Acme, related edges (Acme has CISO Dana) are added. Finally, results are trimmed to a **token budget** and given ids so the model can cite them. See `MemoryReader.retrieve` in `packages/memory/src/read.ts`.

## Documents and chunking

Long documents are split into **chunks** (passages) before embedding, because one vector cannot represent a long document well and the model only needs the relevant part. Good chunking:

- splits on paragraph or sentence boundaries;
- keeps chunks a few hundred tokens long;
- overlaps chunks slightly so ideas at a boundary are not lost;
- embeds each chunk with its document title for context.

deck's `chunkText` uses about 1,200 characters with 150 of overlap (`packages/memory/src/docs.ts`). Retrieved passages are wrapped as untrusted data.

This pattern, retrieving passages and adding them to the context, is **retrieval-augmented generation (RAG)**.

## Write discipline

What you save matters as much as how you search. Without rules, memory fills with vague, duplicated and contradictory facts. deck's write gate (`packages/memory/src/write.ts`):

- rejects vague facts ("things are going well");
- drops exact and near duplicates (by vector similarity);
- **supersedes** updates instead of overwriting: the old fact gets an end date, the new one starts, so history is kept;
- sends contradictions to a review queue rather than guessing.

Each fact also records whether it was **stated** by the user or **inferred** by the crew. Stated facts outrank inferred ones.

## Storage ports and migration

deck keeps memory behind a `MemoryStore` interface with two adapters (SQLite and in-memory) that pass the same contract test suite. Swapping storage, or changing the embedding model, runs a migration that re-embeds everything, documents included. Designing storage behind an interface from day one is what makes such changes routine.

## Lab

**Goal:** see hybrid retrieval and write discipline at work.

1. Read `retrieve` in `packages/memory/src/read.ts` and `writeFact` in `packages/memory/src/write.ts`.
2. Run the memory tests and evals:
   ```
   pnpm --filter @deck/memory test
   pnpm --filter @deck/evals test
   ```
3. In the app, tell the crew three facts, including one update ("Dana moved from CISO to CTO"). Ask "what is Dana's role?" and check the answer uses the newest fact.
4. Add a short document in the Brain with a distinctive phrase, then ask about it using different words. Open the Brain map and find it.
5. Write a test in `packages/memory/src/contract.ts` (or a new test) that stores two facts and checks that a keyword-only query and a meaning-only query both find the right one.

## Quiz

```quiz
Q: Why combine vector search with keyword search?
- [ ] Vector search is always wrong
- [x] Each catches what the other misses: meaning versus exact names and numbers
- [ ] Keyword search is cheaper to store
- [ ] Providers require both
> Embeddings find paraphrases; keywords find exact terms. Fusing them improves recall on both.
```

```quiz
Q: In reciprocal rank fusion, what rises to the top?
- [ ] Items with the longest text
- [x] Items ranked well by both search methods
- [ ] Items found only by vector search
- [ ] The newest items
> Each list contributes 1 / (k + rank); items appearing high in both lists collect the most.
```

```quiz
Q: When a fact changes, what does deck's memory do?
- [ ] Overwrites the old fact
- [ ] Keeps both as current facts
- [x] Ends the old fact with a date and starts the new one, keeping history
- [ ] Deletes both and asks the user
> Superseding keeps history (useful for "what did we believe in May?") while making only the newest fact current.
```

```quiz
Q: Why split documents into overlapping chunks?
- [ ] To save disk space
- [x] So each embedding represents a focused passage, and ideas at boundaries are not lost
- [ ] Because models cannot read paragraphs
- [ ] To make documents load faster
> Focused chunks retrieve precisely; overlap protects content that spans a boundary.
```

## Key takeaways

- Memory is a system: storage, recall and write rules.
- Hybrid search (vectors plus keywords, fused with RRF) plus a graph hop is a strong default.
- Chunk documents sensibly and treat retrieved text as untrusted.
- Disciplined writes (reject vague, dedupe, supersede, review conflicts) keep memory trustworthy.
