import type { Lang } from "./i18n";

/** Selected-photo permission state, in every shipped locale. */
export const mediaAccessCopy: Record<Lang, { partial: string; denied: string; change: string }> = {
  en: { partial: "Only selected photos and videos are visible.", denied: "Access to photos and videos is limited.", change: "Change access" },
  ru: { partial: "Доступны только выбранные фото и видео.", denied: "Доступ к фото и видео ограничен.", change: "Изменить доступ" },
  kk: { partial: "Тек таңдалған фото мен бейнелер қолжетімді.", denied: "Фото мен бейнеге рұқсат шектеулі.", change: "Рұқсатты өзгерту" },
  pt: { partial: "Apenas as fotos e vídeos selecionados estão disponíveis.", denied: "O acesso a fotos e vídeos está limitado.", change: "Alterar acesso" },
  es: { partial: "Solo están disponibles las fotos y vídeos seleccionados.", denied: "El acceso a fotos y vídeos está limitado.", change: "Cambiar acceso" },
  fr: { partial: "Seules les photos et vidéos sélectionnées sont disponibles.", denied: "L’accès aux photos et vidéos est limité.", change: "Modifier l’accès" },
  ar: { partial: "تتوفر الصور ومقاطع الفيديو المحددة فقط.", denied: "الوصول إلى الصور والفيديوهات محدود.", change: "تغيير الوصول" },
  zh: { partial: "只能查看已选择的照片和视频。", denied: "照片和视频访问权限受限。", change: "更改访问权限" },
  ko: { partial: "선택한 사진과 동영상만 볼 수 있습니다.", denied: "사진 및 동영상 접근 권한이 제한되었습니다.", change: "접근 권한 변경" },
  ja: { partial: "選択した写真と動画のみ表示できます。", denied: "写真と動画へのアクセスが制限されています。", change: "アクセス権を変更" },
  de: { partial: "Nur ausgewählte Fotos und Videos sind verfügbar.", denied: "Der Zugriff auf Fotos und Videos ist eingeschränkt.", change: "Zugriff ändern" },
  it: { partial: "Sono disponibili solo le foto e i video selezionati.", denied: "L’accesso a foto e video è limitato.", change: "Modifica accesso" },
  tr: { partial: "Yalnızca seçilen fotoğraf ve videolar kullanılabilir.", denied: "Fotoğraf ve video erişimi kısıtlı.", change: "Erişimi değiştir" },
  pl: { partial: "Dostępne są tylko wybrane zdjęcia i filmy.", denied: "Dostęp do zdjęć i filmów jest ograniczony.", change: "Zmień dostęp" },
  hi: { partial: "केवल चुनी हुई फ़ोटो और वीडियो उपलब्ध हैं।", denied: "फ़ोटो और वीडियो की अनुमति सीमित है।", change: "अनुमति बदलें" },
  vi: { partial: "Chỉ có thể xem ảnh và video đã chọn.", denied: "Quyền truy cập ảnh và video bị giới hạn.", change: "Thay đổi quyền" },
  id: { partial: "Hanya foto dan video yang dipilih tersedia.", denied: "Akses foto dan video dibatasi.", change: "Ubah akses" },
};
