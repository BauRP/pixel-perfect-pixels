# AGENTS2.md — постоянные инструкции разработки Nova Gallery

> **При каждом запросе по проекту читать:** [PROGRESS.md](./PROGRESS.md) → [AGENTS.md](./AGENTS.md) → **AGENTS2.md**. Если инструмент автоматически открывает только `AGENTS.md`, явно прочитать этот файл. Не перечитывать весь репозиторий без причины.
>
> **КРИТИЧЕСКОЕ ТРЕБОВАНИЕ ВЛАДЕЛЬЦА:** после **КАЖДОГО** запроса по Nova Gallery, даже информационного и даже без напоминания, обновить существующий `PROGRESS.md` прямо в GitHub. Отражать лишь подтверждённые факты; без изменения кода — записать это и оставить % без повышения. Сам `AGENTS2.md` править только при изменении постоянных правил или технологий.
>
> **Сохранность инструкций:** корневой `AGENTS.md` принадлежит Lovable и содержит управляемый блок `LOVABLE:BEGIN/END`. **Не изменять и не заменять его.** По проверенной структуре 2026-11-06 вложенных `AGENTS.md` нет; при их появлении учитывать область действия. Не писать противоречащие инструкции и не дублировать этот документ.

## 1. Паспорт и границы

- **Репозиторий:** `BauRP/pixel-perfect-pixels`, **только ветка:** `chatgpt/nova-gallery-android7-17-fixes-20261031`; `main` без разрешения не менять. Приложение `Nova Gallery`, ID `app.lovable.privacygallery`.
- **Стек:** TypeScript + React 19, TanStack Router/Start, Vite 8, Tailwind 4, Capacitor 8, нативные плагины Java, Gradle, Bun, Vitest.
- **Production Android SDK:** `android/variables.gradle`: min 24, compile 36, target 36. Отдельный эксперимент API37 компилируется через CI, **Android 17 runtime не сертифицирован**. `vite.android.config.ts`: Android SPA с target `chrome69`; Web SSR не заменять Android-сборкой.
- Галерея локальная; медиа через Android MediaStore, ciphertext «Сейфа» в приватной `nova_vault`. AdMob/UMP работают отдельно от локальных фото.
- **Источник правды:** прямое требование пользователя → текущий исходный код → CI с SHA → `PROGRESS.md`. Устаревшие `README.md`/`ARCHITECTURE.md` могут противоречить фактическим настройкам.
- Постоянные правила — здесь; **история, ошибки, готовность по направлениям, run IDs, проверенный SHA и очередь задач — только в [PROGRESS.md](./PROGRESS.md)**. Не приписывать пользователю непроверенные требования, не объявлять AI-функции готовыми по одним планам.

## 2. Быстрая карта кода

| Направление | Сначала открыть | Связи и запреты |
|---|---|---|
| WebView boot/чёрный экран | `src/android-client.tsx`, `src/router.tsx`, `src/routes/__root.tsx`, `src/components/AppShell.tsx` | `src/lib/native-startup-state.ts`, `android/app/src/main/java/app/lovable/privacygallery/MainActivity.java`; mounted React ≠ нарисованный экран. |
| Status bar/cutout/gestures/3 buttons/IME | `src/lib/system-insets.ts`, `src/lib/insets-math.ts`, `src/lib/gallery-geometry.ts`, `src/components/BottomNav.tsx` | `SystemInsetsPlugin.java`, `AppShell.tsx`, `src/styles.css`. «Жесты» прежде всего системная навигация Android, не изобретать свайпы галереи. |
| UI/альбомы/редактор | `src/routes/index.tsx`, `src/routes/gallery.$folder.tsx` | `src/lib/device-scan.ts`, `src/lib/thumbnails.ts`, `src/lib/photo-flags.ts`, `src/lib/view-prefs.ts`, `src/components/ViewOptionsMenu.tsx`. |
| Сейф, риск потери данных | `src/lib/vault-store.ts`, `src/lib/vault-transaction.ts`, `src/lib/crypto.ts`, `src/lib/vault-lifecycle.ts` | `src/lib/pin-store.ts`, `src/lib/secure-id.ts`, `src/components/SafePinGate.tsx`, `src/routes/safe.index.tsx`, `src/routes/safe.$folder.tsx`, `src/lib/native-vault.ts` и `SecureVaultPlugin.java`. |
| AdMob/UMP/consent | `src/lib/native-ads.ts`, `src/components/NativeAdTile.tsx` | `src/lib/backoff.ts`, `NativeAdsPlugin.java`, правила в `AGENTS.md`. |
| Настройки/языки | `src/routes/settings.tsx`, `src/lib/i18n.ts`, `src/lib/theme.ts` | `src/lib/locales/*.ts`, `src/styles.css`. LTR controls; арабский RTL только у текста по `AGENTS.md`. |
| Сборка | `package.json`, `vite.android.config.ts`, `capacitor.config.ts`, `android-index.html`, `scripts/finalize_android_bundle.mjs` | `android/variables.gradle`, `android/build.gradle`, `android/app/build.gradle`, `android/gradle/wrapper/gradle-wrapper.properties`. |
| CI/эмуляторы | `.github/workflows/build.yml`, `.github/workflows/android-device-smoke.yml`, `.github/workflows/android-api37-probe.yml` | `scripts/run_android_emulator_tests.sh`, `scripts/emulator_navigation_smoke.sh`, `scripts/summarize_android_diagnostics.py`, `scripts/ValidateScreenshot.java`, `android/app/src/androidTest/java/app/lovable/privacygallery/AndroidCompatibilitySmokeTest.java`. |

