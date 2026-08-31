// Notion public-page proxy. Fetches recordMap for a public Notion page so we
// can render it in-app via react-notion-x. Returns JSON only (small payload,
// ~30-80 KB per page), unlike pdf-proxy which streams binary.
//
// Why server-side: notion.so/api/v3 does not allow cross-origin requests from
// arbitrary browsers. A 1-shot JSON proxy is the lightest possible bridge.
//
// Endpoint: GET /notion-page?id=<pageId-with-or-without-hyphens>
import { NotionAPI } from "https://esm.sh/notion-client@7.1.5";
import { buildCorsHeaders } from "../_shared/cors.ts";

const PAGE_ID_RE = /^[0-9a-f]{32}$/i;

/** Normalise a page id: strip hyphens, lowercase. */
function normalizeId(raw: string): string | null {
  const stripped = raw.replace(/-/g, "").toLowerCase();
  if (!PAGE_ID_RE.test(stripped)) return null;
  // Notion expects hyphenated UUID form
  return `${stripped.slice(0, 8)}-${stripped.slice(8, 12)}-${stripped.slice(12, 16)}-${stripped.slice(16, 20)}-${stripped.slice(20)}`;
}

const notion = new NotionAPI();

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const rawId = url.searchParams.get("id");
    if (!rawId) {
      return new Response(JSON.stringify({ error: "missing id param" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const pageId = normalizeId(rawId);
    if (!pageId) {
      return new Response(JSON.stringify({ error: "invalid page id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let recordMap;
    try {
      recordMap = await notion.getPage(pageId);
    } catch (pageErr) {
      // notion-client throws "Notion page not found" both for a wrong id and
      // for a page that exists but was never published to the web. Probe
      // Notion for the public access role so we can tell the user which one
      // it is instead of bubbling up an opaque 502 + blank screen.
      let role = "unknown";
      try {
        const probe = await fetch("https://www.notion.so/api/v3/getPublicPageData", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "block-space",
            blockId: pageId,
            name: "page",
            saveParent: false,
            showMoveTo: false,
          }),
        });
        const json = await probe.json().catch(() => ({}));
        role = (json as { publicAccessRole?: string })?.publicAccessRole ?? "unknown";
      } catch { /* keep role unknown */ }

      console.warn("[notion-page] getPage failed", pageId, "publicAccessRole:", role, pageErr);
      const notPublic = role === "none" || role === "unknown";
      return new Response(
        JSON.stringify({
          error: notPublic
            ? "This Notion page is not shared publicly. Open it in Notion → Share → Publish to web, then paste the published link."
            : "Notion page not found.",
          code: notPublic ? "notion_not_public" : "notion_not_found",
          pageId,
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Backfill any block ids that are referenced anywhere in the recordMap
    // (content arrays, collection_query rows, format covers, subpage links,
    // synced-block source ids, etc.) but weren't returned by getPage. The
    // previous version only scanned `value.content`, which is why DPP /
    // Notes pages that store children inside collections (database views)
    // kept logging "missing block 36d8ce59-…" and rendered blank.
    //
    // Strategy: regex every 32-hex UUID out of the serialized recordMap,
    // diff against known block ids, fetch the missing ones in chunks of 100
    // (Notion's per-call cap), and loop a few passes because newly fetched
    // blocks may themselves reference more children.
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    try {
      for (let pass = 0; pass < 4; pass += 1) {
        const known = new Set(Object.keys(recordMap.block || {}));
        // Serialize once per pass. ~50-200KB; cheap compared to a getBlocks RTT.
        const serialized = JSON.stringify(recordMap);
        const referenced = new Set<string>();
        for (const match of serialized.matchAll(UUID_RE)) {
          referenced.add(match[0].toLowerCase());
        }
        const missing = [...referenced].filter((id) => !known.has(id));
        if (missing.length === 0) break;
        // Notion getBlocks is capped at 100 ids per call.
        for (let i = 0; i < missing.length; i += 100) {
          const chunk = missing.slice(i, i + 100);
          const fetched = await notion.getBlocks(chunk);
          Object.assign(recordMap.block, fetched.recordMap.block);
        }
      }
    } catch (backfillErr) {
      console.warn("[notion-page] backfill failed", backfillErr);
    }

    // ── Database (collection) hydration ─────────────────────────────────
    // Pages built out of Notion databases (Zoology / DPP indexes) carry
    // dozens of `collection_view` blocks. `getPage` only hydrates the
    // collections reachable from the first chunk, and the UUID back-fill
    // above restores blocks but never `collection` / `collection_view` /
    // `collection_query` records — so those databases render as nothing.
    // Fetch the missing collection metadata + rows ourselves, under a hard
    // budget so a page with 80 databases still answers inside the function
    // timeout.
    const COLLECTION_DEADLINE_MS = 20_000;
    const MAX_VIEWS = 40;
    const startedAt = Date.now();
    try {
      recordMap.collection = recordMap.collection ?? {};
      recordMap.collection_view = recordMap.collection_view ?? {};
      recordMap.collection_query = recordMap.collection_query ?? {};

      // 1. Find every (collectionId, viewId) pair referenced by the page.
      const pairs: { collectionId: string; viewId: string }[] = [];
      for (const entry of Object.values(recordMap.block ?? {})) {
        const raw = (entry as { value?: unknown })?.value as Record<string, unknown> | undefined;
        const value = ((raw as { value?: Record<string, unknown> })?.value ?? raw) as
          | Record<string, unknown>
          | undefined;
        const type = value?.type as string | undefined;
        if (type !== "collection_view" && type !== "collection_view_page") continue;
        const collectionId = value?.collection_id as string | undefined;
        const viewIds = (value?.view_ids as string[] | undefined) ?? [];
        if (!collectionId || viewIds.length === 0) continue;
        // Only the first view of each block is rendered by react-notion-x's
        // default tab, so one query per block keeps the payload sane.
        pairs.push({ collectionId, viewId: viewIds[0] });
      }

      const budgeted = pairs.slice(0, MAX_VIEWS);
      if (budgeted.length > 0) {
        // 2. Pull the collection + collection_view records we don't have.
        const wanted: { table: string; id: string; version: number }[] = [];
        const seen = new Set<string>();
        for (const { collectionId, viewId } of budgeted) {
          if (!recordMap.collection[collectionId] && !seen.has(`c:${collectionId}`)) {
            seen.add(`c:${collectionId}`);
            wanted.push({ table: "collection", id: collectionId, version: -1 });
          }
          if (!recordMap.collection_view[viewId] && !seen.has(`v:${viewId}`)) {
            seen.add(`v:${viewId}`);
            wanted.push({ table: "collection_view", id: viewId, version: -1 });
          }
        }
        for (let i = 0; i < wanted.length; i += 100) {
          if (Date.now() - startedAt > COLLECTION_DEADLINE_MS) break;
          const res = await notion.fetch<{ recordMap?: Record<string, Record<string, unknown>> }>({
            endpoint: "syncRecordValues",
            body: { requests: wanted.slice(i, i + 100) },
          });
          const rm = res?.recordMap ?? {};
          Object.assign(recordMap.collection, rm.collection ?? {});
          Object.assign(recordMap.collection_view, rm.collection_view ?? {});
        }

        // 3. Query the rows for each view.
        for (const { collectionId, viewId } of budgeted) {
          if (Date.now() - startedAt > COLLECTION_DEADLINE_MS) {
            console.warn("[notion-page] collection budget exhausted");
            break;
          }
          const viewEntry = recordMap.collection_view[viewId] as { value?: unknown } | undefined;
          const view = (viewEntry as { value?: { value?: unknown } })?.value;
          const viewValue = ((view as { value?: unknown })?.value ?? view) as
            | Record<string, unknown>
            | undefined;
          if (!viewValue) continue;
          if (recordMap.collection_query[collectionId]?.[viewId]) continue;
          try {
            const data = await notion.getCollectionData(collectionId, viewId, viewValue, {
              limit: 100,
            });
            const rm = ((data as unknown) as { recordMap?: Record<string, Record<string, unknown>> }).recordMap ?? {};
            Object.assign(recordMap.block, rm.block ?? {});
            Object.assign(recordMap.collection, rm.collection ?? {});
            Object.assign(recordMap.collection_view, rm.collection_view ?? {});
            const result = (data as { result?: unknown }).result;
            recordMap.collection_query[collectionId] = {
              ...(recordMap.collection_query[collectionId] ?? {}),
              // deno-lint-ignore no-explicit-any
              [viewId]: result as any,
            };
          } catch (queryErr) {
            console.warn("[notion-page] collection query failed", collectionId, queryErr);
          }
        }
      }
    } catch (collectionErr) {
      console.warn("[notion-page] collection hydration failed", collectionErr);
    }

    // ── Signed file URLs ────────────────────────────────────────────────
    // Notion serves uploaded files (PDF attachments, images) only through
    // short-lived signed URLs. `getPage` returned `signed_urls: {}` for pages
    // that store files in the newer `attachment:<id>:<name>` form, so the PDF
    // a lesson points at rendered as nothing. Sign every file-bearing block
    // ourselves and merge the result back into the recordMap, and surface the
    // PDF/file blocks separately so the client can open them in the normal
    // pdf.js reader instead of an inline embed.
    const FILE_BLOCK_TYPES = new Set(["pdf", "file", "image", "video", "audio"]);
    const EMBED_BLOCK_TYPES = new Set(["external_object_instance", "embed", "bookmark"]);
    const fileBlocks: { id: string; type: string; name: string; source: string }[] = [];
    const embedded: { id: string; name: string; url: string }[] = [];
    for (const [id, entry] of Object.entries(recordMap.block ?? {})) {
      // notion-client wraps values as { value } or { value: { value } }.
      const raw = (entry as { value?: unknown })?.value as
        | { value?: Record<string, unknown> }
        | Record<string, unknown>
        | undefined;
      const value = ((raw as { value?: Record<string, unknown> })?.value ?? raw) as
        | Record<string, unknown>
        | undefined;
      const type = value?.type as string | undefined;
      const props = (value?.properties ?? {}) as Record<string, unknown>;
      const format = (value?.format ?? {}) as Record<string, unknown>;
      if (type && EMBED_BLOCK_TYPES.has(type)) {
        // Notion "embed a Drive/Docs file" blocks keep the real link in
        // `format.original_url` (or `properties.source` for bookmarks).
        const original =
          (format.original_url as string | undefined) ||
          (format.display_source as string | undefined) ||
          (props.source as string[][] | undefined)?.[0]?.[0];
        if (original && /^https?:/i.test(original)) {
          embedded.push({
            id,
            name: (props.title as string[][] | undefined)?.[0]?.[0] ?? "",
            url: original,
          });
        }
        continue;
      }
      if (!type || !FILE_BLOCK_TYPES.has(type)) continue;
      const source = (props.source as string[][] | undefined)?.[0]?.[0];
      if (!source) continue;
      const name = (props.title as string[][] | undefined)?.[0]?.[0] ?? "";
      fileBlocks.push({ id, type, name, source });
    }

    recordMap.signed_urls = recordMap.signed_urls ?? {};
    const needsSigning = fileBlocks.filter(({ source }) =>
      /^attachment:/i.test(source) ||
      /secure\.notion-static\.com|prod-files-secure|file\.notion\.so|s3\.us-west-2\.amazonaws\.com/i.test(source)
    );
    if (needsSigning.length > 0) {
      try {
        const signed = await notion.getSignedFileUrls(
          needsSigning.map(({ id, source }) => ({
            url: source,
            permissionRecord: { table: "block", id },
          })),
        );
        const urls: string[] = signed?.signedUrls ?? [];
        needsSigning.forEach((block, i) => {
          const signedUrl = urls[i];
          if (!signedUrl) return;
          recordMap.signed_urls[block.id] = signedUrl;
          block.source = signedUrl;
          // react-notion-x reads images from `format.display_source`; leaving
          // the raw `attachment:` value there renders a broken image.
          const entry = recordMap.block[block.id];
          const raw = (entry as { value?: unknown })?.value as Record<string, unknown> | undefined;
          const value = ((raw as { value?: Record<string, unknown> })?.value ?? raw) as
            | Record<string, unknown>
            | undefined;
          const fmt = value?.format as Record<string, unknown> | undefined;
          if (fmt && typeof fmt.display_source === "string") fmt.display_source = signedUrl;
        });
      } catch (signErr) {
        console.warn("[notion-page] signing failed", signErr);
      }
    }

    // Blocks the reader can open directly as a document.
    const documents = [
      ...fileBlocks
        .filter((b) => b.type === "pdf" || b.type === "file")
        .map(({ id, name, source }) => ({ id, name, url: source })),
      // Drive / Docs / direct-PDF embeds are documents too — the app's own
      // URL router knows how to turn each of these into PDF bytes.
      ...embedded.filter(({ url }) =>
        /drive\.google\.com|docs\.google\.com|\.pdf(?:[?#]|$)/i.test(url)
      ),
    ];

    return new Response(JSON.stringify({ recordMap, documents }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        // Edge cache: Notion pages change rarely, but signed file URLs expire
        // in ~1 hour, so the cache window must stay well under that.
        "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=900",
        "CDN-Cache-Control": "public, max-age=900, stale-while-revalidate=900",
        "Cache-Tag": `notion:${pageId}`,
      },
    });
  } catch (err) {
    console.error("notion-page error:", err);
    return new Response(JSON.stringify({ error: "Upstream fetch failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// redeploy touch 2026-08-01
