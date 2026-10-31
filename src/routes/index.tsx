import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, ScreenHeader } from "@/components/AppShell";
import { NativeAdTile } from "@/components/NativeAdTile";
import { useT } from "@/lib/i18n";
import { deviceScan, useDeviceScan, type ScannedAlbum } from "@/lib/device-scan";
import { Loader2, Play, ImagePlus } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { mediaAccessCopy } from "@/lib/media-access-copy";
import { useEffect, useMemo, useRef, useState } from "react";
import { ViewOptionsMenu } from "@/components/ViewOptionsMenu";
import { useViewPrefs, sortRows } from "@/lib/view-prefs";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gallery — Vault" },
      { name: "description", content: "Browse every photo and video stored on your device, grouped by album." },
      { property: "og:title", content: "Gallery — Vault" },
      { property: "og:description", content: "Browse every photo and video stored on your device, grouped by album." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GalleryIndex,
});

type Filter = "all" | "photo" | "video";

function GalleryIndex() {
  const t = useT();
  const albums = useDeviceScan((s) => s.albums);
  const scanning = useDeviceScan((s) => s.scanning);
  const scanned = useDeviceScan((s) => s.scanned);
  const mediaPermission = useDeviceScan((s) => s.mediaPermission);
  const [lang] = useLang();
  const mediaText = mediaAccessCopy[lang];
  const bootstrapped = useRef(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    if (typeof window === "undefined") return;
    // Always trigger a scan on mount. Object URLs, in-memory File handles
    // and (on Android) MediaStore permission grants do NOT survive an app
    // process kill or system-reclaimed restart, so rescan every cold-start
    // to rebuild `albums` — otherwise re-opening the app after a swipe
    // leaves the gallery empty.
    void deviceScan.scan();

    // Re-scan whenever the app comes back to the foreground. This mirrors
    // Android's onResume() lifecycle hook — permission grants and newly
    // captured media are picked up immediately on return.
    // Debounced + coalesced in deviceScan so focus/visibility/pageshow bursts
    // (e.g. closing the permission dialog) produce a single scan.
    const onVisible = () => deviceScan.requestRescan();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, []);

  // Apply strict kind-filter inside each folder. "all" keeps every item.
  const filteredAlbums: ScannedAlbum[] = useMemo(() => {
    if (filter === "all") return albums;
    const kind = filter === "photo" ? "image" : "video";
    return albums
      .map((a) => ({ ...a, items: a.items.filter((i) => i.kind === kind) }))
      .filter((a) => a.items.length > 0);
  }, [albums, filter]);

  const [prefs] = useViewPrefs("folders");

  // Real Array.prototype.sort() over the album list. Folders carry no date
  // of their own, so they inherit it from their newest / oldest member.
  const sortedAlbums: ScannedAlbum[] = useMemo(() => {
    const rows = filteredAlbums.map((a) => {
      const times = a.items.map((i) => i.mtime).filter((n) => Number.isFinite(n));
      return {
        album: a,
        name: a.name,
        createdAt: times.length ? Math.min(...times) : 0,
        mtime: times.length ? Math.max(...times) : 0,
        size: a.items.reduce((sum, i) => sum + (i.size ?? 0), 0),
      };
    });
    return sortRows(rows, prefs.field, prefs.dir).map((r) => r.album);
  }, [filteredAlbums, prefs.field, prefs.dir]);

  const showEmpty = scanned && filteredAlbums.length === 0;

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: t("filter_all") },
    { id: "photo", label: t("filter_photo") },
    { id: "video", label: t("filter_video") },
  ];

  return (
    <AppShell>
      {/* Header + filter tabs are one static block pinned to the app frame. */}
      <div data-sticky-header className="sticky top-0 z-40 shrink-0 glass-strong pb-2">
        <div className="relative">
          <ScreenHeader title={t("gallery")} />
          <div className="absolute right-4 top-1/2 z-50 -translate-y-1/2">
            <ViewOptionsMenu scope="folders" />
          </div>
        </div>

        {/* Segmented sub-header */}
        <div className="px-4 pt-2">
          <div
            className="flex gap-1 rounded-xl p-0.5"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
            role="tablist"
          >
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.id)}
                  className="flex-1 rounded-lg py-1 text-[11px] font-semibold transition-colors"
                  style={{
                    background: active ? "var(--color-accent)" : "transparent",
                    color: active
                      ? "var(--color-accent-foreground)"
                      : "var(--color-muted-foreground)",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {(mediaPermission === "partial" || mediaPermission === "denied") && (
        <div className="mx-4 mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface p-3">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {mediaPermission === "partial" ? mediaText.partial : mediaText.denied}
          </span>
          <button type="button" disabled={scanning}
            onClick={() => void deviceScan.changeMediaAccess()}
            className="tap inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-50">
            <ImagePlus size={16} />
            {mediaText.change}
          </button>
        </div>
      )}
      {/* Folder grid. */}
      <FolderGrid albums={showEmpty ? [] : sortedAlbums} filter={filter} columns={prefs.columns} />
      {showEmpty ? (
        <div className="pt-16 flex justify-center px-8">
          <p className="text-sm text-muted-foreground">{t("nothing_found")}</p>
        </div>
      ) : albums.length === 0 && scanning ? (
        <div className="pt-16 flex justify-center">
          <Loader2 size={22} className="animate-spin text-muted-foreground" />
        </div>
      ) : null}
    </AppShell>
  );
}

function FolderGrid({
  albums, filter, columns,
}: { albums: ScannedAlbum[]; filter: Filter; columns: number }) {
  const t = useT();
  const dense = columns >= 4;
  return (
    <div
      className="px-4 pt-4 grid adaptive-folder-grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: columns >= 4 ? "0.5rem" : columns === 3 ? "0.625rem" : "0.75rem",
      }}
    >
      <NativeAdTile key="ad-slot" columns={columns} />
      {albums.map((f, i) => {
        const previews = f.items.slice(0, 4);
        return (
          <Link
            key={f.id}
            to="/gallery/$folder"
            params={{ folder: f.id }}
            search={{ filter }}
            className={`group transition-transform active:scale-[0.98] animate-fade-up ${dense ? "rounded-2xl p-1.5" : "rounded-3xl p-3"}`}
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              animationDelay: `${Math.min(i, 12) * 40}ms`,
            }}
          >
            <div className={`grid grid-cols-2 gap-1 overflow-hidden aspect-square ${dense ? "rounded-xl" : "rounded-2xl"}`}>
              {previews.map((p) => (
                <div
                  key={p.id}
                  className="relative w-full h-full"
                  style={{ background: "var(--color-muted)" }}
                >
                  {p.kind === "image" ? (
                    <img
                      src={p.url}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center">
                      <Play size={16} className="text-white/90" fill="currentColor" />
                    </span>
                  )}
                </div>
              ))}
              {Array.from({ length: Math.max(0, 4 - previews.length) }).map((_, k) => (
                <div
                  key={k}
                  className="w-full h-full"
                  style={{ background: "var(--color-muted)" }}
                />
              ))}
            </div>
            <div className={dense ? "mt-1.5" : "mt-3"}>
              <div className={`truncate font-semibold ${dense ? "text-[11px]" : "text-sm"}`}>{f.name}</div>
              <div className={`text-muted-foreground ${dense ? "text-[9px]" : "text-[11px]"}`}>
                {f.items.length} {t("items")}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