**Не править генерируемое вручную:** `src/routeTree.gen.ts`, `dist/`, `node_modules/`, `android/app/build/`, кэш `android/.gradle/` и управляемые выходы генераторов. Изменения native plugin делаются в исходных Java, а не в бинарных артефактах.

## 3. Алгоритм работы и GitHub

1. Прочитать краткую сводку/проблемы/следующий шаг из `PROGRESS.md`; затем применимые AGENTS. Проверить актуальный HEAD, сравнить с последним проверенным **кодовым** коммитом. Открывать **только отличающиеся и связанные файлы**.
2. Сначала P0: зависания, невозможность открыть галерею, потеря данных/безопасность. Разделить подтверждённую причину и гипотезу; создать минимальное воспроизведение/тест. Объединить близкие задачи в максимально полезный законченный пакет.
3. Править локально и в существующей архитектуре, переиспользовать компоненты. Не добавлять новые библиотеки/модели без оценки лицензии, Android 7, памяти, размера APK и поддержки. При изменении native bridge, persistent schema, CSS-переменных или типов проверить всех потребителей.
4. В ходе работы запускать быстрые **относящиеся к изменению** проверки; после крупного пакета — все доступные модульные тесты и **одну полноценную APK-сборку**. При failure исправить первопричину и повторить. Описывать только результаты реального выполнения.
5. Перед записью проверить HEAD, не затереть изменения Lovable/других ИИ. Коммитить логическими пакетами только в рабочую ветку. Запрещены `force push`/amend/rebase опубликованной истории и работа в `main` без разрешения. GitHub-подтверждения «Разрешить один раз» не равны «Всегда разрешать».
6. **После каждого запроса** обновить в ветке один `PROGRESS.md`; проверить запись через GitHub. При изменении кода указать SHA, тесты, новые проблемы, % и следующий шаг; при вопросе без кода — краткую датированную запись и неизменный %. Документальный коммит сам по себе не повод запускать дополнительную APK-сборку; Actions могут стартовать автоматически.
7. Если одна задача заблокирована, зафиксировать причину и перейти к независимой; не останавливаться после одного мелкого исправления и не обещать фоновое выполнение.

## 4. Точные проверки и сборки

**Быстрые/адресные (выбирать по изменениям):**
```bash
bun install
bunx vitest run src/lib/vault-store.concurrent.test.ts
bunx vitest run src/lib/gallery-geometry.test.ts src/lib/insets-math.test.ts
python3 -m unittest discover -s scripts -p 'test_android_diagnostics.py'
python3 scripts/check_legacy_webview.py
python3 scripts/check_android_compat.py
bash -n scripts/emulator_navigation_smoke.sh scripts/run_android_emulator_tests.sh
bun run lint
```

**Полный пакет после существенного изменения:**
```bash
bunx vitest run
bun run build:capacitor
cd android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest --stacktrace --no-daemon
```

Эти команды существуют в `package.json`/Actions; **их успех не подразумевается**. `bun run lint` и проверки типов документировать отдельно по факту. `.github/workflows/build.yml` собирает debug APK и unit tests; `android-device-smoke.yml` проверяет API24/26/29/33/34/36 + AOSP 29/33, отдельный `workflow_dispatch` включает API24–37; `android-api37-probe.yml` временно собирает API37, не меняя production SDK36. Применять существующие Bun/Gradle cache; не скачивать одинаковые артефакты вручную.

**Реальный Android PASS** требует успешного Java instrumentation и читаемых скриншотов + корректного foreground/insets, **не** просто загрузки JS/React или успешной компиляции. API29/33 blank и API34 wrong foreground были зафиксированы в [PROGRESS.md](./PROGRESS.md) как нерешённые. `cancel-in-progress: true` в CI может отменить прогон следующим push; избегать дробных коммитов во время критической матрицы. `cancelled`/`pending`/`skipped` ≠ `success`.

