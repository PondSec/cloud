export const BRAND = {
  company: 'PondSec',
  product: 'Cloud Pro',
  fullName: 'PondSec Cloud Pro',
  appTitle: 'PondSec Cloud Pro',
  loginTitle: 'Ihr sicherer Cloud-Arbeitsplatz',
  loginSubtitle: 'Arbeiten Sie direkt in Ihrer persönlichen Cloud-Umgebung.',
  trustLine: 'Ein Produkt von PondSec',
  experienceLine: 'Persönlich geführt. Sicher betrieben. Klar gesteuert.',
};

export type AppShortcutId = 'home' | 'files' | 'search' | 'media' | 'settings';

export const APP_SHORTCUTS = [
  { id: 'home' as AppShortcutId, combo: 'Alt+H', macCombo: 'Ctrl+1 oder Cmd+Alt+H', label: 'Start' },
  { id: 'files' as AppShortcutId, combo: 'Alt+F', macCombo: 'Ctrl+2 oder Cmd+Alt+F', label: 'Dateien' },
  { id: 'search' as AppShortcutId, combo: 'Alt+S', macCombo: 'Ctrl+3 oder Cmd+Alt+S', label: 'Suche' },
  { id: 'media' as AppShortcutId, combo: 'Alt+M', macCombo: 'Ctrl+4 oder Cmd+Alt+M', label: 'Medien' },
  { id: 'settings' as AppShortcutId, combo: 'Alt+,', macCombo: 'Ctrl+5 oder Cmd+Alt+,', label: 'Einstellungen' },
];

export function comboForPlatform(
  shortcut: (typeof APP_SHORTCUTS)[number],
  isMac: boolean,
): string {
  return isMac ? shortcut.macCombo : shortcut.combo;
}
