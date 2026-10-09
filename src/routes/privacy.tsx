import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Политика конфиденциальности — Nova Gallery" },
      {
        name: "description",
        content: "Как Nova Gallery обрабатывает медиафайлы, Сейф, рекламу Google AdMob и разрешения устройства.",
      },
      { property: "og:title", content: "Политика конфиденциальности — Nova Gallery" },
      {
        property: "og:description",
        content: "Локальная обработка медиа, шифрование Сейфа, реклама AdMob и обоснование разрешений.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyScreen,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function PrivacyScreen() {
  const router = useRouter();
  const goBack = () => {
    if (window.history.length > 1) router.history.back();
    else void router.navigate({ to: "/settings" });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ paddingTop: "var(--app-safe-top)", background: "var(--color-background)" }}
    >
      <header className="glass-strong flex items-center gap-2 px-3 py-2 shrink-0">
        <button
          onClick={goBack}
          aria-label="Назад"
          className="tap grid h-9 w-9 place-items-center rounded-full"
          style={{ background: "var(--color-muted)" }}
        >
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-base font-semibold">Политика конфиденциальности</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain select-text">
        <article
          className="mx-auto max-w-md space-y-6 px-5 pt-4"
          style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}
        >
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Nova Gallery — офлайн-галерея с личным зашифрованным Сейфом. У приложения нет серверов,
            учётных записей и облачной синхронизации. В этом документе описано, какие данные
            обрабатываются, где они хранятся и зачем приложению нужны разрешения.
          </p>

          <Section title="1. Локальная обработка медиа (Галерея)">
            <p>
              Галерея работает исключительно на вашем устройстве. Приложение сканирует стандартные
              папки устройства (например, DCIM, Pictures, Movies, Download), чтобы сгруппировать
              фотографии и видео по папкам и показать их на экране.
            </p>
            <p>
              Фотографии и видео НИКОГДА не отправляются на удалённые серверы — ни для анализа, ни
              для хранения, ни для какой-либо иной обработки. Миниатюры создаются и хранятся
              локально.
            </p>
          </Section>

          <Section title="2. Сейф и шифрование">
            <p>
              Файлы, перемещённые в «Сейф», шифруются локально на устройстве (AES-GCM) и хранятся в
              закрытой внутренней памяти приложения, недоступной другим приложениям.
            </p>
            <p>
              PIN-код Сейфа никогда не сохраняется в открытом виде — хранится только его
              криптографический хеш, из которого PIN восстановить нельзя. Ключ шифрования
              находится в оперативной памяти только пока Сейф разблокирован.
            </p>
            <p>
              После успешного шифрования оригинальный файл автоматически удаляется из общедоступной
              памяти устройства, чтобы его копия не оставалась в обычной галерее.
            </p>
            <p
              className="rounded-xl p-3 font-medium text-foreground"
              style={{ background: "var(--color-muted)", border: "1px solid var(--color-border)" }}
            >
              ВАЖНО: данные Сейфа не синхронизируются с облаком и не имеют резервной копии. Если вы
              забудете PIN-код или удалите приложение, зашифрованные файлы будут утрачены
              безвозвратно. Ни разработчик, ни кто-либо другой не сможет их восстановить.
            </p>
          </Section>

          <Section title="3. Реклама (Google AdMob)">
            <p>
              Приложение показывает одно нативное рекламное объявление с помощью Google Mobile Ads
              (AdMob). SDK Google автоматически собирает технические данные — рекламный
              идентификатор (Advertising ID), IP-адрес, сведения о сети и устройстве — для показа и
              персонализации рекламы, измерения её эффективности и предотвращения мошенничества.
            </p>
            <p>
              Пользователям в ЕЭЗ, Великобритании и Швейцарии перед показом рекламы предлагается
              форма согласия Google (UMP). Изменить выбор можно в любой момент: «Настройки» →
              «Настройки конфиденциальности». Подробнее:{" "}
              <span className="text-foreground">policies.google.com/technologies/ads</span>.
            </p>
            <p>Ваши фотографии, видео и содержимое Сейфа рекламному SDK не передаются.</p>
          </Section>

          <Section title="4. Настройки и метаданные">
            <p>
              Настройки (язык, тема, сортировка, число столбцов), метаданные папок Сейфа и
              служебные флаги хранятся только локально на устройстве и никогда не передаются
              разработчику.
            </p>
          </Section>

          <Section title="5. Разрешения и MANAGE_EXTERNAL_STORAGE">
            <p>
              Доступ к фото и видео (READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, а на старых версиях
              Android — READ_EXTERNAL_STORAGE) нужен, чтобы показать ваши медиафайлы в Галерее.
            </p>
            <p>
              Разрешение на полный доступ к файлам (MANAGE_EXTERNAL_STORAGE) — это основная
              функция приложения. Оно строго необходимо для того, чтобы после надёжного шифрования
              файла в Сейф приложение могло удалить оригинальное фото или видео из любой
              общедоступной папки устройства. Без него оригинал остался бы доступен в обычной
              галерее. Разрешение не используется для чтения, загрузки или передачи других файлов.
            </p>
            <p>
              Биометрия используется только для локальной разблокировки Сейфа; биометрические
              данные обрабатываются системой Android и приложению недоступны. Интернет нужен
              только для рекламы.
            </p>
          </Section>

          <Section title="6. Дети">
            <p>Приложение не предназначено для детей младше 13 лет.</p>
          </Section>

          <Section title="7. Изменения политики">
            <p>
              Обновлённая версия политики публикуется в приложении. Продолжая пользоваться
              приложением, вы соглашаетесь с актуальной редакцией.
            </p>
          </Section>
        </article>
      </div>
    </div>
  );
}