## 5. Надёжность, безопасность и стиль

- **Сейф:** не удалять исходный файл до подтверждённого зашифрованного импорта/сохранения индекса; не заменять повреждённую metadata пустой; при lock/ошибке/удалении папки отменять незавершённые импорты. Не ослаблять `keyEpoch`, `requireUnlockedSafe`, `commitStateAfterPersistence`, строгие private blob paths и CSPRNG `createSecureId`. PIN и ключ не сохраняются в журналах.
- **Android UI:** учитывать реальный WindowInsetsCompat, gesture/3-button, вырезы, смену ориентации/размера/плотности и IME. Не делать двойной bottom padding. Не скрывать работающий UI непрозрачным loader; ограничивать retry/observers; освобождать timers, object URLs, video resources. Software-renderer workaround для API29/33 сейчас ограничен **эмуляторами**, не переносить на настоящие телефоны без проверки.
- **Реклама:** сохранить Native Advanced в первом слоте без баннеров и full-screen форматов; UMP `canRequestAds()` обязателен, consent pending — не ошибка для backoff. Debug/test unit и release/production выбираются по `BuildConfig.USE_TEST_ADS`, не по произвольному debuggable признаку.
- **Код:** использовать текущие React hooks и `useSyncExternalStore` с **стабильным cached snapshot**; соблюдать существующие TypeScript camelCase/PascalCase и Java naming, не проводить массовое форматирование. При ошибках логировать код/тип без содержимого пользовательских медиа и секретов. Не выдумывать реализацию, тест, процент или утверждённый дизайн.
- **Безопасность:** никакие токены, пароли, keystore, приватные фото и идентифицирующие пути в Git/CI/журнал; не отключать защиту и не удалять файлы пользователя ради тестов. При новых зависимостях учитывать безопасность и лицензии.
- **Оценки:** готовность повышать только по реальному реализованному и автоматически проверенному коду. Установка APK на телефон владельца — отдельная пользовательская проверка, **не** незавершённая программная задача.

## 5.1. Ссылки после каждого выполнения (требование владельца от 2026-11-13)

- В **самом конце каждого отчёта по выполненной работе** обязательно показывать ссылку на конкретные изменения в GitHub (коммит или согласованная рабочая ветка) и **действующую кнопку «Скачать APK»**, открывающую прямую ссылку реально опубликованной APK в GitHub Releases.
- Если после работы новая APK ещё не опубликована, честно указывать номер **последней доступной** APK; не выдавать прежнюю сборку за новую и не показывать недействующую кнопку.
- Отчёт и ссылки держать краткими, доступными человеку без технического опыта. Ни одна документационная правка сама по себе не требует лишней APK-сборки; основная ветка `main` не затрагивается.

## 6. Как мы работаем по всем направлениям

> **Ниже дословный обязательный текст владельца от 2026-11-06, без сокращений и переформулирования.**

Возьми максимум работы по всем направлениям проекта и делай по этому правилу:

1. Не перечитывай весь проект, если нужный контекст уже известен. Изучай только необходимые файлы и связанные участки кода.

2. Не запускай отдельную APK-сборку после каждого мелкого изменения. Объединяй изменения в крупные логические пакеты.

3. Самостоятельно объединяй взаимосвязанные задачи в крупные блоки. Выполняй максимально большой объём реальной разработки за один запуск.

4. Сначала занимайся наиболее незавершёнными направлениями и отсутствующими функциями. Критические ошибки, зависания, безопасность и риск потери данных имеют наивысший приоритет.

5. Не трать время на длинные промежуточные отчёты. Кратко сообщай о существенном прогрессе, но основное время уделяй коду.

6. После каждого крупного пакета обязательно проводи автоматические тесты и полноценную сборку приложения. Если проверки выявили ошибки, исправляй их и повторяй.

7. Показывай готовность каждого направления, прирост в процентах или долях процента и общую готовность. Повышай показатели только за реально выполненную и проверенную работу.

8. Если одна задача заблокирована, не зацикливайся. Переходи к другим доступным направлениям.

9. Не останавливайся после первого успешно выполненного блока. Последовательно переходи к следующему, пока позволяют инструменты и ограничения текущего запуска.

10. Сохраняй изменения только в согласованной рабочей ветке GitHub. Не трогай main без моего разрешения.

11. Не включай в незавершённую программную работу действия, которые технически не можешь выполнить, например установку APK на мой телефон. Завершай доступную работу в коде, проводи автоматические проверки и сборку. Проверки, которые должен сделать я, указывай отдельно, не снижая из-за них процент готовности программной части.

Главная цель: максимальное количество полностью реализованных и автоматически проверенных функций за один запуск, а не максимальное количество коммитов, отчётов или мелких исправлений.
