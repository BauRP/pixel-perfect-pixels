<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep document and component layout LTR for all languages; apply Arabic RTL direction only to text-bearing leaves and text inputs so controls never mirror.
- Native ad retries use backoffDelay() in src/lib/backoff.ts; the only ad module is src/lib/native-ads.ts (no banner) — one place for ad timing and IDs.
