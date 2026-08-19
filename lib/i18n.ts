import type { Locale } from "./types";

export type TranslationVars = Record<string, string | number>;

/**
 * English is the source dictionary — every other locale is typed against its
 * keys, so a missing or misspelled translation fails the build rather than
 * showing a raw key to a streamer mid-broadcast.
 *
 * Native currency units (bits, Kicks) are deliberately absent: they're brand
 * names, not words, and stay as-is in every language.
 */
const en = {
  // Chrome
  settings: "Settings",
  done: "Done",
  closeSettings: "Close settings",
  loading: "Loading",

  // Counters and filters
  unread: "unread",
  paid: "paid",
  unreadOnly: "Unread only",
  paidOnly: "Paid only",
  markAllRead: "Mark all read",

  // Gaps
  gapTitle: "Not listening for {duration}",
  gapBody: "Messages sent between {from} and {to} were not captured.",
  gapBodyPlatform: "{platform} messages sent between {from} and {to} were not captured.",
  leaveWarning: "Sources are still connected. Leaving now stops capturing messages.",

  // Rows
  markRead: "Mark read",
  markUnread: "Mark unread",
  subTag: "sub",

  // Empty states
  emptyNoSourcesTitle: "No sources on",
  emptyNoSourcesBody: "Turn on a channel in the strip above, then add its details in Settings.",
  emptyFilteredTitle: "Nothing matches",
  emptyFilteredBody: "Clear a filter to see the rest of the feed.",
  emptyWaitingTitle: "Waiting for messages",
  emptyWaitingBody: "Connected and listening. Messages appear here as they arrive.",

  // Connection states
  stateOff: "Off",
  stateDisconnected: "Disconnected",
  stateConnecting: "Connecting",
  stateLive: "Live",
  stateError: "Error",
  stateUnavailable: "Unavailable",
  toggleChannel: "{platform}: {state}. Click to turn {action}.",
  on: "on",
  off: "off",

  // Appearance
  appearance: "Appearance",
  language: "Language",
  theme: "Theme",
  themeSystem: "System",
  themeDark: "Dark",
  themeLight: "Light",

  // Profiles
  profiles: "Profiles",
  profile: "Profile",
  activeProfile: "Active profile",
  profileName: "Profile name",
  addProfile: "Add profile",
  newProfileName: "New channel",
  renameProfile: "Rename profile",
  deleteProfile: "Delete profile",
  deleteProfileConfirm: "Delete the profile “{name}” and its settings?",
  lastProfile: "Keep at least one profile.",
  switchProfile: "Switch to {name}",

  // Twitch
  channelToRead: "Channel to read",
  showValue: "Show",
  hideValue: "Hide",
  clientId: "Client ID",
  clientIdPlaceholder: "your Twitch app client id",
  channelPlaceholder: "somestreamer",
  signInWithTwitch: "Sign in with Twitch",
  signOut: "Sign out",
  signedInAs: "Signed in as {user}",
  twitchHint:
    "Create an app at dev.twitch.tv/console/apps, set its OAuth redirect URL to this page's address, and paste the client ID here. Reading chat works for any channel; cheer and subscription events only appear on your own channel.",
  twitchClientIdShared: "Shared by every profile — it identifies this app, not a channel.",

  // YouTube
  videoIdOrUrl: "Live video ID or URL",
  apiKey: "API key",
  videoPlaceholder: "https://youtube.com/watch?v=...",
  apiKeyPlaceholder: "your YouTube Data API v3 key",
  youtubeHint:
    "Use your own key: the daily quota is counted per key, so a shared one would run out quickly. Enable the YouTube Data API v3 in the Google Cloud console and restrict it to this site's address.",

  // Kick
  channelSlug: "Channel slug",
  chatroomId: "Chatroom ID",
  kickChannelId: "Channel ID (optional)",
  kickChannelIdHint: "Adds subscription and gift events. Chat works without it.",
  kickHint:
    "Kick doesn't let anything look up your chatroom ID, so paste it once — it never changes. Open the link below, then copy the number after \u201cchatroom\u201d: \u2192 \u201cid\u201d. The nearby top-level \u201cid\u201d is the optional channel ID.",
  kickOpenLookup: "Open kick.com/api/v2/channels/{slug}",
  kickNeedSlugFirst: "Enter the channel slug above and a link will appear.",

  // Streamlabs
  slSocketToken: "Socket API token",
  slTokenPlaceholder: "your Streamlabs socket token",
  slHint:
    "Account Settings \u2192 API Settings \u2192 API Tokens \u2192 \u201cYour Socket API Token\u201d. Brings in every donation routed through Streamlabs \u2014 Ceneka included.",
  slNeedToken: "Add your Streamlabs socket token in Settings.",
  slReading: "Reading Streamlabs donations",
  slSocketError: "Streamlabs socket error.",
  slReconnecting: "Reconnecting to Streamlabs\u2026",

  // StreamElements
  seToken: "Token",
  seTokenPlaceholder: "your StreamElements JWT or overlay token",
  seMethod: "Token type",
  seMethodJwt: "JWT",
  seMethodApikey: "Overlay",
  seHint:
    "Profile menu \u2192 Channels \u2192 Show secrets for the JWT. Brings in every tip routed through StreamElements \u2014 Ceneka included.",
  seNeedToken: "Add your StreamElements token in Settings.",
  seReading: "Reading StreamElements tips",
  seUnauthorized: "StreamElements rejected that token. Check the token type.",
  seSocketError: "StreamElements socket error.",
  seReconnecting: "Reconnecting to StreamElements\u2026",

  // Ceneka
  cenekaHint:
    "Ceneka has no realtime API of its own \u2014 it delivers donations through Streamlabs or StreamElements, whichever you linked in your Ceneka panel. Turn that source on above and your Ceneka donations arrive there. This panel stays as a reminder; it has nothing to connect to itself.",

  // History
  history: "History",
  loadOlder: "Load older",
  loadingOlder: "Loading…",
  noOlder: "That's the whole history.",
  sourceLabel: "Source label",
  sourceLabelName: "Name",
  sourceLabelMark: "Mark",
  bandBackground: "Row background",
  bandBackgroundOff: "Off",
  bandBackgroundOn: "On",
  bandBackgroundNote:
    "Tints the whole row with the donation\u2019s colour. The amount always carries it, so this is only for making a big one impossible to miss.",
  sourceLabelNote:
    "Marks are colour-coded initials, not the platforms\u2019 logos \u2014 those are trademarks with their own brand rules. See README.md to use official artwork.",
  capture: "Take in",
  capturePaid: "Paid only",
  captureAll: "Everything",
  capturePaidNote:
    "Ordinary chat is ignored entirely — not shown, not stored. Tips, Super Chats, cheers and subs still arrive.",
  captureAllNote: "Every message is taken in, including ordinary chat.",
  historyKept: "Keep chat for",
  historyDaysValue: "{days} days",
  historyForever: "Forever",
  historyPaidNote: "Paid messages are always kept, whatever this is set to.",
  storageUsed: "{used} of {total} used",
  storageUnknown: "Storage use unavailable.",
  storagePersisted: "The browser has agreed not to evict this data.",
  storageBestEffort: "The browser may clear this data if the disk fills up.",
  storageMemoryOnly: "This browser refused persistent storage, so history lasts only until the tab closes.",
  storedMessages: "{count} messages stored",
  clearHistory: "Delete stored messages",
  clearHistoryConfirm: "Delete every stored message for “{name}”?",

  // Adapter status — Twitch
  twitchNeedClientId: "Add a Twitch client ID in Settings.",
  twitchNeedSignIn: "Sign in with Twitch in Settings.",
  twitchNeedChannel: "Choose a channel to read in Settings.",
  twitchNoSuchChannel: "No Twitch channel called “{channel}”.",
  twitchTokenRejected: "Twitch rejected the token. Sign in again.",
  twitchSignInFailed: "Twitch rejected that sign-in. Try again.",
  twitchSocketError: "Twitch socket error.",
  twitchReconnecting: "Reconnecting to Twitch…",
  twitchRevoked: "Twitch revoked {type}. Sign in again.",
  twitchReadingFull: "Reading {channel} with cheers and subs",
  twitchReadingChatOnly: "Reading {channel} (chat only — not your channel)",

  // Adapter status — YouTube
  ytNeedApiKey: "Add a YouTube API key in Settings.",
  ytBadVideo: "That doesn't look like a YouTube video ID or URL.",
  ytNoSuchVideo: "No video with that ID, or it is private. Check the link.",
  ytNotLive: "That video is not a live stream.",
  ytNoLiveChat: "Live chat is not active on that stream — it may have ended, or chat is off.",
  ytUnreachable: "Could not reach YouTube.",
  ytReading: "Reading live chat",
  ytResumed: "Resumed where it left off",
  ytQuota: "Daily YouTube API quota used up. It resets at midnight Pacific time.",
  ytRateLimited: "YouTube is rate limiting this key. Slowing down.",
  ytForbidden: "YouTube refused the request. Check the key's restrictions.",
  ytRejected: "YouTube rejected the request.",
  ytChatGone: "That live chat no longer exists — the stream may have ended.",
  ytLostContact: "Lost contact with YouTube. Retrying…",

  // Adapter status — Kick
  kickNeedChatroomId: "Add the Kick chatroom ID in Settings.",
  kickSocketError: "Kick socket error.",
  kickReconnecting: "Reconnecting to Kick…",
  kickReading: "Reading {channel}",

  // Adapter status — Ceneka
  cenekaUnavailable: "Ceneka arrives through Streamlabs or StreamElements — turn one of those on.",
} as const;

