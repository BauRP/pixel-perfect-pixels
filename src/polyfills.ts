/**
 * Legacy Android WebView polyfills.
 *
 * Loaded as the VERY FIRST import of the client entry (`src/router.tsx`) so
 * every subsequent module — including third-party libraries — sees the
 * patched globals. Android 9 ships Chrome 74 WebView which lacks several
 * ES2020+ String / Array prototype methods; esbuild's `target: es2019` only
 * down-levels syntax, it does NOT inject runtime polyfills for instance
 * methods, so we install them by hand here.
 *
 * Every patch is idempotent (`if (!Proto.method)`) so modern WebViews are
 * left untouched.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

(function installLegacyPolyfills() {
  if (typeof globalThis === "undefined") return;

  const S = (globalThis as any).String;
  if (S && S.prototype) {
    // String.prototype.replaceAll — ES2021, missing in Chrome <85.
    if (typeof S.prototype.replaceAll !== "function") {
      Object.defineProperty(S.prototype, "replaceAll", {
        configurable: true,
        writable: true,
        value: function replaceAll(
          this: string,
          search: any,
          replacement: any,
        ): string {
          if (this == null) {
            throw new TypeError(
              "String.prototype.replaceAll called on null or undefined",
            );
          }
          const str = String(this);

          // RegExp branch — must be a global RegExp per spec.
          if (search instanceof RegExp) {
            if (!search.flags.includes("g")) {
              throw new TypeError(
                "String.prototype.replaceAll called with a non-global RegExp argument",
              );
            }
            return str.replace(search, replacement);
          }

          const searchStr = String(search);
          // Empty search string: mirror native behaviour (insert between every char).
          if (searchStr === "") {
            if (typeof replacement === "function") {
              let out = "";
              for (let i = 0; i <= str.length; i++) {
                out += replacement("", i, str);
                if (i < str.length) out += str.charAt(i);
              }
              return out;
            }
            const rep = String(replacement);
            return rep + str.split("").join(rep) + rep;
          }

          if (typeof replacement === "function") {
            let out = "";
            let last = 0;
            let idx = str.indexOf(searchStr);
            while (idx !== -1) {
              out += str.slice(last, idx);
              out += String(replacement(searchStr, idx, str));
              last = idx + searchStr.length;
              idx = str.indexOf(searchStr, last);
            }
            return out + str.slice(last);
          }

          // split/join is the safe, spec-close path for plain string replacement.
          return str.split(searchStr).join(String(replacement));
        },
      });
    }

    // String.prototype.at — ES2022, missing in Chrome <92.
    if (typeof S.prototype.at !== "function") {
      Object.defineProperty(S.prototype, "at", {
        configurable: true,
        writable: true,
        value: function at(this: string, index: number): string | undefined {
          const str = String(this);
          const n = Math.trunc(Number(index)) || 0;
          const i = n < 0 ? str.length + n : n;
          if (i < 0 || i >= str.length) return undefined;
          return str.charAt(i);
        },
      });
    }
  }

  const A = (globalThis as any).Array;
  if (A && A.prototype) {
    // Array.prototype.at — ES2022, missing in Chrome <92.
    if (typeof A.prototype.at !== "function") {
      Object.defineProperty(A.prototype, "at", {
        configurable: true,
        writable: true,
        value: function at(this: any[], index: number) {
          const len = this.length >>> 0;
          const n = Math.trunc(Number(index)) || 0;
          const i = n < 0 ? len + n : n;
          if (i < 0 || i >= len) return undefined;
          return this[i];
        },
      });
    }
  }

  // Object.hasOwn — ES2022, missing in Chrome <93.
  const O = (globalThis as any).Object;
  if (O && typeof O.hasOwn !== "function") {
    Object.defineProperty(O, "hasOwn", {
      configurable: true,
      writable: true,
      value: function hasOwn(target: any, prop: PropertyKey): boolean {
        if (target == null) {
          throw new TypeError(
            "Object.hasOwn called on null or undefined",
          );
        }
        return Object.prototype.hasOwnProperty.call(Object(target), prop);
      },
    });
  }
})();

export {};