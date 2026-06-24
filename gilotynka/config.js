// ─────────────────────────────────────────────────────────────
//  Konfiguracja Supabase. UZUPEŁNIJ dwie wartości:
//  Supabase → Project Settings → API → "Project URL" oraz "anon public".
//
//  Klucz "anon" jest PUBLICZNY z założenia — bezpieczeństwa pilnuje
//  RLS w bazie (supabase/schema.sql), nie ukrywanie klucza.
//  Dopóki tu są placeholdery, aplikacja pokaże komunikat o braku konfiguracji.
// ─────────────────────────────────────────────────────────────
window.CONFIG = {
  url:     "https://TWOJ-PROJEKT.supabase.co",
  anonKey: "TWOJ_ANON_PUBLIC_KEY",
};