export type TranslationKey = keyof typeof en;

const es: Record<TranslationKey, string> = {
  settings: "Ajustes",
  done: "Listo",
  closeSettings: "Cerrar ajustes",
  loading: "Cargando",

  unread: "sin leer",
  paid: "con dinero",
  unreadOnly: "Solo sin leer",
  paidOnly: "Solo con dinero",
  markAllRead: "Marcar todo leído",

  gapTitle: "Sin escuchar por {duration}",
  gapBody: "Los mensajes enviados entre {from} y {to} no se capturaron.",
  gapBodyPlatform: "Los mensajes de {platform} enviados entre {from} y {to} no se capturaron.",
  leaveWarning: "Las fuentes siguen conectadas. Si salís ahora, dejás de capturar mensajes.",

  markRead: "Marcar leído",
  markUnread: "Marcar sin leer",
  subTag: "sub",

  emptyNoSourcesTitle: "Sin fuentes activas",
  emptyNoSourcesBody:
    "Activá un canal en la barra de arriba y después completá sus datos en Ajustes.",
  emptyFilteredTitle: "Nada coincide",
  emptyFilteredBody: "Quitá un filtro para ver el resto de los mensajes.",
  emptyWaitingTitle: "Esperando mensajes",
  emptyWaitingBody: "Conectado y escuchando. Los mensajes aparecen acá cuando llegan.",

  stateOff: "Apagado",
  stateDisconnected: "Desconectado",
  stateConnecting: "Conectando",
  stateLive: "En vivo",
  stateError: "Error",
  stateUnavailable: "No disponible",
  toggleChannel: "{platform}: {state}. Clic para {action}.",
  on: "activar",
  off: "desactivar",

  appearance: "Apariencia",
  language: "Idioma",
  theme: "Tema",
  themeSystem: "Sistema",
  themeDark: "Oscuro",
  themeLight: "Claro",

  profiles: "Perfiles",
  profile: "Perfil",
  activeProfile: "Perfil activo",
  profileName: "Nombre del perfil",
  addProfile: "Agregar perfil",
  newProfileName: "Canal nuevo",
  renameProfile: "Renombrar perfil",
  deleteProfile: "Eliminar perfil",
  deleteProfileConfirm: "¿Eliminar el perfil “{name}” y sus ajustes?",
  lastProfile: "Tenés que dejar al menos un perfil.",
  switchProfile: "Cambiar a {name}",

  channelToRead: "Canal a leer",
  showValue: "Mostrar",
  hideValue: "Ocultar",
  clientId: "Client ID",
  clientIdPlaceholder: "client id de tu app de Twitch",
  channelPlaceholder: "unstreamer",
  signInWithTwitch: "Iniciar sesión con Twitch",
  signOut: "Cerrar sesión",
  signedInAs: "Sesión iniciada como {user}",
  twitchHint:
    "Creá una app en dev.twitch.tv/console/apps, poné la URL de redirección OAuth apuntando a esta página y pegá el client ID acá. Leer el chat funciona en cualquier canal; los bits y las suscripciones solo aparecen en tu propio canal.",
  twitchClientIdShared: "Compartido por todos los perfiles: identifica a esta app, no a un canal.",

  videoIdOrUrl: "ID o URL del video en vivo",
  apiKey: "Clave de API",
  videoPlaceholder: "https://youtube.com/watch?v=...",
  apiKeyPlaceholder: "tu clave de YouTube Data API v3",
  youtubeHint:
    "Usá tu propia clave: la cuota diaria se cuenta por clave, así que una compartida se agotaría enseguida. Habilitá YouTube Data API v3 en la consola de Google Cloud y restringí la clave a la dirección de este sitio.",

  channelSlug: "Slug del canal",
  chatroomId: "ID del chatroom",
  kickChannelId: "ID del canal (opcional)",
  kickChannelIdHint: "Agrega suscripciones y regalos. El chat funciona sin esto.",
  kickHint:
    "Kick no deja que nada averigüe el ID de tu chatroom, así que pegalo una vez: nunca cambia. Abrí el enlace de abajo y copiá el número que está en \u201cchatroom\u201d: \u2192 \u201cid\u201d. El \u201cid\u201d de arriba de todo es el ID de canal opcional.",
  kickOpenLookup: "Abrir kick.com/api/v2/channels/{slug}",
  kickNeedSlugFirst: "Escribí el slug del canal arriba y va a aparecer un enlace.",

  slSocketToken: "Token de la API de socket",
  slTokenPlaceholder: "tu token de socket de Streamlabs",
  slHint:
    "Account Settings \u2192 API Settings \u2192 API Tokens \u2192 \u201cYour Socket API Token\u201d. Trae todas las donaciones que pasan por Streamlabs, incluidas las de Ceneka.",
  slNeedToken: "Agreg\u00e1 tu token de socket de Streamlabs en Ajustes.",
  slReading: "Leyendo donaciones de Streamlabs",
  slSocketError: "Error en el socket de Streamlabs.",
  slReconnecting: "Reconectando con Streamlabs\u2026",

  seToken: "Token",
  seTokenPlaceholder: "tu JWT o token de overlay de StreamElements",
  seMethod: "Tipo de token",
  seMethodJwt: "JWT",
  seMethodApikey: "Overlay",
  seHint:
    "Men\u00fa de perfil \u2192 Channels \u2192 Show secrets para el JWT. Trae todas las propinas que pasan por StreamElements, incluidas las de Ceneka.",
  seNeedToken: "Agreg\u00e1 tu token de StreamElements en Ajustes.",
  seReading: "Leyendo propinas de StreamElements",
  seUnauthorized: "StreamElements rechaz\u00f3 ese token. Revis\u00e1 el tipo de token.",
  seSocketError: "Error en el socket de StreamElements.",
  seReconnecting: "Reconectando con StreamElements\u2026",

  cenekaHint:
    "Ceneka no tiene una API en tiempo real propia: entrega las donaciones a través de Streamlabs o StreamElements, según cuál hayas vinculado en tu panel de Ceneka. Activá esa fuente acá arriba y tus donaciones de Ceneka van a llegar por ahí. Este panel queda como recordatorio; no tiene nada a lo que conectarse.",

  history: "Historial",
  loadOlder: "Cargar anteriores",
  loadingOlder: "Cargando…",
  noOlder: "Eso es todo el historial.",
  sourceLabel: "Etiqueta de origen",
  sourceLabelName: "Nombre",
  sourceLabelMark: "Sigla",
  bandBackground: "Fondo de la fila",
  bandBackgroundOff: "Desactivado",
  bandBackgroundOn: "Activado",
  bandBackgroundNote:
    "Ti\u00f1e toda la fila con el color de la donaci\u00f3n. El monto ya lo lleva, as\u00ed que esto es solo para que una donaci\u00f3n grande sea imposible de pasar por alto.",
  sourceLabelNote:
    "Las siglas son iniciales con color, no los logos de las plataformas: esos son marcas registradas con sus propias reglas de uso. Mirá README.md para usar el arte oficial.",
  capture: "Recibir",
  capturePaid: "Solo con dinero",
  captureAll: "Todo",
  capturePaidNote:
    "El chat común se ignora por completo: no se muestra ni se guarda. Las propinas, Super Chats, bits y suscripciones siguen llegando.",
  captureAllNote: "Se reciben todos los mensajes, incluido el chat común.",
  historyKept: "Guardar el chat por",
  historyDaysValue: "{days} días",
  historyForever: "Para siempre",
  historyPaidNote: "Los mensajes con dinero se guardan siempre, sin importar este valor.",
  storageUsed: "{used} de {total} en uso",
  storageUnknown: "No se puede saber cuánto espacio se usa.",
  storagePersisted: "El navegador se comprometió a no borrar estos datos.",
  storageBestEffort: "El navegador puede borrar estos datos si se llena el disco.",
  storageMemoryOnly: "Este navegador rechazó el almacenamiento persistente, así que el historial dura hasta que cierres la pestaña.",
  storedMessages: "{count} mensajes guardados",
  clearHistory: "Borrar mensajes guardados",
  clearHistoryConfirm: "¿Borrar todos los mensajes guardados de “{name}”?",

  twitchNeedClientId: "Agregá un client ID de Twitch en Ajustes.",
  twitchNeedSignIn: "Iniciá sesión con Twitch en Ajustes.",
  twitchNeedChannel: "Elegí un canal a leer en Ajustes.",
  twitchNoSuchChannel: "No existe el canal de Twitch “{channel}”.",
  twitchTokenRejected: "Twitch rechazó el token. Iniciá sesión de nuevo.",
  twitchSignInFailed: "Twitch rechazó el inicio de sesión. Probá otra vez.",
  twitchSocketError: "Error en el socket de Twitch.",
  twitchReconnecting: "Reconectando con Twitch…",
  twitchRevoked: "Twitch revocó {type}. Iniciá sesión de nuevo.",
  twitchReadingFull: "Leyendo {channel} con bits y suscripciones",
  twitchReadingChatOnly: "Leyendo {channel} (solo chat — no es tu canal)",

  ytNeedApiKey: "Agregá una clave de API de YouTube en Ajustes.",
  ytBadVideo: "Eso no parece un ID ni una URL de video de YouTube.",
  ytNoSuchVideo: "No existe un video con ese ID, o es privado. Revisá el enlace.",
  ytNotLive: "Ese video no es una transmisión en vivo.",
  ytNoLiveChat: "El chat en vivo no está activo en esa transmisión: puede haber terminado, o el chat está desactivado.",
  ytUnreachable: "No se pudo conectar con YouTube.",
  ytReading: "Leyendo el chat en vivo",
  ytResumed: "Retomado desde donde quedó",
  ytQuota: "Se agotó la cuota diaria de la API de YouTube. Se reinicia a medianoche del Pacífico.",
  ytRateLimited: "YouTube está limitando esta clave. Bajando la frecuencia.",
  ytForbidden: "YouTube rechazó el pedido. Revisá las restricciones de la clave.",
  ytRejected: "YouTube rechazó el pedido.",
  ytChatGone: "Ese chat en vivo ya no existe: puede que la transmisión haya terminado.",
  ytLostContact: "Se perdió la conexión con YouTube. Reintentando…",

  kickNeedChatroomId: "Agregá el ID del chatroom de Kick en Ajustes.",
  kickSocketError: "Error en el socket de Kick.",
  kickReconnecting: "Reconectando con Kick…",
  kickReading: "Leyendo {channel}",

  cenekaUnavailable: "Ceneka llega por Streamlabs o StreamElements: activá una de esas fuentes.",
};

export const dictionaries: Record<Locale, Record<TranslationKey, string>> = { en, es };

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

/**
 * Substitutes `{name}` placeholders. An unknown key returns the key itself,
 * which is ugly on purpose — it makes a gap obvious in review rather than
 * silently rendering an empty string.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  vars?: TranslationVars,
): string {
  const template = dictionaries[locale]?.[key] ?? dictionaries.en[key];
  if (template === undefined) return key;
  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export type Translator = (key: TranslationKey, vars?: TranslationVars) => string;

export function makeTranslator(locale: Locale): Translator {
  return (key, vars) => translate(locale, key, vars);
}
